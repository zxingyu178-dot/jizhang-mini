/**
 * tests/import-e2e-safety.test.js — v1.4.1 Gate 3
 *
 * 覆盖两类「不依赖真实文件选择器」的风险：
 *   A. 导入入口的取消 / 解析失败路径：不跳转、不写账本、明确提示；
 *   B. E2E 注入入口与截图管理：开发环境守卫、release 不可达、不暴露 UI、
 *      E2E 不再清空 / 覆盖历史基线截图。
 *
 * 运行：node tests/import-e2e-safety.test.js
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
function eq(actual, expected, msg) {
  assert(actual === expected, msg + '（期望 ' + expected + '，实际 ' + actual + '）');
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function mockModule(rel, exports) {
  const p = require.resolve(path.join(ROOT, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exports };
}

/* ---------- 依赖替身 ---------- */
mockModule('utils/device.js', {
  get: () => ({ windowHeight: 600, statusBarHeight: 20, headerHeight: 44 }),
});
let history = [];
mockModule('data/index.js', { getImportHistory: () => history });
mockModule('utils/theme.js', { bindPage: () => () => {} });
const writeCalls = [];
const removeCalls = [];
mockModule('data/fs.js', {
  userRoot: () => '/usr',
  writeText: (p, t) => writeCalls.push({ p, t }),
  remove: (p) => {
    removeCalls.push(p);
    return true;
  },
});
let devEnv = true;
mockModule('utils/env.js', { isDevEnv: () => devEnv });
let parseResult = null;
mockModule('packages/importer/core/detector.js', {
  parseFile: () => parseResult,
});
mockModule('packages/importer/core/diagnosis.js', { toText: () => '' });

/* ---------- wx / Page mock ---------- */
const calls = { navigate: [], modal: [], loading: 0, hideLoading: 0, toast: [], clipboard: [] };
let chooseOpts = null;
global.wx = {
  chooseMessageFile(opts) {
    chooseOpts = opts; // 取消 = 既不 success 也不 fail
  },
  showLoading() { calls.loading += 1; },
  hideLoading() { calls.hideLoading += 1; },
  showModal(opts) { calls.modal.push(opts); },
  navigateTo(opts) { calls.navigate.push(opts); },
  setClipboardData() { calls.clipboard.push(1); },
  showToast(opts) { calls.toast.push(opts); },
};
let appData = {};
global.getApp = () => ({ globalData: appData });

let captured = null;
global.Page = function (def) {
  captured = def;
};

require(path.join(ROOT, 'packages/importer/pages/import/import.js'));

