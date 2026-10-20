/**
 * scripts/theme-audit.js — v0.9.0 主题硬编码审计（Theme Hardcoded Color Audit）
 *
 * 目的：v0.9.0 引入双主题后，页面 / 组件 / 分包里不得再直接写死「随主题变化」的颜色，
 * 否则浅色主题会出现白字白底、深色卡片不翻转等问题。本脚本扫描全部 wxss / wxml，
 * 对每一处直接颜色（hex / rgb / rgba）做白名单判定，非白名单即 FAIL。
 *
 * 扫描范围（随主题变化的层）：
 *   pages/**、components/**、packages/** 的 *.wxss 与 *.wxml
 * 不扫描（主题定义源头，本就该写具体颜色）：
 *   app.wxss、theme.json、scripts/**、tests/**
 *
 * 白名单（这些颜色两主题都成立，或属于不随主题反转的业务色）：
 *   1. 纯黑投影 / 遮罩：rgba(0,0,0,*)、#000；
 *   2. 品牌紫：#7c86ff/#6e78f5/#5b67f0/#5660e0 及其 rgba()；
 *   3. 业务绿（支出/盈余）、业务红（收入/超支）、业务警示黄：两主题只加深、不反转；
 *   4. 开关滑块白：仅在 selector 含 knob/dot 的规则内允许 #ffffff；
 *   5. 成功绿底上的深勾：#06100b。
 *
 * 用法：node scripts/theme-audit.js
 * 退出码：0 无违规（允许白名单）；1 存在 FAIL。
 */
const nodeFs = require('fs');
const nodePath = require('path');

const ROOT = nodePath.join(__dirname, '..');
const SCAN_DIRS = ['pages', 'components', 'packages'];
const SCAN_EXT = new Set(['.wxss', '.wxml']);

// ---- 颜色正则 ----
const HEX_RE = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
const RGB_RE = /rgba?\([^)]*\)/gi;

// ---- 白名单集合 ----
// 品牌紫（hex）
const BRAND_HEX = new Set([
  '#7c86ff', '#6e78f5', '#5b67f0', '#5660e0',
]);
// 业务绿（支出 / 盈余）
const GREEN_HEX = new Set([
  '#3ddc8f', '#38c896', '#2bb874', '#5fd6ab', '#8fe7c6',
  '#16a36c', '#159a72', '#0f7f5e',
]);
// 业务红（收入 / 超支）
const RED_HEX = new Set([
  '#ff6b6b', '#ef606b', '#d94a55', '#f5838b', '#f89aa0',
  '#e0474f', '#dc4a55', '#c8363f', '#b8353f',
]);
// 业务警示黄
const WARN_HEX = new Set(['#f0b35b', '#ffc861', '#cc8f2e']);
// 其它固定允许
const FIXED_HEX = new Set(['#06100b', '#000000', '#000']);
// 品牌紫 rgb 三元组
const BRAND_RGB = new Set(['124,134,255', '110,120,245', '91,103,240', '86,96,224']);
// 业务绿 rgb 三元组
const GREEN_RGB = new Set(['61,220,143', '56,200,150', '22,163,108', '21,154,114']);
// 业务红 rgb 三元组
const RED_RGB = new Set(['255,107,107', '239,96,107', '224,71,79', '220,74,85']);
// 业务黄 rgb 三元组
const WARN_RGB = new Set(['240,179,91', '255,200,97', '204,143,46']);

function collapse(s) {
  return String(s).replace(/\s+/g, '').toLowerCase();
}

