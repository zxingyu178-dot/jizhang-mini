// pages/search/search.js
// Bill Explorer：关键词 + 收支 / 时间 / 分类筛选，结果按日期分组；无筛选显示最近账单。
// 搜索算法收敛在 data/search（纯函数），页面只负责 UI。
const store = require('../../data/index');
const search = require('../../data/search/index');
const device = require('../../utils/device');
const theme = require('../../utils/theme');

const RECENT_LIMIT = 8;

/* ---------- 日期工具 ---------- */
function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}
function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}
function ymLabel(ym) {
  const parts = ym.split('-');
  return parts[0] + '年' + Number(parts[1]) + '月';
}
/** 'YYYY-MM' → 该月起止时间戳 */
function monthRange(ym) {
  const p = ym.split('-').map(Number);
  const y = p[0];
  const m = p[1];
  return {
    from: new Date(y, m - 1, 1, 0, 0, 0).getTime(),
    to: new Date(y, m - 1, daysInMonth(y, m), 23, 59, 59).getTime(),
  };
}
/** 年份 → 该年起止时间戳 */
function yearRange(y) {
  return {
    from: new Date(y, 0, 1, 0, 0, 0).getTime(),
    to: new Date(y, 11, 31, 23, 59, 59).getTime(),
  };
}
function currentYM(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    filtersHeight: 0,
    resultsTop: 0,
    themeClass: 'theme-dark',
    kw: '',
    // 筛选条件
    type: 'all',
    categoryId: 'all',
    dateFrom: null,
    dateTo: null,
    // 选中态展示
    timeLabel: '时间',
    catLabel: '分类',
    // 时间 Sheet
    timeSheetShow: false,
    catSheetShow: false,
    thisYear: 0,
    recentMonths: [],
    // 自定义日期
    customStart: '',
    customEnd: '',
    // 分类 Sheet
    catList: [],
    // 结果
    groups: [],
    showRecent: false,
    resultCount: 0,
    // 账单编辑
    sheetShow: false,
  },
  onLoad(options) {
    const info = device.get();
    // Filter Chips 区固定高度（144rpx），换算 px，结果区 top 相应下移
    const filtersHeight = Math.round((144 * info.windowWidth) / 750);
    const resultsTop = info.headerHeight + filtersHeight;
    const now = new Date();
    const thisYear = now.getFullYear();
    // 最近月份（当前月、前月、前前月）
    const recentMonths = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(thisYear, now.getMonth() - i, 1);
      const ym = currentYM(d);
      recentMonths.push({ ym, label: ymLabel(ym) });
    }
    // 分类列表（未归档，含全部分类）；emoji 与名称分开，便于 emoji 独立渲染
    const catList = store.getActiveCategories().map((c) => ({
      id: c.id,
      emoji: c.emoji,
      name: c.name,
    }));

    // 解析统计钻取 URL 参数：month / year / category / type / keyword
    const preset = {
      type: 'all',
      categoryId: 'all',
      dateFrom: null,
      dateTo: null,
      keyword: '',
    };
    if (options) {
      if (options.type === 'expense' || options.type === 'income') preset.type = options.type;
      if (options.category) preset.categoryId = options.category;
      if (options.keyword) preset.keyword = decodeURIComponent(options.keyword);
      if (options.month && /^\d{4}-\d{2}$/.test(options.month)) {
        const r = monthRange(options.month);
        preset.dateFrom = r.from;
        preset.dateTo = r.to;
      } else if (options.year && /^\d{4}$/.test(options.year)) {
        const r = yearRange(Number(options.year));
        preset.dateFrom = r.from;
        preset.dateTo = r.to;
      }
    }

    this.setData({
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      headerHeight: info.headerHeight,
      filtersHeight,
      resultsTop,
      thisYear,
      recentMonths,
      catList,
      type: preset.type,
      categoryId: preset.categoryId,
      dateFrom: preset.dateFrom,
      dateTo: preset.dateTo,
      kw: preset.keyword,
    });
    this._offTheme = theme.bindPage(this);
    this.refreshLabels();
    this.applyFilters();
  },
  onUnload() {
    if (this._offTheme) {
      this._offTheme();
      this._offTheme = null;
    }
  },

  /* ---------- 关键词 ---------- */
  onInput(e) {
    this.setData({ kw: e.detail.value.trim() });
    this.applyFilters();
  },
  onClear() {
    this.setData({ kw: '' });
    this.applyFilters();
  },

  /* ---------- 收支 Chip ---------- */
  onTypeTap(e) {
    const type = e.currentTarget.dataset.type;
    if (type === this.data.type) return;
    this.setData({ type });
    this.applyFilters();
  },

  /* ---------- 时间 / 分类 Sheet ---------- */
  openTimeSheet() {
    this.setData({ timeSheetShow: true });
  },
  openCatSheet() {
    this.setData({ catSheetShow: true });
  },
  onTimeSheetClose() {
    this.setData({ timeSheetShow: false });
  },
  onCatSheetClose() {
    this.setData({ catSheetShow: false });
  },

  /* ---------- 时间快捷选项 ---------- */
  pickAllTime() {
    this.setData({ dateFrom: null, dateTo: null, customStart: '', customEnd: '' });
    this.finishTimePick();
  },
  pickThisYear() {
    const r = yearRange(this.data.thisYear);
    this.setData({ dateFrom: r.from, dateTo: r.to, customStart: '', customEnd: '' });
    this.finishTimePick();
  },
  pickLastYear() {
    const r = yearRange(this.data.thisYear - 1);
    this.setData({ dateFrom: r.from, dateTo: r.to, customStart: '', customEnd: '' });
    this.finishTimePick();
  },
  pickRecentMonth(e) {
    const ym = e.currentTarget.dataset.ym;
    const r = monthRange(ym);
    this.setData({ dateFrom: r.from, dateTo: r.to, customStart: '', customEnd: '' });
    this.finishTimePick();
  },

  /* ---------- 自定义日期（原生 date picker） ---------- */
  onStartDate(e) {
    this.setData({ customStart: e.detail.value });
  },
  onEndDate(e) {
    this.setData({ customEnd: e.detail.value });
  },
  applyCustomRange() {
    const s = this.data.customStart;
    const en = this.data.customEnd;
    if (!s || !en) {
      wx.showToast({ title: '请选择开始和结束日期', icon: 'none' });
      return;
    }
    if (s > en) {
      // 不偷偷交换，保留输入并提示
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    const sp = s.split('-').map(Number);
    const ep = en.split('-').map(Number);
    this.setData({
      dateFrom: new Date(sp[0], sp[1] - 1, sp[2], 0, 0, 0).getTime(),
      dateTo: new Date(ep[0], ep[1] - 1, ep[2], 23, 59, 59).getTime(),
    });
    this.finishTimePick();
  },

  finishTimePick() {
    this.setData({ timeSheetShow: false });
    this.refreshLabels();
    this.applyFilters();
  },

  /* ---------- 分类选择 ---------- */
  pickCategory(e) {
    const id = e.currentTarget.dataset.id || 'all';
    this.setData({ categoryId: id });
    this.setData({ catSheetShow: false });
    this.refreshLabels();
    this.applyFilters();
  },

  /* ---------- 选中态 chip 文案 ---------- */
  refreshLabels() {
    const d = this.data;
    let timeLabel = '时间';
    if (d.dateFrom != null && d.dateTo != null) {
      const fs2 = new Date(d.dateFrom);
      const te = new Date(d.dateTo);
      // 全年
      if (fs2.getMonth() === 0 && fs2.getDate() === 1 && te.getMonth() === 11 && te.getDate() === 31) {
        timeLabel = fs2.getFullYear() + '年';
      } else if (fs2.getDate() === 1 && te.getDate() === daysInMonth(fs2.getFullYear(), fs2.getMonth() + 1)) {
        // 整月
        timeLabel = fs2.getFullYear() + '年' + (fs2.getMonth() + 1) + '月';
      } else {
        timeLabel = '自定义';
      }
    }
    let catLabel = '分类';
    if (d.categoryId !== 'all') {
      const found = store.getCategory(d.categoryId);
      catLabel = found ? found.name : '分类';
    }
    this.setData({ timeLabel, catLabel });
  },

  /* ---------- 执行搜索 ---------- */
  applyFilters() {
    const q = search.buildSearchQuery({
      keyword: this.data.kw,
      type: this.data.type,
      categoryId: this.data.categoryId,
      dateFrom: this.data.dateFrom,
      dateTo: this.data.dateTo,
    });
    if (!search.hasAnyFilter(q)) {
      // 无任何筛选：最近账单（普通账单，不含 daily-value-only）
      const recent = store
        .rangeBills()
        .filter((b) => b.ledgerImpact !== 'daily-value-only')
        .sort((a, b) => b.occurredAt - a.occurredAt)
        .slice(0, RECENT_LIMIT);
      this.setData({
        groups: store.groupSearchResults(recent),
        showRecent: true,
        resultCount: recent.length,
      });
      return;
    }
    const matched = store.searchBills(q);
    this.setData({
      groups: store.groupSearchResults(matched),
      showRecent: false,
      resultCount: matched.length,
    });
  },

  /* ---------- 结果点击：复用 Bill Form ---------- */
  onTapBill(e) {
    const id = e.currentTarget.dataset.id;
    const form = this.selectComponent('#billForm');
    if (form) form.edit(id);
    this.setData({ sheetShow: true });
  },
  onSheetClose() {
    this.setData({ sheetShow: false });
  },
  // 保存 / 删除后：关闭 Sheet、按当前筛选重新搜索（筛选不丢、结果立即更新、不返回首页）
  onBillSaved() {
    this.setData({ sheetShow: false });
    this.applyFilters();
  },
});
