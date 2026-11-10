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
 * 累计趋势的 X 轴日期标签：首日 / 中间日 / 末日（点太少则自动减少）。
 * 格式 M/DD（如 11/01、9/05），月份不补零（窄屏更省宽），日补两位。
 * @param {Array<{day:number, label?:string}>} points
 * @param {number} month 1-12；非法时退回点名自带的 label（如 '3日'）
 * @returns {Array<{index:number, label:string, ratio:number}>} ratio：0~1，绘图区横向位置
 */
function pickDateLabels(points, month) {
  const list = Array.isArray(points) ? points : [];
  const n = list.length;
  if (n <= 0) return [];
  const m = Number(month);
  const useMonth = Number.isFinite(m) && m >= 1 && m <= 12;
  const fmt = (p) => {
    const day = p && p.day != null ? Number(p.day) : 0;
    if (!useMonth || !Number.isFinite(day) || day <= 0) {
      return p && p.label != null ? String(p.label) : '';
    }
    return m + '/' + (day < 10 ? '0' + day : String(day));
  };
  let idxs;
  if (n === 1) idxs = [0];
  else if (n === 2) idxs = [0, 1];
  else idxs = [0, Math.floor((n - 1) / 2), n - 1];
  const seen = {};
  return idxs
    .filter((i) => {
      if (seen[i]) return false;
      seen[i] = true;
      return true;
    })
    .map((i) => ({
      index: i,
      label: fmt(list[i]),
      ratio: n === 1 ? 0.5 : i / (n - 1),
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
