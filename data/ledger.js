/**
 * data/ledger.js — 账单账本（Bill V3，整数分，按月分片）
 *
 * 月份分片：<USER_DATA_PATH>/bills/YYYY-MM.json
 *   { ym, version:3, bills: [Bill...] }
 *
 * Bill V3（在 V2 基础上无损扩展，V2→V3 见 migration-schema-v3.js）：
 *   id, type('expense'|'income'), amountCents, categoryId, occurredAt(ms),
 *   title,                       // 日价物品名（普通账单为 ''），缺失时展示回退分类名
 *   merchant, note, source, sourceTxnId, importBatchId, createdAt, updatedAt,
 *   ledgerImpact('normal'|'daily-value-only'),
 *   dailyValue?                  // { enabled:true, mode:'elapsed', startDate:'yyyy-MM-dd' }
 *   recurringRuleId?             // source='recurring' 时，来源周期规则 id（V3 新增）
 *
 * 账务边界（v0.4.0）：
 *   - 'normal'：进入记账时间线 / 月度·年度统计 / 普通搜索；
 *   - 'daily-value-only'：只在日价模块展示，绝不进入记账 / 统计 / 普通搜索。
 *   日价永远从 Bill 派生（dailyValue.enabled），不维护第二套数据库。
 */
const fs = require('./fs');
const paths = require('./paths');
const { genId } = require('../utils/util');

const SCHEMA_VERSION = 3;
/** 可读的分片版本（旧版本 1/2 合法，由显式迁移升级；写回统一当前版本） */
const SUPPORTED_MONTH_VERSIONS = [1, 2, 3];

/** 时间戳 -> 'YYYY-MM'（本地业务日期） */
function ymOf(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return y + '-' + (m < 10 ? '0' + m : '' + m);
}

/** 是否为 yyyy-MM-dd 日期串 */
function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * 规范化日价扩展：仅当显式 enabled 且 startDate 合法时返回 V2 dailyValue，
 * 否则返回 null（表示该账单不启用日价）。当前唯一模式为 'elapsed'。
 */
function normalizeDailyValue(dv) {
  if (!dv || dv.enabled !== true) return null;
  if (!isDateStr(dv.startDate)) return null;
  return { enabled: true, mode: 'elapsed', startDate: dv.startDate };
}

/** 账务作用域归一化（非法值安全回落到 normal） */
function normalizeLedgerImpact(v) {
  return v === 'daily-value-only' ? 'daily-value-only' : 'normal';
}

/** Bill V2 工厂：部分字段或成型 Bill 都可传入，幂等 */
function createBill(data) {
  data = data || {};
  const now = Date.now();
  const occurredAt = data.occurredAt || now;
  let amountCents = data.amountCents;
  if (amountCents == null) {
    amountCents = data.amount != null ? Math.round(Number(data.amount) * 100) : 0;
  }
  const bill = {
    id: data.id || genId(),
    type: data.type === 'income' ? 'income' : 'expense',
    amountCents,
    categoryId: data.categoryId || 'c-other',
    occurredAt,
    title: typeof data.title === 'string' ? data.title : '',
    merchant: data.merchant || '',
    note: data.note || '',
    source: data.source || 'manual',
    sourceTxnId: data.sourceTxnId || null,
    importBatchId: data.importBatchId || null,
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    ledgerImpact: normalizeLedgerImpact(data.ledgerImpact),
  };
  const dv = normalizeDailyValue(data.dailyValue);
  if (dv) bill.dailyValue = dv;
  // V3：周期生成账单带来源规则 id（普通账单无此字段）
  if (data.recurringRuleId) bill.recurringRuleId = data.recurringRuleId;
  return bill;
}

/** 读月份分片（不存在返回空结构；仅用于只读 / 展示，损坏会回落空结构） */
function readMonthFile(ym) {
  return fs.readJSON(paths.billFile(ym), { ym, version: SCHEMA_VERSION, bills: [] });
}

/** 月份分片错误（带 code/ym，便于安全模式与上层分类） */
function monthError(code, ym, detail) {
  const err = new Error(code + ': ' + ym + (detail ? ' (' + detail + ')' : ''));
  err.code = code;
  err.ym = ym;
  if (detail) err.detail = detail;
  return err;
}

