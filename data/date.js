/**
 * data/date.js — 共享本地日期工具（v1.1.1）
 *
 * 统一 Bill Explorer、自定义日期搜索、自定义日期统计、统计钻取的日期口径：
 *   - startOfLocalDay / endOfLocalDay：结束边界用「下一天 00:00 - 1ms」，
 *     即 23:59:59.999，含端点，覆盖最后 999ms（导入账单可能带秒/毫秒）；
 *   - dateKeyOf：'YYYY-MM-DD' 稳定分组 key（跨年同日不合并）；
 *   - dayLabelOf：当前年省略年份，历史年显示年份；
 *   - monthRange / yearRange：复用上述函数，月底/闰年自动正确。
 * 全部基于本地时区，金额/数据层无关，纯函数、无 IO，便于单测。
 */

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 某月天数（m 为 1-12） */
function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

/**
 * 当日 00:00:00.000 时间戳（本地时区）。
 * 用法：startOfLocalDay(y, m, d)（m 为 1-12）或 startOfLocalDay(date)。
 */
function startOfLocalDay(y, m, d) {
  if (y instanceof Date) {
    return new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0, 0).getTime();
  }
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/**
 * 当日结束时间戳：下一天 00:00:00.000 - 1ms（= 23:59:59.999），含端点。
 * 用法：endOfLocalDay(y, m, d) 或 endOfLocalDay(date)。
 * 月末/闰年由 Date 自动进位，无需手工判断。
 */
function endOfLocalDay(y, m, d) {
  if (y instanceof Date) {
    return new Date(y.getFullYear(), y.getMonth(), y.getDate() + 1, 0, 0, 0, 0).getTime() - 1;
  }
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime() - 1;
}

/** 时间戳 → 'YYYY-MM-DD'（本地时区），作为分组稳定 key */
function dateKeyOf(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/**
 * 时间戳 → 分组显示标签。
 * refYear 为当前年份：同年省略年份（「10月1日」），历史年显示年份（「2025年10月1日」）。
 */
function dayLabelOf(ts, refYear) {
  const d = new Date(ts);
  const md = d.getMonth() + 1 + '月' + d.getDate() + '日';
  if (refYear != null && d.getFullYear() !== refYear) return d.getFullYear() + '年' + md;
  return md;
}

/**
 * 'YYYY-MM' → { dateFrom, dateTo }（含端点）
 * 格式非法、月份越界、年份超出 1900-9999 → null
 */
function monthRange(ym) {
  if (typeof ym !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return null;
  const parts = ym.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!y || y < 1900 || y > 9999) return null;
  return {
    dateFrom: startOfLocalDay(y, m, 1),
    dateTo: endOfLocalDay(y, m, daysInMonth(y, m)),
  };
}

/**
 * YYYY → { dateFrom, dateTo }（含端点）
 * 非法年份或超出 1900-9999 → null
 */
function yearRange(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1900 || y > 9999) return null;
  return {
    dateFrom: startOfLocalDay(y, 1, 1),
    dateTo: endOfLocalDay(y, 12, 31),
  };
}

/**
 * 描述一个时间范围的 Chip 文案（v1.1.1）。
 * 返回 { kind: 'none'|'year'|'month'|'custom', label }。
 * 全年需同年 + 1/1 + 12/31；整月需同年同月 + 首日 + 当月末日；
 * 跨年/跨月范围一律 custom（「自定义」），不冒充单年/单月。
 */
function describeRange(dateFrom, dateTo) {
  if (dateFrom == null || dateTo == null) return { kind: 'none', label: '时间' };
  const fs2 = new Date(dateFrom);
  const te = new Date(dateTo);
  const sameYear = fs2.getFullYear() === te.getFullYear();
  const isJan1 = fs2.getMonth() === 0 && fs2.getDate() === 1;
  const isDec31 = te.getMonth() === 11 && te.getDate() === 31;
  if (sameYear && isJan1 && isDec31) {
    return { kind: 'year', label: fs2.getFullYear() + '年' };
  }
  const sameMonth = sameYear && fs2.getMonth() === te.getMonth();
  const startsFirst = fs2.getDate() === 1;
  const lastDay = daysInMonth(fs2.getFullYear(), fs2.getMonth() + 1);
  const endsLast = te.getDate() === lastDay;
  if (sameMonth && startsFirst && endsLast) {
    return { kind: 'month', label: fs2.getFullYear() + '年' + (fs2.getMonth() + 1) + '月' };
  }
  return { kind: 'custom', label: '自定义' };
}

module.exports = {
  pad2,
  daysInMonth,
  startOfLocalDay,
  endOfLocalDay,
  dateKeyOf,
  dayLabelOf,
  describeRange,
  monthRange,
  yearRange,
};
