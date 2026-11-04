/**
 * tests/input-interaction.test.js — v1.3.6 输入交互可靠性
 *
 * 两类验证：
 *   A. 静态接线契约：13 个输入控件的类型 / confirm-type / bindconfirm / 完成按钮，
 *      确保没有把金额改成 text、没有遗漏收键盘入口，全项目不存在 textarea；
 *   B. 动态行为：直接驱动 bill-form / recurring / search 实例，验证
 *      「完成只收键盘、不丢金额、不保存、不关 Sheet」，失焦不主动收键盘，
 *      金额与间隔使用独立 focus key，删除弹窗前先收键盘。
 *
 * 运行：node tests/input-interaction.test.js
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
  assert(a === b, msg + '（期望 ' + b + '，实际 ' + a + '）');
}
function includes(text, needle, msg) {
  assert(text.indexOf(needle) >= 0, msg + '（缺少 ' + needle + '）');
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ==================== A. 静态接线契约 ==================== */
console.log('静态接线契约');

const billWxml = read('components/bill-form/bill-form.wxml');
includes(billWxml, 'type="digit"', '记账金额保持 digit（未改成 text）');
includes(billWxml, 'bindblur="onAmountBlur"', '记账金额失焦只同步值');
includes(billWxml, 'focus="{{amountFocused}}"', '记账金额独立 focus 标记');
includes(billWxml, 'catchtap="onAmountDone"', '记账金额有页面内完成按钮');
includes(billWxml, 'bindconfirm="onMerchantConfirm"', '商户 confirm 接线');
includes(billWxml, 'bindconfirm="onNoteConfirm"', '备注 confirm 接线');
assert(billWxml.indexOf('autoFocus') < 0, '记账表单不再自动抢焦点');

const billJs = read('components/bill-form/bill-form.js');
includes(billJs, "keyboard.releaseInputFocus(this, 'amountFocused')", '记账金额完成走 releaseInputFocus');
assert(/onAmountBlur[\s\S]{0,160}hideKeyboard/.test(billJs) === false, '记账金额失焦不主动收键盘');
assert(/onAmountDone[\s\S]{0,160}(onSubmit|store\.)/.test(billJs) === false, '完成按钮不保存、不写数据');

const dvWxml = read('components/daily-value-form/daily-value-form.wxml');
includes(dvWxml, 'type="digit"', '日价金额保持 digit');
includes(dvWxml, 'bindconfirm="onTitleConfirm"', '日价名称 confirm 接线');
includes(dvWxml, 'catchtap="onAmountDone"', '日价金额有页面内完成按钮');
includes(dvWxml, 'bindconfirm="onNoteConfirm"', '日价备注 confirm 接线');
assert(dvWxml.indexOf('autoFocus') < 0, '日价表单不再自动抢焦点');

const dvJs = read('components/daily-value-form/daily-value-form.js');
includes(dvJs, "keyboard.releaseInputFocus(this, 'amountFocused')", '日价金额完成走 releaseInputFocus');

const reWxml = read('pages/recurring/recurring.wxml');
includes(reWxml, 'type="digit"', '周期金额保持 digit');
includes(reWxml, 'type="number"', '周期间隔保持 number');
includes(reWxml, 'catchtap="onAmountDone"', '周期金额完成按钮');
includes(reWxml, 'catchtap="onIntervalDone"', '周期间隔完成按钮');
includes(reWxml, 'bindconfirm="onNoteConfirm"', '周期备注 confirm 接线');

