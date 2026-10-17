// packages/importer/adapters/dailyvalue.js
// Android DailyValue 数据迁移 Adapter：
//   - CSV：表头 日期,时间,类型,金额,分类,备注,来源,账本影响（UTF-8 BOM），使用共享 header
//   - .dvbackup：DailyValueBackupV1，data.bills / categories
// 字段依据 daily-value-v2 最新 main（types.ts / category-defs.ts / backup.ts / csv.ts），禁止凭旧字段猜。
const money = require('../../../data/money');
const normalizer = require('../core/normalizer');
const diagnosis = require('../core/diagnosis');
const header = require('../core/header');
const recurringCore = require('../../../data/recurring/core');

// Android 分类中文名 → Mini 分类 id
const NAME_TO_ID = {
  餐饮: 'c-food',
  交通: 'c-transport',
  购物: 'c-shopping',
  娱乐: 'c-fun',
  生活: 'c-life',
  饮料: 'c-drink',
  话费: 'c-bill',
  工资: 'c-salary',
  医疗: 'c-medical',
  住房: 'c-housing',
  旅行: 'c-travel',
  其他: 'c-other',
};

const ALIASES = {
  date: ['日期'],
  time: ['时间'],
  type: ['类型'],
  amount: ['金额', '金额(元)', '交易金额'],
  category: ['分类'],
  note: ['备注'],
  source: ['来源'],
  ledger: ['账本影响'],
};

const ANCHOR = [ALIASES.date, ALIASES.type];
const REQUIRED = [ALIASES.date, ALIASES.type, ALIASES.amount];
const PRIMARY = ['日期', '类型', '金额'];

function get(row, idx) {
  if (idx < 0) return '';
  return String(row[idx] == null ? '' : row[idx]);
}

function nameToId(name) {
  const t = String(name || '').trim();
  if (NAME_TO_ID[t]) return NAME_TO_ID[t];
  const hit = Object.keys(NAME_TO_ID).find((k) => t.indexOf(k) >= 0);
  return hit ? NAME_TO_ID[hit] : 'c-other';
}

/** Android CSV 解析 */
function parseRows(rows, source, diag) {
  const anchor = header.findHeaderRow(rows, ANCHOR);
  if (!anchor) {
    diagnosis.setHeader(diag, false, -1);
    throw new Error('没有找到 DailyValue CSV 表头，请确认是 DailyValue 导出的账单 CSV');
  }
  diagnosis.setHeader(diag, true, anchor.index);
  const H = anchor.headers;

  const ci = {
    date: header.findColumn(H, ALIASES.date),
    time: header.findColumn(H, ALIASES.time),
    type: header.findColumn(H, ALIASES.type),
    amount: header.findColumn(H, ALIASES.amount),
    category: header.findColumn(H, ALIASES.category),
    note: header.findColumn(H, ALIASES.note),
    ledger: header.findColumn(H, ALIASES.ledger),
  };

  const missing = header.missingColumns(H, REQUIRED, PRIMARY);
  if (missing.length) {
    diagnosis.setMissingColumns(diag, missing);
    throw new Error('账单格式已识别，但“' + missing.join('、') + '”列格式发生变化，请点「复制诊断」反馈');
  }

  const bills = [];
  for (let i = anchor.index + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => !String(c).trim())) continue;
    if (diag) diag.totalDataRows += 1;

    const typeText = get(r, ci.type).trim();
    const ledgerText = get(r, ci.ledger).trim();
    let type;
    if (typeText === '支出') {
      type = 'expense';
      if (diag) diag.expenseRows += 1;
    } else if (typeText === '收入') {
      type = 'income';
      if (diag) diag.incomeRows += 1;
    } else {
      if (diag) diag.nonFlowSkipped += 1;
      continue;
    }

    if (ledgerText === '仅日价') {
      // CSV 不含完整日价字段（title/startDate），无法迁移仅日价物品；
      // 完整日价迁移请使用 Android 的 .dvbackup。
      if (diag) diag.nonFlowSkipped += 1;
      continue;
    }

    const date = get(r, ci.date).trim();
    const time = get(r, ci.time).trim();
    const occurredAt = normalizer.parseDateTime(date + ' ' + time);
    const amountCents = Math.abs(money.parseAmountToCents(get(r, ci.amount)));
    if (!occurredAt) {
      diagnosis.addError(diag, i, '日期/时间', ci.date, '缺失或无法解析');
      continue;
    }
    if (!amountCents) {
      diagnosis.addError(diag, i, '金额', ci.amount, '缺失或无法解析');
      continue;
    }

    const categoryId = nameToId(get(r, ci.category));
    const note = get(r, ci.note).trim();

    const b = normalizer.makeBill({
      type,
      amountCents,
      categoryId,
      occurredAt,
      merchant: '',
      note,
      source,
      sourceTxnId: '', // CSV 无流水号，走 fingerprint
    });
    b.fingerprint = normalizer.makeFingerprint(b);
    bills.push(b);
  }
  return bills;
}

/* ===================== .dvbackup 完整迁移（Gate F/G） ===================== */

