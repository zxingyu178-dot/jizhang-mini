/**
 * tests/health.test.js — 数据健康体检（v0.7.0 G10）单元测试
 *
 * 覆盖：
 *   - 干净数据 0 error；
 *   - 结构性 error：月份文件损坏 / bills 非数组 / version 非法 / Bill id 缺失·重复 /
 *     type / amount / occurredAt / ledgerImpact / 日价 startDate / 周期账单缺规则 id /
 *     非法周期规则 / 非法预算规则；
 *   - 可放行 warning：categoryId 缺失·未知（归档分类引用合法）/ 周期规则孤儿 /
 *     金额非正 / 预算 enabled 非布尔 / manifest schema 非法 / ym 不一致；
 *   - runHealthScan 端到端（内存 FS，含损坏 JSON 文件）；
 *   - 报告脱敏（不含金额 / 备注 / 商户）。
 * 运行：node tests/health.test.js
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
function eq(actual, expected, msg) {
  assert(actual === expected, msg + ' (expected=' + expected + ', actual=' + actual + ')');
}

/* ---------- 内存 wx 环境（与 categories.test.js 一致） ---------- */
function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const storage = {};
  const fsm = {
    accessSync(p) {
      if (memFiles.has(p) || memDirs.has(p)) return;
      throw new Error('ENOENT');
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
    setStorageSync: (k, v) => { storage[k] = v; },
  };
}

const ROOT = path.join(__dirname, '..');
global.wx = buildWx();
const health = require(path.join(ROOT, 'data', 'health'));
const store = require(path.join(ROOT, 'data', 'index'));

/* ---------- 合法数据包基线 ---------- */
function validBill(over) {
  return Object.assign(
    {
      id: 'b10000000000000000001',
      type: 'expense',
      amountCents: 1200,
      categoryId: 'c-food',
      occurredAt: new Date(2026, 9, 5, 9, 0).getTime(),
      title: '',
      merchant: '',
      note: '正常午餐',
      source: 'manual',
      sourceTxnId: null,
      importBatchId: null,
      createdAt: 1728000000000,
      updatedAt: 1728000000000,
      ledgerImpact: 'normal',
    },
    over || {}
  );
}

function validData() {
  return {
    manifest: { schemaVersion: 3 },
    categories: [
      { id: 'c-food', name: '餐饮', archived: false },
      { id: 'c-other', name: '其他', archived: false },
      { id: 'c-archived', name: '咖啡', archived: true },
    ],
    recurringRulesRaw: [
      {
        id: 'r1',
        enabled: true,
        type: 'expense',
        amountCents: 1000,
        categoryId: 'c-food',
        frequency: 'daily',
        interval: 1,
        startDate: '2026-10-01',
        time: '09:00',
      },
    ],
    budgetRulesRaw: [{ id: 'b1', enabled: true, dailyCents: 3000, effectiveFrom: '2026-10-01', createdAt: 1 }],
    rawMonthFiles: {
      '2026-10': { parseError: false, parsed: { ym: '2026-10', version: 3, bills: [validBill()] } },
    },
  };
}

function codes(result, level) {
  return result[level].map((x) => x.code);
}
function hasCode(result, level, code) {
  return codes(result, level).indexOf(code) >= 0;
}

/* ================= A. 干净数据 ================= */
console.log('A. 干净数据');
{
  const r = health.analyzeHealth(validData());
  eq(r.ok, true, '合法数据包应 ok');
  eq(r.errors.length, 0, '合法数据包 0 error');
  eq(r.warnings.length, 0, '合法数据包 0 warning');
  eq(r.summary.bills, 1, 'bills 计数');
  eq(r.summary.uniqueBills, 1, 'uniqueBills 计数');
}

/* 归档分类引用合法（不报 unknown） */
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.bills = [validBill({ categoryId: 'c-archived' })];
  const r = health.analyzeHealth(d);
  eq(r.ok, true, '引用已归档分类不应报错');
  eq(hasCode(r, 'warnings', 'bill-category-unknown'), false, '归档分类不应报 unknown');
}

/* ================= B. 月份文件结构 error ================= */
console.log('B. 月份文件结构 error');
{
  const d = validData();
  d.rawMonthFiles['2026-10'] = { parseError: true, parsed: null };
  const r = health.analyzeHealth(d);
  eq(r.ok, false, '损坏文件应不 ok');
  assert(hasCode(r, 'errors', 'month-file-corrupt'), '应报 month-file-corrupt');
}
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.bills = null;
  const r = health.analyzeHealth(d);
  assert(hasCode(r, 'errors', 'month-bills-not-array'), 'bills 非数组应报错');
}
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.version = 9;
  const r = health.analyzeHealth(d);
  assert(hasCode(r, 'errors', 'month-version-invalid'), '非法 version 应报错');
}
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.ym = '2026-09';
  const r = health.analyzeHealth(d);
  assert(hasCode(r, 'warnings', 'month-ym-mismatch'), 'ym 与文件名不一致应警告');
}

