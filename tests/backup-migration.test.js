/**
 * tests/backup-migration.test.js — v0.8.0 / G3 Backup Migration Pipeline 单元测试
 *
 * 核心：
 *  - 迁移只补缺省（V1 缺 title→''、缺 ledgerImpact→normal；V2 缺 recurringRules→[]）；
 *  - 绝不修非法值（损坏 type/ledgerImpact/dailyValue 原样保留，交 validator 拦截）；
 *  - V3 原样；不支持版本抛错。
 *
 * 运行：node tests/backup-migration.test.js
 */
const path = require('path');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.error('  FAIL: ' + msg);
  }
}
function eq(a, b, msg) {
  assert(a === b, msg + '（期望 ' + b + '，实际 ' + a + '）');
}

global.wx = {
  env: { USER_DATA_PATH: '/usr' },
  getFileSystemManager: () => ({
    accessSync() {
      throw new Error('ENOENT');
    },
    mkdirSync() {},
  }),
  getStorageSync: () => '',
  setStorageSync() {},
};
const ROOT = path.join(__dirname, '..');
const migration = require(path.join(ROOT, 'data', 'backup-migration'));
const validator = require(path.join(ROOT, 'data', 'backup-validator'));

const TS = new Date(2026, 8, 5, 12, 0).getTime();
const CATS = [{ id: 'c-food', name: '餐饮', emoji: '🍚' }];

function hasIssue(result, level, code) {
  const list = level === 'error' ? result.errors : result.warnings;
  return list.some((x) => x.code === code);
}

/* ---------- 1. V1 → V2 → V3：补缺省 + 不修非法值 ---------- */
const v1 = {
  format: 'daily-value-mini-backup',
  schemaVersion: 1,
  appVersion: '0.3.0',
  exportedAt: '2026-09-01T00:00:00.000Z',
  data: {
    bills: [
      { id: 'ok', type: 'expense', amountCents: 1000, categoryId: 'c-food', occurredAt: TS },
      { id: 'badtype', type: 'foobar', amountCents: 100, categoryId: 'c-food', occurredAt: TS },
      { id: 'badimpact', type: 'expense', amountCents: 100, categoryId: 'c-food', occurredAt: TS, ledgerImpact: 'zzz' },
      { id: 'baddv', type: 'expense', amountCents: 100, categoryId: 'c-food', occurredAt: TS, dailyValue: { enabled: true, startDate: 'nope' } },
    ],
    categories: CATS,
    settings: {},
  },
};

const v3 = migration.migrateBackupToV3(v1);
eq(v3.schemaVersion, 3, '迁移后 schemaVersion=3');
assert(Array.isArray(v3.data.recurringRules), 'V3 补 recurringRules 数组');
eq(v3.data.recurringRules.length, 0, 'V3 recurringRules 为空');

// 正常 bill：补缺省
const ok = v3.data.bills.find((b) => b.id === 'ok');
eq(ok.title, '', '正常 bill 补 title');
eq(ok.ledgerImpact, 'normal', '正常 bill 缺 ledgerImpact 补 normal');

// 非法值必须原样保留（不被迁移修掉）
const badtype = v3.data.bills.find((b) => b.id === 'badtype');
eq(badtype.type, 'foobar', "损坏 type='foobar' 保留，不修成 expense");
const badimpact = v3.data.bills.find((b) => b.id === 'badimpact');
eq(badimpact.ledgerImpact, 'zzz', "损坏 ledgerImpact='zzz' 保留，不修成 normal");
const baddv = v3.data.bills.find((b) => b.id === 'baddv');
eq(baddv.dailyValue.startDate, 'nope', '损坏 dailyValue 保留，不静默删除');

// 迁移后再校验：所有损坏被拦截，正常 bill 不报错
const vr = validator.validateBackupRaw(v3);
eq(vr.ok, false, '含损坏的迁移结果校验不通过');
assert(hasIssue(vr, 'error', 'bill-type-invalid'), '校验报 bill-type-invalid');
assert(hasIssue(vr, 'error', 'bill-ledger-impact-invalid'), '校验报 bill-ledger-impact-invalid');
assert(hasIssue(vr, 'error', 'daily-value-start-invalid'), '校验报 daily-value-start-invalid');

/* ---------- 2. V2 → V3：bill 空 ruleId 清理，非空保留 ---------- */
const v2 = {
  format: 'daily-value-mini-backup',
  schemaVersion: 2,
  appVersion: '0.4.0',
  exportedAt: '2026-09-01T00:00:00.000Z',
  data: {
    bills: [
      { id: 'emptyrule', type: 'expense', amountCents: 100, categoryId: 'c-food', occurredAt: TS, title: '', ledgerImpact: 'normal', recurringRuleId: '' },
      { id: 'keeprule', type: 'expense', amountCents: 100, categoryId: 'c-food', occurredAt: TS, title: '', ledgerImpact: 'normal', recurringRuleId: 'r-keep' },
    ],
    categories: CATS,
    settings: {},
  },
};
const v3b = migration.migrateBackupToV3(v2);
const emptyrule = v3b.data.bills.find((b) => b.id === 'emptyrule');
assert(emptyrule.recurringRuleId === undefined, '空 recurringRuleId 被清理');
const keeprule = v3b.data.bills.find((b) => b.id === 'keeprule');
eq(keeprule.recurringRuleId, 'r-keep', '非空 recurringRuleId 保留（孤儿由 validator 给 warning）');

/* ---------- 3. V3 原样返回 ---------- */
const alreadyV3 = {
  format: 'daily-value-mini-backup',
  schemaVersion: 3,
  data: { bills: [], categories: CATS, settings: {}, recurringRules: [] },
};
eq(migration.migrateBackupToV3(alreadyV3).schemaVersion, 3, 'V3 原样返回');

/* ---------- 4. 不支持版本抛错 ---------- */
let threw = false;
try {
  migration.migrateBackupToV3({ schemaVersion: 9, data: {} });
} catch (e) {
  threw = true;
}
assert(threw, '不支持版本抛错');

/* ---------- 5. 分步迁移：V1→V2 不新增 recurringRules ---------- */
const stepV2 = migration.migrateBackupV1ToV2(v1);
eq(stepV2.schemaVersion, 2, '分步 V1→V2');
assert(stepV2.data.recurringRules === undefined, 'V2 不新增 recurringRules');
const stepV3 = migration.migrateBackupV2ToV3(stepV2);
eq(stepV3.schemaVersion, 3, '分步 V2→V3');
assert(Array.isArray(stepV3.data.recurringRules), 'V3 补 recurringRules');

console.log('backup-migration tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
