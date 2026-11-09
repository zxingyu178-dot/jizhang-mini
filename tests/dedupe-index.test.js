/**
 * tests/dedupe-index.test.js — v1.4.1 Gate 2 去重索引差分测试
 *
 * 核心要求：索引优化**不改变任何分类结果**。
 *   - 文件内保留旧算法 classifyReference() 作为 reference oracle；
 *   - 固定用例覆盖任务书 17 类场景；
 *   - 固定随机种子生成多批账单做差分（数量、顺序、status/statusReason/
 *     existingId/mergePatch 全字段一致）。
 *
 * 运行：node tests/dedupe-index.test.js
 */
'use strict';

const path = require('path');
const assert = require('assert');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.error('  FAIL: ' + name + ' → ' + (e && e.message ? e.message : e));
  }
}

const ROOT = path.join(__dirname, '..');

/* ---------- mock data/index：rangeBills 返回当前测试账本 ---------- */
let EXISTING = [];
const storePath = require.resolve(path.join(ROOT, 'data', 'index.js'));
require.cache[storePath] = {
  id: storePath,
  filename: storePath,
  loaded: true,
  exports: {
    rangeBills() {
      return EXISTING;
    },
  },
};

const dedupe = require(path.join(ROOT, 'packages', 'importer', 'core', 'dedupe'));
const { makeFingerprint } = require(path.join(ROOT, 'packages', 'importer', 'core', 'normalizer'));

const TIME_WINDOW = 5 * 60 * 1000;

function withStatus(b, status, reason) {
  return Object.assign({}, b, { status, statusReason: reason });
}

function sameMinute(ts1, ts2) {
  return Math.floor(ts1 / 60000) === Math.floor(ts2 / 60000);
}

/**
 * 旧算法（v1.4.0 classify 的原样拷贝）——仅作为 reference oracle，生产代码不再使用。
 */
function classifyReference(bills, existing) {
  const existingTxn = new Set();
  const existingByTxn = new Map();
  const existingFp = new Set();
  existing.forEach((b) => {
    if (b.sourceTxnId) {
      existingTxn.add(b.sourceTxnId);
      existingByTxn.set(b.sourceTxnId, b);
    }
    existingFp.add(makeFingerprint(b));
  });
  const batchTxn = new Set();
  const batchFp = new Set();

  return bills.map((b) => {
    if (b.status === 'skipped') return b;

    if (b.source && b.sourceTxnId) {
      const key = b.source + ':' + b.sourceTxnId;
      if (existingTxn.has(key)) {
        const hit = existingByTxn.get(key);
        const patch = hit ? dedupe.buildMergePatch(hit, b) : null;
        if (patch) {
          return Object.assign({}, b, {
            status: 'merge',
            statusReason: '补充日价信息',
            existingId: hit.id,
            mergePatch: patch,
          });
        }
        return withStatus(b, 'existing', '账本已存在');
      }
      if (batchTxn.has(key)) return withStatus(b, 'duplicate', '文件内重复');
      batchTxn.add(key);

      if (b.source === 'dailyvalue') {
        const candidates = existing.filter((e) => {
          if (e.sourceTxnId) return false;
          if (e.type !== b.type) return false;
          if (e.amountCents !== b.amountCents) return false;
          if (e.categoryId !== b.categoryId) return false;
          if ((e.note || '') !== (b.note || '')) return false;
          if (!sameMinute(e.occurredAt, b.occurredAt)) return false;
          return true;
        });
        if (candidates.length > 1) {
          return withStatus(b, 'suspect', '匹配到多条可能账单，请确认是否为同一笔');
        }
        if (candidates.length === 1) {
          const patch = dedupe.buildMergePatch(candidates[0], b);
          if (patch) {
            return Object.assign({}, b, {
              status: 'merge',
              statusReason: '补充日价信息',
              existingId: candidates[0].id,
              mergePatch: patch,
            });
          }
          return withStatus(b, 'existing', '账本已存在');
        }
      }

      const suspect = existing.some((e) => {
        if (e.type !== b.type) return false;
        if (e.amountCents !== b.amountCents) return false;
        if (Math.abs(e.occurredAt - b.occurredAt) > TIME_WINDOW) return false;
        const em = (e.merchant || '').trim();
        const bm = (b.merchant || '').trim();
        if (em && bm && (em === bm || em.indexOf(bm) >= 0 || bm.indexOf(em) >= 0)) {
          return (e.source || 'manual') !== (b.source || '');
        }
        return false;
      });
      if (suspect) return withStatus(b, 'suspect', '疑似与已有账单重复');
      return b;
    }

    const fp = makeFingerprint(b);
    if (existingFp.has(fp)) return withStatus(b, 'existing', '账本已存在');
    if (batchFp.has(fp)) return withStatus(b, 'duplicate', '文件内重复');
    batchFp.add(fp);
    const suspect = existing.some((e) => {
      if (e.type !== b.type) return false;
      if (e.amountCents !== b.amountCents) return false;
      if (Math.abs(e.occurredAt - b.occurredAt) > TIME_WINDOW) return false;
      const em = (e.merchant || '').trim();
      const bm = (b.merchant || '').trim();
      if (em && bm && (em === bm || em.indexOf(bm) >= 0 || bm.indexOf(em) >= 0)) {
        return (e.source || 'manual') !== (b.source || '');
      }
      return false;
    });
    if (suspect) return withStatus(b, 'suspect', '疑似与已有账单重复');
    return b;
  });
}

