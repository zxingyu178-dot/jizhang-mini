// data/statistics/cumulative.js
// 累计消费趋势（cumulative-trend）的纯计算：把 computeCumulativeTrend 的 points
// 转成「面积 + 折线」SVG。不依赖 wx，网格颜色由组件按主题注入，主线用品牌色。
// 坐标量化到 2 位小数（与 path-normalize 一致，避免高精度几何在 <image> 下的解析问题）。
//
// v1.4.3 修复：viewBox 必须与显示盒同宽高比。
// 旧实现固定 viewBox="0 0 100 100"（正方形），而组件显示盒是 320×180；
// <image mode="aspectFit"> 会把正方形等比缩到 180×180 并居中，两侧各留 70px 空白，
// 视觉上就是「曲线画到一半就断了」。现在按显示盒尺寸生成 viewBox，坐标即像素，铺满整宽。

const LINE_COLOR = '#7c86ff';

/** 默认显示盒（与 statistics-panel 的 width/height 属性一致，作为量不到容器时的兜底） */
const DEFAULT_W = 320;
const DEFAULT_H = 180;

/** 内边距占显示盒的比例（沿用旧 100×100 设计的 6% / 10% / 12%） */
const PAD_L_RATIO = 0.06;
const PAD_R_RATIO = 0.06;
const PAD_T_RATIO = 0.10;
const PAD_B_RATIO = 0.12;

/** 线宽 = 短边 × 1.2%（旧设计 1.2/100，视觉粗细保持一致，不随宽度被拉粗） */
const STROKE_RATIO = 0.012;

function r2(n) { return Math.round(n * 100) / 100; }

/**
 * 生成累计趋势 SVG（面积 + 折线 + 水平网格）。
 * @param {Array} points computeCumulativeTrend().points
 * @param {number} max 累计最大值（= total）
 * @param {string} gridColor 网格线颜色（组件按主题传入）
 * @param {{w:number,h:number}} [box] 显示盒尺寸（px）；缺省用 320×180
 * @returns {string}
 */
function buildCumulativeSVG(points, max, gridColor, box) {
  const w = box && Number.isFinite(box.w) && box.w > 0 ? box.w : DEFAULT_W;
  const h = box && Number.isFinite(box.h) && box.h > 0 ? box.h : DEFAULT_H;
  const padL = r2(w * PAD_L_RATIO);
  const padR = r2(w * PAD_R_RATIO);
  const padT = r2(h * PAD_T_RATIO);
  const padB = r2(h * PAD_B_RATIO);
  const plotW = r2(w - padL - padR);
  const plotH = r2(h - padT - padB);
  const strokeW = r2(Math.min(w, h) * STROKE_RATIO);

  const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '">';
  if (!points || !points.length) {
    return open + '</svg>';
  }

  const n = points.length;
  const xOf = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yOf = (c) => padT + (max ? (1 - c / max) * plotH : plotH);
  const coords = points.map((p, i) => ({ x: r2(xOf(i)), y: r2(yOf(p.cumCents)) }));
  const baseY = r2(padT + plotH);

  // 折线路径
  let line = 'M' + coords[0].x + ' ' + coords[0].y;
  coords.slice(1).forEach((c) => { line += ' L' + c.x + ' ' + c.y; });

  // 面积路径（折线收尾后垂直到底边闭合）
  const area =
    line +
    ' L' + coords[coords.length - 1].x + ' ' + baseY +
    ' L' + coords[0].x + ' ' + baseY + ' Z';

  // 水平网格线（3 条）
  let grids = '';
  for (let g = 0; g <= 2; g++) {
    const gy = r2(padT + (g / 2) * plotH);
    grids +=
      '<line x1="' + padL + '" y1="' + gy + '" x2="' + r2(w - padR) + '" y2="' + gy +
      '" stroke="' + gridColor + '" stroke-width="' + r2(strokeW * 0.42) + '"/>';
  }

  return (
    open +
    grids +
    '<path d="' + area + '" fill="' + LINE_COLOR + '" fill-opacity="0.18" stroke="none"/>' +
    '<path d="' + line + '" fill="none" stroke="' + LINE_COLOR + '" stroke-width="' + strokeW + '" ' +
    'stroke-linejoin="round" stroke-linecap="round"/>' +
    '</svg>'
  );
}

module.exports = {
  LINE_COLOR,
  DEFAULT_W,
  DEFAULT_H,
  buildCumulativeSVG,
};