const reJs = read('pages/recurring/recurring.js');
includes(reJs, "keyboard.releaseInputFocus(this, 'amountFocused')", '周期金额独立 focus key');
includes(reJs, "keyboard.releaseInputFocus(this, 'intervalFocused')", '周期间隔独立 focus key');
assert((reJs.match(/keyboard\.hideKeyboard\(\)\.then\(/g) || []).length >= 2, '删除 / 补记确认前先收键盘');

const bsWxml = read('pages/budget-settings/budget-settings.wxml');
includes(bsWxml, 'type="digit"', '预算金额保持 digit');
includes(bsWxml, 'bindfocus="onAmountFocus"', '预算金额聚焦接线');
includes(bsWxml, 'catchtap="onAmountDone"', '预算金额完成按钮');
const bsJs = read('pages/budget-settings/budget-settings.js');
includes(bsJs, "keyboard.releaseInputFocus(this, 'amountFocused')", '预算金额完成走 releaseInputFocus');

const searchWxml = read('pages/search/search.wxml');
includes(searchWxml, 'confirm-type="search"', '搜索框使用 search 确认类型');
includes(searchWxml, 'bindconfirm="onSearchConfirm"', '搜索框 confirm 接线');
const searchJs = read('pages/search/search.js');
includes(searchJs, 'onSearchConfirm(e)', '搜索页定义 onSearchConfirm');
includes(searchJs, "keyboard.hideKeyboard()", '搜索确认后收键盘');

const cmWxml = read('pages/category-manage/category-manage.wxml');
includes(cmWxml, 'bindconfirm="onEmojiConfirm"', 'Emoji confirm 接线');
includes(cmWxml, 'bindconfirm="onNameConfirm"', '分类名称 confirm 接线');
includes(cmWxml, 'type="text"', '分类字段保持 text（未改成 digit）');
const cmJs = read('pages/category-manage/category-manage.js');
includes(cmJs, 'onEmojiConfirm(e)', '分类页定义 onEmojiConfirm');
includes(cmJs, 'onNameConfirm(e)', '分类页定义 onNameConfirm');

const headerJs = read('components/page-header/page-header.js');
includes(headerJs, 'viewport.isKeyboardOpen()', 'Header 返回前判断键盘状态');
includes(headerJs, 'keyboard.hideKeyboard()', 'Header 返回走统一收键盘工具');

const keyboardJs = read('utils/keyboard.js');
includes(keyboardJs, 'releaseInputFocus', '键盘工具导出 releaseInputFocus');
const viewportJs = read('utils/viewport.js');
includes(viewportJs, 'isKeyboardOpen', 'viewport 提供只读 isKeyboardOpen');
eq((viewportJs.match(/wx\.onKeyboardHeightChange\(\(/g) || []).length, 1, '全局只有一套键盘高度监听');

/* 全项目不存在 textarea（避免 textarea 键盘行为差异） */
function walk(dir, out) {
  fs.readdirSync(dir).forEach((name) => {
    if (name === 'node_modules' || name === '.git' || name === 'miniprogram_npm') return;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.wxml')) out.push(full);
  });
  return out;
}
const allWxml = walk(ROOT, []);
allWxml.forEach((f) => {
  assert(fs.readFileSync(f, 'utf8').indexOf('<textarea') < 0, '不存在 textarea：' + path.relative(ROOT, f));
});

/* ==================== 动态行为 ==================== */
console.log('动态行为');

const kbCalls = [];
const order = [];
const events = [];
global.wx = {
  env: { USER_DATA_PATH: '/usr' },
  hideKeyboard(opts) {
    kbCalls.push('hideKeyboard');
    order.push('hideKeyboard');
    if (opts && typeof opts.complete === 'function') opts.complete();
  },
  showModal(opts) {
    order.push('showModal');
    if (opts && typeof opts.success === 'function') opts.success({ confirm: false, cancel: true });
  },
};

/* 用最小 store 替身，避免测试依赖磁盘数据（focus / 值同步逻辑不需要真实 store） */
const storePath = require.resolve(path.join(ROOT, 'data', 'index.js'));
const fakeStore = {
  getActiveCategories() {
    return [{ id: 'c-food', name: '餐饮', sort: 1 }];
  },
  getCategory(id) {
    return { id: id, name: '餐饮', sort: 1 };
  },
  rangeBills() {
    return [];
  },
  getBill() {
    return null;
  },
  recurring: { core: {} },
};
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
require(path.join(ROOT, 'pages', 'recurring', 'recurring.js'));
const recurringDef = capturedPage;
capturedPage = null;
require(path.join(ROOT, 'pages', 'search', 'search.js'));
const searchDef = capturedPage;

function makeInstance(def, useMethods) {
  const inst = {
    data: JSON.parse(JSON.stringify(def.data || {})),
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

function resetRecorders() {
  kbCalls.length = 0;
  order.length = 0;
  events.length = 0;
}

(async () => {
  /** 等待 releaseInputFocus 的 Promise 链落地（setData 回调 → hideKeyboard） */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  /* ---- bill-form：金额完成 ---- */
  console.log('记账金额：完成只收键盘，不丢值、不保存');
  resetRecorders();
  const bill = makeInstance(billDef, true);
  bill.onAmount({ detail: { value: '12.34' } });
  eq(bill.data.amountText, '12.34', '输入后金额同步');
  eq(bill.data.canSubmit, true, '非零金额可提交');
  eq(kbCalls.length, 0, '输入过程中不调用收键盘');

  bill.setData({ amountFocused: true });
  bill.onAmountDone();
  await flush();
  eq(bill.data.amountText, '12.34', '完成后金额保留');
  eq(bill.data.amountFocused, false, '完成后释放焦点标记');
  eq(kbCalls.length, 1, '完成后收一次键盘');
  eq(events.length, 0, '完成不触发保存 / 删除事件');

  /* ---- bill-form：失焦不主动收键盘 ---- */
  resetRecorders();
  bill.onAmountBlur({ detail: { value: '12.34' } });
  eq(bill.data.amountFocused, false, '失焦同步焦点状态');
  eq(kbCalls.length, 0, '失焦不主动收键盘（允许切到商户 / 备注）');

  /* ---- bill-form：商户 / 备注 confirm ---- */
  resetRecorders();
  bill.onMerchantConfirm({ detail: { value: '瑞幸' } });
  eq(bill.data.merchant, '瑞幸', '商户 confirm 同步值');
  eq(kbCalls.length, 1, '商户 confirm 收键盘');
  resetRecorders();
  bill.onNoteConfirm({ detail: { value: '早餐' } });
  eq(bill.data.note, '早餐', '备注 confirm 同步值');
  eq(kbCalls.length, 1, '备注 confirm 收键盘');

  /* ---- bill-form：删除弹窗前先收键盘，取消不改数据 ---- */
  resetRecorders();
  bill.setData({ editingId: 'b1' });
  await new Promise((resolve) => {
    bill.onDelete();
    setTimeout(resolve, 10);
  });
  eq(order.join(','), 'hideKeyboard,showModal', '删除账单：先收键盘再弹确认框');
  eq(events.length, 0, '取消删除不触发 deleted');

  /* ---- recurring：金额 / 间隔独立 focus key ---- */
  console.log('周期金额与间隔：独立焦点，互不干扰');
  resetRecorders();
  const rec = makeInstance(recurringDef, false);
  rec.setData({ amountFocused: true, intervalFocused: true });
  rec.onAmountDone();
  await flush();
  eq(rec.data.amountFocused, false, '金额完成后金额焦点释放');
  eq(rec.data.intervalFocused, true, '金额完成不影响间隔焦点');
  eq(kbCalls.length, 1, '金额完成收键盘');

  resetRecorders();
  rec.onIntervalDone();
  await flush();
  eq(rec.data.intervalFocused, false, '间隔完成后间隔焦点释放');
  eq(kbCalls.length, 1, '间隔完成收键盘');

  rec.applyInterval('0');
  eq(rec.data.interval, 1, '间隔下界夹取到 1');
  rec.applyInterval('1000');
  eq(rec.data.interval, 999, '间隔上界夹取到 999');
  rec.applyInterval('abc');
  eq(rec.data.interval, 1, '非法间隔回落到 1');

  /* ---- recurring：删除弹窗前先收键盘 ---- */
  resetRecorders();
  rec.onDelete({ currentTarget: { dataset: { id: 'r1' } } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  eq(order.join(','), 'hideKeyboard,showModal', '删除周期规则：先收键盘再弹确认框');

  /* ---- search：confirm 立即筛选并收键盘 ---- */
  console.log('搜索：confirm 立即筛选后收键盘');
  resetRecorders();
  const searchPage = makeInstance(searchDef, false);
  let applied = 0;
  searchPage.applyFilters = function () {
    applied += 1;
  };
  searchPage._filterTimer = setTimeout(() => {
    applied += 1;
  }, 120);
  searchPage.onSearchConfirm({ detail: { value: '咖啡' } });
  eq(searchPage.data.kw, '咖啡', 'confirm 同步关键词');
  eq(searchPage._filterTimer, null, 'confirm 清掉未执行的防抖定时器');
  eq(applied, 1, 'confirm 立即执行一次筛选');
  eq(kbCalls.length, 1, '搜索 confirm 收键盘');

  /* ---------- 汇总 ---------- */
  console.log('\ninput-interaction tests: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
})();
