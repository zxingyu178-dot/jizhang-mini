/**
 * tests/sheet-scroll.test.js — Bottom Sheet 内容区高度预算（v1.4.0 UI-01）
 *
 * 覆盖：
 *  1. 五档屏幕（320×568 / 360×640 / 375×667 / 390×844 / 414×896）×
 *     五种内容高（300 / 469.9 分类 / 597.6 周期 / 598.4 记账 / 900 超高）
 *     的预算表：结果必须 ≤ 可用空间、≥ 最小可用高度、内容不超高时 ≈ 内容高；
 *  2. 测量失败 / 参数异常一律 ok=false（调用方走降级，绝不把面板压成 0）；
 *  3. readViewportHeight 的取值与兜底；
 *  4. 静态契约：wxml 用 scroll-view + 确定高度、slot 不被 wx:if 包（避免重建）、
 *     wxss 的 max-height 与 JS 的 DEFAULT_MAX_RATIO 不许漂移。
 *
 * 运行：node tests/sheet-scroll.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const sc = require('../utils/sheet-scroll');

const ROOT = path.join(__dirname, '..');

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
  assert(a === b, msg + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）');
}
function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

/* ---------------- 预算表参数 ---------------- */

/**
 * 五档屏幕。chromeH = 拖拽条 + 标题 + 底部安全区（不参与滚动的高度）。
 * 拖拽条 = padding 16+6rpx + 条 8rpx = 30rpx；标题 = 字号 30rpx×1.4 行高 + 上下 padding 26rpx ≈ 68rpx；
 * 两者合计 98rpx，统一换算成 px（rpx = 屏宽/750）。
 */
const DEVICES = [
  { name: '320×568', w: 320, h: 568, safeBottom: 0 },
  { name: '360×640', w: 360, h: 640, safeBottom: 0 },
  { name: '375×667', w: 375, h: 667, safeBottom: 0 },
  { name: '390×844', w: 390, h: 844, safeBottom: 34 },
  { name: '414×896', w: 414, h: 896, safeBottom: 34 },
];

/** 实测内容高（px，来自 v1.4.0 UI 巡检） */
const CONTENTS = [
  { name: '短内容', h: 300 },
  { name: '分类编辑器', h: 469.9 },
  { name: '周期编辑器', h: 597.6 },
  { name: '记账表单', h: 598.4 },
  { name: '超高内容', h: 900 },
];

function chromeH(dev) {
  const rpx = dev.w / 750;
  return +(98 * rpx + dev.safeBottom).toFixed(1);
}

/* ---------------- 1. 五档预算表 ---------------- */

console.log('\n================ 五档屏幕 × 内容高 预算表 ================');
console.log('机型        视口高  可用内容区  内容高   结果高   滚动?  说明');

const rows = [];
DEVICES.forEach((dev) => {
  const chrome = chromeH(dev);
  const avail = sc.availableBodyHeight({ viewportH: dev.h, chromeH: chrome });
  CONTENTS.forEach((c) => {
    const r = sc.computeSheetScrollHeight({ contentH: c.h, chromeH: chrome, viewportH: dev.h });
    rows.push({ dev, content: c, chrome, avail, r });
    console.log(
      [
        dev.name.padEnd(10),
        String(dev.h).padEnd(7),
        String(avail).padEnd(11),
        String(c.h).padEnd(8),
        String(r.height).padEnd(8),
        (r.scrollable ? '是' : '否').padEnd(6),
        r.overflow ? '超高→吃满可用空间' : '装得下→等于内容高'
      ].join(' ')
    );
  });
});

