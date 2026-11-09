/**
 * tests/recovery-ui-guard.test.js — v1.4.2 Gate 3 恢复失败交互
 *
 * 验证预览页根据 mutationStarted / rollbackAttempted / rollbackCompleted 给出不同提示：
 *   - 未开始修改 → 原账本未修改（允许重试）
 *   - 回滚成功 → 已恢复到操作前状态（允许重试）
 *   - 回滚失败 → 恢复未完成（阻止再次提交，安全点保留提示）
 *   - 状态不明确 → 无法确认（阻止再次提交）
 * 同时验证按钮禁用态接线与错误码展示。
 *
 * 运行：node tests/recovery-ui-guard.test.js
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
function includes(hay, needle, msg) {
  assert(String(hay).indexOf(needle) >= 0, msg + '（缺少 ' + needle + '）');
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
function mockModule(rel, exports) {
  const p = require.resolve(path.join(ROOT, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exports };
}

mockModule('data/index.js', {
  rangeBills: () => [],
  getCategoryResolver: () => () => ({ name: '餐饮' }),
  addImportHistory: () => {},
});
mockModule('utils/theme.js', { bindPage: () => () => {} });
mockModule('packages/importer/core/diagnosis.js', { toText: () => '' });

let commitError = null;
let commitCalls = 0;
mockModule('packages/importer/core/commit.js', {
  commitImport: () => {
    commitCalls += 1;
    if (commitError) throw commitError;
    return { imported: 1, merged: 0 };
  },
  commitRestore: () => {
    commitCalls += 1;
    if (commitError) throw commitError;
    return { restored: 1 };
  },
});

const calls = { modal: [], loading: 0, hide: 0, redirect: [] };
global.wx = {
  showLoading() { calls.loading += 1; },
  hideLoading() { calls.hide += 1; },
  showModal(opts) { calls.modal.push(opts); },
  redirectTo(opts) { calls.redirect.push(opts); },
};
global.getApp = () => ({ globalData: { __importSession: null } });

let captured = null;
global.Page = function (def) { captured = def; };
require(path.join(ROOT, 'packages/importer/pages/preview/preview.js'));

function makePage() {
  const page = {
    data: Object.assign(JSON.parse(JSON.stringify(captured.data || {})), {
      session: { source: 'alipay', counts: { ready: 1 }, bills: [] },
      isRestore: false,
      includeSuspect: false,
      submitting: false,
      submitBlocked: false,
    }),
    setData(patch) {
      Object.keys(patch).forEach((k) => { page.data[k] = patch[k]; });
    },
  };
  Object.keys(captured).forEach((k) => {
    if (typeof captured[k] === 'function') page[k] = captured[k].bind(page);
  });
  return page;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms || 60));

(async () => {
  console.log('A. 恢复失败提示分级');

  // A1 未开始修改（隔离 / 安全点失败）
  let page = makePage();
  commitError = {
    code: 'QUARANTINE_INCOMPLETE',
    mutationStarted: false,
    rollbackAttempted: false,
    rollbackCompleted: false,
  };
  commitCalls = 0;
  calls.modal.length = 0;
  page.onConfirm();
  await wait();
  eq(commitCalls, 1, 'A1 调用一次提交');
  eq(page.data.submitBlocked, false, 'A1 允许重试');
  eq(calls.modal.length, 1, 'A1 弹出提示');
  includes(calls.modal[0].content, '原账本未修改', 'A1 提示原账本未修改');
  includes(calls.modal[0].content, 'QUARANTINE_INCOMPLETE', 'A1 展示错误码');
  eq(calls.modal[0].title, '写入失败', 'A1 标题为写入失败');

  // A2 回滚成功
  page = makePage();
  commitError = {
    code: 'RESTORE_INTEGRITY_FAILED',
    mutationStarted: true,
    rollbackAttempted: true,
    rollbackCompleted: true,
  };
  commitCalls = 0;
  calls.modal.length = 0;
  page.onConfirm();
  await wait();
  eq(page.data.submitBlocked, false, 'A2 允许重试');
  includes(calls.modal[0].content, '已恢复到操作前状态', 'A2 提示已恢复');
  includes(calls.modal[0].content, 'RESTORE_INTEGRITY_FAILED', 'A2 展示错误码');
  eq(calls.modal[0].title, '写入失败', 'A2 标题为写入失败');

  // A3 回滚失败
  page = makePage();
  commitError = {
    code: 'ATOMIC_WRITE_FAILED',
    mutationStarted: true,
    rollbackAttempted: true,
    rollbackCompleted: false,
  };
  commitCalls = 0;
  calls.modal.length = 0;
  page.onConfirm();
  await wait();
  eq(page.data.submitBlocked, true, 'A3 阻止再次提交');
  includes(calls.modal[0].content, '恢复未完成', 'A3 提示恢复未完成');
  includes(calls.modal[0].content, '安全点已保留', 'A3 提示安全点保留');
  includes(calls.modal[0].content, 'ATOMIC_WRITE_FAILED', 'A3 展示错误码');
  eq(calls.modal[0].title, '恢复未完成', 'A3 标题为恢复未完成');
  eq(calls.modal[0].confirmText, '返回检查', 'A3 按钮为返回检查');

  // A4 阻止后再次点击不重复提交
  commitCalls = 0;
  page.onConfirm();
  await wait();
  eq(commitCalls, 0, 'A4 阻止态下不再调用提交');

  // A5 状态不明确
  page = makePage();
  commitError = {};
  commitCalls = 0;
  calls.modal.length = 0;
  page.onConfirm();
  await wait();
  eq(page.data.submitBlocked, true, 'A5 状态不明确时阻止提交');
  includes(calls.modal[0].content, '无法确认当前数据状态', 'A5 提示无法确认');
  includes(calls.modal[0].content, '请勿重复操作', 'A5 提示勿重复操作');

  console.log('B. 静态接线');
  const js = read('packages/importer/pages/preview/preview.js');
  includes(js, 'mutationStarted === false', 'B1 判断未开始修改');
  includes(js, 'rollbackCompleted === true', 'B2 判断回滚成功');
  includes(js, 'rollbackCompleted === false', 'B3 判断回滚失败');
  includes(js, 'this.data.submitBlocked', 'B4 提交入口检查阻止态');
  includes(js, 'submitBlocked: blocked', 'B5 失败后写入阻止态');

  const wxml = read('packages/importer/pages/preview/preview.wxml');
  includes(wxml, 'submitBlocked', 'B6 按钮绑定阻止态');
  includes(wxml, 'pv-btn--disabled', 'B7 阻止态使用禁用样式');
  const wxss = read('packages/importer/pages/preview/preview.wxss');
  includes(wxss, '.pv-btn--disabled', 'B8 存在禁用样式');

  console.log('\nrecovery-ui-guard tests: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
  console.log('ALL RECOVERY UI GUARD TESTS PASSED');
})();
