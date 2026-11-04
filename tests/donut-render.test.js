/**
 * tests/donut-render.test.js — 圆环 SVG 渲染合同（v1.4.0 Skyline 可见性回归）
 *
 * 为什么要有这个套件：v1.3.x 的全部圆环用例都在断言「data 正确」，
 * 但 SVG 里用了 hsl() 颜色 → Skyline 把整条 <circle> 丢掉，
 * 逻辑全绿、画面只剩一圈灰轨道。本套件**只测渲染合同，不测死值**：
 *
 *   1. 颜色：SVG 属性里的颜色只能是 #RRGGBB，不得出现 hsl()/rgba()/rgb()
 *   2. 尺寸：根节点必须显式 width/height + preserveAspectRatio（svg 不支持百分比）
 *   3. 透明度：走 opacity / stroke-opacity 属性，不写进颜色值
 *   4. 比例：真实 segments 的 ratio 和≈1，圆弧 dasharray 与 ratio 自洽
 *   5. 分组：>8 类 = Top7 + 「其他」聚合；单一分类 = 整圈
 *   6. 空数据语义：零支出只有灰轨道、不生成虚假分段；只有收入不得产出比例
 *   7. 脏数据：NaN / Infinity / 负数 / >1 的 ratio 不得产出非法 SVG 数值
 *   8. 选中态：外扩 + 其余变淡，且仍全部是 hex
 *
 * 纯函数，不依赖 wx。
 * 运行：node tests/donut-render.test.js
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
const M = require('../data/statistics/month');
const money = require('../data/money');

/* ---------------- 夹具 ---------------- */

function bill(type, amount, y, mo, d, cat, ledger) {
  return {
    id: 'b-' + y + mo + d + '-' + cat + '-' + amount + '-' + (ledger || 'n'),
    type,
    amountCents: Math.round(amount * 100),
    categoryId: cat,
    occurredAt: new Date(y, mo - 1, d, 12, 0).getTime(),
    ledgerImpact: ledger || 'normal',
  };
}

const NAMES = {};
for (let i = 0; i < 12; i++) NAMES['c-cat' + i] = { name: '分类' + i, emoji: '📦' };
NAMES['c-food'] = { name: '餐饮', emoji: '🍚' };
NAMES['c-shopping'] = { name: '购物', emoji: '🛍️' };
function resolveCat(id) {
  return NAMES[id] || { name: '其他', emoji: '📦' };
}

/** 取 SVG 里所有颜色属性的值（stroke= / fill=） */
function colorAttrs(svg) {
  const out = [];
  const re = /\s(?:stroke|fill)="([^"]*)"/g;
  let m;
  while ((m = re.exec(svg)) !== null) out.push(m[1]);
  return out;
}

