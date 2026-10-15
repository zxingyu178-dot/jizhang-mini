// packages/importer/encoding/gbk.js
// 账单文本编码处理：UTF-8（BOM/严格校验）与 GBK/GB18030。
// 优先使用运行时 TextDecoder('gb18030')；不支持时使用项目自有的纯 JS CP936 解码。
// 无 Node Buffer/fs。
const cp936 = require('./cp936');

const REPLACEMENT = '�';

/**
 * 纯 JS GBK/CP936 解码（不依赖系统 TextDecoder，也不依赖 SheetJS 运行时）。
 * 单字节 0x00-0x7F 按 ASCII；双字节按 CP936 码表（索引 = (b1<<8)|b2）。
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function decodeGbkFallback(bytes) {
  const dec = cp936.dec;
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    if (i + 1 >= bytes.length) {
      out += REPLACEMENT;
      i++;
      continue;
    }
    const b2 = bytes[i + 1];
    const ch = dec[(b << 8) | b2];
    if (ch) {
      out += ch;
      i += 2;
    } else {
      out += REPLACEMENT;
      i++;
    }
  }
  return out;
}

/** 严格按 UTF-8 解码；任何非法序列返回 {ok:false} */
function tryUtf8(bytes) {
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      result += String.fromCharCode(b);
      i++;
    } else if (b >= 0xc0 && b < 0xe0) {
      const b1 = bytes[i + 1];
      if (i + 1 >= bytes.length || (b1 & 0xc0) !== 0x80) return { ok: false };
      result += String.fromCharCode(((b & 0x1f) << 6) | (b1 & 0x3f));
      i += 2;
    } else if (b >= 0xe0 && b < 0xf0) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      if (
        i + 2 >= bytes.length ||
        (b1 & 0xc0) !== 0x80 ||
        (b2 & 0xc0) !== 0x80
      )
        return { ok: false };
      result += String.fromCharCode(
        ((b & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f)
      );
      i += 3;
    } else if (b >= 0xf0 && b < 0xf8) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      const b3 = bytes[i + 3];
      if (
        i + 3 >= bytes.length ||
        (b1 & 0xc0) !== 0x80 ||
        (b2 & 0xc0) !== 0x80 ||
        (b3 & 0xc0) !== 0x80
      )
        return { ok: false };
      let cp =
        ((b & 0x07) << 18) |
        ((b1 & 0x3f) << 12) |
        ((b2 & 0x3f) << 6) |
        (b3 & 0x3f);
      cp -= 0x10000;
      result += String.fromCharCode(
        0xd800 + (cp >> 10),
        0xdc00 + (cp & 0x3ff)
      );
      i += 4;
    } else {
      return { ok: false };
    }
  }
  return { ok: true, text: result };
}

/**
 * 解码 GB18030：优先系统 TextDecoder；不支持或失败时用纯 JS CP936 fallback。
 * 不再要求用户去电脑转 UTF-8。
 */
function gbDecode(bytes) {
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('gb18030').decode(bytes);
    } catch (e) {
      /* 继续纯 JS fallback */
    }
  }
  return decodeGbkFallback(bytes);
}

/** 当前环境是否支持 GB18030 解码 */
function hasGbkSupport() {
  if (typeof TextDecoder === 'undefined') return false;
  try {
    new TextDecoder('gb18030');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 自动识别并解码账单文件字节。
 * @param {ArrayBuffer} buffer
 * @returns {{ text:string, encoding:string }}
 */
function decodeBytes(buffer) {
  const bytes = new Uint8Array(buffer);

  // UTF-8 BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const r = tryUtf8(bytes.subarray(3));
    return { text: r.text, encoding: 'utf-8' };
  }

  // 严格 UTF-8
  const utf8 = tryUtf8(bytes);
  if (utf8.ok) return { text: utf8.text, encoding: 'utf-8' };

  // GB18030
  const text = gbDecode(bytes);
  return { text, encoding: 'gb18030' };
}

module.exports = {
  decodeBytes,
  decodeGbkFallback,
  tryUtf8,
  hasGbkSupport,
};
