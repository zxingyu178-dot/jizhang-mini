/**
 * data/backup.js — Mini 完整备份 / 恢复（DailyValueMiniBackupV2，兼容 V1）
 *
 * 备份对象（.dvmini.json）：
 *   { format:'daily-value-mini-backup', schemaVersion:2, appVersion, exportedAt,
 *     data:{ bills:[...V2 完整字段，含 title/ledgerImpact/dailyValue],
 *            categories:[...], settings:{...} } }
 *
 * V2 相对 V1：bills 完整保存 title / ledgerImpact / dailyValue（恢复后日价不丢）。
 * 恢复兼容 V1 + V2：旧 V1 备份经 createBill 自动补 title / 归一 ledgerImpact。
 * 完整恢复（非普通账单导入）：恢复前写安全点，失败可回滚。
 */
const fs = require('./fs');
const paths = require('./paths');
const ledger = require('./ledger');
const categories = require('./categories');
const settings = require('./settings');
const { APP_VERSION } = require('../utils/version');

const FORMAT = 'daily-value-mini-backup';
const SCHEMA_VERSION = 2;
/** 恢复可接受的历史 schema 版本（V1 备份仍可恢复） */
const SUPPORTED_SCHEMA_VERSIONS = [1, 2];

/** 构造备份对象（读取全部账本） */
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
    },
  };
}

/**
 * 校验备份；返回错误类型或 null。
 * 兼容 V1 + V2：schemaVersion 为 1 或 2 均接受（恢复时统一归一为 V2）。
 */
function validateBackup(backup) {
  if (!backup || backup.format !== FORMAT) return 'format';
  if (SUPPORTED_SCHEMA_VERSIONS.indexOf(backup.schemaVersion) < 0) return 'schemaVersion';
  if (!backup.data || !Array.isArray(backup.data.bills)) return 'data';
  return null;
}

/**
 * 从备份完整恢复。
 * 步骤：校验 → 写安全点 → 清旧账单 → 写新账单/分类/设置 → 校验
 * 任何失败尝试回滚到安全点。
 */
function restoreBackup(backup) {
  const err = validateBackup(backup);
  if (err) throw new Error('备份格式不正确：' + err);

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

    // 5. 校验条数
    if (result.total !== backup.data.bills.length) {
      throw new Error('恢复条数不一致');
    }

    return { restored: result.total, months: result.months };
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
}

module.exports = {
  FORMAT,
  SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  buildBackup,
  validateBackup,
  restoreBackup,
};
