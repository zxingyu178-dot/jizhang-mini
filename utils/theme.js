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
// 单调递增的主题变更序号：每次 emit（主题模式 / 生效色变化）+1，
// 供页面判断「本次回前台是否仅由主题变化引起」，避免 onShow 全量刷新冲掉
// 已由主题订阅做的局部 recolor（如统计面板展开 / 选中态）。
let _changeCounter = 0;
// 仅在「用户主动 setThemeMode」且主题确实变化时递增的序号：reloadFromStorage（备份
// 恢复 / settings 被外部覆盖）、refreshSystemTheme、system 模式 onThemeChange 都不递增。
// 页面 onShow 据此判断是否为纯主题切换，避免备份恢复（账单已变）被误判而跳过统计刷新。
let _themeOnlyCounter = 0;
// Native Chrome Guard 监听者（系统主题变化时，手动模式下重守原生窗口颜色）。
let _chromeListeners = [];

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
  _changeCounter += 1;
  const s = snapshot();
  _listeners.slice().forEach((cb) => {
    try {
      cb(s);
    } catch (e) {
      /* 单页回调异常不影响其它页 */
    }
  });
}

/**
 * 触发 Native Chrome Guard：系统主题变化时，即使 App 为手动模式（内容不跟随），
 * 微信原生 Chrome（状态栏 / 页面背景 / 切换动画）也可能被系统重置，
 * 通知 app 重新按当前 effectiveTheme 守住原生窗口颜色；内容主题不变。
 */
function emitChrome() {
  _chromeListeners.slice().forEach((cb) => {
    try {
      cb(_effective);
    } catch (e) {
      /* 忽略单回调异常 */
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
      // system 模式：内容跟随系统变化。
      if (_mode === 'system') {
        if (sys === _effective) return;
        _effective = sys;
        emit();
      } else {
        // 手动 dark/light：内容不跟随，但原生 Chrome 可能被系统重置，重守一次。
        emitChrome();
      }
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

/**
 * 订阅 Native Chrome Guard：系统主题变化（手动模式）时回调，
 * 由 app 重新 syncChrome。返回取消函数。
 */
function onChromeNeed(cb) {
  if (typeof cb !== 'function') return function off() {};
  _chromeListeners.push(cb);
  return function off() {
    const i = _chromeListeners.indexOf(cb);
    if (i >= 0) _chromeListeners.splice(i, 1);
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
/** 当前主题变更序号（每次 emit 递增），用于 onShow 识别主题变化 */
function getChangeCounter() {
  return _changeCounter;
}
/** 纯用户主题切换序号（仅 setThemeMode 递增），用于 onShow 精确识别可跳过统计刷新的场景 */
function getThemeOnlyCounter() {
  return _themeOnlyCounter;
}

/**
 * 设置主题模式（用户主动选择）：**先持久化 settings.json，写成功后才更新内存并通知**。
 * 持久化时保留 settings 其它字段（currency/budget），只更新 theme。
 * 写失败：内存保持旧主题、不 emit（不假成功），返回 { ok:false }，由 UI 提示重试。
 * 成功：返回 { ok:true, ...snapshot }。
 */
function setThemeMode(mode) {
  const next = normalizeMode(mode);
  // 1) 先写磁盘；失败则保持旧主题，绝不「视觉成功、磁盘失败」。
  try {
    const settings = fs.exists(paths.FILE.settings)
      ? fs.readJSONStrict(paths.FILE.settings)
      : {};
    settings.theme = next;
    fs.writeJSONAtomic(paths.FILE.settings, settings);
  } catch (e) {
    return Object.assign({ ok: false }, snapshot());
  }
  // 2) 写成功后才更新内存。
  const prevMode = _mode;
  const prevEffective = _effective;
  _mode = next;
  _effective = computeEffective(next);
  // mode 变化也必须通知：例如 light → system（系统恰为浅色）时 effective 不变，
  // 但选中对勾需从「浅色」移到「跟随系统」，页面 data.themeMode 也要更新。
  if (_effective !== prevEffective || next !== prevMode) {
    emit();
    // 仅用户主动 setThemeMode 才递增纯主题序号；备份恢复走 reloadFromStorage 不递增。
    _themeOnlyCounter += 1;
  }
  return Object.assign({ ok: true }, snapshot());
}

/**
 * 从磁盘 settings.theme 重新加载（备份恢复 / settings 被外部覆盖后调用）：
 * 重新读取 → 归一 → 重算 effective → 变化时通知。
 * 不重新注册系统主题监听，也不依赖 init 是否已完成（恢复场景下通常已 init）。
 * 用于「恢复了一个浅色备份，当前 App 立即变浅色，无需重启」。
 */
function reloadFromStorage() {
  let raw = null;
  try {
    raw = fs.readJSON(paths.FILE.settings, null);
  } catch (e) {
    raw = null;
  }
  const next = normalizeMode(raw && raw.theme);
  const prevMode = _mode;
  const prevEffective = _effective;
  _mode = next;
  _effective = computeEffective(next);
  if (_effective !== prevEffective || next !== prevMode) emit();
  return snapshot();
}

/**
 * 前台重新校准系统主题（app.onShow 最前面调用）：
 *   - mode !== 'system'：什么都不做（手动主题不跟随系统），直接返回当前快照；
 *   - mode === 'system'：重新读取系统主题，与当前 effective 比较，有变化才更新并 emit。
 * 用于补偿「小程序在后台期间系统切换外观、微信未及时下发 onThemeChange」的场景，
 * 与实时 onThemeChange、冷启动 init 三条路径全部闭环。
 */
function refreshSystemTheme() {
  if (_mode !== 'system') return snapshot();
  const sys = getSystemTheme();
  if (sys !== _effective) {
    _effective = sys;
    emit();
  }
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
  _chromeListeners = [];
  _changeCounter = 0;
  _themeOnlyCounter = 0;
}

module.exports = {
  VALID_MODES,
  DEFAULT_MODE,
  normalizeMode,
  getSystemTheme,
  init,
  subscribe,
  onChromeNeed,
  getThemeMode,
  getEffectiveTheme,
  getThemeClass,
  getChangeCounter,
  getThemeOnlyCounter,
  setThemeMode,
  reloadFromStorage,
  refreshSystemTheme,
  bindPage,
  _resetForTest,
};
