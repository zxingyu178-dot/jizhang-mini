// pages/search/search.js
// Bill Explorer：关键词 + 收支 / 时间 / 分类筛选，结果按日期分组；无筛选显示最近账单。
// 搜索算法收敛在 data/search（纯函数），页面只负责 UI。
// v1.1.1：页面会话快照（输入不反复读磁盘）+ 关键词 debounce + 时间 Chip 严格同年/同月。
const store = require('../../data/index');
const search = require('../../data/search/index');
const device = require('../../utils/device');
const theme = require('../../utils/theme');
const dateUtil = require('../../data/date');

const RECENT_LIMIT = 8;
const DEBOUNCE_MS = 120; // 关键词输入防抖（100~150ms）

/* ---------- 日期工具 ---------- */
function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}
function ymLabel(ym) {
  const parts = ym.split('-');
  return parts[0] + '年' + Number(parts[1]) + '月';
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
    // 分类筛选：active 在前、已归档在后（归档项弱化标注），让历史账单仍可按原分类筛选。
    const allCats = store.getCategories();
    const catList = allCats
      .slice()
      .sort((a, b) => (a.archived === b.archived ? 0 : a.archived ? 1 : -1))
      .map((c) => ({
        id: c.id,
        emoji: c.emoji,
        iconType: c.iconType,
        iconValue: c.iconValue,
        name: c.name,
        archived: c.archived === true,
      }));

    // 进入页面先建立一次会话快照（全部账单 + 分类解析器），后续输入只在内存筛选
    this.refreshSnapshot();

    // 解析统计钻取 URL 参数（month / year / category / type / keyword），
    // 统一走纯函数 buildSearchQuery，month/year 自动换算为 dateFrom/dateTo
    const rawOpts = Object.assign({}, options || {});
    if (rawOpts.keyword) {
      try { rawOpts.keyword = decodeURIComponent(rawOpts.keyword); } catch (e) {}
    }
    const preset = search.buildSearchQuery(rawOpts);

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
    this.clearFilterTimer();
    if (this._offTheme) {
      this._offTheme();
      this._offTheme = null;
    }
  },

  /* ---------- 页面会话快照 ---------- */
  // 账单编辑/删除后重新读取；分类在搜索页不会修改，解析器一起刷新
  refreshSnapshot() {
    this._billsSnapshot = store.rangeBills();
    this._categoryResolver = store.getCategoryResolver();
  },

  /* ---------- 关键词（debounce） ---------- */
  onInput(e) {
    // 输入框保留原始内容；搜索 keyword 在 normalizeQuery 时统一 trim
    this.setData({ kw: e.detail.value });
    this.scheduleFilter();
  },
  onClear() {
    this.clearFilterTimer();
    this.setData({ kw: '' });
    this.applyFilters();
  },
  scheduleFilter() {
    this.clearFilterTimer();
    this._filterTimer = setTimeout(() => {
      this._filterTimer = null;
      this.applyFilters();
    }, DEBOUNCE_MS);
  },
  clearFilterTimer() {
    if (this._filterTimer) {
      clearTimeout(this._filterTimer);
      this._filterTimer = null;
    }
  },

  /* ---------- 收支 Chip（立即刷新） ---------- */
  onTypeTap(e) {
    const type = e.currentTarget.dataset.type;
    if (type === this.data.type) return;
    this.clearFilterTimer();
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
    const r = search.yearRange(this.data.thisYear);
    this.setData({ dateFrom: r.dateFrom, dateTo: r.dateTo, customStart: '', customEnd: '' });
    this.finishTimePick();
  },
  pickLastYear() {
    const r = search.yearRange(this.data.thisYear - 1);
    this.setData({ dateFrom: r.dateFrom, dateTo: r.dateTo, customStart: '', customEnd: '' });
    this.finishTimePick();
  },
  pickRecentMonth(e) {
    const ym = e.currentTarget.dataset.ym;
    const r = search.monthRange(ym);
    this.setData({ dateFrom: r.dateFrom, dateTo: r.dateTo, customStart: '', customEnd: '' });
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
    // 复用共享边界：起点 00:00.000、结束 23:59:59.999（含最后 999ms）
    this.setData({
      dateFrom: dateUtil.startOfLocalDay(sp[0], sp[1], sp[2]),
      dateTo: dateUtil.endOfLocalDay(ep[0], ep[1], ep[2]),
    });
    this.finishTimePick();
  },

  finishTimePick() {
    this.clearFilterTimer();
    this.setData({ timeSheetShow: false });
    this.refreshLabels();
    this.applyFilters();
  },

  /* ---------- 分类选择（立即刷新） ---------- */
  pickCategory(e) {
    const id = e.currentTarget.dataset.id || 'all';
    this.clearFilterTimer();
    this.setData({ categoryId: id });
    this.setData({ catSheetShow: false });
    this.refreshLabels();
    this.applyFilters();
  },

  /* ---------- 选中态 chip 文案 ---------- */
  refreshLabels() {
    const d = this.data;
    // 时间 Chip 文案统一走纯函数 describeRange（同年/同月严格判定）
    const timeLabel = dateUtil.describeRange(d.dateFrom, d.dateTo).label;
    let catLabel = '分类';
    if (d.categoryId !== 'all') {
      const found = store.getCategory(d.categoryId);
      catLabel = found ? found.name : '分类';
    }
    this.setData({ timeLabel, catLabel });
  },

  /* ---------- 执行搜索（只对会话快照在内存筛选，不读磁盘） ---------- */
  applyFilters() {
    const q = search.buildSearchQuery({
      keyword: this.data.kw,
      type: this.data.type,
      categoryId: this.data.categoryId,
      dateFrom: this.data.dateFrom,
      dateTo: this.data.dateTo,
    });
    const snapshot = this._billsSnapshot || [];
    const resolver = this._categoryResolver;
    if (!search.hasAnyFilter(q)) {
      // 无任何筛选：最近账单（普通账单，不含 daily-value-only）
      const recent = snapshot
        .filter((b) => b.ledgerImpact !== 'daily-value-only')
        .sort((a, b) => b.occurredAt - a.occurredAt)
        .slice(0, RECENT_LIMIT);
      this.setData({
        groups: search.groupSearchResults(recent, resolver),
        showRecent: true,
        resultCount: recent.length,
      });
      return;
    }
    const matched = search.searchBills(snapshot, q, resolver);
    this.setData({
      groups: search.groupSearchResults(matched, resolver),
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
  // 保存 / 删除后：关闭 Sheet、刷新会话快照、按当前筛选重新搜索
  // （筛选不丢、结果立即更新、不返回首页、不依赖重启）
  onBillSaved() {
    this.setData({ sheetShow: false });
    this.refreshSnapshot();
    this.applyFilters();
  },

  // 外部数据变化（回前台周期补账可能生成新账单）后：刷新会话快照并保持当前筛选，
  // 不重建页面、不丢关键词。由 app.refreshTimeSensitiveViews 在当前页是搜索页时调用。
  refreshAfterExternalDataChange() {
    this.refreshSnapshot();
    this.applyFilters();
  },
});
