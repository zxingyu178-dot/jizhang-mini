/**
 * tests/backup-restore-statistics.test.js — v1.3.4 Review Fix P1-2
 *
 * 验证：恢复一份「主题不同、账单不同」的备份，返回主页后月度 / 年度统计与
 * 恢复后的账本一致（而不是停留在旧账本），且备份恢复不被误判为纯主题切换。
 *
 * 取数路径与 components/statistics-panel 的 loadMonth / loadYear 完全一致：
 *   store.rangeBills(...) + data/statistics/month|year 纯函数。
 *
 * 运行：node tests/backup-restore-statistics.test.js
 */
const path = require('path');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) {
  assert(a === b, msg + '（期望 ' + b + '，实际 ' + a);
}

/* ---------- 完整内存文件系统 ---------- */
function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
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
      if (!memFiles.has(p)) throw new Error('ENOENT ' + p);
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
      memDirs.forEach((d) => {
        if (d.startsWith(prefix)) {
          const rest = d.slice(prefix.length);
          if (rest && !rest.includes('/')) out.add(rest);
        }
      });
      return [...out];
    },
    statSync(p) {
      const isDir = memDirs.has(p);
      const isFile = memFiles.has(p);
      if (!isDir && !isFile) throw new Error('ENOENT ' + p);
      return { isDirectory: () => isDir, isFile: () => isFile };
    },
    rmdirSync(p) {
      if (!memDirs.has(p)) throw new Error('ENOENT ' + p);
      const pfx = p + '/';
      let nonEmpty = false;
      memFiles.forEach((v, k) => { if (k.startsWith(pfx)) nonEmpty = true; });
      memDirs.forEach((d) => { if (d.startsWith(pfx)) nonEmpty = true; });
      if (nonEmpty) throw new Error('directory not empty ' + p);
      memDirs.delete(p);
    },
  };
  return {
    setWx() {
      global.wx = { env: { USER_DATA_PATH: '/usr' }, getFileSystemManager: () => fsm };
    },
  };
}

buildWx().setWx();

const ROOT = path.join(__dirname, '..');
const store = require(path.join(ROOT, 'data', 'index'));
const theme = require(path.join(ROOT, 'utils', 'theme'));
const M = require(path.join(ROOT, 'data', 'statistics', 'month'));
const Y = require(path.join(ROOT, 'data', 'statistics', 'year'));

const CATEGORIES = [
  { id: 'c-food', name: '餐饮', emoji: '🍚', builtin: true, sort: 1, archived: false },
  { id: 'c-transport', name: '交通', emoji: '🚌', builtin: true, sort: 2, archived: false },
  { id: 'c-life', name: '生活', emoji: '🧴', builtin: true, sort: 3, archived: false },
  { id: 'c-salary', name: '工资', emoji: '💼', builtin: true, sort: 4, archived: false },
];

/* ---------- 1. 建立旧账本（深色，10 月两笔旧账单） ---------- */
store.init();
theme._resetForTest();
theme.init();

const oldTs = new Date(2026, 9, 10, 12).getTime();
store.addBill({ type: 'expense', amountCents: 10000, categoryId: 'c-food', occurredAt: oldTs });
store.addBill({ type: 'expense', amountCents: 5000, categoryId: 'c-transport', occurredAt: oldTs });

// 旧 10 月统计基线：支出 15000
const oldMonth = M.computeMonthOverview(store.rangeBills('2026-10', '2026-10'));
eq(oldMonth.expense, 15000, '旧账本 10 月支出 15000');
eq(theme.getEffectiveTheme(), 'dark', '旧账本主题 dark');

/* ---------- 2. 构造「主题不同、账单不同」的浅色备份 ---------- */
const sepTs = new Date(2026, 8, 10, 12).getTime();
const octTs = new Date(2026, 9, 12, 12).getTime();
const backup = {
  format: 'daily-value-mini-backup',
  schemaVersion: 3,
  appVersion: '1.3.4',
  exportedAt: '2026-10-20T00:00:00.000Z',
  data: {
    bills: [
      { id: 'n1', type: 'expense', amountCents: 20000, categoryId: 'c-life', occurredAt: sepTs, title: '', ledgerImpact: 'normal' },
      { id: 'n2', type: 'expense', amountCents: 30000, categoryId: 'c-food', occurredAt: octTs, title: '', ledgerImpact: 'normal' },
      { id: 'n3', type: 'income', amountCents: 100000, categoryId: 'c-salary', occurredAt: octTs, title: '', ledgerImpact: 'normal' },
    ],
    categories: CATEGORIES.map((c) => Object.assign({}, c)),
    settings: { currency: '¥', theme: 'light' },
    recurringRules: [],
  },
};

/* ---------- 3. 恢复，并核对主题计数器 ---------- */
const themeOnlyBefore = theme.getThemeOnlyCounter();
store.restoreBackup(backup);

eq(theme.getEffectiveTheme(), 'light', '恢复后主题切换为 light');
eq(theme.getThemeOnlyCounter(), themeOnlyBefore, '备份恢复不递增纯主题序号（非纯主题操作）');
// 纯主题序号未变 → onShow 判定 themeOnly=false → 统计面板完整刷新（而非跳过）。
const onShowThemeOnly = theme.getThemeOnlyCounter() !== themeOnlyBefore;
eq(onShowThemeOnly, false, 'onShow 不会把备份恢复误判为纯主题切换，统计完整刷新');

