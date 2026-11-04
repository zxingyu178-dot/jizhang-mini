#!/usr/bin/env node
/**
 * tests/perf/compare-keypath.js — 把多轮 keypath 结果聚合成对照表
 *
 * 用法：
 *   node tests/perf/compare-keypath.js --a head-1.json,head-2.json,head-3.json \
 *                                      --b v136-1.json,v136-2.json,v136-3.json \
 *                                      [--label-a HEAD] [--label-b v1.3.6]
 *
 * 聚合口径：每个 (规模, 路径) 先在各轮内取该轮的中位数，再对多轮取中位数
 * （双中位数，抗单次抖动）；差值 < 15% 一律标注「≈（抖动内）」，避免拿噪点当结论。
 */
'use strict';
const fs = require('fs');

const argv = process.argv.slice(2);
function argOf(n, d) {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
}
const A_FILES = String(argOf('--a', '')).split(',').filter(Boolean);
const B_FILES = String(argOf('--b', '')).split(',').filter(Boolean);
const LABEL_A = argOf('--label-a', 'A');
const LABEL_B = argOf('--label-b', 'B');

function load(files) {
  const runs = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  const out = {}; // key = size|path
  runs.forEach((r) => {
    (r.sizes || []).forEach((s) => {
      const size = s.meta && s.meta.count;
      (s.rows || []).forEach((row) => {
        const k = size + '|' + row.key;
        if (!out[k]) out[k] = { size: size, key: row.key, label: row.label, ms: [], shards: [] };
        out[k].ms.push(row.ms);
        out[k].shards.push(row.shardReads);
      });
    });
  });
  return { runs: runs.length, byKey: out };
}
function median(xs) {
  const a = xs.slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

const a = load(A_FILES);
const b = load(B_FILES);
const sizes = [...new Set(Object.keys(a.byKey).map((k) => Number(k.split('|')[0])))].sort((x, y) => x - y);
const ORDER = [
  'appLaunch',
  'coldStart',
  'homeSwitch',
  'statisticsFirstEntry',
  'monthStat',
  'yearStat',
  'donutDraw',
  'longList',
  'search',
  'importPreview',
  'themeSwitch',
];

console.log('对照：' + LABEL_A + '（' + a.runs + ' 轮） vs ' + LABEL_B + '（' + b.runs + ' 轮）');
console.log('口径：双中位数（轮内中位 → 多轮中位）；差值 <15% 视为抖动内\n');

sizes.forEach((size) => {
  console.log('== ' + size.toLocaleString() + ' 笔 ==');
  console.log(
    '  ' + pad('路径', 20) + pad(LABEL_A, 14) + pad(LABEL_B, 14) + pad('差值', 14) + '判定'
  );
  ORDER.forEach((key) => {
    const ka = a.byKey[size + '|' + key];
    const kb = b.byKey[size + '|' + key];
    if (!ka && !kb) return;
    const ma = ka ? median(ka.ms) : null;
    const mb = kb ? median(kb.ms) : null;
    const label = (ka && ka.label) || (kb && kb.label) || key;
    let delta = '';
    let verdict = '';
    if (ma != null && mb != null && mb > 0.05) {
      const pct = ((ma - mb) / mb) * 100;
      delta = (pct >= 0 ? '+' : '') + pct.toFixed(0) + '%';
      verdict = Math.abs(pct) < 15 ? '≈（抖动内）' : pct < 0 ? '更快' : '更慢';
    } else if (ma != null && mb == null) {
      verdict = 'B 无此项';
    }
    console.log(
      '  ' + pad(label, 20) +
      pad(ma == null ? 'n/a' : ma.toFixed(1) + 'ms', 14) +
      pad(mb == null ? 'n/a' : mb.toFixed(1) + 'ms', 14) +
      pad(delta, 14) + verdict
    );
  });
  console.log('');
});
