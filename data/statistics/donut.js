// data/statistics/donut.js
// 分类环形图（category-donut）的纯计算：把 computeCategoryShare 的 segments
// 转成圆环圆弧参数、稳定颜色、命中检测与完整 SVG 字符串。不依赖 wx / 主题状态。
// 圆弧用 circle 的 stroke-dasharray 实现，弧长直接用 ratio（精确比例，不用四舍五入百分比）。
//
// v1.3.2 颜色合同（Interaction Reliability & Visual Polish）：
//   颜色色相只由稳定 categoryId 确定性决定（黄金角分布），不随其他分类出现 / 排名 /
//   金额变化，不再做撞色借用；明度仅随主题做可读性微调，视觉身份不变。
//   撞色靠图标 / 描边等其他视觉属性区分，绝不动态改色。颜色不写进 Category / 备份。

const RADIUS = 40;
const STROKE = 12;
const CENTER = 50;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// 环带内外半径（stroke 沿圆中心线向两侧扩展），命中检测用
const INNER_R = RADIUS - STROKE / 2; // 34
const OUTER_R = RADIUS + STROKE / 2; // 46

/** 聚合「其他」的专用中性色（独立于真实分类颜色，语义中性、两主题可读，不随主题变化） */
const AGGREGATE_COLOR = '#8D94A8';

// —— v1.4.0 Skyline SVG 颜色兼容 ——
// 实测（微信开发者工具 2.02 + Skyline + 基础库 3.17.4，证据见 docs/V1.4.0_AUDIT.md）：
//   · SVG 里出现 hsl() 颜色的 <circle> 会被**整条丢弃**（同图里 rgba 轨道环照常绘制，
//     只有 hue 分段消失 → 用户看到的是一圈灰环 + 空白）；
//   · 官方 Skyline 兼容性文档亦明确 svg「不支持 rgba 格式，可使用 fill-opacity 替代」。
// 因此：**发到 SVG 属性前统一转成确定性 #RRGGBB（+ 独立透明度属性）**。
// 对外颜色合同不变：getCategoryColor / resolveSegmentColors 仍返回 hsl，
// 图例、面板、对比度审计（npm run contrast:audit）一行都不用改。
const FALLBACK_HEX = AGGREGATE_COLOR;
const HEX6_RE = /^#([0-9a-f]{6})$/i;
const HEX3_RE = /^#([0-9a-f]{3})$/i;
const RGB_FN_RE = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/i;
const HSL_FN_RE = /^hsla?\(\s*(-?[0-9.]+)\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*(?:,\s*([0-9.]+)\s*)?\)$/i;

/** 单通道钳制到 0..255 并转两位大写十六进制 */
function hex2(v) {
  const n = Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0;
  return (n < 16 ? '0' : '') + n.toString(16).toUpperCase();
}

/**
 * HSL → #RRGGBB。与 data/statistics/contrast.js 的 hslToRgb 同一套公式，
 * 保证「圆环渲染色」和「对比度审计算出的色」是同一个颜色。
 */
function hslToHex(h, s, l) {
  const sat = s / 100;
  const lig = l / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = ((((h % 360) + 360) % 360)) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) { r1 = c; g1 = x; b1 = 0; }
  else if (hp < 2) { r1 = x; g1 = c; b1 = 0; }
  else if (hp < 3) { r1 = 0; g1 = c; b1 = x; }
  else if (hp < 4) { r1 = 0; g1 = x; b1 = c; }
  else if (hp < 5) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  const m = lig - c / 2;
  return '#' + hex2((r1 + m) * 255) + hex2((g1 + m) * 255) + hex2((b1 + m) * 255);
}

/**
 * 把任意合法 CSS 颜色（hex / rgb() / rgba() / hsl() / hsla()）解析成
 * { hex:'#RRGGBB', alpha:0..1 }；无法识别返回 null（由调用方兜底）。
 * 只做确定性转换，不做四舍五入之外的任何视觉调整。
 */
function parseSvgColor(color) {
  const s = String(color == null ? '' : color).trim();
  if (!s) return null;
  if (HEX6_RE.test(s)) return { hex: s.toUpperCase(), alpha: 1 };
  const h3 = HEX3_RE.exec(s);
  if (h3) {
    const d = h3[1];
    return { hex: ('#' + d[0] + d[0] + d[1] + d[1] + d[2] + d[2]).toUpperCase(), alpha: 1 };
  }
  const rgb = RGB_FN_RE.exec(s);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : Number(rgb[4]);
    return {
      hex: '#' + hex2(Number(rgb[1])) + hex2(Number(rgb[2])) + hex2(Number(rgb[3])),
      alpha: Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1,
    };
  }
  const hsl = HSL_FN_RE.exec(s);
  if (hsl) {
    const a = hsl[4] === undefined ? 1 : Number(hsl[4]);
    return {
      hex: hslToHex(Number(hsl[1]), Number(hsl[2]), Number(hsl[3])),
      alpha: Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1,
    };
  }
  return null;
}