/* ---------- 4. 月度统计：与恢复后账本一致 ---------- */
// 4.1 9 月（旧账本没有的月份）
const sepBills = store.rangeBills('2026-09', '2026-09');
const sepMonth = M.computeMonthOverview(sepBills);
eq(sepMonth.expense, 20000, '恢复后 9 月支出 20000');
eq(sepMonth.count, 1, '恢复后 9 月 1 笔');

// 4.2 10 月：是新账单（30000）而非旧账单（15000），也不是合并（45000）
const octBills = store.rangeBills('2026-10', '2026-10');
const octMonth = M.computeMonthOverview(octBills);
eq(octMonth.expense, 30000, '恢复后 10 月支出刷新为 30000（旧账单已替换）');
eq(octMonth.income, 100000, '恢复后 10 月收入 100000');
eq(octMonth.balance, 70000, '恢复后 10 月结余 70000');
eq(octMonth.count, 2, '恢复后 10 月 2 笔');
// 旧账单 ID 已不存在
eq(octBills.some((b) => b.categoryId === 'c-transport'), false, '恢复后旧的交通账单已不存在');

/* ---------- 5. 年度统计：与恢复后账本一致 ---------- */
const yearBills = store.rangeBills('2026-01', '2026-12');
const yearOv = Y.computeYearOverview(yearBills, 2026);
eq(yearOv.expense, 50000, '恢复后 2026 年度支出 50000');
eq(yearOv.income, 100000, '恢复后 2026 年度收入 100000');
eq(yearOv.count, 3, '恢复后 2026 年度 3 笔');

/* ---------- 6. 统计口径直接对账：纯函数结果 === 现取账单现算 ---------- */
let reExpense = 0;
yearBills.forEach((b) => { if (b.type !== 'income') reExpense += b.amountCents; });
eq(yearOv.expense, reExpense, '年度统计与按恢复后账单现算完全一致');

/* ---------- 7. 周期规则缺 createdAt 的备份恢复兼容性（v1.4.2 修复回归） ----------
 * 旧行为：写入时 normalizeRule 取一次 Date.now()、核对时再取一次 →
 * 缺 createdAt 的合法备份被误判 recurring-mismatch，整份恢复失败并回滚。
 * 修复后：恢复路径只规范化一次，恢复成功，且落盘 createdAt 为有限正数、
 * 重复读取不再生成新时间戳，统计口径仍与恢复后账本一致。 */
const ruleNoCreated = {
  id: 'r-no-created',
  enabled: true,
  type: 'expense',
  amountCents: 1500,
  categoryId: 'c-food',
  note: '缺 createdAt 的规则',
  frequency: 'monthly',
  interval: 1,
  day: 3,
  startDate: '2026-09-03',
  time: '09:00',
};
const backupNoCreated = store.buildBackup();
backupNoCreated.data.recurringRules = [ruleNoCreated];

// 单调递增假时钟：让「同一次恢复里取两次 Date.now()」稳定产生不同时间戳，
// 不依赖两次调用恰好落在同一毫秒（否则缺陷只是偶发、断言可能假通过）。
const CLOCK_BASE = 1715000000000;
const realDateNow = Date.now;
let fakeClock = CLOCK_BASE;
Date.now = function () {
  fakeClock += 7;
  return fakeClock;
};
let restoreErr = null;
try {
  store.restoreBackup(backupNoCreated);
} catch (e) {
  restoreErr = e;
} finally {
  Date.now = realDateNow;
}
eq(restoreErr, null, '缺 createdAt 的合法规则不再导致恢复失败（旧实现必失败）');

const rulesAfter = store.recurring.getRules();
eq(rulesAfter.length, 1, '恢复后周期规则 1 条（未丢失）');
const createdAfter = rulesAfter[0] && rulesAfter[0].createdAt;
assert(
  typeof createdAfter === 'number' && Number.isFinite(createdAfter) && createdAfter > 0,
  '恢复后 createdAt 为有限正数（实际 ' + createdAfter + '）'
);
assert(
  createdAfter >= CLOCK_BASE && createdAfter <= CLOCK_BASE + 100000,
  '恢复后 createdAt 取本次恢复时刻（假时钟窗口内，实际 ' + createdAfter + '）'
);
eq(rulesAfter[0].id, 'r-no-created', '规则 ID 未变');
eq(rulesAfter[0].note, '缺 createdAt 的规则', '规则业务字段未变');
const rulesAgain = store.recurring.getRules();
eq(rulesAgain[0].createdAt, createdAfter, '重复读取不会生成新 createdAt（归一幂等）');

// 统计口径仍与恢复后账本一致
const monthAfter = M.computeMonthOverview(store.rangeBills('2026-10', '2026-10'));
eq(monthAfter.expense, 30000, '规则恢复后 10 月支出仍为 30000');
const yearAfter = Y.computeYearOverview(store.rangeBills('2026-01', '2026-12'), 2026);
let reExpense2 = 0;
store.rangeBills('2026-01', '2026-12').forEach((b) => {
  if (b.type !== 'income') reExpense2 += b.amountCents;
});
eq(yearAfter.expense, reExpense2, '规则恢复后年度支出与现算一致');

/* ---------- 汇总 ---------- */
console.log('\nbackup-restore-statistics tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL BACKUP RESTORE STATISTICS TESTS PASSED');
