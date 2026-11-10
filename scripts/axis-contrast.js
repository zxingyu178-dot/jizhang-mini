// scripts/axis-contrast.js
// 坐标轴「像素级」对比度 / 净空实测（v1.4.4 终检）
//
// 为什么不用 CSS 变量直接算：文字与网格都是半透明色叠在玻璃渐变卡片上，声明值 ≠ 屏幕值。
// 只有截图像素能证明用户真正看到的对比度。
//
// 定位方式：读 tests/e2e/chart-axis-probe.js 产出的 axis-report.json 里采集的真实元素矩形
// （CSS px），按「截图宽 / windowWidth」换算成截图像素，精确裁到刻度文字 / 网格线 / 柱子两侧，
// 不靠肉眼猜坐标。每个测量区域同时裁成 *_crop.png，供人眼复核「量的确实是那处」。
//
// 用法：node scripts/axis-contrast.js <截图目录>
'use strict';
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

/* ---------- WCAG 2.x 色彩数学 ---------- */
function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
const relLum = (r, g, b) => 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
function contrast(l1, l2) {
  const a = Math.max(l1, l2);
  const b = Math.min(l1, l2);
  return (a + 0.05) / (b + 0.05);
}
const brightness = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/* ---------- 图像读取 ---------- */
function readPng(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width: w, height: h, data } = png;
  return {
    w, h, data,
    px: (x, y) => {
      const i = (y * w + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    },
  };
}

function clampRect(img, r) {
  return {
    x0: Math.max(0, Math.min(img.w - 1, Math.round(r.x0))),
    x1: Math.max(1, Math.min(img.w, Math.round(r.x1))),
    y0: Math.max(0, Math.min(img.h - 1, Math.round(r.y0))),
    y1: Math.max(1, Math.min(img.h, Math.round(r.y1))),
  };
}

/** 区域内亮度众数（量化到 2/255 桶）→ 代表「底色」 */
function modalColor(img, r0) {
  const r = clampRect(img, r0);
  const map = new Map();
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const [rr, gg, bb] = img.px(x, y);
      const key = (rr >> 1) + ',' + (gg >> 1) + ',' + (bb >> 1);
      const e = map.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += rr; e.g += gg; e.b += bb;
      map.set(key, e);
    }
  }
  let best = null;
  for (const e of map.values()) if (!best || e.n > best.n) best = e;
  if (!best) return null; // 空窗口（坐标越界）：交给调用方判定「未测到」
  const total = (r.x1 - r.x0) * (r.y1 - r.y0);
  return {
    r: Math.round(best.r / best.n),
    g: Math.round(best.g / best.n),
    b: Math.round(best.b / best.n),
    share: Number((best.n / total).toFixed(3)),
  };
}

function avgColor(list) {
  const n = list.length || 1;
  return {
    r: Math.round(list.reduce((a, c) => a + c[0], 0) / n),
    g: Math.round(list.reduce((a, c) => a + c[1], 0) / n),
    b: Math.round(list.reduce((a, c) => a + c[2], 0) / n),
  };
}

/**
 * 文字 vs 底色（深 / 浅两套主题通用）：
 * 字形像素 = 与底色亮度差 > 0.10 的像素（深色主题更亮、浅色主题更暗，两个方向都算），
 * 核心色取「与底色差最大的 10%」均值，另给中位值。
 */
function measureText(img, rect) {
  const r = clampRect(img, rect);
  const bg = modalColor(img, r);
  if (!bg) return { ok: false, bg: null, glyphCount: 0 };
  const bgB = brightness(bg.r, bg.g, bg.b);
  const glyph = [];
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const p = img.px(x, y);
      if (Math.abs(brightness(p[0], p[1], p[2]) - bgB) > 0.10) glyph.push(p);
    }
  }
  if (glyph.length < 4) return { ok: false, bg: bg, glyphCount: glyph.length };
  const dist = (p) => Math.abs(brightness(p[0], p[1], p[2]) - bgB);
  glyph.sort((a, b) => dist(a) - dist(b));
  const core = avgColor(glyph.slice(Math.floor(glyph.length * 0.9)));
  const median = avgColor([glyph[Math.floor(glyph.length * 0.5)]]);
  const lb = relLum(bg.r, bg.g, bg.b);
  return {
    ok: true,
    glyphCount: glyph.length,
    bg: bg,
    bgColor: `rgb(${bg.r},${bg.g},${bg.b})`,
    coreColor: `rgb(${core.r},${core.g},${core.b})`,
    coreContrast: Number(contrast(relLum(core.r, core.g, core.b), lb).toFixed(2)),
    medianContrast: Number(contrast(relLum(median.r, median.g, median.b), lb).toFixed(2)),
  };
}