/**
 * 校验月份分片 shape（不做业务语义，语义在 backup-validator）。
 * 旧版本（version 1/2）合法；version 非法、bills 非数组、元素非对象均抛错。
 */
function validateMonthShape(ym, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw monthError('MONTH_INVALID_SHAPE', ym, '分片不是对象');
  }
  if (!Array.isArray(data.bills)) {
    throw monthError('MONTH_INVALID_SHAPE', ym, 'bills 不是数组');
  }
  if (SUPPORTED_MONTH_VERSIONS.indexOf(data.version) < 0) {
    throw monthError('MONTH_UNSUPPORTED_VERSION', ym, 'version=' + data.version);
  }
  for (let i = 0; i < data.bills.length; i++) {
    const b = data.bills[i];
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      throw monthError('MONTH_INVALID_SHAPE', ym, 'bills[' + i + '] 不是对象');
    }
  }
}

/**
 * 严格读月份分片（所有写路径必须使用）：
 *   文件不存在 → 可建空月份（当前 schema）；
 *   JSON 损坏 → MONTH_CORRUPT；
 *   shape 错 → MONTH_INVALID_SHAPE；
 *   version 非法 → MONTH_UNSUPPORTED_VERSION。
 * 发现已有文件异常即抛出，绝不以空账本继续，从源头堵住「损坏月被新账覆盖」。
 */
function readMonthFileStrict(ym) {
  let data;
  try {
    data = fs.readJSONStrict(paths.billFile(ym));
  } catch (e) {
    if (e.code === 'FILE_MISSING') return { ym, version: SCHEMA_VERSION, bills: [] };
    if (e.code === 'FILE_CORRUPT') throw monthError('MONTH_CORRUPT', ym, e.detail);
    throw e;
  }
  validateMonthShape(ym, data);
  return data;
}

/** 写月份分片（默认写当前 schema；迁移可在 data.version 显式指定目标版本） */
function writeMonthFile(ym, data) {
  const version = data.version || SCHEMA_VERSION;
  fs.writeJSON(paths.billFile(ym), { ym, version, bills: data.bills });
}

/** 列出全部月份分片（正序；文件存在即返回，不区分是否有普通账单） */
function listMonths() {
  fs.ensureDir(paths.DIR.bills);
  return fs
    .listDir(paths.DIR.bills)
    .filter((n) => /^\d{4}-\d{2}\.json$/.test(n))
    .map((n) => n.replace('.json', ''))
    .sort();
}

/**
 * 列出「记账」月份导航节点：至少存在一笔 normal 账单的月份，外加当前月。
 * daily-value-only 物品所在月、或删除最后一笔后残留的空分片，不成为导航节点。
 */
function listAccountingMonths(nowTs) {
  const set = {};
  listMonths().forEach((ym) => {
    const hasNormal = readMonthFile(ym).bills.some((b) => b.ledgerImpact !== 'daily-value-only');
    if (hasNormal) set[ym] = true;
  });
  set[ymOf(nowTs || Date.now())] = true;
  return Object.keys(set).sort();
}

function sortBills(arr) {
  arr.sort((a, b) => b.occurredAt - a.occurredAt);
}

/** 新增一条账单（严格读：目标月损坏即抛错，不覆盖） */
function addBill(data) {
  const bill = createBill(data);
  const ym = ymOf(bill.occurredAt);
  const mf = readMonthFileStrict(ym);
  mf.bills.push(bill);
  sortBills(mf.bills);
  writeMonthFile(ym, mf);
  return bill;
}

/** 批量写入（导入用；同批 bill 已在外部完成去重；严格读，损坏月不写入） */
function addBills(bills) {
  const groups = {};
  bills.forEach((b) => {
    const bill = createBill(b);
    const ym = ymOf(bill.occurredAt);
    if (!groups[ym]) groups[ym] = [];
    groups[ym].push(bill);
  });
  // 先对全部目标月做一次严格预检：任一损坏则整批不写（避免部分写入）
  Object.keys(groups).forEach((ym) => readMonthFileStrict(ym));
  Object.keys(groups).forEach((ym) => {
    const mf = readMonthFileStrict(ym);
    mf.bills = mf.bills.concat(groups[ym]);
    sortBills(mf.bills);
    writeMonthFile(ym, mf);
  });
  return { months: Object.keys(groups).sort(), total: bills.length };
}

