// data/statistics/donut.js
// 分类环形图（category-donut）的纯计算：把 computeCategoryShare 的 segments
// 转成圆环圆弧参数、稳定颜色、命中检测与完整 SVG 字符串。不依赖 wx / 主题。
// 圆弧用 circle 的 stroke-dasharray 实现，弧长直接用 ratio（精确比例，不用四舍五入百分比）。

const RADIUS = 40;
const STROKE = 12;
const CENTER = 50;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// 环带内外半径（stroke 沿圆中心线向两侧扩展），命中检测用
const INNER_R = RADIUS - STROKE / 2; // 34
const OUTER_R = RADIUS + STROKE / 2; // 46

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

/** 聚合「其他」的专用中性色（独立于真实分类调色板，语义中性、两主题可读） */
const AGGREGATE_COLOR = '#8D94A8';

/** 对字符串做确定性 32 位哈希（非加密，仅用于稳定选色），返回非负整数 */
function hashId(str) {
  const s = String(str);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * 真实分类的稳定颜色：基础索引 = hash(categoryId) % 调色板长度，
 * 同一 id 跨月 / 年得到同一基础色；当前图表内若撞色则顺序借用最近空闲色（可辨识度）。
 * @returns {{color:string, index:number}}
 */
function getCategoryColor(categoryId, usedSet) {
  let idx = hashId(categoryId) % DONUT_PALETTE.length;
  if (usedSet && usedSet.has(idx)) {
    for (let step = 1; step < DONUT_PALETTE.length; step++) {
      const cand = (idx + step) % DONUT_PALETTE.length;
      if (!usedSet.has(cand)) { idx = cand; break; }
    }
  }
  return { color: DONUT_PALETTE[idx], index: idx };
}

/** 分段颜色统一解析：圆环与图例都从这里取色，只维护一套颜色逻辑 */
function resolveSegmentColors(segments) {
  const used = new Set();
  return (segments || []).map((s) => {
    if (s.aggregate) return Object.assign({}, s, { color: AGGREGATE_COLOR });
    const r = getCategoryColor(s.categoryId, used);
    used.add(r.index);
    return Object.assign({}, s, { color: r.color });
  });
}

/**
 * 计算每段圆弧的 stroke 参数（从 12 点方向顺时针），颜色走稳定映射。
 * @returns {Array<{index,categoryId,aggregate,color,dashArray,dashOffset,ratio}>}
 */
function buildDonutArcs(segments) {
  const colored = resolveSegmentColors(segments);
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
 * @returns {string}
 */
function buildDonutSVG(segments, trackColor, selectedIndex) {
  const arcs = buildDonutArcs(segments);
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
  DONUT_PALETTE,
  AGGREGATE_COLOR,
  hashId,
  getCategoryColor,
  resolveSegmentColors,
  buildDonutArcs,
  localToViewBox,
  hitSegment,
  buildDonutSVG,
};