const BILL_DEFAULTS = {
  type: 'expense',
  amountCents: 1000,
  categoryId: 'c-food',
  occurredAt: new Date(2026, 9, 10, 12, 0, 0).getTime(),
  title: '',
  merchant: '',
  note: '',
  source: 'alipay',
  sourceTxnId: '',
  status: 'ready',
  statusReason: '',
  dailyValue: null,
};
function bill(over) {
  return Object.assign({}, BILL_DEFAULTS, over);
}
function runPair(existing, incoming) {
  EXISTING = existing;
  const oldOut = classifyReference(incoming, existing);
  const newOut = dedupe.classify(incoming);
  return { oldOut, newOut };
}
function expectSame(name, existing, incoming) {
  check(name, () => {
    const { oldOut, newOut } = runPair(existing, incoming);
    assert.deepStrictEqual(newOut, oldOut, name + ' 分类结果与旧算法不一致');
    assert.deepStrictEqual(
      dedupe.countByStatus(newOut),
      { ready: 0, existing: 0, duplicate: 0, suspect: 0, skipped: 0, needconfirm: 0, merge: 0, ...countRef(oldOut) },
      name + ' 状态计数不一致'
    );
  });
}
function countRef(arr) {
  const c = {};
  arr.forEach((b) => {
    c[b.status] = (c[b.status] || 0) + 1;
  });
  return c;
}

/* ==================== 固定场景 ==================== */
console.log('固定场景（任务书 17 类）');

// 1 流水号精确重复
expectSame('1 流水号精确重复', [bill({ id: 'e1', sourceTxnId: 'alipay:1001' })], [
  bill({ sourceTxnId: '1001' }),
]);

// 2 文件内部重复
expectSame('2 文件内部重复', [], [
  bill({ sourceTxnId: '2001' }),
  bill({ sourceTxnId: '2001' }),
]);

// 3 fingerprint 重复
expectSame('3 fingerprint 重复', [bill({ id: 'e3', sourceTxnId: '' })], [
  bill({ source: '', sourceTxnId: '' }),
]);

// 4 五分钟以内疑似重复
expectSame('4 五分钟以内疑似重复', [
  bill({ id: 'e4', occurredAt: new Date(2026, 9, 10, 12, 2, 0).getTime(), merchant: '瑞幸咖啡', source: 'alipay' }),
], [bill({ occurredAt: new Date(2026, 9, 10, 12, 0, 0).getTime(), merchant: '瑞幸', source: 'dailyvalue', sourceTxnId: '3001' })]);

// 5 正好五分钟边界
expectSame('5 正好五分钟（应命中）', [
  bill({ id: 'e5', occurredAt: new Date(2026, 9, 10, 12, 5, 0).getTime(), merchant: '麦当劳', source: 'alipay' }),
], [bill({ occurredAt: new Date(2026, 9, 10, 12, 0, 0).getTime(), merchant: '麦当劳', source: 'dailyvalue', sourceTxnId: '3002' })]);

// 6 超过五分钟
expectSame('6 超过五分钟（不命中）', [
  bill({ id: 'e6', occurredAt: new Date(2026, 9, 10, 12, 5, 1).getTime(), merchant: '麦当劳', source: 'alipay' }),
], [bill({ occurredAt: new Date(2026, 9, 10, 12, 0, 0).getTime(), merchant: '麦当劳', source: 'dailyvalue', sourceTxnId: '3003' })]);

