// data/statistics/range.js
// 任意日期范围统计纯函数（v1.1.0 Gate 4）：
// 输入「全部账单 + 起止时间戳」，输出该范围的支出 / 收入 / 结余 / 账单数。
// 口径与月度概览一致：仅统计 ledgerImpact === 'normal'（'daily-value-only' 不进账）。
// 不直接依赖 store / 日期字符串，便于单测；金额一律整数分。
const M = require('./month');

/**
 * 任意日期范围统计（含端点）
 * @param {Array} bills 全部账单
 * @param {number|null} dateFrom 起始时间戳（含），null 表示不限
 * @param {number|null} dateTo 结束时间戳（含），null 表示不限
 * @returns {{income:number, expense:number, balance:number, count:number}}
 */
function computeRangeStats(bills, dateFrom, dateTo) {
  const scoped = (bills || []).filter((b) => {
    if (!M.inLedger(b)) return false;
    if (dateFrom != null && b.occurredAt < dateFrom) return false;
    if (dateTo != null && b.occurredAt > dateTo) return false;
    return true;
  });
  return M.computeMonthOverview(scoped);
}

module.exports = {
  computeRangeStats,
};
