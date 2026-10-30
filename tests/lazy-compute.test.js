/**
 * tests/lazy-compute.test.js — 统计模块 Lazy Compute 行为测试（v1.3.0 Gate 3）
 *
 * 用内存 wx + mock 全局 Component 捕获 statistics-panel 定义，手动构造实例
 * 运行 loadMonth / loadYear，并对纯函数 / 预算包装做 spy 计数，验证：
 *   - 模块全关时，可选模块对应的计算函数一次都不被调用（真不计算，非仅隐藏）；
 *   - 模块全开时，对应函数被调用；
 *   - 关闭后 setData 的展示字段被清空，不残留上次结果；
 *   - Hero / 最大单笔始终计算（不在可关闭范围）。
 *
 * 运行：node tests/lazy-compute.test.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) { assert(a === b, msg + ' (expected=' + b + ', actual=' + a + ')'); }

/* ---------- 内存 wx（按月份分片记录读取） ---------- */
function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const fsm = {
    accessSync(p) { if (memFiles.has(p) || memDirs.has(p)) return; throw new Error('ENOENT ' + p); },
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
    readFileSync(p) { if (!memFiles.has(p)) throw new Error('ENOENT ' + p); return memFiles.get(p); },
    writeFileSync(p, data) { memFiles.set(p, String(data)); },
    renameSync(o, n) {
      if (!memFiles.has(o)) throw new Error('ENOENT ' + o);
      if (memFiles.has(n)) throw new Error('exists ' + n);
      memFiles.set(n, memFiles.get(o)); memFiles.delete(o);
    },
    unlinkSync(p) { if (!memFiles.has(p)) throw new Error('ENOENT ' + p); memFiles.delete(p); },
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
    wx: {
      env: { USER_DATA_PATH: '/usr' },
      getFileSystemManager: () => fsm,
      getStorageSync: () => undefined,
      setStorageSync: () => {},
    },
  };
}

global.wx = buildWx().wx;

/* ---------- mock 全局 Component，捕获组件定义 ---------- */
let captured = null;
global.Component = function (def) { captured = def; };

const store = require(path.join(ROOT, 'data', 'index'));
const M = require(path.join(ROOT, 'data', 'statistics', 'month'));
const Y = require(path.join(ROOT, 'data', 'statistics', 'year'));
const statCfg = require(path.join(ROOT, 'data', 'statistics', 'config'));

/* ---------- spy 计数 ---------- */
const calls = {};
function spy(obj, name, label) {
  const orig = obj[name];
  calls[label] = 0;
  obj[name] = function () {
    calls[label]++;
    return orig.apply(this, arguments);
  };
}
spy(M, 'computeCategoryShare', 'share');
spy(M, 'computeDailyExpenseTrend', 'daily');
spy(M, 'computeCumulativeTrend', 'cum');
spy(M, 'computeIncomeExpenseCompare', 'cmp');
spy(store, 'buildBudgetCalendar', 'bcal');
spy(store, 'buildBudgetMonthPace', 'pace');
spy(Y, 'computeMonthlyTrend', 'ymonthly');
spy(Y, 'findMostRecordedCategory', 'topcat');
spy(Y, 'findMostActiveMonth', 'topmonth');

/* require 组件（此时执行 Component() 注册，captured 被赋值） */
require(path.join(ROOT, 'components', 'statistics-panel', 'statistics-panel'));

store.init();

/* ---------- 造当月虚构账单（多分类） ---------- */
const now = new Date();
const YM = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
function ts(day) { return new Date(now.getFullYear(), now.getMonth(), day, 12, 0).getTime(); }
store.addBill({ type: 'expense', amountCents: 1000, categoryId: 'c-food', occurredAt: ts(3), title: '懒加载A' });
store.addBill({ type: 'expense', amountCents: 2000, categoryId: 'c-transport', occurredAt: ts(8), title: '懒加载B' });
store.addBill({ type: 'income', amountCents: 8000, categoryId: 'c-salary', occurredAt: ts(10), title: '工资' });

/* ---------- 构造可运行实例 ---------- */
function makeInstance() {
  const inst = {
    data: JSON.parse(JSON.stringify(captured.data)),
    triggerEvent() {},
  };
  inst.setData = function (patch) {
    Object.keys(patch).forEach((k) => { inst.data[k] = patch[k]; });
  };
  Object.keys(captured.methods).forEach((k) => {
    inst[k] = captured.methods[k].bind(inst);
  });
  return inst;
}
function resetCalls() { Object.keys(calls).forEach((k) => { calls[k] = 0; }); }

/* ================= 月度：全关 ================= */
console.log('== 1. 月度全关：可选模块函数不被调用 ==');
store.updateSettings({ statistics: { version: 1, modules: [] } });
let inst = makeInstance();
resetCalls();
inst.loadMonth(YM);
eq(calls.share, 0, '全关时 computeCategoryShare 不调用');
eq(calls.daily, 0, '全关时 computeDailyExpenseTrend 不调用');
eq(calls.cum, 0, '全关时 computeCumulativeTrend 不调用');
eq(calls.cmp, 0, '全关时 computeIncomeExpenseCompare 不调用');
eq(calls.bcal, 0, '全关时 buildBudgetCalendar 不调用');
eq(calls.pace, 0, '全关时 buildBudgetMonthPace 不调用');

// 展示字段被清空
eq(inst.data.shareList.length, 0, '全关时分类占比列表清空');
eq(inst.data.daily.length, 0, '全关时每日趋势清空');
eq(inst.data.cumPoints.length, 0, '全关时累计趋势清空');
eq(inst.data.cumMax, 0, '全关时累计 max 清零');
eq(inst.data.crStats, null, '全关时自定义日期统计清空');
eq(inst.data.budgetCalendar, null, '全关时预算日历清空');

