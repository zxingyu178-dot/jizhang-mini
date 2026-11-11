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

/* ==================== A2. 记账效率接线（v1.4.7） ====================
 * 实测发现的三件事，逐条钉住接线，避免后续重构悄悄退回：
 *   ① 保存后没有任何回执，用户无法确认「记上了」；
 *   ② 改日期到上个月保存后，当前月列表一行不变、也没提示，看着像没记上；
 *   ③ 展开「更多分类」后弹层高度不重算，保存按钮被裁到屏外。
 */
console.log('记账效率接线');

// ① 保存回执：金额与月份必须随 saved 事件回传，主页面才能回显
includes(billJs, 'amountCents: cents', 'saved 事件带金额（分）');
includes(billJs, 'ym: dateStr.slice(0, 7)', 'saved 事件带所属月份');
includes(billJs, "triggerEvent('saved', Object.assign({ id: bill.id }, savedDetail))", '新增保存回传完整 detail');
includes(billJs, "triggerEvent('saved', Object.assign({ id: this.data.editingId }, savedDetail))", '编辑保存回传完整 detail');

const mainJs = read('pages/main/main.js');
includes(mainJs, "money.formatCents(d.amountCents)", '当月保存回显金额');
includes(mainJs, '已记入 ', '跨月保存回显「已记入 X 月」');
assert(/crossMonth[\s\S]{0,120}refreshPanels\(\{ accYm: d\.ym \}\)/.test(mainJs), '跨月保存切到账单所在月份');
includes(mainJs, 'ymLabel(ym)', '月份文案有统一格式化');

