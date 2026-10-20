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
      // 防双击锁：异步收键盘（最长约 120ms）期间连点可能退两级，锁定直到本次返回。
      if (this._backing) return;
      this._backing = true;
      this.triggerEvent('back', {}, { bubbles: false, composed: false });
      const release = () => { this._backing = false; };
      const pages = getCurrentPages();
      const goBack = () => {
        if (pages.length > 1) {
          wx.navigateBack({ delta: 1, fail: release });
        } else {
          wx.reLaunch({ url: '/pages/main/main', fail: release });
        }
      };
      // 键盘开着时先收键盘再返回，避免真机 viewport 错位（白条/上移）。
      keyboard.hideKeyboard().then(goBack).catch(release);
    },
  },
});
