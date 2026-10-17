/**
 * tests/recurring.test.js — 周期记账（v0.6.0 Gate B/C/D）单元测试
 *
 * 覆盖：四种频率与每 N、月末钳制（31→28/30，2-29 非闰年→28）、确定性 Bill id、
 *   生成器幂等（重复运行 / 连续 onShow 不重复）、catch-up 与 365 上限、
 *   删除自动账单不复活、编辑只影响未来、删除规则保留历史、
 *   停用不生成 / 重启用不补停用期间、收入周期、周期账单口径（normal 进统计）、
 *   Backup V3 往返。
 * 内存文件系统 mock wx，注入固定 now 保证确定。运行：node tests/recurring.test.js
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

/* ---------- 内存 wx 环境 ---------- */
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
const store = require(path.join(ROOT, 'data', 'index'));
const core = store.recurring.core;

function freshStore() {
  global.wx = buildWx();
  store.init();
  return store;
}

function at(y, m, d, hh, mm) {
  return new Date(y, m - 1, d, hh || 12, mm || 0, 0, 0);
}

function billId(ruleId, dateStr, time) {
  return core.recurringBillId(ruleId, dateStr, time || '00:00');
}

/* ================= A. 纯日期函数 ================= */
console.log('A. 纯日期函数');
{
  // daily
  const daily = { frequency: 'daily', interval: 1, startDate: '2026-10-01', day: 1 };
  eq(core.occurrenceDate(daily, 0), '2026-10-01', 'daily occ0');
  eq(core.occurrenceDate(daily, 1), '2026-10-02', 'daily occ1');

  // weekly：周五 start，day=1 周一 → 首个周一 10-19
  const weekly = { frequency: 'weekly', interval: 1, startDate: '2026-10-16', day: 1 };
  eq(core.occurrenceDate(weekly, 0), '2026-10-19', 'weekly occ0=周一 10-19');
  eq(core.occurrenceDate(weekly, 1), '2026-10-26', 'weekly occ1');

  // monthly：day=15
  const monthly = { frequency: 'monthly', interval: 1, startDate: '2026-10-01', day: 15 };
  eq(core.occurrenceDate(monthly, 0), '2026-10-15', 'monthly occ0');
  eq(core.occurrenceDate(monthly, 1), '2026-11-15', 'monthly occ1');

  // 每 2 周
  const w2 = { frequency: 'weekly', interval: 2, startDate: '2026-10-19', day: 1 };
  eq(core.occurrenceDate(w2, 0), '2026-10-19', 'biweekly occ0');
  eq(core.occurrenceDate(w2, 1), '2026-11-02', 'biweekly occ1（隔 2 周）');

  // 每 3 月
  const m3 = { frequency: 'monthly', interval: 3, startDate: '2026-01-10', day: 10 };
  eq(core.occurrenceDate(m3, 0), '2026-01-10', 'quarterly occ0');
  eq(core.occurrenceDate(m3, 1), '2026-04-10', 'quarterly occ1');

  // 31 号月末钳制：1-31 → 2-28 → 4-30
  const m31 = { frequency: 'monthly', interval: 1, startDate: '2026-01-31', day: 31 };
  eq(core.occurrenceDate(m31, 0), '2026-01-31', 'day31 occ0=1-31');
  eq(core.occurrenceDate(m31, 1), '2026-02-28', 'day31 2 月→28');
  eq(core.occurrenceDate(m31, 3), '2026-04-30', 'day31 4 月→30');

  // yearly 2-29：2026 平年→2-28；2028 闰年→2-29
  const y29 = { frequency: 'yearly', interval: 1, startDate: '2026-01-01', day: 29, month: 2 };
  eq(core.occurrenceDate(y29, 0), '2026-02-28', 'yearly 2-29 平年→2-28');
  eq(core.occurrenceDate(y29, 2), '2028-02-29', 'yearly 2-29 闰年→2-29');

  // daysInMonth / isLeapYear
  eq(core.daysInMonth(2026, 2), 28, 'daysInMonth 2026-02=28');
  eq(core.daysInMonth(2028, 2), 29, 'daysInMonth 2028-02=29');
  eq(core.daysInMonth(2026, 4), 30, 'daysInMonth 4 月=30');
  eq(core.isLeapYear(2028), true, '2028 闰年');
  eq(core.isLeapYear(2026), false, '2026 平年');

  // 确定性 Bill id
  eq(core.recurringBillId('r1', '2026-11-01', '09:00'), 'recur-r1-2026-11-01-09:00', '确定性 id 格式');
}

