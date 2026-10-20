/**
 * utils/viewport.js — Android 键盘 / 窗口恢复保险（v0.8.1）
 *
 * 背景：部分 Android 微信下，输入框弹起原生键盘（adjust-position）后，
 * 若先关 Bottom Sheet、后收键盘，原生页面可能停留在键盘上推的位置，
 * 表现为 Header 被顶到状态栏、页面整体上移、底部露出系统白色。
 *
 * 主修在「先收键盘再关 Sheet / 返回」（utils/keyboard.js）；本模块是第二层保险：
 * 监听键盘高度归零与窗口 resize，确认恢复后 device.reset() 重新测量
 * windowHeight / safeArea，并通知页面重新 setData 布局尺寸。
 *
 * 全局只需 start() 一次（app onLaunch）；含输入 Sheet 的页面用 onRecover 订阅。
 */
const device = require('./device');

let started = false;
let lastKeyboardHeight = 0;
let recoverTimer = null;
const recoverCbs = new Set();

function notifyRecover() {
  try {
    device.reset();
    const info = device.get();
    recoverCbs.forEach((cb) => {
      try {
        cb(info);
      } catch (e) {
        /* 单个页面回调异常不影响其它页面 */
      }
    });
  } catch (e) {
    /* 重测失败时静默，下一次键盘/窗口事件再试 */
  }
}

function scheduleRecover() {
  if (recoverTimer) clearTimeout(recoverTimer);
  recoverTimer = setTimeout(notifyRecover, 60);
}

/** 订阅 viewport 恢复事件；返回取消订阅函数 */
function onRecover(cb) {
  if (typeof cb === 'function') recoverCbs.add(cb);
  return () => {
    recoverCbs.delete(cb);
  };
}

/** 全局启动键盘 / 窗口监听（幂等，重复调用安全） */
function start() {
  if (started) return;
  started = true;
  try {
    if (typeof wx !== 'undefined' && typeof wx.onKeyboardHeightChange === 'function') {
      wx.onKeyboardHeightChange((res) => {
        const h = (res && res.height) || 0;
        if (lastKeyboardHeight > 0 && h === 0) {
          // 键盘从有到无：触发 viewport 恢复
          scheduleRecover();
        }
        lastKeyboardHeight = h;
      });
    }
  } catch (e) {
    /* 不支持该 API 的环境忽略 */
  }
  try {
    if (typeof wx !== 'undefined' && typeof wx.onWindowResize === 'function') {
      wx.onWindowResize(() => {
        scheduleRecover();
      });
    }
  } catch (e) {
    /* 忽略 */
  }
}

/** 手动重置测量（供页面在需要时主动触发） */
function reset() {
  device.reset();
}

/** 测试辅助：重置模块内部状态（仅测试用） */
function _resetForTest() {
  started = false;
  lastKeyboardHeight = 0;
  if (recoverTimer) {
    clearTimeout(recoverTimer);
    recoverTimer = null;
  }
  recoverCbs.clear();
}

module.exports = {
  start,
  reset,
  onRecover,
  _resetForTest,
};
