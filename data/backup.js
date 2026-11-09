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
 * QA-01：恢复 / 回滚清空月份分片之前，先把「存在但不可解析」的分片原始字节
 *        隔离转存到 <USER_DATA_PATH>/quarantine/<时间戳>/（见 data/quarantine.js）。
 * v1.4.1：隔离改为 fail-closed —— 只有隔离完整（逐字节回读校验通过且 meta 写好）
 *        才允许删除 / 覆盖；隔离失败立即中止，原始分片保持原样。
 */
const fs = require('./fs');
const paths = require('./paths');
const ledger = require('./ledger');
const categories = require('./categories');
const settings = require('./settings');
const recurringStore = require('./recurring/store');
const backupValidator = require('./backup-validator');
const backupMigration = require('./backup-migration');
const quarantine = require('./quarantine');
const health = require('./health');
const theme = require('../utils/theme');
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
 * 从备份完整恢复（v1.4.1 fail-closed）。
 *
 * 步骤：校验 → 删前隔离（必须 safeToProceed）→ 写安全点 → 清旧账单 →
 *       写新账单/分类/设置/周期规则 → 条数校验 → 数据健康终检。
 *
 * 失败边界：
 *   - 隔离未完成：直接抛 `QUARANTINE_INCOMPLETE`，**不删除、不覆盖、不回滚**；
 *   - 安全点创建失败：抛 `SAFETY_POINT_FAILED`，现有账本未修改；
 *   - 恢复中途失败：按安全点回滚，错误对象带
 *     `mutationStarted / rollbackAttempted / rollbackCompleted`；
 *   - 回滚失败：抛 `ROLLBACK_QUARANTINE_INCOMPLETE` 等明确错误，不删除安全点、不谎报成功。
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

  // 0. 删前隔离（最高优先级）：损坏分片必须先逐字节转存成功。
  //    放在安全点之前：即使安全点创建失败，损坏字节也已经保护好。
  const q = quarantine.quarantineUnreadableMonths(quarantine.TRIGGERS.RESTORE);
  if (!q.safeToProceed) {
    throw quarantineAbortError('QUARANTINE_INCOMPLETE', '恢复已中止', q, false);
  }

  // 1. 安全点（当前完整数据；原子写，最需要安全时安全点自身不能写坏）
  try {
    fs.writeJSONAtomic(safety, buildBackup());
  } catch (e) {
    const se = new Error('无法创建恢复安全点，已中止（现有账本未修改）');
    se.code = 'SAFETY_POINT_FAILED';
    se.reason = (e && e.code) || 'BUILD_OR_WRITE_FAILED';
    se.unreadable = q.items.map((it) => ({ ym: it.ym, reason: it.reason }));
    se.mutationStarted = false;
    se.rollbackAttempted = false;
    se.rollbackCompleted = false;
    throw se;
  }

  let mutationStarted = false;
  try {
    mutationStarted = true;
    // 2. 清空现有月份分片
    ledger.listMonths().forEach((ym) => fs.remove(paths.billFile(ym)));

    // 3. 写入新账单
    const result = ledger.addBills(backup.data.bills);

    // 4. 分类、设置（原子写）
    fs.writeJSONAtomic(paths.FILE.categories, backup.data.categories || categories.DEFAULT_CATEGORIES);
    fs.writeJSONAtomic(paths.FILE.settings, Object.assign({}, settings.DEFAULT_SETTINGS, backup.data.settings || {}));

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

    // 7. 同步 Theme Manager：恢复覆盖了 settings.theme（如深色→浅色），
    //    立即从磁盘重新加载并通知，当前 App 即时切换，无需重启。
    theme.reloadFromStorage();

    return {
      restored: result.total,
      months: result.months,
      warningCount,
      warnings,
      quarantine: {
        complete: q.complete,
        safeToProceed: q.safeToProceed,
        targetCount: q.targetCount,
        copiedCount: q.copiedCount,
        dir: q.dir,
      },
    };
  } catch (e) {
    // mutationStarted=false 时（理论上不会进入，删除前已全部前置校验）不得回滚删除
    if (!mutationStarted) {
      e.mutationStarted = false;
      e.rollbackAttempted = false;
      e.rollbackCompleted = false;
      throw e;
    }
    try {
      rollback(safety);
    } catch (re) {
      const combined = new Error(
        '恢复失败，且回滚未完成（现场与安全点均已保留）：' + (e.message || e.code || '未知错误')
      );
      combined.code = e.code || 'RESTORE_FAILED';
      combined.mutationStarted = true;
      combined.rollbackAttempted = true;
      combined.rollbackCompleted = false;
      combined.rollbackError = {
        code: (re && re.code) || 'ROLLBACK_FAILED',
        message: (re && re.message) || String(re),
      };
      throw combined;
    }
    e.mutationStarted = true;
    e.rollbackAttempted = true;
    e.rollbackCompleted = true;
    throw e;
  }
}

