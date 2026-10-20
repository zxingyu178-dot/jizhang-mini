/**
 * data/backup-validator.js — 备份「原始数据」恢复前校验（v0.8.0 / G2 P0）
 *
 * 背景（P0）：旧 restoreBackup 直接 ledger.addBills(backup.data.bills)，内部 createBill
 * 会自动「修好」非法值（type='foobar'→expense、ledgerImpact 非法→normal、缺 id→生成、
 * 缺 occurredAt→now），最后才跑 health scan —— 此时原始损坏已被掩盖，部分损坏备份被
 * 静默改义后成功恢复。
 *
 * 本校验在**落盘前**对**原始备份**做只读语义校验：
 *   - 绝不修改非法值、绝不补默认业务字段（缺必填字段 → error，拒绝恢复）；
 *   - 一次收集全部 errors / warnings（不遇首错即停）；
 *   - 复用 health.analyzeHealth 校验账单（口径与落盘后体检一致），
 *     再补 envelope、categories / settings / recurringRules 的整体结构、
 *     重复 ID（category / budget-rule / recurring-rule）与交叉引用。
 *
 * 原则：不确定的数据宁可拒绝恢复，也不能偷偷改变含义。
 * 注意：版本迁移（V1/V2→V3）属于「显式迁移」，在 backup-migration（G3）完成后再喂给本校验。
 */
const health = require('./health');
const recurringCore = require('./recurring/core');

const FORMAT = 'daily-value-mini-backup';
const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3];

function issue(level, code, scope, ref, detail) {
  return {
    level,
    code,
    scope: scope || '',
    ref: ref || '',
    detail: detail == null ? '' : String(detail),
  };
}

function finalize(errors, warnings, version) {
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    version: version == null ? null : version,
  };
}

/** 把账单按本地业务月份分组（非法 occurredAt 归入 '____'，由 analyzeHealth 报错） */
function groupBillsByMonth(bills) {
  const groups = {};
  bills.forEach((b) => {
    let ym = '____';
    if (b && Number.isFinite(b.occurredAt) && b.occurredAt > 0) {
      const d = new Date(b.occurredAt);
      ym =
        d.getFullYear() +
        '-' +
        recurringCore.pad2(d.getMonth() + 1);
    }
    if (!groups[ym]) groups[ym] = [];
    groups[ym].push(b);
  });
  const rawMonthFiles = {};
  Object.keys(groups)
    .sort()
    .forEach((ym) => {
      // inner ym 与分组 key 一致，避免触发 month-ym-mismatch；version 统一按已迁移 V3
      rawMonthFiles[ym] = { parseError: false, parsed: { ym, version: 3, bills: groups[ym] } };
    });
  return rawMonthFiles;
}

/** 校验 categories 整体结构（analyzeHealth 只把分类用于建 id 集合，不校验其结构） */
function validateCategoriesStructure(data, pushE, pushW) {
  const cats = data.categories;
  if (cats === undefined || cats === null) {
    pushE('backup-categories-missing', 'categories');
    return;
  }
  if (!Array.isArray(cats)) {
    pushE('backup-categories-not-array', 'categories');
    return;
  }
  const seen = new Set();
  cats.forEach((c, i) => {
    const ref = 'cat#' + i;
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      pushE('category-shape', 'categories', ref);
      return;
    }
    if (typeof c.id !== 'string' || !c.id) {
      pushE('category-id-missing', 'categories', ref);
    } else if (seen.has(c.id)) {
      pushE('category-duplicate-id', 'categories', c.id);
    } else {
      seen.add(c.id);
    }
    if (typeof c.name !== 'string' || !c.name.trim()) {
      pushE('category-name-missing', 'categories', ref);
    }
    if (c.emoji !== undefined && typeof c.emoji !== 'string') {
      pushE('category-emoji-invalid', 'categories', ref);
    }
    if (c.builtin !== undefined && typeof c.builtin !== 'boolean') {
      pushW('category-builtin-invalid', 'categories', ref);
    }
    if (c.archived !== undefined && typeof c.archived !== 'boolean') {
      pushW('category-archived-invalid', 'categories', ref);
    }
  });
}

