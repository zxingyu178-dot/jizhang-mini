// data/statistics/axis.js
// 图表坐标轴纯计算（v1.4.4）：金额缩略、Y 轴刻度、X 轴标签抽稀、Y 轴留白宽度。
//
// 为什么单独一个文件：三张图（累计趋势 / 每日花费 / 12 个月）共用同一套刻度口径，
// 一旦各写一份，很容易出现「同一笔金额在 A 图叫 1.2万、在 B 图叫 12345」的不一致。
// 本文件不依赖 wx，无副作用，输入非法值一律有兜底，绝不产出 NaN / undefined / Infinity。
//
// 单位约定：入参一律「分」（与账本 amountCents 一致），出参一律「人可读的元」。

const WAN = 10000; // 元
const YI = 100000000; // 元

/** 去掉小数尾部的 0：'1.0' → '1'，'1.20' → '1.2' */
function trimZero(s) {
  if (s.indexOf('.') < 0) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/** 保留 1 位小数并去尾 0（万 / 亿档用） */
function trim1(v) {
  return trimZero(v.toFixed(1));
}

/**
 * 元 → 坐标轴可读金额（不含货币前缀）。
 * 规则（与设计口径一致，改这里等于改三张图的刻度标准）：
 *   - 0（含负数 / 非法值）→ '0'
 *   - 0 < 元 < 1         → 最多 4 位小数的有效位（如 '0.01'），
 *                          否则 0.01 元与 0 元都显示 '0'，两档刻度就分不出来了
 *   - 1 ≤ 元 < 10000      → 整数元，不带千分位（如 '3280'）
 *   - 元 ≥ 10000          → '1.2万' / '1万'（1 位小数，去掉 .0），进位到 10000万 时转 '亿'
 *   - 元 ≥ 100000000      → '1.2亿'
 * @param {number} yuan 金额（元）
 * @returns {string}
 */
function formatYuan(yuan) {
  const v = Number(yuan);
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v >= YI) return trim1(v / YI) + '亿';
  if (v >= WAN) {
    const inWan = v / WAN;
    // 9999.96万 四舍五入到 1 位 = 10000.0万 → 直接升一档显示为 1亿
    if (Math.round(inWan * 10) / 10 >= WAN) return trim1(v / YI) + '亿';
    return trim1(inWan) + '万';
  }
  if (v >= 1) return String(Math.round(v));
  // 极小金额：按有效位保留小数（最多 4 位），避免 0.005 被抹成 0
  const decimals = Math.min(4, Math.max(2, Math.ceil(-Math.log10(v)) + 1));
  const out = trimZero(v.toFixed(decimals));
  return out === '0' ? v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : out;
}

/**
 * 分 → 坐标轴可读金额字符串。
 * @param {number} cents 金额（分）
 * @param {{prefix?:string}} [opts] prefix：货币前缀（三张图只在最高档带 '¥'，减少噪声）
 * @returns {string}
 */
function formatAxisAmount(cents, opts) {
  const c = Number(cents);
  if (!Number.isFinite(c)) return '—'; // 兜底：不把 NaN / Infinity 送到界面上
  const yen = c > 0 ? c / 100 : 0;
  const body = formatYuan(yen);
  const prefix = opts && opts.prefix ? String(opts.prefix) : '';
  return prefix + body;
}

/**
 * 顶档取整候选步长（每个十倍）：1 / 1.5 / 2 / 2.5 / 3 / 4 / 5 / 6 / 8 / 10。
 *
 * 为什么不是只有 1/2/2.5/5：终端实测要求「max=127 → 顶档 150、max=5999 → 顶档 6000」，
 * 1/2/2.5/5 这套粗粒度会算成 200 / 10000（刻度离实际最大值太远，柱图被压扁一片）。
 * 加上 1.5 / 3 / 4 / 6 / 8 后，两个验收样例都能精确命中，且全部是口算得出来的整数。
 */
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/**
 * 向上取整到「好读的刻度档」（nice number）：≥ 入参、且形状为 NICE_STEPS × 10ⁿ。
 * 单位是「分」，返回值一定是整数分（货币最小单位是分，不存在 0.005 分这种刻度）。
 * @param {number} cents 实际最大值（分）
 * @returns {number} 顶档金额（分）；入参非法 / ≤0 → 0
 */
