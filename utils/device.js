/**
 * utils/device.js — 双端适配（Android / iOS）
 *
 * 统一获取窗口、状态栏、安全区域、右上角胶囊（微信菜单按钮）信息，
 * 供自定义 Header、顶部 Tabs、FAB、Bottom Sheet 使用。
 *
 * 原则：
 * - 只用微信 API（wx.getWindowInfo / getMenuButtonBoundingClientRect），无机型硬编码；
 * - 没有 safeArea 的设备必须有 fallback；
 * - 结果只测量一次并缓存（窗口尺寸在普通生命周期内不变）。
 */

let _cache = null;

function readWindowInfo() {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      return wx.getWindowInfo() || {};
    }
  } catch (e) {
    /* fall through */
  }
  try {
    if (typeof wx.getSystemInfoSync === 'function') {
      return wx.getSystemInfoSync() || {};
    }
  } catch (e) {
    /* fall through */
  }
  return {};
}

function readMenuButton() {
  try {
    if (typeof wx.getMenuButtonBoundingClientRect === 'function') {
      return wx.getMenuButtonBoundingClientRect() || null;
    }
  } catch (e) {
    /* fall through */
  }
  return null;
}

function measure() {
  if (_cache) return _cache;

  const info = readWindowInfo();

  const platform = info.platform || 'devtools';
  const windowWidth = info.windowWidth || 375;
  const windowHeight = info.windowHeight || 667;
  const pixelRatio = info.pixelRatio || 2;
  const statusBarHeight = info.statusBarHeight || 20;

  // 安全区域（刘海 / 灵动岛 / Home Indicator）
  const safeArea = info.safeArea || null;
  let safeInsets = { top: statusBarHeight, bottom: 0, left: 0, right: 0 };
  if (safeArea) {
    safeInsets = {
      top: safeArea.top,
      bottom: Math.max(0, windowHeight - safeArea.bottom),
      left: safeArea.left,
      right: Math.max(0, windowWidth - safeArea.right),
    };
  }
  // top inset 至少覆盖状态栏
  safeInsets.top = Math.max(safeInsets.top, statusBarHeight);

  // 右上角胶囊（自定义 Header 内容与胶囊垂直对齐）
  const menu = readMenuButton();
  const menuHeight = menu ? menu.height : 32;
  const menuTop = menu ? menu.top : statusBarHeight + 6;
  const gap = Math.max(4, Math.round(menuTop - statusBarHeight));
  const navBarHeight = menuHeight + gap * 2;
  const headerHeight = statusBarHeight + navBarHeight;

  _cache = {
    platform,
    isIOS: platform === 'ios',
    isAndroid: platform === 'android',
    isDevtools: platform === 'devtools',
    windowWidth,
    windowHeight,
    pixelRatio,
    statusBarHeight,
    safeArea,
    safeInsets,
    // 底部安全区（Home Indicator 高度）
    safeBottom: safeInsets.bottom,
    // 右上角胶囊（带 fallback）
    menu: menu
      ? {
          top: menu.top,
          bottom: menu.bottom,
          left: menu.left,
          right: menu.right,
          width: menu.width,
          height: menu.height,
        }
      : null,
    gap,
    navBarHeight,
    headerHeight, // 含状态栏的总 Header 高度
  };

  return _cache;
}

/** 重新测量（极少需要，例如屏幕旋转/窗口变化） */
function reset() {
  _cache = null;
}

/**
 * 窄屏阈值（px，即 windowWidth，不是 rpx）。
 * 与历史 WXSS `@media (max-width: 360px)` 口径完全一致：≤360 算窄屏。
 * ⚠️ Skyline 渲染下 WXSS 宽度断点不生效（官方 media queries 仅支持 DarkMode），
 * 故窄屏差异化统一走本函数 + class 切换，阈值只此一处，不要在业务代码里另写数字。
 */
const NARROW_MAX_WIDTH = 360;

/**
 * 是否窄屏（windowWidth ≤ 360）。
 * 宽度取自 measure() 的缓存值；窗口尺寸变化后需先 reset()（utils/viewport 的
 * onWindowResize 链路已自动 reset 再通知，直接调用即可拿到新值）。
 */
function isNarrowScreen() {
  return measure().windowWidth <= NARROW_MAX_WIDTH;
}

module.exports = {
  measure,
  get: measure,
  reset,
  NARROW_MAX_WIDTH,
  isNarrowScreen,
};
