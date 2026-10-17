/**
 * tests/perf/large-ledger.perf.js — 大账本性能 Gate（v0.7.0 G8）
 *
 * 用内存文件系统 mock 生成 1,000 / 5,000 / 10,000 笔虚构账单（均匀分布在过去 12 个月），
 * 跑一遍真实用户路径会触发的全部数据层聚合：
 *   冷启动全量加载、主页当月 Timeline、统计月概览/日趋势/分类排行、
 *   年度统计（12 月趋势/年排行）、预算日历、全量关键字搜索、日价列表。
 *
 * 目标不是「秒开」，而是验证：
 *   1) 大数据下不抛异常、不崩溃、账单数正确；
 *   2) 耗时随数据量近似线性（宽松上限，防止退化为指数级）；
 *   3) G7 分类快照生效：整月 Timeline 即使数百条，categories.json 只读 1 次
 *      （旧实现每条账单读一次）。
 *
 * 纯数据层 Node 基准；WXML 列表滚动 / 帧率 / Canvas 等真机渲染指标不在本脚本范围，
 * 由真机 Gate 验证。单月 Timeline 天然只渲染当月数据，列表总量受控。
 *
 * 运行：node tests/perf/large-ledger.perf.js   （或 npm run perf）
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

/* ---------- 内存 wx 文件系统（带读计数，复用单测同款 mock） ---------- */
function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const storage = {};
  const counts = {};
  const bump = (p) => {
    const s = String(p);
    const key = s.indexOf('categories') >= 0 ? 'categories.json'
      : s.indexOf('/bills/') >= 0 ? 'monthShards' : 'other';
    counts[key] = (counts[key] || 0) + 1;
  };
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
      bump(p);
      if (!memFiles.has(p)) throw new Error('ENOENT ' + p);
      return memFiles.get(p);
    },
    writeFileSync(p, data) { memFiles.set(p, String(data)); },
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
  return { wx: wxObj, counts };
}

// 数据层在模块加载时即读取 wx.env，必须先注入一个 wx 再 require
global.wx = buildWx().wx;
const store = require(path.join(ROOT, 'data', 'index'));
const A = require(path.join(ROOT, 'data', 'accounting'));
const M = require(path.join(ROOT, 'data', 'statistics', 'month'));
const Y = require(path.join(ROOT, 'data', 'statistics', 'year'));
const DV = require(path.join(ROOT, 'data', 'daily-value', 'index'));

function freshStore() {
  const env = buildWx();
  global.wx = env.wx;
  store.init();
  return { s: store, counts: env.counts };
}

/* ---------- 确定性随机（LCG），保证可复现 ---------- */
let seed = 20261017;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

const EXP_CATS = ['c-food', 'c-transport', 'c-shopping', 'c-fun', 'c-life', 'c-drink', 'c-bill', 'c-medical', 'c-housing', 'c-travel', 'c-other'];
const NOW = new Date(2026, 9, 17, 12, 0, 0).getTime(); // 2026-10-17（固定，可复现）
const YEAR_MS = 365 * 24 * 3600 * 1000;

function genBills(n) {
  const bills = [];
  for (let i = 0; i < n; i++) {
    const ts = NOW - Math.floor(rnd() * YEAR_MS);
    const isIncome = rnd() < 0.08;
    bills.push({
      id: 'perf-' + i,
      type: isIncome ? 'income' : 'expense',
      amountCents: 100 + Math.floor(rnd() * 50000),
      categoryId: isIncome ? 'c-salary' : EXP_CATS[i % EXP_CATS.length],
      occurredAt: ts,
      merchant: isIncome ? '工资' : '商户' + (i % 60),
      note: i % 9 === 0 ? '咖啡关键字' + (i % 20) : '',
      source: 'manual',
    });
  }
  return bills;
}

function timed(label, fn) {
  const t0 = Date.now();
  const r = fn();
  const ms = Date.now() - t0;
  return { label, ms, value: r };
}

/* ---------- 宽松上限（ms，Node 内存 FS；真机慢数倍，仅用于防止退化到不可接受） ---------- */
const LIMITS = {
  1000: { range: 400, month: 200, year: 300, search: 200, budget: 200, dv: 200 },
  5000: { range: 1000, month: 500, year: 800, search: 500, budget: 500, dv: 500 },
  10000: { range: 2000, month: 1000, year: 1600, search: 1000, budget: 1000, dv: 1000 },
};

let failures = 0;
function check(cond, msg) {
  if (cond) { console.log('  ✓ ' + msg); }
  else { failures++; console.error('  ✗ FAIL: ' + msg); }
}

