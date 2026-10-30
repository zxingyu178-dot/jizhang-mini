// components/category-donut/category-donut.js
// 分类占比环形图：data/statistics/donut 纯计算动态生成 SVG，base64 成 data-URI 交给 <image>。
// v1.3.1 起支持真实触摸命中分段：选中高亮、中心切换分类名/金额/占比、图例同步、点击中心钻取。
// v1.3.2 手势重构：touchstart 不再立即选中，改为 start/move/end/cancel 完整识别，
//   区分点击与上下滑动、不阻止页面滚动；颜色只由稳定 categoryId 决定。
// 不引 ECharts、不用 Canvas；深浅主题切换重染，完全离线。

const theme = require('../../utils/theme');
const money = require('../../data/money');
const { b64encodeAscii } = require('../../utils/b64');
const {
  buildDonutSVG,
  hitSegment,
  localToViewBox,
} = require('../../data/statistics/donut');

// 背景轨道颜色（主题感知；分段颜色为确定性 HSL，在两主题下均可读）
const TRACK_COLORS = {
  dark: 'rgba(255,255,255,0.10)',
  light: 'rgba(25,28,40,0.08)',
};

// —— 手势识别参数 ——
const MOVE_TOLERANCE_PX = 10; // 点击位移阈值：超过即判定为滑动
const MAX_TAP_DURATION_MS = 600; // 点击最长时长：超过视为长按，不触发点击
const DEFAULT_THEME = 'dark';

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
      this._gSeq = 0;
      this._clearGestureState();
      this.resetDisplay();
      this.refresh();
    },
    detached() {
      if (this._offTheme) { this._offTheme(); this._offTheme = null; }
      this.cancelGesture(); // 销毁：取消手势，使在途异步回调失效
    },
  },
  observers: {
    // 数据或尺寸变化：失效旧手势与旧选中（切年月 / 重新加载由外部触发），重画
    'segments, size': function () {
      this.cancelGesture();
      this.setData({ selectedIndex: -1, hasSelection: false });
      this.resetDisplay();
      this.refresh();
    },
  },
  methods: {
    /** 当前有效主题 key（dark/light），未知值安全回退 dark */
    effectiveThemeKey() {
      let t = DEFAULT_THEME;
      try { t = theme.getEffectiveTheme(); } catch (e) { t = DEFAULT_THEME; }
      return t === 'light' ? 'light' : DEFAULT_THEME;
    },
    resolveTrackColor() {
      const t = this.effectiveThemeKey();
      return TRACK_COLORS[t] || TRACK_COLORS.dark;
    },
    refresh() {
      const themeKey = this.effectiveThemeKey();
      const svg = buildDonutSVG(
        this.data.segments,
        this.resolveTrackColor(),
        this.data.selectedIndex,
        themeKey
      );
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

    /* ================= 手势识别（v1.3.2） ================= */

    /**
     * 触摸开始：只记录初始坐标 / 时间 / identifier / 候选态，不做任何选中。
     * 多指隔离：已有手势在进行时，忽略新加入的其他手指，整个手势只绑定最先落下的
     * 那根手指；优先取本次新加入的 changedTouches，避免从全量 touches 里错拿别的手指。
     */
    onTouchStart(e) {
      if (this._gActive) return; // 第一根手指的手势未结束，新手指一律忽略
      const touch = firstTouch(e.changedTouches) || firstTouch(e.touches);
      if (!touch) return;
      this._gSeq += 1;
      const seq = this._gSeq;
      this._gActive = true;
      this._gId = touch.identifier;
      this._gStartX = touch.clientX;
      this._gStartY = touch.clientY;
      this._gStartTime = Date.now();
      this._gMoved = false;
      this._gMaxDist = 0;
      this._gRect = null;
      // 预取容器 rect 仅作缓存（不选中）；回调带 seq 守卫，过期结果丢弃
      wx.createSelectorQuery()
        .in(this)
        .select('.cd')
        .boundingClientRect((rect) => {
          if (seq !== this._gSeq || !this._gActive) return;
          if (rect && rect.width && rect.height) this._gRect = rect;
        })
        .exec();
    },

    /** 触摸移动：累计最大位移，超过阈值标记滑动；不 preventDefault、不阻止页面滚动 */
    onTouchMove(e) {
      if (!this._gActive) return;
      const touch = this.findGestureTouch(e.changedTouches) || this.findGestureTouch(e.touches);
      if (!touch) return;
      const dx = touch.clientX - this._gStartX;
      const dy = touch.clientY - this._gStartY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > this._gMaxDist) this._gMaxDist = dist;
      if (this._gMaxDist > MOVE_TOLERANCE_PX) this._gMoved = true;
    },

    /**
     * 触摸结束：同一手指 + 位移未超阈值 + 时长符合 + 最终坐标落在有效分段，才识别为点击。
     * 多指隔离：若抬起的不是当前手势的那根手指（其他手指先抬起），保持手势不变，
     * 不清理状态；只有绑定的手指抬起，才进入点击判定。
     */
    async onTouchEnd(e) {
      if (!this._gActive) return;
      const seq = this._gSeq;
      const gId = this._gId;
      const touch = this.pickEndTouch(e.changedTouches, gId);
      if (!touch) return; // 抬起的是其他手指，当前手势继续，不清理
      const duration = Date.now() - this._gStartTime;
      const moved = this._gMoved || this._gMaxDist > MOVE_TOLERANCE_PX;
      const segCount = this.data.segments.length;
      let rect = this._gRect; // 缓存优先
      this._clearGestureState(); // 确认是绑定手指抬起，再清当前手势（不递增 seq）

      if (moved) return; // 滑动：不选中，页面滚动不受影响
      if (duration > MAX_TAP_DURATION_MS) return; // 长按：不触发点击

      if (!rect) rect = await this.queryRect(seq);
      // await 期间若已开始新手势 / 数据已刷新，丢弃本次结果（防异步污染）
      if (seq !== this._gSeq || !rect) return;
      if (this.data.segments.length !== segCount) return;

      const localX = touch.clientX - rect.left;
      const localY = touch.clientY - rect.top;
      const vb = localToViewBox(localX, localY, rect.width, rect.height);
      const idx = hitSegment(this.data.segments, vb.x, vb.y);
      if (idx < 0) return; // 中心孔 / 圆环外：不误选
      this.applySelection(idx);
    },

    /** 触摸取消：清理手势状态，不残留选中 */
    onTouchCancel() {
      this._clearGestureState();
    },

    /* ---------- 手势辅助（严格 identifier 匹配，不拿别的手指顶替） ---------- */
    /**
     * 从触摸列表中找出当前手势所属的那根手指。
     * 原始 identifier 找不到时返回 null，绝不退回 list[0] 拿另一根手指的坐标，
     * 否则会把别的手指的位置误判成当前手势，造成点击/滑动错位。
     */
    findGestureTouch(list) {
      if (!list || !list.length) return null;
      if (this._gId === null || this._gId === undefined) return null;
      return list.find((t) => t.identifier === this._gId) || null;
    },
    /** 结束时同样只认绑定的 gId；找不到（其他手指抬起）返回 null。 */
    pickEndTouch(list, gId) {
      if (!list || !list.length) return null;
      if (gId === null || gId === undefined) return null;
      return list.find((t) => t.identifier === gId) || null;
    },
    /** 发起一次容器 rect 查询（带 seq 守卫），返回 Promise */
    queryRect(seq) {
      return new Promise((resolve) => {
        wx.createSelectorQuery()
          .in(this)
          .select('.cd')
          .boundingClientRect((rect) => {
            if (seq !== this._gSeq) return resolve(null);
            if (!rect || !rect.width || !rect.height) return resolve(null);
            resolve(rect);
          })
          .exec();
      });
    },
    _clearGestureState() {
      this._gActive = false;
      this._gMoved = false;
      this._gMaxDist = 0;
      this._gRect = null;
      this._gId = null;
    },
    /** 数据变化 / 组件失效：清理手势并递增 seq，使在途异步回调全部失效 */
    cancelGesture() {
      this._clearGestureState();
      this._gSeq = (this._gSeq || 0) + 1;
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
    /** 聚合项包含的真实分类数量（由外部通过 aggCount 属性注入更准确） */
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
      this.cancelGesture();
      this.setData({ selectedIndex: -1, hasSelection: false });
      this.resetDisplay();
      this.refresh();
    },
  },
});

function firstTouch(list) {
  return list && list.length ? list[0] : null;
}
