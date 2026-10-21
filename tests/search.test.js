/**
 * tests/search.test.js — v1.1.0 Gate 1 搜索纯函数单元测试
 *
 * 验证：
 *   - keyword 匹配商户 / 名称 / 备注 / 分类名 / 分类 id / 金额；
 *   - 金额精确可搜索（28 → ¥28.00、28.5 → ¥28.50），不做模糊数学；
 *   - type / category / date range 过滤，全部 AND；
 *   - daily-value-only 不进普通搜索；
 *   - 结果按日期降序、groupSearchResults 分组；
 *   - buildSearchQuery 规范化松散输入。
 *
 * 运行：node tests/search.test.js
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
  assert(actual === expected, msg + ' (expected=' + expected + ', actual=' + actual);
}
function ids(arr) {
  return arr.map((b) => b.id).sort().join(',');
}

const search = require('../data/search/index');

function ts(y, m, d, hh, mm, ss) {
  return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0).getTime();
}

const bills = [
  { id: 'b1', type: 'expense', amountCents: 2800, categoryId: 'c-food', merchant: '星巴克', note: '咖啡', occurredAt: ts(2026, 10, 1, 10, 0) },
  { id: 'b2', type: 'expense', amountCents: 2850, categoryId: 'c-food', merchant: '便利店', note: '', occurredAt: ts(2026, 10, 2, 12, 0) },
  { id: 'b3', type: 'income', amountCents: 10000, categoryId: 'c-salary', merchant: '公司', note: '工资', occurredAt: ts(2026, 10, 5, 9, 0) },
  { id: 'b4', type: 'expense', amountCents: 5000, categoryId: 'c-traffic', merchant: '滴滴', note: '打车回家', occurredAt: ts(2026, 9, 15, 18, 0) },
  { id: 'b5', type: 'expense', amountCents: 100, categoryId: 'c-food', title: '日价物品', ledgerImpact: 'daily-value-only', occurredAt: ts(2026, 10, 3, 10, 0) },
];
const catMap = {
  'c-food': { id: 'c-food', name: '餐饮', emoji: '🍜' },
  'c-salary': { id: 'c-salary', name: '工资', emoji: '💰' },
  'c-traffic': { id: 'c-traffic', name: '交通', emoji: '🚗' },
};
const resolver = (id) => catMap[id] || null;

function run(q) {
  return search.searchBills(bills, q, resolver);
}

/* ---------- A. keyword 文本字段 ---------- */
eq(ids(run({ keyword: '星巴克' })), 'b1', '关键词匹配商户');
eq(ids(run({ keyword: '咖啡' })), 'b1', '关键词匹配备注');
eq(ids(run({ keyword: '打车回家' })), 'b4', '关键词匹配长备注');
eq(ids(run({ keyword: '餐饮' })), 'b1,b2', '关键词匹配分类名（daily-value-only 排除）');
eq(ids(run({ keyword: 'c-food' })), 'b1,b2', '关键词匹配分类 id');

/* ---------- B. 金额精确可搜索 ---------- */
eq(ids(run({ keyword: '28' })), 'b1,b2', '关键词 28 匹配 ¥28.00 / ¥28.50');
eq(ids(run({ keyword: '28.5' })), 'b2', '关键词 28.5 只匹配 ¥28.50');
eq(ids(run({ keyword: '28.00' })), 'b1', '关键词 28.00 匹配 ¥28.00');
eq(ids(run({ keyword: '100' })), 'b3', '金额 100 不匹配 ¥1.00（daily-value-only 已排除），匹配 ¥100.00 工资');

/* ---------- C. type / category ---------- */
eq(ids(run({ type: 'expense' })), 'b1,b2,b4', 'type=expense 过滤');
eq(ids(run({ type: 'income' })), 'b3', 'type=income 过滤');
eq(ids(run({ type: 'all' })), 'b1,b2,b3,b4', 'type=all 全部（daily-value-only 排除）');
eq(ids(run({ categoryId: 'c-food' })), 'b1,b2', 'category 过滤');
eq(ids(run({ categoryId: 'c-traffic' })), 'b4', 'category 交通过滤');

/* ---------- D. date range ---------- */
eq(
  ids(run({ dateFrom: ts(2026, 9, 1), dateTo: ts(2026, 9, 30, 23, 59) })),
  'b4',
  'date range 限定 9 月'
);
eq(ids(run({ dateFrom: ts(2026, 10, 2) })), 'b2,b3', 'dateFrom 含端点（daily-value-only b5 排除）');
eq(ids(run({ dateTo: ts(2026, 10, 1, 23, 59) })), 'b1,b4', 'dateTo 只设上限（含端点），9 月 b4 也在范围内');

/* ---------- E. 全部 AND 组合 ---------- */
eq(
  ids(run({ keyword: '咖啡', type: 'expense', categoryId: 'c-food', dateFrom: ts(2026, 1, 1) })),
  'b1',
  '组合条件 AND 同时满足'
);
eq(ids(run({ keyword: '咖啡', type: 'income' })), '', '组合条件冲突（咖啡但收入）→ 空');

/* ---------- F. 排序降序 ---------- */
const ordered = run({ type: 'all' }).map((b) => b.id);
eq(ordered.join(','), 'b3,b2,b1,b4', '结果按 occurredAt 降序（b4 为 9 月在最后）');

