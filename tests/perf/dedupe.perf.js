/**
 * tests/perf/dedupe.perf.js — v1.4.1 导入预览分阶段基线 / 验收
 *
 * 目的：把「导入预览」拆成可对比的四段，按同一数据、同一机器取中位数：
 *   parse    CSV 文本 → 二维行
 *   adapt    表头识别 + 行 → NormalizedBill
 *   validate 校验（validator.validateAll）
 *   dedupe   去重分类（store.rangeBills + classify）
 *
 * 用法：
 *   node tests/perf/dedupe.perf.js                        # 5k / 15k / 30k，5 轮中位
 *   node tests/perf/dedupe.perf.js --sizes 5000 --rounds 5
 *   node tests/perf/dedupe.perf.js --json out.json
 *
 * 口径：Node + 内存文件系统，不含真机 I/O / setData / 渲染。
 */
'use strict';
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ANCHOR = '2026-10-29';
const argv = process.argv.slice(2);
function argOf(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
}
const JSON_OUT = argOf('--json', '');
const ROUNDS = Math.max(3, Number(argOf('--rounds', 5)));
const SIZES = String(argOf('--sizes', '5000,15000,30000'))
  .split(',')
  .map((x) => Number(x.trim()))
  .filter((x) => x > 0);

const TIERS = {
  5000: { years: 3, density: 1.0 },
  15000: { years: 5, density: 1.5 },
  30000: { years: 7, density: 2.0 },
};
function tierOf(n) {
  return TIERS[n] || { years: Math.max(1, Math.round(n / 3000)), density: 1.2 };
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}
function median(xs) {
  const a = xs.slice().sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const fsm = {
    accessSync(p) {
      if (memFiles.has(p) || memDirs.has(p)) return;
      throw new Error('ENOENT');
    },
    mkdirSync(p, recursive) {
      if (recursive) {
        let cur = '';
        p.split('/').forEach((x, i) => {
          if (i === 0 && x === '') cur = '';
          else {
            cur = cur + '/' + x;
            memDirs.add(cur);
          }
        });
      } else memDirs.add(p);
    },
    readFileSync(p, enc) {
      if (!memFiles.has(p)) throw new Error('ENOENT ' + p);
      const v = memFiles.get(p);
      if (enc) return v.toString(enc);
      return Buffer.from(v);
    },
    writeFileSync(p, data) {
      let buf;
      if (typeof data === 'string') buf = Buffer.from(data, 'utf8');
      else if (Buffer.isBuffer(data)) buf = Buffer.from(data);
      else if (data instanceof ArrayBuffer) buf = Buffer.from(new Uint8Array(data));
      else buf = Buffer.from(String(data), 'utf8');
      memFiles.set(p, buf);
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
        const i = rest.indexOf('/');
        out.add(i < 0 ? rest : rest.slice(0, i));
      };
      memFiles.forEach((v, k) => add(k));
      memDirs.forEach((k) => add(k));
      return [...out];
    },
  };
  const storage = {};
  return {
    env: { USER_DATA_PATH: '/usr' },
    getFileSystemManager: () => fsm,
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => {
      storage[k] = v;
    },
    getAppBaseInfo: () => ({ theme: 'dark' }),
  };
}

const gen = require(path.join(ROOT, 'scripts', 'generate-realistic-ledger'));

