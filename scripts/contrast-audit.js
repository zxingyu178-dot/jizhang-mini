/**
 * scripts/contrast-audit.js — v1.3.3 圆环运行时对比度审计
 *
 * 按 data/statistics/contrast 的 WCAG 口径，输出两主题圆环全色相的最差对比度，
 * 断言均达到非文本门槛 3:1。补足 theme-audit 只查硬编码、不查运行时 HSL 的缺口。
 *
 * 用法：node scripts/contrast-audit.js
 * 退出码：0 两主题 worst 均 ≥3:1；1 任一主题不达标。
 */
const nodePath = require('path');
const ROOT = nodePath.join(__dirname, '..');
const contrast = require(nodePath.join(ROOT, 'data', 'statistics', 'contrast'));

console.log('==== Donut Runtime Contrast Audit（WCAG 非文本门槛 3:1）====');
const audit = contrast.auditDonutContrast();
audit.results.forEach((r) => {
  const status = r.min >= contrast.MIN_NON_TEXT_RATIO ? 'PASS' : 'FAIL';
  console.log(
    '  [' + status + '] ' + r.theme + '（L=' + r.light + '）worst=' +
      r.min.toFixed(3) + '  @hue' + r.minHue
  );
});

console.log('\n背景：dark=' + contrast.THEME_BG.dark + '，light=' + contrast.THEME_BG.light + '（须与 app.wxss --bg 一致）');
if (!audit.ok) {
  console.error('对比度审计未通过：请调整 donut.LIGHT_BY_THEME（浅色压暗 / 深色提亮），使 worst≥' + audit.threshold + '。');
  process.exit(1);
}
console.log('对比度审计通过：两主题圆环 worst 均 ≥' + audit.threshold + ':1。');
process.exit(0);
