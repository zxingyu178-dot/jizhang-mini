// pages/main/main.js
// Main Shell：自定义 Header + 顶部 Tabs（统计/记账/日价）+ Swiper 三 Panel + 玻璃 FAB。
const device = require('../../utils/device.js');

// 顶部 Tabs 导航高度（px）
const TABS_HEIGHT = 44;

Page({
  data: {
    current: 1, // 默认进入「记账」
    windowHeight: 667,
    statusBarHeight: 20,
    navBarHeight: 44,
    headerHeight: 64,
    tabsHeight: TABS_HEIGHT,
    swiperTop: 108,
    swiperHeight: 500,
    safeBottom: 0,
    menuPad: 16, // 自定义 Header 右侧避让系统胶囊的内边距（px）
    sheetShow: false,
    sheetTitle: '记一笔',
    // 日价新增表单（日价 Tab 的 FAB）
    dvSheetShow: false,
    dvSheetTitle: '添加日价物品',
    // 分类明细弹层（页面级 fixed）
    catDetail: { show: false, title: '', items: [] },
  },
  onLoad() {
    const info = device.measure();
    // 右侧避让：系统胶囊右边界到屏幕边的距离 + 胶囊宽度 + gap
    // 即 header 内容区右边界 = 胶囊左边界再留 gap
    const menuPad = info.menu
      ? Math.round(info.windowWidth - info.menu.left + info.gap)
      : 16;
    this.setData({
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      navBarHeight: info.navBarHeight,
      headerHeight: info.headerHeight,
      safeBottom: info.safeBottom,
      menuPad,
      swiperTop: info.headerHeight + TABS_HEIGHT,
      swiperHeight: info.windowHeight - info.headerHeight - TABS_HEIGHT,
    });
  },
  onReady() {
    this.activatePanel(this.data.current);
  },
  onTab(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (i !== this.data.current) {
      this.setData({ current: i });
      this.activatePanel(i);
    }
  },
  onSwiperChange(e) {
    const i = e.detail.current;
    this.setData({ current: i });
    this.activatePanel(i);
  },
  /** 当前 Panel 首次进入可视区时通知它做初始加载（组件内部保证只加载一次） */
  activatePanel(i) {
    const sel = ['#statisticsPanel', '#accountingPanel', '#dailyValuePanel'][i];
    const comp = this.selectComponent(sel);
    if (comp && typeof comp.activate === 'function') comp.activate();
  },
  onSearch() {
    wx.navigateTo({ url: '/pages/search/search' });
  },
  onSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },
  onAdd() {
    // 日价 Tab：FAB 打开「添加日价物品」（只进日价）
    if (this.data.current === 2) {
      const dvForm = this.selectComponent('#dvForm');
      if (dvForm) dvForm.reset();
      this.setData({ dvSheetTitle: '添加日价物品', dvSheetShow: true });
      return;
    }
    // 记账 Tab：FAB 打开「记一笔」
    const form = this.selectComponent('#billForm');
    if (form) form.reset();
    this.setData({ sheetTitle: '记一笔', sheetShow: true });
  },
  /** 点击账单：打开编辑表单 */
  onTapBill(e) {
    const id = e.detail.id;
    const form = this.selectComponent('#billForm');
    if (form) form.edit(id);
    this.setData({ sheetTitle: '账单详情', sheetShow: true });
  },
  /** 遮罩关闭：仅把 show 置 false（动画由 sheet 处理） */
  onSheetClose() {
    this.setData({ sheetShow: false });
  },
  /** 表单保存成功：关闭弹层并刷新当前面板 */
  onBillSaved() {
    this.setData({ sheetShow: false });
    this.refreshPanels();
  },
  /** 日价表单遮罩关闭 */
  onDvSheetClose() {
    this.setData({ dvSheetShow: false });
  },
  /** 日价物品保存成功：关闭弹层并刷新（记账 / 日价面板都可能变化） */
  onDvSaved() {
    this.setData({ dvSheetShow: false });
    this.refreshPanels();
  },
  /** 账单删除：关闭弹层并刷新 */
  onBillDeleted() {
    this.setData({ sheetShow: false });
    this.refreshPanels();
  },
  /** 统计 Panel 请求展示某分类明细 */
  onShowCategoryDetail(e) {
    const { title, items } = e.detail;
    this.setData({ catDetail: { show: true, title, items } });
  },
  /** 关闭分类明细弹层 */
  onCloseCat() {
    this.setData({ 'catDetail.show': false });
  },
  /** 阻止弹层内部点击冒泡到遮罩 */
  noop() {},
  /** 刷新三个 Panel（数据变化后调用） */
  refreshPanels() {
    const acc = this.selectComponent('#accountingPanel');
    if (acc) acc.refresh();
    const sta = this.selectComponent('#statisticsPanel');
    if (sta) sta.refresh();
    const dvPanel = this.selectComponent('#dailyValuePanel');
    if (dvPanel && dvPanel.refresh) dvPanel.refresh();
  },
  /**
   * 开发自检（无 UI 入口，自动化 page.callMethod('__selftest') 调用）。
   * 在真实运行时验证数据层 USER_DATA_PATH 写入 / 读取 / 备份 / 删除。
   */
  __selftest() {
    const store = require('../../data/index');
    const now = Date.now();
    const bill = store.addBill({
      type: 'expense',
      amount: 18.8,
      categoryId: 'c-food',
      merchant: '瑞幸咖啡',
      note: '生椰拿铁',
      occurredAt: now,
    });
    const income = store.addBill({
      type: 'income',
      amount: 500,
      categoryId: 'c-salary',
      occurredAt: now,
    });
    const ym = store.ledger.ymOf(now);
    const s = store.monthSummary(ym);
    const grouped = store.monthGrouped(ym);
    const backup = store.buildBackup();
    const backupValid = store.backup.validateBackup(backup);
    store.deleteBill(bill.id);
    store.deleteBill(income.id);
    const after = store.monthSummary(ym);
    return {
      ym,
      expenseBillCents: bill.amountCents,
      incomeBillCents: income.amountCents,
      summaryBefore: { expense: s.expense, income: s.income, balance: s.balance, count: s.count },
      groupedDays: grouped.length,
      groupedDayBills: grouped[0] ? grouped[0].bills.length : 0,
      backupFormat: backup.format,
      backupBillCount: backup.data.bills.length,
      backupValidError: backupValid,
      afterClean: { expense: after.expense, income: after.income, count: after.count },
    };
  },
  /**
   * 迁移真机自检（自动化 page.callMethod('__migtest') 调用）。
   * 注入虚构 jm_records → 重置 manifest → 重新 init 触发迁移 → 校验 → 自动清理恢复。
   */
  __migtest() {
    const store = require('../../data/index');
    const fs = store.fs;
    const paths = store.paths;

    // 1. 注入虚构旧数据
    const legacy = [
      { id: 'x1', createdAt: 1760000000000, type: 'expense', amount: 25.5, category: 'food', date: '2026-10-15', note: '午餐' },
      { id: 'x2', createdAt: 1760000001000, type: 'income', amount: 1000, category: 'salary', date: '2026-10-15' },
      { id: 'x3', createdAt: 1760000002000, type: 'expense', amount: 12, category: 'transport', date: '2026-09-30' },
    ];
    wx.setStorageSync('jm_records', legacy);

    // 2. 重置 manifest（迁移状态回到 pending）
    fs.remove(paths.FILE.manifest);

    // 3. 重新 init → 触发迁移
    const status = store.init();
    const m = status.migration;
    const result = {
      migrationStatus: m.status,
      recordCount: m.recordCount,
      expenseCents: m.expenseCents,
      incomeCents: m.incomeCents,
      months: m.months,
      backupExists: fs.exists(paths.legacyRecordsBackup()),
      jmRecordsKept: (wx.getStorageSync('jm_records') || []).length,
      summary10: store.monthSummary('2026-10'),
      summary9: store.monthSummary('2026-09'),
      foodCategory: store.getBill('mig-x1').categoryId,
    };

    // 4. 清理，恢复到"无旧数据"状态
    fs.remove(paths.billFile('2026-10'));
    fs.remove(paths.billFile('2026-09'));
    fs.remove(paths.legacyRecordsBackup());
    wx.removeStorageSync('jm_records');
    fs.remove(paths.FILE.manifest);
    store.init();

    return result;
  },
});
