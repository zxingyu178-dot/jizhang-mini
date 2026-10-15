/**
 * data/migration.js — 旧 jm_records(wx.Storage) 无损迁移到 Bill V1
 *
 * 流程：
 *   检测 jm_records → 备份原始数组到 legacy → 转 Bill V1 → 按月分片写入
 *   → 校验条数 / 收入 / 支出总额 → 标记成功
 *
 * 迁移成功后不删除 jm_records（至少保留一个正式版本，仅停止写入），便于回滚。
 * 幂等：迁移已 done 时直接跳过。
 */
const fs = require('./fs');
const paths = require('./paths');
const ledger = require('./ledger');
const categories = require('./categories');
const manifest = require('./manifest');

const LEGACY_KEY = 'jm_records';

/** 'YYYY-MM-DD' -> 本地 Date（避免 UTC 时区偏移） */
function parseDateStr(s) {
  const parts = String(s || '').split('-').map(Number);
  if (parts.length >= 3 && parts[0]) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return null;
}

/** 旧记录 -> Bill V1 */
function legacyToBill(r) {
  const d = parseDateStr(r.date);
  const occurredAt = d ? d.getTime() : r.createdAt || Date.now();
  const createdAt = r.createdAt || occurredAt;
  return {
    id: 'mig-' + r.id,
    type: r.type === 'income' ? 'income' : 'expense',
    amountCents: Math.round((Number(r.amount) || 0) * 100),
    categoryId: categories.mapLegacyCategory(r.category),
    occurredAt,
    merchant: r.merchant || r.title || '',
    note: r.note || '',
    source: 'manual',
    sourceTxnId: null,
    importBatchId: null,
    createdAt,
    updatedAt: createdAt,
    ledgerImpact: 'normal',
  };
}

function sumBills(bills) {
  let incomeCents = 0;
  let expenseCents = 0;
  bills.forEach((b) => {
    if (b.type === 'income') incomeCents += b.amountCents;
    else expenseCents += b.amountCents;
  });
  return { incomeCents, expenseCents };
}

/**
 * 执行迁移。
 * 返回 { status:'done'|'skipped', ... }
 */
function runMigration() {
  const existing = manifest.getMigration('jmRecords');
  if (existing && existing.status === 'done') {
    return { status: 'skipped', reason: 'already-done' };
  }

  let legacy;
  try {
    legacy = wx.getStorageSync(LEGACY_KEY);
  } catch (e) {
    legacy = null;
  }
  if (!Array.isArray(legacy) || !legacy.length) {
    manifest.setMigrationResult('jmRecords', { status: 'skipped', reason: 'no-legacy-data' });
    return { status: 'skipped', reason: 'no-legacy-data' };
  }

  // 1. 备份原始数组
  fs.writeJSON(paths.legacyRecordsBackup(), { backedUpAt: Date.now(), recordCount: legacy.length, records: legacy });

  // 2. 转换 Bill V1
  const bills = legacy.map(legacyToBill);
  const expected = sumBills(bills);

  // 记录迁移涉及的月份（迁移在 init 最早执行，这些月份此前应为空）
  const monthsUsed = {};
  bills.forEach((b) => {
    monthsUsed[ledger.ymOf(b.occurredAt)] = true;
  });

  // 3. 按月分片写入
  ledger.addBills(bills);

  // 4. 校验：重新读回这些月份
  let actualIncome = 0;
  let actualExpense = 0;
  Object.keys(monthsUsed).forEach((ym) => {
    const s = ledger.monthSummary(ym);
    actualIncome += s.income;
    actualExpense += s.expense;
  });

  if (actualIncome !== expected.incomeCents || actualExpense !== expected.expenseCents) {
    manifest.setMigrationResult('jmRecords', {
      status: 'failed',
      recordCount: bills.length,
      expected,
      actual: { incomeCents: actualIncome, expenseCents: actualExpense },
    });
    throw new Error('jm_records 迁移校验失败：总额不一致，原账本未改动 jm_records');
  }

  // 5. 标记成功（保留 jm_records，不删除）
  manifest.setMigrationResult('jmRecords', {
    status: 'done',
    recordCount: bills.length,
    incomeCents: expected.incomeCents,
    expenseCents: expected.expenseCents,
    months: Object.keys(monthsUsed).sort(),
  });

  return { status: 'done', recordCount: bills.length, incomeCents: expected.incomeCents, expenseCents: expected.expenseCents };
}

module.exports = {
  LEGACY_KEY,
  parseDateStr,
  legacyToBill,
  runMigration,
};
