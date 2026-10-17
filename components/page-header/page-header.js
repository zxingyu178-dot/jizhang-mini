const device = require('../../utils/device');

Component({
  options: {
    multipleSlots: true,
  },
  properties: {
    title: { type: String, value: '' },
    showBack: { type: Boolean, value: true },
  },
  data: {
    statusBarHeight: 20,
    headerHeight: 64,
  },
  lifetimes: {
    attached() {
      const info = device.get();
      this.setData({
        statusBarHeight: info.statusBarHeight,
        headerHeight: info.headerHeight,
      });
    },
  },
  methods: {
    onBack() {
      this.triggerEvent('back', {}, { bubbles: false, composed: false });
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack({ delta: 1 });
      } else {
        wx.reLaunch({ url: '/pages/main/main' });
      }
    },
  },
});
