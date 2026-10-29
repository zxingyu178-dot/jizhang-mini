/**
 * utils/path-normalize.js — SVG 图形离散化（v1.3.0）
 *
 * 微信 <image> 解析 data-URI 内联 SVG 时，对长且含 C/A 等曲线命令的复杂 path
 * 存在解析缺陷（图标渲染成乱码字符）。这里把所有命令统一转成绝对坐标，
 * 并把曲线（C/S/Q/T/A）采样离散为 L 直线段，最终只输出 M/L/Z；
 * circle/rect/line/polyline 也统一转换为 <path>。纯 L 长路径在双端渲染可靠。
 *
 * 坐标量化精度同样关键：所有坐标经 r() 保留 2 位小数（0.01）。实测 3 位
 * 小数（0.001）的高精度几何会触发渲染器缺陷（dining 碗+筷+叉渲染成乱码），
 * 2 位小数在 24 单位 viewBox 上视觉无损、渲染可靠。
 *
 * 纯函数，无 FS / 网络依赖，可在 Node 单测中直接调用。
 */

const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function tokenize(d) {
  const cmds = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m, cur = null, buf = [];
  const flush = () => { if (cur) cmds.push({ c: cur, args: buf }); buf = []; };
  while ((m = re.exec(d))) {
    if (m[1]) { flush(); cur = m[1]; } else buf.push(parseFloat(m[2]));
  }
  flush();
  return cmds;
}

function expand(cmds) {
  const out = [];
  for (const { c, args } of cmds) {
    const upper = c.toUpperCase();
    const n = ARITY[upper];
    if (n === 0) { out.push({ c, args: [] }); continue; }
    let i = 0, first = true;
    while (i < args.length) {
      let useC = c;
      if (!first && upper === 'M') useC = c === 'M' ? 'L' : 'l';
      first = false;
      out.push({ c: useC, args: args.slice(i, i + n) });
      i += n;
    }
  }
  return out;
}

function arcToCenter(x1, y1, x2, y2, rx, ry, phiDeg, fA, fS) {
  let rxs = rx * rx, rys = ry * ry;
  const phi = phiDeg * Math.PI / 180;
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const x1p = cp * dx + sp * dy;
  const y1p = -sp * dx + cp * dy;
  const x1ps = x1p * x1p, y1ps = y1p * y1p;
  const lambda = x1ps / rxs + y1ps / rys;
  if (lambda > 1) {
    const k = Math.sqrt(lambda);
    rx *= k; ry *= k; rxs = rx * rx; rys = ry * ry;
  }
  const sign = (fA === fS) ? -1 : 1;
  const num = rxs * rys - rxs * y1ps - rys * x1ps;
  const den = rxs * y1ps + rys * x1ps;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = co * (rx * y1p / ry);
  const cyp = co * (-ry * x1p / rx);
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2;
  const cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const theta1 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
  const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
  let dtheta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (fS === 1 && dtheta < 0) dtheta += Math.PI * 2;
  if (fS === 0 && dtheta > 0) dtheta -= Math.PI * 2;
  return { cx, cy, rx, ry, phi, theta1, dtheta };
}

// 坐标统一量化到 2 位小数（0.01）。实测微信 <image> 解析内联 SVG 时，
// 3 位小数（0.001）的高精度几何会触发渲染器缺陷（如 dining 显示成乱码字符），
// 2 位小数在 24 单位 viewBox 上视觉无损且渲染可靠。
function r(v) { return Math.round(v * 100) / 100; }
function cubic(p, t) {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, e = t * t * t;
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + e * p[3][0],
    a * p[0][1] + b * p[1][1] + c * p[2][1] + e * p[3][1]];
}
function quad(p, t) {
  const mt = 1 - t;
  return [mt * mt * p[0][0] + 2 * mt * t * p[1][0] + t * t * p[2][0],
    mt * mt * p[0][1] + 2 * mt * t * p[1][1] + t * t * p[2][1]];
}

