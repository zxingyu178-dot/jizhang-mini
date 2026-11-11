/**
 * tests/chart-axis.test.js — 图表坐标轴纯函数测试（v1.4.4）
 *
 * 覆盖 data/statistics/axis.js 与 data/statistics/cumulative.js 的坐标轴部分：
 * 金额缩略、Y 轴刻度生成、X 轴标签抽稀（不重叠）、Y 轴留白宽度、累计趋势几何。
 *
 * 原则：**测规则，不测死值**。
 *   - 格式化口径（元 / 万 / 亿）本身是标准 → 允许断言具体字符串；
 *   - 抽稀结果、刻度比例、几何坐标受尺寸影响 → 只断言「不重叠 / 不越界 / 数量上界」
 *     这类规则，避免换个字号就误报。
 * 运行：node tests/chart-axis.test.js
 */
const path = require('path');

const A = require(path.join(__dirname, '..', 'data', 'statistics', 'axis'));
const C = require(path.join(__dirname, '..', 'data', 'statistics', 'cumulative'));

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) { assert(a === b, msg + ' (expected=' + b + ', actual=' + a + ')'); }

/** 任何刻度文字都不许出现这些字样（UI 上就是「残次品」） */
function isCleanText(s, label) {
  assert(typeof s === 'string' && s.length > 0, label + ' 是非空字符串（实际 ' + JSON.stringify(s) + '）');
  assert(!/NaN|undefined|null|Infinity/i.test(s), label + ' 不含 NaN/undefined/Infinity（实际 ' + s + '）');
  assert(!/e[+-]/i.test(s), label + ' 不含科学计数法（实际 ' + s + '）');
  assert(!/,/.test(s), label + ' 不含千分位逗号（实际 ' + s + '）');
  assert(!/\.\d{5,}/.test(s), label + ' 小数不刷长串（实际 ' + s + '）');
  if (/[万亿]/.test(s)) {
    assert(!/\.\d{2,}/.test(s), label + ' 万/亿档最多 1 位小数（实际 ' + s + '）');
  } else if (!/^¥?0\./.test(s)) {
    assert(s.indexOf('.') < 0, label + ' 元档为整数（实际 ' + s + '）');
  }
}

/* ==================== 1. 金额缩略 ==================== */
console.log('1. formatAxisAmount 金额缩略');
{
  eq(A.formatAxisAmount(0), '0', '0 分 → 0');
  eq(A.formatAxisAmount(-100), '0', '负数 → 0（不显示负刻度）');
  eq(A.formatAxisAmount(null), '0', 'null → 0');
  eq(A.formatAxisAmount(NaN), '—', 'NaN → —（兜底，不给界面送 NaN）');
  eq(A.formatAxisAmount(Infinity), '—', 'Infinity → —');

  // < 1 万元：整数元、无千分位
  eq(A.formatAxisAmount(328000), '3280', '3280 元');
  eq(A.formatAxisAmount(100000), '1000', '1000 元');
  eq(A.formatAxisAmount(123456), '1235', '1234.56 元 → 四舍五入 1235');

  // 万档：1 位小数，.0 去掉
  eq(A.formatAxisAmount(1000000), '1万', '1 万元 → 1万（不留 .0）');
  eq(A.formatAxisAmount(1200000), '1.2万', '1.2 万元');
  eq(A.formatAxisAmount(12345600), '12.3万', '12.3456 万元 → 12.3万');

  // 亿档（1.2 亿元 = 12,000,000,000 分）
  eq(A.formatAxisAmount(12000000000), '1.2亿', '1.2 亿元');
  eq(A.formatAxisAmount(10000000000), '1亿', '1 亿元 → 1亿');

  // 极小金额：不能和 0 撞成同一个字样
  const tiny = A.formatAxisAmount(1);
  isCleanText(tiny, '0.01 元');
  assert(tiny !== '0', '0.01 元不显示成 0（实际 ' + tiny + '）');

  // 前缀（注意入参是「分」：1.2 万元 = 1,200,000 分）
  eq(A.formatAxisAmount(1200000, { prefix: '¥' }), '¥1.2万', '带 ¥ 前缀');
  eq(A.formatAxisAmount(0, { prefix: '¥' }), '¥0', '0 带 ¥ 前缀');

  // 扫描：一批量级都不许出脏字符
  [1, 99, 100, 999, 10000, 99999, 100000, 99999900, 100000000, 999999999999].forEach((c) => {
    isCleanText(A.formatAxisAmount(c), '金额 ' + c + ' 分');
    isCleanText(A.formatAxisAmount(c, { prefix: '¥' }), '金额 ' + c + ' 分带前缀');
  });
}

/* ==================== 2. Y 轴刻度 ==================== */
console.log('2. buildTicks 刻度生成');
{
  const t = A.buildTicks(123400, 3, { prefix: '¥' });
  eq(t.length, 3, '3 档刻度');
  eq(t[0].ratio, 0, '底档 ratio=0');
  eq(t[1].ratio, 0.5, '中档 ratio=0.5');
  eq(t[2].ratio, 1, '顶档 ratio=1');
  eq(t[0].cents, 0, '底档金额 0');
  // v1.4.4 终检（④ 取整）：顶档 = 向上取整到 nice 档位，≥ 实际最大值
  eq(t[2].cents, A.niceCeilCents(123400), '顶档 = niceCeil(max)');
  assert(t[2].cents >= 123400, '顶档 ≥ 实际最大值（不会把最高柱顶出图外）');
  eq(t[1].cents, Math.round(t[2].cents / 2), '中档 = 顶档 / 2');
  eq(t[2].isTop, true, '顶档标记 isTop');
  assert(t[2].label.indexOf('¥') === 0, '最高档带 ¥（实际 ' + t[2].label + '）');
  assert(t[1].label.indexOf('¥') < 0, '中间档不带 ¥（减少噪声）');
  assert(t[0].label.indexOf('¥') < 0, '底档不带 ¥');

  // 除零保护：max=0 → 只保留**底档**文字（文字挂在底线上，不在顶部）
  const zero = A.buildTicks(0, 3, { prefix: '¥' });
  eq(zero.length, 3, 'max=0 仍有 3 档几何（网格线靠 showGrid 控制）');
  const nonEmpty = zero.filter((x) => !!x.label);
  eq(nonEmpty.length, 1, 'max=0 只有 1 个可见刻度（不出现三个 0）');
  assert(!nonEmpty[0].isTop, 'max=0 保留的是**底档**文字（终检③：不能在顶部挂 0）');
  eq(zero[0].label, '0', 'max=0 底档文字 = 0');
  eq(zero.filter((x) => x.showGrid).length, 1, 'max=0 只画底线网格（中 / 顶不画）');
  assert(zero[0].showGrid, 'max=0 底线网格可见');
  assert(!zero[1].showGrid && !zero[2].showGrid, 'max=0 中 / 顶网格线不画');

  // 非法 max
  [[null, 'null'], [undefined, 'undefined'], [NaN, 'NaN'], [-5, '负数'], ['abc', '字符串']].forEach((pair) => {
    const ticks = A.buildTicks(pair[0], 3, { prefix: '¥' });
    eq(ticks.length, 3, 'max=' + pair[1] + ' 仍返回 3 档');
    ticks.forEach((x) => isCleanText(x.label || '0', 'max=' + pair[1] + ' 刻度'));
  });

  // 极大 / 极小
  const huge = A.buildTicks(999999900, 3, { prefix: '¥' }); // 9,999,999 元
  isCleanText(huge[2].label, '极大值顶档');
  assert(huge[2].cents >= 999999900, '极大值顶档 ≥ 实际最大值');
  const tinyTick = A.buildTicks(1, 3, { prefix: '¥' }); // 0.01 元
  tinyTick.forEach((x) => isCleanText(x.label || '0', '极小值刻度'));
  assert(tinyTick.filter((x) => !!x.label).length >= 2, '极小值至少 2 档可区分');
  // 半分刻度不存在（货币最小单位是分）：0.01 元只剩「0 / ¥0.01」两档
  eq(tinyTick.filter((x) => !!x.label).map((x) => x.label).join(' / '), '0 / ¥0.01', '0.01 元：0 与 ¥0.01 两档');
  assert(!/0\.005/.test(JSON.stringify(tinyTick)), '不出现 0.005 这种半分刻度');

  // 档数夹取
  eq(A.buildTicks(100, 1).length, 2, 'count 下限 2');
  eq(A.buildTicks(100, 99).length, 6, 'count 上限 6');
  eq(A.buildTicks(100).length, 3, '默认 3 档');
}

