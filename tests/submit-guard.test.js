/**
 * tests/submit-guard.test.js — v1.4.0 P1-01 / P2-02 / P2-04
 *
 * 验证点（全部为 Node 单测实证，不含真机结论）：
 *   A. utils/submit-guard.js 的 begin/end/busy 语义；
 *   B. 四处保存入口（记账 / 日价 / 周期 / 预算）连点两次只落库一次；
 *   C. 失败路径必须解锁（第一次抛错后第二次仍能保存）—— P2-02 同源；
 *   D. 周期间隔：输入过程中不夹取（输 5 不跳变）、失焦/完成/保存前夹取到 1–999 —— P2-04；
 *   E. 静态契约：四处都接同一份 guard，预算页不再有手写 _saving。
 *
 * 运行：node tests/submit-guard.test.js
 */
'use strict';

const fs = require('fs');
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
  assert(a === b, msg + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）');
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ==================== A. guard 本身 ==================== */
console.log('submit-guard：begin / end / busy');
const { createSubmitGuard } = require(path.join(ROOT, 'utils', 'submit-guard.js'));
{
  const g = createSubmitGuard();
  eq(g.busy(), false, '初始空闲');
  eq(g.begin(), true, '首次 begin 成功');
  eq(g.busy(), true, '占用中 busy 为真');
  eq(g.begin(), false, '占用期间再次 begin 被拒绝');
  g.end();
  eq(g.busy(), false, 'end 后释放');
  eq(g.begin(), true, '释放后可再次占用');
  const g2 = createSubmitGuard();
  eq(g2.busy(), false, '两个 guard 互不影响（工厂每次返回新实例）');
}

/* ==================== 环境替身 ==================== */
const calls = { addBill: 0, updateBill: 0, createRule: 0, editRule: 0, saveBudgetRule: 0 };
const toasts = [];
let throwOn = null; // 形如 'addBill' / 'saveBudgetRule'：命中时抛一次

function maybeThrow(name) {
  if (throwOn === name) {
    throwOn = null; // 只抛一次，便于验证「失败后还能再保存」
    throw new Error('disk full (stub)');
  }
}

global.wx = {
  env: { USER_DATA_PATH: '/usr' },
  hideKeyboard(opts) {
    if (opts && typeof opts.complete === 'function') opts.complete();
  },
  showModal(opts) {
    // 默认「取消」；测试可按需改写
    if (opts && typeof opts.success === 'function') opts.success({ confirm: false, cancel: true });
  },
  showToast(opts) {
    toasts.push((opts && opts.title) || '');
  },
  navigateBack() {},
};

const realCore = require(path.join(ROOT, 'data', 'recurring', 'core.js'));
const fakeStore = {
  getActiveCategories() {
    return [{ id: 'c-food', name: '餐饮', sort: 1 }];
  },
  getCategory(id) {
    return { id: id || 'c-food', name: '餐饮', sort: 1, emoji: '🍚' };
  },
  getCategories() {
    return [{ id: 'c-shopping', name: '购物', sort: 2 }];
  },
  rangeBills() {
    return [];
  },
  getBill() {
    return null;
  },
  getCategoryResolver() {
    return (id) => ({ id: id, name: '餐饮', sort: 1, emoji: '🍚' });
  },
  addBill(payload) {
    calls.addBill += 1;
    maybeThrow('addBill');
    return { id: 'bill-' + calls.addBill, payload: payload };
  },
  updateBill() {
    calls.updateBill += 1;
    maybeThrow('updateBill');
  },
  deleteBill() {},
  recurring: {
    core: realCore,
    getRules() {
      return [];
    },
    getRule() {
      return null;
    },
    createRule(rule) {
      calls.createRule += 1;
      maybeThrow('createRule');
      global.__lastRule = rule;
      return { id: 'r' + calls.createRule };
    },
    editRule() {
      calls.editRule += 1;
      maybeThrow('editRule');
    },
    setRuleEnabled() {},
    deleteRule() {},
    countDueForRule() {
      return { count: 0, truncated: false };
    },
    runRecurringGenerator() {
      return Promise.resolve();
    },
  },
  getBudgetState() {
    return { rules: [] };
  },
  budget: {
    resolveRuleForDate() {
      return null;
    },
  },
  saveBudgetRule(rule) {
    calls.saveBudgetRule += 1;
    maybeThrow('saveBudgetRule');
    global.__lastBudget = rule;
  },
};

const storePath = require.resolve(path.join(ROOT, 'data', 'index.js'));
require.cache[storePath] = {
  id: storePath,
  filename: storePath,
  loaded: true,
  exports: fakeStore,
};

let capturedComponent = null;
let capturedPage = null;
global.Component = function (def) {
  capturedComponent = def;
};
global.Page = function (def) {
  capturedPage = def;
};

require(path.join(ROOT, 'components', 'bill-form', 'bill-form.js'));
const billDef = capturedComponent;
capturedComponent = null;
require(path.join(ROOT, 'components', 'daily-value-form', 'daily-value-form.js'));
const dvDef = capturedComponent;
capturedComponent = null;
require(path.join(ROOT, 'pages', 'recurring', 'recurring.js'));
const recurringDef = capturedPage;
capturedPage = null;
require(path.join(ROOT, 'pages', 'budget-settings', 'budget-settings.js'));
const budgetDef = capturedPage;

/** 造一个足够用的实例：data 深拷贝 + 方法绑定 + setData 同步写回 */
function makeInstance(def, useMethods) {
  const events = [];
  const inst = {
    data: JSON.parse(JSON.stringify(def.data || {})),
    events: events,
    triggerEvent(name, detail) {
      events.push({ name: name, detail: detail });
    },
    setData(patch, cb) {
      Object.keys(patch).forEach((k) => {
        inst.data[k] = patch[k];
      });
      if (typeof cb === 'function') cb();
    },
  };
  const src = useMethods ? def.methods : def;
  Object.keys(src).forEach((k) => {
    if (typeof src[k] === 'function') inst[k] = src[k].bind(inst);
  });
  return inst;
}

function resetCalls() {
  Object.keys(calls).forEach((k) => {
    calls[k] = 0;
  });
  toasts.length = 0;
  throwOn = null;
  global.__lastRule = null;
  global.__lastBudget = null;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function readyBillForm() {
  const inst = makeInstance(billDef, true);
  inst.setData({
    amountText: '12.34',
    canSubmit: true,
    categoryId: 'c-food',
    dateStr: '2026-01-01',
    todayStr: '2026-01-02',
    type: 'expense',
  });
  return inst;
}

(async () => {
  /* ==================== B1. 记账：连点两次只写一条 ==================== */
  console.log('记账：连点两次只写一条');
  resetCalls();
  {
    const bill = readyBillForm();
    bill.onSubmit();
    bill.onSubmit();
    eq(calls.addBill, 1, '连点两次 addBill 只调用 1 次');
    eq(bill.events.filter((e) => e.name === 'saved').length, 1, 'saved 事件只发 1 次');
    // 父页关 Sheet 的窗口里（此时还没 reset）第三次点击也必须被吃掉
    bill.onSubmit();
    eq(calls.addBill, 1, 'Sheet 关闭窗口内再点仍然不写第二条');
    // 重新进入表单（父页打开前调用 reset）后恢复正常
    bill.reset();
    bill.setData({ amountText: '5.00', canSubmit: true, dateStr: '2026-01-01', todayStr: '2026-01-02' });
    bill.onSubmit();
    eq(calls.addBill, 2, 'reset 后可正常保存下一笔');
  }

  /* ==================== B2. 记账：失败后解锁（P2-02 同源） ==================== */
  console.log('记账：第一次失败后第二次仍能保存');
  resetCalls();
  {
    const bill = readyBillForm();
    throwOn = 'addBill';
    bill.onSubmit();
    eq(calls.addBill, 1, '第一次提交进入 addBill（并抛错）');
    eq(bill.events.length, 0, '失败不触发 saved 事件');
    assert(toasts.length === 1, '失败要给用户可见提示（toast 1 次），实际 ' + toasts.length);
    bill.onSubmit();
    eq(calls.addBill, 2, '失败已解锁：第二次提交仍能进入保存');
    eq(bill.events.filter((e) => e.name === 'saved').length, 1, '第二次保存成功并触发 saved');
  }

  /* ==================== B3. 记账编辑：连点两次只更新一次 ==================== */
  console.log('记账（编辑态）：连点两次只更新一次');
  resetCalls();
  {
    const bill = readyBillForm();
    bill.setData({ editingId: 'b1', editingHours: 10, editingMinutes: 20 });
    bill.onSubmit();
    bill.onSubmit();
    eq(calls.updateBill, 1, '连点两次 updateBill 只调用 1 次');
  }

  /* ==================== B4. 日价：连点两次只写一条 ==================== */
  console.log('日价：连点两次只写一条');
  resetCalls();
  {
    const dv = makeInstance(dvDef, true);
    dv.setData({
      title: '咖啡机',
      amountText: '899',
      categoryId: 'c-shopping',
      startDate: '2026-01-01',
      todayStr: '2026-01-02',
    });
    dv.onSubmit();
    dv.onSubmit();
    eq(calls.addBill, 1, '日价连点两次 addBill 只调用 1 次');
    eq(dv.events.filter((e) => e.name === 'saved').length, 1, '日价 saved 事件只发 1 次');
  }

  /* ==================== B5. 日价：失败后解锁 ==================== */
  console.log('日价：第一次失败后第二次仍能保存');
  resetCalls();
  {
    const dv = makeInstance(dvDef, true);
    dv.setData({
      title: '咖啡机',
      amountText: '899',
      categoryId: 'c-shopping',
      startDate: '2026-01-01',
      todayStr: '2026-01-02',
    });
    throwOn = 'addBill';
    dv.onSubmit();
    eq(calls.addBill, 1, '第一次进入 addBill（并抛错）');
    assert(toasts.length === 1, '失败给 toast 提示');
    dv.onSubmit();
    eq(calls.addBill, 2, '失败已解锁：第二次仍能进入保存');
  }

  /* ==================== B6. 周期：连点两次只建一条规则 ==================== */
  console.log('周期：连点两次只建一条规则');
  resetCalls();
  {
    const rec = makeInstance(recurringDef, false);
    rec.setData({
      amountText: '3000',
      categoryId: 'c-food',
      startDate: '2026-01-01',
      time: '09:00',
      frequency: 'monthly',
      monthDay: 1,
      intervalText: '1',
      interval: 1,
    });
    rec.onSave();
    rec.onSave();
    eq(calls.createRule, 1, '连点两次 createRule 只调用 1 次');
    await flush();
    eq(rec.data.editorShow, false, '保存成功后关闭编辑器');
    // 重新打开编辑器（onAdd）后解锁
    rec.onAdd();
    rec.setData({
      amountText: '100',
      categoryId: 'c-food',
      startDate: '2026-01-01',
      frequency: 'monthly',
      monthDay: 1,
      intervalText: '1',
      interval: 1,
    });
    rec.onSave();
    eq(calls.createRule, 2, '重新打开编辑器后可正常再保存');
  }

  /* ==================== B7. 周期：补记确认取消后解锁 ==================== */
  console.log('周期：补记确认取消后仍可再次保存');
  resetCalls();
  {
    fakeStore.recurring.countDueForRule = () => ({ count: 3, truncated: false });
    const rec = makeInstance(recurringDef, false);
    rec.setData({
      amountText: '100',
      categoryId: 'c-food',
      startDate: '2026-01-01',
      time: '09:00',
      frequency: 'monthly',
      monthDay: 1,
      intervalText: '1',
      interval: 1,
    });
    rec.onSave(); // 弹确认框 → stub 回「取消」
    await new Promise((resolve) => setTimeout(resolve, 10));
    eq(calls.createRule, 0, '取消补记不落库');
    fakeStore.recurring.countDueForRule = () => ({ count: 0, truncated: false });
    rec.onSave();
    eq(calls.createRule, 1, '取消后已解锁：再次点保存能正常落库');
    await flush();
    fakeStore.recurring.countDueForRule = () => ({ count: 0, truncated: false });
  }

  /* ==================== B8. 周期：createRule 抛错后解锁 ==================== */
  console.log('周期：createRule 抛错后仍能再次保存');
  resetCalls();
  {
    const rec = makeInstance(recurringDef, false);
    rec.setData({
      amountText: '100',
      categoryId: 'c-food',
      startDate: '2026-01-01',
      frequency: 'monthly',
      monthDay: 1,
      intervalText: '1',
      interval: 1,
    });
    throwOn = 'createRule';
    rec.onSave();
    eq(calls.createRule, 1, '第一次进入 createRule（并抛错）');
    assert(toasts.length === 1, '失败给 toast 提示');
    rec.onSave();
    eq(calls.createRule, 2, '失败已解锁：第二次仍能进入保存');
    await flush();
  }

  /* ==================== B9. 预算：连点两次只保存一次 + 失败复位（P2-02） ==================== */
  console.log('预算：连点两次只保存一次；失败后按钮不锁死');
  resetCalls();
  {
    const bs = makeInstance(budgetDef, false);
    bs.setData({ enabled: true, amountText: '50', effectiveDate: '2026-01-01', todayStr: '2026-01-02' });
    bs.onSave();
    bs.onSave();
    await new Promise((resolve) => setTimeout(resolve, 10));
    eq(calls.saveBudgetRule, 1, '预算连点两次只保存 1 次');
    eq(bs._saving, undefined, '预算页不再使用手写 _saving 标记');
  }
  resetCalls();
  {
    const bs = makeInstance(budgetDef, false);
    bs.setData({ enabled: true, amountText: '50', effectiveDate: '2026-01-01', todayStr: '2026-01-02' });
    throwOn = 'saveBudgetRule';
    bs.onSave();
    await new Promise((resolve) => setTimeout(resolve, 10));
    eq(calls.saveBudgetRule, 1, '第一次保存进入 saveBudgetRule（并抛错）');
    assert(toasts.length === 1, '保存失败要给 toast（不静默失败）');
    eq(bs._guard().busy(), false, '失败后锁已复位（P2-02：按钮不会永久失效）');
    bs.onSave();
    await new Promise((resolve) => setTimeout(resolve, 10));
    eq(calls.saveBudgetRule, 2, '失败后再次保存能正常落库');
  }

  /* ==================== D. 周期间隔（P2-04） ==================== */
  console.log('周期间隔：输入不夹取，失焦/完成/保存前才夹取');
  resetCalls();
  {
    const rec = makeInstance(recurringDef, false);
    // 场景一：删空后输入 5，不许跳变成 15 / 不许被回写成 1
    rec.onInterval({ detail: { value: '' } });
    eq(rec.data.intervalText, '', '清空后输入框允许暂时为空（不被回写成 1）');
    eq(rec.data.interval, 1, '清空过程中不夹取 interval');
    rec.onInterval({ detail: { value: '5' } });
    eq(rec.data.intervalText, '5', '输入 5 不跳变（旧实现会夹取成 1 再变 15）');
    eq(rec.data.interval, 1, '输入过程中 interval 仍是上一个已确认值');
    // 失焦：夹取后落到合法值
    rec.onIntervalBlur({ detail: { value: '5' } });
    eq(rec.data.interval, 5, 'blur 后 interval 落到 5');
    eq(rec.data.intervalText, '5', 'blur 后显示串与 interval 同形');

    // 场景二：下边界
    rec.onInterval({ detail: { value: '0' } });
    eq(rec.data.intervalText, '0', '输入 0 不立刻跳变');
    rec.onIntervalBlur({ detail: { value: '0' } });
    eq(rec.data.interval, 1, '下边界：0 → 1');

    // 场景三：上边界
    rec.onInterval({ detail: { value: '1000' } });
    rec.onIntervalBlur({ detail: { value: '1000' } });
    eq(rec.data.interval, 999, '上边界：1000 → 999');

    // 场景四：非数字过滤（粘贴 / 第三方输入法）
    resetCalls();
    rec.onInterval({ detail: { value: '12abc' } });
    eq(rec.data.intervalText, '12', '非数字字符被过滤（只认开头连续数字）');
    rec.onInterval({ detail: { value: '1.5' } });
    eq(rec.data.intervalText, '1', '小数点的取值语义与 parseInt 一致（1.5 → 1）');

    // 场景五：完成按钮 = 结束输入，先夹取再收键盘
    rec.onInterval({ detail: { value: '' } });
    rec.onIntervalDone();
    eq(rec.data.interval, 1, '点完成后空值回落 1');
    eq(rec.data.intervalText, '1', '点完成后显示串同步为 1');

    // 场景六：完全跳过失焦直接保存，也要用夹取后的值
    rec.setData({
      amountText: '100',
      categoryId: 'c-food',
      startDate: '2026-01-01',
      frequency: 'daily',
      intervalText: '0',
      interval: 1,
    });
    rec.onSave();
    eq(global.__lastRule && global.__lastRule.interval, 1, '保存前夹取：落库 interval = 1');
    await flush();
  }

  /* ==================== E. 静态契约 ==================== */
  console.log('静态契约：四处共用同一份 guard');
  {
    const billJs = read('components/bill-form/bill-form.js');
    const dvJs = read('components/daily-value-form/daily-value-form.js');
    const reJs = read('pages/recurring/recurring.js');
    const bsJs = read('pages/budget-settings/budget-settings.js');
    [['bill-form', billJs], ['daily-value-form', dvJs], ['recurring', reJs], ['budget-settings', bsJs]].forEach(
      (pair) => {
        const name = pair[0];
        const src = pair[1];
        assert(src.indexOf("require('../../utils/submit-guard')") >= 0, name + ' 引用 utils/submit-guard');
        assert(src.indexOf('submitGuard.createSubmitGuard()') >= 0, name + ' 用工厂创建锁');
        assert(/if \(!guard\.begin\(\)\) return;/.test(src), name + ' begin 失败直接 return');
        assert(/guard\.end\(\)/.test(src), name + ' 有 end 释放路径');
        assert(src.indexOf('setTimeout') < 0 || /setTimeout\(\(\) => wx\.navigateBack/.test(src), name + ' 不用 setTimeout 假解锁');
      }
    );
    assert(bsJs.indexOf('_saving') < 0, '预算页已移除手写 _saving（统一到 submit-guard）');
    const reWxml = read('pages/recurring/recurring.wxml');
    assert(reWxml.indexOf('value="{{intervalText}}"') >= 0, '间隔输入框受控于 intervalText（显示串）');
    assert(reWxml.indexOf('catchtap="onIntervalDone"') >= 0, '间隔完成按钮仍保留（唯一收键盘入口）');
    const reWxss = read('pages/recurring/recurring.wxss');
    assert(/\.re-interval__hit\s*\{[\s\S]*?height:\s*88rpx/.test(reWxss), '间隔完成热区外壳 88rpx(44px)');
    // 可见按钮尺寸不变（颜色 / 圆角 / 字号 / 高度都没动）
    assert(/\.re-interval__done\s*\{[\s\S]*?height:\s*var\(--input-h-compact\)/.test(reWxss), '可见按钮尺寸维持 64rpx');
  }

  console.log('\nsubmit-guard tests: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
})();
