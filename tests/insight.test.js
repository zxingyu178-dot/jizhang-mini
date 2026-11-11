/**
 * tests/insight.test.js — 统计图表「结论行」纯函数测试（B-2 第一批）
 *
 * 覆盖 data/statistics/insight.js：
 *   金额格式 / 每日趋势结论 / 累计趋势结论 / 月末预测 / 12 个月结论 / 分类占比结论 /
 *   同期环比 / 上月同期封顶 / 长度自保 / 非法入参不崩。
 *
 * 原则：**测规则，不测死值**。
 *   - 「分转元 + 千分位」是标准口径 → 允许断言具体字符串；
 *   - 预测值用「已花 ÷ 已过 × 总天数」推导出的算式断言（换参数仍成立），
 *     不写死「3100」这种魔法数（这里是 1000/10*31 的结果，注释标明来历）；
 *   - 长度 / 无 NaN / 不抛异常这类是硬不变量，必须直接断言。
 *
 * 运行：node tests/insight.test.js
 */
const path = require('path');

const I = require(path.join(__dirname, '..', 'data', 'statistics', 'insight'));
const A = require(path.join(__dirname, '..', 'data', 'statistics', 'axis'));
const M = require(path.join(__dirname, '..', 'data', 'statistics', 'month'));
const Y = require(path.join(__dirname, '..', 'data', 'statistics', 'year'));

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) {
  assert(a === b, msg + '（期望 ' + b + '，实际 ' + a + '）');
}
function includes(s, sub, msg) {
  assert(typeof s === 'string' && s.indexOf(sub) >= 0, msg + '（期望含「' + sub + '」，实际 ' + JSON.stringify(s) + '）');
}
function excludes(s, sub, msg) {
  assert(typeof s === 'string' && s.indexOf(sub) < 0, msg + '（期望不含「' + sub + '」，实际 ' + JSON.stringify(s) + '）');
}

