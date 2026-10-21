/**
 * data/migration.js — 旧 jm_records(wx.Storage) 无损迁移到 Bill V1（原子 + 幂等）
 *
 * 流程：
 *   检测 jm_records → 备份原始数组到 legacy → 转 Bill V1
 *   → 对涉及月份做快照 → 清理历史失败残留 → 按月分片写入
 *   → 校验条数 / 收入 / 支出总额 → 全部成功才写 status=done
 *
 * 原子性：任何写入或校验失败，用快照把涉及月份恢复到迁移前状态，账本 0 污染。
 * 幂等：
 *   - status=done 直接跳过；
 *   - status=failed 后重跑：写入前先移除本迁移确定性 id（mig-<oldId>）的残留，
 *     因此连续重启 / 反复迁移都不会产生重复记录。
 *
 * 迁移成功后不删除 jm_records（至少保留一个正式版本，仅停止写入），便于回滚。
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

/** 旧记录 -> Bill V1（id 确定性：mig-<oldId>，保证幂等） */
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
    title: '',
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
 * 返回 { status:'done'|'skipped', ... }；失败时回滚后抛错。
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

  // 1. 备份原始数组（每次重跑覆盖，记录最新一次；原子写）
  fs.writeJSONAtomic(paths.legacyRecordsBackup(), {
    backedUpAt: Date.now(),
    recordCount: legacy.length,
    records: legacy,
  });

  // 2. 转换为 Bill V1
  const bills = legacy.map(legacyToBill);
  const expected = sumBills(bills);

  // 迁移 id 集合（幂等清理用）与按月份分组
  const migIds = {};
  const byMonth = {};
  bills.forEach((b) => {
    migIds[b.id] = true;
    const ym = ledger.ymOf(b.occurredAt);
    if (!byMonth[ym]) byMonth[ym] = [];
    byMonth[ym].push(b);
  });
  const months = Object.keys(byMonth).sort();

  // 3. 对涉及月份做迁移前快照
  const snap = ledger.snapshotMonths(months);

  try {
    // 4. 逐月写入：先剥离历史失败残留（同 id 的迁移账单），再合并本次账单
    months.forEach((ym) => {
      const mf = ledger.readMonthFile(ym);
      const kept = mf.bills.filter((b) => !migIds[b.id]);
      mf.bills = kept.concat(byMonth[ym]);
      ledger.sortBills(mf.bills);
      ledger.writeMonthFile(ym, mf);
    });

    // 5. 校验：重新读回，迁移账单每条恰好 1 条且总额一致
    let actualCount = 0;
    let actualIncome = 0;
    let actualExpense = 0;
    months.forEach((ym) => {
      ledger.readMonthFile(ym).bills.forEach((b) => {
        if (!migIds[b.id]) return;
        actualCount += 1;
        if (b.type === 'income') actualIncome += b.amountCents;
        else actualExpense += b.amountCents;
      });
    });

    if (actualCount !== bills.length) {
      throw new Error('迁移条数校验失败：期望 ' + bills.length + ' 条，实际 ' + actualCount + ' 条');
    }
    if (actualIncome !== expected.incomeCents || actualExpense !== expected.expenseCents) {
      throw new Error('迁移总额校验失败：收入或支出不一致');
    }

    // 6. 全部成功才标记 done（保留 jm_records，不删除）
    manifest.setMigrationResult('jmRecords', {
      status: 'done',
      recordCount: bills.length,
      incomeCents: expected.incomeCents,
      expenseCents: expected.expenseCents,
      months,
    });

    return {
      status: 'done',
      recordCount: bills.length,
      incomeCents: expected.incomeCents,
      expenseCents: expected.expenseCents,
    };
  } catch (e) {
    // 7. 失败：恢复到迁移前状态，标记 failed，向上抛错
    ledger.restoreMonths(snap);
    manifest.setMigrationResult('jmRecords', {
      status: 'failed',
      recordCount: bills.length,
      reason: String(e && e.message),
    });
    throw e;
  }
}

module.exports = {
  LEGACY_KEY,
  parseDateStr,
  legacyToBill,
  runMigration,
};
