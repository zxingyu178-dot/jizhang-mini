// packages/importer/pages/result/result.js
const theme = require('../../../../utils/theme');

Page({
  data: {
    imported: 0,
    merged: 0,
    isRestore: false,
    themeClass: 'theme-dark',
  },

  onLoad(query) {
    this.setData({
      imported: Number(query.imported || 0),
      merged: Number(query.merged || 0),
      isRestore: query.restore === '1',
    });
    // 主题绑定：根容器 themeClass 实时跟随，不重启、不丢状态。
    this._offTheme = theme.bindPage(this);
  },

  onUnload() {
    if (this._offTheme) { this._offTheme(); this._offTheme = null; }
  },

  onFinish() {
    wx.reLaunch({ url: '/pages/main/main' });
  },
});
