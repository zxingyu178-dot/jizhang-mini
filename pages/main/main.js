// pages/main/main.js
// Main Shell：自定义 Header + 顶部 Tabs（统计/记账/日价）+ Swiper 三 Panel + 玻璃 FAB。
const device = require('../../utils/device.js');
const theme = require('../../utils/theme.js');
const viewport = require('../../utils/viewport.js');
const money = require('../../data/money');

// 顶部 Tabs 导航高度（px）
const TABS_HEIGHT = 44;

/**
 * Header 紧凑模式判定（v1.3.5 移动端兼容）。
 * 只看屏幕总宽度不够：真实内容区右侧还要给微信胶囊让位（menuPad，单位 px，
 * 不随 rpx 缩放），窄屏时胶囊占比更大。常规布局所需最小宽度按 rpx 估算：
 * 左内边距 24 + 标题 8 字 36rpx×0.875 + actions 左间距 20 + 搜索左右内边距 40 +
 * 图标右间距 8 + 文案 4 字×24rpx + 搜索右间距 8 + 设置按钮 56 + 设置左间距 12
 * = 516rpx，另加 dv-icon 固定 14px；再留 2px 安全余量。
 */
function computeHeaderCompact(info, menuPad) {
  const width = info.windowWidth || 375;
  const scale = width / 750;
  const normalNeed = scale * 516 + 14 + 2;
  const available = width - menuPad;
  return normalNeed > available;
}

// 数据层自检账单的清理统一走 utils/test-registry：按持久化账单 ID 精确删除 +
// 命名空间前缀（__TEST__:<runId>）兜底，不再仅凭裸备注文本认定，避免误删真实账单。

/**
 * 删除数据层自检账单（幂等）：委托测试注册表，按账单 ID 精确删 + 命名空间兜底。
 * 跨全部月份扫描：即使自检中途异常退出、用户过了一个月才重跑，也能发现并清理残留。
 */
function cleanupSelftestBills(store) {
  return require('../../utils/test-registry').cleanupTestBills(store);
}

