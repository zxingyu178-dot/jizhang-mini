/**
 * data/accounting.js — 记账主页展示纯函数（对齐 Android AccountingPage）
 *
 * 不依赖 wx / store，可在 Node 单测中直接验证：
 * - 日期元信息（星期 / 今天 / 昨天）
 * - 单日汇总（仅支出 / 仅收入 / 两者 / 无，不显示无意义的 0）
 * - 月份列表与切月（不超过当前月）
 * - 账单展示映射（支出 - / 收入 +，按时间倒序）
 * - 月度连续时间线构造
 */
const money = require('./money');

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function dateKeyOf(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function todayKey(now) {
  return dateKeyOf(now || new Date());
}

/** 由某日期 key 推前一天 */
function yesterdayKeyFrom(t) {
  const [y, m, d] = String(t).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return dateKeyOf(dt);
}

function yesterdayKey(now) {
  return yesterdayKeyFrom(todayKey(now));
}

/** 当前月份 yyyy-MM */
function currentYM(now) {
  return todayKey(now).slice(0, 7);
}

/**
 * 日期元信息
 * @param {string} dateKey yyyy-MM-dd
 * @param {string} [today] 注入今天（测试用）
 * @param {string} [yesterday] 注入昨天（测试用）
 */
function dayMeta(dateKey, today, yesterday) {
  const t = today || todayKey();
  const y = yesterday || yesterdayKeyFrom(t);
  const [yy, m, d] = String(dateKey).split('-').map(Number);
  const week = WEEK[new Date(yy, m - 1, d).getDay()];
  return { m, d, week, isToday: dateKey === t, isYesterday: dateKey === y };
}

/** 单日收支汇总（整数分，仅 ledgerImpact=normal） */
function sumDay(bills) {
  let expense = 0;
  let income = 0;
  for (const b of bills || []) {
    if (b.ledgerImpact && b.ledgerImpact !== 'normal') continue;
    if (b.type === 'income') income += b.amountCents || 0;
    else expense += b.amountCents || 0;
  }
  return { expense, income };
}

/** 单日汇总显示种类：both / expense / income / none（决定右侧文案，不显示 0） */
function daySummaryKind(expense, income) {
  const hasE = expense > 0;
  const hasI = income > 0;
  if (hasE && hasI) return 'both';
  if (hasE) return 'expense';
  if (hasI) return 'income';
  return 'none';
}

/** 月份列表：有账单的月份 + 当前月，升序去重 */
function buildMonthList(monthKeys, currentYm) {
  const set = new Set(monthKeys || []);
  if (currentYm) set.add(currentYm);
  return Array.from(set).sort();
}

/** 是否能切到 delta 月（-1 上一月 / 1 下一月） */
function canShift(monthList, activeYM, delta) {
  const i = monthList.indexOf(activeYM);
  if (i < 0) return false;
  const ni = i + delta;
  return ni >= 0 && ni < monthList.length;
}

/** 切月；不可切时返回 null（下一月不超过列表末端，即不超过当前月） */
function shiftMonth(monthList, activeYM, delta) {
  const i = monthList.indexOf(activeYM);
  if (i < 0) return null;
  const ni = i + delta;
  if (ni < 0 || ni >= monthList.length) return null;
  return monthList[ni];
}

/** 账单 → 展示对象：支出 -x / 收入 +x（不带 ¥，与 Android 列表一致） */
function billDisplay(bill, category) {
  const isExpense = bill.type !== 'income';
  const cat = category || {};
  return {
    id: bill.id,
    emoji: cat.emoji || '📦',
    name: bill.merchant || cat.name || '其他',
    note: bill.note || '',
    amountText: (isExpense ? '-' : '+') + money.formatCents(bill.amountCents),
    isExpense,
  };
}

/**
 * 构造单月连续时间线（对齐 Android tl-day 结构）
 * @param {string} ym yyyy-MM
 * @param {Array} grouped store.monthGrouped(ym) 的输出
 * @param {string} [today] 注入今天（测试用）
 * @param {string} [yesterday] 注入昨天（测试用）
 * @param {(id:string)=>object} [categoryResolver] categoryId → 分类对象
 */
function buildTimeline(ym, grouped, today, yesterday, categoryResolver) {
  const t = today || todayKey();
  const y = yesterday || yesterdayKeyFrom(t);
  return (grouped || []).map((g) => {
    const dateKey = ym + '-' + pad2(g.day);
    const meta = dayMeta(dateKey, t, y);
    const bills = g.bills
      .slice()
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .map((b) => billDisplay(b, categoryResolver ? categoryResolver(b.categoryId) : null));
    return {
      dateKey,
      day: g.day,
      month: meta.m,
      week: meta.week,
      isToday: meta.isToday,
      isYesterday: meta.isYesterday,
      dayExpense: g.expense,
      dayIncome: g.income,
      dayExpenseText: money.formatCents(g.expense),
      dayIncomeText: money.formatCents(g.income),
      kind: daySummaryKind(g.expense, g.income),
      bills,
    };
  });
}

module.exports = {
  WEEK,
  pad2,
  dateKeyOf,
  todayKey,
  yesterdayKey,
  yesterdayKeyFrom,
  currentYM,
  dayMeta,
  sumDay,
  daySummaryKind,
  buildMonthList,
  canShift,
  shiftMonth,
  billDisplay,
  buildTimeline,
};