/** 12 个系统固定分类 id（原样映射，不重建） */
const STANDARD_IDS = [
  'c-food', 'c-transport', 'c-shopping', 'c-fun', 'c-life', 'c-drink',
  'c-bill', 'c-salary', 'c-medical', 'c-housing', 'c-travel', 'c-other',
];
const STANDARD_SET = new Set(STANDARD_IDS);
// 支持的频率以 data/recurring/core.FREQUENCIES 为单一事实源（不在此重复定义）。

/** 清理 id 中不安全字符（确定性 id） */
function safeIdPart(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '');
}

/** 稳定短 hash（djb2 → base36），仅用于安全 id 碰撞时消除歧义 */
function stableShortHash(s) {
  let h = 5381;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h = (((h << 5) + h + str.charCodeAt(i)) >>> 0) || h;
  }
  return h.toString(36);
}

/**
 * 确定性安全 id 工厂（同一原始 id 永远得到同一 mini id）。
 * 正常情况：prefix + safeIdPart(original)，与历史映射完全一致（已导入用户重复导入不产生新 id）。
 * 仅当不同原始 id 清洗后碰撞（如 abc@1 与 abc#1 都→…abc1）时，给后来者追加稳定短 hash 消歧。
 */
function makeSafeIdFactory(prefix) {
  const usedIds = new Set();
  const originalToId = new Map();
  return function (originalId) {
    const key = String(originalId);
    if (originalToId.has(key)) return originalToId.get(key);
    const base = safeIdPart(key);
    let id = prefix + base;
    if (usedIds.has(id)) {
      let candidate = prefix + base + '-' + stableShortHash(key);
      let n = 1;
      while (usedIds.has(candidate)) {
        n++;
        candidate = prefix + base + '-' + stableShortHash(key + ':' + n);
      }
      id = candidate;
    }
    usedIds.add(id);
    originalToId.set(key, id);
    return id;
  };
}

/**
 * 映射备份分类：系统 id 原样；自定义分类给确定性 Mini id，并产出待建分类。
 * @returns {{idMap:object, toCreate:array}}
 */
function mapBackupCategories(backupCats) {
  const idMap = {};
  const toCreate = [];
  const seen = new Set();
  const catIdFactory = makeSafeIdFactory('dvcat-');
  backupCats.forEach((c) => {
    if (!c || !c.id || seen.has(c.id)) return;
    seen.add(c.id);
    if (STANDARD_SET.has(c.id)) {
      idMap[c.id] = c.id;
      return;
    }
    const mid = catIdFactory(c.id);
    idMap[c.id] = mid;
    const name = String(c.name || '').trim().slice(0, 8) || '自定义';
    toCreate.push({ id: mid, name, emoji: String(c.emoji || '📦') });
  });
  return { idMap, toCreate };
}

/** 账单 / 规则引用分类 id 的映射（找不到系统 id 用自身，否则 c-other） */
function resolveCategoryRef(androidId, idMap) {
  if (!androidId) return 'c-other';
  if (idMap[androidId]) return idMap[androidId];
  if (STANDARD_SET.has(androidId)) return androidId;
  return 'c-other';
}

/**
 * 映射周期规则（金额元→整数分；保留游标，不从头补账；忽略分类快照）。
 *
 * fail-closed 原则（v0.7.0）：不确定 / 损坏的规则一律「跳过」，绝不偷偷改变语义——
 *   · 非法 frequency（不在 daily/weekly/monthly/yearly）→ 跳过，不能把「每年」修成「每天」；
 *   · weekly day 必须是整数 0..6（0=周日…6=周六，与 JS getDay 一致），缺失/非法 → 跳过；
 *   · monthly / yearly day 必须是整数 1..31，缺失/非法 → 跳过；
 *   · yearly month 缺失允许（core / 文案统一回退 startDate 所在月），有值但非 1..12 → 跳过；
 *   · 金额必须为正、startDate 必须是真实 yyyy-MM-dd，否则跳过。
 * 所有判定统一委托 data/recurring/core.validateRecurringRule（单一事实源，不重复造一套口径）。
 * 合法规则的月末钳制（如 31 日在 2 月）仍由 core 正常处理，那不是损坏。
 * @returns {{rules:array, skipped:array<{id:string,reason:string}>}}
 */
