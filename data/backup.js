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
 * v1.4.2：恢复 / 回滚改为「目标月份原子覆盖 + 只删除多余月份」，
 *        删除必须确认成功（fs.removeStrict），写后严格回读核对账单 ID 集合与关键字段；
 *        回滚前完整校验安全点（envelope / bills / categories / settings / recurringRules /
 *        重复 ID / 语义），任一项不合格都不进入破坏性回滚。
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

  const safety =
    typeof options.safetyPath === 'string' && options.safetyPath
      ? options.safetyPath
      : paths.legacyRestoreSafety();

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
    // 2. 用备份账单精确替换账本：
    //    只删除「备份中不存在」的月份；目标月份原子覆盖写，避免「删除失败但仍叠加写入」。
    const result = replaceLedgerWithBills(backup.data.bills, {
      deleteFailed: 'RESTORE_DELETE_FAILED',
      integrity: 'RESTORE_INTEGRITY_FAILED',
      stage: '恢复',
    });

    // 3. 分类、设置（原子写）
    fs.writeJSONAtomic(paths.FILE.categories, backup.data.categories || categories.DEFAULT_CATEGORIES);
    fs.writeJSONAtomic(paths.FILE.settings, Object.assign({}, settings.DEFAULT_SETTINGS, backup.data.settings || {}));

    // 4. 周期规则（V3 新增；V1/V2 备份无此字段 → 空）
    const ruleList = Array.isArray(backup.data.recurringRules) ? backup.data.recurringRules : [];
    recurringStore.replaceAllRules(ruleList);

    // 5. 元数据核对（结构 / 条数）
    verifyMetadata(backup.data, 'RESTORE_META_INTEGRITY_FAILED');

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

/* ============================ 恢复 / 回滚公共能力 ============================ */

/** 账单关键字段签名（JSON 数组编码，避免 | 等分隔符造成组合键碰撞） */
function billSignature(b) {
  return JSON.stringify([
    b.id,
    b.type,
    b.amountCents,
    b.occurredAt,
    b.categoryId,
    b.ledgerImpact || 'normal',
    b.sourceTxnId || null,
    b.source || 'manual',
    b.importBatchId || null,
    b.createdAt || 0,
    b.updatedAt || 0,
    b.title || '',
    b.merchant || '',
    b.note || '',
    b.dailyValue && b.dailyValue.enabled === true ? b.dailyValue.startDate : '',
    b.recurringRuleId || '',
  ]);
}

function shapeError(reason) {
  const err = new Error(reason);
  err.reason = reason;
  return err;
}

/**
 * 精确核对账本：数量、ID 集合、关键字段、重复 ID 全部一致。
 * 任一不一致 → 抛 code（RESTORE_INTEGRITY_FAILED / ROLLBACK_INTEGRITY_FAILED）。
 */
function verifyLedgerExact(expectedBills, code) {
  let actual;
  try {
    actual = ledger.readAllBillsStrict();
  } catch (e) {
    const err = new Error('账本回读失败，无法确认完整性');
    err.code = code;
    err.reason = (e && e.code) || 'READ_FAILED';
    throw err;
  }
  const expected = new Map();
  expectedBills.forEach((b) => expected.set(b.id, b));
  const actualMap = new Map();
  const duplicateIds = [];
  actual.forEach((b) => {
    if (actualMap.has(b.id)) duplicateIds.push(b.id);
    else actualMap.set(b.id, b);
  });
  const missing = [];
  const mismatched = [];
  expected.forEach((b, id) => {
    const a = actualMap.get(id);
    if (!a) missing.push(id);
    else if (billSignature(a) !== billSignature(b)) mismatched.push(id);
  });
  const extra = [];
  actualMap.forEach((_, id) => {
    if (!expected.has(id)) extra.push(id);
  });
  if (
    actual.length !== expectedBills.length ||
    missing.length ||
    extra.length ||
    mismatched.length ||
    duplicateIds.length
  ) {
    const err = new Error(
      '账本核对不一致（期望 ' + expectedBills.length + ' 笔，实际 ' + actual.length + ' 笔）'
    );
    err.code = code;
    err.expectedCount = expectedBills.length;
    err.actualCount = actual.length;
    err.missingCount = missing.length;
    err.extraCount = extra.length;
    err.mismatchedCount = mismatched.length;
    err.duplicateIdCount = duplicateIds.length;
    err.missingIds = missing.slice(0, 20);
    err.extraIds = extra.slice(0, 20);
    err.mismatchedIds = mismatched.slice(0, 20);
    throw err;
  }
}

