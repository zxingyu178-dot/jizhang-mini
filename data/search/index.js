/**
 * data/search/index.js — 搜索模块统一入口（v1.1.0 Gate 1）
 *
 * 纯函数：searchBills / groupSearchResults / buildSearchQuery。
 * 页面只负责 UI，搜索算法全部收敛在此。
 */
const filters = require('./filters');
const core = require('./core');
const group = require('./group');
const range = require('./range');
const dateUtil = require('../date');

/**
 * 从 URL 参数 / 页面状态构造规范化搜索 Contract（供页面与统计钻取 query 复用）。
 * 输入为松散对象，输出完整合法 query。
 * 兼容统计钻取 URL 参数名 raw.category（等价于 contract 的 categoryId）。
 * 支持统计钻取便捷参数 raw.month ('YYYY-MM') / raw.year (YYYY)，
 * 命中时换算为 dateFrom / dateTo（month 优先于 year；显式 dateFrom/dateTo 不被覆盖）。
 */
function buildSearchQuery(raw) {
  raw = raw || {};
  // URL 用 category，contract 用 categoryId：补齐后再规范化
  const base = Object.assign({}, raw);
  if (base.categoryId == null && raw.category != null) base.categoryId = raw.category;
  const q = filters.normalizeQuery(base);
  const hasExplicitRange = q.dateFrom != null || q.dateTo != null;
  if (!hasExplicitRange) {
    if (raw.month) {
      const r = range.monthRange(raw.month);
      if (r) {
        q.dateFrom = r.dateFrom;
        q.dateTo = r.dateTo;
      }
    } else if (raw.year) {
      const r = range.yearRange(raw.year);
      if (r) {
        q.dateFrom = r.dateFrom;
        q.dateTo = r.dateTo;
      }
    }
  }
  return q;
}

module.exports = {
  searchBills: core.searchBills,
  groupSearchResults: group.groupSearchResults,
  buildSearchQuery,
  normalizeQuery: filters.normalizeQuery,
  hasAnyFilter: filters.hasAnyFilter,
  isEmptyQuery: filters.isEmptyQuery,
  dayLabel: group.dayLabel,
  monthRange: range.monthRange,
  yearRange: range.yearRange,
  // v1.1.1 共享日期工具（统一 999ms 边界与稳定 dateKey）
  daysInMonth: dateUtil.daysInMonth,
  startOfLocalDay: dateUtil.startOfLocalDay,
  endOfLocalDay: dateUtil.endOfLocalDay,
  dateKeyOf: dateUtil.dateKeyOf,
  dayLabelOf: dateUtil.dayLabelOf,
  describeRange: dateUtil.describeRange,
};
