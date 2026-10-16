/**
 * data/budget/period.js — 预算周期（纯函数）
 *
 * 周期：今日 / 本周 / 本月 / 上周 / 上月。
 * 本周默认周一 → 周日（weekStartsOn=1）。
 * 全部用纯日历日期（'yyyy-MM-dd'），日差用 UTC 日编号（消 DST，与日价口径一致）。
 */
const dvCore = require('../daily-value/core');

const dayNumber = dvCore.dayNumber;

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function toStr(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
function parts(dateStr) { return String(dateStr).split('-').map(Number); }

/** 日期加 n 天 → 'yyyy-MM-dd'（UTC 计算，纯日历，不受 DST 影响） */
function addDays(dateStr, n) {
  const num = dayNumber(dateStr) + n;
  const dt = new Date(num * 86400000);
  return toStr(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** 给定日期所在周的周一（weekStartsOn=1） */
function mondayOf(dateStr) {
  const [y, m, d] = parts(dateStr);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=周日 … 6=周六
  const offset = wd === 0 ? -6 : 1 - wd;
  return addDays(dateStr, offset);
}

/** 给定日期所在周的周日起点（weekStartsOn=0） */
function sundayStartOf(dateStr) {
  const [y, m, d] = parts(dateStr);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(dateStr, -wd);
}

/** 日期所在月的第一天 */
function firstOfMonth(dateStr) {
  const [y, m] = parts(dateStr);
  return toStr(y, m, 1);
}

/** 日期所在月的下月第一天 */
function firstOfNextMonth(dateStr) {
  const [y, m] = parts(dateStr);
  return m === 12 ? toStr(y + 1, 1, 1) : toStr(y, m + 1, 1);
}

/**
 * 截至今天应计入天数（含今天）：
 *   未来周期 → 0；已结束周期 → dayCount；当前周期 → 今天在周期内第几天。
 */
function accruedDayCount(start, end, dayCount, todayStr) {
  const t = dayNumber(todayStr);
  const s = dayNumber(start);
  const e = dayNumber(end);
  if (t < s) return 0;
  if (t >= e) return dayCount;
  return t - s + 1;
}

/**
 * 构造周期。
 * @param {string} kind today | week | month | lastweek | lastmonth
 * @param {string} todayStr 本地今天 'yyyy-MM-dd'
 * @param {number} [weekStartsOn] 1（周一，默认） | 0（周日）
 */
function buildPeriod(kind, todayStr, weekStartsOn) {
  const ws = weekStartsOn === 0 ? 0 : 1;
  let start;
  let end;
  if (kind === 'today') {
    start = todayStr;
    end = addDays(todayStr, 1);
  } else if (kind === 'week') {
    start = ws === 1 ? mondayOf(todayStr) : sundayStartOf(todayStr);
    end = addDays(start, 7);
  } else if (kind === 'month') {
    start = firstOfMonth(todayStr);
    end = firstOfNextMonth(todayStr);
  } else if (kind === 'lastweek') {
    const cur = ws === 1 ? mondayOf(todayStr) : sundayStartOf(todayStr);
    start = addDays(cur, -7);
    end = cur;
  } else if (kind === 'lastmonth') {
    const cur = firstOfMonth(todayStr);
    start = firstOfMonth(addDays(cur, -1));
    end = cur;
  } else {
    throw new Error('unknown period kind: ' + kind);
  }
  const dayCount = dayNumber(end) - dayNumber(start);
  const accruedDays = accruedDayCount(start, end, dayCount, todayStr);
  return { kind, start, end, dayCount, accruedDays };
}

module.exports = {
  addDays,
  mondayOf,
  sundayStartOf,
  firstOfMonth,
  firstOfNextMonth,
  buildPeriod,
  accruedDayCount,
};
