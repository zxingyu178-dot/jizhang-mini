/**
 * data/ledger.js — 账单账本（Bill V1，整数分，按月分片）
 *
 * 月份分片：<USER_DATA_PATH>/bills/YYYY-MM.json
 *   { ym, version, bills: [Bill...] }
 *
 * Bill V1：
 *   id, type('expense'|'income'), amountCents, categoryId, occurredAt(ms),
 *   merchant, note, source, sourceTxnId, importBatchId, createdAt, updatedAt, ledgerImpact
 */
const fs = require('./fs');
const paths = require('./paths');
const { genId } = require('../utils/util');

const SCHEMA_VERSION = 1;

/** 时间戳 -> 'YYYY-MM' */
function ymOf(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return y + '-' + (m < 10 ? '0' + m : '' + m);
}

/** Bill V1 工厂：部分字段或成型 Bill 都可传入，幂等 */
function createBill(data) {
  data = data || {};
  const now = Date.now();
  const occurredAt = data.occurredAt || now;
  let amountCents = data.amountCents;
  if (amountCents == null) {
    amountCents = data.amount != null ? Math.round(Number(data.amount) * 100) : 0;
  }
  return {
    id: data.id || genId(),
    type: data.type === 'income' ? 'income' : 'expense',
    amountCents,
    categoryId: data.categoryId || 'c-other',
    occurredAt,
    merchant: data.merchant || '',
    note: data.note || '',
    source: data.source || 'manual',
    sourceTxnId: data.sourceTxnId || null,
    importBatchId: data.importBatchId || null,
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    ledgerImpact: data.ledgerImpact || 'normal',
  };
}

/** 读月份分片（不存在返回空结构） */
function readMonthFile(ym) {
  return fs.readJSON(paths.billFile(ym), { ym, version: SCHEMA_VERSION, bills: [] });
}

/** 写月份分片 */
function writeMonthFile(ym, data) {
  fs.writeJSON(paths.billFile(ym), { ym, version: SCHEMA_VERSION, bills: data.bills });
}

/** 列出全部月份分片（正序） */
function listMonths() {
  fs.ensureDir(paths.DIR.bills);
  return fs
    .listDir(paths.DIR.bills)
    .filter((n) => /^\d{4}-\d{2}\.json$/.test(n))
    .map((n) => n.replace('.json', ''))
    .sort();
}

function sortBills(arr) {
  arr.sort((a, b) => b.occurredAt - a.occurredAt);
}

/** 新增一条账单 */
function addBill(data) {
  const bill = createBill(data);
  const ym = ymOf(bill.occurredAt);
  const mf = readMonthFile(ym);
  mf.bills.push(bill);
  sortBills(mf.bills);
  writeMonthFile(ym, mf);
  return bill;
}

/** 批量写入（导入用；同批 bill 已在外部完成去重） */
function addBills(bills) {
  const groups = {};
  bills.forEach((b) => {
    const bill = createBill(b);
    const ym = ymOf(bill.occurredAt);
    if (!groups[ym]) groups[ym] = [];
    groups[ym].push(bill);
  });
  Object.keys(groups).forEach((ym) => {
    const mf = readMonthFile(ym);
    mf.bills = mf.bills.concat(groups[ym]);
    sortBills(mf.bills);
    writeMonthFile(ym, mf);
  });
  return { months: Object.keys(groups).sort(), total: bills.length };
}

/** 月度统计（整数分，仅 ledgerImpact=normal） */
function monthSummary(ym) {
  const mf = readMonthFile(ym);
  let income = 0;
  let expense = 0;
  mf.bills.forEach((b) => {
    if (b.ledgerImpact !== 'normal') return;
    if (b.type === 'income') income += b.amountCents;
    else expense += b.amountCents;
  });
  return { ym, income, expense, balance: income - expense, count: mf.bills.length };
}

/** 按天分组（倒序，用于记账列表） */
function monthGrouped(ym) {
  const mf = readMonthFile(ym);
  const map = {};
  mf.bills.forEach((b) => {
    const d = new Date(b.occurredAt);
    const day = d.getDate();
    if (!map[day]) map[day] = { day, label: d.getMonth() + 1 + '月' + day + '日', income: 0, expense: 0, bills: [] };
    map[day].bills.push(b);
    if (b.ledgerImpact === 'normal') {
      if (b.type === 'income') map[day].income += b.amountCents;
      else map[day].expense += b.amountCents;
    }
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

/** 按 id 删除；成功返回 true */
function deleteBill(id) {
  const months = listMonths();
  for (let i = 0; i < months.length; i++) {
    const ym = months[i];
    const mf = readMonthFile(ym);
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

/** 用快照恢复分片；快照为 null 的月份删除其文件 */
function restoreMonths(snap) {
  Object.keys(snap).forEach((ym) => {
    if (snap[ym] === null) {
      fs.remove(paths.billFile(ym));
    } else {
      writeMonthFile(ym, snap[ym]);
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
 * 按 id 更新；返回更新后的 Bill（找不到返回 null）。
 * - 同月：原位更新。
 * - 跨月（patch.occurredAt 落到别的月份）：从旧分片删除、写入新分片。
 * id 保持不变；全过程对涉及分片做快照，任一步失败回滚到更新前状态。
 */
function updateBill(id, patch) {
  const months = listMonths();
  let oldYm = null;
  let oldBill = null;
  for (let i = 0; i < months.length; i++) {
    const ym = months[i];
    const found = readMonthFile(ym).bills.find((b) => b.id === id);
    if (found) {
      oldYm = ym;
      oldBill = found;
      break;
    }
  }
  if (!oldBill) return null;

  // id 永远不可被 patch 改写；刷新 updatedAt
  const updated = Object.assign({}, oldBill, patch, { id, updatedAt: Date.now() });
  const newYm = ymOf(updated.occurredAt);

  if (newYm === oldYm) {
    // 同月原位更新
    const snap = snapshotMonths([oldYm]);
    try {
      const mf = readMonthFile(oldYm);
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
    const oldMf = readMonthFile(oldYm);
    const oi = oldMf.bills.findIndex((b) => b.id === id);
    if (oi < 0) throw new Error('更新前账单已不存在');
    oldMf.bills.splice(oi, 1);
    writeMonthFile(oldYm, oldMf);

    const newMf = readMonthFile(newYm);
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

/** 区间内全部账单（用于统计/导出） */
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
  ymOf,
  createBill,
  readMonthFile,
  writeMonthFile,
  listMonths,
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
