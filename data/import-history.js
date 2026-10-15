/**
 * data/import-history.js — 导入批次历史
 *
 * 记录：{ id, source, importedAt, fileName, importedCount, skippedCount, duplicateCount }
 * 不保存原始账单文件。
 */
const fs = require('./fs');
const paths = require('./paths');
const { genId } = require('../utils/util');

function getHistory() {
  return fs.readJSON(paths.FILE.importHistory, []);
}

function addImport(record) {
  const h = getHistory();
  h.unshift(Object.assign({ id: genId(), importedAt: Date.now() }, record));
  fs.writeJSON(paths.FILE.importHistory, h);
  return h;
}

function clearHistory() {
  fs.writeJSON(paths.FILE.importHistory, []);
}

module.exports = {
  getHistory,
  addImport,
  clearHistory,
};