/** 校验 settings 整体结构（含 budget 整体形态 / weekStartsOn / 预算规则重复 id） */
function validateSettingsStructure(data, pushE, pushW) {
  const s = data.settings;
  if (s === undefined || s === null) {
    pushW('backup-settings-missing', 'settings'); // settings 可补默认，warning
    return;
  }
  if (typeof s !== 'object' || Array.isArray(s)) {
    pushE('backup-settings-invalid', 'settings');
    return;
  }
  const budget = s.budget;
  if (budget === undefined || budget === null) return;
  if (typeof budget !== 'object' || Array.isArray(budget)) {
    pushE('budget-shape', 'settings/budget');
    return;
  }
  if (budget.version !== undefined && budget.version !== 1) {
    pushW('budget-version-invalid', 'settings/budget', '', 'version=' + budget.version);
  }
  if (
    budget.weekStartsOn !== undefined &&
    budget.weekStartsOn !== 0 &&
    budget.weekStartsOn !== 1
  ) {
    pushW('budget-week-starts-invalid', 'settings/budget', '', 'v=' + budget.weekStartsOn);
  }
  if (!Array.isArray(budget.rules)) {
    pushE('budget-rules-not-array', 'settings/budget');
    return;
  }
  // analyzeHealth 已校预算规则单项（effectiveFrom/dailyCents/enabled）；这里补重复 id
  const seen = new Set();
  budget.rules.forEach((r, i) => {
    if (r && typeof r.id === 'string' && r.id) {
      if (seen.has(r.id)) pushE('budget-rule-duplicate-id', 'budget', 'budget#' + i);
      else seen.add(r.id);
    }
  });
}

/** 校验 recurringRules 整体结构（数组形态 / 重复 id / 规则分类交叉引用） */
function validateRecurringStructure(data, pushE, pushW) {
  const rules = data.recurringRules;
  if (rules === undefined || rules === null) {
    pushE('backup-recurring-rules-missing', 'recurring'); // V3 备份必含该字段（空数组合法）
    return;
  }
  if (!Array.isArray(rules)) {
    pushE('backup-recurring-rules-not-array', 'recurring');
    return;
  }
  const catIds = new Set();
  (Array.isArray(data.categories) ? data.categories : []).forEach((c) => {
    if (c && c.id) catIds.add(c.id);
  });
  const seen = new Set();
  rules.forEach((r, i) => {
    const ref = 'rule#' + i;
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      pushE('recurring-rule-shape', 'recurring', ref);
      return;
    }
    if (typeof r.id !== 'string' || !r.id) {
      pushE('recurring-rule-id-missing', 'recurring', ref);
    } else if (seen.has(r.id)) {
      pushE('recurring-rule-duplicate-id', 'recurring', r.id);
    } else {
      seen.add(r.id);
    }
    // 规则分类交叉引用：归档分类在全量集合中允许；完全不存在 → error（周期会持续生成悬空分类账单）
    if (typeof r.categoryId === 'string' && r.categoryId && !catIds.has(r.categoryId)) {
      pushE('recurring-rule-category-unknown', 'recurring', ref, 'cat=' + health.shortId(r.categoryId));
    }
  });
}

/**
 * 校验备份原始数据（恢复前调用）。
 * @param {object} input 备份对象
 * @returns {{ok:boolean, errors:Array, warnings:Array, version:number|null}}
 */
function validateBackupRaw(input) {
  const errors = [];
  const warnings = [];
  const pushE = (code, scope, ref, detail) => errors.push(issue('error', code, scope, ref, detail));
  const pushW = (code, scope, ref, detail) => warnings.push(issue('warning', code, scope, ref, detail));

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return finalize([issue('error', 'backup-not-object', 'envelope')], [], null);
  }

  // 1. envelope
  if (input.format !== FORMAT) {
    pushE('backup-format-invalid', 'envelope', '', 'format=' + input.format);
  }
  const version = input.schemaVersion;
  if (SUPPORTED_SCHEMA_VERSIONS.indexOf(version) < 0) {
    pushE('backup-schema-version-invalid', 'envelope', '', 'version=' + version);
  }
  const data = input.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    pushE('backup-data-missing', 'envelope');
    return finalize(errors, warnings, version);
  }

  // 2. bills：必须数组；复用 analyzeHealth（按月份分组，口径与落盘体检一致）
  const bills = data.bills;
  if (!Array.isArray(bills)) {
    pushE('backup-bills-not-array', 'bills');
  } else {
    const hr = health.analyzeHealth({
      rawMonthFiles: groupBillsByMonth(bills),
      categories: Array.isArray(data.categories) ? data.categories : [],
      recurringRulesRaw: Array.isArray(data.recurringRules) ? data.recurringRules : [],
      budgetRulesRaw:
        data.settings && data.settings.budget && Array.isArray(data.settings.budget.rules)
          ? data.settings.budget.rules
          : [],
    });
    hr.errors.forEach((e) => errors.push(e));
    hr.warnings.forEach((w) => warnings.push(w));
  }

  // 3-5. 整体结构、重复 id、交叉引用
  validateCategoriesStructure(data, pushE, pushW);
  validateSettingsStructure(data, pushE, pushW);
  validateRecurringStructure(data, pushE, pushW);

  return finalize(errors, warnings, version);
}

module.exports = {
  FORMAT,
  SUPPORTED_SCHEMA_VERSIONS,
  validateBackupRaw,
};
