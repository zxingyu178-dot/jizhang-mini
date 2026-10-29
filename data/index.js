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
const idRepair = require('./id-repair');
const backup = require('./backup');
const importHistory = require('./import-history');
const dailyValue = require('./daily-value/index');
const budget = require('./budget/index');
const budgetPeriod = require('./budget/period');
const recurring = require('./recurring/index');
const search = require('./search/index');
const csvExport = require('./export/csv');
const health = require('./health');

let initialized = false;

/** 初始化（幂等）。App onLaunch 时调用。 */
function init() {
  fs.ensureDir(paths.DIR.bills);
  fs.ensureDir(paths.DIR.legacy);
  manifest.ensureManifest();
  categories.ensureCategories();
  settings.ensureSettings();
  // 先为历史缺 id 账单补确定性 id（补缺损省，不改语义），避免后续迁移校验失败。
  idRepair.repairMissingIds();
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

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
/** 日期闭区间 [startStr, endStr]（均含）→ 只读取覆盖月份的账单分片 */
function rangeBillsForDays(startStr, endStr) {
  return ledger.rangeBills(startStr.slice(0, 7), endStr.slice(0, 7));
}
/** 'YYYY-MM' 减一个月 → 'YYYY-MM'（处理跨年） */
function prevYM(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
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
    return dailyValue.computeDailyValueList(ledger.rangeBills(), today, categories.getCategoryResolver());
  },
  getDailyValueDetail: function (id, today) {
    return dailyValue.computeDailyValueDetail(
      ledger.getBill(id),
      today,
      categories.getCategoryResolver()
    );
  },
  // 分类
  getCategories: categories.getCategories,
  getActiveCategories: categories.getActiveCategories,
  getCategory: categories.getCategory,
  getCategoryMap: categories.getCategoryMap,
  getCategoryResolver: categories.getCategoryResolver,
  // 预算（Bill + Budget Rules 动态派生，不给 Bill 加预算字段）
  getBudgetState: budget.getBudgetState,
  saveBudgetRule: budget.saveBudgetRule,
  computeBudgetByKind: function (kind, today) {
    const state = budget.getBudgetState();
    const todayStr = today || dailyValue.localDateKey();
    const p = budgetPeriod.buildPeriod(kind, todayStr, state.weekStartsOn);
    const lastDay = budgetPeriod.addDays(p.end, -1);
    return budget.computeByKind(rangeBillsForDays(p.start, lastDay), state, kind, todayStr);
  },
  buildBudgetCalendar: function (year, month, today) {
    const ym = year + '-' + pad2(month);
    return budget.buildMonthCalendar(ledger.rangeBills(ym, ym), budget.getBudgetState(), year, month, today);
  },
  buildBudgetDayDetail: function (dateStr) {
    const ym = dateStr.slice(0, 7);
    return budget.buildDayDetail(
      ledger.rangeBills(ym, ym),
      budget.getBudgetState(),
      dateStr,
      categories.getCategoryResolver()
    );
  },
  buildBudgetPaceSummary: function (today) {
    const state = budget.getBudgetState();
    const todayStr = today || dailyValue.localDateKey();
    // 覆盖「上周（最早）→ 本月（最晚）」：上周一到本月最后一天，最多两个月
    const curMonday = budgetPeriod.mondayOf(todayStr);
    const lastWeekStart = budgetPeriod.addDays(curMonday, -7);
    const monthLastDay = budgetPeriod.addDays(budgetPeriod.firstOfNextMonth(todayStr), -1);
    return budget.buildPaceSummary(rangeBillsForDays(lastWeekStart, monthLastDay), state, todayStr);
  },
  // 统计页所选月份的预算节奏上下文（当前月=截至今日；历史月=本月/上月最终）
  buildBudgetMonthPace: function (year, month, today) {
    const state = budget.getBudgetState();
    const todayStr = today || dailyValue.localDateKey();
    const ym = year + '-' + pad2(month);
    let bills;
    if (ym === todayStr.slice(0, 7)) {
      // 当前月：同 buildPaceSummary 的覆盖范围（上周一 → 本月最后一天）
      const curMonday = budgetPeriod.mondayOf(todayStr);
      const lastWeekStart = budgetPeriod.addDays(curMonday, -7);
      const monthLastDay = budgetPeriod.addDays(budgetPeriod.firstOfNextMonth(todayStr), -1);
      bills = rangeBillsForDays(lastWeekStart, monthLastDay);
    } else {
      // 历史月：该月 + 上月（lastmonth 口径需要上月数据）
      bills = ledger.rangeBills(prevYM(ym), ym);
    }
    return budget.buildMonthPaceContext(bills, state, year, month, todayStr);
  },
  // 设置
  getSettings: settings.getSettings,
  updateSettings: settings.updateSettings,
  // 备份 / 恢复
  buildBackup: backup.buildBackup,
  restoreBackup: backup.restoreBackup,
  // 高级搜索（Bill Explorer，纯函数；rangeBills 提供全部账单）
  searchBills: function (query) {
    return search.searchBills(ledger.rangeBills(), query, categories.getCategoryResolver());
  },
  groupSearchResults: function (matchedBills) {
    return search.groupSearchResults(matchedBills, categories.getCategoryResolver());
  },
  buildSearchQuery: search.buildSearchQuery,
  // 账单 CSV 导出（Gate 6，查看/分析用，非恢复格式）
  exportBillsCSV: function () {
    return csvExport.buildBillsCSV(ledger.rangeBills(), categories.getCategoryResolver());
  },
  // 数据健康体检（只读，G10）
  runHealthScan: health.runHealthScan,
  analyzeHealth: health.analyzeHealth,
  collectHealthData: health.collectHealthData,
  formatHealthReport: health.formatHealthReport,
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
  idRepair,
  dailyValue,
  budget,
  recurring,
  search,
  csvExport,
  health,
};