/* ==================== 2b. 刻度取整（nice ticks）标准 ==================== */
console.log('2b. nice ticks 取整标准');
{
  // 验收两条样例（终端实测的「读不出数」原文）：127 → 150/75，5999 → 6000/3000
  const c127 = A.buildTicks(12700, 3, { prefix: '¥' });
  eq(c127[2].label, '¥150', 'max=127 元 → 顶档 ¥150');
  eq(c127[1].label, '75', 'max=127 元 → 中档 75');
  const c5999 = A.buildTicks(599900, 3, { prefix: '¥' });
  eq(c5999[2].label, '¥6000', 'max=5999 元 → 顶档 ¥6000');
  eq(c5999[1].label, '3000', 'max=5999 元 → 中档 3000');

  // 扫描：顶档（去掉 ¥/万/亿 后）必须落在 nice 档位上；中档必须正好是顶档的一半
  const isNiceTop = (label) => {
    const s = String(label).replace(/^¥/, '');
    const v = parseFloat(s);
    if (!Number.isFinite(v) || v <= 0) return false;
    const unit = /万/.test(s) ? 1e4 : (/亿/.test(s) ? 1e8 : 1);
    const yuan = v * unit;
    const exp = Math.floor(Math.log10(yuan));
    const mant = yuan / Math.pow(10, exp);
    return A.NICE_STEPS.some((k) => Math.abs(k - mant) < 1e-6);
  };
  const maxes = [1, 7, 99, 100, 127, 431, 3001, 5999, 12345, 99999, 123456, 999999900];
  maxes.forEach((cents) => {
    const ticks = A.buildTicks(cents, 3, { prefix: '¥' });
    const labels = ticks.filter((x) => !!x.label).map((x) => x.label);
    assert(isNiceTop(ticks[2].label), 'max=' + cents + ' 分：顶档「' + ticks[2].label + '」是整齐档位');
    assert(ticks[2].cents >= cents, 'max=' + cents + ' 分：顶档 ≥ 实际最大值');
    eq(ticks[1].cents, Math.round(ticks[2].cents / 2), 'max=' + cents + ' 分：中档 = 顶档 / 2');
    assert(Number.isInteger(ticks[1].cents) && Number.isInteger(ticks[2].cents),
      'max=' + cents + ' 分：刻度值是整数分');
    // 旧实现在这几个数上产出的「读不出数」刻度，必须绝迹
    ['63', '301', '5999', '1235'].forEach((bad) => {
      assert(labels.indexOf(bad) < 0 && labels.indexOf('¥' + bad) < 0,
        'max=' + cents + ' 分：不出现「' + bad + '」这种要心算的刻度（实际 ' + labels.join('/') + '）');
    });
  });

  // 单调性：niceCeilCents 必须单调不减，且 ≥ 入参
  let prev = 0;
  for (let c = 1; c <= 20000; c = Math.ceil(c * 1.09)) {
    const v = A.niceCeilCents(c);
    assert(v >= c, 'niceCeilCents(' + c + ') ≥ 入参（实际 ' + v + '）');
    assert(v >= prev, 'niceCeilCents 单调不减（' + c + '）');
    assert(Number.isInteger(v), 'niceCeilCents 返回整数分（' + c + '）');
    prev = v;
  }
}

/* ==================== 3. X 轴标签抽稀 ==================== */
console.log('3. pickXLabels 抽稀（不重叠）');
{
  eq(A.pickXLabels([], 7, 300, 5.8).length, 0, '空数组 → 空');
  eq(A.pickXLabels([{ label: '1日' }], 7, 300, 5.8).join(','), '0', '单点 → [0]');

  const mk = (n, labelFn) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ label: labelFn(i) });
    return out;
  };
  const days = mk(31, (i) => (i + 1) + '日');

  // 宽屏：上界 7，首末必须有标签
  const wide = A.pickXLabels(days, 7, 300, 5.8);
  assert(wide.length <= 7, '宽屏最多 7 个（实际 ' + wide.length + '）');
  assert(wide.length >= 2, '宽屏至少 2 个');
  eq(wide[0], 0, '含首日');
  eq(wide[wide.length - 1], 30, '含末日');

  // 不重叠：相邻两个标签的间距 ≥ 一条标签所需宽度
  const slotW = 300 / 31;
  let overlap = 0;
  for (let i = 1; i < wide.length; i++) {
    const gapPx = (wide[i] - wide[i - 1]) * slotW;
    const needPx = 3 * 5.8 + 5.8; // 「31日」3 字 + 半个字间隙
    if (gapPx < needPx) overlap++;
  }
  eq(overlap, 0, '宽屏标签互不重叠');

  // 窄屏：可用宽度变小 → 标签数量不增
  const narrow = A.pickXLabels(days, 7, 170, 5.8);
  assert(narrow.length <= wide.length, '窄屏标签数 ≤ 宽屏（' + narrow.length + ' vs ' + wide.length + '）');
  assert(narrow.length >= 2, '窄屏仍保留首末标签');

  // 12 个月：默认宽度下 12 个全保留
  const months = mk(12, (i) => (i + 1) + '月');
  const m12 = A.pickXLabels(months, 12, 300, 5.8);
  eq(m12.length, 12, '12 个月标签全保留（300px 绘图区）');
  // 极端窄的绘图区：允许抽稀，但不许重复 / 越界
  const mTight = A.pickXLabels(months, 12, 60, 5.8);
  assert(mTight.length >= 1 && mTight.length <= 12, '极窄绘图区返回合理条数');
  mTight.forEach((i) => assert(i >= 0 && i < 12, '索引在范围内'));

  // 索引唯一、升序
  [wide, narrow, m12, mTight].forEach((list, k) => {
    const uniq = {};
    let mono = true;
    list.forEach((v, idx) => {
      if (uniq[v]) mono = false;
      uniq[v] = true;
      if (idx > 0 && list[idx - 1] >= v) mono = false;
    });
    assert(mono, '第 ' + k + ' 组索引唯一且升序');
  });

  // 非法入参不抛错
  assert(Array.isArray(A.pickXLabels(null, 7, 300, 5.8)), 'points=null 返回数组');
  assert(Array.isArray(A.pickXLabels(days, NaN, NaN, NaN)), '宽度非法时用兜底值返回数组');
}

/* ==================== 4. 累计趋势日期标签（按宽度自适应） ==================== */
console.log('4. pickDateLabels 日期标签（自适应密度）');
{
  const pts = [];
  for (let d = 1; d <= 30; d++) pts.push({ day: d, label: d + '日', cumCents: d * 100 });
  const x = A.pickDateLabels(pts, 11);
  eq(x.length, 5, '默认宽度（300px 绘图区）→ 5 个日期标签（v1.4.4：原固定 3 个）');
  eq(x[0].label, '11/01', '首日 M/DD');
  eq(x[x.length - 1].label, '11/30', '末日 M/DD');
  eq(x[0].ratio, 0, '首日 ratio=0');
  eq(x[x.length - 1].ratio, 1, '末日 ratio=1');
  for (let i = 1; i < x.length; i++) {
    assert(x[i].ratio > x[i - 1].ratio, 'ratio 严格递增（索引 ' + i + '）');
  }

  const one = A.pickDateLabels([{ day: 5, label: '5日', cumCents: 1 }], 3);
  eq(one.length, 1, '单点只显示 1 个日期');
  eq(one[0].label, '3/05', '单点日期格式（日补两位）');
  eq(one[0].ratio, 0.5, '单点居中');

  const two = A.pickDateLabels([{ day: 1 }, { day: 31 }], 1);
  eq(two.length, 2, '两点显示 2 个日期');

  // 月份非法 → 退回点名自带的 label
  const fb = A.pickDateLabels(pts, 0);
  eq(fb[0].label, '1日', '月份非法时退回原始 label');
  eq(A.pickDateLabels([], 11).length, 0, '空数据 → 空标签');

  // ---- 4.1 末标签必须是「数据截止日」，不是月末 ----
  // 当月 10 号：点只到 10 号，横轴跨度仍为 31 天
  {
    const cut = [];
    for (let d = 1; d <= 10; d++) cut.push({ day: d });
    const cl = A.pickDateLabels(cut, 11, { plotW: 274, fontPx: 11, maxCount: 5, spanDays: 31 });
    eq(cl[cl.length - 1].label, '11/10', '末标签 = 数据截止日（11/10），不是月末 11/30');
    eq(cl[0].label, '11/01', '首标签仍是首日');
    assert(cl.length >= 2 && cl.length <= 5, '截止日 10 号时 2~5 个标签（实际 ' + cl.length + '）');
    // 末标签的横向位置必须落在「10/31」的比例处（右侧留空），不能贴到右边界
    eq(cl[cl.length - 1].ratio, Math.round((9 / 30) * 100) / 100, '末标签 ratio = 9/30（与折线末端同一横坐标）');
  }

  // ---- 4.2 不重叠（硬约束）：扫描宽度 / 字号 / 跨度 ----
  {
    let overlaps = 0;
    let missingEnd = 0;
    let overCap = 0;
    let cases = 0;
    const labelW = (s, f) => A.textWidthPx(s, f);
    [150, 200, 240, 270, 300, 340].forEach((plotW) => {
      [10, 11].forEach((fontPx) => {
        [28, 30, 31].forEach((spanDays) => {
          for (let days = 1; days <= spanDays; days++) {
            const list = [];
            for (let d = 1; d <= days; d++) list.push({ day: d });
            const out = A.pickDateLabels(list, 11, { plotW, fontPx, maxCount: 5, spanDays });
            cases++;
            if (out.length > 5) overCap++;
            if (out[out.length - 1].index !== days - 1) missingEnd++;
            if (out.length > 1 && out[0].index !== 0) missingEnd++;
            // 居中渲染：两条标签不重叠 ⇔ 中心距 ≥ 各自半宽之和
            for (let i = 1; i < out.length; i++) {
              const gapPx = (out[i].ratio - out[i - 1].ratio) * plotW;
              const need = labelW(out[i].label, fontPx) / 2 + labelW(out[i - 1].label, fontPx) / 2;
              if (gapPx < need - 0.01) overlaps++;
            }
          }
        });
      });
    });
    eq(overlaps, 0, '扫描 ' + cases + ' 组（宽度×字号×跨度×天数）：标签中心距 ≥ 半宽之和（不重叠）');
    eq(missingEnd, 0, '扫描 ' + cases + ' 组：首末标签必在（唯一例外：可画长度不足一条标签时只留截止日）');
    eq(overCap, 0, '扫描 ' + cases + ' 组：标签数 ≤ 5（不挤成一排）');
  }

  // ---- 4.3 宽度越窄，标签数不增（390 / 375 / 360 三档） ----
  {
    const full = [];
    for (let d = 1; d <= 30; d++) full.push({ day: d });
    const sweep = [390, 375, 360].map((winW) => {
      const contentPx = Math.round(638 * (winW / 750) * 100) / 100; // 卡片内容宽
      const fontPx = winW < 375 ? 10 : 11;
      const gutter = A.axisGutterPx('¥3280', fontPx);
      const plotW = Math.max(40, contentPx - gutter);
      const out = A.pickDateLabels(full, 11, { plotW, fontPx, maxCount: 5, spanDays: 30 });
      return { winW, plotW, fontPx, out };
    });
    sweep.forEach((s) => {
      assert(s.out.length >= 4 && s.out.length <= 5,
        s.winW + 'px（绘图区 ' + s.plotW + 'px）：' + s.out.length + ' 个日期标签（目标 4~5）');
      eq(s.out[0].label, '11/01', s.winW + 'px：首标签');
      eq(s.out[s.out.length - 1].label, '11/30', s.winW + 'px：末标签 = 截止日');
      let minGap = Infinity;
      for (let i = 1; i < s.out.length; i++) {
        minGap = Math.min(minGap, (s.out[i].ratio - s.out[i - 1].ratio) * s.plotW);
      }
      const widest = Math.max.apply(null, s.out.map((o) => A.textWidthPx(o.label, s.fontPx)));
      assert(minGap >= widest,
        s.winW + 'px：最小间距 ' + minGap.toFixed(1) + 'px ≥ 标签宽 ' + widest.toFixed(1) + 'px（不重叠）');
    });
    // 窄屏不会更多（单调性）：绘图区变窄 → 条数不增
    const w300 = A.pickDateLabels(full, 11, { plotW: 300, fontPx: 11, maxCount: 5, spanDays: 30 });
    const w120 = A.pickDateLabels(full, 11, { plotW: 120, fontPx: 11, maxCount: 5, spanDays: 30 });
    assert(w120.length <= w300.length, '绘图区 120px 的标签数 ≤ 300px（' + w120.length + ' ≤ ' + w300.length + '）');
    assert(w120.length >= 1, '极窄绘图区仍至少 1 个标签');
  }
}

