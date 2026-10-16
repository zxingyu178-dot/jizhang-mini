// pages/data-privacy/data-privacy.js
// 数据与隐私：说明数据存储位置与边界。
const device = require('../../utils/device');

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
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
});
