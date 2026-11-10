// components/cumulative-trend/cumulative-trend.js
// 累计消费趋势图（v1.3.0 Gate G）：用 data/statistics/cumulative 的纯计算动态生成
// 「面积 + 折线」SVG，再 base64 成 data-URI 交给 <image>。不引图表库、不用 Canvas，
// 深浅主题切换时重染，截图稳定。
//
// v1.4.3 修复：SVG 的 viewBox 必须与「实际显示盒」同宽高比，否则 aspectFit 会等比
// 缩成正方形、两侧留白（真机上表现为「曲线只画到卡片 2/3 就断了」）。
// 做法：ready 后用 createSelectorQuery 量一次容器真实宽高，按该尺寸生成 SVG。
//
// v1.4.4：加坐标轴 —— Y 轴 3 档金额刻度（0 / ½顶档 / 顶档）+ 底部 3 个日期标签。
// 刻度文字**不画进 SVG**：<image> 走的是图片渲染管线，SVG <text> 的字体与基线在不同
// 设备/字体缩放设置下不保证一致（可能被系统字体替换、也可能基线偏移）。改为 WXML 原生
// <text> 绝对定位叠在图上：字体走小程序原生、颜色走主题变量、窄屏可单独调字号。
// 因为 SVG 的 viewBox 与显示盒是 1:1 像素（见 v1.4.3），所以 computeGeometry/tickY/xAt
// 算出的 px 坐标可以直接当 CSS 的 top / left 用，刻度线与刻度文字天然对齐。
//
// v1.4.4 终检：折线只画到「数据截止日」——整月 30 个点全画会让 11/10 之后沿最后值平到
// 月末，视觉上等于「10 号以后一分钱没花」。现在按截止日过滤点、横轴仍按整月跨度定位，
// 右侧留空 + 末端实心圆点标「数据到此为止」。截止日 = 当月 → 今天，历史月 → 该月天数。

const theme = require('../../utils/theme');
const device = require('../../utils/device');
const axis = require('../../data/statistics/axis');
const { b64encodeAscii } = require('../../utils/b64');
const C = require('../../data/statistics/cumulative');

// 网格线颜色（主题感知）：与 app.wxss 的 --chart-grid 同一组口径
const GRID_COLORS = {
  dark: 'rgba(255,255,255,0.12)',
  light: 'rgba(80,90,130,0.20)',
};

/** 刻度字号（px）：窄屏 10px，其余 11px；不用 rpx，避免窄屏被缩到 9px 以下看不清 */
const FONT_NARROW = 10;
const FONT_NORMAL = 11;

function r2(n) { return Math.round(n * 100) / 100; }

