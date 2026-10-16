/**
 * tests/accounting.test.js — 记账主页展示纯函数（v0.3.2，对齐 Android）测试
 *
 * 完全虚构账单，覆盖 ACCOUNTING-01~10：
 * 单日汇总（仅支出 / 仅收入 / 两者 / 空）、今天 / 昨天标记、星期、
 * 跨月切换、下一月不超过当前月、收入 + / 支出 -、账单按时间倒序。
 * 纯函数不依赖 wx，直接 require。运行：node tests/accounting.test.js
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

const acc = require('../data/accounting');

const TODAY = '2026-10-16'; // 周五
const YEST = '2026-10-15'; // 周四

function b(id, type, cents, y, mo, d, hh, mm, cat, ledger) {
  return {
    id,
    type,
    amountCents: cents,
    categoryId: cat || 'c-food',
    merchant: '商户' + id,
    note: '备注' + id,
    occurredAt: new Date(y, mo - 1, d, hh == null ? 12 : hh, mm || 0).getTime(),
    ledgerImpact: ledger || 'normal',
  };
}
function mkGroup(day, bills) {
  const s = acc.sumDay(bills);
  return { day, label: '10月' + day + '日', income: s.income, expense: s.expense, bills };
}
const catResolver = () => ({ name: '餐饮', emoji: '🍚' });

/* ---------- ACCOUNTING-01 只有支出的一天：不显示收入 0 ---------- */
(function () {
  const bills = [b('e1', 'expense', 200, 2026, 10, 16, 9, 0), b('e2', 'expense', 1228, 2026, 10, 16, 12, 0)];
  const s = acc.sumDay(bills);
  eq(s.expense, 1428, '01 仅支出合计 14.28');
  eq(s.income, 0, '01 收入为 0');
  eq(acc.daySummaryKind(s.expense, s.income), 'expense', '01 kind=expense（不显示收入 0）');
  const tl = acc.buildTimeline('2026-10', [mkGroup(16, bills)], TODAY, YEST, catResolver);
  eq(tl[0].kind, 'expense', '01 时间线该日 kind=expense');
  eq(tl[0].dayIncomeText, '0.00', '01 收入文案为 0 但 kind 决定不渲染');
})();

/* ---------- ACCOUNTING-02 只有收入的一天：不显示支出 0 ---------- */
(function () {
  const bills = [b('i1', 'income', 5, 2026, 10, 10, 9, 0)];
  const s = acc.sumDay(bills);
  eq(s.income, 5, '02 收入 0.05');
  eq(s.expense, 0, '02 支出为 0');
  eq(acc.daySummaryKind(s.expense, s.income), 'income', '02 kind=income（不显示支出 0）');
  const tl = acc.buildTimeline('2026-10', [mkGroup(10, bills)], TODAY, YEST, catResolver);
  eq(tl[0].kind, 'income', '02 时间线该日 kind=income');
})();

/* ---------- ACCOUNTING-03 同时有收支：两者都显示 ---------- */
(function () {
  const bills = [b('e3', 'expense', 4462, 2026, 10, 12), b('i2', 'income', 20, 2026, 10, 12)];
  const s = acc.sumDay(bills);
  eq(s.expense, 4462, '03 支出 44.62');
  eq(s.income, 20, '03 收入 0.20');
  eq(acc.daySummaryKind(s.expense, s.income), 'both', '03 kind=both');
  eq(acc.daySummaryKind(0, 0), 'none', '03 空天 kind=none');
})();

/* ---------- ACCOUNTING-04 今天标记 ---------- */
(function () {
  const meta = acc.dayMeta('2026-10-16', TODAY, YEST);
  assert(meta.isToday === true, '04 今天 isToday=true');
  assert(meta.isYesterday === false, '04 今天不是昨天');
  eq(meta.m, 10, '04 月份 10');
  eq(meta.d, 16, '04 日 16');
  eq(meta.week, '五', '04 2026-10-16 周五');
})();

/* ---------- ACCOUNTING-05 昨天标记 ---------- */
(function () {
  const meta = acc.dayMeta('2026-10-15', TODAY, YEST);
  assert(meta.isYesterday === true, '05 昨天 isYesterday=true');
  assert(meta.isToday === false, '05 昨天不是今天');
  eq(meta.week, '四', '05 2026-10-15 周四');
  // 不注入 yesterday 时，由 today 自动推导
  const auto = acc.dayMeta('2026-10-15', TODAY);
  assert(auto.isYesterday === true, '05 由 today 自动推导昨天');
  // 其它日期既非今天也非昨天
  const other = acc.dayMeta('2026-10-01', TODAY, YEST);
  assert(other.isToday === false && other.isYesterday === false, '05 普通日无标记');
})();