/* ================= C. Bill 结构 error ================= */
console.log('C. Bill 结构 error');
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.bills = [validBill({ id: '' })];
  assert(hasCode(health.analyzeHealth(d), 'errors', 'bill-id-missing'), '缺 id 应报错');
}
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.bills = [
    validBill({ id: 'dup' }),
    validBill({ id: 'dup', categoryId: 'c-other', occurredAt: new Date(2026, 9, 6).getTime() }),
  ];
  assert(hasCode(health.analyzeHealth(d), 'errors', 'bill-duplicate-id'), '重复 id 应报错');
}
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.bills = [validBill({ type: 'transfer' })];
  assert(hasCode(health.analyzeHealth(d), 'errors', 'bill-type-invalid'), '非法 type 应报错');
}
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.bills = [validBill({ amountCents: NaN })];
  assert(hasCode(health.analyzeHealth(d), 'errors', 'bill-amount-invalid'), 'NaN 金额应报错');
}
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.bills = [validBill({ amountCents: 12.5 })];
  assert(hasCode(health.analyzeHealth(d), 'errors', 'bill-amount-invalid'), '非整数分应报错');
}
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.bills = [validBill({ amountCents: 0 })];
  assert(hasCode(health.analyzeHealth(d), 'warnings', 'bill-amount-nonpositive'), '0 金额仅警告');
}
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.bills = [validBill({ occurredAt: 'nope' })];
  assert(hasCode(health.analyzeHealth(d), 'errors', 'bill-occurred-at-invalid'), '非法 occurredAt 应报错');
}
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.bills = [validBill({ ledgerImpact: 'weird' })];
  assert(hasCode(health.analyzeHealth(d), 'errors', 'bill-ledger-impact-invalid'), '非法 ledgerImpact 应报错');
}
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.bills = [validBill({ dailyValue: { enabled: true, startDate: '2026-02-30' } })];
  assert(hasCode(health.analyzeHealth(d), 'errors', 'daily-value-start-invalid'), '非法日价 startDate 应报错');
}
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.bills = [validBill({ source: 'recurring', recurringRuleId: null })];
  assert(hasCode(health.analyzeHealth(d), 'errors', 'recurring-bill-missing-rule-id'), '周期账单缺规则 id 应报错');
}

/* ================= D. 分类 warning ================= */
console.log('D. 分类 warning');
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.bills = [validBill({ categoryId: '' })];
  assert(hasCode(health.analyzeHealth(d), 'warnings', 'bill-category-missing'), '缺 categoryId 应警告');
}
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.bills = [validBill({ categoryId: 'c-ghost' })];
  const r = health.analyzeHealth(d);
  assert(hasCode(r, 'warnings', 'bill-category-unknown'), '未知分类应警告');
  eq(r.ok, true, '未知分类不应阻断（warning）');
}

/* ================= E. 周期规则 / 孤儿 ================= */
console.log('E. 周期规则与孤儿引用');
{
  const d = validData();
  d.rawMonthFiles['2026-10'].parsed.bills = [
    validBill({ source: 'recurring', recurringRuleId: 'r-gone' }),
  ];
  const r = health.analyzeHealth(d);
  assert(hasCode(r, 'warnings', 'bill-recurring-rule-orphan'), '规则孤儿应警告（删除规则后历史保留）');
  eq(r.ok, true, '规则孤儿不应阻断（warning）');
}
{
  const d = validData();
  d.recurringRulesRaw = [Object.assign({}, d.recurringRulesRaw[0], { frequency: 'foobar' })];
  assert(hasCode(health.analyzeHealth(d), 'errors', 'recurring-rule-invalid-frequency'), '非法 frequency 应报错');
}
{
  const d = validData();
  d.recurringRulesRaw = [Object.assign({}, d.recurringRulesRaw[0], { startDate: '2026-13-40' })];
  assert(hasCode(health.analyzeHealth(d), 'errors', 'recurring-rule-invalid-start-date'), '非法 startDate 应报错');
}
{
  const d = validData();
  d.recurringRulesRaw = [
    Object.assign({}, d.recurringRulesRaw[0], { frequency: 'weekly', day: 9 }),
  ];
  assert(hasCode(health.analyzeHealth(d), 'errors', 'recurring-rule-invalid-day'), 'weekly day=9 应报错');
}
{
  const d = validData();
  // 每周日 day=0 是合法的（v0.6.1 周日迁移口径）
  d.recurringRulesRaw = [
    Object.assign({}, d.recurringRulesRaw[0], { frequency: 'weekly', day: 0, interval: 1 }),
  ];
  const r = health.analyzeHealth(d);
  eq(hasCode(r, 'errors', 'recurring-rule-invalid-day'), false, '每周日 day=0 合法');
}
{
  const d = validData();
  d.recurringRulesRaw = [Object.assign({}, d.recurringRulesRaw[0], { amountCents: 0 })];
  assert(hasCode(health.analyzeHealth(d), 'errors', 'recurring-rule-invalid-amount'), '周期 0 金额应报错');
}

