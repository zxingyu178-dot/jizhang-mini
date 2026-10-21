/**
 * data/search/range.js — 时间范围纯函数（v1.1.0 Gate 3）
 *
 * 把统计钻取的便捷参数（month: 'YYYY-MM' / year: YYYY）
 * 统一换算成搜索 Contract 的 dateFrom / dateTo（毫秒时间戳，含端点）。
 * 非法输入返回 null，便于调用方 fail-closed。
 */

/** 某月天数（m 为 1-12） */
function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

/**
 * 'YYYY-MM' → { dateFrom, dateTo }
 * 格式非法或月份越界 → null
 */
function monthRange(ym) {
  if (typeof ym !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return null;
  const parts = ym.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!y || y < 1900 || y > 9999) return null;
  return {
    dateFrom: new Date(y, m - 1, 1, 0, 0, 0).getTime(),
    dateTo: new Date(y, m - 1, daysInMonth(y, m), 23, 59, 59).getTime(),
  };
}

/**
 * YYYY → { dateFrom, dateTo }
 * 非法年份 → null
 */
function yearRange(y) {
  const year = Number(y);
  if (!Number.isInteger(year) || year < 1900 || year > 9999) return null;
  return {
    dateFrom: new Date(year, 0, 1, 0, 0, 0).getTime(),
    dateTo: new Date(year, 11, 31, 23, 59, 59).getTime(),
  };
}

module.exports = {
  daysInMonth,
  monthRange,
  yearRange,
};
