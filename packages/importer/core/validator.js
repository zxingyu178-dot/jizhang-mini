// packages/importer/core/validator.js
// NormalizedBill 字段校验：非法账单不进入账本。

function validateOne(b) {
  if (b.type !== 'expense' && b.type !== 'income') return 'type';
  if (!b.amountCents || b.amountCents <= 0 || b.amountCents > 9999999999) return 'amount';
  if (!b.occurredAt || Number.isNaN(b.occurredAt)) return 'time';
  if (b.occurredAt > Date.now() + 365 * 24 * 3600 * 1000) return 'time-future';
  return null;
}

/**
 * 批量校验，非法项标记 skipped。
 * @returns {Array}
 */
function validateAll(bills) {
  return bills.map((b) => {
    if (b.status === 'skipped') return b;
    const err = validateOne(b);
    if (err) {
      return Object.assign({}, b, {
        status: 'skipped',
        statusReason: '字段校验失败：' + err,
      });
    }
    return b;
  });
}

module.exports = {
  validateOne,
  validateAll,
};
