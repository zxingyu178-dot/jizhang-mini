// data/statistics/cumulative.js
// 累计消费趋势（cumulative-trend）的纯计算：把 computeCumulativeTrend 的 points
// 转成「面积 + 折线」SVG。不依赖 wx，网格颜色由组件按主题注入，主线用品牌色。
// 坐标量化到 2 位小数（与 path-normalize 一致，避免高精度几何在 <image> 下的解析问题）。
//
// v1.4.3 修复：viewBox 必须与显示盒同宽高比。
// 旧实现固定 viewBox="0 0 100 100"（正方形），而组件显示盒是 320×180；
// <image mode="aspectFit"> 会把正方形等比缩到 180×180 并居中，两侧各留 70px 空白，
// 视觉上就是「曲线画到一半就断了」。现在按显示盒尺寸生成 viewBox，坐标即像素，铺满整宽。
//
// v1.4.4（本次）：加坐标轴。
//   - 左侧留出 Y 轴刻度列（opts.padLeft，px），绘图区左边界相应右移，刻度文字不会压在曲线上；
//   - 水平网格线改为「按刻度值画」：刻度由 buildTicks 生成（0 / ½max / max），
//     网格线与刻度一一对应，而不是现在这样平均分后与数字无关；
//   - 文字不画进 SVG（<image> 渲染管线里字体/基线不保证一致），由组件用 WXML 原生
//     <text> 叠加，坐标系通过 computeGeometry / tickY / xAt 与本文件共用同一套数学。

const axis = require('./axis');

const LINE_COLOR = '#7c86ff';

/** 默认显示盒（与 statistics-panel 的 width/height 属性一致，作为量不到容器时的兜底） */
const DEFAULT_W = 320;
const DEFAULT_H = 180;

/** 内边距占显示盒的比例（沿用旧 100×100 设计的 6% / 10% / 12%）
 *  padL 仅在未传 opts.padLeft 时作为兜底（旧行为）；有 Y 轴刻度时由组件按文字宽度传入。
 *  padR 归 0（v1.4.4 终检）：柱图的网格线/绘图区右边界贴在卡片内容右侧，
 *  累计图必须同宽同界，否则两张卡右端差 20px，视觉上像两张不同宽度的图。 */
const PAD_L_RATIO = 0.06;
const PAD_R_RATIO = 0;
const PAD_T_RATIO = 0.10;
const PAD_B_RATIO = 0.12;

/** 线宽 = 短边 × 1.2%（旧设计 1.2/100，视觉粗细保持一致，不随宽度被拉粗） */
const STROKE_RATIO = 0.012;

/** Y 轴刻度档数：0 / ½max / max */
const TICK_COUNT = 3;

/** Y 轴留白列最多占显示盒宽度的 42%（超过就说明刻度文字太长，宁可截断也不吃掉绘图区） */
const MAX_PAD_L_RATIO = 0.42;

function r2(n) { return Math.round(n * 100) / 100; }

/**
 * 计算绘图区几何。组件画刻度文字、本文件画折线，两边必须用同一套数字，
 * 否则刻度线和曲线对不上（典型症状：刻度线偏高一格）。
 * @param {{w:number,h:number}} [box] 显示盒（px）
 * @param {number} [padLeftPx] 左侧 Y 轴留白（px）；非法 / 缺省时按旧比例
 * @param {number} [tickCount] 刻度档数
 * @returns {{w:number,h:number,padL:number,padR:number,padT:number,padB:number,
 *            plotW:number,plotH:number,strokeW:number,tickCount:number,baseY:number}}
 */
function computeGeometry(box, padLeftPx, tickCount) {
  const w = box && Number.isFinite(box.w) && box.w > 0 ? box.w : DEFAULT_W;
  const h = box && Number.isFinite(box.h) && box.h > 0 ? box.h : DEFAULT_H;
  const wantL = Number(padLeftPx);
  const padL = Number.isFinite(wantL) && wantL > 0
    ? r2(Math.min(wantL, w * MAX_PAD_L_RATIO))
    : r2(w * PAD_L_RATIO);
  const padR = r2(w * PAD_R_RATIO);
  const padT = r2(h * PAD_T_RATIO);
  const padB = r2(h * PAD_B_RATIO);
  const rawCount = Number(tickCount);
  const n = Math.min(6, Math.max(2, Number.isFinite(rawCount) ? Math.round(rawCount) : TICK_COUNT));
  return {
    w: r2(w),
    h: r2(h),
    padL,
    padR,
    padT,
    padB,
    plotW: r2(w - padL - padR),
    plotH: r2(h - padT - padB),
    strokeW: r2(Math.min(w, h) * STROKE_RATIO),
    tickCount: n,
    baseY: r2(h - padB), // 绘图区底边（= padT + plotH）
  };
}

/** 刻度比例 → 绘图区纵坐标（ratio 0 = 底边，1 = 顶边） */
function tickY(geo, ratio) {
  const rt = Number.isFinite(ratio) ? ratio : 0;
  return r2(geo.padT + (1 - rt) * geo.plotH);
}

