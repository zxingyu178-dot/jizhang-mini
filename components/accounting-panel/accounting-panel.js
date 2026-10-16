// components/accounting-panel/accounting-panel.js
// 记账 Panel（v0.3.2 对齐 Android AccountingPage）：
// - Hero 卡作为唯一月份区域（月份 / 箭头 / 本月支出 / 收入·结余 / 滑动提示），固定在时间线之上
// - Hero 横滑切月：catchtouchmove 在视图层拦截（不嵌套 swiper、不依赖 setData 时序），绝不误切一级 Tab
// - 连续账单时间线（独立 scroll-view 垂直滚动，按天分组，透明行 + 细分割线，不再按日套 card）
// 数据来自正式本地数据层（data/index，Bill V1 / 整数分 / 月份分片），展示逻辑走 data/accounting 纯函数。
const store = require('../../data/index');
const money = require('../../data/money');
const device = require('../../utils/device');
const acc = require('../../data/accounting');

// 横滑切月阈值（px）
const SWIPE_X = 56;
const SWIPE_RATIO = 1.25;

Component({
  data: {
    ym: '',
    monthList: [],
    monthLabel: '',
    canPrev: false,
    canNext: false,
    monthExpenseText: '¥0.00',
    monthIncomeText: '¥0.00',
    monthBalanceText: '¥0.00',
    expenseSizeClass: 'hero__expense--lg',
    timeline: [],
    isEmpty: true,
    listPadBottom: 0, // 底部为 FAB 预留安全区（px）
    heroAnim: false,
  },
  lifetimes: {
    attached() {
      // 底部 padding = safeBottom + FAB 高度(116rpx→px) + 24px
      const info = device.measure();
      const fabPx = (116 * info.windowWidth) / 750;
      const listPadBottom = Math.round(info.safeBottom + fabPx + 24);
      this.setData({ listPadBottom });
      // 自加载：App 冷启动默认进入记账页，不能依赖父页面 onReady 时
      // selectComponent 已就绪（swiper-item 内组件可能尚未 ready，否则首屏空月）。
      // 本面板无依赖布局尺寸的图表，attached 时数据层（App onLaunch 已 init）即可取数。
      // activate 内有 _loaded guard，父页面再次调用不会重复加载。
      this.activate();
    },
  },
  methods: {
    /** Main Shell 首次激活该 Panel 时调用（组件在 swiper-item 中，仅加载一次） */
    activate() {
      if (this._loaded) return;
      this._loaded = true;
      this.loadData(acc.currentYM());
    },
    /** 供父页面在新增 / 导入 / 删除后调用刷新 */
    refresh() {
      this.loadData(this.data.ym || acc.currentYM());
    },
    /** 加载某月份（ym 缺省回退当前月 / 当前查看月） */
    loadData(ym) {
      const cur = acc.currentYM();
      // 记账月份导航只取「至少有一笔普通账单」的月份 + 当前月，
      // 不含仅日价物品所在月 / 删空后的残留分片。
      const monthList = acc.buildMonthList(store.listAccountingMonths(), cur);
      let active = ym;
      if (monthList.indexOf(active) < 0) {
        active = monthList.indexOf(this.data.ym) >= 0 ? this.data.ym : cur;
      }
      if (monthList.indexOf(active) < 0) active = cur;

      const parts = active.split('-');
      const monthLabel = parts[0] + '年' + Number(parts[1]) + '月';

      const summary = store.monthSummary(active);
      const grouped = store.monthGrouped(active);
      const timeline = acc.buildTimeline(
        active,
        grouped,
        acc.todayKey(),
        undefined,
        (id) => store.getCategory(id)
      );

      const expenseText = '¥' + money.formatCents(summary.expense);
      const incomeText = '¥' + money.formatCents(summary.income);
      const balanceText = '¥' + money.formatCents(summary.balance);

      this.setData({
        ym: active,
        monthList,
        monthLabel,
        canPrev: acc.canShift(monthList, active, -1),
        canNext: acc.canShift(monthList, active, 1),
        monthExpenseText: expenseText,
        monthIncomeText: incomeText,
        monthBalanceText: balanceText,
        expenseSizeClass: this.expenseSizeClass(expenseText),
        timeline,
        isEmpty: summary.count === 0,
      });
      this.playAnim();
    },
    /** 主金额自适应字号（大金额不换行 / 不溢出） */
    expenseSizeClass(text) {
      const len = String(text).length; // 含 ¥、逗号、小数点
      if (len <= 8) return 'hero__expense--lg';
      if (len <= 11) return 'hero__expense--md';
      return 'hero__expense--sm';
    },
    /** 切月内容淡入 + 轻微纵向位移（禁止整页横向移动） */
    playAnim() {
      this.setData({ heroAnim: false });
      setTimeout(() => {
        this.setData({ heroAnim: true });
        clearTimeout(this._animTimer);
        this._animTimer = setTimeout(() => this.setData({ heroAnim: false }), 220);
      }, 20);
    },
    /** 上一月（箭头，强制可用 fallback） */
    onPrevMonth() {
      const next = acc.shiftMonth(this.data.monthList, this.data.ym, -1);
      if (next) this.loadData(next);
    },
    /** 下一月（不超过当前月） */
    onNextMonth() {
      const next = acc.shiftMonth(this.data.monthList, this.data.ym, 1);
      if (next) this.loadData(next);
    },
    /* ---- Hero 横滑切月（catchtouchmove 已在视图层拦截，不会冒泡给一级 Swiper） ---- */
    onHeroTouchStart(e) {
      const t = e.touches[0];
      this._tx = t.clientX;
      this._ty = t.clientY;
    },
    onHeroTouchMove(e) {
      // 仅记录位移；catchtouchmove 保证此 move 不会冒泡给一级 Swiper 翻页 / 页面横滑
      const t = e.touches[0];
      this._dx = t.clientX - this._tx;
      this._dy = t.clientY - this._ty;
    },
    onHeroTouchEnd(e) {
      const t = e.changedTouches[0];
      const dx = t.clientX - this._tx;
      const dy = t.clientY - this._ty;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      // 水平位移 > 56px 且明显水平（dx > dy*1.25）；左滑下月、右滑上月
      if (adx > SWIPE_X && adx > ady * SWIPE_RATIO) {
        if (dx < 0) this.onNextMonth();
        else this.onPrevMonth();
      }
    },
    onTapBill(e) {
      this.triggerEvent('tapbill', { id: e.currentTarget.dataset.id });
    },
  },
});
