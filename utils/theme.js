/**
 * utils/theme.js — 主题管理器（v0.9.0 Theme & Appearance）
 *
 * 模型：
 *   themeMode      = 'dark' | 'light' | 'system'（用户选择）
 *   effectiveTheme = 'dark' | 'light'（实际生效；system 时跟随系统）
 *
 * 职责：读取 / 持久化 settings.theme、解析 effectiveTheme、系统主题变化监听、
 *       通知所有订阅页面。默认 dark；现有用户 theme=dark 保持，绝不自动变 system。
 *
 * fail-safe：settings.theme 出现非法值（blue/123/null）一律归一为 dark，不崩。
 *
 * 该模块只依赖极轻的 data/fs + data/paths，不依赖数据层 init，因此可在
 * app.onLaunch 最前面（数据层初始化之前）初始化，尽量避免冷启动「黑闪」。
 *
 * 系统主题变化：app.json 已配置 "darkmode": true，wx.onThemeChange 才会触发。
 */
const fs = require('../data/fs');
const paths = require('../data/paths');

const VALID_MODES = ['dark', 'light', 'system'];
const DEFAULT_MODE = 'dark';

/** 归一主题模式：非法值统一 dark（fail-safe） */
function normalizeMode(m) {
  return VALID_MODES.indexOf(m) >= 0 ? m : DEFAULT_MODE;
}

/** 读取系统当前外观：dark | light（接口做容错，取不到默认 dark） */
function getSystemTheme() {
  try {
    if (wx.getAppBaseInfo) {
      const t = wx.getAppBaseInfo().theme;
      if (t === 'light' || t === 'dark') return t;
    }
    const info = wx.getSystemInfoSync ? wx.getSystemInfoSync() : null;
    if (info && (info.theme === 'light' || info.theme === 'dark')) return info.theme;
  } catch (e) {
    /* 忽略，默认 dark */
  }
  return 'dark';
}

function computeEffective(mode) {
  return mode === 'system' ? getSystemTheme() : mode;
}

/* ---- 模块状态 ---- */
let _mode = DEFAULT_MODE;
let _effective = 'dark';
let _started = false;
let _listeners = [];

function snapshot() {
  return {
    mode: _mode,
    effective: _effective,
    themeMode: _mode,
    effectiveTheme: _effective,
    themeClass: 'theme-' + _effective,
  };
}

function emit() {
  const s = snapshot();
  _listeners.slice().forEach((cb) => {
    try {
      cb(s);
    } catch (e) {
      /* 单页回调异常不影响其它页 */
    }
  });
}

/** 初始化：读取 settings.theme（文件缺失/损坏 → dark），监听系统主题。幂等。 */
function init() {
  if (_started) return snapshot();
  let raw = null;
  try {
    raw = fs.readJSON(paths.FILE.settings, null);
  } catch (e) {
    raw = null;
  }
  _mode = normalizeMode(raw && raw.theme);
  _effective = computeEffective(_mode);

  if (wx.onThemeChange) {
    wx.onThemeChange((res) => {
      const sys = res && res.theme === 'light' ? 'light' : 'dark';
      // 仅 system 模式跟随系统；手动 dark/light 不被系统改变。
      if (_mode !== 'system') return;
      if (sys === _effective) return;
      _effective = sys;
      emit();
    });
  }
  _started = true;
  return snapshot();
}

/** 订阅主题变化，返回取消函数 */
function subscribe(cb) {
  if (typeof cb !== 'function') return function off() {};
  _listeners.push(cb);
  return function off() {
    const i = _listeners.indexOf(cb);
    if (i >= 0) _listeners.splice(i, 1);
  };
}

function getThemeMode() {
  return _mode;
}
function getEffectiveTheme() {
  return _effective;
}
function getThemeClass() {
  return 'theme-' + _effective;
}

/**
 * 设置主题模式：归一 → 重算 effective → 持久化 → 变化时通知。
 * 持久化时保留 settings 其它字段（currency/budget），只更新 theme。
 */
function setThemeMode(mode) {
  const next = normalizeMode(mode);
  const prevMode = _mode;
  const prevEffective = _effective;
  _mode = next;
  _effective = computeEffective(next);
  try {
    const settings = fs.readJSON(paths.FILE.settings, null) || {};
    settings.theme = next;
    fs.writeJSON(paths.FILE.settings, settings);
  } catch (e) {
    /* 持久化失败不阻断内存生效（下次启动再尝试） */
  }
  // mode 变化也必须通知：例如 light → system（系统恰为浅色）时 effective 不变，
  // 但选中对勾需从「浅色」移到「跟随系统」，页面 data.themeMode 也要更新。
  if (_effective !== prevEffective || next !== prevMode) emit();
  return snapshot();
}

/**
 * 绑定页面：自动 setData({ themeMode, effectiveTheme, themeClass }) 并订阅变更，
 * 页面根容器写 class="xxx-page {{themeClass}}" 即可继承整套 CSS 变量。
 * 返回取消函数，在页面 onUnload 调用。
 * 注意：本方法只改主题 class，不 reLaunch、不重载、不重置数据，不丢页面状态。
 */
function bindPage(page) {
  if (!page) return function off() {};
  try {
    page.setData(snapshot());
  } catch (e) {
    /* 忽略 */
  }
  return subscribe((s) => {
    try {
      page.setData(s);
    } catch (e) {
      /* 忽略 */
    }
  });
}

/* ---- 测试辅助 ---- */
function _resetForTest() {
  _started = false;
  _mode = DEFAULT_MODE;
  _effective = 'dark';
  _listeners = [];
}

module.exports = {
  VALID_MODES,
  DEFAULT_MODE,
  normalizeMode,
  getSystemTheme,
  init,
  subscribe,
  getThemeMode,
  getEffectiveTheme,
  getThemeClass,
  setThemeMode,
  bindPage,
  _resetForTest,
};