/** 结论行禁止出现的字样（界面上就是残次品） */
const BAD = /NaN|undefined|Infinity|null|\[object/;

/** 输出必须是干净字符串：不含残次品、不以 -0 形式出现、不刷长小数 */
function cleanText(s, label) {
  eq(typeof s, 'string', label + ' 返回字符串');
  assert(!BAD.test(s), label + ' 不含 NaN/undefined/Infinity/null（实际 ' + JSON.stringify(s) + '）');
  assert(!/-0(?!\d)/.test(s), label + ' 不含 -0（实际 ' + s + '）');
  assert(!/\.\d{3,}/.test(s), label + ' 不刷长小数（实际 ' + s + '）');
}

/** 中文字符数（任务 #9 的判据） */
function cnCount(s) {
  return (String(s).match(/[\u4e00-\u9fa5]/g) || []).length;
}

/** 窄屏（360px）图表卡内容区可用宽度：638rpx × 360/750 ≈ 306px */
const NARROW_CONTENT_PX = Math.round(638 * (360 / 750));

/* ==================== 1. 金额格式：整数元 + 千分位 ==================== */
console.log('1. formatInsightYuan');
{
  eq(I.formatInsightYuan(0), '¥0', '1 0 分 → ¥0');
  eq(I.formatInsightYuan(1234), '¥12', '1 1234 分（12.34 元）→ 四舍五入 ¥12');
  eq(I.formatInsightYuan(123456), '¥1,235', '1 123456 分（1234.56 元）→ ¥1,235（四舍五入 + 千分位）');
  eq(I.formatInsightYuan(2000), '¥20', '1 2000 分 → ¥20');
  eq(I.formatInsightYuan(12700), '¥127', '1 12700 分 → ¥127');
  eq(I.formatInsightYuan(123456789), '¥1,234,568', '1 大额也带千分位');
  eq(I.formatInsightYuan(99), '¥1', '1 0.99 元进位到 ¥1（整数元口径）');

  [-1, -12345, null, undefined, NaN, Infinity, -Infinity, 'abc', {}, []].forEach((v) => {
    eq(I.formatInsightYuan(v), '¥0', '1 非法/负数入参 → ¥0：' + String(v));
  });

  // 不变量：永不带小数、永不出现残次品
  [0, 1, 49, 50, 1234, 123456, 999999999].forEach((c) => {
    const s = I.formatInsightYuan(c);
    cleanText(s, '1 输出干净 ' + c);
    excludes(s, '.', '1 结论行金额不带小数 ' + c);
  });
}

/* ==================== 2. 每日趋势结论 ==================== */
console.log('2. buildDailyInsight');
{
  const mkDays = (n, patch) => {
    const out = [];
    for (let d = 1; d <= n; d++) out.push({ day: d, cents: 0 });
    Object.keys(patch || {}).forEach((k) => { out[Number(k) - 1].cents = patch[k]; });
    return out;
  };

  eq(I.buildDailyInsight(mkDays(30, {}), 10, 11), '', '2 全 0 → 空串（走现有空态）');
  eq(I.buildDailyInsight([], 10, 11), '', '2 空数组 → 空串');
  eq(I.buildDailyInsight(null, 10, 11), '', '2 null → 空串不抛');
  eq(I.buildDailyInsight(undefined, 10, 11), '', '2 undefined → 空串不抛');

  const one = I.buildDailyInsight(mkDays(30, { 8: 12700 }), 10, 11);
  includes(one, '仅', '2 只有一天有支出 → 用「仅」句式');
  includes(one, '11/08', '2 峰值日格式 M/DD');
  includes(one, '¥127', '2 单日金额');
  excludes(one, '日均', '2 单日有支出不说日均（分母没意义）');
  cleanText(one, '2 单日结论');

  const many = I.buildDailyInsight(mkDays(30, { 8: 12700, 20: 3000 }), 10, 11);
  includes(many, '日均', '2 多日有支出 → 含「日均」');
  includes(many, '最高', '2 多日有支出 → 含「最高」');
  includes(many, '11/08', '2 峰值取最高那天（11/08 ¥127 > 11/20 ¥30）');
  includes(many, '¥16', '2 日均 = (12700+3000)/10 = 1570 分 → ¥16');
  cleanText(many, '2 多日结论');

  // 非法入参一律不抛
  [null, undefined, 'abc', {}, [null], [{ day: 1, cents: 'x' }], [{ day: NaN, cents: 100 }]].forEach((v) => {
    let s;
    let threw = false;
    try { s = I.buildDailyInsight(v, 10, 11); } catch (e) { threw = true; }
    assert(!threw, '2 非法入参不抛异常：' + JSON.stringify(v));
    if (!threw) cleanText(s, '2 非法入参输出 ' + JSON.stringify(v));
  });

  // 分母非法：不能除零出 Infinity
  [0, -5, NaN, null, undefined, Infinity].forEach((d) => {
    const s = I.buildDailyInsight(mkDays(30, { 8: 12700, 20: 3000 }), d, 11);
    cleanText(s, '2 分母非法(' + String(d) + ')');
    excludes(s, 'Infinity', '2 分母非法不出 Infinity');
  });
}

/* ==================== 3. 累计趋势结论 ==================== */
console.log('3. buildCumulativeInsight');
{
  const cur = I.buildCumulativeInsight({
    totalCents: 123400, elapsedDays: 10, spanDays: 31, isCurrentMonth: true,
  });
  includes(cur, '月末约', '3 当月 → 含「月末约」');
  includes(cur, '已花 ¥1,234', '3 当月 → 已花金额');
  includes(cur, '¥3,825', '3 当月 → 预测 123400/10*31 = 382540 分 → ¥3,825');
  cleanText(cur, '3 当月结论');

  const past = I.buildCumulativeInsight({
    totalCents: 123400, elapsedDays: 31, spanDays: 31, isCurrentMonth: false,
  });
  includes(past, '日均', '3 历史月 → 含「日均」');
  excludes(past, '月末约', '3 历史月不预测（月已完整）');
  includes(past, '¥40', '3 历史月日均 = 123400/31 = 3981 分 → ¥40');
  cleanText(past, '3 历史月结论');

  eq(I.buildCumulativeInsight({ totalCents: 0, elapsedDays: 10, spanDays: 31, isCurrentMonth: true }), '',
    '3 无支出 → 空串');
  eq(I.buildCumulativeInsight(null), '', '3 null → 空串不抛');
  eq(I.buildCumulativeInsight(undefined), '', '3 undefined → 空串不抛');
  eq(I.buildCumulativeInsight({}), '', '3 空对象 → 空串不抛');

  // 除零保护：elapsedDays / spanDays 为 0 或非法
  [{ elapsedDays: 0 }, { spanDays: 0 }, { elapsedDays: 0, spanDays: 0 },
    { elapsedDays: NaN, spanDays: 31 }, { elapsedDays: 10, spanDays: null },
    { elapsedDays: -3, spanDays: 31 }].forEach((patch) => {
    const input = Object.assign(
      { totalCents: 100000, elapsedDays: 10, spanDays: 31, isCurrentMonth: true },
      patch
    );
    let s;
    let threw = false;
    try { s = I.buildCumulativeInsight(input); } catch (e) { threw = true; }
    assert(!threw, '3 除零/非法天数不抛异常：' + JSON.stringify(patch));
    cleanText(s, '3 除零保护输出 ' + JSON.stringify(patch));
    excludes(s, 'Infinity', '3 除零不出 Infinity：' + JSON.stringify(patch));
    excludes(s, '¥0', '3 有支出时预测不许显示 ¥0：' + JSON.stringify(patch));
  });
}

/* ==================== 4 & 5. 月末预测：公式与 2 月天数 ==================== */
console.log('4. forecastCumulative 公式');
{
  // 规则：预测 = 已花 ÷ 已过天数 × 当月总天数（不是 30，也不写死）
  const cases = [
    { total: 1000, elapsed: 10, span: 31, want: 3100, why: '31 天月' },
    { total: 1000, elapsed: 10, span: 30, want: 3000, why: '30 天月' },
    { total: 1000, elapsed: 10, span: 28, want: 2800, why: '2 月平年' },
    { total: 1000, elapsed: 10, span: 29, want: 2900, why: '2 月闰年' },
    { total: 2000, elapsed: 1, span: 31, want: 62000, why: '1 号当天：已过 1 天' },
    { total: 3100, elapsed: 31, span: 31, want: 3100, why: '月末最后一天：预测 = 已花' },
  ];
  cases.forEach((c) => {
    eq(I.forecastCumulative(c.total, c.elapsed, c.span), c.want,
      '4 ' + c.why + '：' + c.total + '/' + c.elapsed + '*' + c.span + ' = ' + c.want);
  });

  // 不变量：预测值永远 ≥ 已花（只要已过天数 < 整月），且是整数
  [28, 29, 30, 31].forEach((span) => {
    const v = I.forecastCumulative(12345, 7, span);
    assert(Number.isInteger(v), '4 预测值是整数分（span=' + span + '）');
    assert(v >= 12345, '4 月中预测不会小于已花（span=' + span + '）');
    assert(Math.abs(v - Math.round((12345 * span) / 7)) === 0, '4 预测值严格等于 total/elapsed*span（span=' + span + '）');
  });

  // 非法入参：不抛、不出 NaN / Infinity
  [[0, 0, 0], [-1, 10, 31], [null, null, null], [NaN, 10, 31], [1000, 0, 31], [1000, 10, 0],
    [1000, 40, 31]].forEach((args) => {
    let v;
    let threw = false;
    try { v = I.forecastCumulative(args[0], args[1], args[2]); } catch (e) { threw = true; }
    assert(!threw, '4 预测非法入参不抛：' + JSON.stringify(args));
    assert(typeof v === 'number' && Number.isFinite(v), '4 预测结果为有限数：' + JSON.stringify(args) + ' → ' + v);
  });
}

/* ==================== 6. 12 个月结论 ==================== */
console.log('6. buildMonthlyInsight');
{
  const zeros = new Array(12).fill(0);
  eq(I.buildMonthlyInsight(zeros), '', '6 12 个月全 0 → 空串');
  eq(I.buildMonthlyInsight([]), '', '6 空数组 → 空串');
  eq(I.buildMonthlyInsight(null), '', '6 null → 空串不抛');

  const pts = Y.computeMonthlyTrend([
    { type: 'expense', amountCents: 100000, occurredAt: new Date(2026, 2, 5, 12).getTime() },
    { type: 'expense', amountCents: 200000, occurredAt: new Date(2026, 6, 5, 12).getTime() },
  ], 2026).points;
  const s = I.buildMonthlyInsight(pts);
  includes(s, '月均', '6 有值 → 含「月均」');
  includes(s, '最高', '6 有值 → 含「最高」');
  includes(s, '7 月', '6 最高月取 7 月（¥2,000 > ¥1,000）');
  includes(s, '¥2,000', '6 最高月金额');
  includes(s, '¥1,500', '6 月均 = 300000/2 个有支出月 = ¥1,500');
  cleanText(s, '6 月度结论');

  // 与年度 Hero 的 yAvg 同口径（同一屏两处「月均」不能打架）
  const ov = Y.computeYearOverview([
    { type: 'expense', amountCents: 100000, occurredAt: new Date(2026, 2, 5, 12).getTime() },
    { type: 'expense', amountCents: 200000, occurredAt: new Date(2026, 6, 5, 12).getTime() },
  ], 2026);
  includes(s, I.formatInsightYuan(ov.monthlyAvg), '6 月均与 computeYearOverview.monthlyAvg 完全一致');

  // 纯数字数组也支持（下标即月份：index 2 = 3 月、index 6 = 7 月）
  eq(I.buildMonthlyInsight([0, 0, 100000, 0, 0, 0, 200000, 0, 0, 0, 0, 0]), s,
    '6 纯数字数组与对象数组结论一致');

  // 非法入参不崩
  [[null], ['x'], [{ month: NaN, expense: 500 }], 'abc', {}].forEach((v) => {
    let out;
    let threw = false;
    try { out = I.buildMonthlyInsight(v); } catch (e) { threw = true; }
    assert(!threw, '6 非法入参不抛：' + JSON.stringify(v));
    if (!threw) cleanText(out, '6 非法入参输出 ' + JSON.stringify(v));
  });
}

/* ==================== 7. 分类占比结论 ==================== */
console.log('7. buildCategoryInsight');
{
  const big = I.buildCategoryInsight([
    { name: '餐饮', cents: 42000, percent: 42 },
    { name: '交通', cents: 38000, percent: 38 },
    { name: '购物', cents: 20000, percent: 20 },
  ]);
  includes(big, '最大开销', '7 占比 ≥30% → 用「是最大开销」');
  includes(big, '餐饮', '7 取第一项（入参已按金额倒序）');
  includes(big, '42%', '7 百分比');
  cleanText(big, '7 高占比结论');

  const small = I.buildCategoryInsight([
    { name: '餐饮', cents: 2700, percent: 27 },
    { name: '交通', cents: 2500, percent: 25 },
    { name: '购物', cents: 2400, percent: 24 },
    { name: '娱乐', cents: 2400, percent: 24 },
  ]);
  excludes(small, '最大开销', '7 占比 <30% → 不说「最大开销」（语气太重）');
  includes(small, '占比最高', '7 占比 <30% → 用「占比最高」');
  includes(small, '27%', '7 低占比仍报百分比');
  cleanText(small, '7 低占比结论');

  // 边界：正好 30% 归到「最大开销」
  includes(I.buildCategoryInsight([{ name: '餐饮', cents: 3000, percent: 30 }]), '最大开销', '7 30% 边界归高档句式');
  includes(I.buildCategoryInsight([{ name: '餐饮', cents: 2999, percent: 29 }]), '占比最高', '7 29% 归低档句式');

  eq(I.buildCategoryInsight([]), '', '7 空数组 → 空串');
  eq(I.buildCategoryInsight(null), '', '7 null → 空串不抛');
  eq(I.buildCategoryInsight([{ name: '其他', cents: 0 }]), '', '7 金额为 0 → 空串（不瞎报 0%）');

  // 缺 percent 时按列表合计现算，不产出 NaN
  const noPct = I.buildCategoryInsight([{ name: '餐饮', cents: 5000 }, { name: '交通', cents: 5000 }]);
  includes(noPct, '50%', '7 缺 percent 时按合计现算');
  cleanText(noPct, '7 缺 percent 结论');

  // 超长分类名（自定义分类）不许把整句挤爆
  const longName = I.buildCategoryInsight([{ name: '家庭日用百货生鲜水果零食', cents: 5000, percent: 80 }]);
  cleanText(longName, '7 超长分类名结论');
  assert(A.textWidthPx(longName, 11) <= NARROW_CONTENT_PX, '7 超长分类名结论仍在窄屏一行内（实际 ' + Math.round(A.textWidthPx(longName, 11)) + 'px）');
}

/* ==================== 8. 同期环比（重点：同期口径） ==================== */
console.log('8. buildMoMCompare');
{
  const down = I.buildMoMCompare(500, 1000);
  eq(down.text, '比上月同期少 50%', '8 本月 500 / 上月同期 1000 → 少 50%');
  eq(down.dir, 'down', '8 少 → dir=down');

  const up = I.buildMoMCompare(1000, 500);
  eq(up.text, '比上月同期多 100%', '8 本月 1000 / 上月同期 500 → 多 100%');
  eq(up.dir, 'up', '8 多 → dir=up');

  const zeroLast = I.buildMoMCompare(500, 0);
  eq(zeroLast.text, '上月同期无支出', '8 上月同期 0 且本月 >0 → 「上月同期无支出」');
  eq(zeroLast.dir, null, '8 「无支出」不带方向');
  excludes(zeroLast.text, '%', '8 「无支出」不许算成百分比');
  excludes(zeroLast.text, 'Infinity', '8 「无支出」不许出现 Infinity');

  const bothZero = I.buildMoMCompare(0, 0);
  eq(bothZero.text, null, '8 上月同期 0 且本月 0 → 不显示');
  eq(bothZero.dir, null, '8 双 0 无方向');

  const equal = I.buildMoMCompare(1000, 1000);
  eq(equal.text, '与上月同期持平', '8 相等 → 持平');
  eq(equal.dir, null, '8 持平无方向');

  // 差异不足 1% 不许出现「多 0%」
  const tiny = I.buildMoMCompare(1001, 1000);
  excludes(tiny.text, '0%', '8 微小差异不报 0%（实际 ' + tiny.text + '）');

  // 非法入参
  [[null, 100], [100, null], [-5, 100], [NaN, NaN], [undefined, undefined]].forEach((args) => {
    let r;
    let threw = false;
    try { r = I.buildMoMCompare(args[0], args[1]); } catch (e) { threw = true; }
    assert(!threw, '8 非法入参不抛：' + JSON.stringify(args));
    if (!threw) {
      eq(r.text, null, '8 非法入参 → text=null：' + JSON.stringify(args));
      eq(r.dir, null, '8 非法入参 → dir=null：' + JSON.stringify(args));
    }
  });

  // 上月天数不够时按该月最后一天封顶（本轮不上界面，但口径必须先钉住）
  eq(I.clampPeriodDay(31, 30), 30, '8 本月 31 号、上月 30 天 → 上月同期只取到 30 号');
  eq(I.clampPeriodDay(10, 31), 10, '8 本月 10 号、上月 31 天 → 只比 1~10 号（不多比）');
  eq(I.clampPeriodDay(31, 28), 28, '8 本月 31 号、上月 28 天（2 月）→ 封顶 28');
  eq(I.clampPeriodDay(0, 30), 0, '8 已过 0 天 → 0（不比）');
  eq(I.clampPeriodDay(10, NaN), 10, '8 上月天数未知 → 按本月天数走，不额外封顶');
}

/* ==================== 9. 长度约束（中文 ≤22 字 / 窄屏一行） ==================== */
console.log('9. 文案长度');
{
  const cases = [
    ['A 分类占比', I.buildCategoryInsight([
      { name: '餐饮', cents: 42000, percent: 42 }, { name: '交通', cents: 38000, percent: 38 },
      { name: '购物', cents: 20000, percent: 20 },
    ])],
    ['B 每日趋势', I.buildDailyInsight(
      Array.from({ length: 30 }, (_, i) => ({ day: i + 1, cents: i === 7 ? 12700 : (i < 10 ? 2000 : 0) })), 10, 11
    )],
    ['C 累计当月', I.buildCumulativeInsight({ totalCents: 123400, elapsedDays: 10, spanDays: 31, isCurrentMonth: true })],
    ['D 12 个月', I.buildMonthlyInsight([12000, 8800, 56000, 3200, 0, 0, 15000, 9900, 4500, 22000, 31000, 18000])],
  ];
  cases.forEach((row) => {
    const label = row[0];
    const s = row[1];
    cleanText(s, '9 ' + label);
    assert(cnCount(s) <= 22, '9 ' + label + ' 中文 ≤22 字（实际 ' + cnCount(s) + ' 字：' + s + '）');
    assert(A.textWidthPx(s, 11) <= NARROW_CONTENT_PX,
      '9 ' + label + ' 11px 字号下宽度 ≤ 窄屏内容区 ' + NARROW_CONTENT_PX + 'px（实际 ' +
      Math.round(A.textWidthPx(s, 11)) + 'px：' + s + '）');
  });

  // 极端数据（万元级 + 长分类名）也不许超宽
  const extreme = [
    I.buildCumulativeInsight({ totalCents: 123456789, elapsedDays: 10, spanDays: 31, isCurrentMonth: true }),
    I.buildMonthlyInsight(new Array(12).fill(123456789)),
  ];
  extreme.forEach((s, i) => {
    cleanText(s, '9 极端数据 ' + i);
    assert(A.textWidthPx(s, 11) <= NARROW_CONTENT_PX,
      '9 极端数据 ' + i + ' 不超宽（实际 ' + Math.round(A.textWidthPx(s, 11)) + 'px：' + s + '）');
  });
}

/* ==================== 10. 无 NaN 全量扫描 ==================== */
console.log('10. 无残次品扫描');
{
  const weird = [null, undefined, NaN, Infinity, -Infinity, '', 'x', 0, -1, {}, [], true, false];
  const out = [];
  weird.forEach((v) => {
    out.push(I.buildCategoryInsight(v));
    out.push(I.buildDailyInsight(v, v, v));
    out.push(I.buildMonthlyInsight(v));
    out.push(I.buildCumulativeInsight(v));
    out.push(I.buildCumulativeInsight({ totalCents: v, elapsedDays: v, spanDays: v, isCurrentMonth: true }));
    out.push(I.formatInsightYuan(v));
    out.push(String(I.forecastCumulative(v, v, v)));
    const mom = I.buildMoMCompare(v, v);
    out.push(mom && mom.text ? mom.text : '');
  });
  let bad = 0;
  out.forEach((s) => {
    if (BAD.test(s)) {
      bad += 1;
      console.error('  FAIL: 扫出残次品 ' + JSON.stringify(s));
    }
  });
  eq(bad, 0, '10 ' + out.length + ' 条输出无 NaN/undefined/Infinity/null');
}

/* ==================== 11. 与既有统计口径同源（不打架） ==================== */
console.log('11. 口径一致性');
{
  const bills = [
    { type: 'expense', amountCents: 2000, categoryId: 'c-food', occurredAt: new Date(2026, 10, 3, 12).getTime() },
    { type: 'expense', amountCents: 12700, categoryId: 'c-food', occurredAt: new Date(2026, 10, 8, 12).getTime() },
  ];
  const today = new Date(2026, 10, 10, 9); // 2026-11-10
  const daily = M.computeDailyExpenseTrend(bills, 2026, 11);
  const avgFromMonth = M.computeDailyAverageExpense(bills, 2026, 11, today);
  const s = I.buildDailyInsight(daily.points, today.getDate(), 11);
  includes(s, I.formatInsightYuan(avgFromMonth),
    '11 每日趋势的「日均」与 Hero mDailyAvg（computeDailyAverageExpense）同口径');
  includes(s, '11/08', '11 峰值日与该月真实最高单日一致');
}

/* ==================== 12. Hero 环比接线（v1.4.6 上界面） ==================== */
console.log('12. Hero 同期环比接线');
{
  const fs = require('fs');
  const ROOT = path.join(__dirname, '..');
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const wxml = read('components/statistics-panel/statistics-panel.wxml');
  const wxss = read('components/statistics-panel/statistics-panel.wxss');
  const cjs = read('components/statistics-panel/statistics-panel.js');

  // 结构：label 与环比同一行，label 仍是纯文本「本月支出」（视觉零变化的前提）
  includes(wxml, '<view class="hero__head">', '12 WXML：月度 Hero 第一行有 flex 容器 .hero__head');
  includes(wxml, '<text class="hero__label">本月支出</text>', '12 WXML：label 文案与标签未被改动');
  includes(wxml, 'class="hero__mom ', '12 WXML：环比文本使用 .hero__mom');
  includes(wxml, 'wx:if="{{momText}}"', '12 WXML：momText 为空时环比不渲染（Hero 保持原样）');
  includes(wxml, '{{isNarrow?\' hero__mom--narrow\':\'\'}}', '12 WXML：窄屏类由 isNarrow 数据驱动');

  // 年度 Hero 不带环比（年度没有「上月同期」这个概念）
  const yearStart = wxml.indexOf('<!-- ================= 年度 =================');
  assert(yearStart > 0, '12 WXML：找到年度区块（切片基准存在）');
  const yearHero = wxml.slice(yearStart);
  excludes(yearHero, 'hero__mom', '12 WXML：年度模式 Hero 不含同期环比');

  // 样式：只加新类，Hero 既有四个类的声明一字不改
  const labelCss = wxss.slice(wxss.indexOf('.hero__label {'), wxss.indexOf('.hero__big {'));
  assert(/font-size:\s*24rpx/.test(labelCss), '12 WXSS：.hero__label 字号仍是 24rpx');
  assert(/color:\s*var\(--text-secondary\)/.test(labelCss), '12 WXSS：.hero__label 颜色仍是 --text-secondary');
  const headCss = wxss.slice(wxss.indexOf('.hero__head {'), wxss.indexOf('.hero__label {'));
  assert(/display:\s*flex/.test(headCss), '12 WXSS：.hero__head 为 flex');
  assert(/align-items:\s*baseline/.test(headCss), '12 WXSS：.hero__head 基线对齐（小字号不抬高行高）');
  assert(/justify-content:\s*space-between/.test(headCss), '12 WXSS：环比贴右（space-between）');
  const momCss = wxss.slice(wxss.indexOf('.hero__mom {'), wxss.indexOf('.hero__mom {') + 200);
  assert(/font-size:\s*11px/.test(momCss), '12 WXSS：.hero__mom 字号 11px（与结论行同档，不用 rpx）');
  // 语义色红线：涨跌不染 --expense / --income（本项目支出绿、收入红，染哪个都传错语义）
  const momBlock = wxss.slice(wxss.indexOf('.hero__mom {'), wxss.indexOf('.hero__mom--narrow'));
  excludes(momBlock, 'var(--expense)', '12 WXSS：环比不使用 --expense（否则「花更多」被染成好事）');
  excludes(momBlock, 'var(--income)', '12 WXSS：环比不使用 --income（否则「花更少」被染成坏事）');
  includes(momBlock, 'var(--text-axis)', '12 WXSS：环比统一中性 --text-axis');

  // 接线：数值来自 buildMoMCompare，同期天数上限来自 clampPeriodDay（口径不许绕过）
  includes(cjs, 'insight.buildMoMCompare(', '12 JS：环比数值由 buildMoMCompare 产出');
  includes(cjs, 'insight.clampPeriodDay(', '12 JS：上月同期按 clampPeriodDay 封顶（28/30 天月不假报 -100%）');
  includes(cjs, 'sumExpenseThroughDay(', '12 JS：两侧累计用同一个「1 日~第 N 日」求和函数');
  eq((cjs.match(/momText/g) || []).length >= 2, true, '12 JS：momText 在 data 默认值与 loadMonth 里都出现（不会残留 undefined）');
}

console.log('\ninsight tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