function niceCeilCents(cents) {
  const c = Number(cents);
  if (!Number.isFinite(c) || c <= 0) return 0;
  const pow = Math.pow(10, Math.floor(Math.log10(c)));
  for (let i = 0; i < NICE_STEPS.length; i++) {
    const v = NICE_STEPS[i] * pow;
    if (v >= c - 1e-9) return Math.round(v);
  }
  return Math.round(10 * pow);
}

/**
 * 生成 Y 轴刻度：0 / ½顶档 / 顶档（count=3），自底向顶。
 * 返回项的 ratio：0 = 底边（0 元），1 = 顶边（顶档）。顶档 = niceCeilCents(max) ≥ max，
 * 因此最高柱 / 折线顶点不会顶到最高刻度线（这是对的：顶线是「够用且好读」的上界）。
 *
 * 两种特殊情形：
 *   1) max ≤ 0（整月 / 整年没有支出）：只保留**底档**文字（'0'），中 / 顶网格线不画 ——
 *      文字挂在底线上，不会出现「¥0 在顶、0 值线在底」的自相矛盾画面；
 *   2) 格式化后两档撞字（极小金额被抹平）：只留高档，低档 label 置空且不画网格线，
 *      宁可少一条刻度，也不显示两条一样的数字。
 *
 * @param {number} maxCents 该图纵轴实际最大值（分）；<=0 / 非法 → 只剩底档 0
 * @param {number} [count=3] 刻度档数（2~6）
 * @param {{prefix?:string}} [opts] prefix 只加在最高档
 * @returns {Array<{key:string, ratio:number, cents:number, label:string, isTop:boolean, showGrid:boolean}>}
 */
function buildTicks(maxCents, count, opts) {
  const raw = Number(count);
  const n = Math.min(6, Math.max(2, Number.isFinite(raw) ? Math.round(raw) : 3));
  const m = Number(maxCents);
  const max = Number.isFinite(m) && m > 0 ? m : 0;
  const prefix = opts && opts.prefix ? String(opts.prefix) : '';
  const top = niceCeilCents(max);
  const ticks = [];
  for (let i = 0; i < n; i++) {
    const ratio = i / (n - 1);
    const isTop = i === n - 1;
    // 刻度值按「分」取整：货币没有半分，0.005 这种刻度读不出来也用不上
    const cents = Math.round(top * ratio);
    ticks.push({
      key: 'tick-' + i,
      ratio,
      cents,
      label: '',
      isTop,
      showGrid: false,
    });
  }

  // 空态（整月 / 整年 0 支出）：文字只挂在底线，中 / 顶网格线不画
  if (top <= 0) {
    ticks[0].label = '0';
    ticks[0].showGrid = true;
    return ticks;
  }

  // 去重（按去掉货币前缀的正文比较，自顶向下保留高档）
  const seen = {};
  for (let i = ticks.length - 1; i >= 0; i--) {
    const body = formatAxisAmount(ticks[i].cents);
    if (seen[body]) {
      ticks[i].label = '';
      ticks[i].showGrid = false;
    } else {
      seen[body] = true;
      ticks[i].label = (ticks[i].isTop ? prefix : '') + body;
      ticks[i].showGrid = true;
    }
  }
  return ticks;
}

/**
 * X 轴标签瘦身：'1月' → '1'、'12日' → '12'，只吃掉尾部的单位字，不改变量级。
 * 窄屏优先「缩格式」而不是「缩字号」——字号低于 10px 用户就真看不清了。
 * @param {string} label
 * @returns {string}
 */
function shortAxisLabel(label) {
  const s = label == null ? '' : String(label);
  if (!s) return s;
  return s.replace(/[月日号]$/, '');
}

/**
 * 单条标签的估算宽度（px）。数字 / 小数点按 0.58 字宽，中文与 ¥ 按 1 字宽。
 * @param {string} text
 * @param {number} fontPx
 * @returns {number}
 */
function textWidthPx(text, fontPx) {
  const s = text == null ? '' : String(text);
  const fs = Number(fontPx) > 0 ? Number(fontPx) : 10;
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const fullWidth = code > 0x2e80; // 中文 / 全角标点
    w += fullWidth || s[i] === '¥' ? fs : fs * 0.58;
  }
  return w;
}

