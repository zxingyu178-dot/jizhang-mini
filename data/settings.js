/**
 * data/settings.js — 设置读写（Mini 版）
 *
 * v0.9.1：theme 唯一合法值为 dark / light / system。启动时 Theme Manager 与
 * Storage Integrity 均为只读（fail-closed，不提前写文件）；完整性扫描通过后，
 * 由 ensureSettings 把磁盘上的非法 theme 规范为 dark 并落盘，从而保证
 * Theme Manager / Settings / Backup / Backup Validator 四者口径一致，
 * 不会出现「自己生成的备份（含非法 theme）又被自己拒绝恢复」。
 */
const fs = require('./fs');
const paths = require('./paths');

/** 主题合法值（与 utils/theme.VALID_MODES 一致）；非法统一 dark。 */
const VALID_THEMES = ['dark', 'light', 'system'];
const DEFAULT_THEME = 'dark';

/** 归一主题：非法值统一 dark */
function canonicalizeTheme(t) {
  return VALID_THEMES.indexOf(t) >= 0 ? t : DEFAULT_THEME;
}

const DEFAULT_SETTINGS = {
  currency: '¥',
  theme: DEFAULT_THEME,
};

/**
 * 首次启动写入默认设置；已存在则保留并规范化 theme。
 * 仅在完整性扫描通过后调用（store.init 内），此时落盘不违反 fail-closed。
 * 非法 theme 会被修正为 dark 并写回磁盘。
 */
function ensureSettings() {
  const existing = fs.readJSON(paths.FILE.settings, null);
  if (existing) {
    const merged = Object.assign({}, DEFAULT_SETTINGS, existing);
    const canon = canonicalizeTheme(merged.theme);
    if (canon !== existing.theme) {
      merged.theme = canon;
      fs.writeJSON(paths.FILE.settings, merged);
    }
    return merged;
  }
  fs.writeJSON(paths.FILE.settings, DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

/** 读设置（返回值保证 theme 已规范化；只读，不写盘） */
function getSettings() {
  const merged = Object.assign({}, DEFAULT_SETTINGS, fs.readJSON(paths.FILE.settings, {}));
  merged.theme = canonicalizeTheme(merged.theme);
  return merged;
}

/** 更新设置（浅合并，theme 一并规范化） */
function updateSettings(patch) {
  const next = Object.assign({}, getSettings(), patch || {});
  next.theme = canonicalizeTheme(next.theme);
  fs.writeJSON(paths.FILE.settings, next);
  return next;
}

module.exports = {
  VALID_THEMES,
  DEFAULT_THEME,
  canonicalizeTheme,
  DEFAULT_SETTINGS,
  ensureSettings,
  getSettings,
  updateSettings,
};