/** SVG 属性用色：一律 #RRGGBB（不认识的颜色回退中性色，绝不输出 hsl()/rgba()） */
function svgColor(color) {
  const p = parseSvgColor(color);
  return p ? p.hex : FALLBACK_HEX;
}

// —— 确定性 HSL 配色参数 ——
// 黄金角：让不同 hash 的色相在色轮上均匀散开，相邻 id 颜色差异大、可辨识度高。
const GOLDEN_ANGLE = 137.50776405003785;
const COLOR_SATURATION = 62; // 百分比：中等饱和，两主题不刺眼
// 明度随主题微调（色相不变）：深色背景略提亮、浅色背景压暗，保证两边可读。
// v1.3.3：浅色明度 45 → 34，使全色相相对浅色背景的 WCAG 非文本对比度 worst≈3.25（≥3:1）。
// v1.3.4：深色明度 56 → 60。圆环实际落在比页面更亮的 glass-card（半透明白叠加）上，
//   旧口径只对页面背景取色，真实卡片最亮端 worst 仅 2.578（不达标）；提到 60 后，
//   在页面 + 卡片两端全部候选背景上 worst≈3.145（@hue240，≥3:1）。色相 / 饱和度不变。
const LIGHT_BY_THEME = { dark: 60, light: 34 };
const DEFAULT_THEME = 'dark';

/** 对字符串做确定性 32 位哈希（非加密，仅用于稳定选色），返回非负整数 */
function hashId(str) {
  const s = String(str);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 真实分类的确定性色相（0..360）：只由 categoryId 决定，跨月 / 年 / 排序完全一致 */
function categoryHue(categoryId) {
  return (hashId(categoryId) * GOLDEN_ANGLE) % 360;
}

/**
 * 真实分类确定性颜色：色相只由稳定 categoryId 决定，不依赖其他分类是否出现 / 排名 / 金额。
 * 明度仅随主题做可读性微调（同一分类两主题色相一致、视觉身份不变）。
 * 不做撞色借用：撞色时由图标 / 描边等其他视觉属性区分，绝不动态改色。
 * @param {string} categoryId 稳定分类 id
 * @param {string} [theme] 'dark' | 'light'，缺省 / 未知值按 dark 安全回退
 * @returns {string} hsl() 颜色字符串
 */
function getCategoryColor(categoryId, theme) {
  const h = Math.round(categoryHue(categoryId));
  const light = Object.prototype.hasOwnProperty.call(LIGHT_BY_THEME, theme)
    ? LIGHT_BY_THEME[theme]
    : LIGHT_BY_THEME[DEFAULT_THEME];
  return 'hsl(' + h + ', ' + COLOR_SATURATION + '%, ' + light + '%)';
}

/**
 * 分段颜色统一解析：圆环与图例都从这里取同一套颜色，只维护一套颜色逻辑。
 * 聚合段固定中性色；真实分类颜色只由其 categoryId 与主题决定。
 * @param {Array} segments
 * @param {string} [theme] 透传给 getCategoryColor
 * @returns {Array}
 */
function resolveSegmentColors(segments, theme) {
  return (segments || []).map((s) => {
    if (s.aggregate) return Object.assign({}, s, { color: AGGREGATE_COLOR });
    return Object.assign({}, s, { color: getCategoryColor(s.categoryId, theme) });
  });
}

/**
 * 计算每段圆弧的 stroke 参数（从 12 点方向顺时针），颜色走稳定映射。
 * @param {Array} segments
 * @param {string} [theme] 透传给颜色解析
 * @returns {Array<{index,categoryId,aggregate,color,dashArray,dashOffset,ratio}>}
 */
function buildDonutArcs(segments, theme) {
  const colored = resolveSegmentColors(segments, theme);
  let acc = 0;
  return colored.map((s, i) => {
    // 防脏数据：NaN / Infinity / 负数 / 超 1 的 ratio 一律安全归零或钳制，
    // 绝不让 NaN 进 dasharray（SVG 数值非法会让整条弧线消失，且很难在现场定位）。
    const raw = Number(s.ratio);
    const ratio = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 1) : 0;
    const dash = ratio * CIRCUMFERENCE;
    const rest = Math.max(0, CIRCUMFERENCE - dash);
    const offset = Number.isFinite(acc) ? -acc * CIRCUMFERENCE : 0; // 负 offset 沿顺时针推进到累计起点
    acc += ratio;
    return {
      index: i,
      categoryId: s.categoryId,
      aggregate: !!s.aggregate,
      ratio,
      color: s.color,
      svgColor: svgColor(s.color),
      dashArray: dash + ' ' + rest,
      dashOffset: offset,
    };
  });
}

