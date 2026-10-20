/**
 * data/backup.js — Mini 完整备份 / 恢复（DailyValueMiniBackupV3，兼容 V1/V2）
 *
 * 备份对象（.dvmini.json）：
 *   { format:'daily-value-mini-backup', schemaVersion:3, appVersion, exportedAt,
 *     data:{ bills:[...V3 完整字段，含 title/ledgerImpact/dailyValue/recurringRuleId],
 *            categories:[...], settings:{...}, recurringRules:[...] } }
 *
 * V3 相对 V2：data 增加 recurringRules（周期规则；恢复后周期记账不丢）。
 * V2 相对 V1：bills 完整保存 title / ledgerImpact / dailyValue。
 * 恢复兼容 V1 + V2 + V3：旧备份缺失的 recurringRules 按空处理。
 * 完整恢复（非普通账单导入）：恢复前写安全点，失败可回滚。
 */
const fs = require('./fs');
const paths = require('./paths');
const ledger = require('./ledger');
const categories = require('./categories');
const settings = require('./settings');
const recurringStore = require('./recurring/store');
const backupValidator = require('./backup-validator');
const backupMigration = require('./backup-migration');
const health = require('./health');
const { APP_VERSION } = require('../utils/version');

const FORMAT = 'daily-value-mini-backup';
const SCHEMA_VERSION = 3;
/** 恢复可接受的历史 schema 版本（V1/V2 备份仍可恢复） */
const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3];

/** 构造备份对象（读取全部账本 + 周期规则） */
function buildBackup() {
  return {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      bills: ledger.rangeBills(null, null),
      categories: categories.getCategories(),
      settings: settings.getSettings(),
      recurringRules: recurringStore.getRules(),
    },
  };
}

/**
 * 校验备份；返回错误类型或 null。
 * 兼容 V1/V2/V3：schemaVersion 1/2/3 均接受（恢复时统一归一为 V3）。
 */
function validateBackup(backup) {
  if (!backup || backup.format !== FORMAT) return 'format';
  if (SUPPORTED_SCHEMA_VERSIONS.indexOf(backup.schemaVersion) < 0) return 'schemaVersion';
  if (!backup.data || !Array.isArray(backup.data.bills)) return 'data';
  return null;
}

/**
 * 从备份完整恢复。
 * 步骤：校验 → 写安全点 → 清旧账单 → 写新账单/分类/设置/周期规则 → 条数校验
 *       → 数据健康终检（error 回滚，warning 放行）。
 * 任何失败尝试回滚到安全点。返回 { restored, months, warningCount, warnings }。
 */
function restoreBackup(input, options) {
  options = options || {};
  const err = validateBackup(input);
  if (err) throw new Error('备份格式不正确：' + err);

  // G3：显式迁移到 canonical V3（V1/V2 只补缺省字段，不碰关键值；V3 原样）。
  const backup = backupMigration.migrateBackupToV3(input);
  // G2：落盘前对原始（迁移后）数据做完整语义校验，不经过 createBill 先修。
  //   非法值一律拒绝恢复（不写安全点、不动现有数据）。
  const vr = backupValidator.validateBackupRaw(backup);
  if (!vr.ok) {
    throw new Error('备份数据校验未通过：' + vr.errors.map((e) => e.code).join('、'));
  }

  const safety = paths.legacyRestoreSafety();
  // 1. 安全点（当前完整数据）
  fs.writeJSON(safety, buildBackup());

  try {
    // 2. 清空现有月份分片
    ledger.listMonths().forEach((ym) => fs.remove(paths.billFile(ym)));

    // 3. 写入新账单
    const result = ledger.addBills(backup.data.bills);

    // 4. 分类、设置
    fs.writeJSON(paths.FILE.categories, backup.data.categories || categories.DEFAULT_CATEGORIES);
    fs.writeJSON(paths.FILE.settings, Object.assign({}, settings.DEFAULT_SETTINGS, backup.data.settings || {}));

    // 4.5 周期规则（V3 新增；V1/V2 备份无此字段 → 空）
    const ruleList = Array.isArray(backup.data.recurringRules) ? backup.data.recurringRules : [];
    recurringStore.replaceAllRules(ruleList);

    // 5. 校验条数
    if (result.total !== backup.data.bills.length) {
      throw new Error('恢复条数不一致');
    }

    // 6. 数据健康终检（G11）：以最终落盘数据为准。
    //    - error（结构损坏，如重复 Bill id、非法预算规则）→ 抛错回滚到安全点；
    //    - warning（引用已归档分类 / 已删除周期规则等历史软引用）→ 放行，随结果返回。
    //    skipHealth 仅供「导入失败后用安全点救命回滚」使用，回滚不能被健康门阻断。
    let warnings = [];
    let warningCount = 0;
    if (!options.skipHealth) {
      const report = health.runHealthScan();
      if (!report.ok) {
        const codes = report.errors.map((x) => x.code).join('、');
        throw new Error('恢复数据健康校验未通过：' + codes);
      }
      warnings = report.warnings;
      warningCount = report.warnings.length;
    }

    return {
      restored: result.total,
      months: result.months,
      warningCount,
      warnings,
    };
  } catch (e) {
    // 回滚
    rollback(safety);
    throw e;
  }
}

/** 从安全点回滚 */
function rollback(safetyPath) {
  const saved = fs.readJSON(safetyPath, null);
  if (!saved || !saved.data) return;
  ledger.listMonths().forEach((ym) => fs.remove(paths.billFile(ym)));
  ledger.addBills(saved.data.bills || []);
  fs.writeJSON(paths.FILE.categories, saved.data.categories || categories.DEFAULT_CATEGORIES);
  fs.writeJSON(paths.FILE.settings, saved.data.settings || settings.DEFAULT_SETTINGS);
  recurringStore.replaceAllRules(Array.isArray(saved.data.recurringRules) ? saved.data.recurringRules : []);
}

module.exports = {
  FORMAT,
  SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  buildBackup,
  validateBackup,
  restoreBackup,
};
