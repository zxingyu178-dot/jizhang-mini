/**
 * data/search/group.js — 搜索结果分组纯函数（v1.1.0 Gate 1；v1.1.1 修跨年合并）
 *
 * groupSearchResults(bills, categoryResolver, refYear?)：
 *   将账单按日期分组（降序），输出可直接渲染的 group 结构。
 *
 * v1.1.1 修复：
 *   - 分组稳定 key 改用 'YYYY-MM-DD'（dateKey），跨年同一天不再被合并；
 *   - 显示 label：refYear（默认当前年）同年省略年份，历史年显示年份，
 *     避免跨年搜索出现两个肉眼完全相同的「10月1日」。
 */
const money = require('../money');
const dateUtil = require('../date');

/** 时间戳 -> 「N月D日」标签（兼容旧导出，不带年份） */
function dayLabel(ts) {
  const d = new Date(ts);
  return d.getMonth() + 1 + '月' + d.getDate() + '日';
}

/**
 * 账单按日期分组（账单建议已按 occurredAt 降序；这里不依赖排序也能正确分组）。
 * 返回 [{ dateKey, label, records: [{id, emoji, name, note, amountText, isExpense, sourceBadge}] }]
 * @param {number} [refYear] 标签基准年份，默认当前年（历史年显示年份）
 */
function groupSearchResults(bills, categoryResolver, refYear) {
  const list = Array.isArray(bills) ? bills : [];
  const resolve = typeof categoryResolver === 'function' ? categoryResolver : () => null;
  const ref = Number.isInteger(refYear) ? refYear : new Date().getFullYear();
  const map = new Map();

  list.forEach((b) => {
    const dateKey = dateUtil.dateKeyOf(b.occurredAt);
    const label = dateUtil.dayLabelOf(b.occurredAt, ref);
    const cat = resolve(b.categoryId) || { name: '', emoji: '' };
    const isExp = b.type === 'expense';
    // 来源标记：recurring→周期、import→导入、manual 不显示。
    const sourceBadge = b.source === 'recurring' ? '周期' : b.source === 'import' ? '导入' : '';
    const item = {
      id: b.id,
      emoji: cat.emoji,
      name: b.merchant || b.title || cat.name,
      note: b.note || '',
      amountText: (isExp ? '-' : '+') + money.formatCents(b.amountCents),
      isExpense: isExp,
      sourceBadge,
    };
    if (!map.has(dateKey)) map.set(dateKey, { dateKey, label, records: [] });
    map.get(dateKey).records.push(item);
  });

  return Array.from(map.values());
}

module.exports = { groupSearchResults, dayLabel };
