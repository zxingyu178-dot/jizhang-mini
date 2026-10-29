// data/statistics/year.js
// 年度统计纯函数：输入「全年账单数组」，输出年度概览 / 12 个月趋势 / 全年分类排行 / 极值月。
// 复用 month.js 的口径与排行逻辑；金额整数分；不直接依赖 store。

const month = require('./month');
const { pickCategoryVisual } = require('../category-icons');

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
  // 每月支出合计（用于「有支出的月份」计数）
  const monthExpense = new Array(12).fill(0);
  (bills || []).forEach((b) => {
    if (!month.inLedger(b)) return;
    count += 1;
    if (b.type === 'income') {
      income += b.amountCents;
    } else {
      expense += b.amountCents;
      monthExpense[new Date(b.occurredAt).getMonth()] += b.amountCents;
    }
  });
  // 月均支出 = 有支出月份的总支出 / 有支出月份数（不固定除以 12）
  let activeMonths = 0;
  monthExpense.forEach((c) => {
    if (c > 0) activeMonths += 1;
  });
  return {
    year,
    income,
    expense,
    balance: income - expense,
    count,
    activeMonths,
    monthlyAvg: activeMonths ? Math.round(expense / activeMonths) : 0,
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

// 最大单笔支出复用 month.findLargestExpense（v1.3.0 起统一口径，不再重复定义）。

/**
 * 记录最多的分类：按所有计入账本记录（含收入）的笔数；
 * 同笔数取 categoryId 字典序最小（确定性）。
 * @returns {{categoryId,name,emoji,count}|null}
 */
function findMostRecordedCategory(bills, resolveCategory) {
  const counts = {};
  (bills || []).forEach((b) => {
    if (!month.inLedger(b)) return;
    const c = b.categoryId || 'c-other';
    counts[c] = (counts[c] || 0) + 1;
  });
  let best = null;
  Object.keys(counts).forEach((k) => {
    const cnt = counts[k];
    if (!best || cnt > best.count || (cnt === best.count && k < best.categoryId)) {
      const cat = resolveCategory ? resolveCategory(k) : { name: k, emoji: '' };
      best = Object.assign(
        { categoryId: k, name: cat.name || '其他', count: cnt },
        pickCategoryVisual(cat)
      );
    }
  });
  return best;
}

/**
 * 最常消费月份：按所有计入账本记录（含收入）的笔数；
 * 同笔数取月份最小（确定性）。
 * @returns {{month:number,count:number}|null}
 */
function findMostActiveMonth(bills) {
  const counts = new Array(12).fill(0);
  (bills || []).forEach((b) => {
    if (!month.inLedger(b)) return;
    const mi = new Date(b.occurredAt).getMonth();
    if (mi >= 0 && mi < 12) counts[mi] += 1;
  });
  let best = null;
  for (let i = 0; i < 12; i++) {
    if (counts[i] <= 0) continue;
    if (!best || counts[i] > best.count) best = { month: i + 1, count: counts[i] };
  }
  return best;
}

module.exports = {
  computeYearOverview,
  computeMonthlyTrend,
  computeYearCategoryRanking,
  computeExpenseExtremes,
  findLargestExpense: month.findLargestExpense,
  findMostRecordedCategory,
  findMostActiveMonth,
};
