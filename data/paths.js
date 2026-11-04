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
 *     quarantine/
 *       <YYYYMMDD-HHmmss-SSS>/
 *         2026-10.json   （删前隔离转存的原始字节，仅「存在但不可解析」的分片）
 *         meta.json      （原路径 / 字节数 / 时间 / 触发动作 / 失败原因摘要）
 *     legacy/
 *       jm_records.backup.json
 */
const fs = require('./fs');

const ROOT = fs.userRoot();

const DIR = {
  bills: ROOT + '/bills',
  legacy: ROOT + '/legacy',
  /** 损坏月份分片的隔离转存根目录（删前抄一份，只增不减地保留原始字节） */
  quarantine: ROOT + '/quarantine',
};

const FILE = {
  manifest: ROOT + '/manifest.json',
  settings: ROOT + '/settings.json',
  categories: ROOT + '/categories.json',
  importHistory: ROOT + '/import-history.json',
  recurring: ROOT + '/recurring.json',
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

/** 隔离目录批次路径：quarantineDir('20261104-153012-123') -> .../quarantine/20261104-153012-123 */
function quarantineDir(name) {
  return DIR.quarantine + '/' + name;
}

module.exports = {
  ROOT,
  DIR,
  FILE,
  billFile,
  legacyRecordsBackup,
  legacyRestoreSafety,
  quarantineDir,
};
