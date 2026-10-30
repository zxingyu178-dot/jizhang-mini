/**
 * tests/env.test.js — 运行环境守卫（v1.3.2 Gate 0）专项测试
 *
 * 验证 getEnvVersion / isTestEnv：
 *   develop/trial 允许测试能力；release、未知值、wx 缺失或抛错一律 fail-closed 拒绝。
 * 运行：node tests/env.test.js
 */
let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error('  FAIL: ' + msg); }
}
function eq(actual, expected, msg) {
  assert(actual === expected, msg + ' (expected=' + expected + ', actual=' + actual + ')');
}

const savedWx = global.wx;
function setWx(envVersion) {
  global.wx = {
    getAccountInfoSync() {
      if (envVersion === '__throw__') throw new Error('mock unavailable');
      return { miniProgram: { appId: 'wx', envVersion } };
    },
  };
}

// 每个用例重新 require，避免模块缓存影响（env 无内部状态，这里主要确保读取实时 wx）
function loadEnv() {
  delete require.cache[require.resolve('../utils/env')];
  return require('../utils/env');
}

console.log('环境识别与 fail-closed');
setWx('develop');
eq(loadEnv().getEnvVersion(), 'develop', 'develop 识别');
assert(loadEnv().isTestEnv() === true, 'develop 允许测试');

setWx('trial');
eq(loadEnv().getEnvVersion(), 'trial', 'trial 识别');
assert(loadEnv().isTestEnv() === true, 'trial 允许测试');

setWx('release');
eq(loadEnv().getEnvVersion(), 'release', 'release 识别');
assert(loadEnv().isTestEnv() === false, 'release 拒绝测试');

setWx('weird-unknown');
eq(loadEnv().getEnvVersion(), 'release', '未知 envVersion 回退 release');
assert(loadEnv().isTestEnv() === false, '未知值拒绝测试');

setWx('__throw__');
eq(loadEnv().getEnvVersion(), 'release', 'wx 抛错时回退 release');
assert(loadEnv().isTestEnv() === false, 'wx 抛错时 fail-closed');

// wx 完全缺失
global.wx = undefined;
eq(loadEnv().getEnvVersion(), 'release', 'wx 缺失时回退 release');
assert(loadEnv().isTestEnv() === false, 'wx 缺失时 fail-closed');

global.wx = savedWx;

console.log('\nenv tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
