/**
 * data/daily-value/list.js — 日价物品列表派生（纯函数）
 *
 * 规则（对齐 Android computeDailyValueList）：
 * - 数据只从 Bill 派生（dailyValue.enabled），不维护第二套数据；
 * - 两类 ledgerImpact 都进日价列表（normal+dailyValue、daily-value-only）；
 * - 名称优先 title（日价物品名），缺失回退分类名；
 * - 默认按当前日价（分/天）从高到低排序。
 */
const core = require('./core');

/**
 * @param {Array} bills 全部账单（rangeBills）
 * @param {string} today 本地业务日期 yyyy-MM-dd
 * @param {(id:string)=>{name:string,emoji:string}} [resolveCategory] 分类解析（不依赖 store）
 * @returns {Array<{id,name,emoji,categoryId,title,amountCents,occurredAt,startDate,elapsed,currentCents,ledgerImpact}>}
 */
function computeDailyValueList(bills, today, resolveCategory) {
  const t = today || core.localDateKey();
  return (bills || [])
    .filter(core.isDailyValueEnabled)
    .map((b) => {
      const startDate = core.startDateOf(b);
      const cat = resolveCategory ? resolveCategory(b.categoryId) : null;
      const categoryName = cat ? cat.name : '';
      const emoji = cat ? cat.emoji : '';
      return {
        id: b.id,
        title: b.title || '',
        name: b.title || categoryName || '日价物品',
        emoji,
        categoryId: b.categoryId,
        amountCents: b.amountCents,
        occurredAt: b.occurredAt,
        startDate,
        elapsed: core.elapsedDays(startDate, t),
        currentCents: core.dailyValueCentsOf(b, t),
        ledgerImpact: b.ledgerImpact === 'daily-value-only' ? 'daily-value-only' : 'normal',
      };
    })
    .sort((a, b) => b.currentCents - a.currentCents);
}

module.exports = {
  computeDailyValueList,
};
