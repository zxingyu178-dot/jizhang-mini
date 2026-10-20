/**
 * data/backup-migration.js — 备份显式迁移 Pipeline（v0.8.0 / G3 P0）
 *
 * 背景：旧 restoreBackup 对 V1/V2 备份的兼容依赖 createBill / normalizeRule 的隐式
 * 「先修」，损坏字段会被悄悄改义后成功恢复。G3 建立显式、可测试的版本迁移：
 *   V1 → migrateBackupV1ToV2 → V2 → migrateBackupV2ToV3 → canonical V3
 * 迁移只做「补缺省」（版本新增字段），绝不「修非法值」：
 *   - 允许补缺省：旧版本根本没有的字段（V1 无 title → ''；V2 无 recurringRules → []）；
 *   - 不能修非法值：已存在但非法的值（type='foobar'、损坏 ledgerImpact、损坏 dailyValue）
 *     原样保留，交由 backup-validator 在落盘前拦截。
 *
 * 注意：与月份分片迁移（migration-schema*.js）独立——本文件作用于「备份对象」，
 * 用于恢复前；不依赖 IO，纯函数，可在 Node 测试。
 */

/**
 * V1 → V2（bill 级）：
 *   - title：V2 新增，缺失/非字符串 → 补 ''；
 *   - ledgerImpact：缺失（旧账单无此字段）→ 补 'normal'；存在则原样保留（不 normalize）；
 *   - dailyValue：存在则原样保留（损坏由 validator 判 daily-value-start-invalid）；
 *   - 其余字段（id/type/amount/occurredAt/category 等）一律不动。
 */
function upgradeBillV1ToV2(b) {
  const out = Object.assign({}, b);
  if (typeof out.title !== 'string') out.title = '';
  if (out.ledgerImpact === undefined || out.ledgerImpact === null) {
    out.ledgerImpact = 'normal';
  }
  // dailyValue 缺失则不添加；存在（含损坏）原样保留，validator 负责判定
  return out;
}

/**
 * V2 → V3（bill 级）：
 *   - recurringRuleId：空（''/null）→ 删除（缺省=无引用）；非空原样保留
 *     （即使指向已删除规则，validator 给 warning，删除规则后历史保留是正常的）；
 *   - 其余字段不动。
 */
function upgradeBillV2ToV3(b) {
  const out = Object.assign({}, b);
  if (out.recurringRuleId !== undefined) {
    if (out.recurringRuleId === '' || out.recurringRuleId === null) {
      delete out.recurringRuleId;
    }
  }
  return out;
}

/** V1 备份 → V2 备份（深拷贝，不修改入参） */
function migrateBackupV1ToV2(backup) {
  const out = JSON.parse(JSON.stringify(backup));
  out.schemaVersion = 2;
  const data = out.data || {};
  data.bills = Array.isArray(data.bills) ? data.bills.map(upgradeBillV1ToV2) : [];
  out.data = data;
  // V2 仍无 recurringRules（不新增）
  return out;
}

/** V2 备份 → V3 备份（深拷贝，不修改入参） */
function migrateBackupV2ToV3(backup) {
  const out = JSON.parse(JSON.stringify(backup));
  out.schemaVersion = 3;
  const data = out.data || {};
  data.bills = Array.isArray(data.bills) ? data.bills.map(upgradeBillV2ToV3) : [];
  // V3 新增 data.recurringRules：缺失/空 → 补 []；非数组（损坏）原样保留交 validator
  if (data.recurringRules === undefined || data.recurringRules === null) {
    data.recurringRules = [];
  }
  out.data = data;
  return out;
}

/**
 * 把任意受支持版本备份迁移到 canonical V3。
 * V1 → V2 → V3；V3 原样返回。不支持的版本抛错。
 */
function migrateBackupToV3(backup) {
  if (!backup || typeof backup !== 'object') {
    throw new Error('备份不是对象，无法迁移');
  }
  let current = backup;
  let v = current.schemaVersion;
  if (v === 1) {
    current = migrateBackupV1ToV2(current);
    v = 2;
  }
  if (v === 2) {
    current = migrateBackupV2ToV3(current);
    v = 3;
  }
  if (v !== 3) {
    throw new Error('不支持的备份版本：' + v);
  }
  return current;
}

module.exports = {
  upgradeBillV1ToV2,
  upgradeBillV2ToV3,
  migrateBackupV1ToV2,
  migrateBackupV2ToV3,
  migrateBackupToV3,
};