function mapRecurringRules(backupRules, idMap, ruleIdFactory) {
  ruleIdFactory = ruleIdFactory || makeSafeIdFactory('dvrule-');
  const out = [];
  const skipped = [];
  const seen = new Set();
  backupRules.forEach((r) => {
    if (!r || !r.id || seen.has(r.id)) return;
    seen.add(r.id);
    const amountCents = Math.abs(money.yuanToCents(r.amount));
    // 硬校验 1：金额必须为正（0 / 负 / NaN 不生成账单）
    if (!amountCents) {
      skipped.push({ id: String(r.id), reason: 'invalid-amount' });
      return;
    }
    // 硬校验 2：startDate 必须是真实日历日期，否则 occurrence 会算出 NaN / 2026-09-00
    if (!recurringCore.isValidDateStr(r.startDate)) {
      skipped.push({ id: String(r.id), reason: 'invalid-start-date' });
      return;
    }
    // interval 缺失默认 1 是 Android 常见且安全的语义；钳到 1..999，保证后续校验必通过
    const interval = Number.isFinite(r.interval)
      ? Math.min(999, Math.max(1, Math.round(r.interval)))
      : 1;
    const rule = {
      id: ruleIdFactory(r.id),
      enabled: r.enabled === true,
      type: r.type === 'income' ? 'income' : 'expense',
      amountCents,
      categoryId: resolveCategoryRef(r.categoryId, idMap),
      note: r.note ? String(r.note) : '',
      // frequency 保留原始值：不把损坏的「每年」偷改成「每天」，交由 validate 判定
      frequency: r.frequency,
      interval,
      startDate: r.startDate,
      time: r.time,
      createdAt: r.createdAt || Date.now(),
    };
    // day / month 保留原始数值（不做域钳制、不猜测星期），统一由 validateRecurringRule 判定。
    // 注意 day=0（周日）必须能被保留：用 != null + isFinite 而非 truthy 判断。
    if (r.day != null && Number.isFinite(Number(r.day))) rule.day = Number(r.day);
    if (r.month != null && Number.isFinite(Number(r.month))) rule.month = Number(r.month);
    // fail-closed：频率/日/月任一非法 → 跳过，进入脱敏诊断，绝不静默改写
    const verdict = recurringCore.validateRecurringRule(rule);
    if (!verdict.ok) {
      skipped.push({ id: String(r.id), reason: verdict.reason });
      return;
    }
    if (r.scheduleEffectiveAt != null) rule.scheduleEffectiveAt = Number(r.scheduleEffectiveAt);
    if (r.lastGeneratedDate) rule.lastGeneratedDate = r.lastGeneratedDate;
    if (r.nextOccurrence) rule.nextOccurrence = r.nextOccurrence;
    if (r.updatedAt != null) rule.updatedAt = Number(r.updatedAt);
    out.push(rule);
  });
  return { rules: out, skipped };
}

/**
 * Android .dvbackup 解析（Gate F/G）：
 * 返回 { bills, categories(待建自定义分类), recurringRules(待建规则) }。
 * bills 的 categoryId 已映射；分类与规则的真正写入在 commit 阶段（幂等）。
 */
function parseBackup(obj) {
  if (!obj || obj.format !== 'daily-value-backup') {
    throw new Error('这不是 DailyValue 备份文件');
  }
  const data = obj.data || {};
  const srcBills = Array.isArray(data.bills) ? data.bills : [];
  const srcCats = Array.isArray(data.categories) ? data.categories : [];
  const srcRules = Array.isArray(data.recurringRules) ? data.recurringRules : [];

  const catResult = mapBackupCategories(srcCats);
  const idMap = catResult.idMap;
  // 账单与规则共用同一 id 工厂，保证账单 recurringRuleId 与待建规则 id 严格一致（含碰撞 hash）
  const ruleIdFactory = makeSafeIdFactory('dvrule-');
  const bills = [];

  srcBills.forEach((b) => {
    let type;
    if (b.type === 'expense') type = 'expense';
    else if (b.type === 'income') type = 'income';
    else return;

    const amountCents = Math.abs(money.yuanToCents(b.amount));
    const occurredAt = typeof b.timestamp === 'number' ? b.timestamp : normalizer.parseDateTime(b.date);
    if (!amountCents || !occurredAt) return;

    const categoryId = resolveCategoryRef(b.categoryId, idMap);
    const merchant = b.merchant ? String(b.merchant).trim() : '';
    const note = b.note ? String(b.note).trim() : '';
    const title = b.title ? String(b.title).trim() : '';

    const ledgerImpact = b.ledgerImpact === 'daily-value-only' ? 'daily-value-only' : 'normal';
    let dailyValue = null;
    if (b.dailyValue && b.dailyValue.enabled === true && b.dailyValue.startDate) {
      dailyValue = {
        enabled: true,
        mode: 'elapsed',
        startDate: String(b.dailyValue.startDate).slice(0, 10),
      };
    }

    const nb = normalizer.makeBill({
      type,
      amountCents,
      categoryId,
      occurredAt,
      title,
      merchant,
      note,
      ledgerImpact,
      dailyValue,
      source: 'dailyvalue',
      sourceTxnId: b.id ? String(b.id) : '', // 原 id 精确去重
    });
    // 周期账单：把来源规则 id 映射为 Mini 规则 id（与待建规则一致，共用同一工厂）
    if (b.source === 'recurring' && b.recurringRuleId) {
      nb.recurringRuleId = ruleIdFactory(b.recurringRuleId);
    }
    nb.fingerprint = normalizer.makeFingerprint(nb);
    bills.push(nb);
  });

  const ruleResult = mapRecurringRules(srcRules, idMap, ruleIdFactory);

  return {
    bills,
    categories: catResult.toCreate,
    recurringRules: ruleResult.rules,
    skippedRecurringRules: ruleResult.skipped,
  };
}

module.exports = {
  parseRows,
  parseBackup,
  nameToId,
  mapBackupCategories,
  resolveCategoryRef,
  STANDARD_IDS,
};