/** 断言一段 SVG 满足全部 Skyline 兼容合同 */
function assertSvgContract(svg, label) {
  const colors = colorAttrs(svg);
  assert(colors.length > 0, label + '：SVG 至少有一个颜色属性');
  colors.forEach((c) => {
    if (c === 'none') return;
    assert(/^#[0-9A-F]{6}$/.test(c), label + '：颜色必须是 #RRGGBB，实际「' + c + '」');
  });
  assert(svg.indexOf('hsl(') < 0, label + '：SVG 不得出现 hsl()（Skyline 会丢元素）');
  assert(svg.indexOf('rgba(') < 0, label + '：SVG 不得出现 rgba()');
  assert(svg.indexOf('rgb(') < 0, label + '：SVG 不得出现 rgb()');
  assert(!/NaN|Infinity|undefined|null/.test(svg), label + '：SVG 不得出现 NaN/Infinity/undefined/null');
  assert(/<svg[^>]*\swidth="[^"]+"/.test(svg), label + '：根节点必须有 width（svg 不支持百分比单位）');
  assert(/<svg[^>]*\sheight="[^"]+"/.test(svg), label + '：根节点必须有 height');
  assert(/<svg[^>]*\spreserveAspectRatio="[^"]+"/.test(svg), label + '：根节点必须有 preserveAspectRatio');
  assert(/<svg[^>]*\sviewBox="0 0 100 100"/.test(svg), label + '：viewBox 保持 0 0 100 100');
  assert(svg.indexOf('</svg>') === svg.length - 6, label + '：SVG 以 </svg> 结尾');
}

/** 解析 dasharray 首值（实线长度） */
function dashFirst(svg) {
  const m = /stroke-dasharray="([0-9.]+) [0-9.]+"/.exec(svg);
  return m ? Number(m[1]) : NaN;
}

/* ================= 1. 颜色转换口径 ================= */
console.log('颜色：hsl → hex 确定性转换');
eq(D.hslToHex(0, 100, 50), '#FF0000', 'hsl(0,100,50)=纯红');
eq(D.hslToHex(120, 100, 50), '#00FF00', 'hsl(120,100,50)=纯绿');
eq(D.hslToHex(240, 100, 50), '#0000FF', 'hsl(240,100,50)=纯蓝');
eq(D.hslToHex(0, 0, 0), '#000000', 'hsl(0,0,0)=黑');
eq(D.hslToHex(0, 0, 100), '#FFFFFF', 'hsl(0,0,100)=白');
eq(D.hslToHex(360, 100, 50), '#FF0000', 'hsl(360)=hsl(0) 环绕一致');
eq(D.hslToHex(-120, 100, 50), '#0000FF', '负色相归一化（-120=240）');

console.log('颜色：解析器覆盖 hex / rgb / rgba / hsl / 非法值');
eq(D.svgColor('#8d94a8'), '#8D94A8', 'hex 小写转大写');
eq(D.svgColor('#fff'), '#FFFFFF', '#RGB 展开为 #RRGGBB');
eq(D.svgColor('rgb(255,0,0)'), '#FF0000', 'rgb() 转 hex');
eq(D.svgColor('rgba(255,255,255,0.10)'), '#FFFFFF', 'rgba() 丢弃 alpha 只保留 hex');
eq(D.svgColor('hsl(240, 62%, 60%)'), D.hslToHex(240, 62, 60), 'hsl() 转 hex');
eq(D.svgColor('not-a-color'), D.AGGREGATE_COLOR, '未知颜色回退中性色（不抛错）');
eq(D.svgColor(''), D.AGGREGATE_COLOR, '空值回退中性色');
eq(D.svgColor(null), D.AGGREGATE_COLOR, 'null 回退中性色');
{
  const p = D.parseSvgColor('rgba(25,28,40,0.08)');
  eq(p.alpha, 0.08, 'parseSvgColor 保留 rgba 的 alpha');
  eq(p.hex, '#191C28', 'parseSvgColor 给出 hex');
  const q = D.parseSvgColor({ color: '#fff', opacity: 0.5 });
  eq(q, null, '对象形态不喂给 parseSvgColor（由 buildDonutSVG 处理）');
}

console.log('颜色：全色相扫描都能转出合法 hex（不留死色）');
{
  let bad = 0;
  for (let h = 0; h < 360; h++) {
    ['dark', 'light'].forEach((t) => {
      const c = D.svgColor(D.getCategoryColor('c-hue-' + h, t));
      if (!/^#[0-9A-F]{6}$/.test(c)) bad++;
    });
  }
  eq(bad, 0, '360 色相 × 2 主题全部为合法 hex');
  // 同一 categoryId 的色相身份在两主题下一致（只改明度）
  const id = 'c-food';
  eq(
    D.svgColor(D.getCategoryColor(id, 'dark')).length,
    D.svgColor(D.getCategoryColor(id, 'light')).length,
    '两主题 hex 长度一致'
  );
  assert(
    D.svgColor(D.getCategoryColor(id, 'dark')) !== D.svgColor(D.getCategoryColor(id, 'light')),
    '两主题明度不同 → hex 不同'
  );
  eq(D.getCategoryColor(id, 'dark'), D.getCategoryColor(id, 'dark'), '同一输入颜色稳定可重现');
}

/* ================= 2. 正常月度：真实比例 ================= */
console.log('正常月度：5 分类真实比例');
const oct = [
  bill('expense', 10.0, 2026, 10, 1, 'c-food'),
  bill('expense', 20.0, 2026, 10, 5, 'c-food'),
  bill('expense', 5.0, 2026, 10, 10, 'c-transport'),
  bill('income', 100.0, 2026, 10, 15, 'c-salary'),
  bill('expense', 40.0, 2026, 10, 20, 'c-shopping'),
];
{
  const share = M.computeCategoryShare(oct, resolveCat);
  const sum = share.segments.reduce((a, s) => a + s.ratio, 0);
  assert(Math.abs(sum - 1) < 1e-9, '真实 segments ratio 和 ≈ 1（实际 ' + sum + '）');

  const svg = D.buildDonutSVG(share.segments, 'rgba(255,255,255,0.10)', -1, 'dark');
  assertSvgContract(svg, '月度 5 段');
  eq((svg.match(/<circle/g) || []).length, share.segments.length + 1, 'circle 数 = 轨道 1 + 分段 N');
  assert(svg.indexOf('stroke-opacity="0.1"') > 0, '轨道 rgba alpha 转成 stroke-opacity');

  // 圆弧与比例自洽：第一段 dash 长度 = ratio × 周长
  const arcs = D.buildDonutArcs(share.segments, 'dark');
  arcs.forEach((a, i) => {
    const expected = a.ratio * D.CIRCUMFERENCE;
    const got = Number(a.dashArray.split(' ')[0]);
    assert(Math.abs(got - expected) < 1e-9, '第 ' + i + ' 段 dasharray 与 ratio 自洽');
    assert(got >= 0 && Number.isFinite(got), '第 ' + i + ' 段 dash 有限非负');
  });
  eq(arcs[0].dashOffset, 0, '第一段从 12 点开始（offset=0）');

  // 图例颜色合同不变（仍是 hsl，本次修复不碰对外颜色口径）
  eq(arcs[0].color, D.resolveSegmentColors(share.segments, 'dark')[0].color, '对外颜色仍走统一解析');
  assert(/^hsl\(/.test(D.getCategoryColor(share.segments[0].categoryId, 'dark')), '对外颜色格式保持 hsl（面板图例复用）');
  eq(arcs[0].svgColor, D.svgColor(arcs[0].color), '圆弧额外带 svgColor，供 SVG 输出');
}

/* ================= 3. 单一分类 = 整圈 ================= */
console.log('单一分类：整圈');
{
  const one = [bill('expense', 33.0, 2026, 10, 2, 'c-food')];
  const share = M.computeCategoryShare(one, resolveCat);
  eq(share.segments.length, 1, '单分类只有 1 段');
  const svg = D.buildDonutSVG(share.segments, '#FFFFFF', -1, 'dark');
  assertSvgContract(svg, '单一分类');
  assert(Math.abs(dashFirst(svg) - D.CIRCUMFERENCE) < 1e-9, '单分类 dash = 整个周长（整圈）');
}

/* ================= 4. >8 类 = Top7 + 其他 ================= */
console.log('聚合：>8 类 = Top7 + 其他');
{
  const many = [];
  for (let i = 0; i < 10; i++) many.push(bill('expense', 100 - i * 5, 2026, 10, i + 1, 'c-cat' + i));
  const share = M.computeCategoryShare(many, resolveCat);
  eq(share.segments.length, 8, '聚合后 8 段（7 + 其他）');
  eq(share.segments[7].aggregate, true, '末段是聚合项');
  eq(share.segments[7].categoryId, M.AGGREGATE_OTHER_ID, '聚合段 categoryId 固定');
  const svg = D.buildDonutSVG(share.segments, 'rgba(255,255,255,0.10)', -1, 'dark');
  assertSvgContract(svg, 'Top7+其他');
  eq((svg.match(/<circle/g) || []).length, 9, 'circle 数 = 轨道 1 + 8 段');
  const aggHex = D.svgColor(D.resolveSegmentColors(share.segments, 'dark')[7].color);
  eq(aggHex, D.AGGREGATE_COLOR, '聚合段用中性色 hex');
}

/* ================= 5. 空数据语义 ================= */
console.log('空数据：零支出只有灰轨道');
{
  // 月度零支出：segments 为空（不是「0 段假数据」）
  const share = M.computeCategoryShare([], resolveCat);
  eq(share.total, 0, '零支出 total=0');
  eq(share.segments.length, 0, '零支出不生成任何分段');
  const svg = D.buildDonutSVG(share.segments, 'rgba(255,255,255,0.10)', -1, 'dark');
  assertSvgContract(svg, '月度零支出');
  eq((svg.match(/<circle/g) || []).length, 1, '零支出只有 1 个轨道 circle');
  eq((svg.match(/stroke-dasharray/g) || []).length, 0, '零支出没有任何分段弧');
  assert(svg.indexOf('stroke-opacity="0.1"') > 0, '零支出轨道仍是半透明灰环（可见但不抢眼）');
  // 中心金额语义：面板把 center-text 传成 ¥0.00，圆环只留灰轨道 → 「灰轨道 + 0」
  eq(money.formatCents(share.total), '0.00', '零支出中心金额格式化为 0.00');

  // 只有收入、没有支出：不得产出任何比例（避免「100% 全是收入」这类假圆环）
  const incomeOnly = [
    bill('income', 500.0, 2026, 10, 3, 'c-salary'),
    bill('income', 200.0, 2026, 10, 8, 'c-bonus'),
  ];
  const incShare = M.computeCategoryShare(incomeOnly, resolveCat);
  eq(incShare.segments.length, 0, '只有收入 → 0 分段（不产出错误比例）');
  eq(incShare.total, 0, '只有收入 → total=0');
  assertSvgContract(D.buildDonutSVG(incShare.segments, 'rgba(255,255,255,0.10)', -1, 'dark'), '只有收入');

  // daily-value-only 不进账：不得被算进占比
  const dvOnly = [bill('expense', 999.0, 2026, 10, 4, 'c-shopping', 'daily-value-only')];
  const dvShare = M.computeCategoryShare(dvOnly, resolveCat);
  eq(dvShare.segments.length, 0, 'daily-value-only 不进分类占比');

  // 年度：统计面板（statistics-panel.js）年度占比走同一条 computeCategoryShare(bills)，
  // 只是 bills 换成全年账单 —— 所以年度空语义与月度必须一致。
  const yearZero = M.computeCategoryShare([], resolveCat);
  eq(yearZero.segments.length, 0, '年度零支出不生成虚假分段');
  const yearIncomeOnly = M.computeCategoryShare([bill('income', 300.0, 2026, 3, 1, 'c-salary')], resolveCat);
  eq(yearIncomeOnly.segments.length, 0, '年度只有收入 → 无分段（不产出错误比例）');
  const yearWithExpense = M.computeCategoryShare(
    [bill('expense', 60.0, 2026, 3, 1, 'c-food'), bill('expense', 40.0, 2026, 4, 1, 'c-shopping')],
    resolveCat
  );
  eq(yearWithExpense.segments.length, 2, '年度有支出 → 正常 2 段');
  assertSvgContract(D.buildDonutSVG(yearWithExpense.segments, 'rgba(255,255,255,0.10)', -1, 'light'), '年度 2 段（浅色主题）');
}

/* ================= 6. 脏数据：NaN / Infinity / 负值 / 超 1 ================= */
console.log('脏数据：不得产出非法 SVG 数值');
{
  const dirty = [
    { categoryId: 'c-a', name: 'A', ratio: NaN, cents: 100, aggregate: false },
    { categoryId: 'c-b', name: 'B', ratio: Infinity, cents: 100, aggregate: false },
    { categoryId: 'c-c', name: 'C', ratio: -0.5, cents: 100, aggregate: false },
    { categoryId: 'c-d', name: 'D', ratio: 2, cents: 100, aggregate: false },
    { categoryId: 'c-e', name: 'E', ratio: '0.5', cents: 100, aggregate: false },
    { categoryId: 'c-f', name: 'F', ratio: undefined, cents: 100, aggregate: false },
  ];
  const svg = D.buildDonutSVG(dirty, 'rgba(255,255,255,0.10)', -1, 'dark');
  assertSvgContract(svg, '脏数据');
  const arcs = D.buildDonutArcs(dirty, 'dark');
  arcs.forEach((a, i) => {
    assert(Number.isFinite(a.ratio) && a.ratio >= 0 && a.ratio <= 1, '第 ' + i + ' 段 ratio 被钳制到 [0,1]');
    assert(Number.isFinite(a.dashOffset), '第 ' + i + ' 段 dashOffset 有限');
    const parts = a.dashArray.split(' ').map(Number);
    parts.forEach((p) => assert(Number.isFinite(p) && p >= 0, '第 ' + i + ' 段 dasharray 两值有限非负'));
  });
  eq(arcs[0].ratio, 0, 'NaN → 0');
  eq(arcs[1].ratio, 0, 'Infinity → 0');
  eq(arcs[2].ratio, 0, '负值 → 0');
  eq(arcs[3].ratio, 1, '>1 钳制到 1');
  eq(arcs[4].ratio, 0.5, '字符串数字可解析');
  eq(arcs[5].ratio, 0, 'undefined → 0');

  // 未知颜色 / 脏 categoryId 也不能产出非法 SVG
  const weird = [{ categoryId: null, name: 'X', ratio: 0.3, cents: 1, aggregate: false }];
  assertSvgContract(D.buildDonutSVG(weird, 'rgba(0,0,0,0.1)', -1, 'dark'), '脏 categoryId');
  assertSvgContract(D.buildDonutSVG(weird, 'rgba(0,0,0,0.1)', -1, 'unknown-theme'), '未知主题');
}

/* ================= 7. 选中态 ================= */
console.log('选中态：外扩 + 其余变淡，仍然全 hex');
{
  const share = M.computeCategoryShare(oct, resolveCat);
  const plain = D.buildDonutSVG(share.segments, 'rgba(255,255,255,0.10)', -1, 'dark');
  const sel = D.buildDonutSVG(share.segments, 'rgba(255,255,255,0.10)', 1, 'dark');
  assertSvgContract(sel, '选中态');
  assert(sel !== plain, '选中态 SVG 与未选中不同');
  eq(plain.indexOf('opacity="0.28"'), -1, '未选中时没有变淡分段');
  assert(sel.indexOf('opacity="0.28"') > 0, '选中时其余分段变淡');
  assert(sel.indexOf('stroke-width="' + (D.STROKE + 3) + '"') > 0, '选中段外扩 3');
  eq((sel.match(/<circle/g) || []).length, (plain.match(/<circle/g) || []).length, '选中态不增删元素');
  // 越界选中不崩
  assertSvgContract(D.buildDonutSVG(share.segments, 'rgba(255,255,255,0.10)', 99, 'dark'), '越界选中');
}

/* ================= 8. 轨道颜色两种入参等效 ================= */
console.log('轨道色：字符串 rgba 与对象 {color,opacity} 等效');
{
  const segs = M.computeCategoryShare(oct, resolveCat).segments;
  const a = D.buildDonutSVG(segs, 'rgba(255,255,255,0.10)', -1, 'dark');
  const b = D.buildDonutSVG(segs, { color: '#FFFFFF', opacity: 0.1 }, -1, 'dark');
  eq(a, b, '两种入参产出完全一致的 SVG');
  assertSvgContract(D.buildDonutSVG(segs, '#FFFFFF', -1, 'dark'), '纯 hex 轨道');
}

/* ================= 9. 命中检测边界（与渲染口径一致） ================= */
console.log('命中边界：孔内 / 环外 / 环上 / 末端');
{
  const share = M.computeCategoryShare(oct, resolveCat);
  const segs = share.segments;
  eq(D.hitSegment(segs, 50, 50), -1, '中心孔返回 -1');
  eq(D.hitSegment(segs, 50, 50 - (D.OUTER_R + 5)), -1, '环外侧返回 -1');
  eq(D.hitSegment(segs, 50, 50 - (D.INNER_R - 5)), -1, '环内侧（孔内）返回 -1');
  eq(D.hitSegment(segs, 50, 50 - D.RADIUS), 0, '12 点方向命中第一段');
  // 每段中点必命中自身
  let acc = 0;
  segs.forEach((s, i) => {
    const frac = acc + s.ratio / 2;
    acc += s.ratio;
    const theta = frac * 2 * Math.PI;
    const x = 50 + D.RADIUS * Math.sin(theta);
    const y = 50 - D.RADIUS * Math.cos(theta);
    eq(D.hitSegment(segs, x, y), i, '第 ' + i + ' 段中点命中自身');
  });
  eq(D.hitSegment([], 50, 50 - D.RADIUS), -1, '空 segments 返回 -1');
  eq(D.hitSegment(segs, NaN, NaN), -1, 'NaN 坐标返回 -1（不抛错）');
}

console.log('\ndonut-render tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
