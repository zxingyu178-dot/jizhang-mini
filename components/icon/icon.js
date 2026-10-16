// components/icon/icon.js
// 单色线性图标（本地 SVG，无 Emoji）。颜色 / 尺寸由属性控制，便于与文字色统一。
// 用 base64 data-URI 渲染，WebView / Skyline 双端稳定，不依赖网络与字体文件。

const B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

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

// 24x24 viewBox，描边单色，stroke-width=2，圆角线帽
const ICONS = {
  search:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__COLOR__" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.6" y1="16.6" x2="21" y2="21"/></svg>',
  settings:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__COLOR__" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.7 7.7 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.5 6.5 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.5 6.5 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.9 6.9 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>',
  // 左箭头（月份）
  chevronLeft:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__COLOR__" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 5 8 12 15 19"/></svg>',
  // 右箭头（月份）
  chevronRight:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="__COLOR__" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 5 16 12 9 19"/></svg>',
};

Component({
  properties: {
    name: { type: String, value: 'search' },
    size: { type: Number, value: 22 }, // px
    color: { type: String, value: 'rgba(255,255,255,0.62)' },
  },
  data: {
    uri: '',
    w: 22,
    h: 22,
  },
  lifetimes: {
    attached() {
      this.update(this.data.name, this.data.size, this.data.color);
    },
  },
  observers: {
    'name, size, color': function (name, size, color) {
      this.update(name, size, color);
    },
  },
  methods: {
    update(name, size, color) {
      const raw = ICONS[name] || ICONS.search;
      const svg = raw.replace(/__COLOR__/g, color || 'rgba(255,255,255,0.62)');
      const uri = 'data:image/svg+xml;base64,' + b64encodeAscii(svg);
      this.setData({ uri, w: size, h: size });
    },
  },
});
