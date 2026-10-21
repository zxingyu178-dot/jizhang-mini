/**
 * data/manifest.js — 本地数据清单与迁移状态
 *
 * manifest.json：
 *   { schemaVersion, appVersion, createdAt, updatedAt,
 *     migrations: { jmRecords:{...}, billV2:{...}, billV3:{...} } }
 *
 * schemaVersion 演进：
 *   1：Bill V1（无 title / dailyValue）；
 *   2：Bill V2（新增 title / ledgerImpact 语义完善 / dailyValue 扩展）；
 *   3：Bill V3（新增 recurringRuleId，支持周期记账）。
 */
const fs = require('./fs');
const paths = require('./paths');
const { APP_VERSION } = require('../utils/version');

const SCHEMA_VERSION = 3;

function ensureManifest() {
  const existing = fs.readJSON(paths.FILE.manifest, null);
  if (existing) return existing;
  const now = Date.now();
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    createdAt: now,
    updatedAt: now,
    migrations: {
      jmRecords: { status: 'pending' },
      billV2: { status: 'pending' },
      billV3: { status: 'pending' },
    },
  };
  fs.writeJSONAtomic(paths.FILE.manifest, manifest);
  return manifest;
}

function getManifest() {
  return ensureManifest();
}

function getMigration(name) {
  return (getManifest().migrations || {})[name] || null;
}

function setMigrationResult(name, result) {
  const m = getManifest();
  m.migrations = m.migrations || {};
  m.migrations[name] = Object.assign({}, result, { migratedAt: Date.now() });
  m.updatedAt = Date.now();
  fs.writeJSONAtomic(paths.FILE.manifest, m);
  return m.migrations[name];
}

/** 更新顶层 schemaVersion（不改动其它字段） */
function setSchemaVersion(v) {
  const m = getManifest();
  m.schemaVersion = v;
  m.updatedAt = Date.now();
  fs.writeJSONAtomic(paths.FILE.manifest, m);
  return m;
}

module.exports = {
  SCHEMA_VERSION,
  APP_VERSION,
  ensureManifest,
  getManifest,
  getMigration,
  setMigrationResult,
  setSchemaVersion,
};
