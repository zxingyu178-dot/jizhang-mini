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

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

/**
 * 当前月的预算节奏摘要（统计页日历下方，正绿负红）：
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

const NO_PACE = (label) => ({ label, delta: 0, hasBudget: false });

/**
 * 统计页「所选月份」的预算节奏上下文（v0.5.1）：
 *  - 选当前月：本周截至今日 / 本月截至今日 / 上周 / 上月（截至今日口径）；
 *  - 选历史月：本月最终结果 / 上月最终结果（完整周期，不再出现「截至今日 / 本周」
 *    这类对历史月无意义、且错误显示今天数据的概念）；
 *  - 选未来月：不产生盈亏（UI 月份导航本就不允许越过当前月，此处仅防御）。
 * @return {isCurrent, isFuture, items:[{label,delta,hasBudget}]}
 */
function buildMonthPaceContext(bills, state, year, month, todayStr) {
  const today = todayStr || dvCore.localDateKey();
  const ym = year + '-' + pad2(month);
  const curYm = today.slice(0, 7);

  if (ym === curYm) {
    const ps = buildPaceSummary(bills, state, today);
    return {
      isCurrent: true,
      isFuture: false,
      items: [ps.weekToDate, ps.monthToDate, ps.lastWeek, ps.lastMonth],
    };
  }

  if (ym > curYm) {
    return {
      isCurrent: false,
      isFuture: true,
      items: [NO_PACE('本月最终'), NO_PACE('上月最终')],
    };
  }

  // 历史月：以该月最后一天为基准日，周期 accruedDays=dayCount，统计完整结果。
  const firstStr = ym + '-01';
  const lastDay = period.addDays(period.firstOfNextMonth(firstStr), -1);
  const ws = state.weekStartsOn;
  const cur = core.computeByKind(bills, state, 'month', lastDay, ws);
  const prev = core.computeByKind(bills, state, 'lastmonth', lastDay, ws);
  return {
    isCurrent: false,
    isFuture: false,
    items: [
      { label: '本月最终', delta: cur.paceDelta, hasBudget: cur.hasBudget },
      { label: '上月最终', delta: prev.paceDelta, hasBudget: prev.hasBudget },
    ],
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
  countsAgainstBudget: core.countsAgainstBudget,
  computePeriodBudget: core.computePeriodBudget,
  computeByKind: core.computeByKind,
  // calendar
  buildMonthCalendar: calendar.buildMonthCalendar,
  buildDayDetail: calendar.buildDayDetail,
  buildPaceSummary,
  buildMonthPaceContext,
  // 子模块
  rules,
  period,
  core,
  calendar,
};