function buildBackup(count) {
  const tier = tierOf(count);
  const result = gen.Generator({
    years: tier.years,
    count: count,
    density: tier.density,
    seed: 20261029,
    anchor: ANCHOR,
  });
  return {
    format: 'daily-value-mini-backup',
    schemaVersion: 3,
    appVersion: '1.4.0',
    exportedAt: new Date(2026, 9, 29, 12, 0, 0).toISOString(),
    data: {
      bills: result.bills,
      categories: gen.buildCategories(),
      settings: {
        currency: '¥',
        theme: 'dark',
        budget: gen.buildBudget(2026 - tier.years),
        statistics: { version: 1, modules: [] },
      },
      recurringRules: gen.buildRecurringRules({ y: 2026, m: 10, d: 29 }),
    },
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}
function buildAlipayCsv(rows) {
  const head = '交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注';
  const lines = [head];
  const cats = ['餐饮美食', '交通出行', '日用百货', '文化休闲'];
  for (let i = 0; i < rows; i++) {
    const d = new Date(2026, 9, 1 + (i % 28), 8 + (i % 12), i % 60, 0);
    const ts =
      d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    lines.push(
      [ts, cats[i % 4], '商户' + (i % 40), '', '商品' + (i % 17), '支出',
        (10 + (i % 500)) + '.00', '余额宝', '交易成功', '2026' + (100000 + i), '', ''].join(',')
    );
  }
  return lines.join('\n');
}

// 数据层在 require 期就会读 wx.env.USER_DATA_PATH，必须先装好内存 wx
global.wx = buildWx();

const csv = require(path.join(ROOT, 'packages', 'importer', 'encoding', 'csv'));
const alipay = require(path.join(ROOT, 'packages', 'importer', 'adapters', 'alipay'));
const validator = require(path.join(ROOT, 'packages', 'importer', 'core', 'validator'));
const dedupe = require(path.join(ROOT, 'packages', 'importer', 'core', 'dedupe'));

const CSV_TEXT = buildAlipayCsv(3000);

function runSize(count) {
  global.wx = buildWx();
  // 数据层每次调用都经 wx.getFileSystemManager() 取当前 FS，换 wx 即可隔离账本
  const store = require(path.join(ROOT, 'data', 'index'));
  store.init();
  store.restoreBackup(buildBackup(count));

  // 预解析一次，后续阶段各自重复计时
  const rows = csv.parseCSV(CSV_TEXT);
  const bills = alipay.parseRows(rows, 'alipay');
  const validated = validator.validateAll(bills);

  const t = { parse: [], adapt: [], validate: [], dedupe: [] };
  let status = null;
  let stats = null;
  const heapBefore = process.memoryUsage().heapUsed;
  for (let r = 0; r < ROUNDS; r++) {
    let t0 = nowMs();
    const rows2 = csv.parseCSV(CSV_TEXT);
    t.parse.push(nowMs() - t0);

    t0 = nowMs();
    const bills2 = alipay.parseRows(rows2, 'alipay');
    t.adapt.push(nowMs() - t0);

    t0 = nowMs();
    const validated2 = validator.validateAll(bills2);
    t.validate.push(nowMs() - t0);

    t0 = nowMs();
    const classified = dedupe.classify(validated2);
    t.dedupe.push(nowMs() - t0);
    status = dedupe.countByStatus(classified);
    stats = dedupe.lastStats || stats;
  }
  const heapAfter = process.memoryUsage().heapUsed;

  const med = (xs) => median(xs);
  return {
    count,
    months: store.listMonths().length,
    rows: rows.length,
    bills: bills.length,
    status,
    indexStats: stats,
    parseMs: med(t.parse),
    adaptMs: med(t.adapt),
    validateMs: med(t.validate),
    dedupeMs: med(t.dedupe),
    totalMs: med(t.parse) + med(t.adapt) + med(t.validate) + med(t.dedupe),
    heapBeforeMB: Number((heapBefore / 1048576).toFixed(1)),
    heapAfterMB: Number((heapAfter / 1048576).toFixed(1)),
    heapDeltaMB: Number(((heapAfter - heapBefore) / 1048576).toFixed(1)),
    rounds: ROUNDS,
    raw: t,
  };
}

const out = [];
console.log('==== v1.4.1 导入预览分阶段基线（3,000 行；' + ROUNDS + ' 轮中位）====');
SIZES.forEach((n) => {
  const r = runSize(n);
  out.push(r);
  console.log(
    '\n账本 ' + n.toLocaleString() + ' 笔 / ' + r.months + ' 分片' +
    '\n  parse=' + r.parseMs.toFixed(1) + 'ms  adapt=' + r.adaptMs.toFixed(1) +
    'ms  validate=' + r.validateMs.toFixed(1) + 'ms  dedupe=' + r.dedupeMs.toFixed(1) +
    'ms  合计=' + r.totalMs.toFixed(1) + 'ms' +
    '\n  status=' + JSON.stringify(r.status) +
    '  heap=' + r.heapBeforeMB + '→' + r.heapAfterMB + 'MB（Δ' + r.heapDeltaMB + 'MB）'
  );
  if (r.indexStats) {
    console.log('  index=' + JSON.stringify(r.indexStats));
  }
});

if (JSON_OUT) {
  require('fs').writeFileSync(
    JSON_OUT,
    JSON.stringify({ node: process.version, rounds: ROUNDS, sizes: out }, null, 2)
  );
  console.log('\nJSON 已写入：' + JSON_OUT);
}
