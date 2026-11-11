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
 *   8. 选中态：五层整段外移 + 其余变淡，且仍全部是 hex
 *   9. v1.5.0 车削双层环：每段五层同心弧（底槽 1 + 5N）、dash 按本层半径独立计算、
 *      段间留缝、颜色只朝白/黑插值、不出现 linecap/渐变/filter、体积有上限
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

/** 把 SVG 里所有 <circle> 解析成属性对象数组（顺序 = 绘制顺序） */
function parseCircles(svg) {
  const out = [];
  const re = /<circle\s([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(svg)) !== null) {
    const attrs = {};
    const body = m[1];
    const are = /([a-zA-Z-]+)="([^"]*)"/g;
    let a;
    while ((a = are.exec(body)) !== null) attrs[a[1]] = a[2];
    out.push(attrs);
  }
  return out;
}

/** 只取分段层（带 dasharray 的），底槽没有 dasharray */
function segmentCircles(svg) {
  return parseCircles(svg).filter((c) => c['stroke-dasharray'] !== undefined);
}

const TAU = Math.PI * 2;
/** 单段某一层的期望 dash（与渲染同一条公式：先在角度域算，再乘本层半径） */
function expectedDash(ratio, r, gapRad) {
  return Math.max(0.2, (ratio * TAU - gapRad) * r);
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
  // v1.5.0：底槽 1 + 每段 5 层（车削双层环的固定结构，不是死值，是规格）
  eq(
    (svg.match(/<circle/g) || []).length,
    1 + share.segments.length * D.DONUT_LAYERS.length,
    'circle 数 = 底槽 1 + 分段 N × 5 层'
  );
  eq(D.DONUT_LAYERS.length, 5, '五层结构（A 方向规格）');
  assert(svg.indexOf('stroke-opacity="0.1"') > 0, '轨道 rgba alpha 转成 stroke-opacity');
  eq((svg.match(/stroke-width="12.8"/g) || []).length, 1, '底槽描边宽 = 12.8（比环带整宽，缝才透得出来）');

  // 圆弧与比例自洽：单层口径的 buildDonutArcs 仍是 ratio × 周长
  const arcs = D.buildDonutArcs(share.segments, 'dark');
  arcs.forEach((a, i) => {
    const expected = a.ratio * D.CIRCUMFERENCE;
    const got = Number(a.dashArray.split(' ')[0]);
    assert(Math.abs(got - expected) < 1e-9, '第 ' + i + ' 段 dasharray 与 ratio 自洽');
    assert(got >= 0 && Number.isFinite(got), '第 ' + i + ' 段 dash 有限非负');
  });
  eq(arcs[0].dashOffset, 0, '第一段从 12 点开始（offset=0）');
  eq(arcs[0].startRatio, 0, '第一段起始比例 0');
  assert(Math.abs(arcs[1].startRatio - arcs[0].ratio) < 1e-9, '第二段起始比例 = 第一段比例');

  // 渲染口径：每层按「角度域 × 本层半径」独立算 dash，不能共用
  {
    const drawn = arcs.filter((a) => a.ratio > 0);
    const gapRad = drawn.length > 1 ? D.GAP_RAD : 0;
    const segsInSvg = segmentCircles(svg);
    eq(
      segsInSvg.length,
      drawn.length * D.DONUT_LAYERS.length,
      '每段都画满 5 层（层数 × 段数）'
    );
    let k = 0;
    drawn.forEach((a, i) => {
      D.DONUT_LAYERS.forEach((L, j) => {
        const c = segsInSvg[k++];
        eq(Number(c.r), Math.round(L.r * 1000) / 1000, '第 ' + i + ' 段第 ' + j + ' 层半径 = 规格 r');
        eq(Number(c['stroke-width']), L.w, '第 ' + i + ' 段第 ' + j + ' 层描边宽 = 规格 w');
        const dash = Number(c['stroke-dasharray'].split(' ')[0]);
        const want = expectedDash(a.ratio, L.r, gapRad);
        assert(Math.abs(dash - want) < 1e-2, '第 ' + i + ' 段第 ' + j + ' 层 dash 按本层半径算（实际 ' + dash + '，期望 ' + want + '）');
        const rest = Number(c['stroke-dasharray'].split(' ')[1]);
        assert(Math.abs(rest - (TAU * L.r - dash)) < 1e-2, '第 ' + i + ' 段第 ' + j + ' 层 rest = 本层周长 - dash');
        const off = Number(c['stroke-dashoffset']);
        const wantOff = -(a.startRatio * TAU + gapRad / 2) * L.r;
        assert(Math.abs(off - wantOff) < 1e-2, '第 ' + i + ' 段第 ' + j + ' 层 offset 按本层半径算');
      });
    });
    // 同一个分段内，五层的 dash 必须各不相同（半径不同 → 弧长不同），否则就是共用了一份 dash
    const firstSeg = segsInSvg.slice(0, D.DONUT_LAYERS.length).map((c) => Number(c['stroke-dasharray'].split(' ')[0]));
    eq(new Set(firstSeg).size, D.DONUT_LAYERS.length, '同一段五层 dash 各不相同（未共用同一份 dasharray）');
  }

  // 段间缝：同层相邻两段的角向间隔 = GAP_RAD（0.9 / 251.327 × 2π）
  {
    const segsInSvg = segmentCircles(svg);
    const L = D.DONUT_LAYERS[0];
    const firstOfSeg = [];
    for (let i = 0; i < segsInSvg.length; i += D.DONUT_LAYERS.length) firstOfSeg.push(segsInSvg[i]);
    for (let i = 0; i + 1 < firstOfSeg.length; i++) {
      const c = firstOfSeg[i];
      const nx = firstOfSeg[i + 1];
      const start = -Number(c['stroke-dashoffset']);
      const end = start + Number(c['stroke-dasharray'].split(' ')[0]);
      const nextStart = -Number(nx['stroke-dashoffset']);
      const gapAngle = (nextStart - end) / L.r;
      // 容差 1e-4：SVG 数值按三位小数输出，换算回角度会有 ~2.5e-5 rad 的舍入误差
      assert(Math.abs(gapAngle - D.GAP_RAD) < 1e-4, '第 ' + i + ' 与 ' + (i + 1) + ' 段之间留缝 = GAP_RAD（实际 ' + gapAngle + '）');
    }
    assert(Math.abs(D.GAP_RAD * D.RADIUS - D.DONUT_GAP) < 1e-9, '缝宽弧度 × RADIUS = 0.9 个单位');
  }

  // 颜色：只朝白 / 黑插值，色相不变；同段五层明度单调（外亮内暗 = 朝外凸起）
  {
    const base = arcs[0].svgColor;
    const tones = D.DONUT_LAYERS.map((L) => D.layerColor(L, base, 'dark'));
    eq(tones[0], base, '第 1 层是分类色原样（色相合同不动）');
    D.DONUT_LAYERS.forEach((L, j) => {
      if (L.tone === 'base') return;
      const want = D.mixHex(base, L.tone === 'light' ? '#FFFFFF' : '#000000', L.amt.dark);
      eq(tones[j], want, '第 ' + j + ' 层 = 分类色朝' + (L.tone === 'light' ? '白' : '黑') + '混合 ' + L.amt.dark);
      assert(/^#[0-9A-F]{6}$/.test(tones[j]), '第 ' + j + ' 层输出 #RRGGBB');
    });
    // 浅色主题用另一档 amt（同一色相、不同明度台阶）
    const lightTones = D.DONUT_LAYERS.map((L) => D.layerColor(L, base, 'light'));
    assert(lightTones[1] !== tones[1], '深浅两主题的高光层明度不同（amt 分主题）');
  }

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
  // 整圈不切缝：每层的 dash 应等于该层自己的整周长（半径不同 → 不能用同一个数比较）
  const segsInSvg = segmentCircles(svg);
  eq(segsInSvg.length, D.DONUT_LAYERS.length, '单分类也画满 5 层');
  segsInSvg.forEach((c, j) => {
    const r = Number(c.r);
    const dash = Number(c['stroke-dasharray'].split(' ')[0]);
    assert(Math.abs(dash - TAU * r) < 1e-2, '单分类第 ' + j + ' 层 dash = 本层整周长（实际 ' + dash + '）');
    assert(Math.abs(Number(c['stroke-dashoffset'])) < 1e-2, '单分类第 ' + j + ' 层不从环上错开（offset≈0）');
  });
  assert(Math.abs(dashFirst(svg) - TAU * D.DONUT_LAYERS[0].r) < 1e-2, '单分类无缺口（不留 0.9 的缝）');
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
  eq((svg.match(/<circle/g) || []).length, 1 + 8 * D.DONUT_LAYERS.length, 'circle 数 = 底槽 1 + 8 段 × 5 层');
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
console.log('选中态：五层整段外移 + 其余变淡，仍然全 hex');
{
  const share = M.computeCategoryShare(oct, resolveCat);
  const plain = D.buildDonutSVG(share.segments, 'rgba(255,255,255,0.10)', -1, 'dark');
  const sel = D.buildDonutSVG(share.segments, 'rgba(255,255,255,0.10)', 1, 'dark');
  assertSvgContract(sel, '选中态');
  assert(sel !== plain, '选中态 SVG 与未选中不同');
  eq(plain.indexOf('opacity="0.28"'), -1, '未选中时没有变淡分段');
  assert(sel.indexOf('opacity="0.28"') > 0, '选中时其余分段变淡');
  eq((sel.match(/<circle/g) || []).length, (plain.match(/<circle/g) || []).length, '选中态不增删元素');

  // 选中段：五层半径统一 +SELECT_SHIFT，描边宽一律保持规格（不加粗 → 不会穿出其他层）
  const drawn = D.buildDonutArcs(share.segments, 'dark').filter((a) => a.ratio > 0);
  const selectedIdx = drawn[1].index;
  const segsSel = segmentCircles(sel);
  const block = segsSel.slice(1 * D.DONUT_LAYERS.length, 2 * D.DONUT_LAYERS.length);
  eq(block.length, D.DONUT_LAYERS.length, '选中段仍有 5 层');
  block.forEach((c, j) => {
    const want = Math.round((D.DONUT_LAYERS[j].r + D.SELECT_SHIFT) * 1000) / 1000;
    eq(Number(c.r), want, '选中段第 ' + j + ' 层半径 = 规格 r + ' + D.SELECT_SHIFT);
    eq(Number(c['stroke-width']), D.DONUT_LAYERS[j].w, '选中段第 ' + j + ' 层描边宽不变（整层平移，不加粗）');
  });
  assert(sel.indexOf('stroke-width="' + (D.STROKE + 3) + '"') < 0, '不再用「单层加粗 3」表示选中');
  // 其余段的五层都压暗到 0.28
  eq((sel.match(/opacity="0.28"/g) || []).length, (drawn.length - 1) * D.DONUT_LAYERS.length, '未选中的每层都压暗');
  eq(selectedIdx >= 0, true, '选中 index 合法');
  // 越界选中不崩
  assertSvgContract(D.buildDonutSVG(share.segments, 'rgba(255,255,255,0.10)', 99, 'dark'), '越界选中');
}

/* ================= 8. 轨道颜色两种入参等效 ================= */
console.log('轨道色：字符串 rgba 与对象 {color,opacity} 等效；缺省按主题取 TRACK_SPEC');
{
  const segs = M.computeCategoryShare(oct, resolveCat).segments;
  const a = D.buildDonutSVG(segs, 'rgba(255,255,255,0.10)', -1, 'dark');
  const b = D.buildDonutSVG(segs, { color: '#FFFFFF', opacity: 0.1 }, -1, 'dark');
  eq(a, b, '两种入参产出完全一致的 SVG');
  assertSvgContract(D.buildDonutSVG(segs, '#FFFFFF', -1, 'dark'), '纯 hex 轨道');

  // 缺省底槽：深色比卡片更暗（黑 45%），浅色用深灰 10%，两者都必须是 hex + stroke-opacity
  const darkSvg = D.buildDonutSVG(segs, undefined, -1, 'dark');
  const lightSvg = D.buildDonutSVG(segs, undefined, -1, 'light');
  assert(darkSvg.indexOf('stroke="' + D.TRACK_SPEC.dark.color + '" stroke-width="' + D.TRACK_STROKE + '" stroke-opacity="' + D.TRACK_SPEC.dark.opacity + '"') > 0, '深色缺省底槽 = #000000 / 12.8 / 0.45');
  assert(lightSvg.indexOf('stroke="' + D.TRACK_SPEC.light.color + '" stroke-width="' + D.TRACK_STROKE + '" stroke-opacity="' + D.TRACK_SPEC.light.opacity + '"') > 0, '浅色缺省底槽 = #191C28 / 12.8 / 0.10');
  assert(D.TRACK_SPEC.dark.color === '#000000' && D.TRACK_SPEC.dark.opacity > 0.3, '深色底槽必须比卡片明显更暗（否则 0.9 的缝看不见）');
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

/* ================= 10. 车削双层环结构红线（A 方向落地体检） ================= */
console.log('结构红线：无 linecap / 无渐变 / 无 filter / dash 兜底 / 体积可控');
{
  // 12 段（组件上限）——每个分类比例都 >0，最接近线上最坏情况
  const ratios = [0.26, 0.17, 0.13, 0.10, 0.08, 0.07, 0.05, 0.04, 0.035, 0.03, 0.02, 0.015];
  const many = ratios.map((r, i) => ({
    categoryId: 'c-cat' + i,
    name: '分类' + i,
    ratio: r,
    cents: Math.round(r * 10000),
    percentText: (r * 100).toFixed(1),
    aggregate: i === ratios.length - 1,
  }));
  ['dark', 'light'].forEach((t) => {
    const svg = D.buildDonutSVG(many, undefined, -1, t);
    assertSvgContract(svg, '12 段 ' + t);
    eq((svg.match(/<circle/g) || []).length, 61, '12 段 = 61 个 circle（1 底槽 + 60 层）');
    eq(svg.indexOf('stroke-linecap'), -1, '多层结构不得用 linecap（圆头会让各层端点外扩不同的 w/2）');
    eq(svg.indexOf('filter'), -1, '不使用 SVG filter');
    eq(svg.indexOf('url(#'), -1, '不使用渐变引用（渐变铺在包围盒上，不沿弧走）');
    eq(/-\d*0\.000"/.test(svg), false, '不输出负零数值（-0.000 在个别渲染器上非法）');
    eq(svg.indexOf('opacity="1"'), -1, '未选中态不写冗余 opacity="1"');
    // 体积回归护栏：现状 12 段约 10.7KB（SVG）；超上限说明拼装膨胀了（不是死值，是上限）
    assert(svg.length < 12000, '12 段 SVG 体积 < 12KB（实际 ' + svg.length + '）');
    assert(svg.length > 8000, '12 段 SVG 体积 > 8KB（结构没被削掉层：实际 ' + svg.length + '）');
  });

  // 极小段：dash 必须兜底为 0.2，不能是负数 / NaN
  {
    const tiny = [{ categoryId: 'c-food', name: '餐饮', ratio: 0.001, cents: 1, aggregate: false }];
    const svg = D.buildDonutSVG(tiny, undefined, -1, 'dark');
    assertSvgContract(svg, '极小段');
    const segsInSvg = segmentCircles(svg);
    // 单段会被判定为「整圈」→ 无缝；用两段构造比值极小的场景
    const tiny2 = [
      { categoryId: 'c-food', name: '餐饮', ratio: 0.999, cents: 999, aggregate: false },
      { categoryId: 'c-shopping', name: '购物', ratio: 0.001, cents: 1, aggregate: false },
    ];
    const svg2 = D.buildDonutSVG(tiny2, undefined, -1, 'dark');
    assertSvgContract(svg2, '极小段（两段）');
    const last = segmentCircles(svg2).slice(D.DONUT_LAYERS.length);
    eq(last.length, D.DONUT_LAYERS.length, '极小段仍画满 5 层');
    last.forEach((c, j) => {
      const dash = Number(c['stroke-dasharray'].split(' ')[0]);
      assert(dash >= 0.2, '极小段第 ' + j + ' 层 dash 兜底到 ≥0.2（实际 ' + dash + '）');
      assert(Number.isFinite(dash), '极小段第 ' + j + ' 层 dash 有限');
    });
    assert(segsInSvg.length === D.DONUT_LAYERS.length, '单段脏数据也只画 5 层');
  }

  // 混合主题 / 未知主题 / 缺参数都不得产非法值
  ['unknown-theme', undefined, null, 'light', 'dark'].forEach((t, i) => {
    assertSvgContract(D.buildDonutSVG(many, undefined, -1, t), '主题变体 ' + i + '（' + t + '）');
  });
}

console.log('\ndonut-render tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
