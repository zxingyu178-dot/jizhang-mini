/**
 * data/budget/core.js — 预算节奏计算核心（纯函数，整数分）
 *
 * 消耗口径（与「本月支出」完全一致）：
 *   ledgerImpact === 'normal' && type === 'expense'
 *   → 普通支出消耗预算；收入不增加；daily-value-only 不消耗。
 *
 * 最关键公式（区分总预算与截至今日预算）：
 *   periodBudget    周期总预算（周期内每天每日预算之和，规则中途变更会分段）
 *   accruedBudget   截至今日预算（仅 accruedDays 内每天每日预算之和）
 *   actualExpense   周期内实际普通支出
 *   paceDelta       = accruedBudget - actualExpense（>0 盈余，<0 超支）
 *   remainingBudget = periodBudget - actualExpense（周期剩余）
 * 已结束周期 accruedDays=dayCount → accruedBudget=periodBudget。
 */
const rules = require('./rules');
const period = require('./period');
const dvCore = require('../daily-value/core');

/** 账单是否消耗预算：normal + expense */
function consumesBudget(bill) {
  return Boolean(
    bill &&
      bill.type === 'expense' &&
      bill.ledgerImpact !== 'daily-value-only'
  );
}

/** 账单本地业务日期 'yyyy-MM-dd' */
function billLocalDate(bill) {
  return dvCore.localDateKey(new Date(bill.occurredAt));
}

/** 求 [start,end) 内从第 0 天起、共 days 天的预算之和（按规则历史逐天） */
function sumDailyBudget(state, start, days) {
  let sum = 0;
  for (let i = 0; i < days; i++) {
    sum += rules.dailyCentsOn(state, period.addDays(start, i));
  }
  return sum;
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

  // 实际普通支出（周期内）
  let actualExpense = 0;
  (bills || []).forEach((b) => {
    if (!consumesBudget(b)) return;
    const d = billLocalDate(b);
    if (d >= start && d < end) actualExpense += b.amountCents;
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
    remainingBudget,
    hasBudget: periodBudget > 0,
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
  billLocalDate,
  sumDailyBudget,
  computePeriodBudget,
  computeByKind,
};