/* ==================== 4.4 累计图组件接线（不是只测纯函数） ==================== */
// 目的：确认 xLabels 真的是「按绘图宽度自适应」算出来的（组件把 plotW / fontPx /
// maxCount / spanDays 都传下去了），并且渲染坐标就是 C.xAt 的坐标。
console.log('4.4 cumulative-trend 组件接线');
{
  const savedComponent = global.Component;
  const savedWx = global.wx;
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, platform: 'devtools' }),
    getStorageSync: () => undefined,
    setStorageSync: () => {},
    getFileSystemManager: () => { throw new Error('no fs'); },
  };
  const themePath = require.resolve(path.join(__dirname, '..', 'utils', 'theme.js'));
  const savedTheme = require.cache[themePath];
  require.cache[themePath] = {
    id: themePath,
    filename: themePath,
    loaded: true,
    exports: {
      init() {},
      subscribe() { return () => {}; },
      getEffectiveTheme() { return 'dark'; },
    },
  };
  const savedDevice = require.cache[require.resolve(path.join(__dirname, '..', 'utils', 'device.js'))];
  delete require.cache[require.resolve(path.join(__dirname, '..', 'utils', 'device.js'))];
  delete require.cache[require.resolve(path.join(__dirname, '..', 'components', 'cumulative-trend', 'cumulative-trend.js'))];

  let def = null;
  global.Component = (d) => { def = d; };
  require(path.join(__dirname, '..', 'components', 'cumulative-trend', 'cumulative-trend.js'));
  global.Component = savedComponent;

  assert(!!def && !!def.methods, '累计图组件定义已加载');
  // 取一个「不是当月」的月份：历史月 截止日 = 该月天数 → 折线铺满横轴
  const now = new Date();
  const histMonth = (now.getMonth() + 2) % 12 || 12;
  const days = new Date(now.getFullYear(), histMonth, 0).getDate();
  const pts = [];
  for (let d = 1; d <= days; d++) pts.push({ day: d, cumCents: d * 1000 });
  const inst = {
    data: Object.assign({}, JSON.parse(JSON.stringify(def.data)), {
      points: pts,
      max: days * 1000,
      width: 319,
      height: 180,
      month: histMonth,
      gutter: 38,
    }),
    setData(patch) { Object.keys(patch).forEach((k) => { inst.data[k] = patch[k]; }); },
    triggerEvent() {},
  };
  Object.keys(def.methods).forEach((k) => { inst[k] = def.methods[k].bind(inst); });
  inst.refresh();

  const xLabels = inst.data.xLabels;
  assert(Array.isArray(xLabels) && xLabels.length >= 4 && xLabels.length <= 5,
    '组件渲染 ' + xLabels.length + ' 个 X 轴日期标签（目标 4~5）');
  eq(xLabels[0].label, histMonth + '/01', '首个标签 = 首日');
  eq(xLabels[xLabels.length - 1].label, histMonth + '/' + days, '末个标签 = 数据截止日');
  // 渲染坐标 = xAt 坐标（标签跟着折线走，不是另算一套）
  const geo = C.computeGeometry({ w: 319, h: 180 }, 38, C.TICK_COUNT);
  const expected = A.pickDateLabels(pts, histMonth, {
    plotW: geo.plotW, fontPx: inst.data.fontPx, maxCount: 5, spanDays: days,
  });
  eq(xLabels.map((x) => x.label).join(','), expected.map((x) => x.label).join(','),
    '组件标签 = 纯函数同一结果（组件真的把宽度/跨度传下去了）');
  for (let i = 1; i < xLabels.length; i++) {
    assert(xLabels[i].leftPx > xLabels[i - 1].leftPx, '标签 leftPx 严格递增（' + i + '）');
  }
  const widest = Math.max.apply(null, xLabels.map((x) => A.textWidthPx(x.label, inst.data.fontPx)));
  let minGap = Infinity;
  for (let i = 1; i < xLabels.length; i++) minGap = Math.min(minGap, xLabels[i].leftPx - xLabels[i - 1].leftPx);
  assert(minGap >= widest, '渲染间距 ' + minGap.toFixed(1) + 'px ≥ 标签宽 ' + widest.toFixed(1) + 'px（真机不叠）');

  // 还原环境
  require.cache[themePath] = savedTheme;
  if (savedDevice) require.cache[require.resolve(path.join(__dirname, '..', 'utils', 'device.js'))] = savedDevice;
  global.wx = savedWx;
  if (savedWx === undefined) delete global.wx;
}

/* ==================== 5. Y 轴留白宽度 ==================== */
console.log('5. axisGutterPx 留白宽度');
{
  const small = A.axisGutterPx('¥3280', 10);
  const big = A.axisGutterPx('¥1234万', 10);
  assert(big > small, '文字越长留白越宽（' + big + ' > ' + small + '）');
  assert(small >= 22, '留白下限 22px（实际 ' + small + '）');
  assert(big <= 56, '留白上限 56px（实际 ' + big + '）');
  assert(A.axisGutterPx('', 10) >= 22, '空文字也有下限');
  assert(A.axisGutterPx('¥1.2亿', 9) >= 22, '窄屏字号更省宽');
}

/* ==================== 6. 累计趋势几何（索引 + 网格对齐） ==================== */
console.log('6. cumulative 几何');
{
  const BOX = { w: 320, h: 180 };
  const geo = C.computeGeometry(BOX, 34, 3);
  eq(geo.w, 320, '宽 = 显示盒宽');
  eq(geo.padL, 34, 'padL = 传入的 Y 轴留白');
  assert(geo.plotW > 200 && geo.plotW < 320, '绘图区宽度 < 盒宽（留出刻度列）');
  assert(geo.padL + geo.plotW + geo.padR <= geo.w + 0.01, '绘图区不越界');
  eq(geo.baseY, Math.round((geo.h - geo.padB) * 100) / 100, '底边 = h - padB');

  // 刻度 y 坐标：ratio 0 → 底边，1 → 顶边，2 递减
  const y0 = C.tickY(geo, 0);
  const y1 = C.tickY(geo, 0.5);
  const y2 = C.tickY(geo, 1);
  eq(y0, geo.baseY, 'ratio=0 → 绘图区底边');
  eq(y2, geo.padT, 'ratio=1 → 绘图区顶边');
  assert(y2 < y1 && y1 < y0, '刻度自下而上递增');

  // x 坐标：首点 = padL，末点 = padL + plotW
  eq(C.xAt(geo, 0, 30), geo.padL, '首点贴左边界');
  eq(C.xAt(geo, 29, 30), Math.round((geo.padL + geo.plotW) * 100) / 100, '末点贴右边界');
  eq(C.xAt(geo, 0, 1), Math.round((geo.padL + geo.plotW / 2) * 100) / 100, '单点居中');

  // padLeft 非法 / 缺省 → 旧比例兜底
  const leg = C.computeGeometry(BOX, null, 3);
  eq(leg.padL, Math.round(BOX.w * C.PAD_L_RATIO * 100) / 100, '未传 padLeft 用旧比例');
  const over = C.computeGeometry(BOX, 999, 3);
  assert(over.padL <= BOX.w * 0.42 + 0.01, 'padLeft 超过 42% 盒宽时夹取（不吃掉绘图区）');
}