/* ---------- G. groupSearchResults ---------- */
const groups = search.groupSearchResults(run({ keyword: '28' }), resolver);
eq(groups.length, 2, '两笔金额 28 分布在两天 → 2 个分组');
eq(groups[0].label, '10月2日', '分组1 标签（降序，2 日在前）');
eq(groups[0].records[0].amountText, '-28.50', '分组1 金额文本');
eq(groups[1].records[0].amountText, '-28.00', '分组2 金额文本');
eq(groups[0].records[0].name, '便利店', '分组记录 name 取商户');
eq(groups[0].records[0].isExpense, true, '支出标记');

/* ---------- H. buildSearchQuery 规范化 ---------- */
const q1 = search.buildSearchQuery({ keyword: '  咖啡  ', type: 'weird', categoryId: 'all', dateFrom: 'x' });
eq(q1.keyword, '咖啡', '规范化 keyword 去空格');
eq(q1.type, 'all', '非法 type 回退 all');
eq(q1.dateFrom, null, '非法 dateFrom 回退 null');
eq(q1.categoryId, 'all', 'categoryId=all 保留');
const q2 = search.buildSearchQuery({ categoryId: 'c-food', type: 'income' });
eq(q2.categoryId, 'c-food', 'categoryId 保留');
eq(q2.type, 'income', 'type=income 保留');

/* ---------- I. hasAnyFilter / isEmptyQuery ---------- */
eq(search.hasAnyFilter(search.buildSearchQuery({})), false, '无任何条件');
eq(search.hasAnyFilter(search.buildSearchQuery({ type: 'expense' })), true, '有 type 条件');
eq(search.isEmptyQuery(search.buildSearchQuery({ keyword: '' })), true, '空 keyword 视为空查询');

/* ---------- J. Gate 3 时间范围纯函数 monthRange / yearRange ---------- */
const oct = search.monthRange('2026-10');
eq(oct.dateFrom, ts(2026, 10, 1, 0, 0), 'monthRange 10 月起点');
eq(oct.dateTo, ts(2026, 10, 31, 23, 59, 59), 'monthRange 10 月终点（含 31 日 23:59:59）');
const feb = search.monthRange('2026-02'); // 2026 非闰年
eq(feb.dateTo, ts(2026, 2, 28, 23, 59, 59), 'monthRange 2 月（非闰年 28 天）');
const febLeap = search.monthRange('2024-02'); // 2024 闰年
eq(febLeap.dateTo, ts(2024, 2, 29, 23, 59, 59), 'monthRange 2 月（闰年 29 天）');
eq(search.monthRange('2026-13'), null, 'monthRange 月份 13 非法');
eq(search.monthRange('2026-1'), null, 'monthRange 月份未补零非法');
eq(search.monthRange('abc'), null, 'monthRange 非日期字符串非法');
eq(search.monthRange(null), null, 'monthRange null 非法');
const yr = search.yearRange('2026');
eq(yr.dateFrom, ts(2026, 1, 1, 0, 0), 'yearRange 起点');
eq(yr.dateTo, ts(2026, 12, 31, 23, 59, 59), 'yearRange 终点');
eq(search.yearRange('abc'), null, 'yearRange 非数字非法');
eq(search.yearRange('1800'), null, 'yearRange 年份过小非法');
eq(search.yearRange(null), null, 'yearRange null 非法');

/* ---------- K. Gate 3 buildSearchQuery 钻取参数 ---------- */
const dMonth = search.buildSearchQuery({ month: '2026-10', category: 'c-food', type: 'expense' });
eq(dMonth.type, 'expense', '月度钻取 type 透传');
eq(dMonth.categoryId, 'c-food', '月度钻取 category(URL) → categoryId');
eq(dMonth.dateFrom, ts(2026, 10, 1, 0, 0), '月度钻取 dateFrom 换算');
eq(dMonth.dateTo, ts(2026, 10, 31, 23, 59, 59), '月度钻取 dateTo 换算');
const dYear = search.buildSearchQuery({ year: '2026', category: 'c-shopping', type: 'expense' });
eq(dYear.dateFrom, ts(2026, 1, 1, 0, 0), '年度钻取 dateFrom 换算');
eq(dYear.dateTo, ts(2026, 12, 31, 23, 59, 59), '年度钻取 dateTo 换算');
eq(dYear.categoryId, 'c-shopping', '年度钻取 categoryId');
const dBad = search.buildSearchQuery({ month: 'bad', category: 'c-food' });
eq(dBad.dateFrom, null, '非法 month 不设置 range');
eq(dBad.categoryId, 'c-food', '非法 month 仍保留 categoryId');
const dExplicit = search.buildSearchQuery({ month: '2026-10', dateFrom: 1, dateTo: 2 });
eq(dExplicit.dateFrom, 1, '显式 dateFrom/dateTo 不被 month 覆盖');

/* ---------- L. Gate 3 钻取 query 与 searchBills 组合 ---------- */
eq(
  ids(search.searchBills(bills, search.buildSearchQuery({ month: '2026-10', category: 'c-food', type: 'expense' }), resolver)),
  'b1,b2',
  '月度+分类+支出钻取 → 该月该分类支出（daily-value-only b5 排除）'
);
eq(
  ids(search.searchBills(bills, search.buildSearchQuery({ year: '2026', category: 'c-traffic', type: 'expense' }), resolver)),
  'b4',
  '年度+交通+支出钻取 → 全年交通 b4'
);
eq(
  ids(search.searchBills(bills, search.buildSearchQuery({ month: '2026-09' }), resolver)),
  'b4',
  '仅月度钻取（点年度月柱）→ 该月全部账单'
);

/* ---------- 汇总 ---------- */
console.log('search tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) {
  process.exit(1);
}
console.log('ALL SEARCH TESTS PASSED');