rows.forEach(({ dev, content, chrome, avail, r }) => {
  const tag = dev.name + '/' + content.name;
  assert(r.ok === true, tag + ' 应计算成功');
  assert(Number.isInteger(r.height) && r.height > 0, tag + ' 结果高必须是正整数 px（实际 ' + r.height + '）');
  assert(r.height <= avail, tag + ' 结果高 ' + r.height + ' 必须 ≤ 可用空间 ' + avail + '（否则面板越过 max-height）');
  assert(r.height <= Math.floor(dev.h * sc.DEFAULT_MAX_RATIO), tag + ' 结果高不得越过视口 88% 上限');
  if (r.overflow) {
    assert(r.scrollable === true, tag + ' 超高时必须可滚');
    assert(r.height >= sc.MIN_BODY_H, tag + ' 超高时结果高 ' + r.height + ' 必须 ≥ 最小可用高度 ' + sc.MIN_BODY_H);
  } else {
    assert(r.scrollable === false, tag + ' 内容装得下时不许开滚动（否则出现滚动条/回弹）');
    assert(Math.abs(r.height - content.h) <= 1, tag + ' 装得下时结果高 ' + r.height + ' 应 ≈ 内容高 ' + content.h);
  }
  assert(r.chromeH === chrome, tag + ' chromeH 应原样回传');
});

/* 关键点位钉死，防公式漂移 */
const R390 = sc.computeSheetScrollHeight({
  contentH: 598.4,
  chromeH: chromeH(DEVICES[3]),
  viewportH: DEVICES[3].h,
});
eq(R390.height, 599, '390×844 + 记账表单（598.4）应等于 599（内容高向上取整，几何与改造前一致）');
eq(R390.scrollable, false, '390×844 + 记账表单不应进入滚动');

const R320 = sc.computeSheetScrollHeight({
  contentH: 598.4,
  chromeH: chromeH(DEVICES[0]),
  viewportH: DEVICES[0].h,
});
eq(R320.scrollable, true, '320×568 + 记账表单必须进入滚动');
eq(R320.height, sc.availableBodyHeight({ viewportH: 568, chromeH: chromeH(DEVICES[0]) }), '320×568 超高时应吃满可用空间');

/* 五档全部「装得下」时的几何一致性（0/1px 差） */
DEVICES.forEach((dev) => {
  const chrome = chromeH(dev);
  const r = sc.computeSheetScrollHeight({ contentH: 120.2, chromeH: chrome, viewportH: dev.h });
  assert(r.scrollable === false && Math.abs(r.height - 120.2) <= 1, dev.name + ' 小内容应 ≈ 内容高（实际 ' + r.height + '）');
});

/* ---------------- 2. 降级：一律 ok=false，不猜高度 ---------------- */

const badCases = [
  { input: { contentH: 0, chromeH: 50, viewportH: 844 }, reason: 'invalid-content', label: '内容高为 0（未渲染/量失败）' },
  { input: { contentH: null, chromeH: 50, viewportH: 844 }, reason: 'invalid-content', label: '内容高为 null' },
  { input: { contentH: NaN, chromeH: 50, viewportH: 844 }, reason: 'invalid-content', label: '内容高 NaN' },
  { input: { contentH: 500, chromeH: 50, viewportH: 0 }, reason: 'invalid-viewport', label: '视口高为 0' },
  { input: { contentH: 500, chromeH: 50, viewportH: undefined }, reason: 'invalid-viewport', label: '视口高缺失' },
  { input: { contentH: 500, chromeH: 900, viewportH: 844 }, reason: 'invalid-chrome', label: 'chrome 比视口还高' },
  { input: { contentH: 500, chromeH: 800, viewportH: 844 }, reason: 'no-space', label: '可用空间被 chrome 吃光' },
];
badCases.forEach((c) => {
  const r = sc.computeSheetScrollHeight(c.input);
  eq(r.ok, false, c.label + ' 必须返回 ok=false（调用方走降级）');
  eq(r.reason, c.reason, c.label + ' 的降级原因');
  eq(r.height, 0, c.label + ' 不得给出高度（由调用方维持现状）');
});
eq(sc.computeSheetScrollHeight().ok, false, '无参调用必须 ok=false');
eq(sc.computeSheetScrollHeight(null).ok, false, 'null 入参必须 ok=false');

