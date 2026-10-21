/**
 * tests/backup-validator.test.js — v0.8.0 / G2 Raw Backup Validator 单元测试
 *
 * 核心：过去会被 createBill 自动「修好」的非法值（type / ledgerImpact / 缺 id /
 * occurredAt=0），恢复前 validator 必须拦截；以及 categories / budget / recurring
 * 结构损坏、重复 id、交叉引用问题。
 *
 * 运行：node tests/backup-validator.test.js
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

/* ---------- 内存 wx（复刻 data.test.js） ---------- */
function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const storage = {};
  const fsm = {
    accessSync(p) {
      if (memFiles.has(p) || memDirs.has(p)) return;
      throw new Error('ENOENT ' + p);
    },
    mkdirSync(p, recursive) {
      if (recursive) {
        const parts = p.split('/');
        let cur = '';
        parts.forEach((x, i) => {
          if (i === 0 && x === '') cur = '';
          else {
            cur = cur + '/' + x;
            memDirs.add(cur);
          }
        });
      } else memDirs.add(p);
    },
    readFileSync(p) {
      if (!memFiles.has(p)) throw new Error('ENOENT ' + p);
      return memFiles.get(p);
    },
    writeFileSync(p, data) {
      memFiles.set(p, String(data));
    },
    unlinkSync(p) {
      if (!memFiles.has(p)) throw new Error('ENOENT');
      memFiles.delete(p);
    },
    renameSync(oldPath, newPath) {
      if (!memFiles.has(oldPath)) throw new Error('ENOENT');
      if (memFiles.has(newPath)) throw new Error('file already exists');
      memFiles.set(newPath, memFiles.get(oldPath));
      memFiles.delete(oldPath);
    },
    readdirSync(p) {
      const prefix = p.endsWith('/') ? p : p + '/';
      const out = new Set();
      memFiles.forEach((v, k) => {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          if (rest && !rest.includes('/')) out.add(rest);
        }
      });
      return [...out];
    },
  };
  return {
    env: { USER_DATA_PATH: '/usr' },
    getFileSystemManager: () => fsm,
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => {
      storage[k] = v;
    },
  };
}

global.wx = buildWx();
const ROOT = path.join(__dirname, '..');
const store = require(path.join(ROOT, 'data', 'index'));
const backup = require(path.join(ROOT, 'data', 'backup'));
const validator = require(path.join(ROOT, 'data', 'backup-validator'));

/** 构造合法 V3 基线（深拷贝，便于注入损坏） */
function base() {
  global.wx = buildWx();
  store.init();
  store.addBill({
    type: 'expense',
    amountCents: 2500,
    categoryId: 'c-food',
    occurredAt: new Date(2026, 9, 10, 12, 0).getTime(),
  });
  store.recurring.createRule({
    type: 'expense',
    amountCents: 200000,
    categoryId: 'c-housing',
    frequency: 'monthly',
    interval: 1,
    day: 1,
    startDate: '2026-09-01',
    time: '09:00',
  });
  store.saveBudgetRule({ enabled: true, dailyCents: 10000, effectiveFrom: '2026-09-01' });
  return JSON.parse(JSON.stringify(backup.buildBackup()));
}

function hasIssue(result, level, code) {
  const list = level === 'error' ? result.errors : result.warnings;
  return list.some((x) => x.code === code);
}
function expectReject(mutator, code, msg) {
  const b = base();
  mutator(b);
  const r = validator.validateBackupRaw(b);
  assert(r.ok === false, msg + '（校验未通过）');
  assert(hasIssue(r, 'error', code), msg + '（error code=' + code + '）');
}
function expectWarn(mutator, code, msg) {
  const b = base();
  mutator(b);
  const r = validator.validateBackupRaw(b);
  assert(hasIssue(r, 'warning', code), msg + '（warning code=' + code + '）');
}

/* ---------- 0. 合法基线通过 ---------- */
const good = validator.validateBackupRaw(base());
assert(good.ok === true, '合法 V3 备份校验通过（errors=' + good.errors.map((e) => e.code).join(',') + '）');

/* ---------- 1. envelope ---------- */
expectReject((b) => { b.format = 'nope'; }, 'backup-format-invalid', 'format 错误');
expectReject((b) => { b.schemaVersion = 9; }, 'backup-schema-version-invalid', 'schemaVersion 错误');
expectReject((b) => { b.data = null; }, 'backup-data-missing', 'data 缺失');
expectReject((b) => { b.data.bills = null; }, 'backup-bills-not-array', 'bills 非数组');
assert(validator.validateBackupRaw('x').ok === false, '非对象备份');

