// packages/importer/core/dedupe.js
// 去重分类：
//   existing 精确命中（source+sourceTxnId 或 fingerprint）→ 跳过
//   duplicate 批次内重复 → 跳过
//   suspect 跨来源疑似重复（金额+时间+商户接近）→ 仅标记，交用户确认
// 绝不自动删除跨来源疑似项。
//
// v1.4.1：把「逐条全量扫描 existing」改为一次性建索引后复用。
//   - 精确流水号 / fingerprint 索引语义不变；
//   - 疑似重复按 type + amountCents + 5 分钟时间桶建多级 Map，
//     每条新账单只检查当前桶与前后各一桶，再执行原有精确判断；
//   - CSV 日价补全按 type/amount/category/note/分钟建索引，保留 zero/one/many；
//   - 无效时间戳走安全回退：新账单扫描该 type+amount 的全部桶，既有无效时间账单
//     始终参与判断，保证与旧算法结果一致。
const store = require('../../../data/index');
const { makeFingerprint } = require('./normalizer');

const TIME_WINDOW = 5 * 60 * 1000; // 5 分钟

/** classify 的诊断信息（供性能脚本 / 测试读取，不参与业务判断） */
let lastStats = null;

function withStatus(b, status, reason) {
  return Object.assign({}, b, { status, statusReason: reason });
}

/**
 * 构造「补充日价」补丁（命中已存在账单时）：
 *   - 本地缺 dailyValue、备份有合法 dailyValue → 补 dailyValue；
 *   - 本地缺 title、备份有 title → 补 title；
 * 不主动改写 ledgerImpact（避免把 normal 误改成 daily-value-only）。
 * 无可补字段 → null（按普通「已存在」跳过）。
 */
function buildMergePatch(existing, incoming) {
  const patch = {};
  const existingDv = existing.dailyValue && existing.dailyValue.enabled === true;
  if (!existingDv && incoming.dailyValue && incoming.dailyValue.enabled === true && incoming.dailyValue.startDate) {
    patch.dailyValue = {
      enabled: true,
      mode: 'elapsed',
      startDate: String(incoming.dailyValue.startDate).slice(0, 10),
    };
  }
  if (!(existing.title || '').trim() && (incoming.title || '').trim()) {
    patch.title = String(incoming.title).trim();
  }
  return Object.keys(patch).length ? patch : null;
}

/** 两个时间戳是否落在同一分钟（CSV 时间精度到分钟，backup 可能含秒） */
function sameMinute(ts1, ts2) {
  return Math.floor(ts1 / 60000) === Math.floor(ts2 / 60000);
}

/**
 * 保守日价补全匹配（原线性实现，保留导出以兼容测试 / 外部调用）：
 * @returns {{kind:'zero'|'one'|'many', existing?:object, candidates?:Array}}
 */
function conservativeCsvMatch(b, existing) {
  const candidates = existing.filter((e) => {
    if (e.sourceTxnId) return false; // 仅匹配无 id（CSV 导入）的账单
    if (e.type !== b.type) return false;
    if (e.amountCents !== b.amountCents) return false;
    if (e.categoryId !== b.categoryId) return false;
    if ((e.note || '') !== (b.note || '')) return false;
    if (!sameMinute(e.occurredAt, b.occurredAt)) return false;
    return true;
  });
  if (candidates.length === 0) return { kind: 'zero' };
  if (candidates.length > 1) return { kind: 'many', candidates };
  return { kind: 'one', existing: candidates[0] };
}

/** 跨来源疑似重复判断（原精确条件，索引只负责缩小候选集） */
function isSuspect(e, b) {
  if (e.type !== b.type) return false;
  if (e.amountCents !== b.amountCents) return false;
  if (Math.abs(e.occurredAt - b.occurredAt) > TIME_WINDOW) return false;
  const em = (e.merchant || '').trim();
  const bm = (b.merchant || '').trim();
  if (em && bm && (em === bm || em.indexOf(bm) >= 0 || bm.indexOf(em) >= 0)) {
    return (e.source || 'manual') !== (b.source || '');
  }
  return false;
}

