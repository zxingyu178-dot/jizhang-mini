// packages/importer/excel/reader.js
// SheetJS 读取封装：ArrayBuffer -> 第一张有效工作表的二维数组。
// 只使用读取能力，不使用 XLSX.readFile（Node 风格）。
const XLSX = require('./xlsx');

const MAX_ROWS = 30000;

/**
 * 从 ArrayBuffer 读取第一张工作表。
 * @param {ArrayBuffer} buffer
 * @returns {{ sheetName:string, rows:Array<Array<string>> }}
 */
function readFirstSheet(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('工作簿里没有工作表');
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
  if (rows.length > MAX_ROWS) {
    throw new Error('ROW_LIMIT');
  }
  return { sheetName, rows: rows.map((r) => r.map((c) => (c == null ? '' : String(c)))) };
}

module.exports = {
  readFirstSheet,
  MAX_ROWS,
};
