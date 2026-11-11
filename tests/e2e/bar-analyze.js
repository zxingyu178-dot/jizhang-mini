// tests/e2e/bar-analyze.js
// 从柱区截图里读出「6 档明暗台阶」的分析器。
// 职责：逐列找最长连续档位色段 → 定基线与最高柱 → 沿该列自上而下把颜色归到档位上。
// 单独成模块的原因：它能直接吃磁盘上的 PNG 离线跑，不必每次拉开发者工具（调参时省掉一整轮）。
'use strict';

const png = require('./png-lite');

const px = (img, x, y) => {
  const o = (y * img.width + x) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
};
const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const rgbOf = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/**
 * 按颜色自动定位柱区 + 采样（不依赖任何坐标换算 —— 实测 offset() 是文档坐标、
 * 而截图缩放是 455/390≈1.167 而不是 pixelRatio 3，用坐标换算是错的）。
 *
 * 三步：
 *   ① 横向跨度：用「最暗那一档」（接触暗）的包围盒。它是 mixHex 算出来的中间色，
 *      全工程只有柱体有，不像主色还会出现在「月度/年度」按钮、金额文字上
 *      （第一版用两档做锚点就命中了按钮，截出一张写着「月度」的图）。
 *   ② 柱顶：在①的横向范围内逐列往上找最上面的档位色，取「墨水最多且连续」的那一列
 *      （= 最高的那根柱）。只裁柱脚那一小条的话，采样列里只剩 2 档。
 *   ③ 采样：该列自上而下归到最近的档位色，连续同色合并成档。
 *      用「最近色 + 容差」而不是精确相等：截图是缩放后的位图，档交界有一两行混色。
 */
function analyze(img, fills, tol) {
  const refs = fills.map((h) => ({ hex: h, rgb: rgbOf(h), luma: png.luma(rgbOf(h)) }));
  const W = img.width;
  const H = img.height;
  // 一次性把整张图归到档位色上（-1 = 不是任何一档），后面几次扫描共用
  const lab = new Int8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (img.data[o + 3] < 200) { lab[y * W + x] = -1; continue; }
      const c = [img.data[o], img.data[o + 1], img.data[o + 2]];
      let bi = -1; let bd = tol + 1;
      for (let i = 0; i < refs.length; i++) {
        const d = dist(c, refs[i].rgb);
        if (d < bd) { bd = d; bi = i; }
      }
      lab[y * W + x] = bd <= tol ? bi : -1;
    }
  }
  const at = (x, y) => lab[y * W + x];

  // ① 逐列找「最长的一段连续档位色」—— 这就是柱体本身。
  //    为什么不取「最暗档的包围盒」：踩过两次坑 ——
  //    a) 分段按钮的抗锯齿边缘混出了接触暗的颜色，把锚点整块抢走；
  //    b) 矮柱的接触暗只有 1~2 行（7% 柱高），最暗档只在高柱上才成形。
  //    允许 2 行以内的断点（档与档交界会有一两行混色），但断点不参与计数。
  const cols = [];
  for (let x = 0; x < W; x++) {
    let best = null;
    let start = -1;
    let last = -2;
    let hits = 0;
    const close = () => {
      if (start < 0 || last < start) return;
      const cand = { top: start, bottom: last, len: last - start + 1, hits: hits };
      if (!best || cand.len > best.len) best = cand;
    };
    for (let y = 0; y < H; y++) {
      if (at(x, y) >= 0) {
        if (start < 0 || y - last > 3) { close(); start = y; hits = 0; }
        last = y;
        hits++;
      }
    }
    close();
    if (best && best.hits >= 6) cols.push({ x: x, top: best.top, bottom: best.bottom, len: best.len, hits: best.hits });
  }
  if (!cols.length) return { error: '整张图里找不到成段的柱体像素' };

  // ② 先定基线（柱脚所在的 y），再在「踩到基线」的列里挑最长的那根 = 最高的柱子。
  //    不能直接拿全局最长列：柱子的左右边缘列会因抗锯齿提前断在基线之上，
  //    取到边缘列就会丢掉最下面那档（接触暗），看上去像「只有 5 档」。
  const long = cols.filter((c) => c.len >= 10);
  if (!long.length) return { error: '没有够长的柱体像素段' };
  const baseline = Math.max.apply(null, long.map((c) => c.bottom));
  const onBase = long.filter((c) => Math.abs(c.bottom - baseline) <= 3);
  if (!onBase.length) return { error: '没有踩到基线的柱子（baseline ' + baseline + '）' };
  const tallest = onBase.reduce((a, b) => (b.len > a.len ? b : a), onBase[0]);
  const ax0 = Math.min.apply(null, onBase.map((b) => b.x));
  const ax1 = Math.max.apply(null, onBase.map((b) => b.x));
  const ay1 = baseline;

  // ③ 采样最高柱的中线（从柱顶一直采到基线，确保 6 档都在）
  const sx = tallest.x;
  const rows = [];
  for (let y = tallest.top; y <= ay1; y++) rows.push(at(sx, y) >= 0 ? refs[at(sx, y)] : null);
  const runs = [];
  let cur = null;
  for (let y = 0; y < rows.length; y++) {
    const key = rows[y] ? rows[y].hex : null;
    if (!cur || cur.hex !== key) { cur = { hex: key, ref: rows[y], from: y, to: y }; runs.push(cur); }
    else cur.to = y;
  }
  const solid = runs.filter((r) => r.ref && r.to - r.from + 1 >= 2);
  const jumps = [];
  for (let i = 1; i < solid.length; i++) {
    if (solid[i].hex !== solid[i - 1].hex) jumps.push(Math.abs(solid[i].ref.luma - solid[i - 1].ref.luma));
  }
  return {
    bbox: { x0: ax0, y0: tallest.top, x1: ax1, y1: ay1 },
    sampleX: sx,
    barH: tallest.len,
    colCount: onBase.length,
    distinctCount: new Set(solid.map((r) => r.hex)).size,
    bands: solid.map((r) => ({ hex: r.hex, y: r.from + '-' + r.to, h: r.to - r.from + 1, luma: Number(r.ref.luma.toFixed(1)) })),
    jumps: jumps.length
      ? { bandCount: solid.length, min: Number(Math.min.apply(null, jumps).toFixed(1)), max: Number(Math.max.apply(null, jumps).toFixed(1)) }
      : null,
  };
}
module.exports = { px, dist, rgbOf, analyze };