// Hero / 最大单笔仍计算
eq(inst.data.mCount, 3, '全关时 Hero 记录数仍计算（含收入共 3 笔）');
assert(inst.data.mLargest !== null, '全关时最大单笔仍计算');
eq(inst.data.mLargest.amountText, '¥20.00', '最大单笔金额正确');

/* ================= 月度：全开 ================= */
console.log('== 2. 月度全开：可选模块函数被调用 ==');
const allOn = statCfg.VALID_MODULES.filter((id) => statCfg.MONTHLY_MODULES.indexOf(id) >= 0);
store.updateSettings({ statistics: { version: 1, modules: allOn } });
inst = makeInstance();
resetCalls();
inst.loadMonth(YM);
assert(calls.share > 0, '全开时 computeCategoryShare 被调用');
assert(calls.daily > 0, '全开时 computeDailyExpenseTrend 被调用');
assert(calls.cum > 0, '全开时 computeCumulativeTrend 被调用');
assert(calls.cmp > 0, '全开时 computeIncomeExpenseCompare 被调用');
assert(inst.data.cumPoints.length > 0, '全开时累计趋势有数据');
assert(inst.data.shareList.length > 0, '全开时分类占比列表有数据');
assert(inst.data.crStats !== null, '全开时自定义日期统计有结果');

/* ================= 单模块开关：只关分类占比 ================= */
console.log('== 3. 只关分类占比：其余模块照常计算 ==');
const withoutShare = allOn.filter((id) => id !== 'category-share');
store.updateSettings({ statistics: { version: 1, modules: withoutShare } });
inst = makeInstance();
resetCalls();
inst.loadMonth(YM);
eq(calls.share, 0, '关闭分类占比时不计算 share');
assert(calls.daily > 0, '每日趋势仍计算');
assert(calls.cmp > 0, '收支对比仍计算');
eq(inst.data.shareList.length, 0, '分类占比列表清空');
assert(inst.data.daily.length > 0, '每日趋势数据保留');

/* ================= 年度：全关 / 全开 ================= */
console.log('== 4. 年度全关：年度回顾与月趋势不计算 ==');
store.updateSettings({ statistics: { version: 1, modules: [] } });
inst = makeInstance();
inst.data.mode = 'year';
resetCalls();
inst.loadYear(now.getFullYear());
eq(calls.ymonthly, 0, '全关时年度月趋势不计算');
eq(calls.topcat, 0, '全关时记录最多分类不计算');
eq(calls.topmonth, 0, '全关时最常消费月不计算');
eq(inst.data.monthly.length, 0, '全关时年度月趋势清空');
eq(inst.data.yrTopCat, null, '全关时年度回顾分类清空');
eq(inst.data.yCount, 3, '全关时年度 Hero 记录数仍计算');

console.log('== 5. 年度全开：年度模块被调用 ==');
const yearOn = statCfg.VALID_MODULES.filter((id) => statCfg.YEARLY_MODULES.indexOf(id) >= 0);
store.updateSettings({ statistics: { version: 1, modules: yearOn } });
inst = makeInstance();
inst.data.mode = 'year';
resetCalls();
inst.loadYear(now.getFullYear());
assert(calls.ymonthly > 0, '全开时年度月趋势被调用');
assert(calls.topcat > 0, '全开时记录最多分类被调用');
assert(inst.data.monthly.length > 0, '年度月趋势有数据');

/* ================= 主题订阅：切主题重新取色、未激活不取数、detached 取消 ================= */
console.log('== 6. 主题订阅：切主题后列表颜色更新、未激活不取数、detached 取消 ==');
const theme = require(path.join(ROOT, 'utils', 'theme'));
const donut = require(path.join(ROOT, 'data', 'statistics', 'donut'));
store.updateSettings({ statistics: { version: 1, modules: allOn } });
theme._resetForTest();
theme.init();

// 月度全开，先在 dark 下加载
inst = makeInstance();
inst.data.mode = 'month';
inst.loadMonth(YM);
const darkColor = inst.data.shareList[0].color;
assert(darkColor.indexOf(donut.LIGHT_BY_THEME.dark + '%') > 0, '初始 dark 列表色明度 ' + donut.LIGHT_BY_THEME.dark + '%');

// 手动 attached：订阅主题
captured.lifetimes.attached.call(inst);
assert(typeof inst._offTheme === 'function', 'attached 后持有取消函数');

// 未激活（_activated 未设置）：切主题不提前取数
theme.setThemeMode('light');
eq(inst.data.shareList[0].color, darkColor, '未激活时切主题不提前取数');

// 激活后切回 dark 再切 light：refresh 重新取色
inst._activated = true;
theme.setThemeMode('dark');
inst.loadMonth(YM); // 确保 dark 基准
eq(inst.data.shareList[0].color, darkColor, 'dark 下颜色一致');
theme.setThemeMode('light');
const lightColor = inst.data.shareList[0].color;
const expectedLightL = donut.LIGHT_BY_THEME.light + '%';
assert(lightColor.indexOf(expectedLightL) > 0, '已激活切 light 后列表色明度 ' + expectedLightL);
assert(lightColor !== darkColor, '切主题后列表颜色确实更新');

// detached：取消订阅，之后切主题不再刷新本面板
captured.lifetimes.detached.call(inst);
eq(inst._offTheme, null, 'detached 后取消函数清空');
theme.setThemeMode('dark');
eq(inst.data.shareList[0].color, lightColor, 'detached 后切主题不再刷新本面板');

console.log('\nlazy-compute tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
