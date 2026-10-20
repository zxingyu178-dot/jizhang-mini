// pages/appearance/appearance.js
// 外观（v0.9.0）：主题三选一 —— 跟随系统 / 深色 / 浅色。
// 点击即时生效（写 settings.theme 并全 App 实时更新），无需保存按钮；
// 只改主题 class，不 reLaunch、不重置数据、不丢当前页面状态。
const device = require('../../utils/device');
const theme = require('../../utils/theme');

const OPTIONS = [
  { value: 'system', label: '跟随系统', desc: '根据手机系统外观自动切换' },
  { value: 'dark', label: '深色', desc: '紫黑毛玻璃' },
  { value: 'light', label: '浅色', desc: '浅灰紫毛玻璃' },
];

Page({
  data: {
    windowHeight: 0,
    headerHeight: 0,
    options: OPTIONS,
    themeMode: 'dark',
    effectiveTheme: 'dark',
    themeClass: 'theme-dark',
  },
  onLoad() {
    const info = device.get();
    this.setData({
      windowHeight: info.windowHeight,
      headerHeight: info.headerHeight,
    });
    // 绑定主题：立即 setData 并订阅，返回取消。
    this._offTheme = theme.bindPage(this);
  },
  onUnload() {
    if (this._offTheme) {
      this._offTheme();
      this._offTheme = null;
    }
  },
  onSelect(e) {
    const value = e.currentTarget.dataset.value;
    theme.setThemeMode(value);
  },
});
