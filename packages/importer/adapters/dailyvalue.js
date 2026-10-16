// packages/importer/adapters/dailyvalue.js
// Android DailyValue 数据迁移 Adapter：
//   - CSV：表头 日期,时间,类型,金额,分类,备注,来源,账本影响（UTF-8 BOM），使用共享 header
//   - .dvbackup：DailyValueBackupV1，data.bills / categories
// 字段依据 daily-value-v2 最新 main（types.ts / category-defs.ts / backup.ts / csv.ts），禁止凭旧字段猜。
const money = require('../../../data/money');
const normalizer = require('../core/normalizer');
const diagnosis = require('../core/diagnosis');
const header = require('../core/header');

// Android 分类中文名 → Mini 分类 id
const NAME_TO_ID = {
  餐饮: 'c-food',
  交通: 'c-transport',
  购物: 'c-shopping',
  娱乐: 'c-fun',
  生活: 'c-life',
  饮料: 'c-drink',
  话费: 'c-bill',
  工资: 'c-salary',
  医疗: 'c-medical',
  住房: 'c-housing',
  旅行: 'c-travel',
  其他: 'c-other',
};

const ALIASES = {
  date: ['日期'],
  time: ['时间'],
  type: ['类型'],
  amount: ['金额', '金额(元)', '交易金额'],
  category: ['分类'],
  note: ['备注'],
  source: ['来源'],
  ledger: ['账本影响'],
};

const ANCHOR = [ALIASES.date, ALIASES.type];
const REQUIRED = [ALIASES.date, ALIASES.type, ALIASES.amount];
const PRIMARY = ['日期', '类型', '金额'];

function get(row, idx) {
  if (idx < 0) return '';
  return String(row[idx] == null ? '' : row[idx]);
}

function nameToId(name) {
  const t = String(name || '').trim();
  if (NAME_TO_ID[t]) return NAME_TO_ID[t];
  const hit = Object.keys(NAME_TO_ID).find((k) => t.indexOf(k) >= 0);
  return hit ? NAME_TO_ID[hit] : 'c-other';
}

/** Android CSV 解析 */
function parseRows(rows, source, diag) {
  const anchor = header.findHeaderRow(rows, ANCHOR);
  if (!anchor) {
    diagnosis.setHeader(diag, false, -1);
    throw new Error('没有找到 DailyValue CSV 表头，请确认是 DailyValue 导出的账单 CSV');
  }
  diagnosis.setHeader(diag, true, anchor.index);
  const H = anchor.headers;

  const ci = {
    date: header.findColumn(H, ALIASES.date),
    time: header.findColumn(H, ALIASES.time),
    type: header.findColumn(H, ALIASES.type),
    amount: header.findColumn(H, ALIASES.amount),
    category: header.findColumn(H, ALIASES.category),
    note: header.findColumn(H, ALIASES.note),
    ledger: header.findColumn(H, ALIASES.ledger),
  };

  const missing = header.missingColumns(H, REQUIRED, PRIMARY);
  if (missing.length) {
    diagnosis.setMissingColumns(diag, missing);
    throw new Error('账单格式已识别，但“' + missing.join('、') + '”列格式发生变化，请点「复制诊断」反馈');
  }

  const bills = [];
  for (let i = anchor.index + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => !String(c).trim())) continue;
    if (diag) diag.totalDataRows += 1;

    const typeText = get(r, ci.type).trim();
    const ledgerText = get(r, ci.ledger).trim();
    let type;
    if (typeText === '支出') {
      type = 'expense';
      if (diag) diag.expenseRows += 1;
    } else if (typeText === '收入') {
      type = 'income';
      if (diag) diag.incomeRows += 1;
    } else {
      if (diag) diag.nonFlowSkipped += 1;
      continue;
    }

    if (ledgerText === '仅日价') {
      // CSV 不含完整日价字段（title/startDate），无法迁移仅日价物品；
      // 完整日价迁移请使用 Android 的 .dvbackup。
      if (diag) diag.nonFlowSkipped += 1;
      continue;
    }

    const date = get(r, ci.date).trim();
    const time = get(r, ci.time).trim();
    const occurredAt = normalizer.parseDateTime(date + ' ' + time);
    const amountCents = Math.abs(money.parseAmountToCents(get(r, ci.amount)));
    if (!occurredAt) {
      diagnosis.addError(diag, i, '日期/时间', ci.date, '缺失或无法解析');
      continue;
    }
    if (!amountCents) {
      diagnosis.addError(diag, i, '金额', ci.amount, '缺失或无法解析');
      continue;
    }

    const categoryId = nameToId(get(r, ci.category));
    const note = get(r, ci.note).trim();

    const b = normalizer.makeBill({
      type,
      amountCents,
      categoryId,
      occurredAt,
      merchant: '',
      note,
      source,
      sourceTxnId: '', // CSV 无流水号，走 fingerprint
    });
    b.fingerprint = normalizer.makeFingerprint(b);
    bills.push(b);
  }
  return bills;
}