/** 账单按月份分组并保持原有倒序（与 ledger.addBills 的排序口径一致） */
function groupBillsByMonth(bills) {
  const groups = {};
  bills.forEach((b) => {
    const ym = ledger.ymOf(b.occurredAt);
    if (!groups[ym]) groups[ym] = [];
    groups[ym].push(b);
  });
  Object.keys(groups).forEach((ym) => ledger.sortBills(groups[ym]));
  return groups;
}

/**
 * 用目标账单集合精确替换账本：
 *   1) 只删除「目标月份之外」的分片，删除必须成功且删除后不存在；
 *   2) 目标月份用原子写整体覆盖（不依赖 unlink，也不会与旧账单叠加）；
 *   3) 写后严格回读，核对数量 / ID 集合 / 关键字段。
 */
function replaceLedgerWithBills(inputBills, opts) {
  const bills = (inputBills || []).map((b) => ledger.createBill(b));
  const groups = groupBillsByMonth(bills);
  const targetMonths = Object.keys(groups).sort();
  const existing = ledger.listMonths();
  const extra = existing.filter((ym) => !groups[ym]);
  const failed = [];
  extra.forEach((ym) => {
    try {
      ledger.removeMonthFileStrict(ym);
    } catch (e) {
      failed.push({ ym: ym, code: (e && e.code) || 'MONTH_DELETE_FAILED' });
    }
  });
  if (failed.length) {
    const err = new Error(
      opts.stage + '中止：多余月份分片未能删除（' + failed.map((x) => x.ym).join('、') + '）'
    );
    err.code = opts.deleteFailed;
    err.months = failed;
    throw err;
  }
  targetMonths.forEach((ym) => {
    ledger.writeMonthFile(ym, { ym: ym, version: ledger.SCHEMA_VERSION, bills: groups[ym] });
  });
  verifyLedgerExact(bills, opts.integrity);
  return { total: bills.length, months: targetMonths };
}

/** 稳定序列化（对象键排序），用于元数据精确比对 */
function stableStringify(value) {
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

/** 严格读取周期规则文件（损坏 / 结构非法直接抛，不回落空规则） */
function readRecurringRulesStrict() {
  if (!fs.exists(paths.FILE.recurring)) return [];
  const raw = fs.readJSONStrict(paths.FILE.recurring);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.rules)) {
    throw shapeError('recurring-shape');
  }
  return raw.rules;
}

/** 元数据核对：分类 / 设置 / 周期规则按规范化后的内容精确比对 */
function verifyMetadata(data, code) {
  try {
    const expectedCats = Array.isArray(data.categories) ? data.categories : categories.DEFAULT_CATEGORIES;
    const cats = fs.readJSONStrict(paths.FILE.categories);
    if (!Array.isArray(cats)) throw shapeError('categories-not-array');
    if (stableStringify(cats) !== stableStringify(expectedCats)) {
      throw shapeError('categories-mismatch');
    }

    const expectedSettings = Object.assign({}, settings.DEFAULT_SETTINGS, data.settings || {});
    const set = fs.readJSONStrict(paths.FILE.settings);
    if (!set || typeof set !== 'object' || Array.isArray(set)) throw shapeError('settings-invalid');
    if (stableStringify(set) !== stableStringify(expectedSettings)) {
      throw shapeError('settings-mismatch');
    }

    const expectedRules = (Array.isArray(data.recurringRules) ? data.recurringRules : []).map((r) =>
      recurringStore.normalizeRule(r)
    );
    const actualRules = readRecurringRulesStrict();
    if (stableStringify(actualRules) !== stableStringify(expectedRules)) {
      throw shapeError('recurring-mismatch');
    }
  } catch (e) {
    const err = new Error('元数据核对不一致');
    err.code = code;
    err.reason = (e && e.reason) || (e && e.code) || 'META_MISMATCH';
    throw err;
  }
}

