/**
 * data/protection.js — 数据保护模式工具（v0.8.0 / G6 P0）
 *
 * 当启动完整性扫描发现文件损坏（CORRUPT / INVALID_SHAPE / UNSUPPORTED_VERSION）时，
 * App 进入数据保护模式：暂停新增 / 修改，不执行可能「修复」或覆盖的初始化。
 *
 * 本文件提供保护模式下两个只读导出动作（供页面 wx.shareFileMessage 发送）：
 *   - buildDiagnostic()：脱敏诊断（完整性结果 + 尝试健康扫描，ID 经 shortId 脱敏）；
 *   - buildRawExport()：全部关键文件的「原始文本」（含损坏文本，供抢救），
 *     不做任何语义改写，最大程度保留可恢复数据。
 *
 * 纯只读、不修改、不创建数据文件。
 */
const fs = require('./fs');
const paths = require('./paths');
const si = require('./storage-integrity');
const health = require('./health');
const { APP_VERSION } = require('../utils/version');

/** 顶层关键文件（kind → 取文件路径） */
const KEY_FILES = [
  ['manifest', () => paths.FILE.manifest],
  ['categories', () => paths.FILE.categories],
  ['settings', () => paths.FILE.settings],
  ['recurring', () => paths.FILE.recurring],
];

/** 脱敏诊断：完整性扫描 + 尝试健康扫描（任一失败都记录，不影响整体导出） */
function buildDiagnostic() {
  let integrity = null;
  try {
    integrity = si.scanStorage();
  } catch (e) {
    integrity = { scanError: String(e && e.message) };
  }
  let healthReport = null;
  try {
    healthReport = health.runHealthScan();
  } catch (e) {
    healthReport = { healthError: String(e && e.message) };
  }
  return {
    format: 'daily-value-diagnostic',
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    integrity,
    health: healthReport,
  };
}

/** 列出所有月份 ym（直接列目录，不 ensure、不创建） */
function listMonthNames() {
  return fs
    .listDir(paths.DIR.bills)
    .filter((n) => /^\d{4}-\d{2}\.json$/.test(n))
    .map((n) => n.replace('.json', ''))
    .sort();
}

/**
 * 原始数据导出：每个关键文件的原始文本（含损坏文本，供抢救）。
 * 不做任何语义改写 / 规范化，最大程度保留可恢复数据；缺失文件不包含。
 */
function buildRawExport() {
  const files = {};
  KEY_FILES.forEach(([kind, getFile]) => {
    const file = getFile();
    if (fs.exists(file)) files[kind + '.json'] = fs.readText(file);
  });
  listMonthNames().forEach((ym) => {
    files['bills/' + ym + '.json'] = fs.readText(paths.billFile(ym));
  });
  return {
    format: 'daily-value-raw-export',
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    files,
  };
}

module.exports = {
  buildDiagnostic,
  buildRawExport,
  listMonthNames,
};
