/**
 * data/migration-schema-v3.js — Bill V2 → V3 无损 Schema 迁移（原子 + 幂等）
 *
 * V3 相对 V2 的差异（仅扩展，不删除 / 不改义任何旧字段）：
 *   - 新增可选 recurringRuleId:string（source='recurring' 时标记来源周期规则）；
 *   - 旧账单无此键，保持缺省；
 *   - 月份分片 version 2 → 3，manifest.schemaVersion 2 → 3。
 *
 * 不可变字段（迁移前后必须一致）：
 *   id / type / amountCents / occurredAt / title / ledgerImpact / dailyValue。
 *
 * 原子性：迁移前对全部月份分片做快照 → 全部转换与校验成功才写 status=done 与
 *   schemaVersion=3；任一写入 / 校验失败用快照恢复到迁移前状态，账本 0 污染。
 * 幂等：
 *   - status=done 直接跳过；
 *   - status=failed 重跑：upgradeBillV3 幂等（不重复加字段、已是 V3 不改变）。
 */
const ledger = require('./ledger');
const manifest = require('./manifest');

const TARGET_VERSION = 3;
const FROM_VERSIONS = [2]; // 接受 V2 分片升级

/**
 * 把单条 V2 / V3 bill 归一为 V3（幂等）。
 * 不触碰任何不可变字段；仅清理异常的空 recurringRuleId。
 */
function upgradeBillV3(b) {
  const out = Object.assign({}, b);
  if (out.recurringRuleId !== undefined && !out.recurringRuleId) {
    delete out.recurringRuleId;
  }
  return out;
}

/**
 * 执行 Bill V2 → V3 schema 迁移。
 * 返回 { status:'done'|'skipped', ... }；失败时回滚并抛错。
 */
function runSchemaMigration() {
  const existing = manifest.getMigration('billV3');
  if (existing && existing.status === 'done') {
    return { status: 'skipped', reason: 'already-done' };
  }

  const months = ledger.listMonths();

  // 空账本：直接完成，确保 manifest 为当前 schema
  if (!months.length) {
    if (manifest.getManifest().schemaVersion < TARGET_VERSION) {
      manifest.setSchemaVersion(TARGET_VERSION);
    }
    manifest.setMigrationResult('billV3', { status: 'done', recordCount: 0, months: [], reason: 'empty' });
    return { status: 'done', recordCount: 0, months: [] };
  }

  // 0. 严格预检：任一分片损坏 / shape 错即中止迁移（不进入快照与写入），fail-closed
  months.forEach((ym) => ledger.readMonthFileStrict(ym));

  // 1. 迁移前快照 + 不可变字段留档
  const snap = ledger.snapshotMonths(months);
  const before = {};
  months.forEach((ym) => {
    ledger.readMonthFileStrict(ym).bills.forEach((b) => {
      before[b.id] = {
        type: b.type,
        amountCents: b.amountCents,
        occurredAt: b.occurredAt,
        title: b.title,
        ledgerImpact: b.ledgerImpact,
        dailyValue: b.dailyValue ? JSON.stringify(b.dailyValue) : null,
      };
    });
  });

  try {
    // 2. 逐月份升级（幂等；writeMonthFile 写 version=3）
    let billCount = 0;
    months.forEach((ym) => {
      const mf = ledger.readMonthFileStrict(ym);
      mf.bills = mf.bills.map(upgradeBillV3);
      mf.version = TARGET_VERSION;
      ledger.writeMonthFile(ym, mf);
      billCount += mf.bills.length;
    });

    // 3. 校验：版本号、不可变字段一致、条数不增不减
    let afterCount = 0;
    months.forEach((ym) => {
      const mf = ledger.readMonthFileStrict(ym);
      if (mf.version !== TARGET_VERSION) {
        throw new Error('分片 ' + ym + ' 版本未升级到 ' + TARGET_VERSION);
      }
      mf.bills.forEach((b) => {
        afterCount += 1;
        const old = before[b.id];
        if (!old) throw new Error('迁移后出现未知账单 id：' + b.id);
        if (
          old.type !== b.type ||
          old.amountCents !== b.amountCents ||
          old.occurredAt !== b.occurredAt ||
          old.title !== b.title ||
          old.ledgerImpact !== b.ledgerImpact ||
          old.dailyValue !== (b.dailyValue ? JSON.stringify(b.dailyValue) : null)
        ) {
          throw new Error('不可变字段在迁移中被改变：' + b.id);
        }
      });
    });
    if (afterCount !== billCount) {
      throw new Error('迁移条数变化：期望 ' + billCount + '，实际 ' + afterCount);
    }

    // 4. 全部成功才提升 manifest schema 版本并标记 done
    manifest.setSchemaVersion(TARGET_VERSION);
    manifest.setMigrationResult('billV3', { status: 'done', recordCount: billCount, months });
    return { status: 'done', recordCount: billCount, months };
  } catch (e) {
    // 5. 失败：恢复到迁移前状态（含原 version），标记 failed，向上抛错
    ledger.restoreMonths(snap);
    manifest.setMigrationResult('billV3', { status: 'failed', reason: String(e && e.message) });
    throw e;
  }
}

module.exports = {
  TARGET_VERSION,
  FROM_VERSIONS,
  upgradeBillV3,
  runSchemaMigration,
};
