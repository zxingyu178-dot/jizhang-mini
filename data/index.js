/**
 * data/index.js — 正式本地数据层统一入口（DailyValue Mini V1）
 *
 * 纯本地、无网络、无登录、无 Node。
 * 首次使用：init() 建目录、写默认分类/设置、无损迁移旧 jm_records。
 */
const fs = require('./fs');
const paths = require('./paths');
const money = require('./money');
const categories = require('./categories');
const settings = require('./settings');
const manifest = require('./manifest');
const ledger = require('./ledger');
const migration = require('./migration');
const migrationSchema = require('./migration-schema');
const migrationSchemaV3 = require('./migration-schema-v3');
const backup = require('./backup');
const importHistory = require('./import-history');
const dailyValue = require('./daily-value/index');
const budget = require('./budget/index');
const recurring = require('./recurring/index');

let initialized = false;

/** 初始化（幂等）。App onLaunch 时调用。 */
function init() {
  fs.ensureDir(paths.DIR.bills);
  fs.ensureDir(paths.DIR.legacy);
  manifest.ensureManifest();
  categories.ensureCategories();
  settings.ensureSettings();
  // 先迁旧 jm_records（产出的账单已是 V2 形态），再统一把月份分片升到 V2。
  migration.runMigration();
  migrationSchema.runSchemaMigration();
  // 再把月份分片从 V2 无损升到 V3（recurringRuleId）。
  migrationSchemaV3.runSchemaMigration();
  initialized = true;
  return getStatus();
}

function isInitialized() {
  return initialized;
}

function getStatus() {
  return {
    initialized,
    schemaVersion: manifest.getManifest().schemaVersion,
    appVersion: manifest.APP_VERSION,
    migration: manifest.getMigration('jmRecords'),
    schemaMigration: manifest.getMigration('billV2'),
  };
}

module.exports = {
  init,
  isInitialized,
  getStatus,
  // 账单
  addBill: ledger.addBill,
  addBills: ledger.addBills,
  getBill: ledger.getBill,
  deleteBill: ledger.deleteBill,
  updateBill: ledger.updateBill,
  monthSummary: ledger.monthSummary,
  monthGrouped: ledger.monthGrouped,
  listMonths: ledger.listMonths,
  listAccountingMonths: ledger.listAccountingMonths,
  rangeBills: ledger.rangeBills,
  // 日价派生（Bill 派生，不另建数据库）
  listDailyValueItems: function (today) {
    return dailyValue.computeDailyValueList(ledger.rangeBills(), today, (id) => categories.getCategory(id));
  },
  getDailyValueDetail: function (id, today) {
    return dailyValue.computeDailyValueDetail(
      ledger.getBill(id),
      today,
      (cid) => categories.getCategory(cid)
    );
  },
  // 分类
  getCategories: categories.getCategories,
  getActiveCategories: categories.getActiveCategories,
  getCategory: categories.getCategory,
  // 预算（Bill + Budget Rules 动态派生，不给 Bill 加预算字段）
  getBudgetState: budget.getBudgetState,
  saveBudgetRule: budget.saveBudgetRule,
  computeBudgetByKind: function (kind, today) {
    return budget.computeByKind(ledger.rangeBills(), budget.getBudgetState(), kind, today);
  },
  buildBudgetCalendar: function (year, month, today) {
    return budget.buildMonthCalendar(ledger.rangeBills(), budget.getBudgetState(), year, month, today);
  },
  buildBudgetDayDetail: function (dateStr) {
    return budget.buildDayDetail(
      ledger.rangeBills(),
      budget.getBudgetState(),
      dateStr,
      (id) => categories.getCategory(id)
    );
  },
  buildBudgetPaceSummary: function (today) {
    return budget.buildPaceSummary(ledger.rangeBills(), budget.getBudgetState(), today);
  },
  // 统计页所选月份的预算节奏上下文（当前月=截至今日；历史月=本月/上月最终）
  buildBudgetMonthPace: function (year, month, today) {
    return budget.buildMonthPaceContext(ledger.rangeBills(), budget.getBudgetState(), year, month, today);
  },
  // 设置
  getSettings: settings.getSettings,
  updateSettings: settings.updateSettings,
  // 备份 / 恢复
  buildBackup: backup.buildBackup,
  restoreBackup: backup.restoreBackup,
  // 导入历史
  getImportHistory: importHistory.getHistory,
  addImportHistory: importHistory.addImport,
  // 子模块
  money,
  fs,
  paths,
  ledger,
  categories,
  settings,
  manifest,
  backup,
  migration,
  migrationSchema,
  migrationSchemaV3,
  dailyValue,
  budget,
  recurring,
};