/**
 * Y 轴留白列宽度（px）：宽度按最高档刻度文字的实际长度算，不写死。
 * 下限 22px（至少放得下 '0'），上限 56px（再宽就把绘图区挤没了）。
 * @param {string} topLabel 最高档刻度文字（带 ¥）
 * @param {number} fontPx 刻度字号
 * @returns {number}
 */
function axisGutterPx(topLabel, fontPx) {
  const text = textWidthPx(topLabel, fontPx);
  return Math.round(Math.min(56, Math.max(22, text + 8)));
}

/**
 * X 轴标签抽稀：按可用宽度算步长，保证标签之间不重叠。
 * 算法：先算「一条标签最小占多宽」，得出最多能放几条，再在首末之间等距取点。
 * 因此首日与末日一定有标签（图表两端需要有参照），中间按宽度取。
 *
 * @param {Array<{label?:string}>} points 数据点（用 label 长度估算宽度）
 * @param {number} maxCount 最多显示几条（业务上限，比如 7）
 * @param {number} plotW 绘图区宽度（px）
 * @param {number} charWidth 单字符宽度（px，取刻度字号 ×0.58 左右）
 * @returns {number[]} 需要显示的索引（升序、去重）
 */
function pickXLabels(points, maxCount, plotW, charWidth) {
  const list = Array.isArray(points) ? points : [];
  const n = list.length;
  if (n <= 0) return [];
  if (n === 1) return [0];
  const capRaw = Number(maxCount);
  const cap = Math.min(n, Math.max(2, Number.isFinite(capRaw) ? Math.round(capRaw) : 6));
  const w = Number(plotW) > 0 ? Number(plotW) : 300;
  const cw = Number(charWidth) > 0 ? Number(charWidth) : 5.8;
  let chars = 1;
  for (let i = 0; i < n; i++) {
    const s = list[i] && list[i].label != null ? String(list[i].label) : '';
    if (s.length > chars) chars = s.length;
  }
  // 标签本身宽度 + 左右各留半个字，作为「一条标签的占位」
  const needW = chars * cw + cw;
  const byWidth = Math.max(1, Math.floor(w / needW));
  const limit = Math.min(cap, byWidth, n);
  if (limit >= n) {
    const all = [];
    for (let i = 0; i < n; i++) all.push(i);
    return all;
  }
  if (limit <= 1) return [0];
  const step = (n - 1) / (limit - 1);
  const out = [];
  for (let k = 0; k < limit; k++) {
    const idx = Math.round(k * step);
    if (out.length === 0 || out[out.length - 1] !== idx) out.push(idx);
  }
  return out;
}

/**
 * 累计趋势的 X 轴日期标签：按「实际绘图宽度」自适应定档（v1.4.4）。
 *
 * 为什么不能只按「点数」定档：累计折线只画到数据截止日，但横轴仍按整月跨度定位
 * （见 cumulative-trend 的 spanDays）。所以 10 号看当月时，11 个点只挤在整月宽度的
 * 左侧 1/3 —— 按点数算「每格几十像素」会严重高估可用空间，标签必然叠在一起。
 * 因此这里按**像素**算：可画长度 = plotW × (n-1)/(span-1)。
 *
 * 规则（三条硬约束，任一破坏都算错）：
 *   1) 相邻两个标签的像素间距 ≥ 一条标签的渲染宽度 + 间隙（不重叠）；
 *   2) 首点、末点必有标签：首点给「从哪天开始看」，末点 = 数据截止日（不是月末）；
 *   3) 条数有业务上限（默认 5），宽度不够就减，绝不为凑数挤成一排。
 *
 * 格式 M/DD（如 11/01、9/05）：月份不补零（窄屏省宽），日补两位。
 * ⛔ 不改 M/D —— 跨月对比时 '9/5' 与 '11/01' 位数不同，视觉上日期会「跳位」。
 *
 * @param {Array<{day:number, label?:string}>} points 已按截止日裁剪后的数据点
 * @param {number} month 1-12；非法时退回点名自带的 label（如 '3日'）
 * @param {{plotW?:number, fontPx?:number, maxCount?:number, spanDays?:number}} [opts]
 *   plotW：绘图区宽度（px）；fontPx：标签字号；maxCount：条数上限（默认 5）；
 *   spanDays：横轴总跨度天数（整月天数，缺省 = 点数）
 * @returns {Array<{index:number, label:string, ratio:number}>} ratio：0~1，绘图区横向位置
 */
