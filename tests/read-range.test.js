/**
 * tests/read-range.test.js — 统计 / 预算 数据读取范围测试（v1.3.0 Gate 1）
 *
 * 用内存文件系统 mock wx，并在 readFileSync 上按「月份分片」记录每个
 * bills/YYYY-MM.json 的实际读取次数（而非只记总次数），验证：
 *   - 预算日历只读取所选月份；
 *   - 预算日详情只读取该日所属月份；
 *   - 预算节奏 / 月节奏只读取涉及月份（含跨月、跨年）；
 *   - computeBudgetByKind 各周期只读取覆盖月份；
 *   - 自定义日期范围只读取覆盖月份（rangeBills 月份范围合同）。
 *
 * 预期月份集合用与被测代码相同的 period 纯函数计算，避免硬编码星期。
 * 运行：node tests/read-range.test.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  FAIL: ' + msg); }
}
function setEq(actual, expected, msg) {
  const a = Array.from(actual).sort().join(',');
  const e = Array.from(expected).sort().join(',');
  assert(a === e, msg + ' (expected=[' + e + '], actual=[' + a + '])');
}

/* ---------- 内存 wx，按月份分片记录读取次数 ---------- */
function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const shardReads = {}; // 'YYYY-MM' -> count
  const fsm = {
    accessSync(p) {
      if (memFiles.has(p) || memDirs.has(p)) return;
      throw new Error('ENOENT ' + p);
    },
    mkdirSync(p, recursive) {
      if (recursive) {
        const ps = p.split('/');
        let cur = '';
        ps.forEach((x, i) => {
          if (i === 0 && x === '') cur = '';
          else { cur = cur + '/' + x; memDirs.add(cur); }
        });
      } else memDirs.add(p);
    },
    readFileSync(p) {
      const m = /\/bills\/(\d{4}-\d{2})\.json$/.exec(String(p));
      if (m) shardReads[m[1]] = (shardReads[m[1]] || 0) + 1;
      if (!memFiles.has(p)) throw new Error('ENOENT ' + p);
      return memFiles.get(p);
    },
    writeFileSync(p, data) { memFiles.set(p, String(data)); },
    renameSync(o, n) {
      if (!memFiles.has(o)) throw new Error('ENOENT ' + o);
      if (memFiles.has(n)) throw new Error('exists ' + n);
      memFiles.set(n, memFiles.get(o));
      memFiles.delete(o);
    },
    unlinkSync(p) {
      if (!memFiles.has(p)) throw new Error('ENOENT ' + p);
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
  const wx = {
    env: { USER_DATA_PATH: '/usr' },
    getFileSystemManager: () => fsm,
    getStorageSync: () => undefined,
    setStorageSync: () => {},
  };
  return { wx, shardReads };
}

const env0 = buildWx();
global.wx = env0.wx;
const store = require(path.join(ROOT, 'data', 'index'));
const budgetPeriod = require(path.join(ROOT, 'data', 'budget', 'period'));

store.init();

/* ---------- 造跨 7 个月（含跨年）的虚构账单，每月 2 笔支出 ---------- */
const MONTHS = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];
function tsOf(ym, day) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, day, 12, 0, 0).getTime();
}
MONTHS.forEach((ym, i) => {
  store.addBill({ type: 'expense', amountCents: 1000 + i * 100, categoryId: 'c-food', occurredAt: tsOf(ym, 5), title: '范围测试A' });
  store.addBill({ type: 'expense', amountCents: 2000 + i * 100, categoryId: 'c-transport', occurredAt: tsOf(ym, 20), title: '范围测试B' });
});

const TODAY = '2026-02-15'; // 固定基准日（当前月 = 2026-02）

function resetReads() { Object.keys(env0.shardReads).forEach((k) => { delete env0.shardReads[k]; }); }
function readSet() { return Object.keys(env0.shardReads); }
/** 两个含端点日期之间的月份集合（用 period 计算预期） */
function monthsBetween(startStr, endStr) {
  const out = [];
  let cur = startStr.slice(0, 7);
  const end = endStr.slice(0, 7);
  let guard = 0;
  while (cur <= end && guard < 120) {
    out.push(cur);
    cur = budgetPeriod.firstOfNextMonth(cur + '-01').slice(0, 7);
    guard++;
  }
  return out;
}

