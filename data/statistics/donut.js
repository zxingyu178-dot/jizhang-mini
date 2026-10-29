// data/statistics/donut.js
// 分类环形图（category-donut）的纯计算：把 computeCategoryShare 的 segments
// 转成 SVG 圆环的圆弧参数与完整 SVG 字符串。不依赖 wx / 主题，颜色由组件按主题注入。
// 圆弧用 circle 的 stroke-dasharray 实现，弧长直接用 ratio（精确比例，不用四舍五入百分比）。

const RADIUS = 40;
const STROKE = 12;
const CENTER = 50;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * 圆环分段调色板（最多 8 段；在深浅背景上均挑选为可读的饱和色）。
 * 仅为当前图表展示色，不是分类永久属性，不写进 Category / 备份。
 */
const DONUT_PALETTE = [
  '#5B8FF9', // 蓝
  '#5AD8A6', // 青绿
  '#F6BD16', // 黄
  '#E8684A', // 橙红
  '#6DC8EC', // 浅蓝
  '#9270CA', // 紫
  '#FF9D4D', // 橙
  '#269A99', // 深青
];

/**
 * 计算每段圆弧的 stroke 参数（从 12 点方向顺时针）。
 * @param {Array} segments computeCategoryShare().segments
 * @returns {Array<{index,categoryId,aggregate,color,dashArray,dashOffset,ratio}>}
 */
function buildDonutArcs(segments) {
  let acc = 0;
  return (segments || []).map((s, i) => {
    const ratio = s.ratio > 0 ? s.ratio : 0;
    const dash = ratio * CIRCUMFERENCE;
    const offset = -acc * CIRCUMFERENCE; // 负 offset 沿顺时针推进到累计起点
    acc += ratio;
    return {
      index: i,
      categoryId: s.categoryId,
      aggregate: !!s.aggregate,
      ratio,
      color: DONUT_PALETTE[i % DONUT_PALETTE.length],
      dashArray: dash + ' ' + (CIRCUMFERENCE - dash),
      dashOffset: offset,
    };
  });
}

/**
 * 生成完整圆环 SVG（含背景轨道与各分段）。
 * @param {Array} segments computeCategoryShare().segments
 * @param {string} trackColor 背景轨道颜色（组件按主题传入）
 * @returns {string}
 */
function buildDonutSVG(segments, trackColor) {
  const arcs = buildDonutArcs(segments);
  let circles = '';
  arcs.forEach((a) => {
    circles +=
      '<circle cx="' + CENTER + '" cy="' + CENTER + '" r="' + RADIUS + '" fill="none" ' +
      'stroke="' + a.color + '" stroke-width="' + STROKE + '" ' +
      'stroke-dasharray="' + a.dashArray + '" stroke-dashoffset="' + a.dashOffset + '" ' +
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
  CIRCUMFERENCE,
  DONUT_PALETTE,
  buildDonutArcs,
  buildDonutSVG,
};