function pickDateLabels(points, month, opts) {
  const list = Array.isArray(points) ? points : [];
  const n = list.length;
  if (n <= 0) return [];
  const o = opts || {};
  const m = Number(month);
  const useMonth = Number.isFinite(m) && m >= 1 && m <= 12;
  const fmt = (p) => {
    const day = p && p.day != null ? Number(p.day) : 0;
    if (!useMonth || !Number.isFinite(day) || day <= 0) {
      return p && p.label != null ? String(p.label) : '';
    }
    return m + '/' + (day < 10 ? '0' + day : String(day));
  };

  const fontPx = Number(o.fontPx) > 0 ? Number(o.fontPx) : 11;
  const plotW = Number(o.plotW) > 0 ? Number(o.plotW) : 300;
  const capRaw = Number(o.maxCount);
  const cap = Number.isFinite(capRaw) ? Math.min(8, Math.max(2, Math.round(capRaw))) : 5;
  // 横轴跨度：至少等于点数（点数超过跨度时按点数算，避免 ratio > 1）
  const spanRaw = Number(o.spanDays);
  const span = Number.isFinite(spanRaw) && spanRaw >= n ? spanRaw : n;

  const labels = list.map(fmt);
  // 一条标签的占位 = 最宽的那条（标签居中渲染，两条相邻只需各自半宽之和 ≈ 一条宽度）
  // + 一点点空隙，避免两个字贴在一起。空隙取 0.36 字宽（11px 字号 ≈ 4px）：
  // 再大就会把「11/01 11/05 11/10」这种 10 天跨度硬压成 2 个标签，反而不如原来清楚。
  let widest = 0;
  for (let i = 0; i < labels.length; i++) {
    const w = textWidthPx(labels[i], fontPx);
    if (w > widest) widest = w;
  }
  const gapPx = Math.max(3, fontPx * 0.36);
  const needW = widest + gapPx;

  const toRatio = (i) => (span > 1 ? i / (span - 1) : 0.5);
  const px = (i) => toRatio(i) * plotW; // 相对绘图区左边界
  // 实际画出来的横向长度（截止日 → 折线末端，右侧是留空）
  const drawnPx = px(n - 1) - px(0);

  const build = (limit) => {
    if (limit >= n) {
      const all = [];
      for (let i = 0; i < n; i++) all.push(i);
      return all;
    }
    if (limit <= 1) return [n - 1]; // 极端窄：只留数据截止日（信息量最大）
    const step = (n - 1) / (limit - 1);
    const out = [];
    for (let k = 0; k < limit; k++) {
      const idx = Math.round(k * step);
      if (out.length === 0 || out[out.length - 1] !== idx) out.push(idx);
    }
    if (out[out.length - 1] !== n - 1) out[out.length - 1] = n - 1; // 末点必在
    return out;
  };
  /** 真·不重叠校验：取整步长会让间距有 ±1 天抖动，必须实测像素 */
  const noOverlap = (idxs) => {
    for (let i = 1; i < idxs.length; i++) {
      if (px(idxs[i]) - px(idxs[i - 1]) < needW - 1e-6) return false;
    }
    return true;
  };

  let limit = Math.min(cap, n, Math.max(1, Math.floor(drawnPx / needW) + 1));
  let idxs = build(limit);
  // 取整抖动导致某两格贴太近 → 降一档重算（宁可少一个标签，也不叠字）
  while (limit > 2 && !noOverlap(idxs)) {
    limit -= 1;
    idxs = build(limit);
  }
  return idxs.map((i) => ({
    index: i,
    label: labels[i],
    ratio: toRatio(i),
  }));
}

module.exports = {
  WAN,
  YI,
  NICE_STEPS,
  niceCeilCents,
  shortAxisLabel,
  formatAxisAmount,
  buildTicks,
  pickXLabels,
  pickDateLabels,
  axisGutterPx,
  textWidthPx,
};
