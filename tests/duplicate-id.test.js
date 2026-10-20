/**
 * tests/duplicate-id.test.js — v0.8.0 / G5 重复 ID 检测（运行时 health 层）
 *
 * 覆盖：category / recurring-rule / budget-rule 重复 id 为 error（bill 重复已有）；
 * 全唯一时不误报。直接用 analyzeHealth 喂数据（纯逻辑，不依赖文件系统）。
 *
 * 运行：node tests/duplicate-id.test.js
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

global.wx = {
  env: { USER_DATA_PATH: '/usr' },
  getFileSystemManager: () => ({ accessSync() { throw new Error('ENOENT'); }, mkdirSync() {} }),
  getStorageSync: () => '',
  setStorageSync() {},
};
const ROOT = path.join(__dirname, '..');
const hr = require(path.join(ROOT, 'data', 'health'));

function hasError(r, code) {
  return r.errors.some((x) => x.code === code);
}

/* ---------- 1. categories 重复 id ---------- */
{
  const r = hr.analyzeHealth({
    categories: [
      { id: 'c-x', name: '甲' },
      { id: 'c-x', name: '乙' },
    ],
    recurringRulesRaw: [],
    budgetRulesRaw: [],
    rawMonthFiles: {},
  });
  assert(hasError(r, 'category-duplicate-id'), 'category 重复 id 报错');
}

/* ---------- 2. recurring rules 重复 id（其余字段合法） ---------- */
{
  const goodRule = {
    id: 'rr', enabled: true, type: 'expense', amountCents: 100, categoryId: 'c-food',
    frequency: 'monthly', interval: 1, day: 1, startDate: '2026-01-01', time: '09:00',
  };
  const r = hr.analyzeHealth({
    categories: [{ id: 'c-food', name: '餐饮' }],
    recurringRulesRaw: [goodRule, Object.assign({}, goodRule)],
    budgetRulesRaw: [],
    rawMonthFiles: {},
  });
  assert(hasError(r, 'recurring-rule-duplicate-id'), 'recurring rule 重复 id 报错');
}

/* ---------- 3. budget rules 重复 id（其余字段合法） ---------- */
{
  const goodBudget = { id: 'br', enabled: true, dailyCents: 100, effectiveFrom: '2026-01-01' };
  const r = hr.analyzeHealth({
    categories: [],
    recurringRulesRaw: [],
    budgetRulesRaw: [goodBudget, Object.assign({}, goodBudget)],
    rawMonthFiles: {},
  });
  assert(hasError(r, 'budget-rule-duplicate-id'), 'budget rule 重复 id 报错');
}

/* ---------- 4. 全唯一时不误报 ---------- */
{
  const r = hr.analyzeHealth({
    categories: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    recurringRulesRaw: [],
    budgetRulesRaw: [{ id: 'b1', enabled: true, dailyCents: 1, effectiveFrom: '2026-01-01' }],
    rawMonthFiles: {},
  });
  assert(!hasError(r, 'category-duplicate-id'), '唯一 category 不报');
  assert(!hasError(r, 'budget-rule-duplicate-id'), '唯一 budget rule 不报');
}

console.log('duplicate-id tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