Page({
  data: {
    current: 1, // 默认进入「记账」
    windowHeight: 667,
    windowWidth: 375,
    statusBarHeight: 20,
    navBarHeight: 44,
    headerHeight: 64,
    tabsHeight: TABS_HEIGHT,
    swiperTop: 108,
    swiperHeight: 500,
    safeBottom: 0,
    menuPad: 16, // 自定义 Header 右侧避让系统胶囊的内边距（px）
    headerCompact: false, // 窄屏 / 胶囊占比过大时启用紧凑 Header
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
      windowWidth: info.windowWidth,
      statusBarHeight: info.statusBarHeight,
      navBarHeight: info.navBarHeight,
      headerHeight: info.headerHeight,
      safeBottom: info.safeBottom,
      menuPad,
      headerCompact: computeHeaderCompact(info, menuPad),
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
        windowWidth: info.windowWidth,
        statusBarHeight: info.statusBarHeight,
        navBarHeight: info.navBarHeight,
        headerHeight: info.headerHeight,
        safeBottom: info.safeBottom,
        menuPad,
        headerCompact: computeHeaderCompact(info, menuPad),
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
      this.checkHeaderOverflow();
    }
  },
  /**
   * 渲染后兜底检查：系统字体放大等无法预知的场景下，如果标题或搜索文案仍被换成
   * 两行，则强制进入紧凑 Header。阈值按单行高度的 1.7 倍判断，避免把正常行高误判。
   * 已在紧凑模式时不重复 setData。
   */
  checkHeaderOverflow() {
    if (this.data.headerCompact) return;
    try {
      const q = wx.createSelectorQuery();
      q.select('.header__title').boundingClientRect();
      q.select('.header__search-text').boundingClientRect();
      q.exec((res) => {
        const title = res && res[0];
        const text = res && res[1];
        if (!title || !text) return;
        const scale = (this.data.windowWidth || 375) / 750;
        const titleLine = 36 * scale * 1.2;
        const textLine = 24 * scale;
        if (title.height > titleLine * 1.7 || text.height > textLine * 1.7) {
          this.setData({ headerCompact: true });
        }
      });
    } catch (e) {
      /* 尺寸查询失败时保持 CSS 的 nowrap + ellipsis 兜底，不影响功能 */
    }
  },
  onShow() {
    this.checkProtection();
    // 保护模式下不刷新正常面板（组件未渲染）
    if (this.data.protection) return;
    if (!this._ready) return;
    // 消费一次性主题保留标记：仅当用户主动切主题、且之后没有进入任何非主题操作时，
    // 才拿到 true 并跳过统计面板完整重载（主题订阅已做局部 recolor，保留圆环展开/
    // 选中态）。标记在 consume 内立即清零，只生效一次；备份恢复 / 分类 / 周期 /
    // 预算 / 导入等非主题操作会先取消标记，这里拿到 false，统计必然完整刷新。
    const preserveStatistics = theme.consumeThemePreserve();
    this.refreshPanels({ preserveStatistics });
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
  /**
   * 表单内容高度变化（展开 / 收起分类）：让弹层重新预算滚动区高度。
   * 不重算的后果实测过：展开 12 个分类后保存按钮底边被推到视口外 5px。
   */
  onBillFormResize() {
    const sheet = this.selectComponent('#billSheet');
    if (sheet && typeof sheet.refit === 'function') sheet.refit();
  },
  /**
   * 表单保存成功：关闭弹层、刷新面板、给出确认。
   *
   * 两条实测出来的规则（v1.4.7）：
   *  1. 必须回显「记了多少」——原来保存后只是弹层消失，用户拿不到任何「记上了」的确认；
   *  2. 记的是别的月份时必须切到那个月——原来把日期改成上月保存后，当前月列表
   *     一行都不会变、也没有提示，用户会以为这笔没记上（实测：Hero 仍停在 11 月，
   *     列表里查不到那笔 10 月的账）。
   */
  onBillSaved(e) {
    const d = e.detail || {};
    this.setData({ sheetShow: false });
    const acc = this.selectComponent('#accountingPanel');
    const beforeYm = acc ? acc.data.ym : '';
    // 记账面板正看着的月份 ≠ 账单所属月份 → 这次保存是「补记别的月份」
    const crossMonth = !!(d.ym && beforeYm && d.ym !== beforeYm);
    this.refreshPanels({ accYm: d.ym });
    if (crossMonth) {
      wx.showToast({ title: '已记入 ' + this.ymLabel(d.ym), icon: 'none' });
    } else if (d.amountCents) {
      wx.showToast({ title: '已记 ¥' + money.formatCents(d.amountCents), icon: 'none' });
    }
  },
  /** 'YYYY-MM' → '10 月'（跨年时补上年份，避免「1 月」歧义） */
  ymLabel(ym) {
    const parts = String(ym || '').split('-');
    if (parts.length < 2) return ym;
    const month = Number(parts[1]) + ' 月';
    const thisYear = new Date().getFullYear();
    return Number(parts[0]) === thisYear ? month : parts[0] + ' 年 ' + month;
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
  /**
   * 刷新三个 Panel（数据变化后调用）。
   * opts.preserveStatistics=true 时跳过统计面板完整 refresh：主题切换场景下
   * 其颜色已由主题订阅 recolor、展开 / 选中态需保留，不能被 loadMonth/loadYear 重置。
   * opts.accYm 指定记账面板要停在哪个月（补记别的月份时直接落位，不先刷当前月再跳，
   * 避免两次重载与中间帧闪动）。
   */
  refreshPanels(opts) {
    const o = opts || {};
    const acc = this.selectComponent('#accountingPanel');
    if (acc) {
      const target = o.accYm;
      if (target && target !== acc.data.ym) acc.loadData(target);
      else acc.refresh();
    }
    if (!o.preserveStatistics) {
      const sta = this.selectComponent('#statisticsPanel');
      if (sta) sta.refresh();
    }
    const dvPanel = this.selectComponent('#dailyValuePanel');
    if (dvPanel && dvPanel.refresh) dvPanel.refresh();
  },
  /**
   * 开发自检（无 UI 入口，自动化 page.callMethod('__selftest') 调用）。
   * 在真实运行时验证数据层 USER_DATA_PATH 写入 / 读取 / 备份 / 删除。
   * 安全收口（v1.3.4）：仅 develop 可执行；每次生成唯一 runId，账单 note 写命名空间
   * 标记（__TEST__:<runId>）并持久化到测试清单，try/finally 保证即使中途抛错也会清理，
   * 清理按账单 ID 精确删 + 命名空间兜底，不凭裸备注误删真实账单。
   */
  __selftest() {
    const env = require('../../utils/env');
    if (!env.isDevEnv()) {
      throw new Error('当前环境禁止数据层自检（仅 develop 允许）');
    }
    const testRegistry = require('../../utils/test-registry');
    const store = require('../../data/index');
    const now = Date.now();
    const runId = testRegistry.makeRunId('selftest');

    // 先清历史自检残留，保证干净起点。
    cleanupSelftestBills(store);
    // runId 先登记（空 billIds），再注入账单；每笔创建后及时登记 ID，支持中途异常清理。
    testRegistry.registerRun({ runId, kind: 'selftest', billIds: [] });

    try {
      const bill = store.addBill({
        type: 'expense',
        amount: 18.8,
        categoryId: 'c-food',
        merchant: '瑞幸咖啡',
        note: testRegistry.encodeTestNote(runId),
        occurredAt: now,
      });
      testRegistry.addBillToRun(runId, bill.id);
      const income = store.addBill({
        type: 'income',
        amount: 500,
        categoryId: 'c-salary',
        note: testRegistry.encodeTestNote(runId),
        occurredAt: now,
      });
      testRegistry.addBillToRun(runId, income.id);

      const ym = store.ledger.ymOf(now);
      const s = store.monthSummary(ym);
      const grouped = store.monthGrouped(ym);
      const backup = store.buildBackup();
      const backupValid = store.backup.validateBackup(backup);

      // 正常路径清理（finally 再兜底一次，cleanup 幂等，重复调用安全）。
      cleanupSelftestBills(store);
      const after = store.monthSummary(ym);

      return {
        ym,
        runId,
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
      // 兜底：try 内任一步抛错时，确保本次 run 与任何命名空间残留都被删除。
      cleanupSelftestBills(store);
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
