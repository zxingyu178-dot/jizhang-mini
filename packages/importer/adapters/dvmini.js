// packages/importer/adapters/dvmini.js
// Mini 自身完整备份 DailyValueMiniBackupV2（兼容 V1）：这是「完整恢复」，不是合并导入。
// 复用 data/backup 的校验与恢复（含安全点/回滚），不做导入去重；真正恢复读原始 obj。
const backup = require('../../../data/backup');

/**
 * 校验备份并返回账单（仅供恢复预览展示，含 title / 账本作用域）。
 * 真正恢复由 data/backup.restoreBackup 读原始 obj 完整执行。
 */
function parse(obj) {
  const err = backup.validateBackup(obj);
  if (err) throw new Error('备份格式不正确：' + err);

  return (obj.data.bills || []).map((b) => ({
    type: b.type,
    amountCents: b.amountCents,
    categoryId: b.categoryId,
    occurredAt: b.occurredAt,
    title: b.title || '',
    merchant: b.merchant || '',
    note: b.note || '',
    ledgerImpact: b.ledgerImpact === 'daily-value-only' ? 'daily-value-only' : 'normal',
    dailyValue: b.dailyValue && b.dailyValue.enabled ? b.dailyValue : null,
    source: 'dvmini',
    sourceTxnId: b.id || '',
    fingerprint: '',
    status: 'ready',
    statusReason: '',
  }));
}

/** 执行完整恢复（成功返回 { restored, months }） */
function restore(obj) {
  return backup.restoreBackup(obj);
}

module.exports = {
  parse,
  restore,
};
