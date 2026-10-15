// packages/importer/core/header.js
// 通用表头解析：normalizeHeader / findHeaderRow / findColumn / missingColumns。
// 微信、支付宝、DailyValue 三个 adapter 共用，避免官方把「金额 → 金额(元)」时整个导入器失效。
//
// 归一化处理：BOM、换行/不可见空白、全角→半角、英文小写、去所有空白、去常见货币单位后缀。

/** 全角字符（含标点、字母、数字、全角空格）转半角 */
function toHalfWidth(s) {
  let out = '';
  for (const ch of String(s)) {
    const code = ch.charCodeAt(0);
    if (code === 0x3000) out += ' ';
    else if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0);
    else out += ch;
  }
  return out;
}

/**
 * 归一化一个表头单元格文本。
 * 去 BOM → 全角转半角 → 小写 → 去所有空白（含不间断空格）→ 去结尾货币单位后缀。
 * 例：「金额（元）」「金额(元)」「  金额 」→「金额」；「交易金额(元)」→「交易金额」。
 */
function normalizeHeader(raw) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/﻿/g, ''); // 去 BOM
  s = toHalfWidth(s);
  s = s.toLowerCase();
  s = s.replace(/[\s  ]+/g, '');
  // 全角括号已转半角；去结尾货币单位后缀：(元)/(人民币)/(rmb)/(cny)
  s = s.replace(/\((元|人民币|rmb|cny|yuan)\)$/g, '');
  return s;
}

/**
 * 在表头数组里按别名组定位某列。
 * @param {Array} headers 表头单元格数组
 * @param {string[]|string} aliases 可接受的列名（原始写法即可，内部归一化）
 * @returns {number} 列下标（0-based），找不到返回 -1
 */
function findColumn(headers, aliases) {
  const list = Array.isArray(aliases) ? aliases : [aliases];
  const targets = list.map(normalizeHeader);
  for (let c = 0; c < headers.length; c++) {
    if (targets.indexOf(normalizeHeader(headers[c])) >= 0) return c;
  }
  return -1;
}

/**
 * 扫描前若干行，定位表头行：所有必需列别名组都命中才算表头。
 * @param {Array<Array>} rows 二维数组
 * @param {Array<string[]>} required 每组为该必需列的别名数组
 * @param {number} [maxScan=60] 最多扫描行数
 * @returns {{index:number, headers:Array}|null}
 */
function findHeaderRow(rows, required, maxScan) {
  const limit = Math.min(rows.length, maxScan || 60);
  for (let r = 0; r < limit; r++) {
    const row = rows[r] || [];
    const ok = required.every((aliases) => findColumn(row, aliases) >= 0);
    if (ok) return { index: r, headers: row.map((c) => String(c == null ? '' : c)) };
  }
  return null;
}

/**
 * 针对已定位的表头，返回缺失的必需列「主名」列表（用于诊断）。
 * @param {Array} headers
 * @param {Array<string[]>} required
 * @param {string[]} primaryNames 每组对应的展示名
 * @returns {string[]}
 */
function missingColumns(headers, required, primaryNames) {
  const missing = [];
  required.forEach((aliases, i) => {
    if (findColumn(headers, aliases) < 0) missing.push(primaryNames[i] || aliases[0]);
  });
  return missing;
}

module.exports = {
  normalizeHeader,
  toHalfWidth,
  findColumn,
  findHeaderRow,
  missingColumns,
};
