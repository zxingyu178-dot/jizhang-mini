// components/cumulative-trend/cumulative-trend.js
// 累计消费趋势图（v1.3.0 Gate G）：用 data/statistics/cumulative 的纯计算动态生成
// 「面积 + 折线」SVG，再 base64 成 data-URI 交给 <image>。不引图表库、不用 Canvas，
// 深浅主题切换时重染，截图稳定。

const theme = require('../../utils/theme');
const { b64encodeAscii } = require('../../utils/b64');
const { buildCumulativeSVG } = require('../../data/statistics/cumulative');

// 网格线颜色（主题感知）
const GRID_COLORS = {
  dark: 'rgba(255,255,255,0.12)',
  light: 'rgba(25,28,40,0.10)',
};

Component({
  properties: {
    // computeCumulativeTrend().points：含 cumCents
    points: { type: Array, value: [] },
    max: { type: Number, value: 0 }, // 累计最大值
    width: { type: Number, value: 320 }, // 视觉盒宽 px
    height: { type: Number, value: 180 }, // 视觉盒高 px
  },
  data: {
    uri: '',
  },
  lifetimes: {
    attached() {
      try { theme.init(); } catch (e) { /* 忽略 */ }
      this._offTheme = theme.subscribe(() => this.refresh());
      this.refresh();
    },
    detached() {
      if (this._offTheme) { this._offTheme(); this._offTheme = null; }
    },
  },
  observers: {
    'points, max, width, height': function () {
      this.refresh();
    },
  },
  methods: {
    resolveGridColor() {
      let t = 'dark';
      try { t = theme.getEffectiveTheme(); } catch (e) { t = 'dark'; }
      return GRID_COLORS[t] || GRID_COLORS.dark;
    },
    refresh() {
      const svg = buildCumulativeSVG(this.data.points, this.data.max, this.resolveGridColor());
      const uri = 'data:image/svg+xml;base64,' + b64encodeAscii(svg);
      this.setData({ uri });
    },
  },
});
