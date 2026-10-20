/**
 * data/migration-schema.js — Bill V1 → V2 无损 Schema 迁移（原子 + 幂等）
 *
 * V2 相对 V1 的差异（仅扩展，不删除 / 不改义任何旧字段）：
 *   - 新增 title:string（旧账单补 ''）；
 *   - ledgerImpact 归一到 'normal' | 'daily-value-only'（旧账单缺省为 'normal'）；
 *   - 新增可选 dailyValue:{ enabled, mode:'elapsed', startDate }（旧账单无此键，保持缺省）；
 *   - 月份分片 version 1 → 2，manifest.schemaVersion 1 → 2。
 *
 * 不可变字段（迁移前后必须一致）：id / amountCents / occurredAt / type。
 *
 * 原子性：迁移前对全部月份分片做快照 → 全部转换与校验成功才写 status=done 与
 *   schemaVersion=2；任一写入 / 校验失败用快照恢复到迁移前状态，账本 0 污染。
 * 幂等：
 *   - status=done 直接跳过；
 *   - status=failed 后重跑：upgradeBill 是幂等的（已有 title 不重复加、已是 V2 不改变），
 *     因此连续重启 / 反复迁移都不会产生重复记录或脏数据。
 */
const ledger = require('./ledger');
const manifest = require('./manifest');

const TARGET_VERSION = 2;

/**
 * 把单条 V1 / V2 bill 归一为 V2（幂等：已是 V2 时不产生破坏性变化）。
 * 不触碰 id / amountCents / occurredAt / type。
 */
function upgradeBill(b) {
  const out = Object.assign({}, b);
  if (typeof out.title !== 'string') out.title = '';
  out.ledgerImpact = ledger.normalizeLedgerImpact(out.ledgerImpact);
  const dv = ledger.normalizeDailyValue(out.dailyValue);
  if (dv) out.dailyValue = dv;
  else delete out.dailyValue;
  return out;
}

/**
 * 执行 Bill V1 → V2 schema 迁移。
 * 返回 { status:'done'|'skipped', ... }；失败时回滚并抛错。
 */
function runSchemaMigration() {
  const existing = manifest.getMigration('billV2');
  if (existing && existing.status === 'done') {
    return { status: 'skipped', reason: 'already-done' };
  }

  const months = ledger.listMonths();

  // 空账本（全新安装 / 无任何月份分片）：直接完成，确保 manifest 为当前 schema
  if (!months.length) {
    if (manifest.getManifest().schemaVersion < TARGET_VERSION) {
      manifest.setSchemaVersion(TARGET_VERSION);
    }
    manifest.setMigrationResult('billV2', { status: 'done', recordCount: 0, months: [], reason: 'empty' });
    return { status: 'done', recordCount: 0, months: [] };
  }

  // 0. 严格预检：任一分片损坏 / shape 错即中止迁移（不进入快照与写入），fail-closed
  months.forEach((ym) => ledger.readMonthFileStrict(ym));

  // 1. 迁移前快照 + 不可变字段留档
  const snap = ledger.snapshotMonths(months);
  const before = {};
  months.forEach((ym) => {
    ledger.readMonthFileStrict(ym).bills.forEach((b) => {
      before[b.id] = { amountCents: b.amountCents, occurredAt: b.occurredAt, type: b.type };
    });
  });

  try {
    // 2. 逐月份升级（幂等）
    let billCount = 0;
    months.forEach((ym) => {
      const mf = ledger.readMonthFileStrict(ym);
      mf.bills = mf.bills.map(upgradeBill);
      mf.version = TARGET_VERSION; // 显式写成 V2，随后由 V3 迁移再升到 V3
      ledger.writeMonthFile(ym, mf);
      billCount += mf.bills.length;
    });

    // 3. 校验：版本号、字段完整性、不可变字段一致、条数不增不减
    let afterCount = 0;
    months.forEach((ym) => {
      const mf = ledger.readMonthFileStrict(ym);
      if (mf.version !== TARGET_VERSION) {
        throw new Error('分片 ' + ym + ' 版本未升级到 ' + TARGET_VERSION);
      }
      mf.bills.forEach((b) => {
        afterCount += 1;
        if (typeof b.title !== 'string') throw new Error('账单 ' + b.id + ' 缺少 title 字段');
        if (b.ledgerImpact !== 'normal' && b.ledgerImpact !== 'daily-value-only') {
          throw new Error('账单 ' + b.id + ' ledgerImpact 非法');
        }
        if (b.dailyValue !== undefined && (!b.dailyValue || b.dailyValue.enabled !== true)) {
          throw new Error('账单 ' + b.id + ' dailyValue 形态非法');
        }
        const old = before[b.id];
        if (!old) throw new Error('迁移后出现未知账单 id：' + b.id);
        if (old.amountCents !== b.amountCents || old.occurredAt !== b.occurredAt || old.type !== b.type) {
          throw new Error('不可变字段在迁移中被改变：' + b.id);
        }
      });
    });
    if (afterCount !== billCount) {
      throw new Error('迁移条数变化：期望 ' + billCount + '，实际 ' + afterCount);
    }

    // 4. 全部成功才提升 manifest schema 版本并标记 done
    manifest.setSchemaVersion(TARGET_VERSION);
    manifest.setMigrationResult('billV2', { status: 'done', recordCount: billCount, months });
    return { status: 'done', recordCount: billCount, months };
  } catch (e) {
    // 5. 失败：恢复到迁移前状态（含原 version），标记 failed，向上抛错
    ledger.restoreMonths(snap);
    manifest.setMigrationResult('billV2', { status: 'failed', reason: String(e && e.message) });
    throw e;
  }
}

module.exports = {
  TARGET_VERSION,
  upgradeBill,
  runSchemaMigration,
};
