/**
 * tests/donut-hit.test.js — 圆环命中检测与稳定颜色（v1.3.1）专项测试
 *
 * 覆盖：0/1/2/8/超8 分类、各分段中点与首末边界、12/3/6/9 方向、
 * 中心孔 / 外部 / 内外缘、小占比、聚合「其他」、非法 ratio、无效坐标，
 * 以及颜色跨月稳定、月度年度同色、图例色=圆环色、同图不撞色。
 * 命中检测为不依赖 wx 的纯函数，直接 require 后用 viewBox 坐标确定性验证。
 * 运行：node tests/donut-hit.test.js
 */
let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.error('  FAIL: ' + msg);
  }
}
function eq(actual, expected, msg) {
  assert(actual === expected, msg + ' (expected=' + expected + ', actual=' + actual + ')');
}

const D = require('../data/statistics/donut');

/** 构造 n 个均匀占比的真实分段 */
function makeSegments(n) {
  const segs = [];
  for (let i = 0; i < n; i++) {
    segs.push({
      categoryId: 'c-id' + i,
      name: '分类' + i,
      ratio: 1 / n,
      cents: 100,
      percentText: (100 / n).toFixed(1),
      aggregate: false,
    });
  }
  return segs;
}

/** 极坐标 → viewBox 点：frac 为 12 点顺时针的圆周比例，dist 为半径 */
function pointAt(frac, dist) {
  const theta = frac * 2 * Math.PI;
  return { x: 50 + dist * Math.sin(theta), y: 50 - dist * Math.cos(theta) };
}

/* ---------- 1. 空 / 单分类 ---------- */
console.log('空账本与单分类');
eq(D.hitSegment([], 50, 50), -1, '空 segments 任何点返回 -1');
{
  const one = makeSegments(1);
  const p = pointAt(0.5, 40); // 6 点方向
  eq(D.hitSegment(one, p.x, p.y), 0, '单分类命中 0');
}

/* ---------- 2. 各分段中点（2/8 分类） ---------- */
console.log('各分段中点命中');
[2, 8].forEach((n) => {
  const segs = makeSegments(n);
  for (let i = 0; i < n; i++) {
    const p = pointAt((i + 0.5) / n, 40);
    eq(D.hitSegment(segs, p.x, p.y), i, n + ' 段：第 ' + i + ' 段中点命中');
  }
});

/* ---------- 3. 12/3/6/9 方向 ---------- */
console.log('12/3/6/9 方向角度映射');
{
  const four = makeSegments(4);
  // 每段占 90°，方向点落在各段
  eq(D.hitSegment(four, pointAt(0.125, 40).x, pointAt(0.125, 40).y), 0, '12 点附近 → 段0');
  eq(D.hitSegment(four, pointAt(0.375, 40).x, pointAt(0.375, 40).y), 1, '3 点附近 → 段1');
  eq(D.hitSegment(four, pointAt(0.625, 40).x, pointAt(0.625, 40).y), 2, '6 点附近 → 段2');
  eq(D.hitSegment(four, pointAt(0.875, 40).x, pointAt(0.875, 40).y), 3, '9 点附近 → 段3');
  // 精确方向点（边界归属下一段，验证方向坐标换算正确）
  eq(D.hitSegment(four, 50, 10), 0, '正 12 点（上）坐标换算');
  eq(D.hitSegment(four, 90, 50), 1, '正 3 点（右）坐标换算');
  eq(D.hitSegment(four, 50, 90), 2, '正 6 点（下）坐标换算');
  eq(D.hitSegment(four, 10, 50), 3, '正 9 点（左）坐标换算');
}

/* ---------- 4. 中心孔 / 外部 / 内外缘 ---------- */
console.log('中心孔、外部与环带边界');
{
  const segs = makeSegments(4);
  eq(D.hitSegment(segs, 50, 50), -1, '正中心（孔内）返回 -1');
  eq(D.hitSegment(segs, 50, 20), -1, '中心孔区域（dist=30）返回 -1');
  eq(D.hitSegment(segs, 50, 2), -1, '远外部返回 -1');
  // 内缘 dist=34 命中、外缘 dist=46 命中（边界含在环带内）
  eq(D.hitSegment(segs, 50, 50 - 34), 0, '内缘边界命中');
  eq(D.hitSegment(segs, 50, 50 - 46), 0, '外缘边界命中');
  eq(D.hitSegment(segs, 50, 50 - 46.5), -1, '外缘之外返回 -1');
}

/* ---------- 5. 首末段边界 ---------- */
console.log('首末段与分段交界');
{
  const segs = makeSegments(4);
  // frac=0 是起点（12点），归段0；交界 frac=0.25 归段1
  eq(D.hitSegment(segs, 50, 50 - 40), 0, '起点 12 点归段0');
  const b = pointAt(0.25, 40);
  eq(D.hitSegment(segs, b.x, b.y), 1, '段0/段1 交界归段1');
  // 末段终点附近（frac 接近 1）归段3
  const tail = pointAt(0.999, 40);
  eq(D.hitSegment(segs, tail.x, tail.y), 3, '末段尾部归段3');
}

