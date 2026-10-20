// pages/data-privacy/data-privacy.js
// 数据与隐私：说明数据存储位置与边界。
const device = require('../../utils/device');
const theme = require('../../utils/theme');

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    themeClass: 'theme-dark',
  },
  onLoad() {
    const info = device.get();
    this.setData({
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      headerHeight: info.headerHeight,
    });
    // 主题绑定：根容器 themeClass 实时跟随，不重启、不丢状态。
    this._offTheme = theme.bindPage(this);
  },
  onUnload() {
    if (this._offTheme) { this._offTheme(); this._offTheme = null; }
  },
});