/** 组件层：本地 px 坐标 + 容器尺寸 → SVG viewBox 坐标（0..100） */
function localToViewBox(localX, localY, rectW, rectH) {
  return {
    x: (localX / rectW) * 100,
    y: (localY / rectH) * 100,
  };
}

/**
 * 命中检测（不依赖 wx 的纯函数）：viewBox 坐标下判断点落在哪个分段。
 * 从 12 点方向顺时针、按 ratio 累计区间定位；中心孔 / 圆环外 / 间隙返回 -1。
 * 角度与 buildDonutArcs 的 rotate(-90) 绘制起点、方向严格一致。
 * @returns {number} 命中分段 index，未命中 -1
 */
function hitSegment(segments, vx, vy) {
  const dx = vx - CENTER;
  const dy = vy - CENTER;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < INNER_R || dist > OUTER_R) return -1;
  // 12 点方向顺时针角度：atan2(dx,-dy)，归一化到 0..2π
  let theta = Math.atan2(dx, -dy);
  if (theta < 0) theta += 2 * Math.PI;
  const frac = theta / (2 * Math.PI);
  let acc = 0;
  for (let i = 0; i < (segments || []).length; i++) {
    const r = segments[i].ratio > 0 ? segments[i].ratio : 0;
    if (frac >= acc && frac < acc + r) return i;
    acc += r;
  }
  return -1;
}

/**
 * 生成完整圆环 SVG（含背景轨道与各分段，支持选中态）。
 *
 * v1.4.0 Skyline 兼容约束（每条都由实测证据支撑，见 docs/V1.4.0_AUDIT.md）：
 *   1. 颜色属性一律输出 #RRGGBB（hsl() 会导致元素被丢弃）；
 *   2. 透明度走 opacity / stroke-opacity 属性，不写 rgba()；
 *   3. 根节点显式声明 width/height（svg 不支持百分比单位）+ preserveAspectRatio，
 *      不依赖宿主推断固有尺寸。
 *
 * @param {Array} segments computeCategoryShare().segments
 * @param {string|{color:string,opacity:number}} trackColor 背景轨道颜色（可写 hex/rgba/hsl，内部统一转 hex）
 * @param {number} [selectedIndex] 选中分段 index；缺省 / -1 表示无选中（全部正常）
 * @param {string} [theme] 分段颜色主题 'dark' | 'light'
 * @returns {string}
 */
function buildDonutSVG(segments, trackColor, selectedIndex, theme) {
  const arcs = buildDonutArcs(segments, theme);
  const hasSel = typeof selectedIndex === 'number' && selectedIndex >= 0;
  const track = parseSvgColor(
    trackColor && typeof trackColor === 'object' ? trackColor.color : trackColor
  ) || { hex: FALLBACK_HEX, alpha: 1 };
  const trackAlpha = trackColor && typeof trackColor === 'object' && Number.isFinite(Number(trackColor.opacity))
    ? Math.max(0, Math.min(1, Number(trackColor.opacity)))
    : track.alpha;

  let circles = '';
  arcs.forEach((a) => {
    const active = hasSel && a.index === selectedIndex;
    const opacity = hasSel ? (active ? 1 : 0.28) : 1;
    const sw = active ? STROKE + 3 : STROKE; // 选中段略微外扩
    circles +=
      '<circle cx="' + CENTER + '" cy="' + CENTER + '" r="' + RADIUS + '" fill="none" ' +
      'stroke="' + a.svgColor + '" stroke-width="' + sw + '" ' +
      'stroke-dasharray="' + a.dashArray + '" stroke-dashoffset="' + a.dashOffset + '" ' +
      'opacity="' + opacity + '" ' +
      'transform="rotate(-90 ' + CENTER + ' ' + CENTER + ')"/>';
  });
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" ' +
    'width="100" height="100" preserveAspectRatio="xMidYMid meet">' +
    '<circle cx="' + CENTER + '" cy="' + CENTER + '" r="' + RADIUS + '" fill="none" ' +
    'stroke="' + track.hex + '" stroke-width="' + STROKE + '" ' +
    'stroke-opacity="' + trackAlpha + '"/>' +
    circles +
    '</svg>'
  );
}

module.exports = {
  RADIUS,
  STROKE,
  CENTER,
  INNER_R,
  OUTER_R,
  CIRCUMFERENCE,
  AGGREGATE_COLOR,
  GOLDEN_ANGLE,
  COLOR_SATURATION,
  LIGHT_BY_THEME,
  DEFAULT_THEME,
  hashId,
  categoryHue,
  getCategoryColor,
  hslToHex,
  parseSvgColor,
  svgColor,
  resolveSegmentColors,
  buildDonutArcs,
  localToViewBox,
  hitSegment,
  buildDonutSVG,
};
