/**
 * data/budget/core.js — 预算节奏计算核心（纯函数，整数分）
 *
 * 两层口径（v0.5.1 明确区分）：
 *   consumesBudget(bill)
 *     业务上「属于预算型支出」：ledgerImpact === 'normal' && type === 'expense'。
 *     普通支出消耗预算；收入不增加；daily-value-only 不消耗。
 *   countsAgainstBudget(bill, state, dateStr)
 *     这笔支出在「当日预算规则已启用」的前提下，才真正参与预算盈亏比较。
 *     预算启用之前 / 停用期间发生的普通支出，仍计入账本支出，但不拿来与预算比较。
 *
 * 时间范围（v0.5.1 防御）：
 *   当前周期（today / week / month）实际支出只统计「截至今天（含）」，
 *   未来日期账单不提前消耗今天的预算；过去周期（lastweek / lastmonth）统计完整周期。
 *
 * 最关键公式（区分总预算与截至今日预算）：
 *   periodBudget    周期总预算（周期内每天每日预算之和，规则中途变更会分段；无预算日为 0）
 *   accruedBudget   截至今日预算（仅 accruedDays 内每天每日预算之和）
 *   actualExpense   评估范围内、且当日预算启用的普通支出
 *   paceDelta       = accruedBudget - actualExpense（>0 盈余，<0 超支）
 *   remainingBudget = periodBudget - actualExpense（周期剩余；<0 表示超出总预算）
 * 已结束周期 accruedDays=dayCount → accruedBudget=periodBudget。
 */
const rules = require('./rules');
const period = require('./period');
const dvCore = require('../daily-value/core');

/** 账单是否属于预算型支出：normal + expense（不看当日规则） */
function consumesBudget(bill) {
  return Boolean(
    bill &&
      bill.type === 'expense' &&
      bill.ledgerImpact !== 'daily-value-only'
  );
}

/**
 * 这笔支出是否在当日预算规则下真正参与比较：
 *   consumesBudget 且当天预算 enabled。
 * @param dateStr 可选，已算好账单本地日期时传入（批量调用更省）
 */
function countsAgainstBudget(bill, state, dateStr) {
  if (!consumesBudget(bill)) return false;
  const d = dateStr || billLocalDate(bill);
  return rules.isEnabledOn(state, d);
}

/** 账单本地业务日期 'yyyy-MM-dd' */
function billLocalDate(bill) {
  return dvCore.localDateKey(new Date(bill.occurredAt));
}

/** 求 [start,start+days) 内共 days 天的预算之和（按规则历史逐天，无预算日为 0） */
function sumDailyBudget(state, start, days) {
  let sum = 0;
  for (let i = 0; i < days; i++) {
    sum += rules.dailyCentsOn(state, period.addDays(start, i));
  }
  return sum;
}

/** 评估范围内（前 accruedDays 天）预算启用的天数 */
function countEnabledDays(state, start, days) {
  let n = 0;
  for (let i = 0; i < days; i++) {
    if (rules.isEnabledOn(state, period.addDays(start, i))) n++;
  }
  return n;
}

/**
 * 计算一个周期的预算节奏。
 * @param bills 账单数组
 * @param state budget rules state（rules.normalizeState）
 * @param p period.buildPeriod 结果
 * @param [todayStr]
 */
function computePeriodBudget(bills, state, p, todayStr) {
  const start = p.start;
  const end = p.end;

  // 周期总预算（全部 dayCount 天）
  const periodBudget = sumDailyBudget(state, start, p.dayCount);
  // 截至今日预算（accruedDays 天）
  const accruedBudget = sumDailyBudget(state, start, p.accruedDays);

  // 评估截止日：当前周期只算到今天（含），过去周期算整周期，未来周期为 0 天。
  // accruedDays 已编码：未来周期 0 / 已结束周期 dayCount / 当前周期 今天序号。
  const evalEnd = period.addDays(start, p.accruedDays);
  const accruedEnabledDays = countEnabledDays(state, start, p.accruedDays);

  // 实际支出：评估范围内、且当日预算已启用的普通支出。
  // 启用预算之前 / 停用期间的支出不参与盈亏；未来日期账单不提前消耗。
  let actualExpense = 0;
  (bills || []).forEach((b) => {
    if (!consumesBudget(b)) return;
    const d = billLocalDate(b);
    if (d < start || d >= evalEnd) return;
    if (!rules.isEnabledOn(state, d)) return;
    actualExpense += b.amountCents;
  });

  const paceDelta = accruedBudget - actualExpense;
  const remainingBudget = periodBudget - actualExpense;

  return {
    kind: p.kind,
    start,
    end,
    dayCount: p.dayCount,
    accruedDays: p.accruedDays,
    periodBudget,
    accruedBudget,
    actualExpense,
    paceDelta,
    // 盈亏语义色调（供 UI 选 --budget-surplus 绿 / --budget-over 红；无预算周期 UI 不显示）
    paceTone: paceDelta >= 0 ? 'surplus' : 'over',
    remainingBudget,
    // 剩余文案状态：>=0 尚有剩余；<0 已超出周期总预算
    remainingState: remainingBudget >= 0 ? 'remaining' : 'exceeded',
    // 评估范围内是否存在「已启用预算」的日期（决定该周期显示数据还是「未启用预算」）
    hasBudget: accruedEnabledDays > 0,
    todayStr: todayStr || dvCore.localDateKey(),
  };
}

/** 便捷：指定 kind + 今天，一步算周期（账单由调用方给） */
function computeByKind(bills, state, kind, todayStr, weekStartsOn) {
  const today = todayStr || dvCore.localDateKey();
  const p = period.buildPeriod(kind, today, weekStartsOn == null ? state.weekStartsOn : weekStartsOn);
  return computePeriodBudget(bills, state, p, today);
}

module.exports = {
  consumesBudget,
  countsAgainstBudget,
  billLocalDate,
  sumDailyBudget,
  countEnabledDays,
  computePeriodBudget,
  computeByKind,
};
