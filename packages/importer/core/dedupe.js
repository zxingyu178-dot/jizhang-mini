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
  const existingFp = new Set();
  existing.forEach((b) => {
    // 账本 sourceTxnId 已带「来源:」前缀
    if (b.sourceTxnId) existingTxn.add(b.sourceTxnId);
    existingFp.add(makeFingerprint(b));
  });

  const batchTxn = new Set();
  const batchFp = new Set();

  return bills.map((b) => {
    if (b.status === 'skipped') return b;

    // 精确：source + txnId
    if (b.source && b.sourceTxnId) {
      const key = b.source + ':' + b.sourceTxnId;
      if (existingTxn.has(key)) return withStatus(b, 'existing', '账本已存在');
      if (batchTxn.has(key)) return withStatus(b, 'duplicate', '文件内重复');
      batchTxn.add(key);
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
  };
  bills.forEach((b) => {
    c[b.status] = (c[b.status] || 0) + 1;
  });
  return c;
}

module.exports = {
  classify,
  countByStatus,
};
