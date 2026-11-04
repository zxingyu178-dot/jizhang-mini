#!/usr/bin/env node
/**
 * tests/perf/v1.4.0-keypath.perf.js — v1.4.0 Gate 5 关键路径打点（5k / 15k / 30k）
 *
 * 目的：在**同一脚本、同一数据、同一机器**下量化 v1.4.0 关键路径耗时，并可与
 *   v1.3.6（c7cf85d）逐项对照（把本文件复制进旧版本 worktree 直接跑即可，
 *   本脚本只 require 两个版本都存在的模块，缺函数时该项记 `n/a` 而不是崩）。
 *
 * 重要边界（报告里必须照抄，不许当"真机性能"汇报）：
 *   - 全部在 Node + 内存文件系统上跑，**不含**真机 I/O、setData、WXML 渲染、
 *     图片解码、Skyline/WebView 差异；数字只用于「同一环境下的相对对照与退化检测」。
 *   - 长列表 / 圆环 / 滚动的真实帧率无法在 Node 里测：这里只测**它们的纯计算与
 *     payload 构建**耗时（圆环 SVG 生成、base64 编码、Timeline 行构建、payload 字节数）。
 *
 * 打点项：冷启动 / 首页切换 / 统计面板首次进入 / 月度统计 / 年度统计 /
 *        圆环绘制（纯函数）/ 长账单列表构建 / 搜索 / 导入预览 / 主题切换
 * 同时记录每个动作的**月份分片读取次数**（用于判定「是否全量扫账」）。
 *
 * 用法：
 *   node tests/perf/v1.4.0-keypath.perf.js                 # 表格输出
 *   node tests/perf/v1.4.0-keypath.perf.js --json out.json # 同时写机器可读结果
 *   node tests/perf/v1.4.0-keypath.perf.js --sizes 5000    # 只跑指定规模
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const ANCHOR = '2026-10-29';
const TODAY = ANCHOR;

/* ============================ 参数 ============================ */
const argv = process.argv.slice(2);
function argOf(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
}
const JSON_OUT = argOf('--json', '');
const SIZES = String(argOf('--sizes', '5000,15000,30000'))
  .split(',')
  .map((x) => Number(x.trim()))
  .filter((x) => x > 0);

/**
 * 规模档位：账单数 / 时间跨度 / 月密度。
 * 15k、30k 用更长跨度与更高密度，贴近「长期使用」而不是「同一个月堆 3 万笔」。
 */
const TIERS = {
  5000: { years: 3, density: 1.0 },
  15000: { years: 5, density: 1.5 },
  30000: { years: 7, density: 2.0 },
};
function tierOf(count) {
  for (const k of Object.keys(TIERS)) {
    if (Number(k) === count) return TIERS[k];
  }
  // 未知规模：按 3000 笔/年粗估跨度
  return { years: Math.max(1, Math.round(count / 3000)), density: 1.2 };
}

/* ============================ 内存 wx（含分片读取计数） ============================ */
function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const storage = {};
  const stats = { totalReads: 0, shardReads: 0, shardSet: new Set(), bytesRead: 0 };
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
          else {
            cur = cur + '/' + x;
            memDirs.add(cur);
          }
        });
      } else memDirs.add(p);
    },
    readFileSync(p) {
      stats.totalReads += 1;
      const m = SHARD_RE.exec(String(p));
      if (m) {
        stats.shardReads += 1;
        stats.shardSet.add(m[1]);
      }
      if (!memFiles.has(p)) throw new Error('ENOENT ' + p);
      const v = memFiles.get(p);
      if (typeof v === 'string') stats.bytesRead += Buffer.byteLength(v);
      return v;
    },
    writeFileSync(p, data) {
      memFiles.set(p, typeof data === 'string' ? data : String(data));
    },
    unlinkSync(p) {
      if (!memFiles.has(p)) throw new Error('ENOENT');
      memFiles.delete(p);
    },
    renameSync(a, b) {
      if (!memFiles.has(a)) throw new Error('ENOENT ' + a);
      if (memFiles.has(b)) throw new Error('file exists ' + b);
      memFiles.set(b, memFiles.get(a));
      memFiles.delete(a);
    },
    readdirSync(p) {
      const prefix = p.endsWith('/') ? p : p + '/';
      const out = new Set();
      const add = (k) => {
        if (k.indexOf(prefix) !== 0) return;
        const rest = k.slice(prefix.length);
        if (!rest) return;
        const idx = rest.indexOf('/');
        out.add(idx < 0 ? rest : rest.slice(0, idx));
      };
      memFiles.forEach((v, k) => add(k));
      memDirs.forEach((k) => add(k));
      return [...out];
    },
  };
  const wxObj = {
    env: { USER_DATA_PATH: '/usr' },
    getFileSystemManager: () => fsm,
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => {
      storage[k] = v;
    },
    getAppBaseInfo: () => ({ theme: 'dark' }),
  };
  return {
    wx: wxObj,
    resetStats() {
      stats.totalReads = 0;
      stats.shardReads = 0;
      stats.shardSet.clear();
      stats.bytesRead = 0;
    },
    shardCount: () => stats.shardSet.size,
    totalReads: () => stats.totalReads,
    bytesRead: () => stats.bytesRead,
    fileCount: () => memFiles.size,
  };
}