function runScale(n) {
  console.log('\n================ ' + n + ' 笔账单 ================');
  seed = 20261017 + n; // 每规模独立但确定
  const env = freshStore();
  const s = env.s;
  const counts = env.counts;

  const write = timed('写入', () => s.addBills(genBills(n)));

  // 1) 冷启动后全量加载
  const range = timed('全量 rangeBills', () => s.rangeBills());
  const all = range.value;
  check(all.length === n, '全量账单数正确（' + all.length + ' === ' + n + '）');

  // 2) 主页当月 Timeline（含 G7 读盘次数断言）
  const ym = A.currentYM();
  counts['categories.json'] = 0;
  let timeline = null;
  const month = timed('当月 Timeline', () => {
    const grouped = s.monthGrouped(ym);
    const resolver = s.getCategoryResolver();
    timeline = A.buildTimeline(ym, grouped, A.todayKey(), undefined, resolver);
  });
  const monthRows = timeline.reduce((sum, d) => sum + d.bills.length, 0);
  check(counts['categories.json'] === 1,
    'G7 当月 Timeline（' + monthRows + ' 条）只读取 categories.json 1 次（实际 ' + counts['categories.json'] + '）');
  check(monthRows > 0, '当月 Timeline 有渲染数据');

  // 3) 统计月概览 / 日趋势 / 分类排行
  const monthStat = timed('统计月全套', () => {
    const bills = s.rangeBills(ym, ym);
    const resolver = s.getCategoryResolver();
    const [y, m] = ym.split('-').map(Number);
    M.computeMonthOverview(bills);
    M.computeDailyExpenseTrend(bills, y, m);
    M.computeCategoryRanking(bills, resolver);
  });

  // 4) 年度统计
  const year = new Date().getFullYear();
  const yearStat = timed('年度统计', () => {
    const bills = s.rangeBills(year + '-01', year + '-12');
    Y.computeYearOverview(bills, year);
    Y.computeMonthlyTrend(bills, year);
    Y.computeYearCategoryRanking(bills, s.getCategoryResolver());
  });

  // 5) 预算日历（当月，即使无规则也遍历整月日期 + 账单）
  const budget = timed('预算日历', () => s.buildBudgetCalendar(year, Number(ym.split('-')[1]), A.todayKey()));
  check(Array.isArray(budget.value.days) || !!budget.value, '预算日历正常返回');

  // 6) 全量关键字搜索
  const search = timed('全量搜索「咖啡」', () => {
    const resolver = s.getCategoryResolver();
    const key = '咖啡';
    return s.rangeBills().filter((b) => {
      if (b.ledgerImpact === 'daily-value-only') return false;
      const cat = resolver(b.categoryId);
      return [b.merchant || '', b.note || '', b.title || '', cat.name, cat.id].some((f) => f.indexOf(key) >= 0);
    });
  });
  check(search.value.length > 0, '搜索命中（' + search.value.length + ' 条）');

  // 7) 日价列表
  const dv = timed('日价列表', () => DV.computeDailyValueList(all, A.todayKey(), s.getCategoryResolver()));
  check(Array.isArray(dv.value), '日价列表正常返回');

  // 汇总打印
  const row = (k, v) => '    ' + k.padEnd(16, ' ') + v.ms + ' ms';
  console.log('  耗时（ms）：');
  console.log(row('写入', write));
  console.log(row('全量加载', range));
  console.log(row('当月 Timeline', month));
  console.log(row('统计月全套', monthStat));
  console.log(row('年度统计', yearStat));
  console.log(row('预算日历', budget));
  console.log(row('全量搜索', search));
  console.log(row('日价列表', dv));

  // 性能上限（宽松）
  const L = LIMITS[n];
  check(range.ms <= L.range, '全量加载 ' + range.ms + 'ms ≤ ' + L.range + 'ms');
  check(month.ms <= L.month, '当月 Timeline ' + month.ms + 'ms ≤ ' + L.month + 'ms');
  check(yearStat.ms <= L.year, '年度统计 ' + yearStat.ms + 'ms ≤ ' + L.year + 'ms');
  check(search.ms <= L.search, '全量搜索 ' + search.ms + 'ms ≤ ' + L.search + 'ms');
  check(budget.ms <= L.budget, '预算日历 ' + budget.ms + 'ms ≤ ' + L.budget + 'ms');
  check(dv.ms <= L.dv, '日价列表 ' + dv.ms + 'ms ≤ ' + L.dv + 'ms');

  return { n, range: range.ms, month: month.ms, year: yearStat.ms, search: search.ms, budget: budget.ms, dv: dv.ms };
}

const scales = [1000, 5000, 10000].map(runScale);

// 线性粗检：10k 全量耗时不超过 1k 的 40 倍（理论 10 倍；40 倍给抖动留余量，超了说明近似超线性）
const ratio = scales[2].range / Math.max(1, scales[0].range);
console.log('\n全量加载耗时 10k/1k 比值 = ' + ratio.toFixed(1) + 'x（期望 ≤ 40x）');
check(ratio <= 40, '全量加载近似线性（10k/1k=' + ratio.toFixed(1) + 'x）');

console.log('\n================ 总结 ================');
scales.forEach((r) => {
  console.log('  ' + r.n + ' 笔：全量 ' + r.range + 'ms / 当月 ' + r.month + 'ms / 年 ' + r.year + 'ms / 搜索 ' + r.search + 'ms');
});
if (failures > 0) {
  console.error('\n大账本性能 Gate 有 ' + failures + ' 项失败');
  process.exit(1);
}
console.log('\n大账本性能 Gate 通过（1k/5k/10k 无崩溃、口径正确、耗时在线性区间、分类快照生效）');
process.exit(0);
