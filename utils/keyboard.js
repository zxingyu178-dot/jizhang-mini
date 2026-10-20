/**
 * utils/keyboard.js — 键盘生命周期公共工具（v0.8.1）
 *
 * 解决真机问题：Android 微信下输入框聚焦弹起原生键盘后，若「先关闭 Bottom Sheet、
 * 后收键盘」，原生页面会停留在键盘调整过的位置（Header 被顶走、底部白条）。
 *
 * 统一做法：任何需要关闭输入态（关 Sheet / 返回上一页）前，先 await hideKeyboard()，
 * 确认键盘收起后再播放关闭动画或导航。
 *
 * 健壮性：
 * - wx.hideKeyboard 在部分基础库可能无参 / 不回调 complete；
 * - 无论 API 是否抛错、complete 是否触发，都有极短超时兜底，
 *   绝不因为键盘回调异常让 Sheet 永远关不上、页面永远退不出。
 */

/** 收起键盘，返回 Promise；最多等待 fallbackMs 即 resolve（默认 120ms） */
function hideKeyboard(fallbackMs) {
  const wait = typeof fallbackMs === 'number' ? fallbackMs : 120;
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      if (typeof wx !== 'undefined' && typeof wx.hideKeyboard === 'function') {
        wx.hideKeyboard({ complete: done, success: done, fail: done });
      }
    } catch (e) {
      /* API 异常，走超时兜底 */
    }
    // 兜底：complete 不触发 / 不支持参数时，也能继续
    setTimeout(done, wait);
  });
}

module.exports = {
  hideKeyboard,
};
