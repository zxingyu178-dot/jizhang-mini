// png-lite.js —— 极简 PNG 读写（仅 8-bit RGB/RGBA、非隔行），零依赖，用内置 zlib。
// 用途：把 automator 的截图裁成局部大图、并按像素列采样亮度，做「台阶是否真的画出来」的取证。
'use strict';

const zlib = require('zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** @returns {{width:number,height:number,data:Buffer}} data 为 RGBA4 通道 */
function decode(buf) {
  if (!buf.slice(0, 8).equals(SIG)) throw new Error('不是 PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  let palette = null;
  let trns = null;

  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.slice(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      trns = body;
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8) throw new Error('只支持 8-bit PNG，当前 ' + bitDepth);
  if (interlace) throw new Error('不支持隔行 PNG');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : colorType === 3 ? 1 : -1;
  if (channels < 0) throw new Error('不支持 colorType=' + colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let p = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.slice(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) throw new Error('未知 filter=' + filter);
      line[i] = v;
    }
    prev = line;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * bpp;
      if (colorType === 3) {
        const idx = line[s];
        out[o] = palette[idx * 3];
        out[o + 1] = palette[idx * 3 + 1];
        out[o + 2] = palette[idx * 3 + 2];
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (channels === 1) {
        out[o] = out[o + 1] = out[o + 2] = line[s];
        out[o + 3] = 255;
      } else if (channels === 2) {
        out[o] = out[o + 1] = out[o + 2] = line[s];
        out[o + 3] = line[s + 1];
      } else if (channels === 3) {
        out[o] = line[s];
        out[o + 1] = line[s + 1];
        out[o + 2] = line[s + 2];
        out[o + 3] = 255;
      } else {
        out[o] = line[s];
        out[o + 1] = line[s + 1];
        out[o + 2] = line[s + 2];
        out[o + 3] = line[s + 3];
      }
    }
  }
  return { width: width, height: height, data: out };
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.concat([t, body]);
  let crc = 0xffffffff;
  for (let i = 0; i < crcBuf.length; i++) {
    crc ^= crcBuf[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const crcOut = Buffer.alloc(4);
  crcOut.writeUInt32BE(crc, 0);
  return Buffer.concat([len, t, body, crcOut]);
}

/** 输入 RGBA，输出 PNG buffer */
function encode(img) {
  const { width, height, data } = img;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crop(img, x0, y0, w, h) {
  const x = Math.max(0, Math.min(img.width - 1, Math.round(x0)));
  const y = Math.max(0, Math.min(img.height - 1, Math.round(y0)));
  const ww = Math.max(1, Math.min(img.width - x, Math.round(w)));
  const hh = Math.max(1, Math.min(img.height - y, Math.round(h)));
  const out = Buffer.alloc(ww * hh * 4);
  for (let j = 0; j < hh; j++) {
    img.data.copy(out, j * ww * 4, ((y + j) * img.width + x) * 4, ((y + j) * img.width + x + ww) * 4);
  }
  return { width: ww, height: hh, data: out };
}

/** 最近邻放大，方便肉眼看清 1px 台阶 */
function scale(img, k) {
  const w = Math.round(img.width * k);
  const h = Math.round(img.height * k);
  const out = Buffer.alloc(w * h * 4);
  for (let j = 0; j < h; j++) {
    const sy = Math.min(img.height - 1, Math.floor(j / k));
    for (let i = 0; i < w; i++) {
      const sx = Math.min(img.width - 1, Math.floor(i / k));
      const s = (sy * img.width + sx) * 4;
      const o = (j * w + i) * 4;
      out[o] = img.data[s];
      out[o + 1] = img.data[s + 1];
      out[o + 2] = img.data[s + 2];
      out[o + 3] = img.data[s + 3];
    }
  }
  return { width: w, height: h, data: out };
}

/** 取一列像素（返回自上而下） */
function column(img, x) {
  const xx = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const out = [];
  for (let y = 0; y < img.height; y++) {
    const o = (y * img.width + xx) * 4;
    out.push([img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]]);
  }
  return out;
}

function hex(rgb) {
  return '#' + rgb.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** sRGB 相对亮度（0~255 标度），用来量明暗台阶的跳变幅度 */
function luma(rgb) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])) * 255;
}

module.exports = { decode, encode, crop, scale, column, hex, luma };
