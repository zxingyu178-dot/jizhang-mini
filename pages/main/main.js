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
  onTab(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (i !== this.data.current) this.setData({ current: i });
  },
  onSwiperChange(e) {
    this.setData({ current: e.detail.current });
  },
  onSearch() {
    wx.showToast({ title: '搜索功能开发中', icon: 'none' });
  },
  onSettings() {
    wx.showToast({ title: '设置功能开发中', icon: 'none' });
  },
  onAdd() {
    wx.showToast({ title: '记账表单开发中', icon: 'none' });
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
