// pages/main/main.js
// Main Shell：自定义 Header + 顶部 Tabs（统计/记账/日价）+ Swiper 三 Panel + 玻璃 FAB。
const device = require('../../utils/device.js');
const theme = require('../../utils/theme.js');
const viewport = require('../../utils/viewport.js');

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
    // 分类明细弹层（页面级 fixed）；scope/ym/year/categoryId 供「查看全部」钻取
    catDetail: { show: false, title: '', items: [], scope: '', categoryId: '', ym: '', year: 0 },
    // 预算日详情弹层（页面级 fixed，只读）
    dayDetail: {
      show: false,
      title: '',
      hasBudget: true,
      budgetText: '',
      actualText: '',
      delta: 0,
      deltaLabel: '',
      deltaText: '',
      categories: [],
      bills: [],
      billCount: 0,
    },
    // G6 数据保护模式
    protection: false,
    protectionItems: [],
    // 主题
    themeClass: 'theme-dark',
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
    // 主题绑定：根容器 themeClass 实时跟随，不重启、不丢状态。
    this._offTheme = theme.bindPage(this);
    // viewport 恢复：键盘关闭/窗口 resize 后重算全屏布局（Android 白条保险）。
    this._offRecover = viewport.onRecover((nfo) => this.applyLayout(nfo));
    this.checkProtection();
  },
  onUnload() {
    if (this._offTheme) { this._offTheme(); this._offTheme = null; }
    if (this._offRecover) { this._offRecover(); this._offRecover = null; }
  },
  /** 重算全屏布局（viewport 恢复时调用；info 由 viewport 重测后传入） */
  applyLayout(nfo) {
    try {
      const info = nfo || device.get();
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
    } catch (e) {
      /* 忽略 */
    }
  },
  onReady() {
    if (!this.data.protection) {
      this.activatePanel(this.data.current);
      this._ready = true;
    }
  },
  onShow() {
    this.checkProtection();
    // 保护模式下不刷新正常面板（组件未渲染）
    if (this.data.protection) return;
    // 从预算设置 / 其他二级页返回：页面已 ready 则安全刷新全部面板（无需重启小程序）。
    if (this._ready) this.refreshPanels();
  },
  /** G6：检测 App 是否进入数据保护模式（启动完整性扫描发现损坏） */
  checkProtection() {
    const app = getApp();
    const p = app && app.protection;
    if (p && p.ok === false) {
      let items = [];
      if (Array.isArray(p.all)) {
        items = p.all
          .filter((e) => e.status !== 'VALID' && e.status !== 'MISSING')
          .map((e) => ({
            kind: e.kind,
            status: e.status,
            detail: e.detail || '',
            label: this.protectionLabel(e),
          }));
      } else if (p.initError) {
        items = [{ kind: 'init', status: 'ERROR', label: '初始化失败', detail: p.initError }];
      } else if (p.scanError) {
        items = [{ kind: 'scan', status: 'ERROR', label: '扫描失败', detail: p.scanError }];
      }
      this.setData({ protection: true, protectionItems: items });
    } else {
      this.setData({ protection: false });
    }
  },
  protectionLabel(e) {
    if (e.kind === 'month') {
      const m = (e.file || '').match(/(\d{4}-\d{2})/);
      return m ? m[1] : '月份';
    }
    const names = { manifest: '清单', categories: '分类', settings: '设置', recurring: '周期' };
    return names[e.kind] || e.kind;
  },
  /** 创建脱敏诊断并分享 */
  onSafeDiagnose() {
    try {
      const protection = require('../../data/protection');
      const obj = protection.buildDiagnostic();
      const _app = getApp();
      if (_app && _app.protection && _app.protection.initError) {
        obj.initError = _app.protection.initError;
      }
      const filePath = wx.env.USER_DATA_PATH + '/daily-value-diagnostic.json';
      wx.getFileSystemManager().writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
      wx.shareFileMessage({
        filePath,
        success: () => wx.showToast({ title: '可发送到文件传输助手', icon: 'none' }),
        fail: () => wx.showToast({ title: '已生成诊断文件', icon: 'none' }),
      });
    } catch (e) {
      wx.showToast({ title: '生成诊断失败', icon: 'none' });
    }
  },
  /** 导出全部原始文件文本（含损坏文本，供抢救） */
  onSafeExport() {
    try {
      const protection = require('../../data/protection');
      const obj = protection.buildRawExport();
      const filePath = wx.env.USER_DATA_PATH + '/daily-value-raw-export.json';
      wx.getFileSystemManager().writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
      wx.shareFileMessage({
        filePath,
        success: () => wx.showToast({ title: '可发送到文件传输助手', icon: 'none' }),
        fail: () => wx.showToast({ title: '已生成原始数据文件', icon: 'none' }),
      });
    } catch (e) {
      wx.showToast({ title: '导出原始数据失败', icon: 'none' });
    }
  },
  /** 从已有备份恢复（跳到备份与恢复页） */
  onSafeRestore() {
    wx.navigateTo({ url: '/pages/backup-restore/backup-restore' });
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
    const d = e.detail;
    this.setData({
      catDetail: {
        show: true,
        title: d.title,
        items: d.items,
        scope: d.scope || '',
        categoryId: d.categoryId || '',
        ym: d.ym || '',
        year: d.year || 0,
      },
    });
  },
  /** 关闭分类明细弹层 */
  onCloseCat() {
    this.setData({ 'catDetail.show': false });
  },
  /** 分类明细「查看全部」：带钻取条件跳到 Bill Explorer（支出分类） */
  onTapViewAll() {
    const c = this.data.catDetail;
    if (!c.categoryId) return;
    let url = '/pages/search/search?category=' + encodeURIComponent(c.categoryId) + '&type=expense';
    if (c.scope === 'year' && c.year) {
      url += '&year=' + c.year;
    } else if (c.scope === 'month' && c.ym) {
      url += '&month=' + c.ym;
    }
    this.setData({ 'catDetail.show': false });
    wx.navigateTo({ url });
  },
  /** 统计 Panel 请求展示某预算日详情（只读） */
  onShowDayDetail(e) {
    const d = e.detail;
    this.setData({
      dayDetail: {
        show: true,
        title: d.title,
        hasBudget: d.hasBudget,
        budgetText: d.budgetText,
        actualText: d.actualText,
        delta: d.delta,
        deltaLabel: d.deltaLabel,
        deltaText: d.deltaText,
        categories: d.categories,
        bills: d.bills,
        billCount: d.billCount,
      },
    });
  },
  /** 关闭预算日详情弹层 */
  onCloseDayDetail() {
    this.setData({ 'dayDetail.show': false });
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
  /**
   * E2E 圆环交互测试专用：在当前月份注入固定多分类支出账单（无 UI 入口，
   * 自动化 page.callMethod('__e2eSeedDonut') 调用）。用固定 note 标记，便于幂等清理。
   */
  __e2eSeedDonut() {
    const store = require('../../data/index');
    const now = new Date();
    const ym = store.ledger.ymOf(now.getTime());
    const seed = [
      { categoryId: 'c-food', amount: 375.64 },
      { categoryId: 'c-shopping', amount: 204.04 },
      { categoryId: 'c-life', amount: 140.00 },
      { categoryId: 'c-transport', amount: 90.00 },
      { categoryId: 'c-fun', amount: 50.00 },
    ];
    const ids = [];
    seed.forEach((s, i) => {
      const at = new Date(now.getFullYear(), now.getMonth(), Math.min(i + 1, 27), 12, 0).getTime();
      const b = store.addBill({
        type: 'expense',
        amount: s.amount,
        categoryId: s.categoryId,
        note: 'E2E_DONUT',
        occurredAt: at,
      });
      ids.push(b.id);
    });
    return { ym, ids };
  },
  /** E2E 清理：删除当前月份所有 note=E2E_DONUT 的账单 */
  __e2eClearDonut() {
    const store = require('../../data/index');
    const now = new Date();
    const ym = store.ledger.ymOf(now.getTime());
    const bills = store.rangeBills(ym, ym);
    let removed = 0;
    bills.forEach((b) => {
      if (b.note === 'E2E_DONUT') { store.deleteBill(b.id); removed++; }
    });
    return { ym, removed };
  },
});