/* degraded：空间小于最小可用高度时照实标记 */
const tiny = sc.computeSheetScrollHeight({ contentH: 900, chromeH: 400, viewportH: 500 });
eq(tiny.ok, true, '空间极小时仍要给出可用答案');
eq(tiny.degraded, true, '可用空间 < 最小可用高度应标记 degraded');
assert(tiny.height <= tiny.avail, 'degraded 时也不许越过可用空间');

/* 边界：内容高刚好等于可用空间 → 不滚 */
const exactAvail = sc.availableBodyHeight({ viewportH: 844, chromeH: 85 });
const exact = sc.computeSheetScrollHeight({ contentH: exactAvail, chromeH: 85, viewportH: 844 });
eq(exact.scrollable, false, '内容高 == 可用空间时不应滚动');
eq(exact.height, exactAvail, '内容高 == 可用空间时高度应等于可用空间');

/* ---------------- 3. readViewportHeight ---------------- */

eq(sc.readViewportHeight({ getWindowInfo: () => ({ windowHeight: 844 }) }), 844, '优先用 getWindowInfo 的 windowHeight');
eq(
  sc.readViewportHeight({
    getWindowInfo: () => {
      throw new Error('boom');
    },
    getSystemInfoSync: () => ({ windowHeight: 667 }),
  }),
  667,
  'getWindowInfo 抛错时退化到 getSystemInfoSync'
);
eq(
  sc.readViewportHeight({
    getWindowInfo: () => ({}),
    getSystemInfoSync: () => undefined,
  }),
  0,
  '两个来源都拿不到 valid windowHeight 时返回 0'
);
eq(sc.readViewportHeight({}), 0, 'API 缺失时返回 0');
eq(sc.readViewportHeight(null), 0, '无 wx 时返回 0（不抛错）');

/* ---------------- 4. 静态契约（防回归） ---------------- */

const wxml = read('components/bottom-sheet/bottom-sheet.wxml');
const wxss = read('components/bottom-sheet/bottom-sheet.wxss');

assert(/<scroll-view[\s\S]*?scroll-y[\s\S]*?>[\s\S]*<slot><\/slot>/.test(wxml), 'wxml：slot 必须包在 scroll-view(scroll-y) 内（Skyline 下只有 scroll-view 能滚）');
assert(/style="height:\{\{bodyH\}\}px"/.test(wxml), 'wxml：scroll-view 必须拿到确定 px 高度（不能只给 max-height / flex:auto）');
const scrollTag = (wxml.match(/<scroll-view([^>]*)>/) || [])[1] || '';
assert(scrollTag.length > 0 && !/wx:if/.test(scrollTag), 'wxml：scroll-view 自身不许挂 wx:if（节点类型切换会重建 slot 子组件、丢表单草稿）');
eq((wxml.match(/<slot><\/slot>/g) || []).length, 1, 'wxml：slot 只许出现一次（防止内容被渲染两遍）');
assert(/<slot><\/slot>/.test(wxml), 'wxml：slot 保留');

const bsPanel = (wxss.match(/\.bs-panel\s*\{([^}]*)\}/) || [])[1] || '';
assert(/max-height:\s*88%/.test(bsPanel), 'wxss：.bs-panel max-height 必须仍是 88%');
eq(
  parseFloat((bsPanel.match(/max-height:\s*([\d.]+)%/) || [])[1]),
  sc.DEFAULT_MAX_RATIO * 100,
  'JS 的 DEFAULT_MAX_RATIO 必须与 wxss 的 max-height 一致（不许漂移）'
);

const bsBody = (wxss.match(/\.bs-body\s*\{([^}]*)\}/) || [])[1] || '';
assert(!/flex:\s*0\s+1\s+auto/.test(bsBody), 'wxss：.bs-body 不许用 flex:0 1 auto（实测会把面板压塌）');

/* ---------------- 汇总 ---------------- */
console.log('\nsheet-scroll: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
