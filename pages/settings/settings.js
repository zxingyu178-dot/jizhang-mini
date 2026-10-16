// pages/settings/settings.js
// 设置（精简）：预算、数据导入、备份与恢复、版本、数据与隐私。
const device = require('../../utils/device');
const store = require('../../data/index');
const money = require('../../data/money');
const util = require('../../utils/util');
const { APP_VERSION } = require('../../utils/version');

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    version: APP_VERSION,
    budgetHint: '未设置',
  },
  onLoad() {
    const info = device.get();
    this.setData({
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      headerHeight: info.headerHeight,
    });
    this.refreshBudgetHint();
  },
  onShow() {
    // 从预算设置返回：更新入口提示
    this.refreshBudgetHint();
  },
  /** 每日预算入口右侧提示：今天适用规则 → ¥x/天，否则未设置 */
  refreshBudgetHint() {
    const today = util.formatDate(new Date());
    const state = store.getBudgetState();
    const r = store.budget.resolveRuleForDate(state, today);
    let hint = '未设置';
    if (r && r.enabled && r.dailyCents > 0) hint = '¥' + money.formatCents(r.dailyCents) + '/天';
    this.setData({ budgetHint: hint });
  },
  onBack() {
    wx.navigateBack({ delta: 1 });
  },

  /** 预算设置（二级页） */
  onBudgetSettings() {
    wx.navigateTo({ url: '/pages/budget-settings/budget-settings' });
  },

  /** 数据导入：统一导入引擎分包 */
  onImport() {
    wx.navigateTo({ url: '/packages/importer/pages/import/import' });
  },

  /** 备份与恢复（合并为二级页） */
  onBackupRestore() {
    wx.navigateTo({ url: '/pages/backup-restore/backup-restore' });
  },

  /** 数据与隐私（二级页） */
  onPrivacy() {
    wx.navigateTo({ url: '/pages/data-privacy/data-privacy' });
  },
});