Component({
  properties: {
    // computeCumulativeTrend().points：含 cumCents / day（整月，裁剪在组件内做）
    points: { type: Array, value: [] },
    max: { type: Number, value: 0 }, // 累计最大值（分）
    width: { type: Number, value: 320 }, // 兜底宽度（量不到容器时用）
    height: { type: Number, value: 180 }, // 视觉盒高 px
    month: { type: Number, value: 0 }, // 1-12，用于 X 轴日期标签（M/DD）与截止日；0 = 退回「N日」
    // 与同列柱图共用的 Y 轴留白（px）：0 = 按自己的最高档文字自适应。
    // 由 statistics-panel 传入，保证两张图的左边界对齐（终检⑥）
    gutter: { type: Number, value: 0 },
  },
  data: {
    uri: '',
    hasData: false,
    gutterPx: 30, // 左侧 Y 轴刻度列宽（px）
    fontPx: FONT_NORMAL,
    yTicks: [], // [{key,label,topPx}]
    xLabels: [], // [{key,label,leftPx}]
    xTopPx: 160, // X 轴日期标签的 top（px）
  },
  lifetimes: {
    attached() {
      try { theme.init(); } catch (e) { /* 主题未初始化时按深色画，不影响可用性 */ }
      this._offTheme = theme.subscribe(() => this.refresh());
      this.refresh(); // 先用兜底尺寸画一版，避免空白
    },
    ready() {
      // 布局完成后量真实宽度，按真实比例重绘（本次修复的关键）
      this.measureAndRefresh();
    },
    detached() {
      if (this._offTheme) { this._offTheme(); this._offTheme = null; }
    },
  },
  observers: {
    'points, max, width, height, month, gutter': function () {
      this.measureAndRefresh();
    },
  },
  methods: {
    resolveGridColor() {
      let t = 'dark';
      try { t = theme.getEffectiveTheme(); } catch (e) { t = 'dark'; }
      return GRID_COLORS[t] || GRID_COLORS.dark;
    },
    resolveFontPx() {
      let narrow = false;
      try { narrow = device.isNarrowScreen(); } catch (e) { narrow = false; }
      return narrow ? FONT_NARROW : FONT_NORMAL;
    },
    /** 横轴总跨度（整月天数）：X 轴位置按它算，折线长度才只占到截止日 */
    resolveSpanDays(count) {
      const m = Number(this.data.month);
      if (!(Number.isFinite(m) && m >= 1 && m <= 12)) return count;
      const now = new Date();
      return new Date(now.getFullYear(), m, 0).getDate(); // 该月天数（含闰年 / 大小月）
    },
    /**
     * 数据截止日（1-31）：当月 → 今天；其它月 → 该月天数（历史月本身就是完整的）。
     * 只看 month（组件没有年份入参），当月判定用当前月份。
     */
    resolveCutoffDay() {
      const m = Number(this.data.month);
      if (!(Number.isFinite(m) && m >= 1 && m <= 12)) return 0; // 0 = 不裁剪
      const now = new Date();
      if (m === now.getMonth() + 1) return now.getDate();
      return new Date(now.getFullYear(), m, 0).getDate();
    },
    /** 量容器真实宽高；量不到就退回属性值（只影响精度，不影响正确性） */
    measureAndRefresh() {
      try {
        const q = this.createSelectorQuery();
        q.select('.ct').boundingClientRect((r) => {
          if (r && r.width > 1 && r.height > 1) {
            this._box = { w: Math.round(r.width), h: Math.round(r.height) };
          }
          this.refresh();
        }).exec();
      } catch (e) {
        this.refresh();
      }
    },
    refresh() {
      const w = this._box ? this._box.w : this.data.width;
      const h = this._box ? this._box.h : this.data.height;
      const box = { w, h };
      const fontPx = this.resolveFontPx();
      const all = this.data.points || [];

      // 1) 只保留「数据截止日」及之前的点（右侧留空，不画平到月末的假折线）
      const spanDays = this.resolveSpanDays(all.length);
      const cutoff = this.resolveCutoffDay();
      const points = cutoff > 0
        ? all.filter((p) => Number(p && p.day) <= cutoff)
        : all;

      // 2) 纵轴最大值取「裁剪后」的点（累计单调不减 → 末点即最大值）：
      //    不能直接用传入的 max，否则截止日之后才有数据时比例尺会失真
      const max = points.reduce((m, p) => {
        const v = Number(p && p.cumCents);
        return Number.isFinite(v) && v > m ? v : m;
      }, 0);

      // 3) 整月没有支出（max ≤ 0）→ 空态：不画图，由外层卡片显示空态文案
      const hasData = points.length > 0 && max > 0;

      // 3) 先算刻度文字，再决定 Y 轴留白列宽：
      //    外部传了 gutter（与同列柱图统一）就用它，否则按文字实际宽度算
      const ticks = axis.buildTicks(max, C.TICK_COUNT, { prefix: '¥' });
      const topLabel = ticks.length ? ticks[ticks.length - 1].label : '0';
      const wantGutter = Number(this.data.gutter);
      const gutter = Number.isFinite(wantGutter) && wantGutter > 0
        ? Math.min(56, Math.max(22, Math.round(wantGutter)))
        : axis.axisGutterPx(topLabel, fontPx);
      const geo = C.computeGeometry(box, gutter, C.TICK_COUNT);

      const svg = hasData
        ? C.buildCumulativeSVG(points, max, this.resolveGridColor(), box, {
            padLeft: gutter,
            tickCount: C.TICK_COUNT,
            spanDays: spanDays,
          })
        : '';

      // 4) 刻度文字坐标：垂直中心压在网格线上（top 取 y - 半个字高，负值夹到 0）
      const yTicks = hasData
        ? ticks.map((t) => ({
            key: t.key,
            label: t.label,
            topPx: Math.max(0, r2(C.tickY(geo, t.ratio) - fontPx / 2)),
          }))
        : [];

      // 5) 底部日期标签：首日 / 中间日 / 末日（末 = 数据截止日），横向位置与折线同一 xAt
      const xLabels = hasData
        ? axis.pickDateLabels(points, this.data.month).map((x) => ({
            key: 'x-' + x.index,
            label: x.label,
            leftPx: C.xAt(geo, x.index, spanDays),
          }))
        : [];
      const xTopPx = r2(Math.min(h - fontPx - 1, geo.baseY + 3));

      this.setData({
        uri: hasData ? 'data:image/svg+xml;base64,' + b64encodeAscii(svg) : '',
        hasData,
        gutterPx: geo.padL,
        fontPx,
        yTicks,
        xLabels,
        xTopPx,
      });
    },
  },
});