/**
 * 回滚安全点完整结构校验：envelope / bills / categories / settings / recurringRules /
 * 重复 ID / 语义校验。任一项不通过 → ROLLBACK_SAFETY_INVALID，禁止进入破坏性回滚。
 */
function validateSafetyPoint(saved) {
  const problems = [];
  const envErr = validateBackup(saved);
  if (envErr) problems.push('envelope-' + envErr);
  if (!saved || !saved.data || typeof saved.data !== 'object' || Array.isArray(saved.data)) {
    problems.push('data-missing');
  } else {
    if (!Array.isArray(saved.data.bills)) problems.push('bills-not-array');
    if (!Array.isArray(saved.data.categories)) problems.push('categories-not-array');
    if (
      !saved.data.settings ||
      typeof saved.data.settings !== 'object' ||
      Array.isArray(saved.data.settings)
    ) {
      problems.push('settings-invalid');
    }
    if (saved.data.recurringRules !== undefined && !Array.isArray(saved.data.recurringRules)) {
      problems.push('recurring-not-array');
    }
    if (Array.isArray(saved.data.bills)) {
      const seen = new Set();
      saved.data.bills.forEach((b, i) => {
        if (!b || typeof b !== 'object' || Array.isArray(b)) {
          problems.push('bill-shape:' + i);
        } else if (typeof b.id !== 'string' || !b.id) {
          problems.push('bill-id:' + i);
        } else if (seen.has(b.id)) {
          problems.push('bill-duplicate-id:' + b.id);
        } else {
          seen.add(b.id);
        }
      });
    }
    try {
      const vr = backupValidator.validateBackupRaw(saved);
      if (!vr.ok) vr.errors.forEach((x) => problems.push(x.code));
    } catch (e) {
      problems.push('validator-error');
    }
  }
  if (problems.length) {
    const err = new Error('回滚安全点结构校验未通过，已中止回滚（现场与安全点保留）');
    err.code = 'ROLLBACK_SAFETY_INVALID';
    err.problems = problems.slice(0, 30);
    throw err;
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
 *   - 安全点不可读 → ROLLBACK_SAFETY_UNAVAILABLE；
 *   - 安全点结构 / 语义不合格 → ROLLBACK_SAFETY_INVALID（不删除任何当前文件）；
 *   - 回滚前隔离未完成 → ROLLBACK_QUARANTINE_INCOMPLETE；
 *   - 回滚后账本 / 元数据核对不一致 → ROLLBACK_*_INTEGRITY_FAILED。
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
  // 任何删除之前先做完整结构校验：安全点不合格绝不进入破坏性回滚。
  validateSafetyPoint(saved);
  // QA-01 删前隔离（同源问题：回滚同样先删后写）：此刻被删的分片若无安全点覆盖，
  // 原始字节就是最后一次可抢救机会。隔离未完成 → 禁止继续删除。
  const q = quarantine.quarantineUnreadableMonths(quarantine.TRIGGERS.IMPORT_ROLLBACK);
  if (!q.safeToProceed) {
    throw quarantineAbortError('ROLLBACK_QUARANTINE_INCOMPLETE', '回滚已中止', q, true);
  }
  const result = replaceLedgerWithBills(saved.data.bills, {
    deleteFailed: 'ROLLBACK_DELETE_FAILED',
    integrity: 'ROLLBACK_INTEGRITY_FAILED',
    stage: '回滚',
  });
  fs.writeJSONAtomic(paths.FILE.categories, saved.data.categories || categories.DEFAULT_CATEGORIES);
  fs.writeJSONAtomic(
    paths.FILE.settings,
    Object.assign({}, settings.DEFAULT_SETTINGS, saved.data.settings || {})
  );
  recurringStore.replaceAllRules(Array.isArray(saved.data.recurringRules) ? saved.data.recurringRules : []);
  verifyMetadata(saved.data, 'ROLLBACK_META_INTEGRITY_FAILED');
  // 回滚恢复了原 settings，Theme Manager 也回到回滚后的主题。
  theme.reloadFromStorage();
  return { attempted: true, completed: true, restored: result.total, months: result.months };
}

module.exports = {
  FORMAT,
  SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  buildBackup,
  validateBackup,
  restoreBackup,
};