/* ---------- ACCOUNTING-06 跨月切换：各月 summary 正确 ---------- */
(function () {
  const months = acc.buildMonthList(['2026-09', '2026-10'], '2026-10');
  eq(acc.shiftMonth(months, '2026-09', 1), '2026-10', '06 9 月 → 10 月');
  eq(acc.shiftMonth(months, '2026-10', -1), '2026-09', '06 10 月 → 9 月');
  const g9 = mkGroup(23, [b('s1', 'expense', 100, 2026, 9, 23)]);
  const g10 = mkGroup(16, [b('t1', 'expense', 200, 2026, 10, 16)]);
  const tl9 = acc.buildTimeline('2026-09', [g9], TODAY, YEST, catResolver);
  const tl10 = acc.buildTimeline('2026-10', [g10], TODAY, YEST, catResolver);
  eq(tl9[0].dateKey, '2026-09-23', '06 9 月 dateKey');
  eq(tl10[0].dateKey, '2026-10-16', '06 10 月 dateKey');
  eq(tl9[0].dayExpense, 100, '06 9 月支出 1.00');
  eq(tl10[0].dayExpense, 200, '06 10 月支出 2.00');
})();

/* ---------- ACCOUNTING-07 下一月不能超过当前月 ---------- */
(function () {
  const months = acc.buildMonthList(['2026-08', '2026-09'], '2026-10');
  assert(acc.canShift(months, '2026-10', 1) === false, '07 当前月不可再下月');
  assert(acc.canShift(months, '2026-09', 1) === true, '07 9 月可到 10 月');
  assert(acc.canShift(months, '2026-08', -1) === false, '07 最早月不可再上月');
  eq(acc.shiftMonth(months, '2026-10', 1), null, '07 越界下月返回 null');
  // 当前月（11 月）无账单也在列表末端，不能进入 12 月
  const months2 = acc.buildMonthList(['2026-09'], '2026-11');
  eq(acc.shiftMonth(months2, '2026-11', 1), null, '07 空当前月也不能进未来');
})();

/* ---------- ACCOUNTING-08 收入金额使用 + ---------- */
(function () {
  const disp = acc.billDisplay(b('ic', 'income', 5, 2026, 10, 10), { name: '退款', emoji: '💰' });
  eq(disp.amountText, '+0.05', '08 收入展示 +0.05');
  assert(disp.amountText.charAt(0) === '+', '08 首字符为 +');
  assert(disp.isExpense === false, '08 isExpense=false');
  const big = acc.billDisplay(b('ic2', 'income', 99999999, 2026, 10, 10), { name: '退款' });
  eq(big.amountText, '+999,999.99', '08 大额收入千分位');
})();

/* ---------- ACCOUNTING-09 支出金额使用 - ---------- */
(function () {
  const disp = acc.billDisplay(b('ec', 'expense', 3400, 2026, 10, 16), { name: '餐饮', emoji: '🍚' });
  eq(disp.amountText, '-34.00', '09 支出展示 -34.00');
  assert(disp.amountText.charAt(0) === '-', '09 首字符为 -');
  assert(disp.isExpense === true, '09 isExpense=true');
  // 名称回退：merchant 优先，其次分类名
  const noMerchant = b('ec2', 'expense', 100, 2026, 10, 16);
  noMerchant.merchant = '';
  eq(acc.billDisplay(noMerchant, { name: '餐饮' }).name, '餐饮', '09 无 merchant 用分类名');
  const noCat = b('ec3', 'expense', 100, 2026, 10, 16);
  noCat.merchant = '';
  eq(acc.billDisplay(noCat, null).name, '其他', '09 无分类回退其他');
})();

/* ---------- ACCOUNTING-10 Bill 行按 occurredAt 倒序 ---------- */
(function () {
  const bills = [
    b('a', 'expense', 100, 2026, 10, 16, 8, 0),
    b('b', 'expense', 200, 2026, 10, 16, 20, 0),
    b('c', 'expense', 300, 2026, 10, 16, 12, 0),
  ];
  const tl = acc.buildTimeline('2026-10', [mkGroup(16, bills)], TODAY, YEST, catResolver);
  const ids = tl[0].bills.map((x) => x.id).join(',');
  eq(ids, 'b,c,a', '10 同一天账单按时间倒序（20 点→12 点→8 点）');
  // 多日分组：monthGrouped 已按日倒序输出（16 在前），buildTimeline 保持该顺序
  const g15 = mkGroup(15, [b('d', 'expense', 100, 2026, 10, 15)]);
  const g16 = mkGroup(16, [b('e', 'expense', 100, 2026, 10, 16)]);
  const tl2 = acc.buildTimeline('2026-10', [g16, g15], TODAY, YEST, catResolver);
  eq(tl2[0].day, 16, '10 分组按 monthGrouped 传入的日倒序');
})();

console.log('\naccounting tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
