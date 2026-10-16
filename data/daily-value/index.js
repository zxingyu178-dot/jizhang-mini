/**
 * data/daily-value/index.js — 日价纯函数模块统一入口
 *
 * 日价永远从 Bill 派生，不新增「日价数据库」；当前日价为派生值，每天重算、不持久化。
 */
const core = require('./core');
const list = require('./list');
const detail = require('./detail');
const curve = require('./curve');
const milestones = require('./milestones');

module.exports = {
  // core
  dayNumber: core.dayNumber,
  localDateKey: core.localDateKey,
  msUntilNextLocalMidnight: core.msUntilNextLocalMidnight,
  elapsedDays: core.elapsedDays,
  isDailyValueEnabled: core.isDailyValueEnabled,
  startDateOf: core.startDateOf,
  dailyValueCentsOf: core.dailyValueCentsOf,
  totalDailyValueCents: core.totalDailyValueCents,
  countDailyValueItems: core.countDailyValueItems,
  // list / detail / curve / milestones
  computeDailyValueList: list.computeDailyValueList,
  computeDailyValueDetail: detail.computeDailyValueDetail,
  buildDailyValueCurve: curve.buildDailyValueCurve,
  computeUsageMilestones: milestones.computeUsageMilestones,
  computeDailyPriceMilestones: milestones.computeDailyPriceMilestones,
  nextPriceMilestone: milestones.nextPriceMilestone,
  buildMilestoneSummary: milestones.buildMilestoneSummary,
  // 子模块
  core,
  list,
  detail,
  curve,
  milestones,
};
