/**
 * data/search/filters.js — 搜索过滤纯函数（v1.1.0 Gate 1）
 *
 * 统一搜索 Contract：
 *   { keyword, type, categoryId, dateFrom, dateTo }
 *   keyword    = 商户 / 名称(title) / 备注 / 分类名 / 分类 id / 金额
 *   type       = all / expense / income
 *   categoryId = all / 具体分类 id
 *   dateFrom/dateTo = 可选（时间戳，含端点）
 * 全部条件 AND。
 */
const money = require('../money');

const VALID_TYPES = ['all', 'expense', 'income'];

/** 规范化查询条件（任何松散输入都得到完整、合法的 query） */
function normalizeQuery(q) {
  q = q || {};
  return {
    keyword: typeof q.keyword === 'string' ? q.keyword.trim() : '',
    type: VALID_TYPES.indexOf(q.type) >= 0 ? q.type : 'all',
    categoryId:
      q.categoryId && q.categoryId !== 'all' ? String(q.categoryId) : 'all',
    dateFrom: Number.isFinite(q.dateFrom) ? q.dateFrom : null,
    dateTo: Number.isFinite(q.dateTo) ? q.dateTo : null,
  };
}

/** 是否存在任何过滤条件 */
function hasAnyFilter(q) {
  return !!(
    q.keyword ||
    q.type !== 'all' ||
    q.categoryId !== 'all' ||
    q.dateFrom != null ||
    q.dateTo != null
  );
}

/** 空查询（无任何条件） */
function isEmptyQuery(q) {
  return !hasAnyFilter(q);
}

/** 关键词匹配：商户 / 名称 / 备注 / 分类名 / 分类 id / 金额（金额为精确可搜索字段，不做模糊数学） */
function matchKeyword(bill, keyword, category) {
  const key = String(keyword).toLowerCase();
  const fields = [
    bill.merchant || '',
    bill.title || '',
    bill.note || '',
    category ? category.name : '',
    category ? category.id : '',
    money.formatCents(bill.amountCents),
  ];
  return fields.some((f) => String(f).toLowerCase().indexOf(key) >= 0);
}

/** 收支类型匹配 */
function matchType(bill, type) {
  if (type === 'all') return true;
  return bill.type === type;
}

/** 分类匹配 */
function matchCategory(bill, categoryId) {
  if (categoryId === 'all') return true;
  return bill.categoryId === categoryId;
}

/** 日期范围匹配（含端点） */
function matchDateRange(bill, dateFrom, dateTo) {
  const t = bill.occurredAt;
  if (dateFrom != null && t < dateFrom) return false;
  if (dateTo != null && t > dateTo) return false;
  return true;
}

module.exports = {
  normalizeQuery,
  hasAnyFilter,
  isEmptyQuery,
  matchKeyword,
  matchType,
  matchCategory,
  matchDateRange,
};
