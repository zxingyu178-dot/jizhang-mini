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

// —— 确定性 HSL 配色参数 ——
// 黄金角：让不同 hash 的色相在色轮上均匀散开，相邻 id 颜色差异大、可辨识度高。
const GOLDEN_ANGLE = 137.50776405003785;
const COLOR_SATURATION = 62; // 百分比：中等饱和，两主题不刺眼
// 明度随主题微调（色相不变）：深色背景略提亮、浅色背景压暗，保证两边可读。
// v1.3.3：浅色明度 45 → 34，使全色相相对浅色背景的 WCAG 非文本对比度 worst≈3.25（≥3:1）；
// 深色 56 保持（worst≈3.07，已达标）。色相 / 饱和度不变，视觉身份保持。
const LIGHT_BY_THEME = { dark: 56, light: 34 };
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
    const ratio = s.ratio > 0 ? s.ratio : 0;
    const dash = ratio * CIRCUMFERENCE;
    const offset = -acc * CIRCUMFERENCE; // 负 offset 沿顺时针推进到累计起点
    acc += ratio;
    return {
      index: i,
      categoryId: s.categoryId,
      aggregate: !!s.aggregate,
      ratio,
      color: s.color,
      dashArray: dash + ' ' + (CIRCUMFERENCE - dash),
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
 * @param {Array} segments computeCategoryShare().segments
 * @param {string} trackColor 背景轨道颜色（组件按主题传入）
 * @param {number} [selectedIndex] 选中分段 index；缺省 / -1 表示无选中（全部正常）
 * @param {string} [theme] 分段颜色主题 'dark' | 'light'
 * @returns {string}
 */
function buildDonutSVG(segments, trackColor, selectedIndex, theme) {
  const arcs = buildDonutArcs(segments, theme);
  const hasSel = typeof selectedIndex === 'number' && selectedIndex >= 0;
  let circles = '';
  arcs.forEach((a) => {
    const active = hasSel && a.index === selectedIndex;
    const opacity = hasSel ? (active ? 1 : 0.28) : 1;
    const sw = active ? STROKE + 3 : STROKE; // 选中段略微外扩
    circles +=
      '<circle cx="' + CENTER + '" cy="' + CENTER + '" r="' + RADIUS + '" fill="none" ' +
      'stroke="' + a.color + '" stroke-width="' + sw + '" ' +
      'stroke-dasharray="' + a.dashArray + '" stroke-dashoffset="' + a.dashOffset + '" ' +
      'opacity="' + opacity + '" ' +
      'transform="rotate(-90 ' + CENTER + ' ' + CENTER + ')"/>';
  });
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<circle cx="' + CENTER + '" cy="' + CENTER + '" r="' + RADIUS + '" fill="none" ' +
    'stroke="' + trackColor + '" stroke-width="' + STROKE + '"/>' +
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
  hashId,
  categoryHue,
  getCategoryColor,
  resolveSegmentColors,
  buildDonutArcs,
  localToViewBox,
  hitSegment,
  buildDonutSVG,
};
