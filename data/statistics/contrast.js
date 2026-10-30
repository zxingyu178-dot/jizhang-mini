// data/statistics/contrast.js
// 圆环分类色的 WCAG 对比度纯函数：HSL/HEX 转换、相对亮度、对比度，以及全色相最差值。
// 不依赖 wx / 主题状态。
//
// v1.3.4 背景口径修正（Review Fix）：
//   圆环实际绘制在 statistics-panel 的 .glass-card 上，而不是直接画在页面背景上。
//   glass-card 用半透明白色渐变叠加在页面背景上，因此真实背景是「页面背景 + 半透明白」
//   的合成色。深色主题下圆环本身比背景亮，卡片叠白变亮反而会降低对比度，
//   旧口径只对页面 --bg 取色会高估对比度。这里对每个主题枚举页面背景 + 卡片渐变两端
//   共三个候选背景，取全色相在所有候选背景上的全局最差值。
//
// 背景常量（PAGE_BG / CARD_WHITE_ALPHA）必须与 app.wxss 的 --bg / --card-bg 保持一致，
// 由 release-check 静态比对防护；改 app.wxss 背景时必须同步这里。

const donut = require('./donut');

/** WCAG 非文本对比度门槛（图形 / 图形化对象的最低对比度 3:1）。 */
const MIN_NON_TEXT_RATIO = 3.0;

/** 页面背景（须与 app.wxss 的 --bg 一致）。 */
const PAGE_BG = { dark: '#05060a', light: '#f3f4fa' };

/**
 * 玻璃卡片渐变两端叠加白色的 alpha（须与 app.wxss 的 --card-bg 一致）。
 * 深色：rgba(255,255,255,0.09) → rgba(255,255,255,0.03)；
 * 浅色：rgba(255,255,255,0.88) → rgba(255,255,255,0.62)。
 */
const CARD_WHITE_ALPHA = {
  dark: { start: 0.09, end: 0.03 },
  light: { start: 0.88, end: 0.62 },
};

/* ---------------- 颜色转换 ---------------- */

function hslToRgb(h, s, l) {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp >= 0 && hp < 1) { r1 = c; g1 = x; b1 = 0; }
  else if (hp < 2) { r1 = x; g1 = c; b1 = 0; }
  else if (hp < 3) { r1 = 0; g1 = c; b1 = x; }
  else if (hp < 4) { r1 = 0; g1 = x; b1 = c; }
  else if (hp < 5) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  const m = lig - c / 2;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/* ---------------- WCAG 相对亮度 / 对比度 ---------------- */

function linearize(channel) {
  const cs = channel / 255;
  return cs <= 0.03928
    ? cs / 12.92
    : Math.pow((cs + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb;
  return (
    0.2126 * linearize(r) +
    0.7152 * linearize(g) +
    0.0722 * linearize(b)
  );
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/* ---------------- 玻璃卡片背景合成 ---------------- */

/** 半透明白（alpha）叠加在 base 背景上的合成 RGB。 */
function overlayWhite(base, alpha) {
  return base.map((v) => v * (1 - alpha) + 255 * alpha);
}

/**
 * 某主题的全部候选背景：页面背景 + 玻璃卡片渐变两端合成色。
 * @returns {Array<{label:string, rgb:number[]}>}
 */
function candidateBackgrounds(theme) {
  const page = hexToRgb(PAGE_BG[theme]);
  const alpha = CARD_WHITE_ALPHA[theme];
  return [
    { label: 'page', rgb: page },
    { label: 'card-start', rgb: overlayWhite(page, alpha.start).map(Math.round) },
    { label: 'card-end', rgb: overlayWhite(page, alpha.end).map(Math.round) },
  ];
}

/**
 * 圆环在某主题下全色相、跨全部候选背景的最差对比度。
 * 未知主题安全回退到 donut.DEFAULT_THEME。
 * @param {string} [themeInput] 'dark' | 'light'
 * @returns {{theme:string,light:number,min:number,minHue:number,minBg:string}}
 */
function worstDonutContrast(themeInput) {
  const theme = Object.prototype.hasOwnProperty.call(donut.LIGHT_BY_THEME, themeInput)
    ? themeInput
    : donut.DEFAULT_THEME;
  const light = donut.LIGHT_BY_THEME[theme];
  const bgs = candidateBackgrounds(theme);

  let min = Infinity;
  let minHue = -1;
  let minBg = '';
  for (let h = 0; h < 360; h++) {
    const fg = hslToRgb(h, donut.COLOR_SATURATION, light);
    bgs.forEach((bg) => {
      const r = contrastRatio(fg, bg.rgb);
      if (r < min) {
        min = r;
        minHue = h;
        minBg = bg.label;
      }
    });
  }
  return { theme, light, min, minHue, minBg };
}

/**
 * 两主题圆环对比度总判定。
 * @returns {{ok:boolean, threshold:number, results:Array}}
 */
function auditDonutContrast() {
  const results = ['dark', 'light'].map(worstDonutContrast);
  return {
    ok: results.every((r) => r.min >= MIN_NON_TEXT_RATIO),
    threshold: MIN_NON_TEXT_RATIO,
    results,
  };
}

module.exports = {
  PAGE_BG,
  CARD_WHITE_ALPHA,
  MIN_NON_TEXT_RATIO,
  hslToRgb,
  hexToRgb,
  relativeLuminance,
  linearize,
  contrastRatio,
  overlayWhite,
  candidateBackgrounds,
  worstDonutContrast,
  auditDonutContrast,
};