function makePage() {
  const page = {
    data: JSON.parse(JSON.stringify(captured.data || {})),
    setData(patch) {
      Object.keys(patch).forEach((k) => {
        page.data[k] = patch[k];
      });
    },
  };
  Object.keys(captured).forEach((k) => {
    if (typeof captured[k] === 'function') page[k] = captured[k].bind(page);
  });
  return page;
}
function resetCalls() {
  calls.navigate.length = 0;
  calls.modal.length = 0;
  calls.loading = 0;
  calls.hideLoading = 0;
  calls.toast.length = 0;
  calls.clipboard.length = 0;
  chooseOpts = null;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  /* ==================== A. onChooseFile ==================== */
  console.log('A. 文件选择取消 / 解析失败');

  const page = makePage();

  // A1 取消选择：不跳转、不 loading、不写账本
  resetCalls();
  page.onChooseFile({ currentTarget: { dataset: { key: 'alipay' } } });
  eq(chooseOpts && chooseOpts.type, 'file', 'A1 调用 chooseMessageFile(type=file)');
  eq(chooseOpts.extensions || (chooseOpts.extension || []).join(','), 'xlsx,csv', 'A1 支付宝扩展名过滤');
  eq(calls.navigate.length, 0, 'A1 取消不跳转');
  eq(calls.loading, 0, 'A1 取消不显示 loading');
  eq(Object.keys(appData).length, 0, 'A1 取消不写会话');

  // A2 解析失败：明确提示、不跳转
  resetCalls();
  parseResult = Promise.reject(new Error('文件读取失败，请重试'));
  page.onChooseFile({ currentTarget: { dataset: { key: 'alipay' } } });
  const res = { tempFiles: [{ path: '/tmp/x.csv', size: 10, name: 'x.csv' }] };
  chooseOpts.success(res);
  await flush();
  await flush();
  eq(calls.navigate.length, 0, 'A2 解析失败不跳转');
  eq(calls.modal.length, 1, 'A2 弹出一次明确提示');
  eq(calls.modal[0] && calls.modal[0].title, '无法解析', 'A2 提示标题为「无法解析」');
  eq(calls.loading, 1, 'A2 显示过一次 loading');
  eq(calls.hideLoading, 1, 'A2 失败后关闭 loading');

  // A3 空 tempFiles：安全返回
  resetCalls();
  page.onChooseFile({ currentTarget: { dataset: { key: 'wechat' } } });
  chooseOpts.success({ tempFiles: [] });
  await flush();
  eq(calls.navigate.length, 0, 'A3 空文件不跳转');
  eq(calls.loading, 0, 'A3 空文件不 loading');

  /* ==================== B. __e2eImportText ==================== */
  console.log('B. E2E 注入入口守卫');

  resetCalls();
  writeCalls.length = 0;
  devEnv = false;
  let threw = null;
  try {
    page.__e2eImportText({ text: 'a,b', name: 'a.csv' });
  } catch (e) {
    threw = e;
  }
  assert(!!threw, 'B1 非开发环境抛错');
  eq(writeCalls.length, 0, 'B1 release/trial 不写任何临时文件');
  eq(parseResult && typeof parseResult.then, 'function', 'B1 不触发解析');

  devEnv = true;
  resetCalls();
  writeCalls.length = 0;
  removeCalls.length = 0;
  parseResult = Promise.resolve({
    source: 'alipay',
    bills: [{ id: 1 }, { id: 2 }],
    counts: { ready: 2 },
    isRestore: false,
  });
  const out = await page.__e2eImportText({ text: 'x', name: 'ok.csv', source: 'alipay' });
  eq(out && out.ok, true, 'B2 开发环境解析成功');
  eq(out && out.total, 2, 'B2 返回账单数');
  eq(writeCalls.length, 1, 'B2 写入一次临时文件');
  assert(
    /^\/usr\/__e2e_import__\/e2e-\d+-[a-z0-9]+-ok\.csv$/.test(writeCalls[0].p),
    'B2 临时文件位于固定目录且自动生成文件名：' + writeCalls[0].p
  );
  eq(removeCalls.length, 1, 'B2 解析后清理临时文件');
  eq(removeCalls[0], writeCalls[0].p, 'B2 清理的是本次临时文件');
  eq(appData.__importSession && appData.__importSession.source, 'alipay', 'B2 写入导入会话');

  // B3 路径穿越 / 扩展名限制
  async function runName(name) {
    writeCalls.length = 0;
    removeCalls.length = 0;
    parseResult = Promise.resolve({ bills: [], counts: { ready: 0 } });
    await page.__e2eImportText({ text: 'x', name: name, source: 'alipay' });
    return writeCalls[0] && writeCalls[0].p;
  }
  const traversal = await runName('../../legacy/restore-safety.json');
  assert(traversal.indexOf('/usr/__e2e_import__/') === 0, 'B3 路径穿越被限制在固定临时目录');
  eq(traversal.indexOf('..') >= 0, false, 'B3 生成路径不含 ..');
  eq(traversal.indexOf('/legacy/') >= 0, false, 'B3 不写入 legacy 目录');
  assert(/\.json$/.test(traversal), 'B3 合法扩展名 json 保留');
  eq(removeCalls[0], traversal, 'B3 临时文件已清理');

  const windowsPath = await runName('C:\\Windows\\evil.exe');
  assert(/\.csv$/.test(windowsPath), 'B3 非白名单扩展名回退 csv');
  eq(windowsPath.indexOf('\\') >= 0, false, 'B3 路径不含反斜杠');
  eq(windowsPath.indexOf('/usr/__e2e_import__/') === 0, true, 'B3 Windows 风格路径不能跳出临时目录');

  const zipPath = await runName('a.zip');
  assert(/\.zip$/.test(zipPath), 'B3 zip 扩展名保留（供拒绝路径测试）');

  const dotPath = await runName('..');
  assert(/import\.csv$/.test(dotPath), 'B3 纯 .. 文件名回退安全默认名：' + dotPath);

  /* ==================== C. 静态契约 ==================== */
  console.log('C. 静态契约');

  const importJs = read('packages/importer/pages/import/import.js');
  const methodStart = importJs.indexOf('__e2eImportText(payload)');
  const guardIdx = importJs.indexOf('env.isDevEnv()', methodStart);
  const writeIdx = importJs.indexOf('fs.writeText(', methodStart);
  const parseIdx = importJs.indexOf('detector', methodStart);
  assert(methodStart > 0, 'C1 存在 __e2eImportText');
  assert(guardIdx > methodStart, 'C2 方法内有环境守卫');
  assert(guardIdx < writeIdx, 'C3 守卫在写临时文件之前');
  assert(guardIdx < parseIdx, 'C4 守卫在解析之前');
  assert(importJs.indexOf('env.isDevEnv()', methodStart) < importJs.indexOf('.then(', methodStart), 'C5 守卫是同步前置检查');
  assert(importJs.indexOf('E2E_ALLOWED_EXT') >= 0, 'C5b 存在扩展名白名单');
  assert(importJs.indexOf("split('/')") >= 0, 'C5c 文件名只取 basename，防路径穿越');

  const importWxml = read('packages/importer/pages/import/import.wxml');
  eq(importWxml.indexOf('__e2eImportText') >= 0, false, 'C6 注入入口不出现在 WXML（无 UI 暴露）');

  const appJson = read('app.json');
  eq(appJson.indexOf('__e2eImportText') >= 0, false, 'C7 注入入口未注册到 app.json');

  const runJs = read('tests/e2e/run.js');
  eq(runJs.indexOf('rmSync') >= 0, false, 'C8 E2E 发布截图不再删除任何文件');
  eq(runJs.indexOf('unlinkSync') >= 0, false, 'C9 E2E 发布截图不使用 unlink');
  eq(runJs.indexOf("'docs'") >= 0, false, 'C10 E2E 不直接拼接 Git 基线截图目录');

  const configJs = read('tests/e2e/config.js');
  assert(configJs.indexOf("'artifacts'") >= 0, 'C11 截图写入 artifacts 目录');
  assert(configJs.indexOf('RUN_ID') >= 0, 'C12 每轮使用独立 RUN_ID');
  assert(configJs.indexOf('path.join(ARTIFACTS_ROOT, RUN_ID)') >= 0, 'C13 截图目录 = artifacts/e2e/<runId>');

  const gitignore = read('.gitignore');
  assert(/^artifacts\/$/m.test(gitignore), 'C14 artifacts/ 已被 git 忽略');

  /* ---------- 汇总 ---------- */
  console.log('\nimport-e2e-safety tests: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
  console.log('ALL IMPORT E2E SAFETY TESTS PASSED');
})();