function flatten(d, segments = 10) {
  const steps = expand(tokenize(d));
  let x = 0, y = 0, sx = 0, sy = 0;
  let lastCubicCtrl = null; // 上一个 C/S 的第二控制点
  let lastQuadCtrl = null;  // 上一个 Q/T 的控制点
  const out = [];
  const emit = (px, py) => out.push('L' + r(px) + ' ' + r(py));
  for (const { c, args } of steps) {
    const upper = c.toUpperCase();
    const rel = c === c.toLowerCase() && upper !== 'Z';
    const abs = (a, i) => rel ? a[i] + (i % 2 === 0 ? x : y) : a[i];
    if (upper === 'M') {
      x = abs(args, 0); y = abs(args, 1); sx = x; sy = y;
      lastCubicCtrl = null; lastQuadCtrl = null;
      out.push('M' + r(x) + ' ' + r(y));
    } else if (upper === 'L') {
      x = abs(args, 0); y = abs(args, 1); emit(x, y);
    } else if (upper === 'H') {
      x = rel ? args[0] + x : args[0]; emit(x, y);
    } else if (upper === 'V') {
      y = rel ? args[0] + y : args[0]; emit(x, y);
    } else if (upper === 'C') {
      const p = [[x, y], [abs(args, 0), abs(args, 1)], [abs(args, 2), abs(args, 3)], [abs(args, 4), abs(args, 5)]];
      lastCubicCtrl = p[2];
      for (let i = 1; i <= segments; i++) emit(...cubic(p, i / segments));
      x = p[3][0]; y = p[3][1];
    } else if (upper === 'S') {
      const refl = lastCubicCtrl ? [2 * x - lastCubicCtrl[0], 2 * y - lastCubicCtrl[1]] : [x, y];
      const p = [[x, y], refl, [abs(args, 0), abs(args, 1)], [abs(args, 2), abs(args, 3)]];
      lastCubicCtrl = p[2];
      for (let i = 1; i <= segments; i++) emit(...cubic(p, i / segments));
      x = p[3][0]; y = p[3][1];
    } else if (upper === 'Q') {
      const p = [[x, y], [abs(args, 0), abs(args, 1)], [abs(args, 2), abs(args, 3)]];
      lastQuadCtrl = p[1];
      for (let i = 1; i <= segments; i++) emit(...quad(p, i / segments));
      x = p[2][0]; y = p[2][1];
    } else if (upper === 'T') {
      const refl = lastQuadCtrl ? [2 * x - lastQuadCtrl[0], 2 * y - lastQuadCtrl[1]] : [x, y];
      const p = [[x, y], refl, [abs(args, 0), abs(args, 1)]];
      lastQuadCtrl = p[1];
      for (let i = 1; i <= segments; i++) emit(...quad(p, i / segments));
      x = p[2][0]; y = p[2][1];
    } else if (upper === 'A') {
      const x2 = rel ? args[5] + x : args[5];
      const y2 = rel ? args[6] + y : args[6];
      const rx = args[0], ry = args[1], phi = args[2], fA = args[3], fS = args[4];
      if (rx === 0 || ry === 0) { emit(x2, y2); x = x2; y = y2; continue; }
      const info = arcToCenter(x, y, x2, y2, rx, ry, phi, fA, fS);
      const n = Math.max(segments, Math.ceil(Math.abs(info.dtheta) / (Math.PI / 2) * segments));
      for (let i = 1; i <= n; i++) {
        const ang = info.theta1 + info.dtheta * (i / n);
        const ex = info.cx + info.rx * Math.cos(ang) * Math.cos(info.phi) - info.ry * Math.sin(ang) * Math.sin(info.phi);
        const ey = info.cy + info.rx * Math.cos(ang) * Math.sin(info.phi) + info.ry * Math.sin(ang) * Math.cos(info.phi);
        emit(ex, ey);
      }
      x = x2; y = y2;
    } else if (upper === 'Z') {
      out.push('Z'); x = sx; y = sy;
      lastCubicCtrl = null; lastQuadCtrl = null;
    }
  }
  return out.join(' ');
}

function parseAttrs(tag) {
  const attrs = {};
  const re = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1]] = m[2];
  return attrs;
}

// 把 circle/rect/line/polyline 转成标准 path d（再交给 flatten）
function elementToPath(tag) {
  const name = (tag.match(/^<(\w+)/) || [])[1];
  const a = parseAttrs(tag);
  if (name === 'line') {
    return flatten('M' + a.x1 + ' ' + a.y1 + ' L' + a.x2 + ' ' + a.y2);
  }
  if (name === 'polyline') {
    const pts = (a.points || '').trim().split(/[\s,]+/).map(Number);
    let d = '';
    for (let i = 0; i + 1 < pts.length; i += 2) d += (i === 0 ? 'M' : 'L') + pts[i] + ' ' + pts[i + 1] + ' ';
    return flatten(d);
  }
  if (name === 'circle') {
    const cx = +a.cx, cy = +a.cy, rad = +a.r;
    return flatten('M' + (cx + rad) + ' ' + cy + ' A' + rad + ' ' + rad + ' 0 1 1 ' + (cx - rad) + ' ' + cy +
      ' A' + rad + ' ' + rad + ' 0 1 1 ' + (cx + rad) + ' ' + cy + ' Z');
  }
  if (name === 'rect') {
    const x = +(a.x || 0), y = +(a.y || 0), w = +a.width, h = +a.height;
    let rad = +(a.rx || a.ry || 0);
    rad = Math.min(rad, w / 2, h / 2);
    if (rad === 0) {
      return flatten('M' + x + ' ' + y + ' H' + (x + w) + ' V' + (y + h) + ' H' + x + ' Z');
    }
    const d = 'M' + (x + rad) + ' ' + y +
      ' H' + (x + w - rad) +
      ' A' + rad + ' ' + rad + ' 0 0 1 ' + (x + w) + ' ' + (y + rad) +
      ' V' + (y + h - rad) +
      ' A' + rad + ' ' + rad + ' 0 0 1 ' + (x + w - rad) + ' ' + (y + h) +
      ' H' + (x + rad) +
      ' A' + rad + ' ' + rad + ' 0 0 1 ' + x + ' ' + (y + h - rad) +
      ' V' + (y + rad) +
      ' A' + rad + ' ' + rad + ' 0 0 1 ' + (x + rad) + ' ' + y + ' Z';
    return flatten(d);
  }
  if (name === 'path') return flatten(' ' + a.d + ' ');
  return null;
}

// 规范化整个 svg inner body：全部转 <path d="M/L/Z"/>
function normalizeBody(body) {
  const tags = [...body.matchAll(/<[^>]+>/g)].map(m => m[0]);
  const out = [];
  for (const tag of tags) {
    const d = elementToPath(tag);
    if (d) out.push('<path d="' + d + '"/>');
  }
  return out.join('');
}

module.exports = { flatten, normalizeBody };
