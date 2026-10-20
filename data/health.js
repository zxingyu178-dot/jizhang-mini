/**
 * data/health.js — 本地数据健康体检（v0.7.0 G10）
 *
 * 设计原则：
 *   1. 只读、纯诊断，绝不自动修改 / 修复任何用户数据；
 *   2. 纯函数 analyzeHealth(data) 与 IO（collectHealthData）分离，便于 Node 单测；
 *   3. 问题分两级：
 *      - error   结构损坏（恢复备份时应回滚，不提交）；
 *      - warning 可放行的历史/软引用问题（如引用已删除规则、已归档分类）；
 *   4. 诊断脱敏：只输出 code / 位置 / 短 id，不输出金额、备注、商户等用户内容。
 *
 * 覆盖：
 *   - 月份分片：文件损坏 / 结构 / version / ym 与文件名一致 / bills 为数组；
 *   - Bill：id 缺失、全局重复 id、type / amountCents / occurredAt / ledgerImpact；
 *   - 分类：categoryId 缺失（warning）或在分类表中不存在（warning，含归档分类）；
 *   - 日价：dailyValue.enabled 但 startDate 非法（error）；
 *   - 周期：source='recurring' 却缺 recurringRuleId（error）；
 *           recurringRuleId 指向已不存在的规则（warning，删除规则后历史账单保留是正常的）；
 *   - 周期规则：复用 recurring/core.validateRecurringRule 做硬校验（error）；
 *   - 预算规则：effectiveFrom 非真实日期 / dailyCents 非法（error），enabled 非布尔（warning）；
 *   - manifest：schemaVersion 非法（warning）。
 */
const fs = require('./fs');
const paths = require('./paths');
const ledger = require('./ledger');
const categories = require('./categories');
const settings = require('./settings');
const recurringStore = require('./recurring/store');
const recurringCore = require('./recurring/core');

const VALID_SCHEMA_VERSIONS = [1, 2, 3];
const VALID_TYPES = ['expense', 'income'];
const VALID_IMPACT = ['normal', 'daily-value-only'];

/** 短 id（脱敏：只保留前 8 位） */
function shortId(v) {
  if (v == null) return '';
  const s = String(v);
  return s.length > 8 ? s.slice(0, 8) + '…' : s;
}

function issue(level, code, scope, ref, detail) {
  return {
    level,
    code,
    scope: scope || '',
    ref: ref || '',
    detail: detail == null ? '' : String(detail),
  };
}

/**
 * 纯函数：对已读取的数据包做健康分析。
 * @param {object} d
 *   {
 *     manifest: object|null,
 *     rawMonthFiles: { [ym]: { parseError:boolean, parsed:object|null } },
 *     categories: Array,                 // 全量（含归档）
 *     recurringRulesRaw: Array,         // 存储中的原始规则（不经过 normalize）
 *     budgetRulesRaw: Array,            // 存储中的原始预算规则
 *   }
 * @returns {{ok:boolean, errors:Array, warnings:Array, summary:object}}
 */
