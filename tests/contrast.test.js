/**
 * tests/contrast.test.js — 对比度检测纯函数单测
 *
 * 验证 HSL/HEX 转换、WCAG 相对亮度与对比度的已知值，玻璃卡片背景合成，以及圆环两主题
 * 跨页面 + 卡片全部候选背景的 worst 均达 3:1。
 * 运行：node tests/contrast.test.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) { assert(a === b, msg + '（期望 ' + b + '，实际 ' + a + '）'); }

const C = require(path.join(ROOT, 'data', 'statistics', 'contrast'));
const donut = require(path.join(ROOT, 'data', 'statistics', 'donut'));

console.log('== 1. HSL → RGB 已知值 ==');
eq(C.hslToRgb(0, 100, 50).join(','), '255,0,0', 'hsl(0,100,50)=纯红');
eq(C.hslToRgb(120, 100, 50).join(','), '0,255,0', 'hsl(120,100,50)=纯绿');
eq(C.hslToRgb(240, 100, 50).join(','), '0,0,255', 'hsl(240,100,50)=纯蓝');
eq(C.hslToRgb(0, 0, 0).join(','), '0,0,0', 'hsl(0,0,0)=黑');
eq(C.hslToRgb(0, 0, 100).join(','), '255,255,255', 'hsl(0,0,100)=白');

console.log('== 2. HEX → RGB ==');
eq(C.hexToRgb('#05060a').join(','), '5,6,10', '深色背景 hex 解析');
eq(C.hexToRgb('#f3f4fa').join(','), '243,244,250', '浅色背景 hex 解析');

console.log('== 3. 相对亮度与对比度已知值 ==');
eq(C.relativeLuminance([0, 0, 0]), 0, '纯黑相对亮度=0');
eq(C.relativeLuminance([255, 255, 255]), 1, '纯白相对亮度=1');
eq(C.contrastRatio([255, 255, 255], [0, 0, 0]), 21, '黑白对比度=21');
eq(C.contrastRatio([0, 0, 0], [255, 255, 255]), 21, '对比度与顺序无关');

console.log('== 4. 玻璃卡片背景合成与候选背景 ==');
// 半透明白叠加：深色 9% 端 = 5*0.91+255*0.09 ≈ 28
eq(C.overlayWhite([5, 6, 10], 0.09).map(Math.round).join(','), '28,28,32', '深色卡片 9% 端合成');
eq(C.overlayWhite([5, 6, 10], 0.03).map(Math.round).join(','), '13,13,17', '深色卡片 3% 端合成');
eq(C.overlayWhite([243, 244, 250], 0.88).map(Math.round).join(','), '254,254,254', '浅色卡片 88% 端合成');
const dkBgs = C.candidateBackgrounds('dark');
eq(dkBgs.length, 3, '深色候选背景含 page + 卡片两端');
eq(dkBgs.map((b) => b.label).join(','), 'page,card-start,card-end', '候选背景标签顺序');
const ltBgs = C.candidateBackgrounds('light');
eq(ltBgs.length, 3, '浅色候选背景含 page + 卡片两端');

console.log('== 5. 圆环两主题跨全部候选背景 worst 达标 ==');
const dark = C.worstDonutContrast('dark');
const light = C.worstDonutContrast('light');
assert(dark.min >= 3, 'dark worst=' + dark.min.toFixed(3) + ' ≥3');
assert(light.min >= 3, 'light worst=' + light.min.toFixed(3) + ' ≥3');
eq(dark.light, donut.LIGHT_BY_THEME.dark, 'dark 用 donut 明度合同');
eq(light.light, donut.LIGHT_BY_THEME.light, 'light 用 donut 明度合同');
assert(dark.minHue >= 0 && light.minHue >= 0, 'worst 色相已定位');
// 深色最不利背景是最亮卡片端，浅色最不利背景是最暗页面背景（审查口径修正的关键）
eq(dark.minBg, 'card-start', '深色最差背景 = 卡片最亮端');
eq(light.minBg, 'page', '浅色最差背景 = 页面背景');
// 深色明度已从 56 提到 60，且真实卡片端 worst 达标
eq(donut.LIGHT_BY_THEME.dark, 60, '深色明度合同 = 60');
assert(dark.min.toFixed(3) === '3.145', 'dark worst 与探查一致 = 3.145');

console.log('== 6. 审计总判定与未知主题回退 ==');
const audit = C.auditDonutContrast();
eq(audit.ok, true, '两主题审计通过');
eq(audit.results.length, 2, '返回 dark/light 两项');
eq(audit.threshold, 3.0, '门槛 = 3.0');
const fallback = C.worstDonutContrast('unknown');
eq(fallback.theme, donut.DEFAULT_THEME, '未知主题回退 dark');

console.log('\ncontrast tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
