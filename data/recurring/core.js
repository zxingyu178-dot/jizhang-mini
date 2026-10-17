/**
 * data/recurring/core.js — 周期规则日期与规范化纯函数（v0.6.0，移植自 Android generator.ts）
 *
 * 纯逻辑、无 IO、无框架依赖，可在 Node 测试。
 *
 * 本地日历语义：
 *   全部 occurrence 日期用本地 yyyy-MM-dd 日历运算（new Date(y,m-1,d+…)），
 *   不用 UTC/toISOString 决定业务日期；月/年用日历算法（非 30*24h / 365*24h），
 *   DST 下「每天 08:00」仍保持本地 08:00。
 */

/** 单规则单次 catch-up 保护上限 */
const MAX_CATCHUP_PER_RULE = 365;
/** 确定性 Bill id 前缀 */
const RECURRING_BILL_PREFIX = 'recur';
/** 支持的频率 */
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];

/** HH:mm 合法格式（00:00 ~ 23:59） */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseDate(dateStr) {
  const parts = String(dateStr).split('-').map(Number);
  return { y: parts[0], m: parts[1], d: parts[2] };
}

function toDateStr(y, m, d) {
  return y + '-' + pad2(m) + '-' + pad2(d);
}

/** 严格 yyyy-MM-dd 形态（补零、四位年） */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 严格校验真实日历日期 yyyy-MM-dd。
 * 拒绝：非字符串、未补零（2026-1-1）、非法月日（2026-13-01、2026-02-30）、含时间。
 * 损坏的备份 / Android 规则若放行，会在 occurrenceDate 算出 NaN 日期或 2026-09-00 业务日期。
 */
function isValidDateStr(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const c = parseDate(s);
  if (![c.y, c.m, c.d].every(Number.isFinite)) return false;
  if (c.m < 1 || c.m > 12 || c.d < 1 || c.d > daysInMonth(c.y, c.m)) return false;
  // 重新规范化必须与原串一致（排除 2026-1-01 之类未补零被放过）
  return toDateStr(c.y, c.m, c.d) === s;
}

/** 日期编号（自 UTC 纪元天数；仅用于索引推导，与业务日期 / DST 无关） */
function dayNumber(dateStr) {
  const c = parseDate(dateStr);
  return Math.floor(Date.UTC(c.y, (c.m || 1) - 1, c.d || 1) / 86400000);
}

/** 本地业务日期 yyyy-MM-dd（默认今天；date 为本地时间） */
function localDateKey(date) {
  date = date || new Date();
  return (
    date.getFullYear() +
    '-' +
    pad2(date.getMonth() + 1) +
    '-' +
    pad2(date.getDate())
  );
}

/** startDate 对应的本地星期（JS getDay(): 0=周日~6=周六） */
function startDateWeekday(rule) {
  const c = parseDate(rule.startDate);
  return new Date(c.y, c.m - 1, c.d).getDay();
}

/** weekly 的 day 是否合法（JS weekday 0-6 整数）。旧版本可能写入 day=24 等非法值。 */
function isWeeklyDayInvalid(rule) {
  if (rule.frequency !== 'weekly') return false;
  const d = rule.day;
  return !(Number.isInteger(d) && d >= 0 && d <= 6);
}

/**
 * 解析 weekly 实际生效星期：非法（非 0-6 整数）回退到 startDate 对应 weekday。
 * 旧 generator 长期按「startDate 起的每 7 天」执行，此回退最接近旧行为。
 */
function resolveWeeklyDay(rule) {
  return isWeeklyDayInvalid(rule) ? startDateWeekday(rule) : rule.day;
}

/**
 * 统一规范化周期规则的周期字段（编辑器 / 历史数据 / 手动构造）。
 * 每个字段经钳制与校验，杜绝非法值生成 2026-09-00 之类业务日期。
 * 原则：不改变合法规则语义；只把非法值规范化到安全默认。返回新对象，不修改入参。
 */
