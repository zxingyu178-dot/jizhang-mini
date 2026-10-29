// components/category-donut/category-donut.js
// 分类占比环形图（v1.3.0）：用 data/statistics/donut 的纯计算动态生成 SVG，
// 再 base64 成 data-URI 交给 <image> 渲染；中心金额/标签用 WXML 覆盖。
// 不引 ECharts、不用 Canvas：无 Canvas 生命周期问题，深浅主题切换时重染，截图稳定。

const theme = require('../../utils/theme');
const { b64encodeAscii } = require('../../utils/b64');
const { buildDonutSVG } = require('../../data/statistics/donut');

// 背景轨道颜色（主题感知；分段颜色为固定调色板，在两主题下均可读）
const TRACK_COLORS = {
  dark: 'rgba(255,255,255,0.10)',
  light: 'rgba(25,28,40,0.08)',
};

Component({
  properties: {
    // computeCategoryShare().segments：含 ratio / categoryId / aggregate
    segments: { type: Array, value: [] },
    centerText: { type: String, value: '¥0.00' }, // 中心金额（外部格式化好传入）
    centerLabel: { type: String, value: '总支出' },
    size: { type: Number, value: 160 }, // 圆环视觉盒 px
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
    'segments, size': function () {
      this.refresh();
    },
  },
  methods: {
    resolveTrackColor() {
      let t = 'dark';
      try { t = theme.getEffectiveTheme(); } catch (e) { t = 'dark'; }
      return TRACK_COLORS[t] || TRACK_COLORS.dark;
    },
    refresh() {
      const svg = buildDonutSVG(this.data.segments, this.resolveTrackColor());
      const uri = 'data:image/svg+xml;base64,' + b64encodeAscii(svg);
      this.setData({ uri });
    },
  },
});