/**
 * 网格线：在给定 y 附近找「与底色有差」的横线（深色主题更亮、浅色主题更暗，两个方向都认），
 * 返回对比度与**线的左右像素范围**（后者用于验证「两张卡右边界对齐」）。
 */
function measureGrid(img, rect) {
  const yCss = Math.round(rect.y);
  const x0 = Math.max(0, Math.round(rect.x0));
  const x1 = Math.min(img.w, Math.round(rect.x1));
  if (x1 - x0 < 20) return { ok: false, coverage: 0 };
  const bgTop = modalColor(img, { x0: x0, x1: x1, y0: yCss - 9, y1: yCss - 4 });
  const bgBot = modalColor(img, { x0: x0, x1: x1, y0: yCss + 4, y1: yCss + 9 });
  if (!bgTop || !bgBot) return { ok: false, coverage: 0 };
  const bg = bgTop.share >= bgBot.share ? bgTop : bgBot;
  const bgB = brightness(bg.r, bg.g, bg.b);

  let bestRow = null;
  for (let y = yCss - 2; y <= yCss + 3; y++) {
    if (y < 0 || y >= img.h) continue;
    const cand = [];
    let eligible = 0;
    for (let x = x0; x < x1; x++) {
      // 柱子会盖住网格线：用「线下方 3px 与底色明显不同」判定该列有柱子，直接排除
      const below = img.px(x, Math.min(img.h - 1, y + 3));
      if (Math.abs(brightness(below[0], below[1], below[2]) - bgB) > 0.12) continue;
      eligible++;
      const p = img.px(x, y);
      const d = Math.abs(brightness(p[0], p[1], p[2]) - bgB);
      if (d > 0.005 && d < 0.18) cand.push({ p: p, x: x, d: d });
    }
    const coverage = eligible > 0 ? cand.length / eligible : 0;
    if (!bestRow || cand.length > bestRow.cand.length) bestRow = { y: y, cand: cand, coverage: coverage };
  }
  if (!bestRow || bestRow.cand.length < 20) {
    return { ok: false, coverage: Number(((bestRow && bestRow.coverage) || 0).toFixed(2)), bgColor: `rgb(${bg.r},${bg.g},${bg.b})` };
  }
  const sorted = bestRow.cand.slice().sort((a, b) => a.d - b.d);
  const med = sorted[Math.floor(sorted.length * 0.5)].p;
  const lb = relLum(bg.r, bg.g, bg.b);
  const xs = bestRow.cand.map((c) => c.x).sort((a, b) => a - b);
  return {
    ok: true,
    y: bestRow.y,
    coverage: Number(bestRow.coverage.toFixed(2)),
    lineColor: `rgb(${med[0]},${med[1]},${med[2]})`,
    bgColor: `rgb(${bg.r},${bg.g},${bg.b})`,
    contrast: Number(contrast(relLum(med[0], med[1], med[2]), lb).toFixed(2)),
    xMin: xs[0],
    xMax: xs[xs.length - 1],
  };
}

/**
 * 柱顶上方净空（终检⑤）：柱子之间的空隙只有 ~4.5px，横向量会把邻柱当底色，
 * 因此在**竖直方向**量：逐列找柱顶，取柱顶上方 1~2px 与 12~16px 的差异。
 * 有发光时柱顶上方十余像素仍被染色（原实现实测偏暗 8~9 阶）。
 * @param {{x0:number,x1:number,top:number,bottom:number}} plot 绘图区（截图像素）
 */
