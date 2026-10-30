// pages/main/main.js
// Main Shell：自定义 Header + 顶部 Tabs（统计/记账/日价）+ Swiper 三 Panel + 玻璃 FAB。
const device = require('../../utils/device.js');
const theme = require('../../utils/theme.js');
const viewport = require('../../utils/viewport.js');

// 顶部 Tabs 导航高度（px）
const TABS_HEIGHT = 44;

// 数据层自检专用标识：写进 note，与真实备注区分，便于精确清理与残留扫描。
const SELFTEST_TAG = '__SELFTEST__';

/**
 * 删除数据层自检账单（幂等）：先按已登记 id 删除，再跨全部月份兜底扫描同标识残留。
 * 跨月扫描是关键：即使自检中途异常退出、用户过了一个月才重跑，也能发现并清理残留，
 * 不会只看当前月。绝不使用模糊备注匹配，只认精确的 SELFTEST_TAG。
 */
function cleanupSelftestBills(store, ids) {
  ids.forEach((id) => {
    try { store.deleteBill(id); } catch (e) { /* 已不存在则忽略 */ }
  });
  store.rangeBills().forEach((b) => {
    if (b.note === SELFTEST_TAG) {
      try { store.deleteBill(b.id); } catch (e) { /* 忽略 */ }
    }
  });
}

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
   * 安全收口（v1.3.3）：仅 develop 可执行；账单用专用标识 SELFTEST_TAG，
   * try/finally 保证即使中途抛错也会清理，且清理跨全部月份兜底扫描。
   */
  __selftest() {
    const env = require('../../utils/env');
    if (!env.isDevEnv()) {
      throw new Error('当前环境禁止数据层自检（仅 develop 允许）');
    }
    const store = require('../../data/index');
    const now = Date.now();
    const ids = [];
    try {
      const bill = store.addBill({
        type: 'expense',
        amount: 18.8,
        categoryId: 'c-food',
        merchant: '瑞幸咖啡',
        note: SELFTEST_TAG,
        occurredAt: now,
      });
      const income = store.addBill({
        type: 'income',
        amount: 500,
        categoryId: 'c-salary',
        note: SELFTEST_TAG,
        occurredAt: now,
      });
      ids.push(bill.id, income.id);
      const ym = store.ledger.ymOf(now);
      const s = store.monthSummary(ym);
      const grouped = store.monthGrouped(ym);
      const backup = store.buildBackup();
      const backupValid = store.backup.validateBackup(backup);

      // 正常路径清理（finally 再兜底一次，cleanup 幂等，重复调用安全）。
      cleanupSelftestBills(store, ids);
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
    } finally {
      // 兜底：try 内任一步抛错时，确保已登记 id 与任何同标识残留都被删除。
      cleanupSelftestBills(store, ids);
    }
  },
  /**
   * 迁移自检（自动化 page.callMethod('__migtest') 调用）。
   * 安全收口（v1.3.3）：仅 develop 可执行；不再直接操作正式 manifest / 月份分片 /
   * jm_records，改为在独立沙箱目录复用真实转换函数 legacyToBill 完成迁移冒烟，
   * 结束后整个沙箱目录删除，正式账本零接触。
   */
  __migtest() {
    const env = require('../../utils/env');
    if (!env.isDevEnv()) {
      throw new Error('当前环境禁止迁移自检（仅 develop 允许）');
    }
    return require('../../utils/migtest-sandbox').runMigtestSandbox();
  },
  /**
   * E2E 圆环交互测试专用入口（无 UI 入口，自动化 page.callMethod 调用）。
   * 薄委托：先做环境守卫，release 一律拒绝且不 require 测试模块，因此正式发布环境
   * 无法执行测试账单注入；具体注入逻辑在独立模块 utils/e2e-donut-seed，与业务逻辑解耦。
   * 注：受微信工具限制，被 packOptions.ignore 的文件无法在本地模拟器 require，
   * 故该桥接模块参与编译，但 release 下入口已 fail-closed，模块为不可达死代码。
   */
  __e2eSeedDonut() {
    const env = require('../../utils/env');
    if (!env.isTestEnv()) {
      throw new Error('当前环境禁止测试数据注入（仅 develop/trial 允许）');
    }
    return require('../../utils/e2e-donut-seed').seedDonut();
  },
  /** E2E 多分类注入（>8，聚合回归）：同样先环境守卫，再委托测试模块 */
  __e2eSeedDonutMany() {
    const env = require('../../utils/env');
    if (!env.isTestEnv()) {
      throw new Error('当前环境禁止测试数据注入（仅 develop/trial 允许）');
    }
    return require('../../utils/e2e-donut-seed').seedDonutMany();
  },
  /** E2E 清理入口：同样先环境守卫，再委托测试模块按专用标识精确清理 */
  __e2eClearDonut() {
    const env = require('../../utils/env');
    if (!env.isTestEnv()) {
      throw new Error('当前环境禁止测试数据清理（仅 develop/trial 允许）');
    }
    return require('../../utils/e2e-donut-seed').clearDonut();
  },
});