// 7 商户相同
expectSame('7 商户相同', [
  bill({ id: 'e7', merchant: '全家便利店', source: 'alipay' }),
], [bill({ merchant: '全家便利店', source: 'dailyvalue', sourceTxnId: '3004' })]);

// 8 商户包含关系
expectSame('8 商户包含关系', [
  bill({ id: 'e8', merchant: '全家便利店（朝阳店）', source: 'alipay' }),
], [bill({ merchant: '全家', source: 'dailyvalue', sourceTxnId: '3005' })]);

// 9 不同来源
expectSame('9 不同来源', [
  bill({ id: 'e9', merchant: '星巴克', source: 'alipay' }),
], [bill({ merchant: '星巴克', source: 'dailyvalue', sourceTxnId: '3006' })]);

// 10 相同来源（不应判 suspect）
expectSame('10 相同来源', [
  bill({ id: 'e10', merchant: '星巴克', source: 'alipay' }),
], [bill({ merchant: '星巴克', source: 'alipay', sourceTxnId: '3007' })]);

// 11 空商户
expectSame('11 空商户', [
  bill({ id: 'e11', merchant: '', source: 'alipay' }),
], [bill({ merchant: '', source: 'dailyvalue', sourceTxnId: '3008' })]);

// 12 CSV 唯一匹配（dailyvalue 无 id 命中本地无 id 账单）
expectSame('12 CSV 唯一匹配', [
  bill({ id: 'e12', source: '', sourceTxnId: '', merchant: '地铁', note: '通勤' }),
], [bill({ source: 'dailyvalue', sourceTxnId: 'c12', merchant: '地铁', note: '通勤', dailyValue: { enabled: true, startDate: '2026-10-10' } })]);

// 13 CSV 多条匹配 → suspect
expectSame('13 CSV 多条匹配', [
  bill({ id: 'e13a', source: '', sourceTxnId: '', merchant: '地铁', note: '通勤' }),
  bill({ id: 'e13b', source: '', sourceTxnId: '', merchant: '地铁', note: '通勤' }),
], [bill({ source: 'dailyvalue', sourceTxnId: 'c13', merchant: '地铁', note: '通勤' })]);

// 14 日价补充（merge）
expectSame('14 日价补充', [
  bill({ id: 'e14', sourceTxnId: 'alipay:3010', dailyValue: null }),
], [bill({ sourceTxnId: '3010', dailyValue: { enabled: true, startDate: '2026-10-01' } })]);

// 15 标题补充（merge）
expectSame('15 标题补充', [
  bill({ id: 'e15', sourceTxnId: 'alipay:3011', title: '' }),
], [bill({ sourceTxnId: '3011', title: '午餐' })]);

// 16 skipped 原样保留
expectSame('16 skipped 原样保留', [bill({ id: 'e16', sourceTxnId: '' })], [
  bill({ status: 'skipped', statusReason: '用户排除', source: '', sourceTxnId: '' }),
]);

// 17 无效时间戳回退
expectSame('17 无效时间戳回退', [
  bill({ id: 'e17', merchant: '同商户', occurredAt: NaN, source: 'alipay' }),
  bill({ id: 'e17b', merchant: '同商户', occurredAt: new Date(2026, 9, 10, 13, 0, 0).getTime(), source: 'alipay' }),
], [bill({ merchant: '同商户', occurredAt: new Date(2026, 9, 10, 20, 0, 0).getTime(), source: 'dailyvalue', sourceTxnId: '3012' })]);

/* ==================== 随机差分 ==================== */
console.log('随机差分（固定种子）');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}
function makeBills(rand, count, baseTs) {
  const types = ['expense', 'income'];
  const amounts = [100, 500, 1000, 1999, 2500];
  const merchants = ['', '瑞幸', '瑞幸咖啡', '全家', '全家便利店', '地铁', '老王'];
  const notes = ['', '早餐', '通勤'];
  const sources = ['alipay', 'wechat', 'dailyvalue', 'manual', ''];
  const out = [];
  for (let i = 0; i < count; i++) {
    const source = pick(rand, sources);
    const r = rand();
    let occurredAt;
    if (r < 0.08) occurredAt = NaN;
    else if (r < 0.16) occurredAt = baseTs + Math.floor(rand() * 11) * TIME_WINDOW - 5 * TIME_WINDOW;
    else occurredAt = baseTs + Math.floor(rand() * 600) * 1000;
    const hasTxn = source && rand() < 0.65;
    out.push(
      bill({
        id: 'r' + i,
        type: pick(rand, types),
        amountCents: pick(rand, amounts),
        categoryId: pick(rand, ['c-food', 'c-travel', 'c-shopping']),
        occurredAt: occurredAt,
        merchant: pick(rand, merchants),
        note: pick(rand, notes),
        title: rand() < 0.3 ? '标题' + (i % 3) : '',
        source: source,
        sourceTxnId: hasTxn ? String(1000 + Math.floor(rand() * 40)) : '',
        status: rand() < 0.05 ? 'skipped' : 'ready',
        dailyValue: rand() < 0.15 ? { enabled: true, startDate: '2026-10-01' } : null,
      })
    );
  }
  return out;
}

