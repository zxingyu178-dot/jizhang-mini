/**
 * tests/perf/realistic-ledger.perf.js — 真实风格大账本性能 Gate（v1.3.0 Gate J）
 *
 * 与 large-ledger.perf（均匀随机 1k/5k/10k）互补：本脚本用 Realistic Ledger Generator
 * 生成 Typical(3年/5k) / Heavy(5年/20k) / Stress(10年/50k) 三档「模拟用户长期使用」账本，
 * 通过真实 restoreBackup 落盘到内存 FS，再跑真实用户路径会触发的全部数据层操作：
 *   冷启动全量读取、当月 Timeline、月度统计、年度统计、分类占比、
 *   预算日历/节奏/日详情、自定义日期、Bill Explorer 搜索与连续键入、日价列表。
 *
 * 硬性要求（任一不满足即非零退出）：
 *   1) 正确性：统计一致性对账（总额/分类/月/年/搜索）全部闭合；
 *   2) 读取范围：预算日历/日详情/自定义日期只读取应涉及的月份分片；
 *   3) 耗时：各规模在宽松上限内，防止严重退化（不追求秒开，真机指标另由真机 Gate 验证）。
 *
 * 运行：node tests/perf/realistic-ledger.perf.js  （或 npm run perf:realistic）
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const ANCHOR = '2026-10-29';
const TODAY = ANCHOR;
const gen = require(path.join(ROOT, 'scripts', 'generate-realistic-ledger'));

/* ---------- 内存 wx 文件系统（按月份分片记录读取） ---------- */
function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const storage = {};
  const shardReads = new Map(); // ym -> 次数
  let totalReads = 0;
  const SHARD_RE = /\/bills\/(\d{4}-\d{2})\.json$/;
  const fsm = {
    accessSync(p) {
      if (memFiles.has(p) || memDirs.has(p)) return;
      throw new Error('ENOENT');
    },
    mkdirSync(p, recursive) {
      if (recursive) {
        const parts = p.split('/');
        let cur = '';
        parts.forEach((x, i) => {
          if (i === 0 && x === '') cur = '';
          else { cur = cur + '/' + x; memDirs.add(cur); }
        });
      } else memDirs.add(p);
    },
    readFileSync(p) {
      totalReads += 1;
      const m = SHARD_RE.exec(String(p));
      if (m) shardReads.set(m[1], (shardReads.get(m[1]) || 0) + 1);
      if (!memFiles.has(p)) throw new Error('ENOENT ' + p);
      return memFiles.get(p);
    },
    writeFileSync(p, data) { memFiles.set(p, String(data)); },
    renameSync(oldPath, newPath) {
      if (!memFiles.has(oldPath)) throw new Error('ENOENT ' + oldPath);
      if (memFiles.has(newPath)) throw new Error('file exists ' + newPath);
      memFiles.set(newPath, memFiles.get(oldPath));
      memFiles.delete(oldPath);
    },
    unlinkSync(p) {
      if (!memFiles.has(p)) throw new Error('ENOENT');
      memFiles.delete(p);
    },
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
  const wxObj = {
    env: { USER_DATA_PATH: '/usr' },
    getFileSystemManager: () => fsm,
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => { storage[k] = v; },
  };
  return {
    wx: wxObj,
    shardReads,
    resetShardReads() { shardReads.clear(); totalReads = 0; },
    readYmSet: () => [...shardReads.keys()],
  };
}

let env = buildWx();
global.wx = env.wx;
const store = require(path.join(ROOT, 'data', 'index'));
const A = require(path.join(ROOT, 'data', 'accounting'));
const M = require(path.join(ROOT, 'data', 'statistics', 'month'));
const Y = require(path.join(ROOT, 'data', 'statistics', 'year'));
const DV = require(path.join(ROOT, 'data', 'daily-value', 'index'));