/* ===================== .dvbackup 完整迁移（Gate F/G） ===================== */

/** 12 个系统固定分类 id（原样映射，不重建） */
const STANDARD_IDS = [
  'c-food', 'c-transport', 'c-shopping', 'c-fun', 'c-life', 'c-drink',
  'c-bill', 'c-salary', 'c-medical', 'c-housing', 'c-travel', 'c-other',
];
const STANDARD_SET = new Set(STANDARD_IDS);
const BACKUP_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];

/** 清理 id 中不安全字符（确定性 id） */
function safeIdPart(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '');
}

/** 自定义分类在 Mini 的确定性 id */
function miniCategoryId(androidId) {
  return 'dvcat-' + safeIdPart(androidId);
}

/** 周期规则在 Mini 的确定性 id（避免与 Mini 手工规则 id 冲突，重复导入幂等） */
function miniRuleId(androidId) {
  return 'dvrule-' + safeIdPart(androidId);
}

/**
 * 映射备份分类：系统 id 原样；自定义分类给确定性 Mini id，并产出待建分类。
 * @returns {{idMap:object, toCreate:array}}
 */
function mapBackupCategories(backupCats) {
  const idMap = {};
  const toCreate = [];
  const seen = new Set();
  backupCats.forEach((c) => {
    if (!c || !c.id || seen.has(c.id)) return;
    seen.add(c.id);
    if (STANDARD_SET.has(c.id)) {
      idMap[c.id] = c.id;
      return;
    }
    const mid = miniCategoryId(c.id);
    idMap[c.id] = mid;
    const name = String(c.name || '').trim().slice(0, 8) || '自定义';
    toCreate.push({ id: mid, name, emoji: String(c.emoji || '📦') });
  });
  return { idMap, toCreate };
}

/** 账单 / 规则引用分类 id 的映射（找不到系统 id 用自身，否则 c-other） */
function resolveCategoryRef(androidId, idMap) {
  if (!androidId) return 'c-other';
  if (idMap[androidId]) return idMap[androidId];
  if (STANDARD_SET.has(androidId)) return androidId;
  return 'c-other';
}