// ② 弹层高度重算：内容变高必须重新预算，否则按钮被挤出面板
const sheetJs = read('components/bottom-sheet/bottom-sheet.js');
includes(sheetJs, 'refit()', '弹层提供 refit 重算入口');
assert(/refit\(\)[\s\S]{0,200}this\._fit\(\)/.test(sheetJs), 'refit 复用同一套高度预算');
assert(/refit\(\)\s*\{[\s\S]{0,120}if \(!this\.data\.show\)/.test(sheetJs), 'refit 在未展示时不动作（不偷开弹层）');
includes(billJs, "triggerEvent('resize')", '分类展开/收起通知弹层重算');
const mainWxml = read('pages/main/main.wxml');
includes(mainWxml, 'id="billSheet"', '记账弹层有 id 供 refit');
includes(mainWxml, 'bind:resize="onBillFormResize"', '表单 resize 事件已接线');
includes(mainJs, "selectComponent('#billSheet')", '主页面能取到记账弹层');

// ③ 日期快捷：昨天 / 前天 / 今天 三个入口，且不新增行高
includes(billWxml, 'bf-row--date', '日期行独立类名（picker 内联，不占整行）');
includes(billWxml, 'bindtap="onQuickDate"', '日期快捷已接线');
includes(billWxml, 'data-days="1"', '有「昨天」快捷');
includes(billWxml, 'data-days="2"', '有「前天」快捷');
includes(billWxml, 'data-days="0"', '有「今天」退回入口');
assert(/dateStr !== todayStr[\s\S]{0,200}data-days="0"/.test(billWxml), '日期已改成过去时显示「今天」退回');
const billWxss = read('components/bill-form/bill-form.wxss');
includes(billWxss, '.bf-chip', '快捷钮有样式');
includes(billWxss, '.bf-cats-collapse', '收起入口有样式');
assert(/\.bf-daily\s*\{[\s\S]{0,200}height:/.test(billWxss), '「计算日价」压成定高单行（不再两行卡片）');

// ④ 分类可用性：能收起 + 上次分类可沿用
includes(billWxml, 'bindtap="onHideAllCats"', '展开态有「收起」入口');
includes(billJs, 'onHideAllCats()', '收起方法存在');
includes(billJs, 'rememberedCategoryId(type)', '分类沿用有独立判定（归档即失效）');

// ⑤ 打开弹层自动聚焦金额：省掉「打开→点金额框→弹键盘」这一步
includes(billJs, 'focusAmount()', '金额自动聚焦入口存在');
assert(/focusAmount\(\)\s*\{[\s\S]{0,220}if \(this\.data\.editingId\) return;/.test(billJs),
  '编辑态不抢焦点（只在新增时自动聚焦）');
includes(mainWxml, 'bind:opened="onBillSheetOpened"', '弹层打开事件已接线');
assert(/visible: true[\s\S]{0,220}triggerEvent\('opened'\)/.test(sheetJs),
  'opened 在高度落位后才触发（否则键盘先弹出会缩小视口、算错面板高度）');

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

  /* ---- bill-form v1.4.7：日期快捷 / 分类收起 / 保存回执 / 分类沿用 ---- */
  console.log('记账效率：日期快捷、分类收起、保存回执');
  const DAY = 24 * 60 * 60 * 1000;
  const fmtDay = (d) => d.getFullYear()
    + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1)
    + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
  const nowMs = Date.now();
  const todayStr = fmtDay(new Date(nowMs));
  const yStr = fmtDay(new Date(nowMs - DAY));
  const bStr = fmtDay(new Date(nowMs - 2 * DAY));

  const bill2 = makeInstance(billDef, true);

  // 日期快捷：不需要打开原生 picker
  bill2.setData({ dateStr: '2026-03-05', todayStr: todayStr });
  bill2.onQuickDate({ currentTarget: { dataset: { days: '1' } } });
  eq(bill2.data.dateStr, yStr, '「昨天」= 今天减一天');
  bill2.onQuickDate({ currentTarget: { dataset: { days: '2' } } });
  eq(bill2.data.dateStr, bStr, '「前天」= 今天减两天');
  bill2.onQuickDate({ currentTarget: { dataset: { days: '0' } } });
  eq(bill2.data.dateStr, todayStr, '「今天」回到今天');
  bill2.onQuickDate({ currentTarget: { dataset: { days: 'x' } } });
  eq(bill2.data.dateStr, todayStr, '非法天数不改日期');

  // 分类展开 / 收起：两者都必须通知弹层重算高度
  resetRecorders();
  bill2.onShowAllCats();
  eq(bill2.data.showAllCats, true, '展开全部分类');
  eq(events.filter((e) => e.name === 'resize').length, 1, '展开后通知弹层重算高度');
  resetRecorders();
  bill2.onHideAllCats();
  eq(bill2.data.showAllCats, false, '收起全部分类');
  eq(events.filter((e) => e.name === 'resize').length, 1, '收起后通知弹层重算高度');

  // 保存回执：saved 事件必须带月份与金额，父页面才能回显 / 判断跨月
  fakeStore.addBill = (p) => ({ id: 'new-1', amountCents: p.amountCents });
  fakeStore.updateBill = () => {};
  bill2.applyAmount('12.34'); // 走真实输入链路：同步 amountText + canSubmit
  bill2.setData({
    editingId: null,
    type: 'expense',
    categoryId: 'c-food',
    dateStr: '2026-03-05',
    todayStr: '2026-03-09',
    merchant: '瑞幸',
    note: '早餐',
  });
  resetRecorders();
  bill2.onSubmit();
  const savedEv = events.find((e) => e.name === 'saved');
  assert(!!savedEv, '保存成功后触发 saved 事件');
  eq(savedEv.detail.ym, '2026-03', 'saved 带所属月份（供跨月跳转）');
  eq(savedEv.detail.amountCents, 1234, 'saved 带金额分（供回执回显）');
  eq(savedEv.detail.dateStr, '2026-03-05', 'saved 带实际记账日期');

  // 连续记账：沿用上次支出分类；分类失效则回退默认
  bill2._lastCategoryId = 'c-food';
  bill2.reset();
  eq(bill2.data.categoryId, 'c-food', '重开表单沿用上次支出分类');
  bill2._lastCategoryId = 'c-archived-gone';
  bill2.reset();
  eq(bill2.data.categoryId, 'c-food', '记住的分类已归档 / 删除则回退默认');

  // 打开即聚焦金额：只在新增模式
  const bill3 = makeInstance(billDef, true);
  bill3.setData({ editingId: null, amountFocused: false });
  bill3.focusAmount();
  eq(bill3.data.amountFocused, true, '新增模式打开即聚焦金额（省一次点击）');
  bill3.setData({ editingId: 'b-edit', amountFocused: false });
  bill3.focusAmount();
  eq(bill3.data.amountFocused, false, '编辑模式不抢焦点（避免键盘盖住删除 / 保存）');
  bill3.setData({ editingId: null, amountFocused: true });
  bill3.focusAmount();
  eq(bill3.data.amountFocused, true, '已聚焦时重复调用不重复 setData（幂等）');

  /* ---------- 汇总 ---------- */
  console.log('\ninput-interaction tests: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
})();