function measureBarHalo(img, plot) {
  const x0 = Math.max(1, Math.round(plot.x0));
  const x1 = Math.min(img.w - 2, Math.round(plot.x1));
  const top = Math.max(1, Math.round(plot.top));
  const bottom = Math.min(img.h - 2, Math.round(plot.bottom));
  if (x1 - x0 < 40 || bottom - top < 40) return { ok: false };
  // 参照底色：绘图区上方一片纯卡片底（那里没有任何柱子 / 网格线）
  const ref = modalColor(img, { x0: x0, x1: x1, y0: top - 26, y1: top - 14 });
  if (!ref) return { ok: false };
  const refB = brightness(ref.r, ref.g, ref.b);
  const sample = (x, ya, yb) => {
    const out = [];
    for (let y = Math.max(0, ya); y <= Math.min(img.h - 1, yb); y++) out.push(img.px(x, y));
    return out;
  };
  let worst = { delta: -1 };
  let bars = 0;
  for (let x = x0 + 1; x < x1; x++) {
    // 从底边往上找「连续的柱体像素段」，段顶 = 柱顶（网格线在柱顶之上，不会被误认）
    let yTop = -1;
    let started = false;
    for (let y = bottom; y > top; y--) {
      const p = img.px(x, y);
      const diff = Math.abs(brightness(p[0], p[1], p[2]) - refB) > 0.12;
      if (diff) { started = true; yTop = y; } else if (started) { break; }
    }
    if (!started || yTop < 0 || yTop - 20 < top) continue; // 该列没柱子 / 柱子太矮（上方不够干净）
    // 柱顶紧邻网格线时无法分离「线的亮度」与「光晕」：这类列直接跳过（宁可少测，不误判）
    const gridYs = plot.gridYs || [];
    if (gridYs.some((gy) => Math.abs(gy - yTop) < 7)) continue;
    bars++;
    const near = sample(x, yTop - 3, yTop - 2);
    const far = sample(x, yTop - 18, yTop - 14);
    if (!near.length || !far.length) continue;
    const n = avgColor(near);
    const f = avgColor(far);
    const d = Math.max(Math.abs(n.r - f.r), Math.abs(n.g - f.g), Math.abs(n.b - f.b));
    if (d > worst.delta) {
      worst = { delta: d, x: x, yTop: yTop, nearColor: `rgb(${n.r},${n.g},${n.b})`, bgColor: `rgb(${f.r},${f.g},${f.b})` };
    }
  }
  if (worst.delta < 0) return { ok: false, bars: bars };

  // 控制组：同样两行采样，但换到「没有柱子」的空隙列 —— 那里只有卡片底色，
  // 若控制组也差不多，说明这点差异来自卡片自身的渐变，而不是柱子的发光。
  let control = null;
  for (let dx = 3; dx <= 8 && !control; dx++) {
    [worst.x - dx, worst.x + dx].forEach((cx) => {
      if (control || cx < x0 || cx > x1) return;
      const p = img.px(cx, bottom);
      if (Math.abs(brightness(p[0], p[1], p[2]) - refB) > 0.12) return; // 该列是柱子
      const n = avgColor(sample(cx, worst.yTop - 3, worst.yTop - 2));
      const f = avgColor(sample(cx, worst.yTop - 18, worst.yTop - 14));
      control = Math.max(Math.abs(n.r - f.r), Math.abs(n.g - f.g), Math.abs(n.b - f.b));
    });
  }
  return {
    ok: true,
    bars: bars,
    delta: worst.delta,
    controlDelta: control,
    // 发光净差 = 柱边差值 − 对照差值（同一行、同一渐变底色下的基线差）
    glowDelta: control == null ? worst.delta : Math.max(0, worst.delta - control),
    nearColor: worst.nearColor,
    bgColor: worst.bgColor,
  };
}

function saveCrop(img, name, r0, outDir, zoom) {
  const r = clampRect(img, r0);
  const z = zoom || 1;
  const w = Math.max(1, (r.x1 - r.x0) * z);
  const h = Math.max(1, (r.y1 - r.y0) * z);
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [rr, gg, bb] = img.px(r.x0 + Math.floor(x / z), r.y0 + Math.floor(y / z));
      const i = (y * w + x) * 4;
      png.data[i] = rr; png.data[i + 1] = gg; png.data[i + 2] = bb; png.data[i + 3] = 255;
    }
  }
  const f = path.join(outDir, name + '.png');
  fs.writeFileSync(f, PNG.sync.write(png));
  return path.relative(process.cwd(), f);
}

