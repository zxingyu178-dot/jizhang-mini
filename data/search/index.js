/**
 * data/search/index.js — 搜索模块统一入口（v1.1.0 Gate 1）
 *
 * 纯函数：searchBills / groupSearchResults / buildSearchQuery。
 * 页面只负责 UI，搜索算法全部收敛在此。
 */
const filters = require('./filters');
const core = require('./core');
const group = require('./group');

/**
 * 从 URL 参数 / 页面状态构造规范化搜索 Contract（供页面与统计钻取 query 复用）。
 * 输入为松散对象，输出完整合法 query。
 */
function buildSearchQuery(raw) {
  return filters.normalizeQuery(raw);
}

module.exports = {
  searchBills: core.searchBills,
  groupSearchResults: group.groupSearchResults,
  buildSearchQuery,
  normalizeQuery: filters.normalizeQuery,
  hasAnyFilter: filters.hasAnyFilter,
  isEmptyQuery: filters.isEmptyQuery,
  dayLabel: group.dayLabel,
};
