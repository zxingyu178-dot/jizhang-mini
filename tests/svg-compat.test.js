/**
 * tests/svg-compat.test.js — v1.4.1 Gate 4 SVG 兼容性审计
 *
 * 不盲目替换 rgba：先验证「天空线（Skyline）」已知风险点：
 *   1. 所有内联 SVG 不含 hsl()/hsla()（v1.4.0 圆环不显示的直接原因）；
 *   2. 不含 undefined / NaN / 空 stroke；
 *   3. 颜色只允许 #RRGGBB 或 rgba(...)；
 *   4. 根节点有 viewBox，尺寸由组件 <image> 显式控制；
 *   5. base64 data-URI 可无损解码回原 SVG；
 *   6. 深 / 浅主题都能生成完整 SVG（rgba 双主题均有具体值）。
 *
 * 覆盖：category-icon / icon / cumulative-trend / category-donut。
 * 运行：node tests/svg-compat.test.js
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

/* ---------- theme 替身（组件通过它取当前主题） ---------- */
let currentTheme = 'dark';
const themePath = require.resolve(path.join(ROOT, 'utils', 'theme.js'));
require.cache[themePath] = {
  id: themePath,
  filename: themePath,
  loaded: true,
  exports: {
    init() {},
    subscribe() {
      return () => {};
    },
    getEffectiveTheme() {
      return currentTheme;
    },
  },
};

/* ---------- 捕获 Component 定义 ---------- */
let captured = null;
global.Component = function (def) {
  captured = def;
};
function loadComponent(rel) {
  captured = null;
  require(path.join(ROOT, rel));
  return captured;
}
const catIconDef = loadComponent('components/category-icon/category-icon.js');
const iconDef = loadComponent('components/icon/icon.js');
const cumulativeDef = loadComponent('components/cumulative-trend/cumulative-trend.js');

function makeInstance(def, overrides) {
  const inst = {
    data: Object.assign(JSON.parse(JSON.stringify(def.data || {})), overrides || {}),
    setData(patch) {
      Object.keys(patch).forEach((k) => {
        inst.data[k] = patch[k];
      });
    },
    triggerEvent() {},
  };
  Object.keys((def.methods || {})).forEach((k) => {
    inst[k] = def.methods[k].bind(inst);
  });
  return inst;
}

function decode(uri, label) {
  assert(typeof uri === 'string' && uri.indexOf('data:image/svg+xml;base64,') === 0, label + ' 使用 base64 data-URI');
  const b64 = String(uri).split(',')[1] || '';
  const svg = Buffer.from(b64, 'base64').toString('ascii');
  assert(svg.indexOf('<svg') === 0 || svg.indexOf('<svg ') === 0, label + ' 解码后是 SVG 根节点');
  return svg;
}

