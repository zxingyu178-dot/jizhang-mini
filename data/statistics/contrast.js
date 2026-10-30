// data/statistics/contrast.js
// 圆环运行时颜色的 WCAG 对比度检测（v1.3.3 Gate 3）。
// theme-audit 只查硬编码颜色，无法发现运行时 HSL 与背景的对比度；本模块按 donut 的
// 饱和度 / 明度合同，遍历全色相计算与主题背景的 WCAG 对比度，给出最差值（worst）。
// 不依赖 wx，可在 Node 单测与发布门直接运行。
//
// 口径：WCAG 2.x 相对亮度 + 对比度 (L1+0.05)/(L2+0.05)；非文本图形门槛 3:1。
// 背景取页面 --bg（圆环多落在页面背景上），是相对保守的下界；更白的 surface 上对比度只会更高。
const donut = require('./donut');

/** 主题页面背景（须与 app.wxss 中 --bg 保持一致；改这里需同步核对） */
const THEME_BG = { dark: '#05060a', light: '#f3f4fa' };
/** WCAG 非文本对比度门槛 */
const MIN_NON_TEXT_RATIO = 3.0;

/** HSL（h:0..360, s/l:0..100）→ RGB 0..255 */
function hslToRgb(h, s, l) {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp >= 0 && hp < 1) { r1 = c; g1 = x; }
  else if (hp < 2) { r1 = x; g1 = c; }
  else if (hp < 3) { g1 = c; b1 = x; }
  else if (hp < 4) { g1 = x; b1 = c; }
  else if (hp < 5) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }
  const m = ln - c / 2;
  return [r1 + m, g1 + m, b1 + m].map((v) => Math.round(v * 255));
}

/** '#rrggbb' → RGB 0..255 */
function hexToRgb(hex) {
  const s = String(hex);
  return [s.slice(1, 3), s.slice(3, 5), s.slice(5, 7)].map((x) => parseInt(x, 16));
}

/** 单通道 sRGB → 线性 */
function linearize(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 相对亮度（WCAG） */
function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 两色对比度（顺序无关，结果 ≥1） */
function contrastRatio(rgbA, rgbB) {
  const lA = relativeLuminance(rgbA);
  const lB = relativeLuminance(rgbB);
  const hi = Math.max(lA, lB);
  const lo = Math.min(lA, lB);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 指定主题下圆环全色相的最差对比度。
 * 明度取 donut.LIGHT_BY_THEME（未知主题按 dark 回退，与 getCategoryColor 一致）。
 * @returns {{theme,light,min,minHue}}
 */
function worstDonutContrast(theme) {
  const key = Object.prototype.hasOwnProperty.call(donut.LIGHT_BY_THEME, theme) ? theme : donut.DEFAULT_THEME;
  const light = donut.LIGHT_BY_THEME[key];
  const bg = hexToRgb(THEME_BG[key]);
  let min = Infinity;
  let minHue = -1;
  for (let h = 0; h < 360; h++) {
    const ratio = contrastRatio(hslToRgb(h, donut.COLOR_SATURATION, light), bg);
    if (ratio < min) { min = ratio; minHue = h; }
  }
  return { theme: key, light, min, minHue };
}

/** 两主题对比度审计：返回各主题 worst 与总判定 */
function auditDonutContrast() {
  const results = ['dark', 'light'].map(worstDonutContrast);
  const ok = results.every((r) => r.min >= MIN_NON_TEXT_RATIO);
  return { ok, threshold: MIN_NON_TEXT_RATIO, results };
}

module.exports = {
  THEME_BG,
  MIN_NON_TEXT_RATIO,
  hslToRgb,
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  worstDonutContrast,
  auditDonutContrast,
};
