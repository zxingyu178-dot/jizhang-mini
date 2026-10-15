// packages/importer/encoding/csv.js
// 纯 JS CSV 解析：支持双引号包裹、引号转义、字段内逗号/换行、CRLF、BOM。
// 无 Node 依赖，可在小程序运行。

/**
 * 解析 CSV 文本为二维数组。
 * @param {string} text
 * @returns {string[][]}
 */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 BOM

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      if (text[i + 1] !== '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      }
    } else {
      field += c;
    }
  }

  // 最后一个字段 / 行
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // 过滤完全空行
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

/** 把二维数组中某行的单元格做 trim，返回新数组 */
function trimRow(row) {
  return row.map((cell) => (cell == null ? '' : String(cell).trim()));
}

module.exports = {
  parseCSV,
  trimRow,
};