/* ================= B. 生成器 catch-up 与幂等 ================= */
console.log('B. 生成器 catch-up 与幂等');
{
  const s = freshStore();
  const rule = s.recurring.createRule({
    type: 'expense',
    amountCents: 1000,
    categoryId: 'c-food',
    note: '早餐',
    frequency: 'daily',
    interval: 1,
    day: 1,
    startDate: '2026-10-01',
    time: '00:00',
  });

  // now=10-16 12:00 → 生成 10-01~10-16（16 条）
  const r1 = s.recurring.generateDueBills(at(2026, 10, 16, 12));
  eq(r1.totalGenerated, 16, 'catch-up 生成 16 条');
  eq(s.rangeBills().length, 16, '账本 16 条');

  // 确定性 id：首条 id 正确
  assert(s.getBill(billId(rule.id, '2026-10-01')), '首条账单 id 正确');

  // 重复运行：不新增（幂等）
  const r2 = s.recurring.generateDueBills(at(2026, 10, 16, 12));
  eq(r2.totalGenerated, 0, '重复运行不新增');

  // 连续多次触发（模拟 onShow）：仍不新增
  s.recurring.generateDueBills(at(2026, 10, 16, 12));
  s.recurring.generateDueBills(at(2026, 10, 16, 12));
  eq(s.rangeBills().length, 16, '连续 onShow 不重复');

  // nextOccurrence：游标里记为 10-17
  const stored = s.recurring.getRule(rule.id);
  eq(stored.nextOccurrence, '2026-10-17', 'nextOccurrence=10-17');
  eq(stored.lastGeneratedDate, '2026-10-16', 'lastGeneratedDate=10-16');

  // 周期账单字段
  const first = s.getBill(billId(rule.id, '2026-10-01'));
  eq(first.source, 'recurring', 'source=recurring');
  eq(first.ledgerImpact, 'normal', 'ledgerImpact=normal');
  eq(first.recurringRuleId, rule.id, 'recurringRuleId 挂规则');
  eq(first.type, 'expense', '支出类型');
}

/* ================= C. 删除自动账单不复活 ================= */
console.log('C. 删除不复活');
{
  const s = freshStore();
  const rule = s.recurring.createRule({
    type: 'expense',
    amountCents: 1000,
    categoryId: 'c-food',
    frequency: 'daily',
    interval: 1,
    day: 1,
    startDate: '2026-10-01',
    time: '00:00',
  });
  s.recurring.generateDueBills(at(2026, 10, 16, 12));

  // 手工删除 10-05 这条
  const id05 = billId(rule.id, '2026-10-05');
  s.deleteBill(id05);
  assert(!s.getBill(id05), '10-05 已删除');

  // 再跑 generator：10-05 不复活（游标 lastGeneratedDate=10-16）
  s.recurring.generateDueBills(at(2026, 10, 16, 12));
  assert(!s.getBill(id05), '删除后不复活');
  eq(s.rangeBills().length, 15, '账单仍 15 条');
}

/* ================= D. 编辑只影响未来 ================= */
console.log('D. 编辑只影响未来');
{
  const s = freshStore();
  const rule = s.recurring.createRule({
    type: 'expense',
    amountCents: 1000,
    categoryId: 'c-food',
    frequency: 'daily',
    interval: 1,
    day: 1,
    startDate: '2026-10-01',
    time: '00:00',
  });
  // 第一次：生成到 10-10
  s.recurring.generateDueBills(at(2026, 10, 10, 12));
  eq(s.rangeBills().length, 10, '首次生成 10 条 amount=1000');

  // 编辑：金额 1000→2000，编辑边界=10-10 12:00
  s.recurring.editRule(rule.id, {
    amountCents: 2000,
    scheduleEffectiveAt: at(2026, 10, 10, 12).getTime(),
  });

  // 再跑到 10-16
  s.recurring.generateDueBills(at(2026, 10, 16, 12));
  eq(s.rangeBills().length, 16, '补生成到 16 条');

  // 历史账单仍是旧金额
  eq(s.getBill(billId(rule.id, '2026-10-05')).amountCents, 1000, '历史账单金额不变 1000');
  // 新 occurrence 用新金额
  eq(s.getBill(billId(rule.id, '2026-10-12')).amountCents, 2000, '新账单用新金额 2000');
}

