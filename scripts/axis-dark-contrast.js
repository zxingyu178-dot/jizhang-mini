// scripts/axis-dark-contrast.js
// 深色主题坐标轴「像素级」对比度实测（v1.4.4 深色补证）
//
// 为什么不用 CSS 变量直接算：文字与网格都是半透明色叠在玻璃渐变卡片上，
// 声明值 ≠ 屏幕值。只有截图像素能证明用户真正看到的对比度。
//
// 定位方式：读 tests/e2e/chart-axis-dark-probe.js 产出的 dark-report.json 里
// 采集的真实元素矩形（CSS px），按「截图宽 / windowWidth」换算成截图像素，
// 精确裁到刻度文字 / 网格线所在窗口——不靠肉眼猜坐标。
// 同时把每个测量区域裁成 *_crop.png，供人眼复核"量的确实是刻度文字"。
//
// 用法：node scripts/axis-dark-contrast.js <截图目录>
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
const saturation = (r, g, b) => {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
};

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

/** 区域内亮度众数（量化到 2/255 桶）→ 代表"底色" */
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
 * 在窗口内测「文字 vs 底色」。
 * 文字核心色 = 窗口中亮度最高的 10% 像素均值（避开抗锯齿边缘），
 * 另给一档「P75 中位字形像素」作为保守值。
 */
function measureText(img, rect) {
  const r = clampRect(img, rect);
  const bg = modalColor(img, r);
  const bgB = brightness(bg.r, bg.g, bg.b);
  const glyph = [];
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const p = img.px(x, y);
      if (brightness(p[0], p[1], p[2]) > bgB + 0.10) glyph.push(p);
    }
  }
  if (glyph.length < 4) return { ok: false, bg: bg, glyphCount: glyph.length };
  glyph.sort((a, b) => brightness(a[0], a[1], a[2]) - brightness(b[0], b[1], b[2]));
  const core = avgColor(glyph.slice(Math.floor(glyph.length * 0.90)));
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
    bgLum: Number(lb.toFixed(4)),
    coreLum: Number(relLum(core.r, core.g, core.b).toFixed(4)),
  };
}

