/**
 * data/paths.js — USER_DATA_PATH 下的路径管理
 *
 * 本地目录结构：
 *   <USER_DATA_PATH>/
 *     manifest.json
 *     settings.json
 *     categories.json
 *     import-history.json
 *     bills/
 *       2026-10.json
 *     legacy/
 *       jm_records.backup.json
 */
const fs = require('./fs');

const ROOT = fs.userRoot();

const DIR = {
  bills: ROOT + '/bills',
  legacy: ROOT + '/legacy',
};

const FILE = {
  manifest: ROOT + '/manifest.json',
  settings: ROOT + '/settings.json',
  categories: ROOT + '/categories.json',
  importHistory: ROOT + '/import-history.json',
};

/** 月份分片路径：billFile('2026-10') -> .../bills/2026-10.json */
function billFile(ym) {
  return DIR.bills + '/' + ym + '.json';
}

/** 旧 jm_records 备份路径 */
function legacyRecordsBackup() {
  return DIR.legacy + '/jm_records.backup.json';
}

/** 恢复前安全点路径 */
function legacyRestoreSafety() {
  return DIR.legacy + '/restore-safety.json';
}

module.exports = {
  ROOT,
  DIR,
  FILE,
  billFile,
  legacyRecordsBackup,
  legacyRestoreSafety,
};
