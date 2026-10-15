/**
 * tests/statistics.test.js — 统计纯函数（v0.3.0）测试
 *
 * 完全虚构账单，覆盖月度概览 / 每日趋势 / 分类排行 / 收支对比、
 * 年度概览 / 12 月趋势 / 全年分类 / 极值月，以及 daily-value-only 不进账、空账本。
 * 纯函数不依赖 wx，直接 require。
 * 运行：node tests/statistics.test.js
 */
let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.error('  FAIL: ' + msg);
  }
}
function eq(actual, expected, msg) {
  assert(actual === expected, msg + ' (expected=' + expected + ', actual=' + actual + ')');
}

const M = require('../data/statistics/month');
const Y = require('../data/statistics/year');

/** 虚构账单（amount 为元，内部转分） */
function bill(type, amount, y, mo, d, cat, ledger) {
  return {
    id: 'b-' + y + mo + d + '-' + cat + '-' + amount,
    type,
    amountCents: Math.round(amount * 100),
    categoryId: cat,
    occurredAt: new Date(y, mo - 1, d, 12, 0).getTime(),
    ledgerImpact: ledger || 'normal',
  };
}

const CAT_NAMES = {
  'c-food': { name: '餐饮', emoji: '🍚' },
  'c-transport': { name: '交通', emoji: '🚗' },
  'c-shopping': { name: '购物', emoji: '🛍️' },
};
function resolveCat(id) {
  return CAT_NAMES[id] || { name: '其他', emoji: '📦' };
}

/* ---------- 10 月账单 ---------- */
const oct = [
  bill('expense', 10.0, 2026, 10, 1, 'c-food'),
  bill('expense', 20.0, 2026, 10, 5, 'c-food'),
  bill('expense', 5.0, 2026, 10, 10, 'c-transport'),
  bill('income', 100.0, 2026, 10, 15, 'c-salary'),
  bill('expense', 40.0, 2026, 10, 20, 'c-shopping'),
  bill('expense', 999.0, 2026, 10, 25, 'c-shopping', 'daily-value-only'), // 不进账
];
/* ---------- 9 月账单 ---------- */
const sep = [bill('expense', 50.0, 2026, 9, 1, 'c-food')];
const yearBills = sep.concat(oct);

console.log('月度概览');
{
  const o = M.computeMonthOverview(oct);
  eq(o.expense, 7500, '10月支出 75.00（日价单不计）');
  eq(o.income, 10000, '10月收入 100.00');
  eq(o.balance, 2500, '10月结余 25.00');
  eq(o.count, 5, '10月计入 5 笔');
}

console.log('每日支出趋势');
{
  const t = M.computeDailyExpenseTrend(oct, 2026, 10);
  eq(t.points.length, 31, '10月 31 个点');
  eq(t.points[0].cents, 1000, '1日 10.00');
  eq(t.points[4].cents, 2000, '5日 20.00');
  eq(t.points[9].cents, 500, '10日 5.00');
  eq(t.points[19].cents, 4000, '20日 40.00');
  eq(t.max, 4000, '最高日 40.00');
  eq(t.points[19].percent, 100, '最高日柱 100%');
  const shown = t.points.filter((p) => p.showLabel).length;
  assert(shown <= 8 && shown >= 5, '横轴标签抽稀到 5~8 个（实际 ' + shown + '）');
  assert(t.points[0].showLabel, '首日有标签');
}

console.log('分类排行 Top5');
{
  const r = M.computeCategoryRanking(oct, resolveCat);
  eq(r.total, 7500, '排行支出总额 75.00');
  eq(r.list.length, 3, '3 个分类');
  eq(r.top.length, 3, 'Top 长度 3');
  eq(r.top[0].categoryId, 'c-shopping', '第1 购物 40.00');
  eq(r.top[0].cents, 4000, '购物 40.00');
  eq(r.top[0].percent, 53, '购物占比 53%');
  eq(r.top[0].barPercent, 100, '购物条形 100%');
  eq(r.top[1].categoryId, 'c-food', '第2 餐饮 30.00');
  eq(r.top[1].percent, 40, '餐饮占比 40%');
  eq(r.top[2].categoryId, 'c-transport', '第3 交通 5.00');
  eq(r.top[2].percent, 7, '交通占比 7%');
  eq(r.top[0].name, '购物', '分类名经 resolver 注入');
}

console.log('收支对比');
{
  const c = M.computeIncomeExpenseCompare(oct);
  eq(c.income, 10000, '对比收入 100.00');
  eq(c.expense, 7500, '对比支出 75.00');
  eq(c.incomeBar, 100, '收入条 100%');
  eq(c.expenseBar, 75, '支出条 75%');
}