/* ================= E. 删除规则保留历史 ================= */
console.log('E. 删除规则保留历史');
{
  const s = freshStore();
  const rule = s.recurring.createRule({
    type: 'expense',
    amountCents: 1000,
    categoryId: 'c-food',
    frequency: 'daily',
    interval: 1,
    day: 1,
    startDate: '2026-10-01',
    time: '00:00',
  });
  s.recurring.generateDueBills(at(2026, 10, 16, 12));
  eq(s.rangeBills().length, 16, '生成 16 条');

  // 删除规则
  s.recurring.deleteRule(rule.id);
  eq(s.recurring.getRules().length, 0, '规则已删除');
  // 已生成账单全部保留
  eq(s.rangeBills().length, 16, '删除规则后历史账单保留');
}

/* ================= F. 停用不生成 / 重启用不补停用期间 ================= */
console.log('F. 停用与重启用');
{
  const s = freshStore();
  const rule = s.recurring.createRule({
    type: 'expense',
    amountCents: 1000,
    categoryId: 'c-food',
    frequency: 'daily',
    interval: 1,
    day: 1,
    startDate: '2026-10-01',
    time: '00:00',
  });
  // 生成到 10-10
  s.recurring.generateDueBills(at(2026, 10, 10, 12));

  // 停用
  s.recurring.editRule(rule.id, { enabled: false });
  s.recurring.generateDueBills(at(2026, 10, 12, 12));
  eq(s.rangeBills().length, 10, '停用期间不生成（10-11/12 无）');
  assert(!s.getBill(billId(rule.id, '2026-10-11')), '停用首日 10-11 无账单');

  // 重新启用：边界 10-13 00:00（模拟 setRuleEnabled 在 10-13）
  s.recurring.editRule(rule.id, {
    enabled: true,
    scheduleEffectiveAt: at(2026, 10, 13, 0, 0).getTime(),
  });
  s.recurring.generateDueBills(at(2026, 10, 16, 12));
  // 不补 10-11~10-13；只生成 10-14~10-16（3 条）
  assert(!s.getBill(billId(rule.id, '2026-10-11')), '重启用不补 10-11');
  assert(!s.getBill(billId(rule.id, '2026-10-13')), '重启用不补边界 10-13');
  assert(s.getBill(billId(rule.id, '2026-10-14')), '重启用后 10-14 起生成');
  eq(s.rangeBills().length, 13, '总账单 13（10+3）');
}

/* ================= G. 收入周期 + 周期支出口径 ================= */
console.log('G. 收入周期与口径');
{
  const s = freshStore();
  const income = s.recurring.createRule({
    type: 'income',
    amountCents: 400000,
    categoryId: 'c-salary',
    frequency: 'monthly',
    interval: 1,
    day: 1,
    startDate: '2026-10-01',
    time: '09:00',
  });
  s.recurring.generateDueBills(at(2026, 10, 16, 12));
  const sal = s.getBill(core.recurringBillId(income.id, '2026-10-01', '09:00'));
  eq(sal.type, 'income', '收入周期生成 income');
  // 收入进月度收入
  eq(s.monthSummary('2026-10').income, 400000, '周期收入进月度收入');

  // 周期支出进月度支出（normal + expense）
  const exp = s.recurring.createRule({
    type: 'expense',
    amountCents: 200000,
    categoryId: 'c-housing',
    frequency: 'monthly',
    interval: 1,
    day: 1,
    startDate: '2026-10-01',
    time: '09:00',
  });
  s.recurring.generateDueBills(at(2026, 10, 16, 12));
  eq(s.monthSummary('2026-10').expense, 200000, '周期支出进月度支出');
}