console.log('== 1. 预算日历只读取所选月份 ==');
resetReads();
store.buildBudgetCalendar(2026, 1, TODAY);
setEq(readSet(), ['2026-01'], 'buildBudgetCalendar(2026,1) 只读 2026-01');

resetReads();
store.buildBudgetCalendar(2025, 12, TODAY);
setEq(readSet(), ['2025-12'], 'buildBudgetCalendar(2025,12) 只读 2025-12（跨年）');

console.log('== 2. 预算日详情只读取所属月份 ==');
resetReads();
store.buildBudgetDayDetail('2025-12-10');
setEq(readSet(), ['2025-12'], 'buildBudgetDayDetail(2025-12-10) 只读 2025-12');

resetReads();
store.buildBudgetDayDetail('2026-02-15');
setEq(readSet(), ['2026-02'], 'buildBudgetDayDetail(2026-02-15) 只读 2026-02');

console.log('== 3. 预算节奏摘要只读取涉及月份（上周一 → 本月底）==');
resetReads();
store.buildBudgetPaceSummary(TODAY);
(function () {
  const curMonday = budgetPeriod.mondayOf(TODAY);
  const lastWeekStart = budgetPeriod.addDays(curMonday, -7);
  const monthLastDay = budgetPeriod.addDays(budgetPeriod.firstOfNextMonth(TODAY), -1);
  setEq(readSet(), monthsBetween(lastWeekStart, monthLastDay), 'buildBudgetPaceSummary 月份范围正确');
})();

console.log('== 4. 月节奏上下文：当前月 / 历史月 ==');
resetReads();
store.buildBudgetMonthPace(2026, 2, TODAY);
(function () {
  const curMonday = budgetPeriod.mondayOf(TODAY);
  const lastWeekStart = budgetPeriod.addDays(curMonday, -7);
  const monthLastDay = budgetPeriod.addDays(budgetPeriod.firstOfNextMonth(TODAY), -1);
  setEq(readSet(), monthsBetween(lastWeekStart, monthLastDay), '当前月 buildBudgetMonthPace 范围正确');
})();

resetReads();
store.buildBudgetMonthPace(2025, 11, TODAY);
setEq(readSet(), ['2025-10', '2025-11'], '历史月 buildBudgetMonthPace(2025,11) 只读该月+上月');

console.log('== 5. computeBudgetByKind 各周期只读取覆盖月份 ==');
['today', 'week', 'month', 'lastweek', 'lastmonth'].forEach((kind) => {
  resetReads();
  store.computeBudgetByKind(kind, TODAY);
  const p = budgetPeriod.buildPeriod(kind, TODAY, 1);
  const lastDay = budgetPeriod.addDays(p.end, -1);
  setEq(readSet(), monthsBetween(p.start, lastDay), 'computeBudgetByKind(' + kind + ') 范围正确');
});

console.log('== 6. 自定义日期范围：rangeBills 只读取覆盖月份 ==');
resetReads();
const r = store.rangeBills('2025-09', '2026-02');
setEq(readSet(), ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'], 'rangeBills(2025-09,2026-02) 只读覆盖月份');
assert(r.length === 12, 'rangeBills 返回范围内全部 12 笔（actual=' + r.length + '）');

resetReads();
const single = store.rangeBills('2026-03', '2026-03');
setEq(readSet(), ['2026-03'], '单月范围只读该月');
assert(single.length === 2, '单月返回 2 笔（actual=' + single.length + '）');

console.log('== 7. 每个被读取分片至少读取 1 次且无无关月份（总览） ==');
const allRead = readSet();
assert(allRead.every((ym) => env0.shardReads[ym] >= 1), '所有读取记录均为正数');

console.log('\nread-range tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
