// data/statistics/cumulative.js
// 累计消费趋势（cumulative-trend）的纯计算：把 computeCumulativeTrend 的 points
// 转成「面积 + 折线」SVG。不依赖 wx，网格颜色由组件按主题注入，主线用品牌色。
// 坐标量化到 2 位小数（与 path-normalize 一致，避免高精度几何在 <image> 下的解析问题）。

const LINE_COLOR = '#7c86ff';

const VIEW_W = 100;
const VIEW_H = 100;
const PAD_L = 6;
const PAD_R = 6;
const PAD_T = 10;
const PAD_B = 12; // 底部留白
const PLOT_W = VIEW_W - PAD_L - PAD_R;
const PLOT_H = VIEW_H - PAD_T - PAD_B;

function r2(n) { return Math.round(n * 100) / 100; }

/**
 * 生成累计趋势 SVG（面积 + 折线 + 水平网格）。
 * @param {Array} points computeCumulativeTrend().points
 * @param {number} max 累计最大值（= total）
 * @param {string} gridColor 网格线颜色（组件按主题传入）
 * @returns {string}
 */
function buildCumulativeSVG(points, max, gridColor) {
  if (!points || !points.length) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
  }
  const n = points.length;
  const xOf = (i) => PAD_L + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const yOf = (c) => PAD_T + (max ? (1 - c / max) * PLOT_H : PLOT_H);
  const coords = points.map((p, i) => ({ x: r2(xOf(i)), y: r2(yOf(p.cumCents)) }));
  const baseY = r2(PAD_T + PLOT_H);

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
    const gy = r2(PAD_T + (g / 2) * PLOT_H);
    grids +=
      '<line x1="' + PAD_L + '" y1="' + gy + '" x2="' + r2(VIEW_W - PAD_R) + '" y2="' + gy +
      '" stroke="' + gridColor + '" stroke-width="0.5"/>';
  }

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    grids +
    '<path d="' + area + '" fill="' + LINE_COLOR + '" fill-opacity="0.18" stroke="none"/>' +
    '<path d="' + line + '" fill="none" stroke="' + LINE_COLOR + '" stroke-width="1.2" ' +
    'stroke-linejoin="round" stroke-linecap="round"/>' +
    '</svg>'
  );
}

module.exports = {
  LINE_COLOR,
  buildCumulativeSVG,
};