/** 通用 SVG 安全契约 */
function checkSvg(svg, label) {
  eq(svg.indexOf('hsl(') >= 0, false, label + ' 不含 hsl(');
  eq(svg.indexOf('hsla(') >= 0, false, label + ' 不含 hsla(');
  eq(svg.indexOf('undefined') >= 0, false, label + ' 不含 undefined');
  eq(svg.indexOf('NaN') >= 0, false, label + ' 不含 NaN');
  eq(svg.indexOf('stroke=""') >= 0, false, label + ' 无空 stroke');
  assert(svg.indexOf('viewBox="') >= 0, label + ' 根节点含 viewBox');
  // 颜色：所有 stroke/fill 值必须是 #rrggbb 或 rgba(...) 或 none
  const attrs = svg.match(/(?:stroke|fill)="([^"]*)"/g) || [];
  attrs.forEach((a) => {
    const v = a.replace(/^[^"]*"/, '').replace(/"$/, '');
    if (v === 'none' || v === '') return;
    assert(
      /^#[0-9a-fA-F]{6}$/.test(v) || /^rgba?\([^)]*\)$/.test(v),
      label + ' 颜色格式合法：' + v
    );
  });
}

/* ==================== A. category-icon ==================== */
console.log('A. category-icon');
{
  currentTheme = 'dark';
  const inst = makeInstance(catIconDef, {
    iconType: 'builtin',
    iconValue: 'coffee',
    size: 28,
    tone: 'primary',
    framed: true,
  });
  inst.refresh();
  const svgDark = decode(inst.data.uri, 'category-icon dark');
  checkSvg(svgDark, 'category-icon dark');
  assert(svgDark.indexOf('stroke="rgba(255,255,255,0.86)"') >= 0, '深色 primary 使用既有 rgba 白色');
  eq(inst.data.boxSize, 28 + Math.round(28 * 0.3) * 2, 'framed 外框尺寸 = 图标 + 2×内边距');
  eq(inst.data.iconSize, 28, '图标视觉尺寸保持 28');
  eq(inst.data.mode, 'builtin', 'builtin 模式正常');

  currentTheme = 'light';
  inst.refresh();
  const svgLight = decode(inst.data.uri, 'category-icon light');
  checkSvg(svgLight, 'category-icon light');
  assert(svgLight.indexOf('stroke="rgba(25,28,40,0.88)"') >= 0, '浅色 primary 使用既有深色 rgba');
}

/* ==================== B. icon ==================== */
console.log('B. dv-icon');
{
  currentTheme = 'dark';
  const inst = makeInstance(iconDef, { name: 'settings', size: 22, tone: 'primary' });
  inst.refresh();
  const svg = decode(inst.data.uri, 'dv-icon dark');
  checkSvg(svg, 'dv-icon dark');
  assert(svg.indexOf('stroke="rgba(255,255,255,0.86)"') >= 0, '深色主图标颜色正确');
  eq(inst.data.w, 22, '宽 = size');
  eq(inst.data.h, 22, '高 = size');
  const wxml = read('components/icon/icon.wxml');
  assert(wxml.indexOf('style="width:{{w}}px;height:{{h}}px;"') >= 0, 'image 显式控制宽高');
}

/* ==================== C. cumulative-trend ==================== */
console.log('C. cumulative-trend');
{
  currentTheme = 'dark';
  const inst = makeInstance(cumulativeDef, {
    points: [{ cumCents: 0 }, { cumCents: 500 }, { cumCents: 1200 }],
    max: 1200,
    width: 320,
    height: 180,
  });
  inst.refresh();
  const svgDark = decode(inst.data.uri, 'cumulative dark');
  checkSvg(svgDark, 'cumulative dark');
  eq((svgDark.match(/<line /g) || []).length, 3, '3 条水平网格线');
  // v1.5.1 车削三层：面积 + 暗缘 + 本体 + 高光 = 4 条 path（不再是旧的 2 条）
  eq((svgDark.match(/<path /g) || []).length, 4, '面积 + 三描边共 4 条 path');
  // 规则断言（不是死值）：三条描边的 d 必须完全一致 —— 「同一条线描三遍」的几何前提
  const ds = [...svgDark.matchAll(/<path d="([^"]+)" fill="none"/g)].map((m) => m[1]);
  eq(ds.length, 3, '三条描边 path（fill=none）');
  eq(new Set(ds).size, 1, '三条描边的 d 完全一致（几何零变更）');
  assert(svgDark.indexOf('stroke="rgba(255,255,255,0.12)"') >= 0, '深色网格使用既有 rgba');
  assert(svgDark.indexOf('fill-opacity="0.15"') >= 0, '深色面积透明度降到 0.15（线加粗后降面积）');
  assert(svgDark.indexOf('transform="translate(0 -0.62)"') >= 0, '深色高光上移 0.62px');

  currentTheme = 'light';
  inst.refresh();
  const svgLight = decode(inst.data.uri, 'cumulative light');
  checkSvg(svgLight, 'cumulative light');
  assert(svgLight.indexOf('stroke="rgba(80,90,130,0.20)"') >= 0, '浅色网格使用 --chart-grid 同口径 rgba（0.20，1.35:1）');
  assert(svgLight.indexOf('fill-opacity="0.13"') >= 0, '浅色面积透明度 0.13');
  assert(svgLight.indexOf('transform="translate(0 -0.55)"') >= 0, '浅色高光上移 0.55px');
  // 深浅两套必须是不同值，否则等于「只做了一套」
  assert(svgDark !== svgLight, '深浅两套 SVG 不同（明暗值真的分了主题）');

  // v1.4.3：断言改为测「规则」而不是记死写法——
  // 图表必须在布局完成后铺满容器整宽（组件量容器真实宽度生成同比例 viewBox），
  // 因此 image 用 100% 填满容器 + scaleToFill，而不是固定像素 width/aspectFit。
  const wxml = read('components/cumulative-trend/cumulative-trend.wxml');
  assert(wxml.indexOf('height:{{height}}px') >= 0, '根容器有显式高度（保证量得到稳定盒高）');
  assert(wxml.indexOf('width:100%') >= 0, '容器/图片宽度跟随父级（铺满整宽）');
  assert(wxml.indexOf('mode="scaleToFill"') >= 0, '图片按盒尺寸拉伸（比例已在 SVG 内对齐，不得 aspectFit 留白）');
}

/* ==================== D. category-donut ==================== */
console.log('D. category-donut');
{
  const donut = require(path.join(ROOT, 'data', 'statistics', 'donut'));
  const base = [
    { categoryId: 'c-food', name: '餐饮', ratio: 0.6, cents: 6000, percentText: '60.0', aggregate: false },
    { categoryId: 'c-traffic', name: '交通', ratio: 0.4, cents: 4000, percentText: '40.0', aggregate: false },
  ];
  ['dark', 'light'].forEach((t) => {
    const segs = donut.resolveSegmentColors(base, t);
    const svg = donut.buildDonutSVG(segs, 'rgba(255,255,255,0.10)', -1, t);
    checkSvg(svg, 'donut ' + t);
    eq(svg.indexOf('hsl') >= 0, false, 'donut ' + t + ' SVG 不含 hsl');
    assert(/stroke="#[0-9a-fA-F]{6}"/.test(svg), 'donut ' + t + ' 分段描边已转 #RRGGBB');
  });
}

/* ==================== E. base64 编码一致性 ==================== */
console.log('E. base64');
{
  const { b64encodeAscii } = require(path.join(ROOT, 'utils', 'b64'));
  const sample = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24z"/></svg>';
  eq(b64encodeAscii(sample), Buffer.from(sample, 'ascii').toString('base64'), 'b64encodeAscii 与标准 Base64 一致');
  [1, 2, 3, 4, 5].forEach((n) => {
    const s = sample.slice(0, n * 7);
    eq(b64encodeAscii(s), Buffer.from(s, 'ascii').toString('base64'), 'b64 长度 ' + s.length + ' 补齐正确');
  });
}

/* ==================== F. 文件级红线 ==================== */
console.log('F. 文件级红线');
{
  [
    'components/category-icon/category-icon.js',
    'components/icon/icon.js',
    'components/cumulative-trend/cumulative-trend.js',
    'data/statistics/cumulative.js',
  ].forEach((rel) => {
    eq(/hsl\(/.test(read(rel)), false, rel + ' 源码不直接使用 hsl() 生成颜色');
  });
  const donutSrc = read('data/statistics/donut.js');
  assert(donutSrc.indexOf('hslToHex') >= 0, 'donut 保留 hsl→#RRGGBB 转换（v1.4.0 修复不回退）');
}

/* ==================== 汇总 ==================== */
console.log('\nsvg-compat tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL SVG COMPATIBILITY TESTS PASSED');