/** 测网格线：给定网格线的 y（CSS px 换算后）与横向范围，取"比底色略亮"的横向像素中位色 vs 附近底色 */
function measureGrid(img, rect) {
  const yCss = Math.round(rect.y);
  const x0 = Math.max(0, Math.round(rect.x0));
  const x1 = Math.min(img.w, Math.round(rect.x1));
  // 底色：网格线上下各让开 4~9px 的同一横段（那里只有卡片底 / 柱子，没有线）
  const bgTop = modalColor(img, { x0: x0, x1: x1, y0: yCss - 9, y1: yCss - 4 });
  const bgBot = modalColor(img, { x0: x0, x1: x1, y0: yCss + 4, y1: yCss + 9 });
  const bg = bgTop.share >= bgBot.share ? bgTop : bgBot;
  const bgB = brightness(bg.r, bg.g, bg.b);

  // 1px CSS 线在 1.1667 倍缩放下可能占 1~2 行，取 y-1..y+2 里覆盖率最高的一行
  // 判据只用「亮度略高于底色」：本项目的底色本身偏蓝（b 通道高），
  // 用饱和度筛会把网格线一起筛掉（实测覆盖率归零），所以不做饱和度过滤。
  let bestRow = null;
  for (let y = yCss - 1; y <= yCss + 2; y++) {
    if (y < 0 || y >= img.h) continue;
    const cand = [];
    let eligible = 0;
    for (let x = x0; x < x1; x++) {
      // 柱子会盖住网格线（bars 在 DOM 里排在 grid 之后，后画的盖住先画的）：
      // 用「线下方 3px 是否明显比底色亮」判断该列有没有柱子，有的列直接排除，
      // 否则测到的是柱子边缘而不是网格线。
      const below = img.px(x, Math.min(img.h - 1, y + 3));
      if (brightness(below[0], below[1], below[2]) > bgB + 0.12) continue;
      eligible++;
      const p = img.px(x, y);
      const bb = brightness(p[0], p[1], p[2]);
      if (bb > bgB + 0.008 && bb < bgB + 0.18) cand.push(p);
    }
    const coverage = eligible > 0 ? cand.length / eligible : 0;
    if (!bestRow || coverage > bestRow.coverage) bestRow = { y: y, cand: cand, coverage: coverage, eligible: eligible };
  }
  if (!bestRow || bestRow.cand.length < 20) {
    return { ok: false, coverage: Number(((bestRow && bestRow.coverage) || 0).toFixed(2)), bgColor: `rgb(${bg.r},${bg.g},${bg.b})` };
  }
  const cand = bestRow.cand.slice().sort((a, b) => brightness(a[0], a[1], a[2]) - brightness(b[0], b[1], b[2]));
  const med = cand[Math.floor(cand.length * 0.5)];
  const lb = relLum(bg.r, bg.g, bg.b);

  // 卡片是同色系「光晕渐变」，同一行的底色从左到右能差一倍多（实测 rgb(5,6,10)~rgb(18,20,37)），
  // 用单一全局底色会失真。这里再按列做一次「局部底色」对比度，给出区间。
  const local = [];
  for (let x = x0; x < x1; x++) {
    const below = img.px(x, Math.min(img.h - 1, bestRow.y + 3));
    if (brightness(below[0], below[1], below[2]) > bgB + 0.12) continue;
    const p = img.px(x, bestRow.y);
    if (brightness(p[0], p[1], p[2]) <= bgB + 0.008) continue;
    // 局部底色：同列上方 6~3px（那里只有卡片底）
    const stack = [];
    for (let yy = bestRow.y - 6; yy <= bestRow.y - 3; yy++) {
      if (yy >= 0) stack.push(img.px(x, yy));
    }
    if (!stack.length) continue;
    const lbg = avgColor(stack);
    local.push(contrast(relLum(p[0], p[1], p[2]), relLum(lbg.r, lbg.g, lbg.b)));
  }
  local.sort((a, b) => a - b);

  return {
    ok: true,
    y: bestRow.y,
    coverage: Number(bestRow.coverage.toFixed(2)),
    lineColor: `rgb(${med[0]},${med[1]},${med[2]})`,
    bgColor: `rgb(${bg.r},${bg.g},${bg.b})`,
    contrast: Number(contrast(relLum(med[0], med[1], med[2]), lb).toFixed(2)),
    lineLum: Number(relLum(med[0], med[1], med[2]).toFixed(4)),
    bgLum: Number(lb.toFixed(4)),
    local: local.length ? {
      samples: local.length,
      min: Number(local[0].toFixed(2)),
      median: Number(local[Math.floor(local.length / 2)].toFixed(2)),
      max: Number(local[local.length - 1].toFixed(2)),
    } : null,
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
function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('用法：node scripts/axis-dark-contrast.js <截图目录>');
    process.exit(1);
  }
  const rep = JSON.parse(fs.readFileSync(path.join(dir, 'dark-report.json'), 'utf8'));
  const windowWidth = rep.data.viewport.windowWidth;
  const outDir = path.join(dir, 'contrast-crops');
  fs.mkdirSync(outDir, { recursive: true });

  const shots = [
    { file: 'axis-01-daily-dark.png', key: 'rectsDaily', kind: 'ca', yTickCount: 3 },
    { file: 'axis-02-cumulative-dark.png', key: 'rectsCum', kind: 'ct', yTickCount: 3 },
    { file: 'axis-03-year-monthly-dark.png', key: 'rectsMonthly', kind: 'ca', yTickCount: 3 },
  ];

  const results = [];
  for (const s of shots) {
    const file = path.join(dir, s.file);
    if (!fs.existsSync(file)) {
      console.log('⚠ 缺图：' + s.file);
      continue;
    }
    const img = readPng(file);
    const scale = img.w / windowWidth;
    const rects = rep.data[s.key];
    const res = { shot: s.file, size: img.w + 'x' + img.h, scale: Number(scale.toFixed(4)), ticks: [], grids: [] };

    const root = rects.root || { left: 0, top: 0 };
    const ticks = (rects.ticks || []).slice(0, s.yTickCount);
    // 文字横向窗口 = 卡片左内边 → 柱区左沿（网格线 / 刻度列右界）
    const gutterRightCss = s.kind === 'ca'
      ? (rects.grids && rects.grids[0] ? rects.grids[0].rect.left : root.left + 60)
      : root.left + 35;

    ticks.forEach((t, i) => {
      const yCss = t.rect.top;
      const rect = {
        x0: (root.left) * scale,
        x1: (gutterRightCss) * scale,
        y0: (yCss - 5) * scale,
        y1: (yCss + 17) * scale,
      };
      const m = measureText(img, rect);
      m.label = t.text;
      if (m.ok) {
        m.crop = saveCrop(img, s.file.replace('.png', '') + '_tick' + (i + 1), rect, outDir, 6);
      }
      res.ticks.push(m);
    });

    // 网格线：只测最上面那条（柱子最少遮挡、最干净）。
    // 注意 DOM 顺序：grid 是跟 ticks 同序渲染的，grids[0] 是最底部那条（刻度 0），
    // 所以取 top 最小的一条 = 最高刻度那条。
    if (rects.grids && rects.grids.length) {
      const topGrid = rects.grids.slice().sort((a, b) => a.rect.top - b.rect.top)[0];
      const m = measureGrid(img, {
        x0: gutterRightCss * scale,
        x1: (windowWidth - root.left) * scale,
        y: topGrid.rect.top * scale,
      });
      const gy = m.ok ? m.y : topGrid.rect.top * scale;
      m.crop = saveCrop(img,
        s.file.replace('.png', '') + '_grid',
        { x0: gutterRightCss * scale, x1: (windowWidth - root.left) * scale, y0: gy - 12, y1: gy + 13 },
        outDir, 3);
      res.grids.push(m);
    }

    results.push(res);
  }

  const out = { generatedAt: new Date().toISOString(), dir: dir, windowWidth: windowWidth, results: results };
  fs.writeFileSync(path.join(dir, 'contrast-report.json'), JSON.stringify(out, null, 2), 'utf8');

  console.log('=== 深色坐标轴对比度实测（WCAG 2.x，截图缩放比 ' + results[0].scale + '）===');
  let worstTick = 99;
  let gridVals = [];
  for (const r of results) {
    console.log('\n## ' + r.shot);
    r.ticks.forEach((t) => {
      if (!t.ok) {
        console.log('  「' + t.label + '」⚠ 窗口内未找到文字像素（glyph=' + t.glyphCount + '，底=' + t.bgColor + '）');
        return;
      }
      worstTick = Math.min(worstTick, t.coreContrast);
      console.log('  刻度「' + t.label + '」文字=' + t.coreColor + ' 底=' + t.bgColor
        + ' → 核心对比度 ' + t.coreContrast + ':1（字形中位 ' + t.medianContrast + ':1）'
        + (t.coreContrast >= 3 ? ' ✓' : ' ✗ 低于 3:1'));
    });
    r.grids.forEach((g) => {
      if (!g.ok) {
        console.log('  网格线 ⚠ 未测到（覆盖率 ' + g.coverage + '）');
        return;
      }
      gridVals.push(g.contrast);
      const pass = g.contrast >= 1.2 && g.contrast <= 2.0;
      console.log('  网格线 y=' + g.y + ' 线色=' + g.lineColor + ' 底=' + g.bgColor
        + ' 覆盖率=' + g.coverage + ' → 全局底色对比度 ' + g.contrast + ':1' + (pass ? ' ✓ 在 1.2~2:1' : ' ✗ 超出 1.2~2:1'));
      if (g.local) {
        const lp = g.local.median >= 1.2 && g.local.median <= 2.0;
        console.log('       局部底色逐列对比度：' + g.local.min + ' ~ ' + g.local.max
          + ':1，中位 ' + g.local.median + ':1（' + g.local.samples + ' 列）' + (lp ? ' ✓' : ' ✗'));
        gridVals.push(g.local.median);
      }
    });
  }
  console.log('\n--- 结论 ---');
  console.log('刻度文字最差对比度：' + worstTick + ':1（验收线 ≥3:1）' + (worstTick >= 3 ? ' 通过' : ' 不通过'));
  if (gridVals.length) {
    console.log('网格线对比度区间：' + Math.min.apply(null, gridVals) + ' ~ ' + Math.max.apply(null, gridVals) + ':1（合理区间 1.2~2:1）');
  }
  console.log('报告：' + path.join(dir, 'contrast-report.json'));
}

main();
