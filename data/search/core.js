/**
 * data/search/core.js — 搜索核心纯函数（v1.1.0 Gate 1）
 *
 * searchBills(bills, query, categoryResolver)：
 *   全部条件 AND，返回匹配账单（按 occurredAt 降序）。
 *   普通搜索只搜普通账单，日价专属物品（daily-value-only）不进普通搜索。
 */
const filters = require('./filters');

function searchBills(bills, rawQuery, categoryResolver) {
  const list = Array.isArray(bills) ? bills : [];
  const q = filters.normalizeQuery(rawQuery);
  const resolve = typeof categoryResolver === 'function' ? categoryResolver : () => null;

  return list
    .filter((b) => b && b.ledgerImpact !== 'daily-value-only')
    .filter((b) => {
      const cat = resolve(b.categoryId);
      if (q.keyword && !filters.matchKeyword(b, q.keyword, cat)) return false;
      if (!filters.matchType(b, q.type)) return false;
      if (!filters.matchCategory(b, q.categoryId)) return false;
      if (!filters.matchDateRange(b, q.dateFrom, q.dateTo)) return false;
      return true;
    })
    .sort((a, b) => b.occurredAt - a.occurredAt);
}

module.exports = { searchBills };
