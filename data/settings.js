/**
 * data/settings.js — 设置读写（Mini 版）
 *
 * v0.2.0 仅保留少量必要设置；后续版本再扩展。
 */
const fs = require('./fs');
const paths = require('./paths');

const DEFAULT_SETTINGS = {
  currency: '¥',
  theme: 'dark', // Mini 固定深色玻璃风格
};

/** 首次启动写入默认设置（已存在则保留） */
function ensureSettings() {
  const existing = fs.readJSON(paths.FILE.settings, null);
  if (existing) return Object.assign({}, DEFAULT_SETTINGS, existing);
  fs.writeJSON(paths.FILE.settings, DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

/** 读设置 */
function getSettings() {
  return Object.assign({}, DEFAULT_SETTINGS, fs.readJSON(paths.FILE.settings, {}));
}

/** 更新设置（浅合并） */
function updateSettings(patch) {
  const next = Object.assign({}, getSettings(), patch || {});
  fs.writeJSON(paths.FILE.settings, next);
  return next;
}

module.exports = {
  DEFAULT_SETTINGS,
  ensureSettings,
  getSettings,
  updateSettings,
};
