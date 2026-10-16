/**
 * data/daily-value/core.js — 日价动态计算核心（elapsed 模型，纯函数）
 *
 * 口径与 Android DailyValue（src/core/models/daily-value.ts）完全一致：
 *   elapsedDays = max(1, 今天与起算日期相差的完整日历天数)
 *   日价 = amountCents / elapsedDays
 *
 * 业务日期一律用本地 yyyy-MM-dd（禁止用 UTC toISOString，避免正时区跨天回退）；
 * 但「天数差」用 UTC 日期编号（Date.UTC(y,m-1,d)/86400000）计算，消除夏令时
 * 23/25 小时的影响。这里只是借 UTC 求日期编号，业务日期并未改成 UTC。
 *
 * Mini 金额一律整数分（amountCents），日价为派生值（允许小数），绝不持久化。
 */

const DAY_MS = 86400000;

/**
 * yyyy-MM-dd -> 稳定日历日编号（UTC，仅用于消 DST 的纯日历日差）。
 */
function dayNumber(dateStr) {
  const parts = String(dateStr).split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / DAY_MS);
}

/** 本地业务日期 yyyy-MM-dd（默认今天） */
function localDateKey(date) {
  const d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

/**
 * 距下一次本地午夜（下一天 00:00:00.000）的毫秒数。
 * 每次精确排到「下一次本地午夜」，触发后再重新调度，
 * 避免固定 24h interval 在 DST 23/25 小时日漂移。
 */
function msUntilNextLocalMidnight(from) {
  const d = from instanceof Date ? from : new Date(from == null ? Date.now() : from);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next.getTime() - d.getTime());
}

/**
 * 已使用天数（与 Android elapsedDays 完全一致）：
 *   max(1, dayNumber(today) - dayNumber(startDate))
 * 购买当天=1、昨天=1、相差 100 个日历日=100（不是 diff+1，也不是 diff 含当天）。
 */
function elapsedDays(startDate, today) {
  const t = today || localDateKey();
  const diff = dayNumber(t) - dayNumber(startDate);
  return diff < 1 ? 1 : diff;
}

/** 账单是否启用日价 */
function isDailyValueEnabled(bill) {
  return Boolean(bill && bill.dailyValue && bill.dailyValue.enabled === true);
}

/**
 * 取账单日价起算日期：优先 dailyValue.startDate，缺省回退到账单业务日期（occurredAt）。
 */
function startDateOf(bill) {
  if (bill && bill.dailyValue && bill.dailyValue.startDate) return bill.dailyValue.startDate;
  return localDateKey(new Date(bill.occurredAt));
}

/**
 * 单笔当前日价（分 / 天，浮点，每天重算，不持久化）。
 * @param {string} [today] 本地业务日期，默认今天（测试日期推进用）
 */
function dailyValueCentsOf(bill, today) {
  if (!isDailyValueEnabled(bill)) return 0;
  const days = elapsedDays(bill.dailyValue.startDate, today);
  return days > 0 ? bill.amountCents / days : 0;
}

/**
 * 全部启用日价账单的「每日总花费」（分 / 天）。
 * 两类 ledgerImpact 都参与：normal+dailyValue 与 daily-value-only 均计入。
 */
function totalDailyValueCents(bills, today) {
  return (bills || [])
    .filter(isDailyValueEnabled)
    .reduce((sum, b) => sum + dailyValueCentsOf(b, today), 0);
}

/** 启用日价的账单数量（日价 Hero「N 件物品」） */
function countDailyValueItems(bills) {
  return (bills || []).filter(isDailyValueEnabled).length;
}

module.exports = {
  DAY_MS,
  dayNumber,
  localDateKey,
  msUntilNextLocalMidnight,
  elapsedDays,
  isDailyValueEnabled,
  startDateOf,
  dailyValueCentsOf,
  totalDailyValueCents,
  countDailyValueItems,
};
