// utils/bar-shading.js
// 柱体「6 档明暗台阶」（v1.5.3）：明暗规则 + SVG 生成。纯函数，可在 Node 里直接测。
//
// 为什么不是 WXSS 渐变：多色标硬停渐变在组件 WXSS 里会被整条丢掉（v1.5.1 实测 3 次，
//   background-image 读计算样式恒为 null），柱子只能是一段软过渡。
// 为什么不是 Canvas：柱体改 Canvas 2D 后在本项目的统计页里**一个像素都画不出来**
//   （v1.5.3 实测：canvas 节点尺寸正确，但整块柱区在截图里是空的；见 CHANGELOG）。
//   改为「与累计折线 / 分类圆环同一条路」——生成 SVG，base64 成 data-URI 交给 <image>。
//   这条路在本项目已被证明可渲染，且仍是「每张图 1 个元素」，还能跟着 setData 自动更新。
//
// 明暗规则与环形图 / 折线（车削光影）同一套：只在「柱高」方向排明暗，横向不叠。
//   0~3%   顶倒角  本色            —— 必须是本色：混白高光顶到轮廓线上柱子轮廓就消失（浅色 40% 只有 2.01:1）
//   3~8%   顶光    混白 38% / 40%
//   8~15%  受光    混白 16% / 18%
//   15~80% 柱身    本色
//   80~93% 背光    混黑 26% / 30%
//   93~100% 接触暗 混黑 48% / 44%
//
// 混色一律在 JS 里算成实色 #rrggbb（mixHex），不用 opacity 叠：
//   叠 opacity 得到的是「和底下卡片混」，不是「和白色混」，明度结果完全不同。
//   混色比例与 app.wxss 的 --bar-cap / --bar-lit / --bar-shade / --bar-foot 一一对应。
//
// SVG 兼容约束（tests/svg-compat.test.js 同口径，勿破）：
//   - 只用 #rrggbb 实色（不写 rgba / hsl / url(#id)）；
//   - 不用 clipPath / mask / 渐变，所以顶部圆角用 path 的圆弧自己画；
//   - 坐标量化到 2 位小数（与 cumulative.js 一致，避免高精度在 <image> 下解析异常）。

const { mixHex } = require('./color-mix');

/** 底色兜底：主题未初始化时用深色默认主色（与 daily-value-curve 一致，不抛） */
const FALLBACK_PRIMARY = '#7c86ff';

/** 柱宽占列宽的比例：与旧 .bar{width:60%} 一致，柱间空隙不变 */
const BAR_WIDTH_RATIO = 0.6;

/**
 * 6 档台阶（占比 = 占柱高的比例，从柱顶往下）。
 * role 对应 paletteFor() 输出里的键名；body = 本色。
 */
const BANDS = [
  { from: 0.00, to: 0.03, role: 'body' },
  { from: 0.03, to: 0.08, role: 'cap' },
  { from: 0.08, to: 0.15, role: 'lit' },
  { from: 0.15, to: 0.80, role: 'body' },
  { from: 0.80, to: 0.93, role: 'shade' },
  { from: 0.93, to: 1.00, role: 'foot' },
];

/** 混色比例（深 / 浅两套；与 app.wxss 的 --bar-* 变量同值，测试锁住不许漂） */
const MIX = {
  dark: { cap: 0.38, lit: 0.16, shade: 0.26, foot: 0.48 },
  light: { cap: 0.40, lit: 0.18, shade: 0.30, foot: 0.44 },
};

/**
 * 低于这个柱高就退化：6 档在这个高度会互相挤没（每档不足 1px），
 * 直接画本色柱 + 顶部 1px 提亮。
 */
const MIN_BANDS_PX = 8;

/** '#7C86FF' → '#7c86ff'；非法输入回退主色兜底（图形宁可用错色也不整图崩） */
function normalizeHex(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex == null ? '' : hex).trim());
  if (!m) return FALLBACK_PRIMARY;
  return '#' + m[1].toLowerCase();
}

function r2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * 某主题下的 6 档实色。
 * @param {string} primary 当前主题主色（= CSS var(--primary)）
 * @param {string} themeKey 'dark' | 'light'
 * @returns {{body:string, cap:string, lit:string, shade:string, foot:string}} 全部 '#rrggbb'
 */
function paletteFor(primary, themeKey) {
  const m = MIX[themeKey === 'light' ? 'light' : 'dark'];
  const body = normalizeHex(primary);
  return {
    body: body,
    cap: mixHex(body, '#FFFFFF', m.cap),
    lit: mixHex(body, '#FFFFFF', m.lit),
    shade: mixHex(body, '#000000', m.shade),
    foot: mixHex(body, '#000000', m.foot),
  };
}

/**
 * 把柱高 h 切成 6 段整数像素高度（自上而下），合计严格 = Math.round(h)。
 *
 * 为什么不用「按比例直接取整」：小柱（10~20px）时 3% / 5% 档会各自取整成 0，
 * 台阶凭空少两级，看上去就是「一根纯色柱子」。这里先给每档保底 1px，
 * 余量再按原始比例分配（最大余数法补齐舍入误差）。
 *
 * @param {number} h 柱高（CSS px）
 * @returns {number[]} 长度 6 的整数数组
 */