function sanitizeRecurringRule(rule) {
  const out = Object.assign({}, rule);
  // interval：非有限/非整数 → 1；否则钳到 1..999
  out.interval = Number.isFinite(rule.interval)
    ? Math.min(999, Math.max(1, Math.round(rule.interval)))
    : 1;
  // enabled：非 boolean → 安全默认 false（不意外生成）
  out.enabled = typeof rule.enabled === 'boolean' ? rule.enabled : false;
  const day = Number(rule.day);
  const month = rule.month == null ? undefined : Number(rule.month);
  switch (rule.frequency) {
    case 'weekly': {
      const wd =
        Number.isInteger(day) && day >= 0 && day <= 6
          ? day
          : startDateWeekday(rule);
      out.day = Number.isInteger(wd) && wd >= 0 && wd <= 6 ? wd : 0;
      break;
    }
    case 'monthly':
      out.day = Number.isFinite(day)
        ? Math.min(31, Math.max(1, Math.round(day)))
        : 1;
      break;
    case 'yearly':
      out.month = Number.isFinite(month)
        ? Math.min(12, Math.max(1, Math.round(month)))
        : undefined;
      out.day = Number.isFinite(day)
        ? Math.min(31, Math.max(1, Math.round(day)))
        : 1;
      break;
    default: // daily：day 无意义但规范化防 NaN 入库
      out.day = Number.isFinite(day) ? Math.max(1, Math.round(day)) : 1;
  }
  // time：非法 HH:mm → 安全默认 00:00
  out.time = typeof rule.time === 'string' && HHMM_RE.test(rule.time) ? rule.time : '00:00';
  return out;
}

/**
 * 校验规则是否可安全用于生成（迁移 / 恢复 / 损坏数据的防线）。
 * 返回 { ok:true } 或 { ok:false, reason }。
 *
 * 这些是 sanitize 无法安全兜底、否则会产生 NaN 日期或异常账单的硬条件：
 *  - startDate 必须是真实 yyyy-MM-dd（occurrence 计算的基准）；
 *  - amountCents 必须为正整数（0 / 负 / NaN 金额不生成账单）；
 *  - frequency 必须受支持；interval 1..999；
 *  - weekly day 0..6（0=周日）；monthly/yearly day 1..31；yearly month 1..12。
 * time 非法不在此拒绝（sanitize 已安全兜底为 00:00）。
 */
function validateRecurringRule(rule) {
  rule = rule || {};
  if (!isValidDateStr(rule.startDate)) return { ok: false, reason: 'invalid-start-date' };
  if (
    !(
      Number.isFinite(rule.amountCents) &&
      Number.isInteger(rule.amountCents) &&
      rule.amountCents > 0
    )
  ) {
    return { ok: false, reason: 'invalid-amount' };
  }
  if (FREQUENCIES.indexOf(rule.frequency) < 0) return { ok: false, reason: 'invalid-frequency' };
  const iv = Number(rule.interval);
  if (!(Number.isInteger(iv) && iv >= 1 && iv <= 999)) {
    return { ok: false, reason: 'invalid-interval' };
  }
  if (rule.frequency === 'weekly') {
    if (isWeeklyDayInvalid(rule)) return { ok: false, reason: 'invalid-day' };
  } else if (rule.frequency === 'monthly') {
    if (!(Number.isInteger(rule.day) && rule.day >= 1 && rule.day <= 31)) {
      return { ok: false, reason: 'invalid-day' };
    }
  } else if (rule.frequency === 'yearly') {
    if (
      rule.month != null &&
      !(Number.isInteger(Number(rule.month)) && rule.month >= 1 && rule.month <= 12)
    ) {
      return { ok: false, reason: 'invalid-month' };
    }
    if (!(Number.isInteger(rule.day) && rule.day >= 1 && rule.day <= 31)) {
      return { ok: false, reason: 'invalid-day' };
    }
  }
  return { ok: true };
}

/** 当月天数（m 为 1-12） */
function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

/** 是否闰年 */
function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** 将 day 钳制到 [1, y/m 月天数]（31 → 2 月 28/29；4 月 → 30；不滚到下月） */
function clampDay(y, m, day) {
  return Math.max(1, Math.min(day, daysInMonth(y, m)));
}

/** 日历加天数（自动跨月/年；Date 本地时间语义，DST 安全） */
function addCalendarDays(dateStr, days) {
  const c = parseDate(dateStr);
  return localDateKey(new Date(c.y, c.m - 1, c.d + days));
}

