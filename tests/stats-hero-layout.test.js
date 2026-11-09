/**
 * tests/stats-hero-layout.test.js — v1.4.1 Gate 4 统计 Hero 三列窄屏布局
 *
 * 只验证布局契约，不改统计口径：
 *   - 仍为三列；
 *   - 「最高消费日」列获得更高弹性，日期 + 金额单行完整显示（不省略、不裁切）；
 *   - 320 / 360 / 390 / 430 四档下，最坏真实文案宽度不超过列宽（估算校验）。
 *
 * 运行：node tests/stats-hero-layout.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.error('  FAIL: ' + msg);
  }
}
function eq(a, b, msg) {
  assert(a === b, msg + '（期望 ' + b + '，实际 ' + a + '）');
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 粗略取某个选择器块内的声明（够用的静态契约检查） */
function blockOf(css, selector, fromIndex) {
  const start = css.indexOf(selector, fromIndex || 0);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

const wxss = read('components/statistics-panel/statistics-panel.wxss');
const wxml = read('components/statistics-panel/statistics-panel.wxml');

/* ==================== A. 结构 ==================== */
console.log('A. 三列结构');
{
  const count = (wxml.match(/class="hero__third"/g) || []).length;
  eq(count, 3, 'Hero 第二行仍为 3 列');
  assert(
    wxml.indexOf('<text class="hero__sub">{{mTopDay}} {{mTopDayAmount}}</text>') >= 0,
    '最高消费日仍完整展示日期 + 金额（同一行文本）'
  );
}

/* ==================== B. CSS 契约 ==================== */
console.log('B. CSS 契约');
{
  const mid = blockOf(wxss, '.hero__foot--three .hero__third:nth-child(2)');
  assert(/flex:\s*1\.6/.test(mid), '中间列 flex: 1.6');
  assert(/padding-right:\s*0/.test(mid), '中间列去掉右侧内边距');

  const sub = blockOf(wxss, '.hero__foot--three .hero__third .hero__sub');
  assert(/white-space:\s*nowrap/.test(sub), '数值文本禁止折行');
  assert(/font-size:\s*26rpx/.test(sub), '默认字号 26rpx');
  eq(/text-overflow/.test(sub), false, '不允许省略号截断');
  eq(/overflow:\s*hidden/.test(sub), false, '不允许 hidden 裁切内容');

  const mediaIdx = wxss.indexOf('@media (max-width: 360px)');
  assert(mediaIdx > 0, '存在 ≤360px 窄屏媒体查询');
  const mediaBlock = wxss.slice(mediaIdx, wxss.indexOf('}', wxss.indexOf('}', mediaIdx) + 1) + 1);
  assert(/font-size:\s*22rpx/.test(mediaBlock), '窄屏中间列字号降到 22rpx');
  assert(/flex:\s*1\.7/.test(mediaBlock), '窄屏中间列弹性提升到 1.7');
}

/* ==================== C. 四档宽度估算 ==================== */
console.log('C. 320 / 360 / 390 / 430 宽度估算');
{
  /**
   * 文案宽度估算（保守）：
   *   数字 / 字母 / 半角符号 ≈ 0.6em；¥ / 空格 / 中文 ≈ 1em。
   * 字号的 rpx → px 换算：px = rpx × 屏宽 / 750。
   */
  function textEm(s) {
    let em = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (/[0-9a-zA-Z.,:\-]/.test(ch)) em += 0.6;
      else em += 1;
    }
    return em;
  }
  function checkAt(width) {
    const rpx = width / 750;
    const cardPad = 32 * rpx;
    const content = width - cardPad * 2;
    const narrow = width <= 360;
    const fontRpx = narrow ? 22 : 26;
    const fontPx = fontRpx * rpx;
    const midFlex = narrow ? 1.7 : 1.6;
    const sideFlex = 1;
    const total = midFlex + sideFlex * 2;
    const midW = (content * midFlex) / total;
    const sideW = (content * sideFlex) / total;

    const midText = '31日 ¥1,234,567.89';
    const leftText = '9999 笔';
    const rightText = '¥12,345.67';

    const midNeed = textEm(midText) * fontPx;
    const leftNeed = textEm(leftText) * fontPx;
    const rightNeed = textEm(rightText) * fontPx;

    assert(midNeed <= midW, width + 'px 中间列可容纳「' + midText + '」（需 ' +
      midNeed.toFixed(1) + ' / 列 ' + midW.toFixed(1) + '）');
    assert(leftNeed <= sideW, width + 'px 左列可容纳「' + leftText + '」（需 ' +
      leftNeed.toFixed(1) + ' / 列 ' + sideW.toFixed(1) + '）');
    assert(rightNeed <= sideW, width + 'px 右列可容纳「' + rightText + '」（需 ' +
      rightNeed.toFixed(1) + ' / 列 ' + sideW.toFixed(1) + '）');
  }
  [320, 360, 390, 430].forEach(checkAt);
}

/* ==================== D. 未引入未验证特性 ==================== */
console.log('D. 特性边界');
{
  const heroCss = wxss.slice(wxss.indexOf('.hero {'), wxss.indexOf('/* ---- 最大单笔支出卡'));
  eq(/clamp\(|container-type|:has\(/.test(heroCss), false, 'Hero 未使用未验证的 CSS 新特性');
  assert(heroCss.indexOf('@media') >= 0, '仅使用标准 WXSS 媒体查询');
}

/* ==================== 汇总 ==================== */
console.log('\nstats-hero-layout tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL STATS HERO LAYOUT TESTS PASSED');
