// components/category-donut/category-donut.js
// 分类占比环形图：data/statistics/donut 纯计算动态生成 SVG，base64 成 data-URI 交给 <image>。
// v1.3.1 起支持真实触摸命中分段：选中高亮、中心切换分类名/金额/占比、图例同步、点击中心钻取。
// 不引 ECharts、不用 Canvas；深浅主题切换重染，完全离线。

const theme = require('../../utils/theme');
const money = require('../../data/money');
const { b64encodeAscii } = require('../../utils/b64');
const {
  buildDonutSVG,
  hitSegment,
  localToViewBox,
} = require('../../data/statistics/donut');

// 背景轨道颜色（主题感知；分段颜色为固定调色板，在两主题下均可读）
const TRACK_COLORS = {
  dark: 'rgba(255,255,255,0.10)',
  light: 'rgba(25,28,40,0.08)',
};

Component({
  properties: {
    // computeCategoryShare().segments：含 ratio / categoryId / aggregate / cents / percentText
    segments: { type: Array, value: [] },
    centerText: { type: String, value: '¥0.00' }, // 未选中时中心金额（外部格式化好传入）
    centerLabel: { type: String, value: '总支出' },
    size: { type: Number, value: 160 }, // 圆环视觉盒 px
    aggCount: { type: Number, value: 0 }, // 聚合「其他」包含的真实分类数（面板注入）
  },
  data: {
    uri: '',
    selectedIndex: -1, // -1 表示无选中
    hasSelection: false,
    dispAmount: '', // 中心主金额
    dispLabel: '', // 中心标签（分类名 / 总支出）
    dispSub: '', // 中心副信息（占比 / 聚合分类数）
  },
  lifetimes: {
    attached() {
      try { theme.init(); } catch (e) { /* 忽略 */ }
      this._offTheme = theme.subscribe(() => this.refresh());
      this.resetDisplay();
      this.refresh();
    },
    detached() {
      if (this._offTheme) { this._offTheme(); this._offTheme = null; }
    },
  },
  observers: {
    // 数据或尺寸变化：失效旧选中（切年月 / 重新加载由外部触发），重画
    'segments, size': function () {
      this.setData({ selectedIndex: -1, hasSelection: false });
      this.resetDisplay();
      this.refresh();
    },
  },
  methods: {
    resolveTrackColor() {
      let t = 'dark';
      try { t = theme.getEffectiveTheme(); } catch (e) { t = 'dark'; }
      return TRACK_COLORS[t] || TRACK_COLOR.dark;
    },
    refresh() {
      const svg = buildDonutSVG(this.data.segments, this.resolveTrackColor(), this.data.selectedIndex);
      const uri = 'data:image/svg+xml;base64,' + b64encodeAscii(svg);
      this.setData({ uri });
    },
    /** 未选中态中心信息回到外部传入的总额 */
    resetDisplay() {
      this.setData({
        dispAmount: this.data.centerText,
        dispLabel: this.data.centerLabel,
        dispSub: '',
      });
    },
    /** 触摸圆环：命中分段则选中，未命中（中心孔 / 外部）不改变选中 */
    onTouchStart(e) {
      const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (!touch) return;
      wx.createSelectorQuery()
        .in(this)
        .select('.cd')
        .boundingClientRect((rect) => {
          if (!rect || !rect.width || !rect.height) return;
          const localX = touch.clientX - rect.left;
          const localY = touch.clientY - rect.top;
          const vb = localToViewBox(localX, localY, rect.width, rect.height);
          const idx = hitSegment(this.data.segments, vb.x, vb.y);
          if (idx < 0) return; // 中心孔 / 外部：不误选
          this.applySelection(idx);
        })
        .exec();
    },
    /** 应用选中：更新中心信息、重画、通知面板同步图例 */
    applySelection(idx) {
      const seg = this.data.segments[idx];
      if (!seg) return;
      const amountText = '¥' + money.formatCents(seg.cents);
      let sub;
      if (seg.aggregate) {
        sub = '包含 ' + this.countAggregated() + ' 个分类';
      } else {
        sub = seg.percentText + '%';
      }
      this.setData({
        selectedIndex: idx,
        hasSelection: true,
        dispAmount: amountText,
        dispLabel: seg.name,
        dispSub: sub,
      });
      this.refresh();
      this.triggerEvent('select', { index: idx, segment: seg });
    },
    /** 聚合项包含的真实分类数量（segments 外无法直接知道，由聚合段 count 语义近似：
     *  聚合段 count 是账单笔数而非分类数，分类数由外部通过 aggregatedCount 属性传入更准确，
     *  这里回退用 panel 注入的 aggCount 字段） */
    countAggregated() {
      return this.data.aggCount > 0 ? this.data.aggCount : '';
    },
    /** 点击中心：选中态触发钻取；未选中无操作 */
    onTapCenter() {
      if (!this.data.hasSelection) return;
      const idx = this.data.selectedIndex;
      const seg = this.data.segments[idx];
      if (!seg) return;
      this.triggerEvent('drill', { index: idx, segment: seg });
    },
    /** 供外部（面板切年月 / 模式）主动清除选中 */
    clearSelection() {
      this.setData({ selectedIndex: -1, hasSelection: false });
      this.resetDisplay();
      this.refresh();
    },
  },
});
