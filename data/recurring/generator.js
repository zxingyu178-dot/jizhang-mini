/**
 * data/recurring/generator.js — 周期账单生成器（v0.6.0，移植自 Android generator.ts）
 *
 * 小程序无后台常驻：在 App onLaunch / onShow（回到前台）时调用 runRecurringGenerator，
 * 自动补齐所有「已经到期但尚未生成」的周期账单（含用户长期未打开后的 catch-up）。
 *
 * 关键保证：
 *  - 确定性 Bill id（recur-{ruleId}-{date}-{time}）+ 查库跳过 → 幂等，多次运行不重复；
 *  - 并发锁：App onLaunch / onShow / main onShow 可能短时多次触发，只允许一个 drain；
 *  - 删除不复活：occDate <= lastGeneratedDate 一律视为已处理（即使 Bill 被手工删除）；
 *  - 编辑只影响未来：occMs <= scheduleEffectiveAt 不回填，但推进游标；
 *  - catch-up 上限：单规则单次最多 MAX_CATCHUP_PER_RULE 条，超出留诊断、下次继续。
 */
const core = require('./core');
const store = require('./store');
const ledger = require('../ledger');

function noop() {
  return {
    generated: 0,
    diagnosed: false,
    nextOccurrence: undefined,
    lastGeneratedDate: undefined,
  };
}

/**
 * 为单条规则生成所有到期 Bill，并更新游标。
 * @param {object} rule 规则
 * @param {Date} nowDate 当前时间（测试可注入）
 */
function generateDueBillsForRule(rule, nowDate) {
  nowDate = nowDate || new Date();
  if (!rule.enabled) return noop();

  const nowMs = nowDate.getTime();
  // 编辑生效边界：未设置 → 0 不影响；设置了则其之前一律不补生成
  const effectiveMs = rule.scheduleEffectiveAt != null ? rule.scheduleEffectiveAt : 0;
  const base =
    rule.lastGeneratedDate && rule.lastGeneratedDate > rule.startDate
      ? rule.lastGeneratedDate
      : rule.startDate;
  let idx = core.startIndexFor(rule, base);
  idx = Math.max(0, idx - 3); // 留 3 个 margin，靠幂等跳过重复

  let generated = 0;
  let lastGenerated;
  let nextOccurrence;

  for (let i = 0; i < core.MAX_CATCHUP_PER_RULE; i++) {
    const occDate = core.occurrenceDate(rule, idx + i);
    // 结构性早于游标 / 开始日（如 monthly 锚定 startDate 月、但日在其前）→ 跳过不计游标
    if (occDate < base) continue;
    // 已处理游标：occDate <= lastGeneratedDate 一律视为已处理（删除账单不复活）
    if (rule.lastGeneratedDate && occDate <= rule.lastGeneratedDate) {
      if (!lastGenerated || occDate > lastGenerated) lastGenerated = occDate;
      continue;
    }
    const occMs = core.occurrenceTimestamp(occDate, rule.time);

    // 第一个尚未到期的 occurrence → 即 nextOccurrence，停止
    if (occMs > nowMs) {
      nextOccurrence = occDate;
      break;
    }
    // 编辑生效边界之前：不回填，但推进游标避免重扫
    if (occMs <= effectiveMs) {
      if (!lastGenerated || occDate > lastGenerated) lastGenerated = occDate;
      continue;
    }

    const billId = core.recurringBillId(rule.id, occDate, rule.time);
    const existing = ledger.getBill(billId);
    if (!existing) {
      ledger.addBill({
        id: billId,
        type: rule.type,
        amountCents: rule.amountCents,
        categoryId: rule.categoryId,
        occurredAt: occMs,
        title: '',
        note: rule.note || '',
        source: 'recurring',
        recurringRuleId: rule.id,
        ledgerImpact: 'normal',
      });
      generated++;
    }
    if (!lastGenerated || occDate > lastGenerated) lastGenerated = occDate;
  }

  // 达上限仍未走到未来 occurrence → 未追上的 backlog，再尝试计算 next
  const diagnosed = nextOccurrence === undefined;
  if (nextOccurrence === undefined) {
    nextOccurrence = core.computeNextOccurrence(rule, nowDate);
  }
  const lastGeneratedDate =
    lastGenerated && (!rule.lastGeneratedDate || lastGenerated > rule.lastGeneratedDate)
      ? lastGenerated
      : rule.lastGeneratedDate;
  store.updateRule(rule.id, { lastGeneratedDate, nextOccurrence });
  return { generated, diagnosed, nextOccurrence, lastGeneratedDate };
}

/** 为所有启用规则生成到期 Bill（先统一 sanitize 并持久化被纠正字段） */
function generateDueBills(nowDate) {
  nowDate = nowDate || new Date();
  const rules = store.getRules();
  const cleaned = [];
  for (const r of rules) {
    const safe = core.sanitizeRecurringRule(r);
    const changed =
      safe.interval !== r.interval ||
      safe.enabled !== r.enabled ||
      safe.day !== r.day ||
      safe.time !== r.time ||
      (r.frequency === 'yearly' && safe.month !== r.month);
    if (changed) {
      const patch = {
        interval: safe.interval,
        enabled: safe.enabled,
        day: safe.day,
        time: safe.time,
      };
      if (r.frequency === 'yearly') patch.month = safe.month;
      store.updateRule(r.id, patch);
    }
    cleaned.push(safe);
  }

  const enabled = cleaned.filter((r) => r.enabled);
  const result = { totalGenerated: 0, diagnosedRules: 0, diagnostics: [] };
  for (const rule of enabled) {
    const res = generateDueBillsForRule(rule, nowDate);
    result.totalGenerated += res.generated;
    if (res.diagnosed) {
      result.diagnosedRules++;
      console.warn(
        '[recurring] rule ' +
          rule.id +
          ' 达到 catch-up 保护上限，已停止补齐并留下诊断；nextOccurrence=' +
          res.nextOccurrence
      );
    }
    result.diagnostics.push({
      ruleId: rule.id,
      generated: res.generated,
      nextOccurrence: res.nextOccurrence,
      diagnosed: res.diagnosed,
    });
  }
  return result;
}

/* ---- 并发锁：单一 drain Promise + rerun 不丢触发 ---- */
let runningPromise = null;
let rerunRequested = false;

/**
 * 幂等触发生成（去重去并发，但不丢触发）。
 * 运行中再次触发 → rerunRequested=true，返回同一 Promise；
 * 当前轮结束若 rerunRequested 则继续，直到 drain 完才 resolve。
 */
function runRecurringGenerator(nowDate) {
  if (runningPromise) {
    rerunRequested = true;
    return runningPromise;
  }
  runningPromise = new Promise((resolve) => {
    let lastResult = { totalGenerated: 0, diagnosedRules: 0, diagnostics: [] };
    try {
      do {
        rerunRequested = false;
        lastResult = generateDueBills(nowDate);
      } while (rerunRequested);
    } finally {
      runningPromise = null;
    }
    resolve(lastResult);
  });
  return runningPromise;
}

module.exports = {
  generateDueBillsForRule,
  generateDueBills,
  runRecurringGenerator,
};
