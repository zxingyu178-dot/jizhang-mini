// packages/importer/adapters/dailyvalue.js
// Android DailyValue 数据迁移 Adapter：
//   - CSV：表头 日期,时间,类型,金额,分类,备注,来源,账本影响（UTF-8 BOM）
//   - .dvbackup：DailyValueBackupV1，data.bills / categories
// 字段依据 daily-value-v2 最新 main（types.ts / category-defs.ts / backup.ts / csv.ts），禁止凭旧字段猜。
const money = require('../../../data/money');
const normalizer = require('../core/normalizer');
const diagnosis = require('../core/diagnosis');

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

function findHeader(rows) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].map((c) => String(c).trim());
    if (r.includes('日期') && r.includes('类型') && r.includes('金额')) {
      return { index: i, headers: r };
    }
  }
  return null;
}

function get(row, headers, name) {
  const idx = headers.indexOf(name);
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
  const h = findHeader(rows);
  if (!h) {
    diagnosis.setHeader(diag, false, -1);
    throw new Error('没有找到 DailyValue CSV 表头，请确认是 DailyValue 导出的账单 CSV');
  }
  diagnosis.setHeader(diag, true, h.index);
  const H = h.headers;
  const bills = [];

  for (let i = h.index + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => !String(c).trim())) continue;
    if (diag) diag.totalDataRows += 1;

    const typeText = get(r, H, '类型').trim();
    const ledgerText = get(r, H, '账本影响').trim();
    let type;
    if (typeText === '支出') type = 'expense';
    else if (typeText === '收入') type = 'income';
    else {
      if (diag) diag.nonFlowSkipped += 1;
      continue;
    }

    if (ledgerText === '仅日价') {
      if (diag) diag.nonFlowSkipped += 1;
      continue; // 本版本不开发日价，仅日价账不导入
    }

    const date = get(r, H, '日期').trim();
    const time = get(r, H, '时间').trim();
    const occurredAt = normalizer.parseDateTime(date + ' ' + time);
    const amountCents = Math.abs(money.parseAmountToCents(get(r, H, '金额')));
    if (!occurredAt) {
      diagnosis.addError(diag, i, '日期/时间', -1, '缺失或无法解析');
      continue;
    }
    if (!amountCents) {
      diagnosis.addError(diag, i, '金额', H.indexOf('金额'), '缺失或无法解析');
      continue;
    }

    const categoryId = nameToId(get(r, H, '分类'));
    const note = get(r, H, '备注').trim();
    const merchant = '';

    const b = normalizer.makeBill({
      type,
      amountCents,
      categoryId,
      occurredAt,
      merchant,
      note,
      source,
      sourceTxnId: '', // CSV 无流水号，走 fingerprint
    });
    b.fingerprint = normalizer.makeFingerprint(b);
    bills.push(b);
  }
  return bills;
}

/** 校验备份分类 id 是否在 Mini 已知分类内；自定义分类无法映射则 c-other */
function resolveBackupCategoryId(categoryId, categories) {
  if (categoryId && NAME_TO_ID_RAW.has(categoryId)) return categoryId;
  const known = new Set(Object.values(NAME_TO_ID));
  if (known.has(categoryId)) return categoryId;
  // 用户自建分类（backup categories 里存在但 Mini 无对应）→ c-other
  return 'c-other';
}
const NAME_TO_ID_RAW = new Set([
  'c-food', 'c-transport', 'c-shopping', 'c-fun', 'c-life', 'c-drink',
  'c-bill', 'c-salary', 'c-medical', 'c-housing', 'c-travel', 'c-other',
]);

/** Android .dvbackup 解析（仅 Bills + 可映射 Categories） */
function parseBackup(obj) {
  if (!obj || obj.format !== 'daily-value-backup') {
    throw new Error('这不是 DailyValue 备份文件');
  }
  const data = obj.data || {};
  const srcBills = Array.isArray(data.bills) ? data.bills : [];
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const bills = [];

  srcBills.forEach((b) => {
    if (b.ledgerImpact === 'daily-value-only') return; // 仅日价不导入

    let type;
    if (b.type === 'expense') type = 'expense';
    else if (b.type === 'income') type = 'income';
    else return;

    const amountCents = Math.abs(money.yuanToCents(b.amount));
    const occurredAt = typeof b.timestamp === 'number' ? b.timestamp : normalizer.parseDateTime(b.date);
    if (!amountCents || !occurredAt) return;

    const categoryId = resolveBackupCategoryId(b.categoryId, categories);
    const merchant = b.title ? String(b.title).trim() : '';
    const note = b.note ? String(b.note).trim() : '';

    const nb = normalizer.makeBill({
      type,
      amountCents,
      categoryId,
      occurredAt,
      merchant,
      note,
      source: 'dailyvalue',
      sourceTxnId: b.id ? String(b.id) : '', // 用原 id 做精确去重
    });
    nb.fingerprint = normalizer.makeFingerprint(nb);
    bills.push(nb);
  });

  return bills;
}

module.exports = {
  parseRows,
  parseBackup,
  nameToId,
};
