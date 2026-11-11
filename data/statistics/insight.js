// data/statistics/insight.js
// 统计图表「结论行」纯计算（B-2 第一批，不升版本号）。
//
// 定位：v1.4.4 解决了「图表看不清」，本模块解决「图表看不快」——
//   把已经算好的数组（每日 / 累计 / 12 个月 / 分类占比）压成一句话结论，
//   由 statistics-panel 直接渲染在图标题下方。**不重算账本、不改统计口径**。
//
// 三条硬约束：
//   1) 纯函数：不 require('wx')、不读 storage、不碰 DOM / 主题；可在 Node 里单测。
//   2) 非法入参（null / undefined / 非数组 / 非数字 / 负数）→ 返回 '' 或安全默认值，
//      **绝不抛异常，绝不产出 NaN / undefined / Infinity / -0**。
//   3) 金额口径：结论行一律「整数元 + 千分位」（¥1,234）。⛔ 不用 formatAxisAmount
//      （那是坐标轴缩略，会变 '1.2万'），⛔ 不用 money.formatCents（带 2 位小数，太长）。
//
// 长度口径：结论行要单行显示在手机窄屏上，中文/¥ 按 1 字宽、数字按 0.5 字宽估算，
//   总宽超过 maxUnits(22) 时截断并补 '…'（与坐标轴 textWidthPx 同一套估宽思路）。

/** 结论行「显示宽度」上限（单位：字宽）。11px 字号 × 22 ≈ 242px，窄屏内容区约 306px，留余量。 */
const MAX_UNITS = 22;

/** 分类名最长保留字数（超出截断），避免自定义长分类名把整句挤爆 */
const MAX_NAME_CHARS = 8;

/* ==================== 基础小工具 ==================== */

/** 非负有限数才认；其余一律视为「非法」 */
function toCents(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 严格取数：只认真正的 number。⛔ 不用 Number(v) 强转——
 * Number(null) / Number('') 都是 0，会把「没数据」静默当成「花了 0 元」，
 * 在环比里表现为「少 100%」这种凭空捏造的结论。
 */
function strictNum(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
}

/** 整数千分位：1234 → '1,234'；0 → '0' */
function thousands(n) {
  const s = String(Math.round(Math.abs(n)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 分 → '¥1,234'（整数元 + 千分位）。结论行专用金额格式。
 * 0 / 负数 / 非法 → '¥0'；小数四舍五入到整数元。
 * @param {number} cents
 * @returns {string}
 */
function formatInsightYuan(cents) {
  const c = toCents(cents);
  if (c <= 0) return '¥0';
  return '¥' + thousands(c / 100);
}

/**
 * 估算显示宽度（单位 = 一个字宽）：中文 / 全角 / ¥ 记 1，其它（数字、字母、空格、半角符号）记 0.5。
 * 只用于长度自保，不参与任何金额计算。
 */
function textUnits(s) {
  const str = s == null ? '' : String(s);
  let u = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    u += code > 0x2e80 || str[i] === '¥' ? 1 : 0.5;
  }
  return u;
}

/**
 * 结论行长度自保：超过 MAX_UNITS 就截断补 '…'（宁可少说半句，也不许换行 / 被裁切）。
 * 截断点在字符边界上（中文不会被切成半个字）。
 */
function clampInsight(s) {
  const str = s == null ? '' : String(s);
  if (!str) return '';
  if (textUnits(str) <= MAX_UNITS) return str;
  const chars = Array.from(str);
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    if (textUnits(out + chars[i] + '…') > MAX_UNITS) break;
    out += chars[i];
  }
  return out ? out + '…' : '…';
}

/**
 * 峰值日标签 M/DD（与坐标轴日期标签同格式，日补两位、月不补零）。
 * 月份非法时退回 'N日'（有信息总比没有强，也不产出非法文本）。
 * @param {number} day 1-31
 * @param {number} month 1-12
 */
function dayLabel(day, month) {
  const d = Number(day);
  const m = Number(month);
  if (!Number.isFinite(d) || d < 1 || d > 31) return '';
  if (!Number.isFinite(m) || m < 1 || m > 12) return d + '日';
  return m + '/' + (d < 10 ? '0' + d : String(d));
}

/* ==================== A. 分类占比 ==================== */

/**
 * 分类占比结论。
 * 文案（严格照任务模板，不自行发明措辞）：
 *   - 占比 ≥ 30%：'餐饮 占 42%，是最大开销'
 *   - 占比 < 30%：'餐饮 占比最高，27%'（占比不高时「最大开销」语气太重）
 *   - 无数据：''
 * @param {Array<{name:string, cents:number, percent?:number}>} categories 按金额倒序的列表
 * @returns {string}
 */
function buildCategoryInsight(categories) {
  const list = Array.isArray(categories) ? categories : [];
  let top = null;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c && toCents(c.cents) > 0) { top = c; break; }
  }
  if (!top) return '';
  const cents = toCents(top.cents);
  // 百分比优先用入参（computeCategoryRanking 已经四舍五入过），缺失时按列表合计现算
  let pct = Number(top.percent);
  if (!Number.isFinite(pct)) {
    let total = 0;
    list.forEach((x) => { total += toCents(x && x.cents); });
    pct = total > 0 ? (cents / total) * 100 : 0;
  }
  pct = Math.max(0, Math.min(100, Math.round(pct)));

  let name = top.name == null ? '' : String(top.name).trim();
  if (!name) name = '其他';
  const nameChars = Array.from(name);
  if (nameChars.length > MAX_NAME_CHARS) name = nameChars.slice(0, MAX_NAME_CHARS).join('') + '…';

  if (pct >= 30) return clampInsight(name + ' 占 ' + pct + '%，是最大开销');
  return clampInsight(name + ' 占比最高，' + pct + '%');
}