/** 判定一个颜色是否白名单；whiteSelector 为当前 CSS 选择器（用于白滑块）。 */
function classify(color, whiteSelector) {
  const c = collapse(color);
  // hex
  if (c.charAt(0) === '#') {
    if (FIXED_HEX.has(c)) return { ok: true };
    if (BRAND_HEX.has(c)) return { ok: true };
    if (GREEN_HEX.has(c)) return { ok: true };
    if (RED_HEX.has(c)) return { ok: true };
    if (WARN_HEX.has(c)) return { ok: true };
    // 白色：仅 knob/dot 滑块上下文允许
    if (c === '#fff' || c === '#ffffff') {
      if (whiteSelector && /(knob|dot)/.test(whiteSelector)) return { ok: true };
      return { ok: false, reason: '白色在浅色主题不可见，应使用 --text-primary/--surface 等 token' };
    }
    return { ok: false, reason: '非白名单硬编码颜色，应使用 Design Token' };
  }
  // rgb / rgba
  const m = c.match(/^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/);
  if (m) {
    const triple = m[1] + ',' + m[2] + ',' + m[3];
    const alpha = m[4] === undefined ? 1 : Number(m[4]);
    // 纯黑（投影 / 遮罩）
    if (triple === '0,0,0') return { ok: true };
    if (BRAND_RGB.has(triple)) return { ok: true };
    if (GREEN_RGB.has(triple)) return { ok: true };
    if (RED_RGB.has(triple)) return { ok: true };
    if (WARN_RGB.has(triple)) return { ok: true };
    // 白色：knob/dot 滑块上下文
    if (triple === '255,255,255') {
      if (whiteSelector && /(knob|dot)/.test(whiteSelector)) return { ok: true };
      // 半透明白在浅色下亦会失效
      if (alpha < 1) return { ok: false, reason: '半透明白在浅色主题不可见，应使用 token' };
      return { ok: false, reason: '白色在浅色主题不可见，应使用 token' };
    }
    return { ok: false, reason: '非白名单硬编码颜色，应使用 Design Token' };
  }
  return { ok: false, reason: '无法解析的颜色写法' };
}

function listFiles(dir) {
  const out = [];
  nodeFs.readdirSync(dir).forEach((name) => {
    const full = nodePath.join(dir, name);
    const st = nodeFs.statSync(full);
    if (st.isDirectory()) out.push(...listFiles(full));
    else if (SCAN_EXT.has(nodePath.extname(name))) out.push(full);
  });
  return out;
}

let totalFailures = 0;
let totalAllowed = 0;

function auditFile(file) {
  const rel = nodePath.relative(ROOT, file).split(nodePath.sep).join('/');
  const lines = nodeFs.readFileSync(file, 'utf8').split(/\r?\n/);
  let selectorBuffer = '';
  let currentSelector = '';
  let fileFailures = 0;

  lines.forEach((rawLine, idx) => {
    let line = rawLine;
    // 维护当前 CSS 选择器（wxss）。wxml 无选择器概念，传空。
    if (file.endsWith('.wxss')) {
      const open = line.indexOf('{');
      if (open >= 0) {
        currentSelector = collapse(selectorBuffer + ' ' + line.slice(0, open));
        selectorBuffer = '';
        line = line.slice(open + 1);
      } else if (line.indexOf('}') >= 0) {
        currentSelector = '';
        selectorBuffer = '';
      } else if (!currentSelector) {
        // 处于规则外，累计为选择器缓冲
        selectorBuffer += ' ' + line;
      }
    }
    const whiteSelector = currentSelector;

    const colors = [];
    let m;
    HEX_RE.lastIndex = 0;
    while ((m = HEX_RE.exec(line))) colors.push(m[0]);
    RGB_RE.lastIndex = 0;
    while ((m = RGB_RE.exec(line))) colors.push(m[0]);

    colors.forEach((color) => {
      const r = classify(color, whiteSelector);
      if (r.ok) {
        totalAllowed++;
      } else {
        fileFailures++;
        totalFailures++;
        console.log('  [FAIL] ' + rel + ':' + (idx + 1) + '  ' + color + '  — ' + r.reason);
      }
    });
  });
  return fileFailures;
}

console.log('==== Theme Hardcoded Color Audit ====');
SCAN_DIRS.forEach((d) => {
  const dir = nodePath.join(ROOT, d);
  if (!nodeFs.existsSync(dir)) return;
  listFiles(dir).forEach(auditFile);
});

console.log('\n-------------------- 汇总 --------------------');
console.log('白名单直接色：' + totalAllowed + ' 处；违规：' + totalFailures + ' 处。');
if (totalFailures > 0) {
  console.error('主题审计未通过：请把上述硬编码颜色改为 Design Token（或确认后加入白名单）。');
  process.exit(1);
}
console.log('主题审计通过：未发现非白名单硬编码颜色。');
process.exit(0);
