// utils/b64.js
// 纯 ASCII 字符串的 Base64 编码（用于把内联 SVG 转成 data-URI）。
// 仅保证 ASCII 输入正确（SVG 的 path / 颜色均为 ASCII）；不处理多字节字符。
// 不依赖 wx / 网络，Node 单测与小程序运行时均可直接使用。

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

module.exports = { b64encodeAscii };
