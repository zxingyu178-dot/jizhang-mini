// components/category-icon/category-icon.js
// 分类图标（v1.2.0）：builtin 渲染本地 SVG（base64 data-URI，颜色走深浅主题 token），
// emoji 渲染文本 emoji；非法 / 未知图标回退 emoji 或 📦。支持 framed（主色浅底圆角）。
// 不依赖网络 / CDN / 字体文件；WebView / Skyline 双端稳定，主题切换时重染。

const theme = require('../../utils/theme');
const categoryIcons = require('../../data/category-icons');

const B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// tone → 实际颜色（与 components/icon 保持一致；base64 SVG 需具体颜色字符串）
const TONE_COLORS = {
  dark: {
    primary: 'rgba(255,255,255,0.86)',
    secondary: 'rgba(255,255,255,0.62)',
    faint: 'rgba(255,255,255,0.40)',
    inverse: '#ffffff',
    brand: '#7c86ff',
    danger: '#ef606b',
  },
  light: {
    primary: 'rgba(25,28,40,0.88)',
    secondary: 'rgba(25,28,40,0.58)',
    faint: 'rgba(25,28,40,0.38)',
    inverse: '#ffffff',
    brand: '#6e78f5',
    danger: '#dc4a55',
  },
};

function b64encodeAscii(str) {
  let out = '';
  for (let i = 0; i < str.length; i += 3) {
    const c1 = str.charCodeAt(i);
    const has2 = i + 1 < str.length;
    const has3 = i + 2 < str.length;
    const c2 = has2 ? str.charCodeAt(i + 1) : 0;
    const c3 = has3 ? str.charCodeAt(i + 2) : 0;
    out += B64CHARS[c1 >> 2];
    out += B64CHARS[((c1 & 3) << 4) | (c2 >> 4)];
    out += has2 ? B64CHARS[((c2 & 15) << 2) | (c3 >> 6)] : '=';
    out += has3 ? B64CHARS[c3 & 63] : '=';
  }
  return out;
}

Component({
  properties: {
    iconType: { type: String, value: '' }, // builtin | emoji；空则按旧调用走 emoji 兜底
    iconValue: { type: String, value: '' }, // builtin → 图标 id；emoji → emoji 字符
    emoji: { type: String, value: '' }, // 兜底 emoji（旧字段 / 渲染失败回退）
    size: { type: Number, value: 28 }, // 图标视觉盒 px
    tone: { type: String, value: 'primary' }, // primary/secondary/faint/inverse/brand/danger
    color: { type: String, value: '' }, // 显式颜色优先；空则按 tone + 主题
    framed: { type: Boolean, value: false }, // 主色浅底圆角容器
  },
  data: {
    mode: 'emoji', // builtin | emoji
    uri: '',
    emojiText: '',
    iconSize: 28,
    boxSize: 28,
    emojiSize: 28,
  },
  lifetimes: {
    attached() {
      try { theme.init(); } catch (e) { /* 忽略 */ }
      // 主题变化时重算颜色（system 模式跟随系统）
      this._offTheme = theme.subscribe(() => this.refresh());
      this.refresh();
    },
    detached() {
      if (this._offTheme) { this._offTheme(); this._offTheme = null; }
    },
  },
  observers: {
    'iconType, iconValue, emoji, size, tone, color, framed': function () {
      this.refresh();
    },
  },
  methods: {
    resolveColor() {
      if (this.data.color) return this.data.color;
      let t = 'dark';
      try { t = theme.getEffectiveTheme(); } catch (e) { t = 'dark'; }
      const map = TONE_COLORS[t] || TONE_COLORS.dark;
      return map[this.data.tone] || map.primary;
    },
    refresh() {
      const d = this.data;
      const size = d.size;
      const framePad = Math.round(size * 0.3);
      const boxSize = d.framed ? size + framePad * 2 : size;

      let mode = 'emoji';
      let emojiText = d.emoji || '📦';
      let uri = '';

      if (d.iconType === 'builtin' && d.iconValue && categoryIcons.isBuiltinId(d.iconValue)) {
        // 合法 builtin：本地 SVG，颜色按 tone/主题。
        mode = 'builtin';
        const def = categoryIcons.builtinIconById(d.iconValue);
        const color = this.resolveColor();
        const svg =
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
          'stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" ' +
          'stroke-linejoin="round">' + def.body + '</svg>';
        uri = 'data:image/svg+xml;base64,' + b64encodeAscii(svg);
      } else if (d.iconType === 'emoji') {
        // 显式 emoji 模式。
        mode = 'emoji';
        emojiText = d.iconValue || d.emoji || '📦';
      } else {
        // 无 iconType / 非法 builtin：emoji 兜底（不允许空白）。
        mode = 'emoji';
        emojiText = d.emoji || d.iconValue || '📦';
      }

      this.setData({
        mode,
        uri,
        emojiText,
        iconSize: size,
        boxSize,
        emojiSize: size,
      });
    },
  },
});