/* ---------- 2. P0：过去会被 createBill 偷偷修好的非法值，现在必须拦截 ---------- */
expectReject(
  (b) => { b.data.bills[0].type = 'foobar'; },
  'bill-type-invalid',
  "type='foobar' 拒绝（不再被 createBill 修成 expense）"
);
expectReject(
  (b) => { b.data.bills[0].ledgerImpact = 'abc'; },
  'bill-ledger-impact-invalid',
  "ledgerImpact='abc' 拒绝（不再修成 normal）"
);
expectReject(
  (b) => { b.data.bills[0].id = ''; },
  'bill-id-missing',
  '缺 id 拒绝（不再自动生成）'
);
expectReject(
  (b) => { b.data.bills[0].occurredAt = 0; },
  'bill-occurred-at-invalid',
  'occurredAt=0 拒绝（不再被改成当前时间）'
);
expectReject(
  (b) => { b.data.bills[0].amountCents = NaN; },
  'bill-amount-invalid',
  'amountCents=NaN 拒绝'
);
expectReject(
  (b) => {
    b.data.bills[0].dailyValue = { enabled: true, mode: 'elapsed', startDate: 'bad-date' };
  },
  'daily-value-start-invalid',
  'dailyValue.startDate 非法拒绝'
);
expectReject(
  (b) => {
    const copy = JSON.parse(JSON.stringify(b.data.bills[0]));
    b.data.bills.push(copy);
  },
  'bill-duplicate-id',
  'bill id 重复拒绝'
);

/* ---------- 3. categories 结构 ---------- */
expectReject((b) => { b.data.categories = null; }, 'backup-categories-missing', 'categories 缺失');
expectReject((b) => { b.data.categories = {}; }, 'backup-categories-not-array', 'categories 非数组');
expectReject(
  (b) => { b.data.categories[0].name = ''; },
  'category-name-missing',
  'category 缺 name 拒绝'
);
expectReject(
  (b) => { b.data.categories[0].id = ''; },
  'category-id-missing',
  'category 缺 id 拒绝'
);
expectReject(
  (b) => {
    b.data.categories[1].id = b.data.categories[0].id;
  },
  'category-duplicate-id',
  'category 重复 id 拒绝'
);

/* ---------- 4. settings / budget ---------- */
expectReject((b) => { b.data.settings = []; }, 'backup-settings-invalid', 'settings 非对象');
expectReject((b) => { b.data.settings.budget = []; }, 'budget-shape', 'budget 形态错误');
expectReject(
  (b) => { b.data.settings.budget = { version: 1, rules: null }; },
  'budget-rules-not-array',
  'budget rules 非数组'
);
expectReject(
  (b) => {
    const r = b.data.settings.budget.rules[0];
    b.data.settings.budget.rules.push(JSON.parse(JSON.stringify(r)));
  },
  'budget-rule-duplicate-id',
  'budget rule 重复 id 拒绝'
);

/* ---------- 5. recurring rules ---------- */
expectReject(
  (b) => { b.data.recurringRules = null; },
  'backup-recurring-rules-missing',
  'recurringRules 缺失（V3 应含）'
);
expectReject(
  (b) => { b.data.recurringRules = {}; },
  'backup-recurring-rules-not-array',
  'recurringRules 非数组'
);
expectReject(
  (b) => {
    const r = JSON.parse(JSON.stringify(b.data.recurringRules[0]));
    b.data.recurringRules.push(r);
  },
  'recurring-rule-duplicate-id',
  'recurring rule 重复 id 拒绝'
);
expectReject(
  (b) => { b.data.recurringRules[0].frequency = 'foobar'; },
  'recurring-rule-invalid-frequency',
  "frequency='foobar' 拒绝（不再偷偷变成 daily）"
);
expectReject(
  (b) => { b.data.recurringRules[0].day = 32; },
  'recurring-rule-invalid-day',
  'monthly day=32 拒绝（超出 1..31）'
);
expectReject(
  (b) => { b.data.recurringRules[0].categoryId = 'c-nope'; },
  'recurring-rule-category-unknown',
  '周期规则引用未知分类拒绝'
);

/* ---------- 6. warning（软引用 / 历史） ---------- */
expectWarn(
  (b) => { b.data.bills[0].categoryId = 'c-ghost'; },
  'bill-category-unknown',
  '账单引用未知分类为 warning'
);
expectWarn(
  (b) => {
    b.data.bills[0].source = 'recurring';
    b.data.bills[0].recurringRuleId = 'rule-ghost';
  },
  'bill-recurring-rule-orphan',
  '账单孤儿周期引用为 warning'
);
expectWarn(
  (b) => { b.data.settings = null; },
  'backup-settings-missing',
  'settings 缺失可补默认，warning'
);

console.log('backup-validator tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
