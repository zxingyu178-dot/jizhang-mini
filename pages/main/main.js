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
});
