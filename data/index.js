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
const backup = require('./backup');
const importHistory = require('./import-history');

let initialized = false;

/** 初始化（幂等）。App onLaunch 时调用。 */
function init() {
  fs.ensureDir(paths.DIR.bills);
  fs.ensureDir(paths.DIR.legacy);
  manifest.ensureManifest();
  categories.ensureCategories();
  settings.ensureSettings();
  migration.runMigration();
  initialized = true;
  return getStatus();
}

function isInitialized() {
  return initialized;
}

function getStatus() {
  return {
    initialized,
    appVersion: manifest.APP_VERSION,
    migration: manifest.getMigration('jmRecords'),
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
  rangeBills: ledger.rangeBills,
  // 分类
  getCategories: categories.getCategories,
  getCategory: categories.getCategory,
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
};