/* ================= H. catch-up 365 上限 ================= */
console.log('H. catch-up 上限');
{
  const s = freshStore();
  s.recurring.createRule({
    type: 'expense',
    amountCents: 100,
    categoryId: 'c-food',
    frequency: 'daily',
    interval: 1,
    day: 1,
    startDate: '2024-01-01',
    time: '00:00',
  });
  const r = s.recurring.generateDueBills(at(2026, 10, 16, 12));
  eq(r.totalGenerated, 365, '单次最多生成 365 条');
  eq(r.diagnosedRules, 1, '未追上，标记诊断');
  // 生成的是最早的 365 天（2024-01-01 ~ 2024-12-31）
  assert(s.getBill(billId(r.diagnostics[0].ruleId || s.recurring.getRules()[0].id, '2024-01-01')), '从最早开始补齐');
}

/* ================= I. Backup V3 往返 ================= */
console.log('I. Backup V3 往返');
{
  let s = freshStore();
  const rule = s.recurring.createRule({
    type: 'expense',
    amountCents: 200000,
    categoryId: 'c-housing',
    note: '房租',
    frequency: 'monthly',
    interval: 1,
    day: 1,
    startDate: '2026-10-01',
    time: '09:00',
  });
  const bk = s.buildBackup();
  eq(bk.schemaVersion, 3, '备份 schemaVersion=3');
  eq(bk.data.recurringRules.length, 1, '备份含 1 条周期规则');
  const savedId = rule.id;

  // 全新空库恢复
  s = freshStore();
  eq(s.recurring.getRules().length, 0, '新库无规则');
  s.restoreBackup(bk);
  eq(s.recurring.getRules().length, 1, '恢复后规则回来');
  const restored = s.recurring.getRule(savedId);
  assert(restored, '同 id 规则恢复');
  eq(restored.amountCents, 200000, '恢复规则金额一致');
  eq(restored.frequency, 'monthly', '恢复规则频率一致');
  eq(restored.categoryId, 'c-housing', '恢复规则分类一致');
}

