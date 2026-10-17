// components/daily-value-panel/daily-value-panel.js
// 日价 Panel（v0.4.0 正式版）：
// - Hero 为第一视觉中心：「每日总花费 ¥xx / 天」+「N 件物品」；
// - 列表透明 + 轻 surface + 细分割（与记账时间线同一节奏，不做厚卡片），
//   每项：图标 / 名称 / 原价·起算日·已用N天 / 当前日价；默认按当前日价降序；
// - 点击进入二级「日价详情」页；新增由主 Shell 的全局玻璃 FAB（日价态）打开表单。
// 数据全部从 Bill 派生（data/daily-value 纯函数），不维护第二套数据库。
const store = require('../../data/index');
const money = require('../../data/money');
const device = require('../../utils/device');
const dv = require('../../data/daily-value/index');

/** 'yyyy-MM-dd' -> 'yyyy年M月d日' */
function fullDateText(s) {
  const p = String(s || '').split('-').map(Number);
  if (p.length < 3) return '';
  return p[0] + '年' + p[1] + '月' + p[2] + '日';
}

/** 分 / 天（浮点）→ '¥18.62/天'（取整到分） */
function formatDaily(cents) {
  return '¥' + money.formatCents(Math.round(cents)) + '/天';
}

Component({
  data: {
    today: '',
    totalText: '¥0.00/天',
    totalSizeClass: 'dv-hero__total--lg',
    countText: '0 件物品',
    items: [],
    isEmpty: true,
    listPadBottom: 0,
  },
  lifetimes: {
    attached() {
      // 底部为 FAB 预留安全区（与记账页一致）
      const info = device.measure();
      const fabPx = (116 * info.windowWidth) / 750;
      const listPadBottom = Math.round(info.safeBottom + fabPx + 24);
      this.setData({ listPadBottom });
      this.activate();
    },
  },
  methods: {
    /** Main Shell 首次激活该 Panel（swiper-item 内仅加载一次） */
    activate() {
      if (this._loaded) return;
      this._loaded = true;
      this.loadData();
    },
    /** 数据变化 / 跨日刷新时由父页面调用 */
    refresh() {
      this.loadData();
    },
    loadData() {
      const today = dv.localDateKey();
      const all = store.rangeBills();
      // 单次渲染快照：整个日价列表共用一个分类 resolver
      const list = dv.computeDailyValueList(
        all,
        today,
        store.getCategoryResolver()
      );
      const totalCents = dv.totalDailyValueCents(all, today);

      const items = list.map((it) => ({
        id: it.id,
        emoji: it.emoji || '📦',
        name: it.name,
        originText: '原价 ¥' + money.formatCents(it.amountCents),
        metaText: fullDateText(it.startDate) + ' · 已用' + it.elapsed + '天',
        dailyText: formatDaily(it.currentCents),
      }));

      const totalText = '¥' + money.formatCents(Math.round(totalCents)) + '/天';
      this.setData({
        today,
        totalText,
        totalSizeClass: this.sizeClass(totalText),
        countText: items.length + ' 件物品',
        items,
        isEmpty: items.length === 0,
      });
    },
    /** 主金额自适应字号（长金额不换行 / 不溢出） */
    sizeClass(text) {
      const len = String(text).length;
      if (len <= 10) return 'dv-hero__total--lg';
      if (len <= 13) return 'dv-hero__total--md';
      return 'dv-hero__total--sm';
    },
    onTapItem(e) {
      const id = e.currentTarget.dataset.id;
      wx.navigateTo({ url: '/pages/daily-value-detail/detail?id=' + id });
    },
  },
});