for (let seed = 1; seed <= 30; seed++) {
  check('随机差分 seed=' + seed, () => {
    const rand = mulberry32(seed);
    const base = new Date(2026, 9, 10, 12, 0, 0).getTime();
    const existing = makeBills(rand, Math.floor(rand() * 180), base).map((b, i) => {
      // 账本里的 sourceTxnId 带「来源:」前缀
      if (b.sourceTxnId && b.source) return Object.assign({}, b, { sourceTxnId: b.source + ':' + b.sourceTxnId });
      return Object.assign({}, b, { sourceTxnId: '' });
    });
    const incoming = makeBills(rand, 1 + Math.floor(rand() * 120), base).map((b) => {
      // 让一部分新账单精确命中既有流水号
      const hit = existing[Math.floor(rand() * Math.max(1, existing.length))];
      if (hit && hit.sourceTxnId && rand() < 0.35) {
        const prefix = hit.sourceTxnId.split(':')[0];
        return Object.assign({}, b, {
          source: prefix,
          sourceTxnId: hit.sourceTxnId.slice(prefix.length + 1),
        });
      }
      return b;
    });
    EXISTING = existing;
    const oldOut = classifyReference(incoming, existing);
    const newOut = dedupe.classify(incoming);
    assert.deepStrictEqual(newOut, oldOut, 'seed=' + seed + ' 分类结果不一致');
    assert.deepStrictEqual(countRef(newOut), countRef(oldOut), 'seed=' + seed + ' 计数不一致');
  });
}

/* ==================== 极端分布 ==================== */
console.log('极端分布');
check('极端：相同金额 + 相同时间桶', () => {
  const base = new Date(2026, 9, 10, 12, 0, 0).getTime();
  const existing = [];
  for (let i = 0; i < 200; i++) {
    existing.push(bill({ id: 'x' + i, merchant: '同商户', occurredAt: base + i * 1000, source: 'alipay' }));
  }
  const incoming = [];
  for (let i = 0; i < 100; i++) {
    incoming.push(bill({ occurredAt: base + i * 1000, merchant: '同商户', source: 'dailyvalue', sourceTxnId: 'z' + i }));
  }
  EXISTING = existing;
  const oldOut = classifyReference(incoming, existing);
  const newOut = dedupe.classify(incoming);
  assert.deepStrictEqual(newOut, oldOut, '极端分布结果不一致');
  assert.ok(dedupe.lastStats.maxBucketSize >= 200, '应记录最大候选桶');
});

check('极端：全部无效时间戳', () => {
  const existing = [];
  for (let i = 0; i < 50; i++) {
    existing.push(bill({ id: 'n' + i, merchant: '同商户', occurredAt: NaN, source: 'alipay' }));
  }
  const incoming = [bill({ merchant: '同商户', occurredAt: NaN, source: 'dailyvalue', sourceTxnId: 'nan1' })];
  EXISTING = existing;
  const oldOut = classifyReference(incoming, existing);
  const newOut = dedupe.classify(incoming);
  assert.deepStrictEqual(newOut, oldOut, '无效时间戳结果不一致');
});

/* ==================== 索引诊断 ==================== */
check('lastStats 字段齐备', () => {
  EXISTING = [bill({ id: 's1', occurredAt: Date.now(), sourceTxnId: '' })];
  dedupe.classify([bill({ source: '', sourceTxnId: '' })]);
  const s = dedupe.lastStats;
  assert.ok(s && typeof s.buildMs === 'number', 'buildMs');
  assert.ok(typeof s.classifyMs === 'number', 'classifyMs');
  assert.ok(typeof s.maxBucketSize === 'number', 'maxBucketSize');
  assert.ok(typeof s.averageBucketSize === 'number', 'averageBucketSize');
  assert.ok(s.existingCount >= 1, 'existingCount');
});

/* ==================== 汇总 ==================== */
console.log('\ndedupe-index tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL DEDUPE INDEX DIFFERENTIAL TESTS PASSED');
