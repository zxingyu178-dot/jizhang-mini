/**
 * data/daily-value/detail.js — 日价详情派生（纯函数，Bill 派生）
 *
 * 详情 Hero 主数字是「当前日价（¥xx / 天）」，原价 / 起算日期为次级信息。
 * 边界：Bill 缺失 / dailyValue 未启用 → ok=false（页面渲染「不存在」，不白屏）；
 * 未来 startDate（脏数据）也安全：elapsedDays 口径 max(1,…)，elapsed >= 1。
 * 金额单位：整数分（amountCents），currentCents 为派生浮点。
 */
const core = require('./core');

/**
 * @param {object|undefined} bill
 * @param {string} [today]
 * @param {(id:string)=>{name:string,emoji:string}} [resolveCategory]
 */
function computeDailyValueDetail(bill, today, resolveCategory) {
  const t = today || core.localDateKey();
  const cat = bill && resolveCategory ? resolveCategory(bill.categoryId) : null;
  const categoryName = cat ? cat.name : '';
  const emoji = cat ? cat.emoji : '';

  if (!bill || !core.isDailyValueEnabled(bill)) {
    return {
      bill: bill || null,
      ok: false,
      name: (bill && bill.title) || categoryName || '',
      emoji,
      categoryId: bill ? bill.categoryId : '',
      title: bill ? bill.title || '' : '',
      amountCents: bill ? bill.amountCents || 0 : 0,
      occurredAt: bill ? bill.occurredAt : 0,
      startDate: bill ? core.startDateOf(bill) : '',
      ledgerImpact: bill ? bill.ledgerImpact || 'normal' : 'normal',
      elapsed: 0,
      currentCents: 0,
    };
  }

  const startDate = core.startDateOf(bill);
  const elapsed = core.elapsedDays(startDate, t);
  return {
    bill,
    ok: true,
    name: bill.title || categoryName || '日价物品',
    emoji,
    categoryId: bill.categoryId,
    title: bill.title || '',
    amountCents: bill.amountCents,
    occurredAt: bill.occurredAt,
    startDate,
    ledgerImpact: bill.ledgerImpact === 'daily-value-only' ? 'daily-value-only' : 'normal',
    elapsed,
    currentCents: core.dailyValueCentsOf(bill, t),
  };
}

module.exports = {
  computeDailyValueDetail,
};
