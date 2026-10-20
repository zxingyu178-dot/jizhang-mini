/**
 * tests/keyboard-viewport.test.js — 键盘生命周期 / viewport 恢复测试（v0.8.1）
 *
 * 验证：
 * - utils/keyboard.hideKeyboard：complete 触发即 resolve；complete 不触发有超时兜底；
 *   API 缺失 / 抛错也能 resolve，绝不卡住关闭流程。
 * - utils/viewport：键盘高度「从有到无」、窗口 resize 触发 device 重测并通知页面；
 *   start 幂等；onRecover 可取消；键盘一直为 0 不误触发。
 *
 * 运行：node tests/keyboard-viewport.test.js
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
function eq(a, b, msg) {
  assert(a === b, msg + '（期望 ' + b + '，实际 ' + a);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---- mock wx（须在 require 被测模块前设置） ---- */
const kbCbs = [];
const resizeCbs = [];
let hideKeyboardImpl = null;
global.wx = {
  getWindowInfo: () => ({
    platform: 'android',
    windowWidth: 360,
    windowHeight: 720,
    statusBarHeight: 24,
    safeArea: { top: 24, bottom: 700, left: 0, right: 360 },
  }),
  getMenuButtonBoundingClientRect: () => ({
    top: 30, bottom: 62, left: 280, right: 350, width: 70, height: 32,
  }),
  hideKeyboard: (opts) => {
    if (hideKeyboardImpl) hideKeyboardImpl(opts);
  },
  onKeyboardHeightChange: (cb) => kbCbs.push(cb),
  onWindowResize: (cb) => resizeCbs.push(cb),
};

const keyboard = require(path.join(__dirname, '..', 'utils', 'keyboard'));
const viewport = require(path.join(__dirname, '..', 'utils', 'viewport'));

async function run() {
  /* ========== keyboard.hideKeyboard ========== */

  // 1. complete 正常触发 → resolve
  hideKeyboardImpl = (opts) => opts.complete();
  let done1 = false;
  await keyboard.hideKeyboard(30).then(() => { done1 = true; });
  assert(done1, 'complete 触发后应 resolve');

  // 2. success 触发也能 resolve
  hideKeyboardImpl = (opts) => opts.success();
  let done2 = false;
  await keyboard.hideKeyboard(30).then(() => { done2 = true; });
  assert(done2, 'success 触发后应 resolve');

  // 3. complete 不触发 → 超时兜底 resolve
  hideKeyboardImpl = () => {};
  let done3 = false;
  const t0 = Date.now();
  await keyboard.hideKeyboard(15).then(() => { done3 = true; });
  assert(done3, 'complete 不触发时应靠超时兜底 resolve');
  assert(Date.now() - t0 >= 14, '兜底应等到指定时间，不应提前 resolve');

  // 4. hideKeyboard 抛错 → 兜底 resolve
  hideKeyboardImpl = () => { throw new Error('boom'); };
  let done4 = false;
  await keyboard.hideKeyboard(5).then(() => { done4 = true; });
  assert(done4, 'hideKeyboard 抛错时应兜底 resolve');

  // 5. wx.hideKeyboard 不存在 → 兜底 resolve
  global.wx.hideKeyboard = null;
  let done5 = false;
  await keyboard.hideKeyboard(5).then(() => { done5 = true; });
  assert(done5, 'API 不存在时应兜底 resolve');

  // 恢复 mock（供其它用例）
  global.wx.hideKeyboard = (opts) => { if (hideKeyboardImpl) hideKeyboardImpl(opts); };

  /* ========== viewport ========== */

  // 6. start 幂等：重复 start 只注册一次监听
  viewport._resetForTest();
  kbCbs.length = 0;
  resizeCbs.length = 0;
  viewport.start();
  viewport.start();
  eq(kbCbs.length, 1, 'start 应幂等，只注册一个键盘监听');
  eq(resizeCbs.length, 1, 'start 应幂等，只注册一个窗口监听');
  const kbCb = kbCbs[0];

  // 7. 键盘高度从有到无 → 触发恢复，通知 onRecover
  let recovered = 0;
  let lastInfo = null;
  viewport.onRecover((info) => { recovered++; lastInfo = info; });
  kbCb({ height: 300 });
  kbCb({ height: 0 });
  await sleep(100);
  eq(recovered, 1, '键盘归 0 应触发一次恢复');
  assert(lastInfo && lastInfo.windowHeight === 720, '恢复回调应带重新测量的窗口信息');

  // 8. 键盘一直为 0（无「从有到无」）→ 不误触发
  kbCb({ height: 0 });
  kbCb({ height: 0 });
  await sleep(100);
  eq(recovered, 1, '键盘一直为 0 不应触发恢复');

  // 9. onRecover 返回取消函数，取消后不再通知
  const off = viewport.onRecover(() => { recovered++; });
  assert(typeof off === 'function', 'onRecover 应返回取消函数');
  off();
  kbCb({ height: 200 });
  kbCb({ height: 0 });
  await sleep(100);
  eq(recovered, 2, '取消订阅后该回调不应再被通知（仅用例7的回调+1）');

  // 10. 窗口 resize → 触发恢复
  const before = recovered;
  resizeCbs[0]({ windowWidth: 360, windowHeight: 720 });
  await sleep(100);
  assert(recovered > before, '窗口 resize 应触发恢复');

  // 11. 恢复后 device 缓存已重置：测量到新值
  global.wx.getWindowInfo = () => ({
    platform: 'android',
    windowWidth: 360,
    windowHeight: 800,
    statusBarHeight: 24,
    safeArea: { top: 24, bottom: 780, left: 0, right: 360 },
  });
  kbCb({ height: 200 });
  kbCb({ height: 0 });
  await sleep(100);
  assert(lastInfo.windowHeight === 800, '恢复重测应读到更新后的窗口高度');

  /* ========== 汇总 ========== */
  console.log('\nkeyboard/viewport: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
}

run().catch((e) => {
  console.error('测试异常', e);
  process.exit(1);
});