/* ================= J. 规则校验与损坏数据隔离（v0.6.1） ================= */
console.log('J. 规则校验与损坏数据隔离');
{
  // weekly 星期语义：0=周日…6=周六（与 JS getDay 一致），2026-10-16 为周五
  const wsun = { frequency: 'weekly', interval: 1, startDate: '2026-10-16', day: 0 };
  eq(core.occurrenceDate(wsun, 0), '2026-10-18', 'weekly day=0 → 周日 10-18');
  const wsat = { frequency: 'weekly', interval: 1, startDate: '2026-10-16', day: 6 };
  eq(core.occurrenceDate(wsat, 0), '2026-10-17', 'weekly day=6 → 周六 10-17');
  const w2sun = { frequency: 'weekly', interval: 2, startDate: '2026-10-18', day: 0 };
  eq(core.occurrenceDate(w2sun, 1), '2026-11-01', '每 2 周·周日 occ1=11-01');

  // isValidDateStr 真实日历日期
  eq(core.isValidDateStr('2026-10-16'), true, '合法日期');
  eq(core.isValidDateStr('2028-02-29'), true, '闰年 2-29');
  eq(core.isValidDateStr('2026-02-29'), false, '平年 2-29 非法');
  eq(core.isValidDateStr('2026-02-30'), false, '2-30 非法');
  eq(core.isValidDateStr('2026-13-01'), false, '13 月非法');
  eq(core.isValidDateStr('2026-1-1'), false, '未补零非法');
  eq(core.isValidDateStr('2026-10-16 09:00'), false, '含时间非法');
  eq(core.isValidDateStr(''), false, '空串非法');
  eq(core.isValidDateStr(null), false, 'null 非法');

  // validateRecurringRule
  const okRule = {
    frequency: 'daily', interval: 1, startDate: '2026-10-01',
    amountCents: 1000, day: 1, time: '09:00',
  };
  eq(core.validateRecurringRule(okRule).ok, true, '合法规则通过');
  eq(core.validateRecurringRule(Object.assign({}, okRule, { startDate: '2026-02-30' })).reason, 'invalid-start-date', '非法 startDate');
  eq(core.validateRecurringRule(Object.assign({}, okRule, { amountCents: 0 })).reason, 'invalid-amount', '0 金额');
  eq(core.validateRecurringRule(Object.assign({}, okRule, { amountCents: -5 })).reason, 'invalid-amount', '负金额');
  eq(core.validateRecurringRule(Object.assign({}, okRule, { amountCents: NaN })).reason, 'invalid-amount', 'NaN 金额');
  eq(core.validateRecurringRule(Object.assign({}, okRule, { interval: 0 })).reason, 'invalid-interval', 'interval=0');
  eq(core.validateRecurringRule(Object.assign({}, okRule, { frequency: 'hourly' })).reason, 'invalid-frequency', '非法 frequency');
  eq(core.validateRecurringRule({ frequency: 'weekly', interval: 1, startDate: '2026-10-18', day: 0, amountCents: 1 }).ok, true, 'weekly day=0 合法');
  eq(core.validateRecurringRule({ frequency: 'weekly', interval: 1, startDate: '2026-10-18', day: 6, amountCents: 1 }).ok, true, 'weekly day=6 合法');
  eq(core.validateRecurringRule({ frequency: 'weekly', interval: 1, startDate: '2026-10-18', day: 7, amountCents: 1 }).reason, 'invalid-day', 'weekly day=7 非法');
  eq(core.validateRecurringRule({ frequency: 'monthly', interval: 1, startDate: '2026-10-01', day: 31, amountCents: 1 }).ok, true, 'monthly day=31 合法（月末钳制）');
  eq(core.validateRecurringRule({ frequency: 'monthly', interval: 1, startDate: '2026-10-01', day: 0, amountCents: 1 }).reason, 'invalid-day', 'monthly day=0 非法');
  eq(core.validateRecurringRule({ frequency: 'yearly', interval: 1, startDate: '2026-10-01', day: 15, month: 13, amountCents: 1 }).reason, 'invalid-month', 'yearly month=13 非法');
  eq(core.validateRecurringRule({ frequency: 'yearly', interval: 1, startDate: '2026-10-16', day: 16, amountCents: 1 }).ok, true, 'yearly month 缺省合法（回退 startDate 月）');

  // 损坏规则进入生成器：跳过，不生成、不产生 NaN 日期 / 异常账单
  const s = freshStore();
  s.recurring.replaceAllRules([
    { id: 'bad-date', enabled: true, type: 'expense', amountCents: 1000, categoryId: 'c-food', frequency: 'daily', interval: 1, startDate: '2026-02-30', time: '09:00' },
    { id: 'zero-amt', enabled: true, type: 'expense', amountCents: 0, categoryId: 'c-food', frequency: 'daily', interval: 1, startDate: '2026-10-01', time: '09:00' },
    { id: 'good', enabled: true, type: 'expense', amountCents: 500, categoryId: 'c-food', frequency: 'daily', interval: 1, startDate: '2026-10-16', time: '09:00' },
  ]);
  const res = s.recurring.generateDueBills(at(2026, 10, 16, 12));
  eq(res.corruptRules, 2, '2 条损坏规则被标记');
  eq(res.totalGenerated, 1, '仅合法规则生成 1 条');
  eq(s.rangeBills().length, 1, '账本只有 1 条，无 NaN / 异常账单');
  assert(!s.getBill(billId('bad-date', '2026-02-30')), '坏日期规则无账单');

  // 单条规则生成异常：隔离，不影响其他规则，generateDueBills 不向上抛
  const ledger = require(path.join(ROOT, 'data', 'ledger'));
  const origAdd = ledger.addBill;
  ledger.addBill = function () {
    throw new Error('mock IO failure');
  };
  let threw = false;
  let isolated;
  try {
    isolated = s.recurring.generateDueBills(at(2026, 10, 17, 12));
  } catch (e) {
    threw = true;
  }
  ledger.addBill = origAdd;
  eq(threw, false, '单规则 IO 异常不向上抛');
  eq(isolated.failedRules, 1, '失败规则计数 1（good 规则）');
}