function analyzeHealth(d) {
  d = d || {};
  const errors = [];
  const warnings = [];
  const pushE = (code, scope, ref, detail) => errors.push(issue('error', code, scope, ref, detail));
  const pushW = (code, scope, ref, detail) => warnings.push(issue('warning', code, scope, ref, detail));

  // 分类 id 集合（全量，含已归档：历史账单引用归档分类是合法的）；重复 id 为 error
  const catIds = new Set();
  (d.categories || []).forEach((c, i) => {
    if (c && c.id) {
      if (catIds.has(c.id)) {
        pushE('category-duplicate-id', 'categories', 'cat#' + i, shortId(c.id));
      }
      catIds.add(c.id);
    }
  });

  // 周期规则 id 集合（用于孤儿引用检测）；重复 id 为 error
  const ruleIds = new Set();
  (d.recurringRulesRaw || []).forEach((r, i) => {
    if (r && r.id) {
      if (ruleIds.has(r.id)) {
        pushE('recurring-rule-duplicate-id', 'recurring', 'rule#' + i, shortId(r.id));
      }
      ruleIds.add(r.id);
    }
  });

  let monthCount = 0;
  let billCount = 0;
  const idSeen = new Map(); // billId -> 首次出现的 ym

  const monthFiles = d.rawMonthFiles || {};
  Object.keys(monthFiles)
    .sort()
    .forEach((ym) => {
      monthCount += 1;
      const entry = monthFiles[ym];
      if (!entry || entry.parseError || entry.parsed == null) {
        pushE('month-file-corrupt', 'month', ym);
        return;
      }
      const mf = entry.parsed;
      if (typeof mf !== 'object' || mf === null || Array.isArray(mf)) {
        pushE('month-file-shape', 'month', ym);
        return;
      }
      if (VALID_SCHEMA_VERSIONS.indexOf(mf.version) < 0) {
        pushE('month-version-invalid', 'month', ym, 'version=' + mf.version);
      }
      if (mf.ym != null && mf.ym !== ym) {
        pushW('month-ym-mismatch', 'month', ym, 'inner ym=' + mf.ym);
      }
      if (!Array.isArray(mf.bills)) {
        pushE('month-bills-not-array', 'month', ym);
        return;
      }

      mf.bills.forEach((b, i) => {
        billCount += 1;
        const ref = ym + '#' + i;
        const label = b && b.id ? shortId(b.id) : ref;

        if (!b || typeof b !== 'object' || Array.isArray(b)) {
          pushE('bill-shape', 'bill', ref);
          return;
        }

        // id：缺失 + 全局重复
        if (typeof b.id !== 'string' || !b.id) {
          pushE('bill-id-missing', 'bill', ref);
        } else if (idSeen.has(b.id)) {
          pushE('bill-duplicate-id', 'bill', label, 'dup of ' + idSeen.get(b.id));
        } else {
          idSeen.set(b.id, ym);
        }

        // type
        if (VALID_TYPES.indexOf(b.type) < 0) {
          pushE('bill-type-invalid', 'bill', label, 'type=' + b.type);
        }

        // amountCents：非有限 / 非整数 = 结构损坏；<=0 仅警告
        if (!(Number.isFinite(b.amountCents) && Number.isInteger(b.amountCents))) {
          pushE('bill-amount-invalid', 'bill', label, 'amount=' + b.amountCents);
        } else if (b.amountCents <= 0) {
          pushW('bill-amount-nonpositive', 'bill', label);
        }

        // occurredAt：非有限 / 0 / 负数均为非法时间戳（0 会被 new Date 解释成 1970 年）
        if (!(Number.isFinite(b.occurredAt) && b.occurredAt > 0)) {
          pushE('bill-occurred-at-invalid', 'bill', label);
        }

        // ledgerImpact
        if (VALID_IMPACT.indexOf(b.ledgerImpact) < 0) {
          pushE('bill-ledger-impact-invalid', 'bill', label, 'impact=' + b.ledgerImpact);
        }

        // categoryId：缺失 / 未知（归档分类仍在全量集合中，不会误报）
        if (typeof b.categoryId !== 'string' || !b.categoryId) {
          pushW('bill-category-missing', 'bill', label);
        } else if (!catIds.has(b.categoryId)) {
          pushW('bill-category-unknown', 'bill', label, 'cat=' + shortId(b.categoryId));
        }

        // dailyValue：enabled 但 startDate 非法
        if (b.dailyValue && b.dailyValue.enabled === true) {
          if (!recurringCore.isValidDateStr(b.dailyValue.startDate)) {
            pushE('daily-value-start-invalid', 'bill', label, 'start=' + b.dailyValue.startDate);
          }
        }

        // 周期来源：source='recurring' 必须有 recurringRuleId（结构）
        if (b.source === 'recurring' && !b.recurringRuleId) {
          pushE('recurring-bill-missing-rule-id', 'bill', label);
        }
        // 指向已不存在的规则（删除规则后历史账单保留，属可放行的软引用）
        if (b.recurringRuleId && !ruleIds.has(b.recurringRuleId)) {
          pushW('bill-recurring-rule-orphan', 'bill', label, 'rule=' + shortId(b.recurringRuleId));
        }
      });
    });

  // 周期规则硬校验（对原始存储值；normalize 会掩盖损坏，故不读规范化后的）
  (d.recurringRulesRaw || []).forEach((r, i) => {
    const ref = 'rule#' + i + (r && r.id ? '/' + shortId(r.id) : '');
    const v = recurringCore.validateRecurringRule(r || {});
    if (!v.ok) pushE('recurring-rule-' + v.reason, 'recurring', ref);
  });

  // 预算规则（含重复 id 检测）
  const budgetRuleIds = new Set();
  (d.budgetRulesRaw || []).forEach((r, i) => {
    const ref = 'budget#' + i;
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      pushE('budget-rule-shape', 'budget', ref);
      return;
    }
    if (typeof r.id === 'string' && r.id) {
      if (budgetRuleIds.has(r.id)) {
        pushE('budget-rule-duplicate-id', 'budget', ref, shortId(r.id));
      } else {
        budgetRuleIds.add(r.id);
      }
    }
    if (!recurringCore.isValidDateStr(r.effectiveFrom)) {
      pushE('budget-rule-date-invalid', 'budget', ref, 'from=' + r.effectiveFrom);
    }
    if (!(Number.isFinite(r.dailyCents) && Number.isInteger(r.dailyCents) && r.dailyCents >= 0)) {
      pushE('budget-rule-amount-invalid', 'budget', ref, 'cents=' + r.dailyCents);
    }
    if (typeof r.enabled !== 'boolean') {
      pushW('budget-rule-enabled-invalid', 'budget', ref);
    }
  });

  // manifest
  if (d.manifest != null) {
    const m = d.manifest;
    if (typeof m !== 'object' || m === null || VALID_SCHEMA_VERSIONS.indexOf(m.schemaVersion) < 0) {
      pushW('manifest-schema-invalid', 'manifest', 'schemaVersion=' + (m && m.schemaVersion));
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      months: monthCount,
      bills: billCount,
      uniqueBills: idSeen.size,
      categories: (d.categories || []).length,
      recurringRules: (d.recurringRulesRaw || []).length,
      budgetRules: (d.budgetRulesRaw || []).length,
      errorCount: errors.length,
      warningCount: warnings.length,
    },
  };
}