/** 映射周期规则（金额元→整数分；保留游标，不从头补账；忽略分类快照） */
function mapRecurringRules(backupRules, idMap) {
  const out = [];
  const seen = new Set();
  backupRules.forEach((r) => {
    if (!r || !r.id || seen.has(r.id)) return;
    seen.add(r.id);
    const amountCents = Math.abs(money.yuanToCents(r.amount));
    const frequency = BACKUP_FREQUENCIES.indexOf(r.frequency) >= 0 ? r.frequency : 'daily';
    const rule = {
      id: miniRuleId(r.id),
      enabled: r.enabled === true,
      type: r.type === 'income' ? 'income' : 'expense',
      amountCents,
      categoryId: resolveCategoryRef(r.categoryId, idMap),
      note: r.note ? String(r.note) : '',
      frequency,
      interval: Number.isFinite(r.interval) ? Math.min(999, Math.max(1, Math.round(r.interval))) : 1,
      day: Number.isFinite(r.day) ? Math.max(1, Math.round(r.day)) : 1,
      startDate: r.startDate,
      time: r.time,
      createdAt: r.createdAt || Date.now(),
    };
    if (r.month != null && Number.isFinite(r.month)) rule.month = Math.min(12, Math.max(1, Math.round(r.month)));
    if (r.scheduleEffectiveAt != null) rule.scheduleEffectiveAt = Number(r.scheduleEffectiveAt);
    if (r.lastGeneratedDate) rule.lastGeneratedDate = r.lastGeneratedDate;
    if (r.nextOccurrence) rule.nextOccurrence = r.nextOccurrence;
    if (r.updatedAt != null) rule.updatedAt = Number(r.updatedAt);
    if (amountCents && r.startDate) out.push(rule);
  });
  return out;
}

/**
 * Android .dvbackup 解析（Gate F/G）：
 * 返回 { bills, categories(待建自定义分类), recurringRules(待建规则) }。
 * bills 的 categoryId 已映射；分类与规则的真正写入在 commit 阶段（幂等）。
 */
function parseBackup(obj) {
  if (!obj || obj.format !== 'daily-value-backup') {
    throw new Error('这不是 DailyValue 备份文件');
  }
  const data = obj.data || {};
  const srcBills = Array.isArray(data.bills) ? data.bills : [];
  const srcCats = Array.isArray(data.categories) ? data.categories : [];
  const srcRules = Array.isArray(data.recurringRules) ? data.recurringRules : [];

  const catResult = mapBackupCategories(srcCats);
  const idMap = catResult.idMap;
  const bills = [];

  srcBills.forEach((b) => {
    let type;
    if (b.type === 'expense') type = 'expense';
    else if (b.type === 'income') type = 'income';
    else return;

    const amountCents = Math.abs(money.yuanToCents(b.amount));
    const occurredAt = typeof b.timestamp === 'number' ? b.timestamp : normalizer.parseDateTime(b.date);
    if (!amountCents || !occurredAt) return;

    const categoryId = resolveCategoryRef(b.categoryId, idMap);
    const merchant = b.merchant ? String(b.merchant).trim() : '';
    const note = b.note ? String(b.note).trim() : '';
    const title = b.title ? String(b.title).trim() : '';

    const ledgerImpact = b.ledgerImpact === 'daily-value-only' ? 'daily-value-only' : 'normal';
    let dailyValue = null;
    if (b.dailyValue && b.dailyValue.enabled === true && b.dailyValue.startDate) {
      dailyValue = {
        enabled: true,
        mode: 'elapsed',
        startDate: String(b.dailyValue.startDate).slice(0, 10),
      };
    }

    const nb = normalizer.makeBill({
      type,
      amountCents,
      categoryId,
      occurredAt,
      title,
      merchant,
      note,
      ledgerImpact,
      dailyValue,
      source: 'dailyvalue',
      sourceTxnId: b.id ? String(b.id) : '', // 原 id 精确去重
    });
    // 周期账单：把来源规则 id 映射为 Mini 规则 id（与待建规则一致）
    if (b.source === 'recurring' && b.recurringRuleId) {
      nb.recurringRuleId = miniRuleId(b.recurringRuleId);
    }
    nb.fingerprint = normalizer.makeFingerprint(nb);
    bills.push(nb);
  });

  const recurringRules = mapRecurringRules(srcRules, idMap);

  return { bills, categories: catResult.toCreate, recurringRules };
}

module.exports = {
  parseRows,
  parseBackup,
  nameToId,
  mapBackupCategories,
  resolveCategoryRef,
  STANDARD_IDS,
};