console.log('年度概览');
{
  const o = Y.computeYearOverview(yearBills, 2026);
  eq(o.expense, 12500, '全年支出 125.00');
  eq(o.income, 10000, '全年收入 100.00');
  eq(o.balance, -2500, '全年结余 -25.00');
  eq(o.count, 6, '全年 6 笔');
  eq(o.activeMonths, 2, '有支出的月份为 2 个（9、10 月）');
  eq(o.monthlyAvg, 6250, '月均支出 = 125/2 = 62.50（不除以 12）');
}

console.log('月均支出口径（active months）');
{
  // 只在 1、2、3 月有支出：10 + 20 + 30 = 60 → 月均 20
  const partial = [
    bill('expense', 10, 2026, 1, 1, 'c-food'),
    bill('expense', 20, 2026, 2, 1, 'c-food'),
    bill('expense', 30, 2026, 3, 1, 'c-food'),
  ];
  const o = Y.computeYearOverview(partial, 2026);
  eq(o.expense, 6000, '有支出三月合计 60.00');
  eq(o.activeMonths, 3, 'activeMonths 3');
  eq(o.monthlyAvg, 2000, '月均 60/3 = 20.00（不除以 12）');
  // 全年无支出 → 0
  const onlyIncome = Y.computeYearOverview([bill('income', 500, 2026, 6, 1, 'c-salary')], 2026);
  eq(onlyIncome.activeMonths, 0, '仅收入年 activeMonths 0');
  eq(onlyIncome.monthlyAvg, 0, '无支出月均为 0');
}

console.log('分类明细只含支出（收入不混入）');
{
  const mix = [
    bill('expense', 12, 2026, 10, 2, 'c-other'),
    bill('income', 8, 2026, 10, 3, 'c-other'), // 同分类收入，必须排除
    bill('expense', 5, 2026, 10, 1, 'c-other'),
    bill('expense', 999, 2026, 10, 4, 'c-other', 'daily-value-only'), // 不进账
    bill('expense', 7, 2026, 10, 5, 'c-food'), // 其它分类
  ];
  const items = M.listCategoryExpenseBills(mix, 'c-other');
  eq(items.length, 2, 'c-other 明细只返回 2 笔支出（收入/日价单均排除）');
  eq(items[0].amountCents, 1200, '倒序：第1 为 10-02 的 12.00');
  eq(items[1].amountCents, 500, '倒序：第2 为 10-01 的 5.00');
  const hasIncome = items.some((b) => b.type === 'income');
  assert(!hasIncome, '明细中不含任何收入账单');
}

console.log('12 个月趋势');
{
  const t = Y.computeMonthlyTrend(yearBills, 2026);
  eq(t.points.length, 12, '12 个点');
  eq(t.points[8].expense, 5000, '9月 50.00');
  eq(t.points[9].expense, 7500, '10月 75.00');
  eq(t.max, 7500, '最高月 75.00');
  eq(t.points[9].percent, 100, '10月柱 100%');
  eq(t.points[8].percent, 67, '9月柱 67%');
  const shown = t.points.filter((p) => p.showLabel).length;
  eq(shown, 6, '隔月显示 6 个标签');
}

console.log('全年分类排行');
{
  const r = Y.computeYearCategoryRanking(yearBills, resolveCat);
  eq(r.total, 12500, '全年支出 125.00');
  eq(r.top[0].categoryId, 'c-food', '全年餐饮第1（80.00）');
  eq(r.top[0].cents, 8000, '餐饮 80.00');
  eq(r.top[1].categoryId, 'c-shopping', '购物第2（40.00）');
  eq(r.top[2].categoryId, 'c-transport', '交通第3（5.00）');
}

console.log('最高/最低消费月');
{
  const e = Y.computeExpenseExtremes(yearBills, 2026);
  eq(e.highest.month, 10, '最高 10月');
  eq(e.lowest.month, 9, '最低 9月');
}

console.log('空账本 / 无 resolver 兜底');
{
  const o = M.computeMonthOverview([]);
  eq(o.expense, 0, '空月支出 0');
  eq(o.count, 0, '空月 0 笔');
  const t = M.computeDailyExpenseTrend([], 2026, 2);
  eq(t.points.length, 28, '2月 28 天');
  eq(t.max, 0, '空趋势 max 0');
  const r = M.computeCategoryRanking([]);
  eq(r.list.length, 0, '空排行 0 条');
  // 无 resolver 时 name 回退为 id，不抛错
  const r2 = M.computeCategoryRanking([bill('expense', 1, 2026, 1, 1, 'c-food')]);
  eq(r2.list[0].name, 'c-food', '无 resolver 名称回退 id');
  // 全年无支出 → 极值为 null
  const e = Y.computeExpenseExtremes([], 2026);
  assert(e.highest === null && e.lowest === null, '无支出年极值为 null');
}

console.log('\nstatistics tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