let failures = 0;
function check(cond, msg) {
  if (cond) { console.log('  ✓ ' + msg); }
  else { failures++; console.error('  ✗ FAIL: ' + msg); }
}
function timed(label, fn) {
  const t0 = Date.now();
  const value = fn();
  return { label, ms: Date.now() - t0, value };
}
function arrEqAsSet(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/* ---------- 构造并恢复一个 profile ---------- */
function setupProfile(profileName) {
  const p = gen.PROFILES[profileName];
  const result = gen.Generator({ years: p.years, count: p.count, density: p.density, seed: 20261029, anchor: ANCHOR });
  const categories = gen.buildCategories();
  const recurringRules = gen.buildRecurringRules({ y: 2026, m: 10, d: 29 });
  const budget = gen.buildBudget(2026 - p.years);
  const expected = gen.buildExpected(result.bills, undefined, categories);
  const backup = {
    format: 'daily-value-mini-backup',
    schemaVersion: 3,
    appVersion: '1.3.0',
    exportedAt: new Date(2026, 9, 29, 12, 0, 0).toISOString(),
    data: {
      bills: result.bills,
      categories,
      settings: { currency: '¥', theme: 'dark', budget, statistics: { version: 1, modules: [] } },
      recurringRules,
    },
  };
  const r = store.restoreBackup(backup);
  return { p, expected, restored: r };
}

/* ---------- 宽松耗时上限（ms，内存 FS；按规模） ---------- */
const LIMITS = {
  typical: { range: 800, timeline: 400, month: 500, year: 600, budget: 400, search: 600, dv: 400 },
  heavy: { range: 2000, timeline: 800, month: 1200, year: 1500, budget: 1000, search: 1500, dv: 1000 },
  stress: { range: 4000, timeline: 1500, month: 2500, year: 3000, budget: 2000, search: 3000, dv: 2000 },
};

function runProfile(profileName) {
  console.log('\n================ ' + profileName.toUpperCase() + ' ================');
  env = buildWx();
  global.wx = env.wx;
  store.init();
  const setup = setupProfile(profileName);
  const { expected } = setup;
  check(setup.restored.restored === expected.totalBills, '恢复账单数=' + expected.totalBills);

  const ym = A.currentYM(new Date(2026, 9, 29)); // 2026-10
  const [curY, curM] = ym.split('-').map(Number);

  // 1) 冷启动全量读取
  const range = timed('全量 rangeBills', () => store.rangeBills());
  const all = range.value;
  check(all.length === expected.totalBills, '全量账单数正确');

  // 2) 当月 Timeline
  const timeline = timed('当月 Timeline', () => {
    const grouped = store.monthGrouped(ym);
    return A.buildTimeline(ym, grouped, TODAY, undefined, store.getCategoryResolver());
  });
  const timelineRows = timeline.value.reduce((s, d) => s + d.bills.length, 0);
  check(timelineRows > 0, '当月 Timeline 有数据（' + timelineRows + ' 条）');

  // 3) 月度统计全套
  const monthStat = timed('月度统计全套', () => {
    const mb = store.rangeBills(ym, ym);
    const resolver = store.getCategoryResolver();
    return {
      ov: M.computeMonthOverview(mb),
      trend: M.computeDailyExpenseTrend(mb, curY, curM),
      ranking: M.computeCategoryRanking(mb, resolver),
      share: M.computeCategoryShare(mb, resolver),
    };
  });

  // 4) 年度统计
  const yearStat = timed('年度统计', () => {
    const yb = store.rangeBills(curY + '-01', curY + '-12');
    return {
      ov: Y.computeYearOverview(yb, curY),
      trend: Y.computeMonthlyTrend(yb, curY),
      ranking: Y.computeYearCategoryRanking(yb, store.getCategoryResolver()),
    };
  });

  // 5) 分类占比（全量）+ 一致性
  const normal = all.filter((b) => b.ledgerImpact !== 'daily-value-only');
  const share = M.computeCategoryShare(normal, store.getCategoryResolver());
  const shareSum = share.all.reduce((s, x) => s + x.cents, 0);
  check(shareSum === expected.totalExpenseCents, '分类占比金额之和=总支出');

  // 6) 预算日历（读取范围：仅当月分片）
  env.resetShardReads();
  const budgetCal = timed('预算日历', () => store.buildBudgetCalendar(curY, curM, TODAY));
  check(!!budgetCal.value, '预算日历正常返回');
  check(arrEqAsSet(env.readYmSet(), [ym]), '预算日历只读取当月分片（实际：' + env.readYmSet().join(',') + '）');

  // 7) 预算日详情（读取范围：仅当月）
  env.resetShardReads();
  const dayDetail = timed('预算日详情', () => store.buildBudgetDayDetail(TODAY));
  check(!!dayDetail.value, '预算日详情正常返回');
  check(arrEqAsSet(env.readYmSet(), [ym]), '预算日详情只读取当月分片（实际：' + env.readYmSet().join(',') + '）');

  // 8) 预算节奏
  const pace = timed('预算节奏汇总', () => store.buildBudgetPaceSummary(TODAY));
  const monthPace = timed('当月预算节奏', () => store.buildBudgetMonthPace(curY, curM, TODAY));
  check(!!pace.value && !!monthPace.value, '预算节奏正常返回');

  // 9) 自定义日期（读取范围：仅涉及月份；这里取 2026-08-05 ~ 2026-10-20）
  env.resetShardReads();
  const crStart = '2026-08-05';
  const crEnd = '2026-10-20';
  const custom = timed('自定义日期读取', () => store.rangeBills(crStart.slice(0, 7), crEnd.slice(0, 7)));
  const expectYm = ['2026-08', '2026-09', '2026-10'];
  check(arrEqAsSet(env.readYmSet(), expectYm), '自定义日期只读取涉及月份（实际：' + env.readYmSet().join(',') + '）');
  const dateKeyOf = (b) => {
    const d = new Date(b.occurredAt);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  // rangeBills 按月返回整月分片（含区间外账单，属正常）；上层 statistics-panel 会再按日期过滤。
  // 验证：模拟上层过滤后全部落在区间内，且结果与「全量数据直接过滤」完全一致（按月读取不遗漏区间内账单）。
  const inRange = custom.value.filter((b) => { const k = dateKeyOf(b); return k >= crStart && k <= crEnd; });
  check(inRange.every((b) => { const k = dateKeyOf(b); return k >= crStart && k <= crEnd; }), '上层过滤后账单全部落在区间内');
  const truthInRange = all.filter((b) => { const k = dateKeyOf(b); return k >= crStart && k <= crEnd; });
  check(inRange.length === truthInRange.length, '按月读取的区间内账单数与全量过滤一致（' + inRange.length + '）');
  check(custom.value.some((b) => { const k = dateKeyOf(b); return k < crStart || k > crEnd; }), '整月分片确实含区间外账单（由上层过滤）');

  // 10) Bill Explorer 搜索（真实 searchBills）
  const searches = {};
  const searchTimed = timed('搜索（4 个用例）', () => {
    expected.searchCases.forEach((c) => {
      searches[c.keyword] = store.searchBills({ keyword: c.keyword, type: c.type });
    });
  });
  let searchOk = true;
  expected.searchCases.forEach((c) => {
    if (searches[c.keyword].length !== c.expected) searchOk = false;
  });
  check(searchOk, '搜索用例与 expected 一致（' +
    expected.searchCases.map((c) => c.keyword + '=' + c.expected).join('，') + '）');

  // 11) 连续键入（咖 → 咖啡）
  const typing = timed('连续键入', () => ({
    r1: store.searchBills({ keyword: '咖' }),
    r2: store.searchBills({ keyword: '咖啡' }),
  }));
  check(typing.value.r1.length >= typing.value.r2.length, '连续键入子串单调');

  // 12) 日价列表
  const dv = timed('日价列表', () => DV.computeDailyValueList(all, TODAY, store.getCategoryResolver()));
  check(Array.isArray(dv.value), '日价列表正常返回');
  const expectedDv = expected.dailyValueOnlyBills;
  check(dv.value.length >= expectedDv, '日价列表含全部 daily-value-only（' + expectedDv + '）');

  /* ---- 全量一致性对账 ---- */
  let expC = 0;
  let incC = 0;
  normal.forEach((b) => { if (b.type === 'expense') expC += b.amountCents; else incC += b.amountCents; });
  check(expC === expected.totalExpenseCents, '总支出对账');
  check(incC === expected.totalIncomeCents, '总收入对账');

  // 各月支出之和 = 总支出；每日趋势之和 = 月支出
  const monthSet = [...new Set(normal.map((b) => {
    const d = new Date(b.occurredAt);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }))];
  let monthTotal = 0;
  let dailyOk = true;
  monthSet.forEach((mkey) => {
    const [y, m] = mkey.split('-').map(Number);
    const mb = store.rangeBills(mkey, mkey);
    const ov = M.computeMonthOverview(mb);
    monthTotal += ov.expense;
    const tr = M.computeDailyExpenseTrend(mb, y, m);
    if (tr.points.reduce((s, p) => s + p.cents, 0) !== ov.expense) dailyOk = false;
  });
  check(monthTotal === expected.totalExpenseCents, '各月支出之和=总支出');
  check(dailyOk, '每日趋势之和=月支出（全部月份）');

  // 年度 12 个月之和 = 年度支出
  const years = [...new Set(normal.map((b) => new Date(b.occurredAt).getFullYear()))];
  let yearOk = true;
  years.forEach((y) => {
    const yb = store.rangeBills(y + '-01', y + '-12');
    const yov = Y.computeYearOverview(yb, y);
    const mt = Y.computeMonthlyTrend(yb, y);
    if (mt.points.reduce((s, p) => s + p.expense, 0) !== yov.expense) yearOk = false;
  });
  check(yearOk, '年度12个月之和=年度总支出');

  // 最大单笔
  check(!!store.getBill(expected.largestExpense.id), '最大单笔账单存在：' + expected.largestExpense.id);

  /* ---- 耗时上限 ---- */
  const L = LIMITS[profileName];
  check(range.ms <= L.range, '全量读取 ' + range.ms + 'ms ≤ ' + L.range);
  check(timeline.ms <= L.timeline, 'Timeline ' + timeline.ms + 'ms ≤ ' + L.timeline);
  check(monthStat.ms <= L.month, '月度统计 ' + monthStat.ms + 'ms ≤ ' + L.month);
  check(yearStat.ms <= L.year, '年度统计 ' + yearStat.ms + 'ms ≤ ' + L.year);
  check(budgetCal.ms <= L.budget, '预算日历 ' + budgetCal.ms + 'ms ≤ ' + L.budget);
  check(searchTimed.ms <= L.search, '搜索 ' + searchTimed.ms + 'ms ≤ ' + L.search);
  check(dv.ms <= L.dv, '日价列表 ' + dv.ms + 'ms ≤ ' + L.dv);

  console.log('  耗时（ms）：全量=' + range.ms + ' Timeline=' + timeline.ms +
    ' 月=' + monthStat.ms + ' 年=' + yearStat.ms + ' 预算日历=' + budgetCal.ms +
    ' 搜索=' + searchTimed.ms + ' 日价=' + dv.ms);

  return { name: profileName, range: range.ms, month: monthStat.ms, year: yearStat.ms };
}

const results = Object.keys(gen.PROFILES).map(runProfile);

// 增长粗检：Stress 全量耗时不超过 Typical 的 30 倍（理论 10 倍，留抖动余量）
const grow = results[2].range / Math.max(1, results[0].range);
console.log('\n全量读取 Stress/Typical 比值 = ' + grow.toFixed(1) + 'x（期望 ≤ 30x）');
check(grow <= 30, '全量读取近似线性增长');

console.log('\n================ 总结 ================');
results.forEach((r) => {
  console.log('  ' + r.name + '：全量 ' + r.range + 'ms / 月统计 ' + r.month + 'ms / 年统计 ' + r.year + 'ms');
});
if (failures > 0) {
  console.error('\n真实风格性能 Gate 有 ' + failures + ' 项失败');
  process.exit(1);
}
console.log('\n真实风格性能 Gate 通过（5k/20k/50k 一致性闭合、读取范围正确、耗时在线性区间）');
process.exit(0);
