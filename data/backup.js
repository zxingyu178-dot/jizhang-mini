/**
 * data/backup.js — Mini 完整备份 / 恢复（DailyValueMiniBackupV1）
 *
 * 备份对象（.dvmini.json）：
 *   { format:'daily-value-mini-backup', schemaVersion:1, appVersion, exportedAt,
 *     data:{ bills:[...], categories:[...], settings:{...} } }
 *
 * 完整恢复（非普通账单导入）：恢复前写安全点，失败可回滚。
 */
const fs = require('./fs');
const paths = require('./paths');
const ledger = require('./ledger');
const categories = require('./categories');
const settings = require('./settings');

const FORMAT = 'daily-value-mini-backup';
const SCHEMA_VERSION = 1;
const APP_VERSION = '0.2.0';

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

/** 校验备份；返回错误类型或 null */
function validateBackup(backup) {
  if (!backup || backup.format !== FORMAT) return 'format';
  if (backup.schemaVersion !== SCHEMA_VERSION) return 'schemaVersion';
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
  buildBackup,
  validateBackup,
  restoreBackup,
};
