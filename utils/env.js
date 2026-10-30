// utils/env.js
// 运行环境识别：把测试专用能力（数据注入 / 清理）隔离在正式发布环境之外。
// 所有依赖此判断的测试逻辑都必须 fail-closed：无法确定环境时一律按 release 处理。
//
// envVersion 取值：'develop'（开发工具/模拟器）、'trial'（体验版）、'release'（正式版）。

function getEnvVersion() {
  try {
    const info = wx.getAccountInfoSync();
    const v = info && info.miniProgram && info.miniProgram.envVersion;
    return v === 'develop' || v === 'trial' || v === 'release' ? v : 'release';
  } catch (e) {
    return 'release';
  }
}

/** 是否允许测试专用能力（仅 develop/trial；release 与无法识别时一律拒绝） */
function isTestEnv() {
  const v = getEnvVersion();
  return v === 'develop' || v === 'trial';
}

/**
 * 是否为严格开发环境（仅 develop；trial/release 与无法识别时一律拒绝）。
 * 直接写正式账本、有数据副作用的旧自检入口（__selftest / __migtest）只允许 develop：
 * trial 是会分发给真实用户的体验版，不能在其上跑破坏性自检。
 */
function isDevEnv() {
  return getEnvVersion() === 'develop';
}

module.exports = { getEnvVersion, isTestEnv, isDevEnv };
