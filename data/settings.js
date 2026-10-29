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
const statConfig = require('./statistics/config');

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

/** 统一规范化：默认值打底 + theme 合法化 + statistics 配置规范化 */
function canonicalize(raw) {
  const merged = Object.assign({}, DEFAULT_SETTINGS, raw || {});
  merged.theme = canonicalizeTheme(merged.theme);
  merged.statistics = statConfig.normalizeConfig(merged.statistics);
  return merged;
}

/**
 * 首次启动写入默认设置；已存在则保留并规范化 theme / statistics。
 * 仅在完整性扫描通过后调用（store.init 内），此时落盘不违反 fail-closed。
 * 规范化结果与磁盘原文不一致时才写回。
 */
function ensureSettings() {
  const existing = fs.readJSON(paths.FILE.settings, null);
  if (!existing) {
    fs.writeJSONAtomic(paths.FILE.settings, canonicalize(null));
    return canonicalize(null);
  }
  const canon = canonicalize(existing);
  if (JSON.stringify(canon) !== JSON.stringify(existing)) {
    fs.writeJSONAtomic(paths.FILE.settings, canon);
  }
  return canon;
}

/** 读设置（返回值保证 theme / statistics 已规范化；只读，不写盘） */
function getSettings() {
  return canonicalize(fs.readJSON(paths.FILE.settings, {}));
}

/**
 * 更新设置（浅合并，theme / statistics 一并规范化；原子写）。
 * 严格读：原文件存在但损坏直接抛错（fail-closed），绝不拿默认值覆盖，
 * 避免把用户已有的 Budget Rules / 自定义设置冲掉。
 * 保存统计模块时应传入完整规范化 statistics 对象（浅合并不破坏其他设置）。
 */
function updateSettings(patch) {
  const current = fs.exists(paths.FILE.settings)
    ? fs.readJSONStrict(paths.FILE.settings)
    : {};
  const next = canonicalize(Object.assign({}, current, patch || {}));
  fs.writeJSONAtomic(paths.FILE.settings, next);
  return next;
}

module.exports = {
  VALID_THEMES,
  DEFAULT_THEME,
  canonicalizeTheme,
  DEFAULT_SETTINGS,
  statisticsConfig: statConfig,
  ensureSettings,
  getSettings,
  updateSettings,
};
