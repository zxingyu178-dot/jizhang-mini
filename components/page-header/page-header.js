const device = require('../../utils/device');
const keyboard = require('../../utils/keyboard');

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
      const goBack = () => {
        if (pages.length > 1) {
          wx.navigateBack({ delta: 1 });
        } else {
          wx.reLaunch({ url: '/pages/main/main' });
        }
      };
      // 键盘开着时先收键盘再返回，避免真机 viewport 错位（白条/上移）。
      keyboard.hideKeyboard().then(goBack);
    },
  },
});