let env = buildWx();
global.wx = env.wx;

/* ============================ 依赖（旧版本缺函数时降级 n/a） ============================ */
const gen = require(path.join(ROOT, 'scripts', 'generate-realistic-ledger'));
const store = require(path.join(ROOT, 'data', 'index'));
const A = require(path.join(ROOT, 'data', 'accounting'));
const M = require(path.join(ROOT, 'data', 'statistics', 'month'));
const Y = require(path.join(ROOT, 'data', 'statistics', 'year'));
const donut = require(path.join(ROOT, 'data', 'statistics', 'donut'));
const money = require(path.join(ROOT, 'data', 'money'));
const DV = require(path.join(ROOT, 'data', 'daily-value', 'index'));
const theme = require(path.join(ROOT, 'utils', 'theme'));
const b64 = require(path.join(ROOT, 'utils', 'b64'));

function opt(obj, name) {
  return obj && typeof obj[name] === 'function' ? obj[name] : null;
}

/* ============================ 计时工具 ============================ */
function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}
function median(xs) {
  const a = xs.slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * 跑 N 次取中位数；每次跑完记录分片读取次数（取第一次，代表一次动作的成本）。
 * fn 必须是幂等只读（不写账本），否则会污染后续测量。
 */
function measure(fn, repeat) {
  const n = repeat || 3;
  const times = [];
  let shards = null;
  let reads = null;
  let bytes = null;
  let value;
  for (let i = 0; i < n; i++) {
    env.resetStats();
    const t0 = nowMs();
    value = fn();
    times.push(nowMs() - t0);
    if (i === 0) {
      shards = env.shardCount();
      reads = env.totalReads();
      bytes = env.bytesRead();
    }
  }
  return { ms: median(times), runs: times, shardReads: shards, fileReads: reads, bytesRead: bytes, value };
}

/* ============================ 造数据 ============================ */
function buildBackup(count) {
  const tier = tierOf(count);
  const result = gen.Generator({
    years: tier.years,
    count: count,
    density: tier.density,
    seed: 20261029,
    anchor: ANCHOR,
  });
  const categories = gen.buildCategories();
  const recurringRules = gen.buildRecurringRules({ y: 2026, m: 10, d: 29 });
  const budget = gen.buildBudget(2026 - tier.years);
  return {
    format: 'daily-value-mini-backup',
    schemaVersion: 3,
    appVersion: '1.3.0',
    exportedAt: new Date(2026, 9, 29, 12, 0, 0).toISOString(),
    data: {
      bills: result.bills,
      categories: categories,
      settings: { currency: '¥', theme: 'dark', budget: budget, statistics: { version: 1, modules: [] } },
      recurringRules: recurringRules,
    },
    __months: result.months.length,
  };
}

/** 导入预览用 CSV：支付宝个人对账表头 + N 行虚构交易 */
function buildAlipayCsv(rows) {
  const head = '交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注';
  const lines = [head];
  const cats = ['餐饮美食', '交通出行', '日用百货', '文化休闲'];
  for (let i = 0; i < rows; i++) {
    const d = new Date(2026, 9, 1 + (i % 28), 8 + (i % 12), i % 60, 0);
    const ts = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    lines.push(
      [ts, cats[i % cats.length], '商户' + (i % 40), '', '商品' + (i % 17), '支出',
        (10 + (i % 500)) + '.00', '余额宝', '交易成功', '2026' + (100000 + i), '', ''].join(',')
    );
  }
  return lines.join('\n');
}
function pad2(n) {
  return String(n).padStart(2, '0');
}

/* ============================ 关键路径定义 ============================ */
/** 统计面板 loadMonth（数据层等价路径：不含 setData / WXML 渲染） */
function statisticsLoadMonth(ym, config) {
  const bills = store.rangeBills(ym, ym);
  const resolveCategory = store.getCategoryResolver();
  const [y, m] = ym.split('-').map(Number);
  const on = (id) => config.modules.indexOf(id) >= 0;
  const out = {};
  out.ov = M.computeMonthOverview(bills);
  out.topDay = M.findTopExpenseDay(bills, y, m);
  out.dailyAvg = M.computeDailyAverageExpense(bills, y, m, new Date(2026, 9, 29));
  out.largest = M.findLargestExpense(bills);
  if (on('category-share')) {
    out.share = M.computeCategoryShare(bills, resolveCategory);
    out.shareSegs = donut.resolveSegmentColors(out.share.segments, 'dark');
    out.shareList = out.shareSegs.map((x) => Object.assign({}, x, { centsText: money.formatCents(x.cents) }));
  }
  if (on('daily-expense-trend')) out.daily = M.computeDailyExpenseTrend(bills, y, m).points;
  if (on('income-expense-compare')) out.cmp = M.computeIncomeExpenseCompare(bills);
  if (on('budget-analysis') && store.getBudgetState().rules.length) {
    out.calendar = store.buildBudgetCalendar(y, m, TODAY);
    out.pace = store.buildBudgetMonthPace(y, m, TODAY);
  }
  return out;
}

/** 统计面板 loadYear（数据层等价路径） */
function statisticsLoadYear(year) {
  const yb = store.rangeBills(year + '-01', year + '-12');
  const resolveCategory = store.getCategoryResolver();
  const out = {};
  out.ov = Y.computeYearOverview(yb, year);
  out.trend = Y.computeMonthlyTrend(yb, year);
  out.rank = Y.computeYearCategoryRanking(yb, resolveCategory);
  out.share = M.computeCategoryShare(yb, resolveCategory);
  out.largest = M.findLargestExpense(yb);
  return out;
}

/** 记账面板 loadData（数据层等价路径，首页切换 / 冷启动都会走） */
function accountingLoadMonth(ym) {
  const cur = A.currentYM(new Date(2026, 9, 29));
  const monthList = A.buildMonthList(store.listAccountingMonths(), cur);
  const active = monthList.indexOf(ym) >= 0 ? ym : cur;
  const summary = store.monthSummary(active);
  const grouped = store.monthGrouped(active);
  const resolveCategory = store.getCategoryResolver();
  const timeline = A.buildTimeline(active, grouped, TODAY, undefined, resolveCategory);
  return { monthList: monthList, summary: summary, timeline: timeline };
}

/* ============================ 单规模测量 ============================ */
function runSize(count) {
  console.log('\n==================== ' + count.toLocaleString() + ' 笔 ====================');
  env = buildWx();
  global.wx = env.wx;
  const backup = buildBackup(count);
  const t0 = nowMs();
  store.init();
  const initMs = nowMs() - t0;
  const restoreT0 = nowMs();
  const restored = store.restoreBackup(backup);
  const restoreMs = nowMs() - restoreT0;
  const months = restored.months.length;
  console.log('  造数据：' + restored.restored + ' 笔 / ' + months + ' 个月分片；init=' +
    initMs.toFixed(0) + 'ms，restore=' + restoreMs.toFixed(0) + 'ms（仅造数，不计入关键路径）');

  const config = { modules: store.getSettings().statistics.modules };
  const curYM = A.currentYM(new Date(2026, 9, 29));

  const R = {};

  /* 0) App 冷启动自检（onLaunch：本地完整性扫描 + init） */
  const si = require(path.join(ROOT, 'data', 'storage-integrity'));
  R.appLaunch = measure(() => {
    const scan = si.scanStorage();
    store.init();
    return { ok: scan.ok, entries: scan.all.length };
  });

  /* 1) 冷启动首屏：记账面板 + 统计面板首次进入（单次，不做重复取中位） */
  env.resetStats();
  const coldT0 = nowMs();
  const coldAcc = accountingLoadMonth(curYM);
  const coldStat = statisticsLoadMonth(curYM, config);
  const coldMs = nowMs() - coldT0;
  R.coldStart = {
    ms: coldMs,
    runs: [coldMs],
    shardReads: env.shardCount(),
    fileReads: env.totalReads(),
    note: '首屏记账面板 + 统计面板首次进入（init 已在造数阶段完成）',
    rows: coldAcc.timeline.reduce((s, d) => s + d.bills.length, 0),
    statSegs: (coldStat.shareSegs || []).length,
  };

  /* 2) 首页切换（onShow → refreshPanels）：记账 + 统计 + 日价三块 */
  R.homeSwitch = measure(() => {
    const acc = accountingLoadMonth(curYM);
    const stat = statisticsLoadMonth(curYM, config);
    const all = store.rangeBills();
    const dv = DV.computeDailyValueList(all, TODAY, store.getCategoryResolver());
    return { tabs: acc.timeline.length, dv: dv.length };
  });

  /* 3) 统计面板首次进入（activate → loadMonth，含预算模块） */
  R.statisticsFirstEntry = measure(() => statisticsLoadMonth(curYM, config));

  /* 4) 月度统计（切月：rangeBills 单月 + 全套统计） */
  R.monthStat = measure(() => statisticsLoadMonth('2026-09', config));

  /* 5) 年度统计 */
  R.yearStat = measure(() => statisticsLoadYear(2026));

  /* 6) 圆环绘制（纯函数：segments → SVG → base64；8 段） */
  const share = M.computeCategoryShare(store.rangeBills(curYM, curYM), store.getCategoryResolver());
  const segs = donut.resolveSegmentColors(share.segments, 'dark');
  R.donutDraw = measure(() => {
    const svg = donut.buildDonutSVG(segs, 'rgba(255,255,255,0.10)', -1, 'dark');
    const uri = 'data:image/svg+xml;base64,' + b64.b64encodeAscii(svg);
    return { svgLen: svg.length, uriLen: uri.length };
  });

  /* 7) 长账单列表构建（当月 Timeline 行 + payload 字节数） */
  const longestYM = (() => {
    let best = curYM;
    let bestN = -1;
    restored.months.forEach((ym) => {
      const n = store.monthGrouped(ym).reduce((s, g) => s + g.bills.length, 0);
      if (n > bestN) {
        bestN = n;
        best = ym;
      }
    });
    return { ym: best, n: bestN };
  })();
  R.longList = measure(() => {
    const grouped = store.monthGrouped(longestYM.ym);
    const rows = A.buildTimeline(longestYM.ym, grouped, TODAY, undefined, store.getCategoryResolver());
    return { rows: rows.length, payloadBytes: JSON.stringify(rows).length, bills: longestYM.n };
  });

  /* 8) 搜索（全量 keyword 扫描） */
  R.search = measure(() => store.searchBills({ keyword: '咖啡' }));

  /* 9) 导入预览（CSV 解析 → adapter → 校验 → 去重分类；3000 行） */
  const csvText = buildAlipayCsv(3000);
  const csv = require(path.join(ROOT, 'packages', 'importer', 'encoding', 'csv'));
  const alipay = require(path.join(ROOT, 'packages', 'importer', 'adapters', 'alipay'));
  const validator = require(path.join(ROOT, 'packages', 'importer', 'core', 'validator'));
  const dedupe = require(path.join(ROOT, 'packages', 'importer', 'core', 'dedupe'));
  R.importPreview = measure(
    () => {
      const rows = csv.parseCSV(csvText);
      // adapter 自己找表头行（rows 含表头，不切片）
      const bills = alipay.parseRows(rows, 'alipay');
      const validated = validator.validateAll(bills);
      // classify 内部会 store.rangeBills() 全量读一次 + 逐条 findSuspect 线性扫
      const classified = dedupe.classify(validated);
      return { rows: rows.length, bills: bills.length, status: dedupe.countByStatus(classified) };
    },
    2
  );

  /* 10) 主题切换（reloadFromStorage + 圆环/图例重取色，不重读账本） */
  R.themeSwitch = measure(() => {
    theme.reloadFromStorage();
    const key = theme.getEffectiveTheme() === 'light' ? 'light' : 'dark';
    const colored = donut.resolveSegmentColors(share.segments, key);
    return colored.map((x) => Object.assign({}, x, { centsText: money.formatCents(x.cents) }));
  });

  /* ---- 规模信息 ---- */
  const meta = {
    count: count,
    months: months,
    files: env.fileCount(),
    initMs: initMs,
    restoreMs: restoreMs,
    longestMonth: longestYM,
  };

  /* ---- 输出 ---- */
  const rowsOut = [];
  const order = [
    ['appLaunch', 'App冷启动自检'],
    ['coldStart', '冷启动首屏'],
    ['homeSwitch', '首页切换'],
    ['statisticsFirstEntry', '统计面板首次进入'],
    ['monthStat', '月度统计'],
    ['yearStat', '年度统计'],
    ['donutDraw', '圆环绘制(纯函数)'],
    ['longList', '长列表构建'],
    ['search', '搜索'],
    ['importPreview', '导入预览(3k行)'],
    ['themeSwitch', '主题切换'],
  ];
  console.log('  ' + pad('路径', 20) + pad('中位耗时', 12) + pad('分片读取', 10) + '文件读取');
  order.forEach(([k, label]) => {
    const r = R[k];
    if (!r) return;
    console.log(
      '  ' + pad(label, 20) + pad(r.ms.toFixed(1) + 'ms', 12) +
      pad(String(r.shardReads), 10) + String(r.fileReads)
    );
    rowsOut.push({ key: k, label: label, ms: r.ms, shardReads: r.shardReads, fileReads: r.fileReads });
  });

  // JSON 里只留摘要（不塞整份账单，避免报告文件几百 KB）
  const rawOut = {};
  order.forEach(([k]) => {
    const r = R[k];
    if (!r) return;
    rawOut[k] = {
      ms: r.ms,
      runs: r.runs,
      shardReads: r.shardReads,
      fileReads: r.fileReads,
      bytesRead: r.bytesRead,
      info: summarize(k, r.value !== undefined ? r.value : r),
      note: r.note || '',
    };
  });

  return { meta: meta, rows: rowsOut, raw: rawOut, env: { months: months }, measuredAt: new Date().toISOString() };
}function pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

/* ============================ 输出瘦身（JSON 里只留摘要，不塞整份账单） ============================ */
function summarize(key, value) {
  if (value == null) return null;
  try {
    if (key === 'appLaunch') return value;
    if (key === 'coldStart') return { timelineRows: value.rows, statSegs: value.statSegs };
    if (key === 'homeSwitch') return { timelineDays: value.tabs, dvItems: value.dv };
    if (key === 'statisticsFirstEntry' || key === 'monthStat') {
      return { count: value.ov && value.ov.count, segs: (value.shareSegs || []).length };
    }
    if (key === 'yearStat') return { count: value.ov && value.ov.count, months: (value.trend && value.trend.points || []).length };
    if (key === 'donutDraw') return { svgLen: value.svgLen, uriLen: value.uriLen };
    if (key === 'longList') return { rows: value.rows, bills: value.bills, payloadBytes: value.payloadBytes };
    if (key === 'search') return { hits: Array.isArray(value) ? value.length : null };
    if (key === 'importPreview') return value.status || null;
    if (key === 'themeSwitch') return { rows: Array.isArray(value) ? value.length : null };
    return null;
  } catch (e) {
    return null;
  }
}

/* ============================ 主流程 ============================ */
const report = {
  script: 'tests/perf/v1.4.0-keypath.perf.js',
  measuredAt: new Date().toISOString(),
  node: process.version,
  platform: os.platform() + ' ' + os.release(),
  cpus: (os.cpus()[0] || {}).model || 'unknown',
  mode: 'node + in-memory FS（不含真机 I/O / setData / 渲染）',
  anchor: ANCHOR,
  sizes: [],
};

SIZES.forEach((size) => {
  try {
    report.sizes.push(runSize(size));
  } catch (e) {
    console.error('  规模 ' + size + ' 测量失败：' + (e && e.message));
    console.error(e && e.stack);
    report.sizes.push({ meta: { count: size, error: String(e && e.message) }, rows: [] });
  }
});

console.log('\n==================== 机器可读结果 ====================');
const jsonLine = JSON.stringify(report);
if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  console.log('已写入 ' + JSON_OUT);
}
console.log('###JSON###' + jsonLine);