/* ================= F. 预算规则 ================= */
console.log('F. 预算规则');
{
  const d = validData();
  d.budgetRulesRaw = [{ id: 'b1', enabled: true, dailyCents: 3000, effectiveFrom: '2026-1-1' }];
  assert(hasCode(health.analyzeHealth(d), 'errors', 'budget-rule-date-invalid'), '未补零/非法日期应报错');
}
{
  const d = validData();
  d.budgetRulesRaw = [{ id: 'b1', enabled: true, dailyCents: -5, effectiveFrom: '2026-10-01' }];
  assert(hasCode(health.analyzeHealth(d), 'errors', 'budget-rule-amount-invalid'), '负预算应报错');
}
{
  const d = validData();
  d.budgetRulesRaw = [{ id: 'b1', enabled: 'yes', dailyCents: 3000, effectiveFrom: '2026-10-01' }];
  const r = health.analyzeHealth(d);
  assert(hasCode(r, 'warnings', 'budget-rule-enabled-invalid'), 'enabled 非布尔应警告');
  eq(r.ok, true, 'enabled 非布尔不应阻断');
}

/* ================= G. manifest ================= */
console.log('G. manifest');
{
  const d = validData();
  d.manifest = { schemaVersion: 99 };
  const r = health.analyzeHealth(d);
  assert(hasCode(r, 'warnings', 'manifest-schema-invalid'), 'manifest 非法 schema 应警告');
  eq(r.ok, true, 'manifest 警告不应阻断');
}

/* ================= H. 端到端 runHealthScan ================= */
console.log('H. 端到端 runHealthScan');
{
  global.wx = buildWx();
  store.init();
  store.addBill({ type: 'expense', amountCents: 35, categoryId: 'c-food', occurredAt: new Date(2026, 9, 5, 12, 0).getTime(), note: '端到端' });
  store.saveBudgetRule({ enabled: true, dailyCents: 3000, effectiveFrom: '2026-10-01' });
  const r = store.runHealthScan();
  eq(r.ok, true, '正常初始化 + 记账 + 预算应体检通过');
  eq(r.errors.length, 0, '端到端 0 error');
  assert(r.summary.months >= 1, '至少扫描到 1 个月份分片');
}

/* 端到端：损坏 JSON 月份文件被识别 */
{
  global.wx = buildWx();
  store.init();
  // 直接写入损坏文本到月份文件（绕过数据层）
  const paths = require(path.join(ROOT, 'data', 'paths'));
  const fs = require(path.join(ROOT, 'data', 'fs'));
  fs.ensureDir(paths.DIR.bills);
  const fsm = global.wx.getFileSystemManager();
  fsm.writeFileSync(paths.billFile('2026-10'), '{ this is not valid json,,,');
  const r = store.runHealthScan();
  assert(hasCode(r, 'errors', 'month-file-corrupt'), '端到端应识别损坏 JSON 月份文件');
}

/* ================= I. 脱敏报告 ================= */
console.log('I. 脱敏报告');
{
  const d = validData();
  // 加入敏感内容与一个错误
  d.rawMonthFiles['2026-10'].parsed.bills = [
    validBill({ note: '我的秘密备注', merchant: '神秘商户', amountCents: 88888 }),
    validBill({ id: 'b2', amountCents: NaN, note: '另一笔工资 99999' }),
  ];
  const r = health.analyzeHealth(d);
  const report = health.formatHealthReport(r);
  eq(report.indexOf('我的秘密备注'), -1, '报告不得包含备注');
  eq(report.indexOf('神秘商户'), -1, '报告不得包含商户');
  eq(report.indexOf('88888'), -1, '报告不得包含金额');
  eq(report.indexOf('99999'), -1, '报告不得包含金额 2');
  assert(report.indexOf('bill-amount-invalid') >= 0, '报告应包含错误 code');
}

/* ================= 汇总 ================= */
console.log('\n==================== health.test.js 汇总 ====================');
console.log('PASS=' + pass + ' FAIL=' + fail);
if (fail > 0) {
  console.error('health.test.js 存在失败用例');
  process.exit(1);
}
console.log('health.test.js 全部通过');
process.exit(0);