/** 从本地存储读取体检所需的原始数据（只读） */
function collectHealthData() {
  const data = {
    manifest: fs.readJSON(paths.FILE.manifest, null),
    rawMonthFiles: {},
    categories: [],
    recurringRulesRaw: [],
    budgetRulesRaw: [],
  };

  // 分类（全量，含归档）
  try {
    const map = categories.getCategoryMap();
    data.categories = Object.keys(map).map((id) => map[id]);
  } catch (e) {
    data.categories = [];
  }

  // 周期规则原始存储（不 normalize，才能检出损坏值）
  try {
    data.recurringRulesRaw = recurringStore.readStore().rules || [];
  } catch (e) {
    data.recurringRulesRaw = [];
  }

  // 预算规则原始存储
  try {
    const b = settings.getSettings().budget;
    data.budgetRulesRaw = b && Array.isArray(b.rules) ? b.rules : [];
  } catch (e) {
    data.budgetRulesRaw = [];
  }

  // 月份分片：直接读原始文本以识别「文件存在但 JSON 损坏」（readJSON 会静默吞掉）
  ledger.listMonths().forEach((ym) => {
    const file = paths.billFile(ym);
    if (!fs.exists(file)) return;
    const txt = fs.readText(file);
    if (txt == null) {
      data.rawMonthFiles[ym] = { parseError: true, parsed: null };
      return;
    }
    try {
      data.rawMonthFiles[ym] = { parseError: false, parsed: JSON.parse(txt) };
    } catch (e) {
      data.rawMonthFiles[ym] = { parseError: true, parsed: null };
    }
  });

  return data;
}

/** 执行一次体检：读取 + 分析（只读，不修改任何数据） */
function runHealthScan() {
  return analyzeHealth(collectHealthData());
}

/** 脱敏文本报告（不包含金额 / 备注 / 商户） */
function formatHealthReport(result) {
  const s = result.summary;
  const lines = [];
  lines.push(
    '[data-health] months=' + s.months +
      ' bills=' + s.bills +
      ' uniqueBills=' + s.uniqueBills +
      ' categories=' + s.categories +
      ' recurringRules=' + s.recurringRules +
      ' budgetRules=' + s.budgetRules +
      ' errors=' + s.errorCount +
      ' warnings=' + s.warningCount
  );
  result.errors.forEach((x) => {
    lines.push('  [ERROR]   ' + x.code + ' @ ' + x.scope + (x.ref ? ':' + x.ref : '') + (x.detail ? ' (' + x.detail + ')' : ''));
  });
  result.warnings.forEach((x) => {
    lines.push('  [WARNING] ' + x.code + ' @ ' + x.scope + (x.ref ? ':' + x.ref : '') + (x.detail ? ' (' + x.detail + ')' : ''));
  });
  if (result.ok) {
    lines.push('[data-health] 未发现结构性错误。');
  }
  return lines.join('\n');
}

/** 打印脱敏诊断（不返回、不抛出，避免体检本身影响主流程） */
function logHealth(result) {
  const text = formatHealthReport(result);
  if (result.ok) {
    (console.info || console.log).call(console, text);
  } else {
    (console.error || console.log).call(console, text);
  }
  return text;
}

module.exports = {
  shortId,
  analyzeHealth,
  collectHealthData,
  runHealthScan,
  formatHealthReport,
  logHealth,
};