/** 月度统计（整数分；仅 ledgerImpact=normal，count 也只数普通账单） */
function monthSummary(ym) {
  const mf = readMonthFile(ym);
  let income = 0;
  let expense = 0;
  let count = 0;
  mf.bills.forEach((b) => {
    if (b.ledgerImpact !== 'normal') return;
    count += 1;
    if (b.type === 'income') income += b.amountCents;
    else expense += b.amountCents;
  });
  return { ym, income, expense, balance: income - expense, count };
}

/**
 * 按天分组（倒序，用于记账列表）。
 * 仅返回 ledgerImpact=normal 的账单；daily-value-only 绝不进入普通时间线。
 */
function monthGrouped(ym) {
  const mf = readMonthFile(ym);
  const map = {};
  mf.bills.forEach((b) => {
    if (b.ledgerImpact !== 'normal') return;
    const d = new Date(b.occurredAt);
    const day = d.getDate();
    if (!map[day]) map[day] = { day, label: d.getMonth() + 1 + '月' + day + '日', income: 0, expense: 0, bills: [] };
    map[day].bills.push(b);
    if (b.type === 'income') map[day].income += b.amountCents;
    else map[day].expense += b.amountCents;
  });
  return Object.keys(map)
    .map((k) => map[k])
    .sort((a, b) => b.day - a.day);
}

function getBill(id) {
  const months = listMonths();
  for (let i = 0; i < months.length; i++) {
    const f = readMonthFile(months[i]).bills.find((b) => b.id === id);
    if (f) return f;
  }
  return null;
}

/** 按 id 删除；成功返回 true。严格读：存在损坏月即抛错（fail-closed），不覆盖 */
function deleteBill(id) {
  const months = listMonths();
  for (let i = 0; i < months.length; i++) {
    const ym = months[i];
    const mf = readMonthFileStrict(ym);
    const idx = mf.bills.findIndex((b) => b.id === id);
    if (idx >= 0) {
      mf.bills.splice(idx, 1);
      writeMonthFile(ym, mf);
      return true;
    }
  }
  return false;
}

/**
 * 对给定月份分片做快照（用于写失败回滚）。
 * 文件不存在记为 null，恢复时据此删除。
 */
function snapshotMonths(yms) {
  const snap = {};
  yms.forEach((ym) => {
    snap[ym] = fs.exists(paths.billFile(ym)) ? readMonthFile(ym) : null;
  });
  return snap;
}

/**
 * 用快照恢复分片；快照为 null 的月份删除其文件。
 * 直接按快照原样写回（保留快照自身的 version），避免回滚到旧版本分片时
 * 被 writeMonthFile 强行写成当前 schema 版本、造成版本号与内容不一致。
 */
function restoreMonths(snap) {
  Object.keys(snap).forEach((ym) => {
    if (snap[ym] === null) {
      fs.remove(paths.billFile(ym));
    } else {
      const s = snap[ym];
      fs.writeJSON(paths.billFile(ym), { ym, version: s.version || 1, bills: s.bills });
    }
  });
}

/** 某月份中指定 id 的账单条数 */
function countIdInMonth(ym, id) {
  return readMonthFile(ym).bills.filter((b) => b.id === id).length;
}

/** 写入后校验：全局 id 恰好一条；跨月时旧月为 0、新月为 1 */
function verifySingleBill(id, oldYm, newYm) {
  const total = rangeBills().filter((b) => b.id === id).length;
  if (total !== 1) throw new Error('更新后账单条数校验失败（应为 1 条，实际 ' + total + ' 条）');
  if (oldYm !== newYm && countIdInMonth(oldYm, id) !== 0) {
    throw new Error('跨月更新校验失败：旧月份仍存在该账单');
  }
  if (countIdInMonth(newYm, id) !== 1) {
    throw new Error('更新校验失败：目标月份账单数量异常');
  }
}

/**
 * 把 patch 中的 V2 扩展字段应用到 updated（处理 dailyValue 的挂载 / 移除）。
 * 约定：
 *   - patch 不含 dailyValue 键：保持原值；
 *   - patch.dailyValue 为合法启用对象：规范化后挂载；
 *   - patch.dailyValue 为 null / false / 非法：移除该键（移出日价 / 关闭开关）。
 */