/* ---------- 主流程 ---------- */
const SHOTS = [
  { file: 'axis-01-daily-dark.png', key: 'axis-01-daily-dark', kind: 'ca', theme: 'dark', min: 4.5 },
  { file: 'axis-02-cumulative-dark.png', key: 'axis-02-cumulative-dark', kind: 'ct', theme: 'dark', min: 4.5 },
  { file: 'axis-03-year-monthly-dark.png', key: 'axis-03-year-monthly-dark', kind: 'ca', theme: 'dark', min: 4.5 },
  { file: 'axis-04-daily-light.png', key: 'axis-04-daily-light', kind: 'ca', theme: 'light', min: 4.0 },
  { file: 'axis-05-cumulative-light.png', key: 'axis-05-cumulative-light', kind: 'ct', theme: 'light', min: 4.0 },
  { file: 'axis-06-daily-narrow-font.png', key: 'axis-06-daily-narrow-font', kind: 'ca', theme: 'light', min: 4.0, narrow: true },
];

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('用法：node scripts/axis-contrast.js <截图目录>');
    process.exit(1);
  }
  const rep = JSON.parse(fs.readFileSync(path.join(dir, 'axis-report.json'), 'utf8'));
  const windowWidth = (rep.data.viewport && rep.data.viewport.windowWidth) || 375;
  const outDir = path.join(dir, 'contrast-crops');
  fs.mkdirSync(outDir, { recursive: true });

  // 刻度字号从组件真实数据里取（automator 的 offset() 只给 left/top，没有宽高）
  const fontPxOf = (key) => {
    const d = rep.data || {};
    if (key.indexOf('cumulative') >= 0) return (d.cumulativeComponent || {}).fontPx || 11;
    if (key.indexOf('year-monthly') >= 0) return (((d.yearAxis || {}).monthlyAxis) || {}).fontPx || 11;
    if (key.indexOf('narrow') >= 0) return (((d.narrowAxis || {}).dailyAxis) || {}).fontPx || 10;
    return (((d.normalMonth || {}).dailyAxis) || {}).fontPx || 11;
  };

  const results = [];
  let worstTick = 99;
  const gridVals = [];
  let worstHalo = -1;
  const edges = {};

  SHOTS.forEach((s) => {
    const file = path.join(dir, s.file);
    const rects = rep.data.rects && rep.data.rects[s.key];
    if (!fs.existsSync(file) || !rects || !rects.root) {
      console.log('⚠ 缺图或缺矩形数据：' + s.file);
      return;
    }
    const img = readPng(file);
    const scale = img.w / windowWidth;
    const fontPx = fontPxOf(s.key);
    const res = { shot: s.file, theme: s.theme, size: img.w + 'x' + img.h, scale: Number(scale.toFixed(4)), fontPx: fontPx, ticks: [], grids: [], halo: null };

    const root = rects.root;
    const ticks = (rects.ticks || []).slice(0, 3);
    const gutterRightCss = s.kind === 'ca'
      ? (rects.grids && rects.grids[0] ? rects.grids[0].rect.left : root.left + 60)
      : root.left + 40;

    ticks.forEach((t, i) => {
      const rect = {
        x0: root.left * scale,
        x1: gutterRightCss * scale,
        y0: (t.rect.top - 3) * scale,
        y1: (t.rect.top + fontPx + 3) * scale,
      };
      const m = measureText(img, rect);
      m.label = t.text;
      m.fontPx = fontPx;
      if (m.ok) {
        worstTick = Math.min(worstTick, m.coreContrast);
        m.crop = saveCrop(img, s.file.replace('.png', '') + '_tick' + (i + 1), rect, outDir, 6);
      }
      res.ticks.push(m);
    });

    // 网格线：只测最上面那条（柱子最少遮挡、最干净），顺带取左右端点判「两卡边界对齐」
    if (rects.grids && rects.grids.length >= 2) {
      const sorted = rects.grids.slice().sort((a, b) => a.rect.top - b.rect.top);
      const g = measureGrid(img, {
        x0: gutterRightCss * scale,
        x1: (windowWidth - root.left) * scale,
        y: sorted[0].rect.top * scale,
      });
      if (g.ok) {
        gridVals.push(g.contrast);
        if (edges[s.kind] == null) edges[s.kind] = g.xMax;
        if (edges[s.kind + 'Left'] == null) edges[s.kind + 'Left'] = g.xMin;
        g.crop = saveCrop(img, s.file.replace('.png', '') + '_grid',
          { x0: gutterRightCss * scale, x1: (windowWidth - root.left) * scale, y0: g.y - 10, y1: g.y + 11 }, outDir, 3);
        // 柱顶上方净空：绘图区上下界（上下两条网格线）
        const plot = {
          x0: g.xMin,
          x1: g.xMax,
          top: sorted[0].rect.top * scale,
          bottom: sorted[sorted.length - 1].rect.top * scale,
          gridYs: sorted.map((r) => r.rect.top * scale),
        };
        const halo = measureBarHalo(img, plot);
        if (halo.ok) {
          worstHalo = Math.max(worstHalo, halo.glowDelta);
          res.halo = halo;
        }
      }
      res.grids.push(g);
    } else if (s.kind === 'ct' && ticks.length) {
      // 累计图的网格线画在 SVG 里，不是 DOM 元素：用「最高档刻度文字的中心线」反推网格线 y。
      // automator 的 offset() 只给 left/top（没有 width/height），所以横向窗口用
      // 「卡片左侧 + 60px（跳过 Y 轴刻度列）→ 视口右边缘」，靠亮度检测找线的真实右端点。
      const topTick = ticks[0];
      const yCss = topTick.rect.top + fontPx / 2;
      const g = measureGrid(img, {
        x0: (root.left + 60) * scale,
        x1: (windowWidth - 1) * scale,
        y: yCss * scale,
      });
      if (g.ok) {
        gridVals.push(g.contrast);
        edges[s.kind] = g.xMax;
        g.crop = saveCrop(img, s.file.replace('.png', '') + '_grid',
          { x0: (root.left + 60) * scale, x1: (windowWidth - 1) * scale, y0: g.y - 10, y1: g.y + 11 }, outDir, 3);
      }
      res.grids.push(g);
    }

    results.push(res);
  });

  const out = {
    generatedAt: new Date().toISOString(),
    dir: dir,
    windowWidth: windowWidth,
    results: results,
    summary: { worstTickContrast: worstTick, gridContrast: gridVals, worstBarHaloDelta: worstHalo, rightEdges: edges },
  };
  fs.writeFileSync(path.join(dir, 'axis-contrast-report.json'), JSON.stringify(out, null, 2), 'utf8');

  console.log('=== 坐标轴像素实测（WCAG 2.x，截图缩放比 ' + (results[0] && results[0].scale) + '）===');
  results.forEach((r) => {
    console.log('\n## ' + r.shot + '（' + r.theme + '，' + r.size + '，刻度字号 ' + r.fontPx + 'px）');
    r.ticks.forEach((t) => {
      if (!t.ok) { console.log('  刻度「' + t.label + '」⚠ 未测到字形像素'); return; }
      console.log('  刻度「' + t.label + '」文字=' + t.coreColor + ' 底=' + t.bgColor
        + ' → 核心对比度 ' + t.coreContrast + ':1（中位 ' + t.medianContrast + ':1）');
    });
    r.grids.forEach((g) => {
      if (!g.ok) { console.log('  网格线 ⚠ 未测到（覆盖率 ' + g.coverage + '）'); return; }
      console.log('  网格线 y=' + g.y + ' 线色=' + g.lineColor + ' 底=' + g.bgColor
        + ' 覆盖率=' + g.coverage + ' → 对比度 ' + g.contrast + ':1，x 范围 ' + g.xMin + '..' + g.xMax);
    });
    if (r.halo) {
      console.log('  柱顶净空：' + r.halo.bars + ' 根柱，柱顶上方 2~3px 与 12~18px 差 Δ=' + r.halo.delta + '（对照空隙列 Δ=' + r.halo.controlDelta + '，发光净差 ' + r.halo.glowDelta + '）'
        + '（外2px=' + r.halo.nearColor + ' 底色=' + r.halo.bgColor + '）');
    }
  });

  console.log('\n--- 结论 ---');
  console.log('刻度文字最差对比度：' + worstTick + ':1（浅色验收 ≥4.0，深色 ≥4.5）');
  if (gridVals.length) console.log('网格线对比度：' + Math.min.apply(null, gridVals).toFixed(2) + ' ~ ' + Math.max.apply(null, gridVals).toFixed(2) + ':1（合理 1.2~1.6）');
  if (worstHalo >= 0) console.log('柱顶发光净差 Δ=' + worstHalo + '（验收 ≤4）');
  if (edges.ca != null && edges.ct != null) {
    console.log('绘图区右边界：日柱图 x=' + edges.ca + '，累计图 x=' + edges.ct + ' → 差 ' + Math.abs(edges.ca - edges.ct) + 'px（验收 ≤2px）');
  }
  if (edges.caLeft != null && edges.ctLeft != null) {
    console.log('绘图区左边界：日柱图 x=' + edges.caLeft + '，累计图 x=' + edges.ctLeft + ' → 差 ' + Math.abs(edges.caLeft - edges.ctLeft) + 'px');
  }
  console.log('报告：' + path.join(dir, 'axis-contrast-report.json'));
}

main();
