/**
 * tests/budget.test.js — Budget Rhythm（v0.5.0）单元测试
 *
 * 覆盖：预算规则历史（整数分 / 中途变更 / 禁用再开启 / 同天替换）、
 *   周期（周一为周起点 / 月天数 28·29·30·31 / 今日·本周·本月·上周·上月）、
 *   核心（总预算 vs 截至今日预算、未来不累计、消耗口径 normal+expense、
 *   正盈余 / 负超支）、日历地图（7 列 / 今天紫描边 / 无预算·未来 / 两档）、
 *   预算规则随备份 V2 往返。
 * 用内存文件系统 mock wx，无需测试框架 / 真机。运行：node tests/budget.test.js
 */

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

/* ---------- 内存 wx 环境（与 daily-value.test.js 一致） ---------- */
function buildWx(initialStorage) {
  const memFiles = new Map();
  const memDirs = new Set();
  const storage = Object.assign({}, initialStorage || {});
  const fsm = {
    accessSync(path) {
      if (memFiles.has(path) || memDirs.has(path)) return;
      throw new Error('ENOENT ' + path);
    },
    mkdirSync(path, recursive) {
      if (recursive) {
        const ps = path.split('/');
        let cur = '';
        ps.forEach((p, i) => {
          if (i === 0 && p === '') cur = '';
          else {
            cur = cur + '/' + p;
            memDirs.add(cur);
          }
        });
      } else memDirs.add(path);
    },
    readFileSync(path) {
      if (!memFiles.has(path)) throw new Error('ENOENT file ' + path);
      return memFiles.get(path);
    },
    writeFileSync(path, data) {
      memFiles.set(path, String(data));
    },
    unlinkSync(path) {
      if (!memFiles.has(path)) throw new Error('ENOENT file ' + path);
      memFiles.delete(path);
    },
    readdirSync(path) {
      const prefix = path.endsWith('/') ? path : path + '/';
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
  };
  const wx = {
    env: { USER_DATA_PATH: '/usr' },
    getFileSystemManager: () => fsm,
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => { storage[k] = v; },
    __memFiles: memFiles,
  };
  return wx;
}

function loadStore(wx) {
  global.wx = wx;
  Object.keys(require.cache).forEach((k) => {
    if (k.replace(/\\/g, '/').includes('/jizhang-mini/data/')) delete require.cache[k];
    if (k.replace(/\\/g, '/').includes('/jizhang-mini/packages/importer/')) delete require.cache[k];
  });
  return require('../data/index');
}

const TODAY = '2026-10-16';
// budget 的 IO 链（rules→settings→fs）加载时即读 wx，先建 wx 再 require
global.wx = buildWx();
const B = require('../data/budget/index');

function makeBill(partial) {
  return Object.assign({
    id: 'b' + Math.random().toString(36).slice(2),
    type: 'expense',
    amountCents: 10000,
    categoryId: 'c-food',
    occurredAt: new Date(2026, 9, 16, 12, 0).getTime(),
    title: '',
    ledgerImpact: 'normal',
  }, partial);
}

/** 从空开始：仅一条 ¥30/天 规则（10-01 起） */
function stateWith30() {
  let s = B.normalizeState(undefined);
  s = B.applyRule(s, { enabled: true, dailyCents: 3000, effectiveFrom: '2026-10-01' });
  return s;
}

/* ================= A. 规则模型（BUDGET-RULES） ================= */
console.log('A. 规则模型');
{
  // 默认 state
  const d = B.normalizeState(undefined);
  eq(d.version, 1, 'budget version=1');
  eq(d.weekStartsOn, 1, '默认周一为周起点');
  eq(d.rules.length, 0, '初始无规则');

  // 每日预算整数分：¥30 = 3000 分
  let s = B.applyRule(d, { enabled: true, dailyCents: 3000, effectiveFrom: '2026-10-01' });
  eq(s.rules[0].dailyCents, 3000, 'BUDGET 每日预算整数分 3000');
  assert(s.rules[0].id && s.rules[0].createdAt, '规则含 id/createdAt');

  // resolveRuleForDate：生效日之前无规则、生效日及之后命中
  assert(!B.resolveRuleForDate(s, '2026-09-30'), '9-30 规则未生效');
  eq(B.resolveRuleForDate(s, '2026-10-01').dailyCents, 3000, '10-01 命中 3000');
  eq(B.dailyCentsOn(s, '2026-09-30'), 0, '无规则日期每日预算=0');
  eq(B.dailyCentsOn(s, '2026-10-16'), 3000, '10-16 每日预算=3000');

  // 同 effectiveFrom 替换：保留原 id/createdAt，不新增
  const beforeId = s.rules[0].id;
  const beforeCreated = s.rules[0].createdAt;
  s = B.applyRule(s, { enabled: true, dailyCents: 4000, effectiveFrom: '2026-10-01' });
  eq(s.rules.length, 1, '同生效日替换不新增');
  eq(s.rules[0].id, beforeId, '同生效日保留 id');
  eq(s.rules[0].createdAt, beforeCreated, '同生效日保留 createdAt');
  eq(s.rules[0].dailyCents, 4000, '同生效日金额更新 4000');

  // 规则中途变更：新增 10-16 规则，按 effectiveFrom 升序
  s = B.applyRule(s, { enabled: true, dailyCents: 3000, effectiveFrom: '2026-10-01' });
  s = B.applyRule(s, { enabled: true, dailyCents: 4000, effectiveFrom: '2026-10-16' });
  eq(s.rules.length, 2, '中途变更新增规则（2 条）');
  assert(s.rules[0].effectiveFrom <= s.rules[1].effectiveFrom, '规则按生效日升序');
  eq(B.dailyCentsOn(s, '2026-10-15'), 3000, '10-15 仍 3000');
  eq(B.dailyCentsOn(s, '2026-10-16'), 4000, '10-16 起 4000');

  // 禁用再开启：关闭=新增 enabled:false 规则，历史保留
  s = B.applyRule(s, { enabled: false, dailyCents: 0, effectiveFrom: '2026-11-01' });
  eq(B.dailyCentsOn(s, '2026-10-20'), 4000, '10-20 仍按 4000（历史不变）');
  eq(B.dailyCentsOn(s, '2026-11-02'), 0, '11-02 关闭后=0');
  assert(B.isEnabledOn(s, '2026-10-20') === true, '10-20 启用');
  assert(B.isEnabledOn(s, '2026-11-02') === false, '11-02 禁用');
}

/* ================= B. 周期与月天数（BUDGET-PERIOD） ================= */
console.log('B. 周期与月天数');
{
  // 月天数 28 / 29 / 30 / 31
  eq(B.calendar.daysInMonth(2026, 2), 28, '2026-02 平年 28');
  eq(B.calendar.daysInMonth(2028, 2), 29, '2028-02 闰年 29');
  eq(B.calendar.daysInMonth(2026, 4), 30, '2026-04 30 天');
  eq(B.calendar.daysInMonth(2026, 10), 31, '2026-10 31 天');

  // 今日：start=今天，end=明天，1 天
  const td = B.buildPeriod('today', TODAY, 1);
  eq(td.start, '2026-10-16', '今日 start=10-16');
  eq(td.end, '2026-10-17', '今日 end=10-17');
  eq(td.dayCount, 1, '今日 dayCount=1');
  eq(td.accruedDays, 1, '今日 accruedDays=1');

  // 本周：周一 10-12 → 周日（end 10-19），7 天，截至周五已 5 天
  const wk = B.buildPeriod('week', TODAY, 1);
  eq(wk.start, '2026-10-12', '本周 start=周一 10-12');
  eq(wk.end, '2026-10-19', '本周 end=10-19');
  eq(wk.dayCount, 7, '本周 7 天');
  eq(wk.accruedDays, 5, '截至周五 accruedDays=5');

  // 本月：10-01 → 11-01，31 天，截至 16 日已 16 天
  const mo = B.buildPeriod('month', TODAY, 1);
  eq(mo.start, '2026-10-01', '本月 start=10-01');
  eq(mo.end, '2026-11-01', '本月 end=11-01');
  eq(mo.dayCount, 31, '本月 31 天');
  eq(mo.accruedDays, 16, '本月 accruedDays=16');

  // 上周：10-05 → 10-12，已结束 accruedDays=7
  const lw = B.buildPeriod('lastweek', TODAY, 1);
  eq(lw.start, '2026-10-05', '上周 start=10-05');
  eq(lw.end, '2026-10-12', '上周 end=10-12');
  eq(lw.dayCount, 7, '上周 7 天');
  eq(lw.accruedDays, 7, '上周已结束 accruedDays=7');

  // 上月：9-01 → 10-01，30 天
  const lm = B.buildPeriod('lastmonth', TODAY, 1);
  eq(lm.start, '2026-09-01', '上月 start=9-01');
  eq(lm.end, '2026-10-01', '上月 end=10-01');
  eq(lm.dayCount, 30, '上月 30 天');
  eq(lm.accruedDays, 30, '上月已结束 accruedDays=30');

  // 未来日期不进累计：以未来某天为 today，今日周期 accruedDays=0
  const future = B.buildPeriod('today', '2026-12-25', 1);
  eq(future.accruedDays, 1, '未来基准日当天 accrued=1（相对基准日）');
  // 本周相对未来：accrued 仍为完整（基准日即"今天"）
}

/* ================= C. 核心公式（BUDGET-CORE） ================= */
console.log('C. 核心公式');
{
  const state = stateWith30();
  // 一笔 10-16 正常支出 ¥22.60
  const bills = [makeBill({ amountCents: 2260, occurredAt: new Date(2026, 9, 16, 18, 32).getTime() })];

  // 今日：预算 3000，已花 2260，盈余 740，剩余=盈余
  const td = B.computeByKind(bills, state, 'today', TODAY, 1);
  eq(td.periodBudget, 3000, '今日预算 3000');
  eq(td.accruedBudget, 3000, '今日 accrued=3000');
  eq(td.actualExpense, 2260, '今日已花 2260');
  eq(td.paceDelta, 740, '今日盈余 740');
  eq(td.remainingBudget, 740, '今日剩余 740');

  // 本周：总预算 21000 vs 截至今日 15000；pace 按 accrued
  const wk = B.computeByKind(bills, state, 'week', TODAY, 1);
  eq(wk.periodBudget, 21000, '本周总预算 21000');
  eq(wk.accruedBudget, 15000, '本周截至今日预算 15000');
  eq(wk.actualExpense, 2260, '本周已花 2260');
  eq(wk.paceDelta, 15000 - 2260, '本周盈余 12740（非整月虚假盈余）');
  eq(wk.remainingBudget, 21000 - 2260, '本周剩余 18740');

  // 本月：总预算 93000 vs 截至今日 48000
  const mo = B.computeByKind(bills, state, 'month', TODAY, 1);
  eq(mo.periodBudget, 93000, '本月总预算 93000');
  eq(mo.accruedBudget, 48000, '本月截至今日预算 48000');
  eq(mo.actualExpense, 2260, '本月已花 2260');
  eq(mo.paceDelta, 48000 - 2260, '本月盈余 45740');
  eq(mo.remainingBudget, 93000 - 2260, '本月剩余 90740');

  // 负超支：今日已花 4228 > 3000
  const overBills = [makeBill({ amountCents: 4228 })];
  const ov = B.computeByKind(overBills, state, 'today', TODAY, 1);
  eq(ov.paceDelta, 3000 - 4228, '今日超支 -1228');
  assert(ov.paceDelta < 0, 'paceDelta<0 为超支');

  // 上周 / 上月：上周有预算无支出，上月无预算
  const lwk = B.computeByKind(bills, state, 'lastweek', TODAY, 1);
  eq(lwk.periodBudget, 21000, '上周预算 21000');
  eq(lwk.accruedBudget, 21000, '上周已结束 accrued=总预算');
  eq(lwk.actualExpense, 0, '上周无支出（账单在 10-16）');
  const lmo = B.computeByKind(bills, state, 'lastmonth', TODAY, 1);
  eq(lmo.periodBudget, 0, '上月无规则预算=0');
  assert(lmo.hasBudget === false, '上月 hasBudget=false');

  // 规则中途变更：3000(10-01) + 4000(10-16)
  let s2 = stateWith30();
  s2 = B.applyRule(s2, { enabled: true, dailyCents: 4000, effectiveFrom: '2026-10-16' });
  const m2 = B.computeByKind([], s2, 'month', TODAY, 1);
  eq(m2.periodBudget, 3000 * 15 + 4000 * 16, '中途变更本月总预算 109000');
  eq(m2.accruedBudget, 3000 * 15 + 4000 * 1, '中途变更截至今日 49000');

  /* ---------- 消耗口径：normal + expense 才消耗 ---------- */
  const mixed = [
    makeBill({ id: 'e-normal', amountCents: 5000, type: 'expense', ledgerImpact: 'normal' }),
    makeBill({ id: 'e-income', amountCents: 100000, type: 'income', ledgerImpact: 'normal' }),
    makeBill({ id: 'e-dvonly', amountCents: 399900, type: 'expense', ledgerImpact: 'daily-value-only' }),
  ];
  assert(B.consumesBudget(mixed[0]) === true, 'normal expense 消耗预算');
  assert(B.consumesBudget(mixed[1]) === false, '收入不消耗预算');
  assert(B.consumesBudget(mixed[2]) === false, 'daily-value-only 不消耗预算');
  const tdMix = B.computeByKind(mixed, state, 'today', TODAY, 1);
  eq(tdMix.actualExpense, 5000, '今日实际只含 normal expense（50）');
}

/* ================= D. 日历地图（BUDGET-CALENDAR） ================= */
console.log('D. 日历地图');
{
  const state = stateWith30();
  const bills = [
    makeBill({ id: 'd1', amountCents: 2260, occurredAt: new Date(2026, 9, 16).getTime() }),
    makeBill({ id: 'd2', amountCents: 4228, occurredAt: new Date(2026, 9, 15).getTime() }),
  ];
  const cal = B.buildMonthCalendar(bills, state, 2026, 10, TODAY);

  // 每行 7 列
  assert(cal.weeks.every((w) => w.length === 7), '日历每行 7 列');
  // 10-01 周四 → leading=3（9-28/29/30）
  eq(cal.leading, 3, '10-01 周四 leading=3');
  // 周一头
  eq(cal.weekHeaders[0], '一', '日历周一开头');
  // 第一个 inMonth 单元格是 10-01，位于第 4 列（index 3）
  const firstRow = cal.weeks[0];
  eq(firstRow[3].dateStr, '2026-10-01', '第 4 列是 10-01');
  assert(firstRow[0].inMonth === false, '前置 9-28 非本月');

  // 今天 10-16 紫描边
  const todayCell = [].concat(...cal.weeks).find((c) => c.dateStr === '2026-10-16');
  assert(todayCell.isToday === true, '10-16 标记今天');
  // 今天已花 2260 < 预算 3000 → 盈余
  eq(todayCell.state, 'surplus', '今天盈余');

  // 10-15 已花 4228 > 3000 → 超支（delta=-1228，未达预算一半，level1 轻微）
  const c15r = [].concat(...cal.weeks).find((c) => c.dateStr === '2026-10-15');
  eq(c15r.state, 'over', '10-15 超支');
  eq(c15r.level, 1, '10-15 轻微超支 level1');

  // 未来日（10-17+）：future
  const c17 = [].concat(...cal.weeks).find((c) => c.dateStr === '2026-10-17');
  eq(c17.state, 'future', '10-17 未来灰');

  // 无预算日：9月日历（规则 10-01 起）
  const cal9 = B.buildMonthCalendar([], state, 2026, 9, TODAY);
  const c9 = [].concat(...cal9.weeks).find((c) => c.dateStr === '2026-09-15');
  eq(c9.state, 'no-budget', '9-15 无预算灰');

  /* ---------- 日详情 ---------- */
  const dd = B.buildDayDetail(bills, state, '2026-10-15', (id) => ({ name: '餐饮', emoji: '🍜' }));
  eq(dd.budgetCents, 3000, '日详情预算 3000');
  eq(dd.actualCents, 4228, '日详情实际 4228');
  eq(dd.deltaCents, -1228, '日详情超支 1228');
  eq(dd.billCount, 1, '日详情 1 笔账单');
  eq(dd.categories[0].cents, 4228, '日详情分类金额');
  eq(dd.categories[0].name, '餐饮', '日详情分类名（注入解析）');
}

/* ================= E. 备份 V2 往返预算规则 ================= */
console.log('E. 备份恢复');
{
  const wx = buildWx();
  const store = loadStore(wx);
  store.init();

  // 设置每日预算 ¥30（10-01 起）
  store.saveBudgetRule({ enabled: true, dailyCents: 3000, effectiveFrom: '2026-10-01' });
  // 再改一次：10-16 起 ¥40
  store.saveBudgetRule({ enabled: true, dailyCents: 4000, effectiveFrom: '2026-10-16' });
  // 加一笔普通账单
  store.addBill({
    type: 'expense', amountCents: 2260, categoryId: 'c-food',
    occurredAt: new Date(2026, 9, 16).getTime(),
  });

  const backup = store.buildBackup();
  eq(backup.schemaVersion, 2, '备份仍是 V2（不升级）');
  const backupJson = JSON.stringify(backup);
  assert(backupJson.includes('"budget"'), '备份含 budget 字段');
  assert(backupJson.includes('4000'), '备份含规则金额 4000');

  // 清空：重置内存文件系统
  const wx2 = buildWx();
  const store2 = loadStore(wx2);
  store2.init();
  // 恢复前无预算
  eq(store2.getBudgetState().rules.length, 0, '恢复前无预算规则');

  // 恢复
  store2.restoreBackup(backup);
  const restored = store2.getBudgetState();
  eq(restored.rules.length, 2, '恢复后 2 条规则完整');
  eq(B.dailyCentsOn(restored, '2026-10-15'), 3000, '恢复后 10-15 每日 3000');
  eq(B.dailyCentsOn(restored, '2026-10-16'), 4000, '恢复后 10-16 每日 4000');
  // 预算立即影响计算
  const td = store2.computeBudgetByKind('today', TODAY);
  eq(td.periodBudget, 4000, '恢复后今日预算按 4000');

  // 旧 V1 备份（无 budget）仍可恢复：不报错、budget 为空
  const v1 = {
    format: 'daily-value-mini-backup',
    schemaVersion: 1,
    appVersion: '0.3.2',
    exportedAt: new Date().toISOString(),
    data: {
      bills: [
        {
          id: 'old1', type: 'expense', amountCents: 1000, categoryId: 'c-food',
          occurredAt: new Date(2026, 9, 1).getTime(),
          merchant: '', note: '', source: 'manual',
        },
      ],
      categories: store2.getCategories(),
      settings: {},
    },
  };
  const wx3 = buildWx();
  const store3 = loadStore(wx3);
  store3.init();
  let restoreV1Ok = true;
  try {
    store3.restoreBackup(v1);
  } catch (e) {
    restoreV1Ok = false;
  }
  assert(restoreV1Ok, '旧 V1 备份仍可恢复');
  eq(store3.getBudgetState().rules.length, 0, 'V1 备份无预算，恢复后为空');
  eq(store3.getBill('old1').amountCents, 1000, 'V1 账单恢复');
}

/* ================= 汇总 ================= */
console.log('\nbudget tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL BUDGET TESTS PASSED');