/** 兼容旧调用：对数组做一次线性判断 */
function findSuspect(b, existing) {
  return existing.some((e) => isSuspect(e, b));
}

/* ============================ 索引 ============================ */

function timeBucket(ts) {
  if (typeof ts !== 'number' || !isFinite(ts)) return null;
  return Math.floor(ts / TIME_WINDOW);
}

function minuteKey(ts) {
  if (typeof ts !== 'number' || !isFinite(ts)) return null;
  return Math.floor(ts / 60000);
}

/** 疑似重复索引：type|amountCents → bucket → bills（无效时间单独一列） */
function buildSuspectIndex(existing) {
  const buckets = new Map();
  const invalidTime = new Map();
  existing.forEach((e) => {
    const key = e.type + '|' + e.amountCents;
    const bucket = timeBucket(e.occurredAt);
    if (bucket === null) {
      if (!invalidTime.has(key)) invalidTime.set(key, []);
      invalidTime.get(key).push(e);
      return;
    }
    let byBucket = buckets.get(key);
    if (!byBucket) {
      byBucket = new Map();
      buckets.set(key, byBucket);
    }
    let arr = byBucket.get(bucket);
    if (!arr) {
      arr = [];
      byBucket.set(bucket, arr);
    }
    arr.push(e);
  });
  return { buckets, invalidTime };
}

/**
 * 取出与 b 可能落在 5 分钟窗口内的候选（宁多勿漏，最终仍由 isSuspect 精确判断）。
 * 无效时间戳 → 该 type+amount 下全部桶。
 */
function suspectCandidates(b, index) {
  const key = b.type + '|' + b.amountCents;
  const out = [];
  const byBucket = index.buckets.get(key);
  const bucket = timeBucket(b.occurredAt);
  if (byBucket) {
    if (bucket === null) {
      byBucket.forEach((arr) => {
        for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      });
    } else {
      for (let k = bucket - 1; k <= bucket + 1; k++) {
        const arr = byBucket.get(k);
        if (arr) {
          for (let i = 0; i < arr.length; i++) out.push(arr[i]);
        }
      }
    }
  }
  const inv = index.invalidTime.get(key);
  if (inv) {
    for (let i = 0; i < inv.length; i++) out.push(inv[i]);
  }
  return out;
}

/** CSV 日价补全索引：type|amount|category|note|minute → 无 sourceTxnId 的账单 */
function csvMatchKey(b) {
  const minute = minuteKey(b.occurredAt);
  if (minute === null) return null; // 无效时间永不匹配（与 sameMinute(NaN,NaN)=false 一致）
  return [b.type, b.amountCents, b.categoryId, b.note || '', minute].join('|');
}

function buildCsvIndex(existing) {
  const map = new Map();
  existing.forEach((e) => {
    if (e.sourceTxnId) return;
    const key = csvMatchKey(e);
    if (key === null) return;
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
    }
    arr.push(e);
  });
  return map;
}

function conservativeCsvMatchIndexed(b, csvIndex) {
  const key = csvMatchKey(b);
  if (key === null) return { kind: 'zero' };
  const candidates = csvIndex.get(key);
  if (!candidates || candidates.length === 0) return { kind: 'zero' };
  if (candidates.length > 1) return { kind: 'many', candidates: candidates.slice() };
  return { kind: 'one', existing: candidates[0] };
}

/* ============================ 分类 ============================ */

/**
 * 对一批 NormalizedBill 做去重分类。
 * @param {Array} bills
 * @returns {Array}
 */