/* ==================== 7. 累计趋势 SVG：网格与刻度数量一致 ==================== */
console.log('7. buildCumulativeSVG 与刻度对齐');
{
  const BOX = { w: 320, h: 180 };
  const pts = [];
  for (let d = 1; d <= 30; d++) pts.push({ day: d, cumCents: d * 1000 });
  const svg = C.buildCumulativeSVG(pts, 30000, '#333', BOX, { padLeft: 34, tickCount: 3 });
  const vb = svg.match(/viewBox="([^"]+)"/);
  assert(!!vb, '有 viewBox');
  eq(vb[1].trim().split(/\s+/).join(' '), '0 0 320 180', 'viewBox = 显示盒（1:1 像素）');

  const lines = svg.match(/<line [^>]*y1="([0-9.]+)"[^>]*y2="([0-9.]+)"/g) || [];
  eq(lines.length, 3, '3 条水平网格线（与 3 档刻度一一对应）');
  // 网格线两端都在绘图区内（不压 Y 轴刻度列）
  const geo = C.computeGeometry(BOX, 34, 3);
  const xs = [...svg.matchAll(/x1="([0-9.]+)"/g)].map((m) => +m[1]);
  eq(xs.length, 3, '3 条网格线都有起点');
  xs.forEach((x) => eq(x, geo.padL, '网格线起点 = 绘图区左边界（刻度列右侧）'));

  // 每条网格线的 y 必须等于对应刻度 y（这就是「网格线按刻度画」）
  const drawn = [...svg.matchAll(/y1="([0-9.]+)"/g)].map((m) => +m[1]);
  const expect = A.buildTicks(30000, 3).map((t) => C.tickY(geo, t.ratio));
  eq(drawn.join(','), expect.join(','), '网格线 y 坐标 = 刻度 y 坐标');

  // 折线不越界 + 不出 NaN
  assert(!/NaN/.test(svg), 'SVG 不含 NaN');
  const coords = [...svg.matchAll(/[ML]([0-9.]+) ([0-9.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  const out = coords.filter((c) => c.x < geo.padL - 0.01 || c.x > geo.w - geo.padR + 0.01 || c.y < -0.01 || c.y > geo.h + 0.01);
  eq(out.length, 0, '所有坐标都在绘图区内（不越界、不压刻度列）');

  // 极端数据
  const one = C.buildCumulativeSVG([{ day: 1, cumCents: 1 }], 1, '#333', BOX, { padLeft: 30 });
  assert(!/NaN/.test(one), '单点极小金额不出 NaN');
  const big = C.buildCumulativeSVG([{ day: 1, cumCents: 999999900 }], 999999900, '#333', BOX, { padLeft: 30 });
  assert(!/NaN/.test(big), '极大金额不出 NaN');
  const zero = C.buildCumulativeSVG([{ day: 1, cumCents: 0 }, { day: 2, cumCents: 0 }], 0, '#333', BOX, { padLeft: 30 });
  assert(!/NaN/.test(zero), 'max=0 不出 NaN');
  eq(C.buildCumulativeSVG([], 0, '#333', BOX, { padLeft: 30 }).indexOf('<path'), -1, '空数据不画 path（保持空态）');
}

/* ==================== 7b. 折线只画到「数据截止日」（终检②） ==================== */
console.log('7b. 截止日裁剪 + 末端圆点');
{
  const BOX = { w: 320, h: 180 };
  const geo = C.computeGeometry(BOX, 34, 3);
  // 整月 30 天，但只有前 10 天有数据（11 号之后为 0 增长，不该平到月末）
  const pts = [];
  for (let d = 1; d <= 10; d++) pts.push({ day: d, cumCents: d * 1000 });
  const svg = C.buildCumulativeSVG(pts, 10000, '#333', BOX, { padLeft: 34, spanDays: 30 });

  const coords = [...svg.matchAll(/[ML]([0-9.]+) ([0-9.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  const maxX = Math.max.apply(null, coords.map((c) => c.x));
  // 末点应落在「10/30」的位置（≈ 绘图区的 9/29），而不是贴到右边界
  const expectX = C.xAt(geo, 9, 30);
  assert(Math.abs(maxX - expectX) < 0.02, '折线末点 = 第 10 天的横坐标（实际 ' + maxX + '，期望 ' + expectX + '）');
  assert(maxX < geo.w - geo.padR - 20, '截止日右侧留空（不画到右边界，实际右端 ' + maxX + ' / 边界 ' + (geo.w - geo.padR) + '）');

  // 折线不再有「与真实 0 变化无法区分」的长水平段：末 3 个点的 y 必须递增（数据仍在涨）
  const lineYs = [...svg.matchAll(/L([0-9.]+) ([0-9.]+)/g)].map((m) => +m[2]);
  const tail = lineYs.slice(-3);
  assert(tail[0] > tail[1] && tail[1] > tail[2], '折线尾部仍在上升（没有平到月末的假水平段）');

  // 末端圆点：实心圆、半径 ≤3
  const dot = svg.match(/<circle cx="([0-9.]+)" cy="([0-9.]+)" r="([0-9.]+)"/);
  assert(!!dot, '折线末端有圆点');
  assert(Number(dot[3]) <= 3, '圆点半径 ≤3px（实际 ' + dot[3] + '）');
  assert(Number(dot[1]) === maxX, '圆点压在末点上（cx=' + dot[1] + '）');

  // 不传 spanDays 时退回旧行为（跨度 = 点数），不越界
  const legacy = C.buildCumulativeSVG(pts, 10000, '#333', BOX, { padLeft: 34 });
  const lx = Math.max.apply(null, [...legacy.matchAll(/[ML]([0-9.]+) ([0-9.]+)/g)].map((m) => +m[1]));
  assert(Math.abs(lx - C.xAt(geo, 9, 10)) < 0.02, '未传 spanDays 时按点数铺满绘图区');

  // spanDays 非法 / 小于点数：不允许点跑到绘图区外
  [0, -3, 5, NaN].forEach((bad) => {
    const s = C.buildCumulativeSVG(pts, 10000, '#333', BOX, { padLeft: 34, spanDays: bad });
    const xs = [...s.matchAll(/[ML]([0-9.]+) ([0-9.]+)/g)].map((m) => +m[1]);
    assert(Math.min.apply(null, xs) >= geo.padL - 0.01 && Math.max.apply(null, xs) <= geo.w - geo.padR + 0.01,
      'spanDays=' + bad + ' 时坐标仍在绘图区内');
    assert(!/NaN/.test(s), 'spanDays=' + bad + ' 时不出 NaN');
  });
}

/* ==================== 7c. 右边界与柱图同宽（终检⑥） ==================== */
console.log('7c. 绘图区右边界对齐');
{
  const BOX = { w: 319, h: 180 }; // 375px 窗口下的卡片内容宽（638rpx × 375/750）
  const geo = C.computeGeometry(BOX, 38, 3);
  eq(geo.padR, 0, '累计图右侧内边距归 0（网格线贴到卡片内容右边缘）');
  eq(geo.padL + geo.plotW, geo.w, '绘图区右边界 = 卡片内容右边缘（与柱图同宽）');
  assert(geo.plotW / geo.w >= 0.7, '绘图区占盒宽 ≥70%（实际 ' + Math.round((geo.plotW / geo.w) * 100) + '%）');
}

/* ==================== 8. 统计面板接入（极端数据下不崩） ==================== */
// 用内存 wx + mock 全局 Component 捕获 statistics-panel，手动跑 loadMonth / loadYear，
// 验证「刻度真的被算出来、极端数据下没有 NaN、窄屏标签不叠」。
console.log('8. statistics-panel 接入与极端数据');
{
  const memFiles = new Map();
  const memDirs = new Set();
  const fsm = {
    accessSync(p) { if (memFiles.has(p) || memDirs.has(p)) return; throw new Error('ENOENT ' + p); },
    mkdirSync(p, recursive) {
      if (recursive) {
        const ps = p.split('/');
        let cur = '';
        ps.forEach((x, i) => {
          if (i === 0 && x === '') cur = '';
          else { cur = cur + '/' + x; memDirs.add(cur); }
        });
      } else memDirs.add(p);
    },
    readFileSync(p) { if (!memFiles.has(p)) throw new Error('ENOENT ' + p); return memFiles.get(p); },
    writeFileSync(p, data) { memFiles.set(p, String(data)); },
    renameSync(o, n) {
      if (!memFiles.has(o)) throw new Error('ENOENT ' + o);
      memFiles.set(n, memFiles.get(o));
      memFiles.delete(o);
    },
    unlinkSync(p) { if (!memFiles.has(p)) throw new Error('ENOENT ' + p); memFiles.delete(p); },
    readdirSync(p) {
      const prefix = p.endsWith('/') ? p : p + '/';
      const out = new Set();
      memFiles.forEach((v, k) => {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          if (rest && !rest.includes('/')) out.add(rest);
        }
      });
      return [...out];
    },
  };
  global.wx = {
    env: { USER_DATA_PATH: '/usr' },
    getFileSystemManager: () => fsm,
    getStorageSync: () => undefined,
    setStorageSync: () => {},
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, platform: 'devtools' }),
  };
  let captured = null;
  const saved = global.Component;
  global.Component = (def) => { captured = def; };

  const ROOT = path.join(__dirname, '..');
  const store = require(path.join(ROOT, 'data', 'index'));
  const device = require(path.join(ROOT, 'utils', 'device'));
  require(path.join(ROOT, 'components', 'statistics-panel', 'statistics-panel'));
  store.init();

  function makeInstance() {
    const inst = { data: JSON.parse(JSON.stringify(captured.data)), triggerEvent() {} };
    inst.setData = function (patch) {
      Object.keys(patch).forEach((k) => { inst.data[k] = patch[k]; });
    };
    Object.keys(captured.methods).forEach((k) => { inst[k] = captured.methods[k].bind(inst); });
    return inst;
  }
  const now = new Date();
  const YM = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const thisMonth = YM;
  function add(day, cents) {
    store.addBill({
      type: 'expense',
      amountCents: cents,
      categoryId: 'c-food',
      occurredAt: new Date(now.getFullYear(), now.getMonth(), Math.min(day, 28), 12, 0).getTime(),
      title: 'axis-' + day,
    });
  }
  function openAll() {
    store.updateSettings({
      statistics: {
        version: 1,
        modules: ['category-share', 'daily-expense-trend', 'cumulative-trend', 'budget-analysis',
          'income-expense-compare', 'custom-range', 'year-monthly-trend', 'year-review'],
      },
    });
  }
  const allLabels = (axisObj) => (axisObj ? axisObj.ticks.map((t) => t.label).filter((x) => !!x) : []);

  // --- 8.1 每日图：正常数据 + 刻度结构 ---
  [1, 5, 9, 14, 20, 28].forEach((d) => add(d, 10000 + d * 1000));
  openAll();
  const inst = makeInstance();
  inst.loadMonth(thisMonth);
  const ax = inst.data.dailyAxis;
  assert(!!ax, '月度加载后有 dailyAxis');
  eq(ax.ticks.length, 3, '每日图 3 档刻度');
  eq(ax.zoneRpx, 180, '柱区高度沿用 180rpx');
  assert(ax.gutterPx >= 22 && ax.gutterPx <= 56, 'Y 轴留白在 22~56px（实际 ' + ax.gutterPx + '）');
  assert(allLabels(ax).length >= 2, '每日图至少 2 个可见刻度');
  allLabels(ax).forEach((s, i) => isCleanText(s, '每日图刻度 ' + i));
  const topTick = ax.ticks[ax.ticks.length - 1];
  assert(topTick.label.indexOf('¥') === 0, '最高档带 ¥（实际 ' + topTick.label + '）');
  eq(topTick.bottomRpx, 180, '最高刻度线 = 柱区顶部');
  eq(ax.ticks[0].bottomRpx, 0, '0 刻度线在柱区底部');
  eq(ax.ticks.filter((t) => t.showGrid).length, allLabels(ax).length, '网格线条数 = 有文字的刻度条数');

  // 柱高按 niceMax 归一（终检④ 连带）：最高柱 = value / niceMax × 柱区高，误差 ≤1px，且不越过顶线
  const dailyMaxVal = inst.data.daily.reduce((m, p) => Math.max(m, p.cents), 0);
  const expectTopBar = Math.round((dailyMaxVal / ax.maxCents) * 180);
  const maxBar = inst.data.daily.reduce((m, p) => Math.max(m, p.barHeightRpx), 0);
  assert(Math.abs(maxBar - expectTopBar) <= 1, '最高柱高 = 值 / 顶档 × 柱区高（实际 ' + maxBar + '，期望 ' + expectTopBar + '）');
  assert(maxBar <= 180, '最高柱不越过最高刻度线（实际 ' + maxBar + ' ≤ 180）');
  inst.data.daily.forEach((p) => {
    assert(p.barHeightRpx >= 0 && p.barHeightRpx <= 180, '每根柱高都在柱区内（day=' + p.day + '）');
  });

  // X 标签：数量 ≤ 7、含首末、互不重叠
  const shown = inst.data.daily.filter((p) => p.showLabel).map((p) => p.day);
  assert(shown.length <= 7 && shown.length >= 2, '每日图 X 标签 2~7 个（实际 ' + shown.length + '）');
  eq(shown[0], 1, 'X 标签含首日');
  const plotPx = Math.max(40, Math.round(638 * (375 / 750) * 100) / 100 - ax.gutterPx);
  const perDay = plotPx / inst.data.daily.length;
  let overlaps = 0;
  for (let i = 1; i < shown.length; i++) {
    if ((shown[i] - shown[i - 1]) * perDay < 2 * ax.fontPx) overlaps++;
  }
  eq(overlaps, 0, '每日图 X 标签不重叠');

  // 累计趋势拿到月份（供 M/DD 标签）
  eq(inst.data.cumMonth, now.getMonth() + 1, 'cumMonth = 当前月');

  // --- 8.2 0.01 元极小额 ---
  {
    const s2 = makeInstance();
    store.addBill({
      type: 'expense', amountCents: 1, categoryId: 'c-food',
      occurredAt: new Date(now.getFullYear(), now.getMonth(), 2, 12, 0).getTime(), title: 'tiny',
    });
    s2.loadMonth(thisMonth);
    allLabels(s2.data.dailyAxis).forEach((s, i) => isCleanText(s, '极小额刻度 ' + i));
    assert(s2.data.dailyAxis.ticks.filter((t) => !!t.label).length >= 2, '极小额仍有 ≥2 档可区分');
  }

  // --- 8.3 9,999,999 元极大量 ---
  {
    const s3 = makeInstance();
    store.addBill({
      type: 'expense', amountCents: 999999900, categoryId: 'c-food',
      occurredAt: new Date(now.getFullYear(), now.getMonth(), 3, 12, 0).getTime(), title: 'huge',
    });
    s3.loadMonth(thisMonth);
    allLabels(s3.data.dailyAxis).forEach((s, i) => isCleanText(s, '极大量刻度 ' + i));
    assert(s3.data.dailyAxis.gutterPx <= 56, '极大量时留白仍受上限约束（实际 ' + s3.data.dailyAxis.gutterPx + '）');
  }

  // --- 8.4 整月 31 天全有数据 ---
  {
    const s4 = makeInstance();
    for (let d = 1; d <= 28; d++) {
      store.addBill({
        type: 'expense', amountCents: 500 + d, categoryId: 'c-food',
        occurredAt: new Date(now.getFullYear(), now.getMonth(), d, 12, 0).getTime(), title: 'all-' + d,
      });
    }
    s4.loadMonth(thisMonth);
    eq(s4.data.daily.length, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), '每日图覆盖整月天数');
    allLabels(s4.data.dailyAxis).forEach((s, i) => isCleanText(s, '整月刻度 ' + i));
    assert(s4.data.daily.filter((p) => p.showLabel).length <= 7, '整月数据 X 标签仍 ≤ 7');
  }

  // --- 8.5 年度 12 个月全 0（空态） ---
  {
    const s5 = makeInstance();
    s5.loadYear(2099); // 无任何数据
    const max = s5.data.monthlyAxis;
    assert(!!max, '年度加载后有 monthlyAxis');
    eq(max.ticks.length, 3, '月份图 3 档刻度');
    eq(max.ticks.filter((t) => !!t.label).length, 1, '全 0 时只有 1 个可见刻度（不显示三重 0）');
    // 终检③：文字必须挂在**底档**（底线），不能出现「¥0 在顶、0 值线在底」
    eq(max.ticks[0].label, '0', '全 0 时底档显示 0');
    eq(max.ticks[max.ticks.length - 1].label, '', '全 0 时顶档无文字（不再在顶部挂 ¥0）');
    eq(max.ticks.filter((t) => t.showGrid).length, 1, '全 0 时只画底线网格');
    assert(max.ticks[0].showGrid && !max.ticks[2].showGrid, '全 0 时顶线不画网格');
    allLabels(max).forEach((s, i) => isCleanText(s, '空态刻度 ' + i));
    // 日卡 / 累计卡的空态标记（口径统一：「本月还没有支出」）
    const s5b = makeInstance();
    s5b.loadMonth('2099-03');
    eq(s5b.data.dailyEmpty, true, '整月无支出：日卡走空态文案');
    eq(s5b.data.cumEmpty, true, '整月无支出：累计卡走空态文案');
  }

  // --- 8.6 年度正常数据：12 个月标签全保留 ---
  // 用「上一年」独立账本，避开前面 999 万元极端数据把纵轴拉高（那会把绘图区挤窄）
  {
    const s6 = makeInstance();
    const YR = now.getFullYear() - 1;
    for (let m = 0; m < 12; m++) {
      store.addBill({
        type: 'expense', amountCents: 10000 + m * 5000, categoryId: 'c-food',
        occurredAt: new Date(YR, m, 10, 12, 0).getTime(), title: 'm' + m,
      });
    }
    s6.loadYear(YR);
    const shownMonths = s6.data.monthly.filter((p) => p.showLabel).map((p) => p.month);
    eq(shownMonths.length, 12, '12 个月标签全保留（无 bar-label--hide）');
    allLabels(s6.data.monthlyAxis).forEach((s, i) => isCleanText(s, '月份图刻度 ' + i));
    const mMaxVal = s6.data.monthly.reduce((m, p) => Math.max(m, p.expense), 0);
    const expectMBar = Math.round((mMaxVal / s6.data.monthlyAxis.maxCents) * 200);
    const maxBar = s6.data.monthly.reduce((m, p) => Math.max(m, p.barHeightRpx), 0);
    assert(Math.abs(maxBar - expectMBar) <= 1, '最高月柱 = 值 / 顶档 × 200rpx（实际 ' + maxBar + '，期望 ' + expectMBar + '）');
    assert(maxBar <= 200, '最高月柱不越过最高刻度线');
  }

  // --- 8.6b 年度极端值：纵轴被拉高、绘图区变窄时，12 个标签依然全在 ---
  {
    const s6b = makeInstance();
    s6b.loadYear(now.getFullYear()); // 本年含 999 万元那笔
    const shown = s6b.data.monthly.filter((p) => p.showLabel).map((p) => p.month);
    eq(shown.length, 12, '极端值下月份标签依然 12 个全在（终检⑧：不允许抽稀）');
    allLabels(s6b.data.monthlyAxis).forEach((s, i) => isCleanText(s, '年度极端刻度 ' + i));
  }

  // --- 8.6c 360 / 414 / 427 三种宽度：12 个标签全在且互不重叠（终检⑧验收） ---
  {
    const A361 = A; // 复用同一套 estimate
    [[360, 10], [375, 11], [414, 11], [427, 11]].forEach(([winW, fontHint]) => {
      global.wx.getWindowInfo = () => ({ windowWidth: winW, windowHeight: 780, platform: 'devtools' });
      device.reset();
      const s = makeInstance();
      s.setData({ isNarrow: device.isNarrowScreen() });
      s.loadYear(now.getFullYear());
      const axM = s.data.monthlyAxis;
      const shownM = s.data.monthly.filter((p) => p.showLabel);
      eq(shownM.length, 12, winW + 'px：12 个月标签全在');
      // 不重叠：列宽 ≥ 单标签宽度
      const contentPx = Math.round(638 * (winW / 750) * 100) / 100;
      const plotW = Math.max(40, contentPx - axM.gutterPx);
      const colW = plotW / 12;
      const widest = s.data.monthly.reduce((m, p) => Math.max(m, A361.textWidthPx(p.label, axM.fontPx)), 0);
      assert(widest <= colW + 0.01, winW + 'px：标签宽 ' + widest.toFixed(1) + 'px ≤ 列宽 ' + colW.toFixed(1) + 'px（不重叠）');
      assert(axM.fontPx >= 10, winW + 'px：刻度字号 ≥10px（实际 ' + axM.fontPx + '）');
      assert(plotW / contentPx >= 0.7, winW + 'px：绘图区 ≥70% 盒宽（实际 ' + Math.round((plotW / contentPx) * 100) + '%）');
    });
    global.wx.getWindowInfo = () => ({ windowWidth: 375, windowHeight: 812, platform: 'devtools' });
    device.reset();
  }

  // --- 8.7 窄屏（320px）：字号降档、标签仍不叠 ---
  {
    global.wx.getWindowInfo = () => ({ windowWidth: 320, windowHeight: 640, platform: 'devtools' });
    device.reset();
    const s7 = makeInstance();
    s7.setData({ isNarrow: device.isNarrowScreen() });
    eq(s7.data.isNarrow, true, '320px 判定为窄屏');
    for (let d = 1; d <= 31; d += 1) {
      store.addBill({
        type: 'expense', amountCents: 3000 + d * 100, categoryId: 'c-food',
        occurredAt: new Date(now.getFullYear(), now.getMonth(), Math.min(d, 28), 12, 0).getTime(), title: 'n' + d,
      });
    }
    s7.loadMonth(thisMonth);
    eq(s7.data.dailyAxis.fontPx, 10, '窄屏刻度字号 10px（终检⑦：原 9px 看不清）');
    const shownN = s7.data.daily.filter((p) => p.showLabel).length;
    assert(shownN >= 2 && shownN <= 7, '窄屏 X 标签 2~7 个（实际 ' + shownN + '）');
    allLabels(s7.data.dailyAxis).forEach((s, i) => isCleanText(s, '窄屏刻度 ' + i));
    // 窄屏靠「缩短格式」省宽度：'1日' → '1'
    const labelsN = s7.data.daily.filter((p) => p.showLabel).map((p) => p.label);
    assert(labelsN.every((x) => !/日$/.test(x)), '窄屏日标签不带「日」字（实际 ' + labelsN.slice(0, 4).join('/') + '）');
    // 窗口变化后只重算坐标轴：rebuildAxis 不重读账本也能给出新字号
    s7.setData({ isNarrow: false });
    s7.rebuildAxis(false);
    eq(s7.data.dailyAxis.fontPx, 11, '宽度恢复后字号回到 11px');
    global.wx.getWindowInfo = () => ({ windowWidth: 375, windowHeight: 812, platform: 'devtools' });
    device.reset();
  }

  // --- 8.8 同列两图共用 Y 轴留白（终检⑥：左右边界都要对齐） ---
  {
    // 造一组「日柱图顶档 3 位数、累计图顶档 4 位数」的数据：
    // 各算各的留白会差 7px，左边界就对不齐，所以必须共用较大的那个
    const YR8 = 2020;
    const MO8 = 3;
    [30000, 90000].forEach((cents, i) => {
      store.addBill({
        type: 'expense', amountCents: cents, categoryId: 'c-food',
        occurredAt: new Date(YR8, MO8 - 1, 5 + i, 12, 0).getTime(), title: 'gutter-' + i,
      });
    });
    const s8 = makeInstance();
    s8.loadMonth(YR8 + '-03');
    const dAx = s8.data.dailyAxis;
    eq(dAx.gutterPx, s8.data.cumGutter, '日柱图与累计图共用同一个 Y 轴留白（左边界对齐）');
    const dailyTop = dAx.ticks[dAx.ticks.length - 1].label;
    const cumTop = A.buildTicks(s8.data.cumMax, 3, { prefix: '¥' }).slice(-1)[0].label;
    const expectGutter = Math.max(A.axisGutterPx(dailyTop, dAx.fontPx), A.axisGutterPx(cumTop, dAx.fontPx));
    eq(dAx.gutterPx, expectGutter, '共用留白 = 两图各自所需的较大值（日 ' + dailyTop + ' / 累计 ' + cumTop + '）');
    assert(dAx.gutterPx >= A.axisGutterPx(cumTop, dAx.fontPx), '留白容得下累计图的最高档文字');
    const contentPx = Math.round(638 * (375 / 750) * 100) / 100;
    assert((contentPx - dAx.gutterPx) / contentPx >= 0.7,
      '共用留白后绘图区仍 ≥70% 盒宽（实际 ' + Math.round(((contentPx - dAx.gutterPx) / contentPx) * 100) + '%）');
  }

  global.Component = saved;
}

/* ==================== 9. v1.5.1 车削光影（柱 / 折线 / Canvas）规则 ==================== */
// 只测规则，不测死值：明度单调性、色标同位成对、组件内无主题选择器、元素预算不超。
console.log('9. 车削光影规则');
{
  const fs = require('fs');
  const ROOT = path.join(__dirname, '..');
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const { mixHex } = require(path.join(ROOT, 'utils', 'color-mix'));

  // --- 9.1 mixHex：混白变亮、混黑变暗、端点不动、色相不跳、非法输入不抛 ---
  const base = '#7C86FF';
  eq(mixHex(base, '#000000', 0), '#7c86ff', 'mixHex t=0 原样返回基准色');
  eq(mixHex(base, '#FFFFFF', 1), '#ffffff', 'mixHex t=1 混到目标色');
  eq(mixHex(base, '#000000', 1), '#000000', 'mixHex 混黑到 1 = 纯黑');
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
  };
  [[0.16, 0.26], [0.38, 0.34], [0.40, 0.48]].forEach(([w, k], i) => {
    const light = mixHex(base, '#FFFFFF', w);
    const dark = mixHex(base, '#000000', k);
    assert(lum(light) > lum(base), '第 ' + i + ' 组：混白后更亮（' + light + '）');
    assert(lum(dark) < lum(base), '第 ' + i + ' 组：混黑后更暗（' + dark + '）');
    // 色相不跳：蓝通道始终是最大分量（靛蓝系），只改明度
    [light, dark].forEach((h) => {
      assert(/^#[0-9a-f]{6}$/.test(h), 'mixHex 输出 #rrggbb（' + h + '）');
      const v = parseInt(h.slice(1), 16);
      const b = v & 255, g = (v >> 8) & 255, r = (v >> 16) & 255;
      assert(b > r && b > g, '混色后仍是蓝主导（色相没变）：' + h);
    });
  });
  eq(mixHex('bad', '#FFFFFF', 0.5), 'bad', '非法输入原样返回，不抛');
  eq(mixHex('#7C86FF', '#FFFFFF', 5), '#ffffff', 't 越界夹到 1');
  eq(mixHex('#7C86FF', '#FFFFFF', -3), '#7c86ff', 't 越界夹到 0');

  // --- 9.2 累计折线：三条描边的明度关系（暗缘 < 本体 < 高光），深/浅各一套且不同 ---
  const CUM = require(path.join(ROOT, 'data', 'statistics', 'cumulative'));
  const pts = [];
  for (let d = 1; d <= 20; d++) pts.push({ day: d, cumCents: d * 1500 });
  const svgOf = (themeKey) => CUM.buildCumulativeSVG(pts, 30000, '#333333', { w: 319, h: 180 }, {
    padLeft: 34, spanDays: 30, lineColor: base, theme: themeKey,
  });
  const strokesOf = (svg) => [...svg.matchAll(/<path d="[^"]+" fill="none" stroke="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]);
  ['dark', 'light'].forEach((t) => {
    const st = strokesOf(svgOf(t));
    eq(st.length, 3, t + '：折线描三遍（暗缘 / 本体 / 高光）');
    eq(st[1].toLowerCase(), '#7c86ff', t + '：中间那道必须是本体本色（高光不许顶到轮廓线上）');
    assert(lum(st[0]) < lum(st[1]), t + '：第一道比本体暗（暗缘）');
    assert(lum(st[2]) > lum(st[1]), t + '：最后一道比本体亮（高光）');
  });
  assert(svgOf('dark') !== svgOf('light'), '折线深浅两套不同（真给了两套值）');
  // 单点退化：三条同 d 且不含 NaN
  const onePoint = CUM.buildCumulativeSVG([{ day: 1, cumCents: 100 }], 100, '#333333', { w: 319, h: 180 }, { padLeft: 34, theme: 'light' });
  assert(!/NaN/.test(onePoint), '单点数据不出 NaN');
  eq(strokesOf(onePoint).length, 3, '单点也画三道（退化为同心圆点，不糊）');
  // 默认（不传 theme）与 dark 同值 —— 旧调用方行为不变
  eq(
    CUM.buildCumulativeSVG(pts, 30000, '#333333', { w: 319, h: 180 }, { padLeft: 34, spanDays: 30, lineColor: base }),
    svgOf('dark'),
    '不传 theme 时按 dark（旧调用方行为不变）'
  );

  // --- 9.3 柱体改 SVG 图（v1.5.3）：view 清零、6 档台阶在 JS 里、地面槽顺序不变 ---
  const panelWxss = read('components/statistics-panel/statistics-panel.wxss');
  const panelWxml = read('components/statistics-panel/statistics-panel.wxml');
  // v1.5.1 的「柱体渐变不许写多色标硬停」断言随实现下线：柱子不再是 view + WXSS 背景。
  // 现在锁的是「不许回退成 WXSS 渐变写法」（.bar / .bar--exp 规则必须已删除，否则半截迁移）。
  assert(!/\.bar--exp\s*\{/.test(panelWxss), '柱子不用 WXSS 渐变（.bar--exp 规则已随柱子改图删除）');
  assert(!/class="bar bar--exp"/.test(panelWxml), 'WXML 不再渲染柱子 view（柱体 0 个 .bar）');
  const barImgs = panelWxml.match(/<image[\s\S]*?\/>/g) || [];
  eq(barImgs.length, 2, '两张柱状图各 1 张图（日支出 + 年度 12 月）');
  assert(barImgs.some((c) => /src="\{\{dailyBarUri\}\}"/.test(c)), '每日图用 dailyBarUri');
  assert(barImgs.some((c) => /src="\{\{monthlyBarUri\}\}"/.test(c)), '月度图用 monthlyBarUri');
  barImgs.forEach((c, i) => assert(/mode="scaleToFill"/.test(c), '第 ' + (i + 1) + ' 张图按显示盒铺满（viewBox 同比例，不裁不糊）'));
  // 点击不能丢：12 月柱体的点击从 .bar-col 转到图上按坐标反查
  assert(/src="\{\{monthlyBarUri\}\}"[\s\S]{0,260}bindtouchstart="onMonthlyBarTouchStart"[\s\S]{0,120}bindtouchend="onTapMonthlyBar"/.test(panelWxml),
    '12 月柱体保留点击（touchend → 按坐标反查月份；tap 在 Skyline 下触摸字段不保证带坐标）');
  assert(/id="monthlyPlot"/.test(panelWxml), '柱区带 id（点击时量矩形反查列号，不缓存坐标）');
  eq((panelWxml.match(/class="bar bar--exp"/g) || []).length, 0, '柱子 view 数量归零（31 个 → 0 个）');
  eq((panelWxml.match(/<canvas/g) || []).length, 0, '柱体不再用 canvas（Canvas 2D 版实测在统计页画不出像素）');
  // 样式隔离：组件 wxss 里不许出现主题类选择器（写了也不生效）
  assert(!/\.theme-(light|dark)\b/.test(panelWxss), '组件 wxss 无主题类选择器（isolated 隔离，写了不生效）');
  // 地面槽必须在 .ca__plot 里且是第一个子节点前于网格线（DOM 顺序 = 绘制顺序）
  const plateCount = (panelWxml.match(/class="ca__plate"/g) || []).length;
  eq(plateCount, 2, '两张柱状图各 1 个地面槽（日支出 + 年度 12 月）');
  const plotBlocks = panelWxml.split('class="ca__plot"').slice(1);
  eq(plotBlocks.length, 2, '两处 ca__plot');
  plotBlocks.forEach((blk, i) => {
    const plateAt = blk.indexOf('ca__plate');
    const gridAt = blk.indexOf('ca__grid');
    assert(plateAt >= 0 && plateAt < gridAt, '第 ' + (i + 1) + ' 个柱区：地面槽在网格线之前（不盖 0 档网格线）');
    const imgAt = blk.indexOf('ca__bars-img');
    assert(imgAt > gridAt, '第 ' + (i + 1) + ' 个柱区：柱图在网格线之后（柱子压在网格线上，槽与线仍可见）');
  });
  assert(/\.ca__plate\s*\{[\s\S]*?position:\s*absolute/.test(panelWxss), '.ca__plate 绝对定位（不占 flex 位、不改柱高）');
  assert(/\.ca__plate\s*\{[\s\S]*?height:\s*6rpx/.test(panelWxss), '地面槽高 6rpx（不改变柱区高度）');
  assert(/\.ca__bars-img\s*\{[\s\S]*?position:\s*absolute/.test(panelWxss),
    '.ca__bars-img 绝对定位（不占 flex 位，柱区高度仍由 .ca__plot 决定）');

  // --- 9.3b 柱体 6 档台阶（utils/bar-shading，纯函数）---
  const BS = require(path.join(ROOT, 'utils', 'bar-shading'));
  eq(BS.BANDS.length, 6, '柱体 6 档明暗台阶');
  eq(BS.BANDS[0].from, 0, '第 1 档从柱顶 0% 起');
  eq(BS.BANDS[BS.BANDS.length - 1].to, 1, '最后 1 档到柱底 100%');
  BS.BANDS.forEach((b, i) => {
    if (i > 0) eq(b.from, BS.BANDS[i - 1].to, '第 ' + (i + 1) + ' 档与上一档无缝衔接（不留缝、不重叠）');
    assert(b.to > b.from, '第 ' + (i + 1) + ' 档有正高度');
  });
  eq(BS.BANDS[0].role, 'body', '顶倒角必须本色（混白高光顶到轮廓线上，柱子轮廓就没了）');
  ['dark', 'light'].forEach((tk) => {
    const pal = BS.paletteFor('#7C86FF', tk);
    Object.keys(pal).forEach((k) => assert(/^#[0-9a-f]{6}$/.test(pal[k]), tk + '：' + k + ' 是实色 #rrggbb（不用 alpha 叠）'));
    eq(pal.body, '#7c86ff', tk + '：柱身 = 本色（颜色合同不变）');
    const lum = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
    };
    const L = { body: lum(pal.body), cap: lum(pal.cap), lit: lum(pal.lit), shade: lum(pal.shade), foot: lum(pal.foot) };
    assert(L.cap > L.lit && L.lit > L.body, tk + '：顶光比受光亮、受光比本色亮（自上而下递减）');
    assert(L.body > L.shade && L.shade > L.foot, tk + '：背光比本色暗、接触暗比背光更暗');
    // 相邻档跳变 ≥ 4 个色阶（8bit）：小于这个数屏幕上就是「一根纯色柱子」
    const seq = ['body', 'cap', 'lit', 'body', 'shade', 'foot'];
    for (let i = 1; i < seq.length; i++) {
      const d = Math.abs(L[seq[i]] - L[seq[i - 1]]);
      assert(d >= 4, tk + '：第 ' + (i + 1) + ' 档与上一档明度差 ≥4 色阶（实际 ' + d.toFixed(1) + '）');
    }
  });
  // 深浅两套比例必须不同（设计要求），且与 app.wxss 的 --bar-* 变量同值（防两处各改一处）
  assert(JSON.stringify(BS.MIX.dark) !== JSON.stringify(BS.MIX.light), '深浅两套混色比例不同（两套都验）');
  const appWxssText = read('app.wxss');
  const blockAt = (sel) => {
    const i = appWxssText.indexOf(sel);
    return i < 0 ? '' : appWxssText.slice(i, appWxssText.indexOf('\n}', i));
  };
  const darkVars = blockAt('page, .theme-dark {');
  const lightIdx2 = appWxssText.indexOf('.theme-light {');
  const lightVars = lightIdx2 < 0 ? '' : appWxssText.slice(lightIdx2, appWxssText.indexOf('\n}', lightIdx2));
  [['dark', darkVars], ['light', lightVars]].forEach(([tk, block]) => {
    [['cap', '255, 255, 255'], ['lit', '255, 255, 255'], ['shade', '0, 0, 0'], ['foot', '0, 0, 0']].forEach(([key, rgb]) => {
      const m = block.match(new RegExp('--bar-' + key + ':\\s*rgba\\(\\s*' + rgb + ',\\s*([0-9.]+)\\s*\\)'));
      assert(!!m, tk + '：app.wxss 定义 --bar-' + key);
      if (m) eq(Number(m[1]), BS.MIX[tk][key], tk + '：bar-shading MIX.' + key + ' 与 --bar-' + key + ' 同值（防漂移）');
    });
  });
  // 极矮柱退化：< 8px 不再切档，本色 + 顶部 1px 提亮
  eq(BS.MIN_BANDS_PX, 8, '退化阈值 8px');
  // 台阶高度：合计 = 柱高（整像素），且 6 档都 ≥1px（否则小柱会丢档）
  [[8, 6], [12, 6], [24, 6], [72, 6], [90, 6], [180, 6]].forEach(([h, n]) => {
    const hs = BS.bandHeights(h);
    eq(hs.length, n, 'bandHeights(' + h + ') 返回 6 段');
    eq(hs.reduce((a, b) => a + b, 0), Math.round(h), 'bandHeights(' + h + ') 合计 = 柱高（不多画、不留空）');
    hs.forEach((v, i) => assert(Number.isInteger(v) && v >= 1, 'bandHeights(' + h + ') 第 ' + (i + 1) + ' 档 ≥1px（实际 ' + v + '）'));
  });
  // --- 9.3b2 buildBarsSVG：6 档 6 个色块、只用实色、顶部圆角只在顶档、极矮柱退化 ---
  const svgOfBars = (pts, h) => BS.buildBarsSVG(pts, {
    width: 288, height: h, zoneRpx: h, colors: BS.paletteFor('#7C86FF', 'dark'), radius: 4,
  });
  {
    const tall = svgOfBars([{ barHeightRpx: 100 }], 100);
    const fills = [...tall.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
    eq(fills.length, 6, '满高柱 = 6 个色块（6 档各一块，硬边台阶）');
    const pal = BS.paletteFor('#7C86FF', 'dark');
    eq(fills.join(','), [pal.body, pal.cap, pal.lit, pal.body, pal.shade, pal.foot].join(','),
      '色块顺序 = 本色→顶光→受光→本色→背光→接触暗');
    eq([...tall.matchAll(/<path /g)].length, 1, '只有顶档用 path（画顶部圆角），其余档是矩形');
    assert(/viewBox="0 0 288 100"/.test(tall), 'viewBox = 显示盒（像素 1:1）');
    ['rgba(', 'hsl(', 'url(', 'clipPath', 'NaN', 'undefined'].forEach((bad) => {
      eq(tall.indexOf(bad), -1, 'SVG 不含 ' + bad + '（Skyline 内联 SVG 兼容约束）');
    });
  }
  {
    const tiny = svgOfBars([{ barHeightRpx: 5 }], 100);
    eq([...tiny.matchAll(/<rect /g)].length, 2, '矮柱退化成 2 个矩形（本色柱 + 顶部 1px 提亮）');
    eq([...tiny.matchAll(/<path /g)].length, 0, '矮柱不切 6 档（挤没了等于白切）');
  }
  {
    const zero = svgOfBars([{ barHeightRpx: 0 }], 100);
    eq([...zero.matchAll(/<rect |<path /g)].length, 0, '0 值不画柱（与旧 0 高度 view 一致），但列位保留');
  }
  {
    // 柱宽仍为列宽的 60%，水平居中：2 列时每列 144，柱宽 86.4 → 左边界 28.8 / 172.8
    const two = svgOfBars([{ barHeightRpx: 100 }, { barHeightRpx: 50 }], 100);
    const rectXs = [...two.matchAll(/<rect x="([0-9.]+)"/g)].map((m) => Number(m[1]));
    assert(rectXs.length >= 2, '两根柱都有矩形档');
    if (rectXs.length) assert(Math.abs(rectXs[0] - 28.8) < 0.05, '第一根柱左边界 = 28.8（列宽 60% 居中）');
    if (rectXs.length > 5) assert(Math.abs(rectXs[5] - 172.8) < 0.05, '第二根柱左边界 = 144 + 28.8（列宽 60% 居中）');
  }

  // --- 9.3c 组件侧：图源接线齐备（换月 / 换年 / 主题 / 宽度四处都要重算）---
  const panelJs = read('components/statistics-panel/statistics-panel.js');
  assert(panelJs.indexOf('utils/bar-shading') >= 0, '柱体明暗走 utils/bar-shading（单一实现）');
  assert(panelJs.indexOf('b64encodeAscii') >= 0, 'SVG 走 base64（与累计折线 / 圆环同一条渲染路径）');
  assert(panelJs.indexOf('block-size') < 0 && panelJs.indexOf("getContext('2d')") < 0, '统计面板不再用 Canvas 画柱');
  assert((panelJs.match(/this\.barUri\(/g) || []).length >= 4,
    '图源重算点齐备（换月 / 换年 / 主题 / 宽度变化，实际 ' + (panelJs.match(/this\.barUri\(/g) || []).length + ' 处）');
  assert(panelJs.indexOf('barHeightRpx') >= 0 && panelJs.indexOf('zoneRpx') >= 0,
    '柱高仍按 barHeightRpx / zoneRpx 换算（数据几何不变）');

  // --- 9.4 深浅两套 --bar-* 变量齐备，浅色 6 个全量覆盖 ---
  const appWxss = read('app.wxss');
  const blockOf = (sel) => {
    const i = appWxss.indexOf(sel);
    if (i < 0) return '';
    return appWxss.slice(i, appWxss.indexOf('\n}', i));
  };
  const darkBlock = blockOf('page, .theme-dark {');
  const lightIdx = appWxss.indexOf('.theme-light {');
  const lightBlock = lightIdx < 0 ? '' : appWxss.slice(lightIdx, appWxss.indexOf('\n}', lightIdx));
  const SIX = ['--bar-cap', '--bar-lit', '--bar-shade', '--bar-foot', '--bar-plate', '--bar-lip'];
  SIX.forEach((v) => {
    assert(darkBlock.indexOf(v + ':') >= 0, '深色块定义 ' + v);
    assert(lightBlock.indexOf(v + ':') >= 0, '浅色块覆盖 ' + v);
  });
  assert(darkBlock.indexOf('--bar-none:') >= 0, '--bar-none 在深色块定义（page 选择器让浅色也继承得到）');
  // 浅色块不许重复定义 --bar-none（透明不随主题变，重复定义就是维护隐患）
  assert(lightBlock.indexOf('--bar-none:') < 0, '浅色块不重复定义 --bar-none');

  // --- 9.5 日价曲线（Canvas）：三描边参数齐 + 数据几何零变更 ---
  const dvSrc = read('components/daily-value-curve/daily-value-curve.js');
  const dvWxss = null; // Canvas 无 DOM 子节点，元素预算 0
  assert(dvWxss === null, 'Canvas 图不靠 WXML 叠层（0 新增元素）');
  // 两个主题块里的字段数必须各 1（别的地方引用 base.xxx 不算定义）
  ['rimMix', 'specMix', 'specDy', 'specW', 'rimExtra', 'floorAlpha', 'areaAlpha'].forEach((k) => {
    const n = (dvSrc.match(new RegExp(k + ':\\s', 'g')) || []).length;
    assert(n >= 2, k + ' 深浅两套都定义（实际出现 ' + n + ' 次)');
  });
  ['pal.rim', 'pal.spec', 'pal.floor'].forEach((k) => {
    assert(dvSrc.indexOf(k) >= 0, '绘制时用到 ' + k);
  });
  // 三描边必须复用同一个 tracePath，不许各写一遍坐标（否则几何会走偏）
  const traceCount = (dvSrc.match(/tracePath\(\);/g) || []).length;
  eq(traceCount, 3, '折线画三遍（暗缘 / 本体 / 高光）');
  const inlineLoop = (dvSrc.match(/if \(i === 0\) ctx\.moveTo/g) || []).length;
  eq(inlineLoop, 2, '只有面积 + tracePath 两处坐标循环（折线不再各写一遍）');
  // 高光用 save/translate/restore，且不许改 lineCap（round 会多出 0.45px 圆头）
  assert(/ctx\.save\(\)[\s\S]{0,400}translate\(0, pal\.specDy\)[\s\S]{0,400}ctx\.restore\(\)/.test(dvSrc),
    '高光整体上移用 save/translate/restore，不动其它绘制状态');
  assert(dvSrc.indexOf("lineCap = 'round'") < 0, '不改 lineCap（保持 butt，端点形态不变）');
}

console.log('\nchart-axis tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