/** 第 i 个点（共 n 个）→ 绘图区横坐标；只有一个点时居中 */
function xAt(geo, i, n) {
  if (!Number.isFinite(n) || n <= 0) return r2(geo.padL);
  if (n === 1) return r2(geo.padL + geo.plotW / 2);
  return r2(geo.padL + (i / (n - 1)) * geo.plotW);
}

/**
 * 生成累计趋势 SVG（面积 + 折线 + 水平网格 + 末端圆点）。
 *
 * v1.4.4 终检修正（三件）：
 *   1) **横轴跨度与「数据截止日」分离**：points 只传截止日及之前的点（组件过滤），
 *      spanDays 传整月天数 —— 折线/面积只画到截止日，右侧留空；
 *      旧实现把全月 30 个点都传进来，11/10 之后沿用最后值，折线平到月末，
 *      视觉上等于「11 号以后一分钱没花」，是误导。
 *   2) **纵轴比例尺改用 nice 顶档**（axis.niceCeilCents），与刻度文字同一口径，
 *      否则柱子/折线与刻度对不上。
 *   3) 末端加一个实心圆点（半径 ≤3px）标出「数据到此为止」。
 *
 * @param {Array} points 截止日及之前的点（含 cumCents / day）
 * @param {number} max 累计最大值（分）
 * @param {string} gridColor 网格线颜色（组件按主题传入）
 * @param {{w:number,h:number}} [box] 显示盒尺寸（px）；缺省用 320×180
 * @param {{padLeft?:number,tickCount?:number,spanDays?:number}} [opts]
 *        spanDays：横轴总跨度（整月天数）；缺省 = points.length（旧行为）
 * @returns {string}
 */
function buildCumulativeSVG(points, max, gridColor, box, opts) {
  const o = opts || {};
  const geo = computeGeometry(box, o.padLeft, o.tickCount);
  const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + geo.w + ' ' + geo.h + '">';
  if (!points || !points.length) {
    return open + '</svg>';
  }

  const n = points.length;
  const spanRaw = Number(o.spanDays);
  // 跨度不允许小于点数（否则点会跑到绘图区外），也不允许非整数
  const span = Number.isFinite(spanRaw) && spanRaw >= n ? Math.round(spanRaw) : n;
  const maxCents = Number.isFinite(max) && max > 0 ? max : 0;
  // 纵轴按 nice 顶档算比例尺（与刻度文字同一口径）
  const scaleMax = axis.niceCeilCents(maxCents);
  const yOf = (c) => tickY(geo, scaleMax ? Math.min(1, c / scaleMax) : 0);
  const coords = points.map((p, i) => ({ x: xAt(geo, i, span), y: yOf(p.cumCents) }));
  const right = r2(geo.w - geo.padR);
  const last = coords[coords.length - 1];

  // 折线路径
  let line = 'M' + coords[0].x + ' ' + coords[0].y;
  coords.slice(1).forEach((c) => { line += ' L' + c.x + ' ' + c.y; });

  // 面积路径（折线收尾后垂直到底边闭合）
  const area =
    line +
    ' L' + last.x + ' ' + geo.baseY +
    ' L' + coords[0].x + ' ' + geo.baseY + ' Z';

  // 水平网格线：与 Y 轴刻度一一对应；没有文字的档（空态 / 撞字去重）不画线
  let grids = '';
  axis.buildTicks(scaleMax, geo.tickCount).forEach((t) => {
    if (!t.showGrid) return;
    const gy = tickY(geo, t.ratio);
    grids +=
      '<line x1="' + geo.padL + '" y1="' + gy + '" x2="' + right + '" y2="' + gy +
      '" stroke="' + gridColor + '" stroke-width="' + r2(geo.strokeW * 0.42) + '"/>';
  });

  // 末端圆点：半径 ≤3px，实心品牌色，标出「数据到此为止」
  const dotR = r2(Math.max(1.6, Math.min(3, geo.strokeW * 1.6)));

  return (
    open +
    grids +
    '<path d="' + area + '" fill="' + LINE_COLOR + '" fill-opacity="0.18" stroke="none"/>' +
    '<path d="' + line + '" fill="none" stroke="' + LINE_COLOR + '" stroke-width="' + geo.strokeW + '" ' +
    'stroke-linejoin="round" stroke-linecap="round"/>' +
    '<circle cx="' + last.x + '" cy="' + last.y + '" r="' + dotR + '" fill="' + LINE_COLOR + '"/>' +
    '</svg>'
  );
}

module.exports = {
  LINE_COLOR,
  DEFAULT_W,
  DEFAULT_H,
  TICK_COUNT,
  PAD_L_RATIO,
  PAD_R_RATIO,
  PAD_T_RATIO,
  PAD_B_RATIO,
  computeGeometry,
  tickY,
  xAt,
  buildCumulativeSVG,
};