/** 构造「隔离未完成 → 中止」错误（不泄漏任何账单内容） */
function quarantineAbortError(code, action, q, mutationStarted) {
  const err = new Error(action + '：损坏分片隔离未完成，已中止（未删除任何原始分片）');
  err.code = code;
  err.quarantine = {
    complete: q.complete,
    safeToProceed: q.safeToProceed,
    targetCount: q.targetCount,
    copiedCount: q.copiedCount,
    failedCount: q.failedCount,
    metaWritten: q.metaWritten,
    skipped: q.skipped,
    dir: q.dir,
  };
  err.mutationStarted = !!mutationStarted;
  err.rollbackAttempted = false;
  err.rollbackCompleted = false;
  return err;
}

/**
 * 从安全点回滚（fail-closed）。
 *   - 安全点不可读 → 抛 `ROLLBACK_SAFETY_UNAVAILABLE`，不清账本、不删除安全点；
 *   - 回滚前隔离未完成 → 抛 `ROLLBACK_QUARANTINE_INCOMPLETE`，不清账本。
 */
function rollback(safetyPath) {
  let saved;
  try {
    saved = fs.readJSONStrict(safetyPath);
  } catch (e) {
    const err = new Error('回滚安全点不可用，已中止回滚（现场保留）');
    err.code = 'ROLLBACK_SAFETY_UNAVAILABLE';
    err.reason = (e && e.code) || 'READ_FAILED';
    throw err;
  }
  if (!saved || !saved.data) {
    const err = new Error('回滚安全点结构不完整，已中止回滚（现场保留）');
    err.code = 'ROLLBACK_SAFETY_UNAVAILABLE';
    err.reason = 'SHAPE';
    throw err;
  }
  // QA-01 删前隔离（同源问题：回滚同样先删后写）：此刻被删的分片若无安全点覆盖，
  // 原始字节就是最后一次可抢救机会。隔离未完成 → 禁止继续删除。
  const q = quarantine.quarantineUnreadableMonths(quarantine.TRIGGERS.IMPORT_ROLLBACK);
  if (!q.safeToProceed) {
    throw quarantineAbortError('ROLLBACK_QUARANTINE_INCOMPLETE', '回滚已中止', q, true);
  }
  ledger.listMonths().forEach((ym) => fs.remove(paths.billFile(ym)));
  ledger.addBills(saved.data.bills || []);
  fs.writeJSONAtomic(paths.FILE.categories, saved.data.categories || categories.DEFAULT_CATEGORIES);
  fs.writeJSONAtomic(paths.FILE.settings, saved.data.settings || settings.DEFAULT_SETTINGS);
  recurringStore.replaceAllRules(Array.isArray(saved.data.recurringRules) ? saved.data.recurringRules : []);
  // 回滚恢复了原 settings，Theme Manager 也回到回滚后的主题。
  theme.reloadFromStorage();
  return { attempted: true, completed: true };
}

module.exports = {
  FORMAT,
  SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  buildBackup,
  validateBackup,
  restoreBackup,
};