/* ==================== B. 每日花费趋势 ==================== */

/**
 * 每日趋势结论。
 * 文案：
 *   - 多日有支出：'日均 ¥20 · 最高 11/08 ¥127'
 *   - 仅一日有支出：'仅 11/08 有支出 ¥127'
 *   - 全 0 / 非法入参：''
 *
 * 日均分母（denomDays）必须与 Hero「日均支出」同口径：
 *   当月 = 截至今天（含）的天数，历史月 = 整月天数。这样两处数字不会打架。
 *
 * @param {Array<{day:number, cents:number}>} dailyList 当月每日支出（含 0 值日）
 * @param {number} denomDays 日均分母天数；非法 / ≤0 时退回「有值日天数」，不会除零
 * @param {number} [month] 1-12，仅用于峰值日显示成 M/DD
 * @returns {string}
 */
function buildDailyInsight(dailyList, denomDays, month) {
  const list = Array.isArray(dailyList) ? dailyList : [];
  let total = 0;
  let activeDays = 0;
  let peakCents = 0;
  let peakDay = 0;
  list.forEach((p) => {
    const v = toCents(p && p.cents);
    if (v <= 0) return;
    total += v;
    activeDays += 1;
    if (v > peakCents) { peakCents = v; peakDay = Number(p.day); }
  });
  if (activeDays <= 0) return '';

  const when = dayLabel(peakDay, month);
  if (activeDays === 1) {
    return clampInsight('仅 ' + (when || '当日') + ' 有支出 ' + formatInsightYuan(peakCents));
  }

  const want = Number(denomDays);
  const denom = Number.isFinite(want) && want > 0 ? want : Math.max(1, activeDays);
  const avg = Math.round(total / denom);
  return clampInsight(
    '日均 ' + formatInsightYuan(avg) + ' · 最高 ' + (when || '—') + ' ' + formatInsightYuan(peakCents)
  );
}

/* ==================== C. 累计消费趋势 ==================== */

/**
 * 月末预测（仅当月用）：已花总额 ÷ 已过天数 × 当月总天数。
 *
 * ⚠️ 分母是**当月总天数**，不是 30：2 月 28 / 29 天、31 天月份都必须算对。
 * ⚠️ 除零保护：elapsedDays ≤ 0 时直接返回已花金额（不放大、不出 Infinity）；
 *    spanDays 非法时同理。已过天数超过总天数时按总天数封顶（防御性）。
 *
 * @param {number} totalCents 已花总额（分）
 * @param {number} elapsedDays 已过天数（当月 1 号 = 1，永不为 0；仍做保护）
 * @param {number} spanDays 当月总天数
 * @returns {number} 预测金额（整数分），永不返回 NaN / Infinity
 */
function forecastCumulative(totalCents, elapsedDays, spanDays) {
  const total = toCents(totalCents);
  if (total <= 0) return 0;
  const e = Number(elapsedDays);
  const s = Number(spanDays);
  if (!Number.isFinite(e) || e <= 0) return Math.round(total);
  if (!Number.isFinite(s) || s <= 0) return Math.round(total);
  const span = Math.max(1, Math.round(s));
  const elapsed = Math.min(span, Math.max(1, Math.round(e)));
  return Math.round((total * span) / elapsed);
}

/**
 * 累计趋势结论。
 * 文案：
 *   - 当月：'已花 ¥1,234 · 按当前速度月末约 ¥3,800'
 *   - 历史月：'已花 ¥1,234 · 日均 ¥41'（历史月已完整，不预测）
 *   - 无数据 / 非法：''
 * @param {{totalCents:number, elapsedDays:number, spanDays:number, isCurrentMonth:boolean}} input
 * @returns {string}
 */
function buildCumulativeInsight(input) {
  const o = input && typeof input === 'object' ? input : {};
  const total = toCents(o.totalCents);
  if (total <= 0) return '';

  if (o.isCurrentMonth === true) {
    const forecast = forecastCumulative(total, o.elapsedDays, o.spanDays);
    // 预测兜底：极端入参（已过天数非法）算出来仍是 0 时退回已花金额，绝不显示 ¥0
    const shown = forecast > 0 ? forecast : Math.round(total);
    return clampInsight('已花 ' + formatInsightYuan(total) + ' · 按当前速度月末约 ' + formatInsightYuan(shown));
  }

  const span = Number(o.spanDays);
  const elapsed = Number(o.elapsedDays);
  const denom = Number.isFinite(span) && span > 0
    ? Math.round(span)
    : (Number.isFinite(elapsed) && elapsed > 0 ? Math.round(elapsed) : 1);
  const avg = Math.round(total / denom);
  return clampInsight('已花 ' + formatInsightYuan(total) + ' · 日均 ' + formatInsightYuan(avg));
}