/** rule 第 idx 个 occurrence 的日期 yyyy-MM-dd（0 起） */
function occurrenceDate(rule, idx) {
  const c = parseDate(rule.startDate);
  const sy = c.y;
  const sm = c.m;
  const sd = c.d;
  const interval = Math.max(1, rule.interval);
  switch (rule.frequency) {
    case 'daily':
      return addCalendarDays(rule.startDate, idx * interval);
    case 'weekly': {
      // 从 startDate 当天或之后找第一个 rule.day 作为 occurrence 0，后续每 interval*7 天。
      const startDow = new Date(sy, sm - 1, sd).getDay();
      const delta = (resolveWeeklyDay(rule) - startDow + 7) % 7;
      const first = addCalendarDays(rule.startDate, delta);
      return addCalendarDays(first, idx * interval * 7);
    }
    case 'monthly': {
      const totalMonths = sm - 1 + idx * interval;
      const y = sy + Math.floor(totalMonths / 12);
      const m = (totalMonths % 12) + 1;
      const day = clampDay(y, m, rule.day);
      return toDateStr(y, m, day);
    }
    case 'yearly': {
      const m = rule.month == null ? sm : rule.month;
      const y = sy + idx * interval;
      const day = clampDay(y, m, rule.day);
      return toDateStr(y, m, day);
    }
  }
  return rule.startDate;
}

/** occurrence 的本地时间戳（ms） */
function occurrenceTimestamp(dateStr, time) {
  const c = parseDate(dateStr);
  const parts = String(time).split(':');
  const hh = Number(parts[0]) || 0;
  const mm = Number(parts[1]) || 0;
  return new Date(c.y, c.m - 1, c.d, hh, mm, 0, 0).getTime();
}

/** 确定性 Bill id（幂等）：recur-{ruleId}-{date}-{time} */
function recurringBillId(ruleId, dateStr, time) {
  return RECURRING_BILL_PREFIX + '-' + ruleId + '-' + dateStr + '-' + time;
}

/**
 * 返回 rule 在 anchor 附近的起始索引（保证 occurrence(idx) 在 anchor 附近）：
 * 用日历量推导，避免从 startDate 起逐条线性扫（旧规则会被 365 上限截断在历史上）。
 * anchor 缺省取 lastGeneratedDate（若晚于 startDate），否则 startDate。
 */
function startIndexFor(rule, anchorDate) {
  const sc = parseDate(rule.startDate);
  const ac = parseDate(anchorDate);
  const interval = Math.max(1, rule.interval);
  switch (rule.frequency) {
    case 'daily': {
      const days = dayNumber(anchorDate) - dayNumber(rule.startDate);
      return Math.max(0, Math.floor(days / interval));
    }
    case 'weekly': {
      const first = occurrenceDate(rule, 0);
      const days = dayNumber(anchorDate) - dayNumber(first);
      return Math.max(0, Math.floor(days / (7 * interval)));
    }
    case 'monthly': {
      const totalMonths = (ac.y - sc.y) * 12 + (ac.m - sc.m);
      return Math.max(0, Math.floor(totalMonths / interval));
    }
    case 'yearly':
      return Math.max(0, Math.floor((ac.y - sc.y) / interval));
  }
  return 0;
}

/** 计算 rule 下一次 occurrence 日期（严格在当前本地时间之后）；无则 null */
function computeNextOccurrence(rule, now) {
  now = now || new Date();
  const nowMs = now.getTime();
  const today = localDateKey(now);
  const base =
    rule.lastGeneratedDate && rule.lastGeneratedDate > rule.startDate
      ? rule.lastGeneratedDate
      : rule.startDate;
  let idx = startIndexFor(rule, base);
  idx = Math.max(0, idx - 3);
  for (let i = 0; i < MAX_CATCHUP_PER_RULE + 4; i++) {
    const occDate = occurrenceDate(rule, idx + i);
    if (occDate < base) continue;
    const occMs = occurrenceTimestamp(occDate, rule.time);
    if (occMs > nowMs) return occDate;
    if (occDate > today) break;
  }
  return null;
}

module.exports = {
  MAX_CATCHUP_PER_RULE,
  RECURRING_BILL_PREFIX,
  FREQUENCIES,
  HHMM_RE,
  DATE_RE,
  pad2,
  parseDate,
  toDateStr,
  isValidDateStr,
  dayNumber,
  localDateKey,
  startDateWeekday,
  isWeeklyDayInvalid,
  resolveWeeklyDay,
  sanitizeRecurringRule,
  validateRecurringRule,
  daysInMonth,
  isLeapYear,
  clampDay,
  addCalendarDays,
  occurrenceDate,
  occurrenceTimestamp,
  recurringBillId,
  startIndexFor,
  computeNextOccurrence,
};
