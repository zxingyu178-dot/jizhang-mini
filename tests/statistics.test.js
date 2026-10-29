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
const R = require('../data/statistics/range');
const D = require('../data/statistics/donut');
const C = require('../data/statistics/cumulative');

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

console.log('全年分类占比（复用 computeCategoryShare，完整列表）');
{
  const s = M.computeCategoryShare(yearBills, resolveCat);
  eq(s.total, 12500, '全年占比总额 125.00');
  eq(s.segments.length, 3, '3 个分类全部显示，不截断');
  eq(s.aggregated, false, '分类 ≤8 不聚合');
  eq(s.segments[0].categoryId, 'c-food', '第 1 餐饮');
  eq(s.segments[0].percentText, '64.0', '餐饮占比 64.0%（80/125）');
  assert(Math.abs(s.segments[0].ratio - 8000 / 12500) < 1e-9, '餐饮 ratio 精确（弧长用它）');
  const sum = s.all.reduce((acc, x) => acc + x.cents, 0);
  eq(sum, 12500, '占比金额合计 = 全年支出');
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

console.log('自定义日期范围统计（Gate 4）');
{
  // 跨月范围：10月1日 ~ 10月10日，只含 10.00+20.00+5.00 = 35.00（日价单、15日收入、20日购物均排除）
  const from = new Date(2026, 9, 1, 0, 0, 0).getTime();
  const to = new Date(2026, 9, 10, 23, 59, 59).getTime();
  const s = R.computeRangeStats(yearBills, from, to);
  eq(s.expense, 3500, '范围支出 35.00');
  eq(s.income, 0, '范围内无收入');
  eq(s.balance, -3500, '范围结余 -35.00');
  eq(s.count, 3, '范围 3 笔');
  // 含端点：10月1日当天
  const s2 = R.computeRangeStats(
    oct,
    new Date(2026, 9, 1, 0, 0, 0).getTime(),
    new Date(2026, 9, 1, 23, 59, 59).getTime()
  );
  eq(s2.expense, 1000, 'dateFrom/dateTo 均含端点（1 日 10.00）');
  // 跨月范围：9月1日 ~ 10月15日，含 9月50 + 10月35 + 100收入
  const s3 = R.computeRangeStats(
    yearBills,
    new Date(2026, 8, 1, 0, 0, 0).getTime(),
    new Date(2026, 9, 15, 23, 59, 59).getTime()
  );
  eq(s3.expense, 8500, '跨月支出 50+35=85.00');
  eq(s3.income, 10000, '跨月含 15 日收入 100.00');
  // 仅起点：dateTo=null
  const s4 = R.computeRangeStats(oct, new Date(2026, 9, 10, 0, 0, 0).getTime(), null);
  eq(s4.expense, 4500, '仅起点（10 日起）→ 10 日交通 5 + 20 日购物 40 = 45.00（日价单排除）');
  // 无范围：null/null → 全部
  const s5 = R.computeRangeStats(yearBills, null, null);
  eq(s5.expense, 12500, '无范围限制 → 全年支出 125.00');
  // 空账单
  const s6 = R.computeRangeStats([], null, null);
  eq(s6.count, 0, '空账单 0 笔');
}

console.log('年度回顾三项（Gate 5）');
{
  // 最大单笔支出：normal 支出中最大 = 9月1日 餐饮 50；999 日价单/100 收入均排除
  const largest = Y.findLargestExpense(yearBills);
  assert(largest !== null, '最大单笔非 null');
  eq(largest.amountCents, 5000, '最大单笔 = 50.00（非 999 日价单）');
  eq(largest.id, sep[0].id, '最大单笔 = 9月1日那笔');
  eq(Y.findLargestExpense([]), null, '空账单最大单笔 = null');
  // 同金额取 occurredAt 最早
  const tieL = [
    bill('expense', 30, 2026, 5, 1, 'c-a'),
    bill('expense', 30, 2026, 3, 1, 'c-b'),
  ];
  eq(Y.findLargestExpense(tieL).id, tieL[1].id, '同金额取最早（3月1日）');

  // 记录最多分类：餐饮 3 笔（含 9 月 1 笔）；收入计入、日价单不计
  const tc = Y.findMostRecordedCategory(yearBills, resolveCat);
  assert(tc !== null, '记录最多分类非 null');
  eq(tc.categoryId, 'c-food', '记录最多分类 = 餐饮');
  eq(tc.count, 3, '餐饮 3 笔');
  eq(tc.name, '餐饮', '分类名解析 = 餐饮');
  eq(tc.emoji, '🍚', '分类 emoji 解析');
  eq(Y.findMostRecordedCategory([]), null, '空账单记录最多分类 = null');
  // 无 resolver：name 回退为 categoryId
  eq(
    Y.findMostRecordedCategory([bill('expense', 1, 2026, 1, 1, 'c-x')], null).name,
    'c-x',
    '无 resolver 时 name 回退 categoryId'
  );
  // 同笔数取 categoryId 字典序最小
  const tieC = [
    bill('expense', 1, 2026, 1, 1, 'c-b'),
    bill('expense', 1, 2026, 1, 2, 'c-a'),
  ];
  eq(Y.findMostRecordedCategory(tieC, null).categoryId, 'c-a', '同笔数取 categoryId 最小');

  // 视觉字段透传：带 builtin 的 resolver 必须输出 iconType/iconValue（年度回顾不回退 Emoji）
  const visualResolver = (id) => ({
    name: '餐饮',
    emoji: '🍚',
    iconType: 'builtin',
    iconValue: 'dining',
  });
  const vtc = Y.findMostRecordedCategory(
    [bill('expense', 1, 2026, 1, 1, 'c-food')],
    visualResolver
  );
  eq(vtc.iconType, 'builtin', '记录最多分类透传 iconType');
  eq(vtc.iconValue, 'dining', '记录最多分类透传 iconValue');
  eq(vtc.emoji, '🍚', '记录最多分类保留 emoji 兜底');

  // 最常消费月份：10 月 5 笔（含收入）；9 月 1 笔
  const tm = Y.findMostActiveMonth(yearBills);
  assert(tm !== null, '最常消费月份非 null');
  eq(tm.month, 10, '最常消费月份 = 10 月');
  eq(tm.count, 5, '10 月 5 笔（日价单不计）');
  eq(Y.findMostActiveMonth([]), null, '空账单最常消费月份 = null');
  // 同笔数取月份最小
  const tieM = [
    bill('expense', 1, 2026, 3, 1, 'c-a'),
    bill('expense', 1, 2026, 5, 1, 'c-a'),
  ];
  eq(Y.findMostActiveMonth(tieM).month, 3, '同笔数取月份最小（3 月）');
}

/* ===================== Statistics Core V2（v1.3.0） ===================== */
console.log('\n分类占比 computeCategoryShare');
{
  const share = M.computeCategoryShare(oct, resolveCat);
  eq(share.total, 7500, '占比总支出 75.00');
  eq(share.segments.length, 3, '3 个分类（收入与日价单不计）');
  eq(share.aggregated, false, '分类 ≤8 不聚合');
  eq(share.all.length, 3, 'all 含全部真实分类');
  // 降序：shopping 4000 / food 3000 / transport 500
  eq(share.segments[0].categoryId, 'c-shopping', '第一分类 shopping');
  eq(share.segments[0].cents, 4000, 'shopping 金额');
  // 一位小数百分比
  eq(share.segments[0].percentText, '53.3', 'shopping 占比 53.3%');
  eq(share.segments[1].percentText, '40.0', 'food 占比 40.0%');
  eq(share.segments[2].percentText, '6.7', 'transport 占比 6.7%');
  // ratio 为精确比例（圆环画图用，不四舍五入）
  assert(Math.abs(share.segments[0].ratio - 4000 / 7500) < 1e-9, 'shopping ratio 精确');
  eq(share.segments[0].aggregate, false, '真实分类 aggregate=false');
  // 空账本
  const emptyShare = M.computeCategoryShare([], resolveCat);
  eq(emptyShare.total, 0, '空账本 total=0');
  eq(emptyShare.segments.length, 0, '空账本无 segment');
  eq(emptyShare.segments.length === 0 ? '0.0' : 'x', '0.0', '空账本安全');
}

console.log('分类聚合 Top7 + 其他');
{
  const manyBills = [];
  for (let i = 1; i <= 9; i++) {
    manyBills.push(bill('expense', 10, 2026, 10, i, 'c-cat' + i));
  }
  const share = M.computeCategoryShare(manyBills, resolveCat);
  eq(share.aggregated, true, '9 分类 >8 触发聚合');
  eq(share.all.length, 9, 'all 仍含 9 个真实分类');
  eq(share.segments.length, 8, 'segments = 7 真实 + 1 聚合');
  const agg = share.segments[7];
  eq(agg.categoryId, M.AGGREGATE_OTHER_ID, '聚合项 id 为 __aggregate_other__');
  eq(agg.aggregate, true, '聚合项 aggregate=true');
  eq(agg.cents, 2000, '聚合项 = 剩余 2 分类之和 20.00');
  eq(agg.count, 2, '聚合项笔数 2');
  eq(agg.percentText, '22.2', '聚合项占比 22.2%');
  assert(Math.abs(agg.ratio - 2000 / 9000) < 1e-9, '聚合 ratio 精确');
}

console.log('最高消费日 / 日均 / 最大单笔');
{
  // 最高消费日：oct 中 day20 shopping 4000
  const td = M.findTopExpenseDay(oct, 2026, 10);
  eq(td.day, 20, '最高消费日 = 20 日');
  eq(td.cents, 4000, '最高消费日金额 40.00');
  eq(M.findTopExpenseDay([], 2026, 10), null, '空账单无最高消费日');

  // 日均支出：历史月按整月 31 天
  const histAvg = M.computeDailyAverageExpense(oct, 2026, 10);
  eq(histAvg, Math.round(7500 / 31), '历史月日均（整月 31 天）');
  // 当前月：today=2026-10-20，分母 20
  const today = new Date(2026, 9, 20);
  const curAvg = M.computeDailyAverageExpense(oct, 2026, 10, today);
  eq(curAvg, Math.round(7500 / 20), '当前月日均（截至今天 20 天）');
  eq(curAvg, 375, '当前月日均 = 375 分');

  // 最大单笔：日价单 999 不计，最大为 shopping 4000
  const largest = M.findLargestExpense(oct);
  eq(largest.id, oct[4].id, '最大单笔 = day20 shopping');
  eq(M.findLargestExpense([]), null, '空账单无最大单笔');

  // 非法 / 缺失年月：不得抛 RangeError（回归 T12：new Array(NaN)）
  eq(M.findTopExpenseDay(oct, undefined, 10), null, '缺年时最高消费日安全返回 null');
  eq(M.findTopExpenseDay(oct, 2026, NaN), null, '非法月时最高消费日安全返回 null');
  eq(M.findTopExpenseDay(oct, NaN, undefined), null, '年月全缺时不抛错');
  eq(M.computeDailyAverageExpense(oct, undefined, 10), 0, '缺年时日均安全返回 0');
  eq(M.computeDailyAverageExpense(oct, 2026, NaN), 0, '非法月时日均安全返回 0');
  const badCum = M.computeCumulativeTrend(oct, undefined, 10);
  eq(badCum.points.length, 0, '非法年月累计趋势返回空点');
  eq(badCum.total, 0, '非法年月累计趋势 total=0');
  eq(badCum.max, 0, '非法年月累计趋势 max=0');
  // 兜底辅助：非法输入返回 NaN，正常输入返回正确天数
  eq(M.monthDays(2026, 10), 31, 'monthDays 正常月 31 天');
  eq(M.monthDays(2024, 2), 29, 'monthDays 闰年 2 月 29 天');
  eq(Number.isNaN(M.monthDays(undefined, 10)), true, 'monthDays 非法输入返回 NaN');
}

console.log('环形图圆弧 buildDonutArcs / buildDonutSVG');
{
  const share = M.computeCategoryShare(oct, resolveCat);
  const arcs = D.buildDonutArcs(share.segments);
  eq(arcs.length, 3, '圆弧段数 = 分类数');
  eq(arcs[0].dashOffset, 0, '第一段 dashOffset=0（从 12 点开始）');
  const expectedOffset1 = -share.segments[0].ratio * D.CIRCUMFERENCE;
  assert(Math.abs(arcs[1].dashOffset - expectedOffset1) < 1e-6, '第二段累计 dashOffset');
  // 颜色按 categoryId 稳定映射（不再按排行索引）
  const firstId = share.segments[0].categoryId;
  eq(arcs[0].color, D.getCategoryColor(firstId, new Set()).color, '第一段颜色 = 该分类稳定色');
  eq(arcs[0].color, D.resolveSegmentColors(share.segments)[0].color, '圆弧与统一颜色解析一致');
  eq(
    D.getCategoryColor(firstId, new Set()).color,
    D.getCategoryColor(firstId, new Set()).color,
    '同分类跨两次解析颜色稳定'
  );
  eq(arcs[0].aggregate, false, '真实段 aggregate=false');
  assert(Math.abs(arcs[0].ratio - share.segments[0].ratio) < 1e-9, '圆弧 ratio 透传');

  // 聚合场景：末段为聚合项
  const manyBills = [];
  for (let i = 1; i <= 9; i++) manyBills.push(bill('expense', 10, 2026, 10, i, 'c-cat' + i));
  const aggShare = M.computeCategoryShare(manyBills, resolveCat);
  const aggArcs = D.buildDonutArcs(aggShare.segments);
  eq(aggArcs.length, 8, '聚合后 8 段（7+1）');
  eq(aggArcs[7].aggregate, true, '末段为聚合项');
  eq(aggArcs[7].categoryId, M.AGGREGATE_OTHER_ID, '聚合段 categoryId');

  // buildDonutSVG 结构
  const svg = D.buildDonutSVG(share.segments, 'rgba(0,0,0,0.1)');
  eq(svg.indexOf('<svg'), 0, 'SVG 以 <svg 开头');
  eq(svg.indexOf('</svg>'), svg.length - 6, 'SVG 以 </svg> 结尾');
  eq((svg.match(/<circle/g) || []).length, 4, 'SVG 含 1 轨道 + 3 分段 circle');
  assert(svg.indexOf('rgba(0,0,0,0.1)') >= 0, 'SVG 含轨道颜色');

  // 空 segments
  eq(D.buildDonutArcs([]).length, 0, '空 segments 无圆弧');
  eq((D.buildDonutSVG([], '#track').match(/<circle/g) || []).length, 1, '空 SVG 仅轨道');
}

console.log('累计消费趋势 computeCumulativeTrend / buildCumulativeSVG');
{
  const cum = M.computeCumulativeTrend(oct, 2026, 10);
  eq(cum.points.length, 31, '10 月 31 天，每天一个累计点');
  eq(cum.total, 7500, '累计总额 = 总支出（不含收入 / daily-value-only）');
  eq(cum.max, 7500, 'max = total');
  let mono = true;
  for (let i = 1; i < cum.points.length; i++) {
    if (cum.points[i].cumCents < cum.points[i - 1].cumCents) mono = false;
  }
  assert(mono, '累计值单调不减');
  eq(cum.points[0].cumCents, 1000, '1 日累计 10.00');
  eq(cum.points[4].cumCents, 3000, '5 日累计 30.00');
  eq(cum.points[9].cumCents, 3500, '10 日累计 35.00');
  eq(cum.points[19].cumCents, 7500, '20 日累计 75.00');
  eq(cum.points[30].cumCents, 7500, '月末累计保持 75.00');

  // SVG 结构
  const svg = C.buildCumulativeSVG(cum.points, cum.max, 'rgba(255,255,255,0.12)');
  eq(svg.indexOf('<svg'), 0, '累计 SVG 以 <svg 开头');
  eq((svg.match(/<path/g) || []).length, 2, 'SVG 含面积 + 折线两个 path');
  assert(svg.indexOf(C.LINE_COLOR) >= 0, 'SVG 使用品牌线色');
  const emptySvg = C.buildCumulativeSVG([], 0, '#g');
  eq((emptySvg.match(/<path/g) || []).length, 0, '空数据无 path');
}

console.log('\nstatistics tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
