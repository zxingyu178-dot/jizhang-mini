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

/** NormalizedBill -> ledger Bill 字段（透传 title / ledgerImpact / dailyValue） */
function toLedgerBill(b, batchId) {
  const out = {
    type: b.type,
    amountCents: b.amountCents,
    categoryId: b.categoryId,
    occurredAt: b.occurredAt,
    title: b.title || '',
    merchant: b.merchant,
    note: b.note,
    source: 'import',
    sourceTxnId: b.source && b.sourceTxnId ? b.source + ':' + b.sourceTxnId : null,
    importBatchId: batchId,
    ledgerImpact: b.ledgerImpact === 'daily-value-only' ? 'daily-value-only' : 'normal',
  };
  // 仅在合法启用时挂 dailyValue（与数据层 Bill V2 形态一致）
  if (b.dailyValue && b.dailyValue.enabled === true && b.dailyValue.startDate) {
    out.dailyValue = {
      enabled: true,
      mode: 'elapsed',
      startDate: String(b.dailyValue.startDate).slice(0, 10),
    };
  }
  return out;
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
  // 「补充日价」：命中已存在账单，不新增条数，只在安全快照内补写 dailyValue/title
  const toMerge = session.bills.filter((b) => b.status === 'merge');

  // 1. 快照
  const safety = paths.legacyRestoreSafety();
  fs.writeJSON(safety, backup.buildBackup());

  const beforeCount = ledger.rangeBills().length;
  const batchId = 'imp-' + Date.now();

  try {
    // 1.5 补充日价（原位更新，不新增账单）
    toMerge.forEach((b) => {
      if (!b.existingId || !b.mergePatch) return;
      ledger.updateBill(b.existingId, b.mergePatch);
    });

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
      // 必须经 createBill 补全 id / createdAt / updatedAt 等必需字段；
      // 直接写 toLedgerBill 结果会让所有导入账单缺少 id，导致无法编辑 / 跨月 / 迁移。
      mf.bills = mf.bills.concat(groups[ym].map((b) => ledger.createBill(toLedgerBill(b, batchId))));
      ledger.writeMonthFile(ym, mf);
    });

    // 4. 写后校验
    const afterCount = ledger.rangeBills().length;
    if (afterCount - beforeCount !== toImport.length) {
      throw new Error('导入条数校验不一致');
    }

    return { imported: toImport.length, merged: toMerge.length, batchId, months };
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