function bandHeights(h) {
  const total = Math.max(0, Math.round(Number(h) || 0));
  const n = BANDS.length;
  if (total <= 0) return BANDS.map(() => 0);
  if (total <= n) return BANDS.map((b, i) => (i < total ? 1 : 0));
  const weights = BANDS.map((b) => b.to - b.from);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const rest = total - n; // 每档先保底 1px
  const out = [];
  const frac = [];
  for (let i = 0; i < n; i++) {
    const raw = (weights[i] / wsum) * rest;
    const base = Math.floor(raw);
    out.push(1 + base);
    frac.push({ i: i, f: raw - base });
  }
  let used = out.reduce((a, b) => a + b, 0);
  frac.sort((a, b) => b.f - a.f);
  let k = 0;
  while (used < total) {
    out[frac[k % n].i] += 1;
    used += 1;
    k += 1;
  }
  return out;
}

/** 顶部只有两个圆角的矩形路径（SVG 的 <rect rx> 会四个角都圆，所以顶档自己画） */
function roundedTopPath(x, yTop, w, h, radius) {
  const rr = Math.max(0, Math.min(radius || 0, w / 2, h));
  if (rr <= 0) {
    return 'M' + r2(x) + ' ' + r2(yTop) + 'h' + r2(w) + 'v' + r2(h) + 'h' + r2(-w) + 'Z';
  }
  return 'M' + r2(x) + ' ' + r2(yTop + h)
    + 'L' + r2(x) + ' ' + r2(yTop + rr)
    + 'A' + r2(rr) + ' ' + r2(rr) + ' 0 0 1 ' + r2(x + rr) + ' ' + r2(yTop)
    + 'L' + r2(x + w - rr) + ' ' + r2(yTop)
    + 'A' + r2(rr) + ' ' + r2(rr) + ' 0 0 1 ' + r2(x + w) + ' ' + r2(yTop + rr)
    + 'L' + r2(x + w) + ' ' + r2(yTop + h)
    + 'Z';
}

/**
 * 柱体 SVG（每张柱图 1 个 <image> 的数据源）。
 *
 * 几何（与旧 flex 布局等价，数据几何零变更）：
 *   列宽 = 图宽 / 点数；柱宽 = 列宽 × 60%，水平居中；
 *   柱高 = barHeightRpx / zoneRpx × 图高 —— 与 Y 轴刻度共用同一比例尺。
 *
 * @param {Array} points 点数组，每项含 barHeightRpx
 * @param {{width:number, height:number, zoneRpx:number, colors:Object, radius?:number}} opts
 * @returns {string} SVG 源码（不含 base64）
 */
function buildBarsSVG(points, opts) {
  const o = opts || {};
  const list = points || [];
  const w = Math.max(1, r2(o.width));
  const h = Math.max(1, r2(o.height));
  const zoneRpx = Number(o.zoneRpx) > 0 ? Number(o.zoneRpx) : h;
  const colors = o.colors || paletteFor(FALLBACK_PRIMARY, 'dark');
  const radius = Number(o.radius) > 0 ? Number(o.radius) : 0;
  const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + r2(w) + ' ' + r2(h) + '"'
    + ' width="' + r2(w) + '" height="' + r2(h) + '">';
  if (!list.length) return head + '</svg>';

  const n = list.length;
  const colW = w / n;
  const barW = Math.max(1, colW * BAR_WIDTH_RATIO);
  const body = [];

  for (let i = 0; i < n; i++) {
    const raw = Number(list[i].barHeightRpx) || 0;
    const ratio = Math.max(0, Math.min(1, raw / zoneRpx));
    const barH = ratio * h;
    if (barH <= 0) continue; // 0 值不画柱子（与旧 0 高度 view 一致），但保留列位
    const x = i * colW + (colW - barW) / 2;
    const yTop = h - barH;

    if (barH < MIN_BANDS_PX) {
      // 退化：本色柱 + 顶部 1px 提亮（6 档在这个高度会互相挤没）
      body.push('<rect x="' + r2(x) + '" y="' + r2(yTop) + '" width="' + r2(barW) + '" height="' + r2(barH)
        + '" fill="' + colors.body + '"/>');
      body.push('<rect x="' + r2(x) + '" y="' + r2(yTop) + '" width="' + r2(barW) + '" height="1" fill="' + colors.cap + '"/>');
      continue;
    }

    const hs = bandHeights(barH);
    let y = yTop;
    for (let k = 0; k < hs.length; k++) {
      const bh = hs[k];
      if (bh <= 0) continue;
      const role = BANDS[k].role;
      if (k === 0) {
        // 顶档：顶部两角是圆角（与旧 .bar{border-radius:8rpx 8rpx 0 0} 同形）。
        // 圆角半径夹在顶档高度内，圆弧不会跨出这一档 —— 下面的档就能用普通矩形，不需要 clipPath。
        body.push('<path d="' + roundedTopPath(x, y, barW, bh, Math.min(radius, bh)) + '" fill="' + colors[role] + '"/>');
      } else {
        body.push('<rect x="' + r2(x) + '" y="' + r2(y) + '" width="' + r2(barW) + '" height="' + r2(bh)
          + '" fill="' + colors[role] + '"/>');
      }
      y += bh;
    }
  }
  return head + body.join('') + '</svg>';
}

module.exports = {
  BANDS,
  MIX,
  MIN_BANDS_PX,
  BAR_WIDTH_RATIO,
  FALLBACK_PRIMARY,
  normalizeHex,
  paletteFor,
  bandHeights,
  roundedTopPath,
  buildBarsSVG,
};
