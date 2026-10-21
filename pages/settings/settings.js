// pages/settings/settings.js
// 设置（精简）：预算、数据导入、备份与恢复、版本、数据与隐私。
const device = require('../../utils/device');
const store = require('../../data/index');
const money = require('../../data/money');
const util = require('../../utils/util');
const theme = require('../../utils/theme');
const { APP_VERSION } = require('../../utils/version');

const THEME_HINTS = { dark: '深色', light: '浅色', system: '跟随系统' };

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    version: APP_VERSION,
    budgetHint: '未设置',
    themeHint: '深色',
    themeClass: 'theme-dark',
  },
  onLoad() {
    const info = device.get();
    this.setData({
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      headerHeight: info.headerHeight,
    });
    this.refreshBudgetHint();
    this.refreshThemeHint();
    // 绑定主题（设置页在前台时实时跟随，如 system 模式系统切换）。
    this._offTheme = theme.bindPage(this);
  },
  onUnload() {
    if (this._offTheme) {
      this._offTheme();
      this._offTheme = null;
    }
  },
  onShow() {
    // 从预算设置 / 外观页返回：更新入口提示
    this.refreshBudgetHint();
    this.refreshThemeHint();
  },
  /** 主题入口右侧提示：跟随系统 / 深色 / 浅色 */
  refreshThemeHint() {
    const mode = theme.getThemeMode();
    this.setData({ themeHint: THEME_HINTS[mode] || '深色' });
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

  /** 分类管理（二级页） */
  onCategoryManage() {
    wx.navigateTo({ url: '/pages/category-manage/category-manage' });
  },

  /** 周期记账（二级页） */
  onRecurring() {
    wx.navigateTo({ url: '/pages/recurring/recurring' });
  },

  /** 预算设置（二级页） */
  onBudgetSettings() {
    wx.navigateTo({ url: '/pages/budget-settings/budget-settings' });
  },

  /** 外观（二级页） */
  onAppearance() {
    wx.navigateTo({ url: '/pages/appearance/appearance' });
  },

  /** 数据导入：统一导入引擎分包 */
  onImport() {
    wx.navigateTo({ url: '/packages/importer/pages/import/import' });
  },

  /** 备份与恢复（合并为二级页） */
  onBackupRestore() {
    wx.navigateTo({ url: '/pages/backup-restore/backup-restore' });
  },

  /** 更新日志（二级页） */
  onReleaseNotes() {
    wx.navigateTo({ url: '/pages/release-notes/release-notes' });
  },

  /** 数据与隐私（二级页） */
  onPrivacy() {
    wx.navigateTo({ url: '/pages/data-privacy/data-privacy' });
  },
});
