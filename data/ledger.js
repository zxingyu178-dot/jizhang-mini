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

/** 按 id 更新；返回更新后的 Bill */
function updateBill(id, patch) {
  const months = listMonths();
  for (let i = 0; i < months.length; i++) {
    const ym = months[i];
    const mf = readMonthFile(ym);
    const idx = mf.bills.findIndex((b) => b.id === id);
    if (idx >= 0) {
      mf.bills[idx] = Object.assign({}, mf.bills[idx], patch, { id, updatedAt: Date.now() });
      sortBills(mf.bills);
      writeMonthFile(ym, mf);
      return mf.bills.find((b) => b.id === id);
    }
  }
  return null;
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
  addBill,
  addBills,
  monthSummary,
  monthGrouped,
  getBill,
  deleteBill,
  updateBill,
  rangeBills,
};
