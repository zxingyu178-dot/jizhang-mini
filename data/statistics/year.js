// data/statistics/year.js
// 年度统计纯函数：输入「全年账单数组」，输出年度概览 / 12 个月趋势 / 全年分类排行 / 极值月。
// 复用 month.js 的口径与排行逻辑；金额整数分；不直接依赖 store。

const month = require('./month');

/**
 * 年度概览
 * @param {Array} bills 全年账单
 * @param {number} year
 * @returns {{year:number, income:number, expense:number, balance:number, count:number, monthlyAvg:number}}
 */
function computeYearOverview(bills, year) {
  let income = 0;
  let expense = 0;
  let count = 0;
  (bills || []).forEach((b) => {
    if (!month.inLedger(b)) return;
    count += 1;
    if (b.type === 'income') income += b.amountCents;
    else expense += b.amountCents;
  });
  return {
    year,
    income,
    expense,
    balance: income - expense,
    count,
    monthlyAvg: Math.round(expense / 12),
  };
}

/**
 * 12 个月支出趋势（每月一根柱，标签隔月显示避免拥挤）。
 * @returns {{points:Array, max:number}}
 */
function computeMonthlyTrend(bills, year) {
  const points = [];
  for (let m = 1; m <= 12; m++) {
    points.push({ month: m, label: m + '月', expense: 0, income: 0, percent: 0, showLabel: false });
  }
  (bills || []).forEach((b) => {
    if (!month.inLedger(b)) return;
    const mi = new Date(b.occurredAt).getMonth(); // 0-based
    if (b.type === 'income') points[mi].income += b.amountCents;
    else points[mi].expense += b.amountCents;
  });
  let max = 0;
  points.forEach((p) => {
    if (p.expense > max) max = p.expense;
  });
  points.forEach((p) => {
    p.percent = max ? Math.round((p.expense / max) * 100) : 0;
    if (p.month % 2 === 1) p.showLabel = true; // 1、3、5…
  });
  return { points, max };
}

/** 全年分类支出排行（Top 5 同月度结构） */
function computeYearCategoryRanking(bills, resolveCategory) {
  return month.computeCategoryRanking(bills, resolveCategory);
}

/**
 * 最高 / 最低消费月（仅在有支出的月份中比较，空月不算最低）。
 * @returns {{highest:Object|null, lowest:Object|null}}
 */
function computeExpenseExtremes(bills, year) {
  const { points } = computeMonthlyTrend(bills, year);
  let highest = null;
  let lowest = null;
  points.forEach((p) => {
    if (p.expense <= 0) return;
    if (!highest || p.expense > highest.expense) highest = p;
    if (!lowest || p.expense < lowest.expense) lowest = p;
  });
  return { highest, lowest };
}

module.exports = {
  computeYearOverview,
  computeMonthlyTrend,
  computeYearCategoryRanking,
  computeExpenseExtremes,
};