/* ---------- 6. 小占比分类 ---------- */
console.log('小占比分类可命中');
{
  const segs = [
    { categoryId: 'c-big', name: '大', ratio: 0.97, cents: 9700, percentText: '97.0', aggregate: false },
    { categoryId: 'c-tiny', name: '小', ratio: 0.03, cents: 300, percentText: '3.0', aggregate: false },
  ];
  const p = pointAt(0.985, 40); // 小分段中点
  eq(D.hitSegment(segs, p.x, p.y), 1, '3% 小分段仍能命中');
}

/* ---------- 7. 聚合「其他」 ---------- */
console.log('聚合「其他」');
{
  // 前 7 段共 0.91，聚合段 0.09，总和为 1
  const segs = [];
  for (let i = 0; i < 7; i++) {
    segs.push({ categoryId: 'c-id' + i, name: '分类' + i, ratio: 0.13, cents: 130, percentText: '13.0', aggregate: false });
  }
  segs.push({
    categoryId: '__aggregate_other__',
    name: '其他',
    ratio: 0.09,
    cents: 900,
    percentText: '9.0',
    aggregate: true,
  });
  const p = pointAt(0.91 + 0.045, 40); // 聚合段中点
  const idx = D.hitSegment(segs, p.x, p.y);
  assert(idx >= 0, '聚合段可命中');
  eq(segs[idx].aggregate, true, '命中项为聚合段');
  // 聚合颜色为专用中性色
  eq(D.resolveSegmentColors(segs)[7].color, D.AGGREGATE_COLOR, '聚合色固定');
}

/* ---------- 8. 非法 ratio / 无效坐标 ---------- */
console.log('非法 ratio 与无效坐标');
{
  const bad = [
    { categoryId: 'c-a', name: 'A', ratio: 0, cents: 0, percentText: '0.0', aggregate: false },
    { categoryId: 'c-b', name: 'B', ratio: 1, cents: 1000, percentText: '100.0', aggregate: false },
  ];
  const p = pointAt(0.5, 40);
  eq(D.hitSegment(bad, p.x, p.y), 1, '0 ratio 段不占区间，命中有效段');
  const neg = [{ categoryId: 'c-a', name: 'A', ratio: -0.5, cents: 0, percentText: '0', aggregate: false }];
  eq(D.hitSegment(neg, 50, 10), -1, '负 ratio 不命中');
}

/* ---------- 9. localToViewBox 坐标映射 ---------- */
console.log('本地 px → viewBox');
{
  const vb = D.localToViewBox(25, 50, 100, 100);
  assert(Math.abs(vb.x - 25) < 1e-9 && Math.abs(vb.y - 50) < 1e-9, '等比映射正确');
  const vb2 = D.localToViewBox(75, 30, 150, 60);
  assert(Math.abs(vb2.x - 50) < 1e-9 && Math.abs(vb2.y - 50) < 1e-9, '非等比容器映射正确');
}

/* ---------- 10. 颜色稳定与统一 ---------- */
console.log('颜色稳定、月度年度同色、图例=圆环');
{
  // 同 id 跨两次解析稳定
  eq(
    D.getCategoryColor('c-id0', new Set()).color,
    D.getCategoryColor('c-id0', new Set()).color,
    '同分类多次解析颜色稳定'
  );
  // 同图 8 个真实分类不撞色
  const colors = D.resolveSegmentColors(makeSegments(8)).map((s) => s.color);
  eq(new Set(colors).size, 8, '8 个真实分类颜色互不相同');
  // 排序变化（模拟不同月份顺序不同），同 id 颜色一致
  const groupA = D.resolveSegmentColors([
    { categoryId: 'c-id0', ratio: 0.6, aggregate: false },
    { categoryId: 'c-id1', ratio: 0.4, aggregate: false },
  ]);
  const groupB = D.resolveSegmentColors([
    { categoryId: 'c-id1', ratio: 0.5, aggregate: false },
    { categoryId: 'c-id0', ratio: 0.5, aggregate: false },
  ]);
  const colorOf = (list, id) => list.find((s) => s.categoryId === id).color;
  eq(colorOf(groupA, 'c-id0'), colorOf(groupB, 'c-id0'), 'c-id0 跨月颜色一致');
  eq(colorOf(groupA, 'c-id1'), colorOf(groupB, 'c-id1'), 'c-id1 跨月颜色一致');
  // 图例颜色 = 圆环圆弧颜色
  const segs = makeSegments(3);
  const listColors = D.resolveSegmentColors(segs).map((s) => s.color);
  const arcColors = D.buildDonutArcs(segs).map((a) => a.color);
  for (let i = 0; i < 3; i++) eq(listColors[i], arcColors[i], '第 ' + i + ' 段图例色=圆环色');
}

console.log('\ndonut-hit tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
