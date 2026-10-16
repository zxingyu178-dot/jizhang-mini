// pages/settings/settings.js
// 设置（精简）：数据导入、备份与恢复、版本、数据与隐私。
const device = require('../../utils/device');
const { APP_VERSION } = require('../../utils/version');

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    version: APP_VERSION,
  },
  onLoad() {
    const info = device.get();
    this.setData({
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      headerHeight: info.headerHeight,
    });
  },
  onBack() {
    wx.navigateBack({ delta: 1 });
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
