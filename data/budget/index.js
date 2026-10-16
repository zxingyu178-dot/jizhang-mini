/**
 * data/budget/index.js — 预算模块纯函数统一入口
 *
 * 预算全部由「Bill + Budget Rules」动态派生，不给 Bill 加预算字段、
 * 不持久化每日预算，与日价的设计理念一致。
 */
const rules = require('./rules');
const period = require('./period');
const core = require('./core');
const calendar = require('./calendar');
const dvCore = require('../daily-value/core');

/**
 * 预算节奏摘要（统计页日历下方，正绿负红）：
 *   本周截至今日 / 本月截至今日 / 上周 / 上月。
 * 当前周期用「截至今日预算」口径，杜绝整月预算减半个月支出的虚假盈余。
 */
function buildPaceSummary(bills, state, todayStr) {
  const today = todayStr || dvCore.localDateKey();
  const ws = state.weekStartsOn;
  const curWeek = core.computeByKind(bills, state, 'week', today, ws);
  const curMonth = core.computeByKind(bills, state, 'month', today, ws);
  const lastWeek = core.computeByKind(bills, state, 'lastweek', today, ws);
  const lastMonth = core.computeByKind(bills, state, 'lastmonth', today, ws);
  return {
    weekToDate: { label: '本周截至今日', delta: curWeek.paceDelta, hasBudget: curWeek.hasBudget },
    monthToDate: { label: '本月截至今日', delta: curMonth.paceDelta, hasBudget: curMonth.hasBudget },
    lastWeek: { label: '上周', delta: lastWeek.paceDelta, hasBudget: lastWeek.hasBudget },
    lastMonth: { label: '上月', delta: lastMonth.paceDelta, hasBudget: lastMonth.hasBudget },
  };
}

module.exports = {
  // rules
  getBudgetState: rules.getBudgetState,
  normalizeState: rules.normalizeState,
  saveBudgetRule: rules.saveBudgetRule,
  applyRule: rules.applyRule,
  resolveRuleForDate: rules.resolveRuleForDate,
  isEnabledOn: rules.isEnabledOn,
  dailyCentsOn: rules.dailyCentsOn,
  // period
  buildPeriod: period.buildPeriod,
  // core
  consumesBudget: core.consumesBudget,
  computePeriodBudget: core.computePeriodBudget,
  computeByKind: core.computeByKind,
  // calendar
  buildMonthCalendar: calendar.buildMonthCalendar,
  buildDayDetail: calendar.buildDayDetail,
  buildPaceSummary,
  // 子模块
  rules,
  period,
  core,
  calendar,
};
