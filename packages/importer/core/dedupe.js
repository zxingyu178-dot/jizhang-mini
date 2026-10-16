// packages/importer/core/dedupe.js
// 去重分类：
//   existing 精确命中（source+sourceTxnId 或 fingerprint）→ 跳过
//   duplicate 批次内重复 → 跳过
//   suspect 跨来源疑似重复（金额+时间+商户接近）→ 仅标记，交用户确认
// 绝不自动删除跨来源疑似项。
const store = require('../../../data/index');
const { makeFingerprint } = require('./normalizer');

const TIME_WINDOW = 5 * 60 * 1000; // 5 分钟

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
 * 保守日价补全匹配：以前用 CSV 导入的账单没有 Android id，精确 sourceTxnId 命中不了。
 * 候选限定为「无 sourceTxnId」的本地账单，匹配条件：
 *   type / amountCents / categoryId / note 相同，且 occurredAt 在同一分钟。
 * @returns {{kind:'zero'|'one'|'many', existing?:object}}
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

/** 跨来源疑似重复：金额相同、时间接近、商户接近、来源不同 */
function findSuspect(b, existing) {
  return existing.some((e) => {
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
}

/**
 * 对一批 NormalizedBill 做去重分类。
 * @param {Array} bills
 * @returns {Array}
 */
function classify(bills) {
  const existing = store.rangeBills();
  const existingTxn = new Set();
  const existingByTxn = new Map();
  const existingFp = new Set();
  existing.forEach((b) => {
    // 账本 sourceTxnId 已带「来源:」前缀
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
        const m = conservativeCsvMatch(b, existing);
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

      if (findSuspect(b, existing)) return withStatus(b, 'suspect', '疑似与已有账单重复');
      return b;
    }

    // 无流水号：fingerprint
    const fp = makeFingerprint(b);
    if (existingFp.has(fp)) return withStatus(b, 'existing', '账本已存在');
    if (batchFp.has(fp)) return withStatus(b, 'duplicate', '文件内重复');
    batchFp.add(fp);
    if (findSuspect(b, existing)) return withStatus(b, 'suspect', '疑似与已有账单重复');
    return b;
  });
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
};