function applyDailyValuePatch(updated, patch) {
  if (!Object.prototype.hasOwnProperty.call(patch, 'dailyValue')) return;
  const dv = normalizeDailyValue(patch.dailyValue);
  if (dv) updated.dailyValue = dv;
  else delete updated.dailyValue;
}

/**
 * 按 id 更新；返回更新后的 Bill（找不到返回 null）。
 * - 同月：原位更新。
 * - 跨月（patch.occurredAt 落到别的月份）：从旧分片删除、写入新分片。
 * id 保持不变；全过程对涉及分片做快照，任一步失败回滚到更新前状态。
 * V2：支持 title 更新与 dailyValue 的挂载 / 移除（不改变 ledgerImpact，除非显式传入）。
 */
function updateBill(id, patch) {
  const months = listMonths();
  let oldYm = null;
  let oldBill = null;
  for (let i = 0; i < months.length; i++) {
    const ym = months[i];
    const found = readMonthFileStrict(ym).bills.find((b) => b.id === id);
    if (found) {
      oldYm = ym;
      oldBill = found;
      break;
    }
  }
  if (!oldBill) return null;

  // id 永远不可被 patch 改写；刷新 updatedAt
  const updated = Object.assign({}, oldBill, patch, { id, updatedAt: Date.now() });
  // 防御：非法 ledgerImpact 不落盘
  updated.ledgerImpact = normalizeLedgerImpact(updated.ledgerImpact);
  applyDailyValuePatch(updated, patch);
  if (typeof updated.title !== 'string') updated.title = '';
  const newYm = ymOf(updated.occurredAt);

  if (newYm === oldYm) {
    // 同月原位更新
    const snap = snapshotMonths([oldYm]);
    try {
      const mf = readMonthFileStrict(oldYm);
      const idx = mf.bills.findIndex((b) => b.id === id);
      if (idx < 0) throw new Error('更新前账单已不存在');
      mf.bills[idx] = updated;
      sortBills(mf.bills);
      writeMonthFile(oldYm, mf);
      verifySingleBill(id, oldYm, newYm);
      return getBill(id);
    } catch (e) {
      restoreMonths(snap);
      throw e;
    }
  }

  // 跨月：旧分片删除 → 新分片写入
  const snap = snapshotMonths([oldYm, newYm]);
  try {
    const oldMf = readMonthFileStrict(oldYm);
    const oi = oldMf.bills.findIndex((b) => b.id === id);
    if (oi < 0) throw new Error('更新前账单已不存在');
    oldMf.bills.splice(oi, 1);
    writeMonthFile(oldYm, oldMf);

    const newMf = readMonthFileStrict(newYm);
    if (newMf.bills.some((b) => b.id === id)) {
      throw new Error('目标月份已存在同 id 账单');
    }
    newMf.bills.push(updated);
    sortBills(newMf.bills);
    writeMonthFile(newYm, newMf);

    verifySingleBill(id, oldYm, newYm);
    return getBill(id);
  } catch (e) {
    restoreMonths(snap);
    throw e;
  }
}

/** 区间内全部账单（用于统计 / 导出 / 日价派生；含两类 ledgerImpact） */
function rangeBills(ymStart, ymEnd) {
  const all = [];
  listMonths()
    .filter((ym) => (!ymStart || ym >= ymStart) && (!ymEnd || ym <= ymEnd))
    .forEach((ym) => {
      readMonthFile(ym).bills.forEach((b) => all.push(b));
    });
  return all;
}

module.exports = {
  SCHEMA_VERSION,
  SUPPORTED_MONTH_VERSIONS,
  ymOf,
  isDateStr,
  normalizeDailyValue,
  normalizeLedgerImpact,
  createBill,
  readMonthFile,
  readMonthFileStrict,
  validateMonthShape,
  writeMonthFile,
  listMonths,
  listAccountingMonths,
  sortBills,
  addBill,
  addBills,
  monthSummary,
  monthGrouped,
  getBill,
  deleteBill,
  updateBill,
  snapshotMonths,
  restoreMonths,
  countIdInMonth,
  rangeBills,
};