function classify(bills) {
  const buildStart = Date.now();
  const existing = store.rangeBills();

  // 索引 A：精确流水号
  const existingTxn = new Set();
  const existingByTxn = new Map();
  // 索引 B：fingerprint
  const existingFp = new Set();
  existing.forEach((b) => {
    // 账本 sourceTxnId 已带「来源:」前缀
    if (b.sourceTxnId) {
      existingTxn.add(b.sourceTxnId);
      existingByTxn.set(b.sourceTxnId, b);
    }
    existingFp.add(makeFingerprint(b));
  });

  // 索引 C / D
  const suspectIndex = buildSuspectIndex(existing);
  const csvIndex = buildCsvIndex(existing);

  let maxBucketSize = 0;
  let bucketCount = 0;
  let bucketTotal = 0;
  suspectIndex.buckets.forEach((byBucket) => {
    byBucket.forEach((arr) => {
      bucketCount += 1;
      bucketTotal += arr.length;
      if (arr.length > maxBucketSize) maxBucketSize = arr.length;
    });
  });
  const buildMs = Date.now() - buildStart;

  const batchTxn = new Set();
  const batchFp = new Set();
  let candidateChecks = 0;

  const classifyStart = Date.now();
  const out = bills.map((b) => {
    if (b.status === 'skipped') return b;

    // 精确：source + txnId
    if (b.source && b.sourceTxnId) {
      const key = b.source + ':' + b.sourceTxnId;
      if (existingTxn.has(key)) {
        // 已存在：若本地缺日价 / 标题而备份有，标记「补充日价」（不重复新增）
        const hit = existingByTxn.get(key);
        const patch = hit ? buildMergePatch(hit, b) : null;
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

      // .dvbackup 精确 id 未命中：本地可能是之前 CSV 导入（无 id），做保守日价补全匹配
      if (b.source === 'dailyvalue') {
        const m = conservativeCsvMatchIndexed(b, csvIndex);
        if (m.kind === 'many') {
          return withStatus(b, 'suspect', '匹配到多条可能账单，请确认是否为同一笔');
        }
        if (m.kind === 'one') {
          const patch = buildMergePatch(m.existing, b);
          if (patch) {
            return Object.assign({}, b, {
              status: 'merge',
              statusReason: '补充日价信息',
              existingId: m.existing.id,
              mergePatch: patch,
            });
          }
          return withStatus(b, 'existing', '账本已存在');
        }
      }

      const c = suspectCandidates(b, suspectIndex);
      candidateChecks += c.length;
      if (c.some((e) => isSuspect(e, b))) {
        return withStatus(b, 'suspect', '疑似与已有账单重复');
      }
      return b;
    }

    // 无流水号：fingerprint
    const fp = makeFingerprint(b);
    if (existingFp.has(fp)) return withStatus(b, 'existing', '账本已存在');
    if (batchFp.has(fp)) return withStatus(b, 'duplicate', '文件内重复');
    batchFp.add(fp);
    const c = suspectCandidates(b, suspectIndex);
    candidateChecks += c.length;
    if (c.some((e) => isSuspect(e, b))) {
      return withStatus(b, 'suspect', '疑似与已有账单重复');
    }
    return b;
  });

  lastStats = {
    existingCount: existing.length,
    buildMs,
    classifyMs: Date.now() - classifyStart,
    bucketCount,
    averageBucketSize: bucketCount ? Number((bucketTotal / bucketCount).toFixed(2)) : 0,
    maxBucketSize,
    candidateChecks,
  };
  return out;
}

/** 统计各状态数量 */
function countByStatus(bills) {
  const c = {
    ready: 0,
    existing: 0,
    duplicate: 0,
    suspect: 0,
    skipped: 0,
    needconfirm: 0,
    merge: 0,
  };
  bills.forEach((b) => {
    c[b.status] = (c[b.status] || 0) + 1;
  });
  return c;
}

module.exports = {
  classify,
  countByStatus,
  buildMergePatch,
  conservativeCsvMatch,
  // 测试 / 性能诊断用（不改变 classify 契约）
  get lastStats() {
    return lastStats;
  },
  _internal: {
    TIME_WINDOW,
    isSuspect,
    timeBucket,
    minuteKey,
    buildSuspectIndex,
    suspectCandidates,
    buildCsvIndex,
    csvMatchKey,
  },
};
