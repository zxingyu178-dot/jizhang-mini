/**
 * data/search/group.js — 搜索结果分组纯函数（v1.1.0 Gate 1）
 *
 * groupSearchResults(bills, categoryResolver)：
 *   将账单按日期分组（降序），输出可直接渲染的 group 结构。
 */
const money = require('../money');

/** 时间戳 -> 「N月D日」分组标签 */
function dayLabel(ts) {
  const d = new Date(ts);
  return d.getMonth() + 1 + '月' + d.getDate() + '日';
}

/**
 * 账单按日期分组（账单建议已按 occurredAt 降序；这里不依赖排序也能正确分组）。
 * 返回 [{ label, records: [{id, emoji, name, note, amountText, isExpense}] }]
 */
function groupSearchResults(bills, categoryResolver) {
  const list = Array.isArray(bills) ? bills : [];
  const resolve = typeof categoryResolver === 'function' ? categoryResolver : () => null;
  const map = new Map();

  list.forEach((b) => {
    const label = dayLabel(b.occurredAt);
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
    if (!map.has(label)) map.set(label, { label, records: [] });
    map.get(label).records.push(item);
  });

  return Array.from(map.values());
}

module.exports = { groupSearchResults, dayLabel };
