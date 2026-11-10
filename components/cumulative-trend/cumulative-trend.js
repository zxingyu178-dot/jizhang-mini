// components/cumulative-trend/cumulative-trend.js
// 累计消费趋势图（v1.3.0 Gate G）：用 data/statistics/cumulative 的纯计算动态生成
// 「面积 + 折线」SVG，再 base64 成 data-URI 交给 <image>。不引图表库、不用 Canvas，
// 深浅主题切换时重染，截图稳定。
//
// v1.4.3 修复：SVG 的 viewBox 必须与「实际显示盒」同宽高比，否则 aspectFit 会等比
// 缩成正方形、两侧留白（真机上表现为「曲线只画到卡片 2/3 就断了」）。
// 做法：ready 后用 createSelectorQuery 量一次容器真实宽高，按该尺寸生成 SVG。

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
    width: { type: Number, value: 320 }, // 兜底宽度（量不到容器时用）
    height: { type: Number, value: 180 }, // 视觉盒高 px
  },
  data: {
    uri: '',
  },
  lifetimes: {
    attached() {
      try { theme.init(); } catch (e) { /* 忽略 */ }
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
    'points, max, width, height': function () {
      this.measureAndRefresh();
    },
  },
  methods: {
    resolveGridColor() {
      let t = 'dark';
      try { t = theme.getEffectiveTheme(); } catch (e) { t = 'dark'; }
      return GRID_COLORS[t] || GRID_COLORS.dark;
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
      const svg = buildCumulativeSVG(this.data.points, this.data.max, this.resolveGridColor(), { w, h });
      const uri = 'data:image/svg+xml;base64,' + b64encodeAscii(svg);
      this.setData({ uri });
    },
  },
});
