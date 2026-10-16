// packages/importer/core/normalizer.js
// 统一导入中间结构 NormalizedBill 与通用字段解析（时间、fingerprint）。

/**
 * 解析账单日期时间文本。
 * 支持：2026-10-15 12:31:45 / 2026/10/15 12:31 / 2026年10月15日 12:31
 * @returns {number|null} 时间戳
 */
function parseDateTime(text) {
  if (!text) return null;
  const s = String(text).trim();
  const m = s.match(
    /(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2}))?(?:\D+(\d{1,2}))?(?:\D+(\d{1,2}))?/
  );
  if (!m) return null;
  const Y = +m[1];
  const Mo = +m[2];
  const D = +m[3];
  const H = +(m[4] || 0);
  const Mi = +(m[5] || 0);
  const Se = +(m[6] || 0);
  if (Y < 1970 || Mo < 1 || Mo > 12 || D < 1 || D > 31) return null;
  return new Date(Y, Mo - 1, D, H, Mi, Se).getTime();
}

/** NormalizedBill 工厂 */
function makeBill(partial) {
  return Object.assign(
    {
      type: 'expense',
      amountCents: 0,
      categoryId: 'c-other',
      occurredAt: Date.now(),
      title: '',
      merchant: '',
      note: '',
      source: '',
      sourceTxnId: '',
      ledgerImpact: 'normal',
      dailyValue: null,
      fingerprint: '',
      status: 'ready',
      statusReason: '',
    },
    partial
  );
}

/** 生成稳定 fingerprint（无流水号时去重用） */
function makeFingerprint(b) {
  const d = new Date(b.occurredAt);
  const dkey = [
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
  ].join('-');
  return [b.type, b.amountCents, dkey, b.merchant, b.note].join('|');
}

module.exports = {
  parseDateTime,
  makeBill,
  makeFingerprint,
};
