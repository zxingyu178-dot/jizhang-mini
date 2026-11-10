/**
 * tests/stats-hero-layout.test.js — v1.4.1 Gate 4 统计 Hero 三列窄屏布局
 *
 * 只验证布局契约，不改统计口径：
 *   - 仍为三列；
 *   - 「最高消费日」列获得更高弹性，日期 + 金额单行完整显示（不省略、不裁切）；
 *   - 窄屏（≤360px）差异化（22rpx + 中间列 flex 1.7）真实生效；
 *   - 320 / 360 / 390 / 430 四档下，最坏真实文案宽度不超过列宽（估算校验）。
 *
 * v1.4.3：窄屏差异化从 `@media (max-width: 360px)` 改为 JS 判定 + class 切换
 * （Skyline 渲染下 WXSS 媒体查询官方只支持 DarkMode，宽度断点不生效 = 死代码）。
 * 契约强度不降：窄屏那两个值（22rpx / flex 1.7）仍然钉死，且额外要求
 * 「WXML 真的挂上 --narrow 类」「判定函数边界值正确」「宽度媒体查询已清零」。
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

/** 去掉 WXSS 注释：注释里提到 @media 不算真样式，静态契约只认真代码 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}
const cssCode = stripComments(wxss);

/* ==================== A. 结构 ==================== */
console.log('A. 三列结构');
{
  const count = (wxml.match(/class="hero__third"/g) || []).length;
  eq(count, 3, 'Hero 第二行仍为 3 列');
  assert(
    wxml.indexOf('<text class="hero__sub">{{mTopDay}} {{mTopDayAmount}}</text>') >= 0,
    '最高消费日仍完整展示日期 + 金额（同一行文本）'
  );
  assert(wxml.indexOf('hero__foot--three--narrow') >= 0, 'WXML 给三列容器绑定了窄屏类 --narrow');
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

  const mediaIdx = cssCode.indexOf('@media (max-width: 360px)');
  eq(mediaIdx, -1, '已删除窄屏媒体查询（Skyline 下宽度断点不生效，属死代码）');
  // 窄屏规则改为 --narrow 类：仍是「22rpx + flex 1.7」两个值钉死，强度与原来的 @media 契约相同
  const narrowSub = blockOf(wxss, '.hero__foot--three--narrow .hero__third .hero__sub');
  assert(/font-size:\s*22rpx/.test(narrowSub), '窄屏中间列字号降到 22rpx（--narrow 类）');
  assert(/white-space:\s*nowrap/.test(blockOf(wxss, '.hero__foot--three .hero__third .hero__sub')) ||
    /white-space:\s*nowrap/.test(narrowSub), '窄屏仍禁止折行');
  const narrowMid = blockOf(wxss, '.hero__foot--three--narrow .hero__third:nth-child(2)');
  assert(/flex:\s*1\.7/.test(narrowMid), '窄屏中间列弹性提升到 1.7（--narrow 类）');
  // 窄屏规则必须排在基础规则之后（同特异性靠顺序覆盖，被上移就失效）
  assert(
    cssCode.indexOf('.hero__foot--three--narrow .hero__third .hero__sub') >
      cssCode.indexOf('.hero__foot--three .hero__third .hero__sub'),
    '窄屏规则写在基础规则之后（同特异性由顺序决定覆盖）'
  );
  // 全文件清零宽度断点：残留任何一条都说明还在指望不生效的样式
  eq(/@media[\s\S]{0,120}?(max|min)-width/.test(cssCode), false,
    'WXSS 内不存在任何宽度断点媒体查询');
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
  /**
   * 双分支模型（v1.4.3，与实现一致；两个分支都是真实会生效的）：
   *   - 窄屏分支 width ≤ 360：JS 判定（device.isNarrowScreen）挂 --narrow → 22rpx + 中间列 flex 1.7；
   *   - 宽屏分支 width > 360：不挂 --narrow → 26rpx + 中间列 flex 1.6。
   * forceModel 用于兜底校验（'narrow' / 'wide'），不传则按宽度自动选分支。
   * 侧列 padding-right:10rpx 计入可用宽度（中间列 padding-right 为 0），比旧模型更保守。
   */
  function layoutAt(width, forceModel) {
    const rpx = width / 750; // 1 rpx 对应多少 px
    const content = width - 32 * rpx * 2; // .hero padding: 32rpx（左右各一）
    const model = forceModel || (width <= 360 ? 'narrow' : 'wide');
    const narrow = model === 'narrow';
    const fontPx = (narrow ? 22 : 26) * rpx;
    const midFlex = narrow ? 1.7 : 1.6;
    const sideFlex = 1;
    const total = midFlex + sideFlex * 2;
    return {
      model,
      fontPx,
      midW: (content * midFlex) / total,
      sideW: (content * sideFlex) / total - 10 * rpx, // 侧列 padding-right:10rpx
    };
  }
  const CASES = {
    mid: '31日 ¥1,234,567.89',
    left: '9999 笔',
    right: '¥12,345.67',
  };
  function checkAt(width, forceModel) {
    const L = layoutAt(width, forceModel);
    const tag = width + 'px[' + L.model + ']';
    const midNeed = textEm(CASES.mid) * L.fontPx;
    const leftNeed = textEm(CASES.left) * L.fontPx;
    const rightNeed = textEm(CASES.right) * L.fontPx;
    const pct = (need, have) => (((have - need) / have) * 100).toFixed(1) + '%';

    assert(midNeed <= L.midW, tag + ' 中间列可容纳「' + CASES.mid + '」（需 ' +
      midNeed.toFixed(1) + ' / 列 ' + L.midW.toFixed(1) + '，余量 ' + pct(midNeed, L.midW) + '）');
    assert(leftNeed <= L.sideW, tag + ' 左列可容纳「' + CASES.left + '」（需 ' +
      leftNeed.toFixed(1) + ' / 列 ' + L.sideW.toFixed(1) + '，余量 ' + pct(leftNeed, L.sideW) + '）');
    assert(rightNeed <= L.sideW, tag + ' 右列可容纳「' + CASES.right + '」（需 ' +
      rightNeed.toFixed(1) + ' / 列 ' + L.sideW.toFixed(1) + '，余量 ' + pct(rightNeed, L.sideW) + '）');
  }
  // 按宽度自动选分支：≤360 走窄屏（22rpx/1.7），>360 走宽屏（26rpx/1.6）
  [320, 360, 390, 430].forEach((w) => checkAt(w));
  // 兜底：万一窄屏 class 因任何原因没挂上，320/360 走宽屏模型也不得溢出（不替代窄屏分支，属加固）
  [320, 360].forEach((w) => checkAt(w, 'wide'));
}

