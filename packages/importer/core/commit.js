// packages/importer/core/commit.js
// 原子化导入提交：
//   1. 写快照安全点；
//   2. 内存中按月份合并，再逐月份写文件；
//   3. 写后重新读取校验条数；
//   任一步失败 → 用快照完整恢复，原账本不变。
const fs = require('../../../data/fs');
const paths = require('../../../data/paths');
const backup = require('../../../data/backup');
const ledger = require('../../../data/ledger');

/** NormalizedBill -> ledger Bill 字段 */
function toLedgerBill(b, batchId) {
  return {
    type: b.type,
    amountCents: b.amountCents,
    categoryId: b.categoryId,
    occurredAt: b.occurredAt,
    merchant: b.merchant,
    note: b.note,
    source: 'import',
    sourceTxnId: b.source && b.sourceTxnId ? b.source + ':' + b.sourceTxnId : null,
    importBatchId: batchId,
    ledgerImpact: 'normal',
  };
}

/**
 * 提交导入。
 * @param {object} session detector 产出的会话
 * @param {object} opts { includeSuspect:boolean }
 * @returns {{ imported:number, batchId:string, months:string[] }}
 */
function commitImport(session, opts) {
  opts = opts || {};
  const include = (b) =>
    b.status === 'ready' || (opts.includeSuspect && b.status === 'suspect');
  const toImport = session.bills.filter(include);

  // 1. 快照
  const safety = paths.legacyRestoreSafety();
  fs.writeJSON(safety, backup.buildBackup());

  const beforeCount = ledger.rangeBills().length;
  const batchId = 'imp-' + Date.now();

  try {
    // 2. 按月份分组
    const groups = {};
    toImport.forEach((b) => {
      const ym = ledger.ymOf(b.occurredAt);
      if (!groups[ym]) groups[ym] = [];
      groups[ym].push(b);
    });

    // 3. 逐月份写（先读后并）
    const months = Object.keys(groups).sort();
    months.forEach((ym) => {
      const mf = ledger.readMonthFile(ym);
      mf.bills = mf.bills.concat(groups[ym].map((b) => toLedgerBill(b, batchId)));
      ledger.writeMonthFile(ym, mf);
    });

    // 4. 写后校验
    const afterCount = ledger.rangeBills().length;
    if (afterCount - beforeCount !== toImport.length) {
      throw new Error('导入条数校验不一致');
    }

    return { imported: toImport.length, batchId, months };
  } catch (e) {
    // 回滚到快照
    const saved = fs.readJSON(safety, null);
    if (saved) backup.restoreBackup(saved);
    throw e;
  }
}

/** 完整恢复（Mini 备份） */
function commitRestore(session) {
  const result = backup.restoreBackup(session.restoreObj);
  return { imported: result.restored, months: result.months };
}

module.exports = {
  commitImport,
  commitRestore,
  toLedgerBill,
};