/* ================= K. 编辑后立即重算 nextOccurrence + 停用游标保留（v0.6.1） ================= */
console.log('K. 编辑后立即重算 / 停用游标保留');
{
  const s = freshStore();
  s.recurring.createRule({
    id: 'rent', enabled: true, type: 'expense', amountCents: 200000, categoryId: 'c-housing',
    frequency: 'monthly', interval: 1, day: 1, startDate: '2026-10-01', time: '09:00',
  });
  // 今天 10-16，1 日已过 → 下次 11-01
  s.recurring.generateDueBills(at(2026, 10, 16, 12));
  eq(s.recurring.getRule('rent').nextOccurrence, '2026-11-01', '初始下次 11-01');

  // 编辑为每月 20 日（未来）+ scheduleEffectiveAt=now；保存后立即重算 → 下次 10-20（不等 onShow）
  s.recurring.editRule('rent', { day: 20, scheduleEffectiveAt: at(2026, 10, 16, 12).getTime() });
  s.recurring.generateDueBills(at(2026, 10, 16, 12));
  eq(s.recurring.getRule('rent').nextOccurrence, '2026-10-20', '编辑后下次立即变 10-20');

  // 停用：enabled=false，nextOccurrence 游标保留（UI 显示「已停用」，恢复后可重算）
  s.recurring.setRuleEnabled('rent', false);
  const off = s.recurring.getRule('rent');
  eq(off.enabled, false, '已停用');
  assert(off.nextOccurrence === '2026-10-20', '停用后 nextOccurrence 游标保留');
}

/* ================= L. countDueForRule 补记预估（v0.6.1） ================= */
console.log('L. countDueForRule 补记预估');
{
  const s = freshStore();
  const base = { type: 'expense', amountCents: 100, categoryId: 'c-food', frequency: 'daily', interval: 1, time: '00:00' };
  // 10-01 ~ 10-16（每天 00:00，均 <= 10-16 12:00）→ 16 笔，未截断
  const d1 = s.recurring.countDueForRule(Object.assign({}, base, { startDate: '2026-10-01' }), at(2026, 10, 16, 12));
  eq(d1.count, 16, '预估补记 16 笔');
  eq(d1.truncated, false, '未截断');
  // 开始于两年前 → 远超 365，截断在 365
  const d2 = s.recurring.countDueForRule(Object.assign({}, base, { startDate: '2024-01-01' }), at(2026, 10, 16, 12));
  eq(d2.count, 365, '截断在 365');
  eq(d2.truncated, true, '标记 truncated');
  // 未来开始 → 0 笔
  const d3 = s.recurring.countDueForRule(Object.assign({}, base, { startDate: '2026-11-01' }), at(2026, 10, 16, 12));
  eq(d3.count, 0, '未来开始 0 笔');
  eq(d3.truncated, false, '未来不截断');
  // 非法规则 → invalid，不计数
  const d4 = s.recurring.countDueForRule(Object.assign({}, base, { startDate: '2026-13-99' }), at(2026, 10, 16, 12));
  eq(d4.invalid, true, '非法规则 invalid');
  eq(d4.count, 0, '非法规则不计数');
}

/* ================= M. runRecurringGenerator 整体异常不 reject（v0.6.1，异步） ================= */
{
  const s = freshStore();
  s.recurring.createRule({
    type: 'expense', amountCents: 100, categoryId: 'c-food',
    frequency: 'daily', interval: 1, startDate: '2026-10-16', time: '09:00',
  });
  const rstore = s.recurring.store;
  const origGetRules = rstore.getRules;
  global.__v061AsyncChecks = global.__v061AsyncChecks || [];
  global.__v061AsyncChecks.push(
    (async () => {
      // 模拟 recurring.json 损坏导致 getRules 抛错
      rstore.getRules = function () {
        throw new Error('corrupt recurring.json');
      };
      try {
        const result = await s.recurring.runRecurringGenerator(at(2026, 10, 17, 12));
        assert(result && typeof result.fatalError === 'string', '整体异常时 resolve 带 fatalError，不 reject');
      } catch (e) {
        assert(false, 'runRecurringGenerator 绝不 reject');
      } finally {
        rstore.getRules = origGetRules;
      }
    })()
  );
}

/* ================= 汇总 ================= */
const asyncChecks = global.__v061AsyncChecks || [];
Promise.all(asyncChecks).then(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
  process.exit(0);
});
