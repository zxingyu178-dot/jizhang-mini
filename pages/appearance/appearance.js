// pages/appearance/appearance.js
// 外观（v0.9.0）：主题三选一 —— 跟随系统 / 深色 / 浅色。
// v1.4.5：新增「主题色」四选一 —— 靛蓝 / 青竹 / 琥珀 / 玫红（默认靛蓝，老用户零感知）。
// 点击即时生效（写 settings.theme / settings.accent 并全 App 实时更新），无需保存按钮；
// 只改主题 class，不 reLaunch、不重置数据、不丢当前页面状态。
const device = require('../../utils/device');
const theme = require('../../utils/theme');

const OPTIONS = [
  { value: 'system', label: '跟随系统', desc: '根据手机系统外观自动切换' },
  { value: 'dark', label: '深色', desc: '紫黑毛玻璃' },
  { value: 'light', label: '浅色', desc: '浅灰紫毛玻璃' },
];

/** 主题色展示顺序（与 utils/theme.ACCENTS 的 key 一致） */
const ACCENT_ORDER = ['indigo', 'teal', 'amber', 'rose'];

/**
 * 色卡实色：色卡是「色样」，展示这套主题色本身长什么样，**固定取最鲜亮那一档**
 * （深色模式的 primary），不随深/浅模式变暗。
 * 理由：色卡不承载正文，不需要满足 4.5:1；若跟着模式取 light.deep，「琥珀」会显示成
 * 深棕 #8a5408，用户不会认为那是琥珀色（青竹同理会发墨绿）。着色只表达色相，不表达层级。
 *
 * ⚠️ 色值不在此处维护：统一从 utils/theme.js 的 ACCENTS[x].dark.primary 取（单一来源），
 * 避免将来调色只改 theme.js、漏改色卡两处不一致。
 */

/**
 * 色卡上选中勾的颜色：统一深墨 #0b0d16，**不用 onPrimary**。
 * 理由：onPrimary 在浅色模式是白色，白勾压在 #f0a33e / #2ec4b6 这类亮色上对比度只有
 * 2.0~2.2，看不清；深墨勾在这四色上是 6.19 / 8.94 / 9.24 / 6.43，全达标。
 */
const SWATCH_CHECK = '#0b0d16';

function buildAccents() {
  return ACCENT_ORDER.map((value) => {
    const entry = theme.ACCENTS[value];
    return {
      value,
      label: entry.label,
      swatch: entry.dark.primary,
      checkColor: SWATCH_CHECK,
    };
  });
}

Page({
  data: {
    windowHeight: 0,
    headerHeight: 0,
    options: OPTIONS,
    themeMode: 'dark',
    effectiveTheme: 'dark',
    themeClass: 'theme-dark',
    accent: 'indigo',
    accentClass: 'accent-indigo',
    accents: buildAccents(),
  },
  onLoad() {
    const info = device.get();
    this.setData({
      windowHeight: info.windowHeight,
      headerHeight: info.headerHeight,
    });
    // 绑定主题：立即 setData 并订阅，返回取消。
    this._offTheme = theme.bindPage(this);
    // 色卡是固定色样（不随深/浅模式变），无需订阅主题变化重算；
    // 选中态（accent / accentClass）由 bindPage 的 snapshot 负责更新。
  },
  onUnload() {
    if (this._offTheme) {
      this._offTheme();
      this._offTheme = null;
    }
  },
  onSelect(e) {
    const value = e.currentTarget.dataset.value;
    const r = theme.setThemeMode(value);
    // 持久化失败：内存保持旧主题，提示重试（不出现「选了浅色、重启又变回去」）。
    if (!r || !r.ok) {
      wx.showToast({ title: '主题保存失败，请稍后重试', icon: 'none' });
    }
  },
  onSelectAccent(e) {
    const value = e.currentTarget.dataset.value;
    const r = theme.setAccent(value);
    // 同一套口径：写盘失败不假成功，提示重试（不出现「选了青竹、重启又变回靛蓝」）。
    if (!r || !r.ok) {
      wx.showToast({ title: '主题色保存失败，请稍后重试', icon: 'none' });
    }
  },
});