/* ==================== D. 未引入未验证特性 ==================== */
console.log('D. 特性边界');
{
  // Hero 区块：从 .hero 起、到下一张卡（.largest）前止（注释已剥离，用选择器当边界）
  const heroCss = cssCode.slice(cssCode.indexOf('.hero {'), cssCode.indexOf('.largest {'));
  eq(/clamp\(|container-type|:has\(/.test(heroCss), false, 'Hero 未使用未验证的 CSS 新特性');
  // v1.4.3：Skyline 下宽度断点不生效，Hero 不再依赖媒体查询，窄屏差异改由 class 切换
  eq(heroCss.indexOf('@media'), -1, 'Hero 不再依赖媒体查询（窄屏走 class 切换）');
  assert(heroCss.indexOf('.hero__foot--three--narrow') >= 0, 'Hero 内存在窄屏类规则');
  assert(wxml.indexOf('hero__foot--three{{isNarrow ?') >= 0,
    'Hero 窄屏类由 isNarrow 数据驱动（非静态写死）');
}

/* ==================== E. 窄屏 JS 判定（阈值 ≤360，与旧 @media 同口径） ==================== */
console.log('E. 窄屏判定（device.isNarrowScreen）');
{
  const device = require('../utils/device');
  const cjs = read('components/statistics-panel/statistics-panel.js');

  function atWidth(w) {
    global.wx = {
      getWindowInfo: () => ({
        platform: 'ios', windowWidth: w, windowHeight: 800, pixelRatio: 2, statusBarHeight: 20,
      }),
    };
    device.reset();
    return device.isNarrowScreen();
  }

  eq(device.NARROW_MAX_WIDTH, 360, '阈值常量为 360（与原 @media 口径一致）');
  eq(atWidth(320), true, '320px → 窄屏');
  eq(atWidth(360), true, '360px（边界）→ 窄屏（≤360 含等于）');
  eq(atWidth(361), false, '361px → 非窄屏');
  eq(atWidth(375), false, '375px → 非窄屏（iPhone SE / 6/7/8）');
  eq(atWidth(390), false, '390px → 非窄屏（iPhone 12/13）');
  eq(atWidth(430), false, '430px → 非窄屏（iPhone 14 Pro Max）');

  // 判定函数写了但没人调 = 死代码：钉住组件真的调它，且真的绑到 data
  assert(/device\.isNarrowScreen\(\)/.test(cjs), '组件用 device.isNarrowScreen() 做判定');
  assert(/isNarrow:\s*false/.test(cjs), 'data 里 isNarrow 有默认值（首帧类名不带 undefined）');
  assert(/isNarrow:\s*device\.isNarrowScreen\(\)/.test(cjs), 'attached 阶段就把判定结果 setData 进去');
}

/* ==================== 汇总 ==================== */
console.log('\nstats-hero-layout tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL STATS HERO LAYOUT TESTS PASSED');
