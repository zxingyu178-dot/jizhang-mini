const device = require('../../utils/device');
const keyboard = require('../../utils/keyboard');
const viewport = require('../../utils/viewport');

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
    menuPad: 16, // 右侧避让系统胶囊（px），与主 Header 同口径
  },
  lifetimes: {
    attached() {
      const info = device.get();
      this.setData({
        statusBarHeight: info.statusBarHeight,
        headerHeight: info.headerHeight,
        menuPad: info.menu
          ? Math.round(info.windowWidth - info.menu.left + info.gap)
          : 16,
      });
    },
  },
  methods: {
    onBack() {
      // 防双击锁：异步收键盘（最长约 120ms）期间连点可能退两级，锁定直到本次操作结束。
      if (this._backing) return;
      this._backing = true;
      const release = () => { this._backing = false; };
      // 键盘打开时：第一次返回只收起键盘，第二次才真正返回（沿用原有导航逻辑）。
      if (viewport.isKeyboardOpen()) {
        keyboard.hideKeyboard().then(release).catch(release);
        return;
      }
      this.triggerEvent('back', {}, { bubbles: false, composed: false });
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