/* ==================== D. 12 个月支出趋势 ==================== */

/**
 * 12 个月趋势结论。
 * 文案：'月均 ¥1,234 · 最高 3 月 ¥5,999'；全 0 / 非法 → ''。
 *
 * 月均口径与年度 Hero 的 yAvg 完全一致（computeYearOverview.monthlyAvg）：
 *   月均 = 全年支出 ÷ **有支出的月份数**（不固定除以 12，也不惩罚空月）。
 *   同一屏上「月均」出现两次，口径必须一样，否则用户会看到两个不同的月均。
 *
 * @param {Array<number|{month?:number, expense?:number, cents?:number}>} monthlyList 12 个月金额
 * @returns {string}
 */
function buildMonthlyInsight(monthlyList) {
  const list = Array.isArray(monthlyList) ? monthlyList : [];
  let total = 0;
  let activeMonths = 0;
  let peakCents = 0;
  let peakMonth = 0;
  list.forEach((x, i) => {
    let v = 0;
    if (x && typeof x === 'object') v = toCents(x.expense != null ? x.expense : x.cents);
    else v = toCents(x);
    if (v <= 0) return;
    total += v;
    activeMonths += 1;
    if (v > peakCents) {
      peakCents = v;
      const m = Number(x && x.month);
      peakMonth = Number.isFinite(m) && m >= 1 && m <= 12 ? m : i + 1;
    }
  });
  if (activeMonths <= 0) return '';
  const avg = Math.round(total / activeMonths);
  return clampInsight(
    '月均 ' + formatInsightYuan(avg) + ' · 最高 ' + peakMonth + ' 月 ' + formatInsightYuan(peakCents)
  );
}

/* ==================== 同期环比（本轮只出函数，不上界面） ==================== */

/**
 * 同期环比：本月 1~N 日累计 vs 上月 1~N 日累计。
 *
 * ⚠️ 口径红线：必须比**同期**（1-10 号 对 1-10 号），
 *   ⛔ 绝不许拿本月 1-10 号去比上月整月——那样月中会假报「比上月少 50%」。
 * ⚠️ 上月同期 = 0 且本月有支出 → 返回「上月同期无支出」，⛔ 不算 +∞% 也不算 100%。
 * ⚠️ 上月同期 = 0 且本月也是 0 → 不显示（text: null）。
 *
 * @param {number} currentCents 本月 1~N 日累计（分）
 * @param {number} lastSamePeriodCents 上月 1~N 日累计（分）；N 超过上月天数时由调用方用
 *        clampPeriodDay 封顶后再求和
 * @returns {{text: string|null, dir: 'up'|'down'|null}}
 */
function buildMoMCompare(currentCents, lastSamePeriodCents) {
  const none = { text: null, dir: null };
  const cur = strictNum(currentCents);
  const last = strictNum(lastSamePeriodCents);
  if (!Number.isFinite(cur) || !Number.isFinite(last) || cur < 0 || last < 0) return none;
  if (last <= 0) {
    return cur > 0 ? { text: '上月同期无支出', dir: null } : none;
  }
  if (cur === last) return { text: '与上月同期持平', dir: null };
  // 差异不足 1% 时至少报 1%（否则会出现「比上月同期多 0%」这种自相矛盾的句子）
  const pct = Math.max(1, Math.round((Math.abs(cur - last) / last) * 100));
  if (cur > last) return { text: '比上月同期多 ' + pct + '%', dir: 'up' };
  return { text: '比上月同期少 ' + pct + '%', dir: 'down' };
}

/**
 * 上月同期取数的日期上限：本月 31 号、上月只有 30 天时，上月同期按该月最后一天封顶。
 * 否则会去求「上月 31 日的累计」，取不到 → 环比凭空变 -100%。
 *
 * @param {number} periodDay 本月已过天数（1~31）
 * @param {number} lastMonthDays 上月总天数（28~31）
 * @returns {number} 上月参与累计的最后一天（1~lastMonthDays）；非法入参 → 0（表示不比）
 */
function clampPeriodDay(periodDay, lastMonthDays) {
  const d = Number(periodDay);
  const s = Number(lastMonthDays);
  if (!Number.isFinite(d) || d < 1) return 0;
  if (!Number.isFinite(s) || s < 1) return Math.round(d); // 上月天数未知：按本月天数走，不做额外封顶
  return Math.min(Math.round(d), Math.round(s));
}

module.exports = {
  MAX_UNITS,
  MAX_NAME_CHARS,
  formatInsightYuan,
  buildDailyInsight,
  buildCumulativeInsight,
  forecastCumulative,
  buildMonthlyInsight,
  buildCategoryInsight,
  buildMoMCompare,
  clampPeriodDay,
};
