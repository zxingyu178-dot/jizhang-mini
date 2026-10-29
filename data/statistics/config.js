/**
 * data/statistics/config.js — 统计模块配置合同（v1.3.0 Gate 3）
 *
 * 配置持久化在 settings.json 的 statistics 字段：
 *   { version: 1, modules: ['category-share', ...] }
 * 模块开关只控制「可选模块」；月度 / 年度 Hero 与月度最大单笔始终保留，
 * 不在可关闭范围内。数据合同不升级（Backup V3 原样保存整个 settings）。
 *
 * 规则：
 *   - 旧设置无 statistics → 默认配置；
 *   - 未知模块 ID 丢弃、重复 ID 去重；
 *   - 合法空数组表示用户关闭全部可选模块，不擅自重置为默认；
 *   - 配置损坏不抛错、不影响账单 / 备份恢复。
 */

const CONFIG_VERSION = 1;

/** 月度可选模块（顺序即 Bottom Sheet 展示顺序） */
const MONTHLY_MODULES = [
  'category-share',
  'daily-expense-trend',
  'cumulative-trend',
  'budget-analysis',
  'income-expense-compare',
  'custom-range',
];

/** 年度可选模块 */
const YEARLY_MODULES = [
  'year-monthly-trend',
  'year-review',
];

/** 全部合法模块 ID */
const VALID_MODULES = MONTHLY_MODULES.concat(YEARLY_MODULES);

/** 默认开启模块（custom-range 默认关闭） */
const DEFAULT_MODULES = [
  'category-share',
  'daily-expense-trend',
  'budget-analysis',
  'income-expense-compare',
  'year-monthly-trend',
  'year-review',
];

/** 默认配置（返回副本，避免外部 mutate） */
function defaultConfig() {
  return { version: CONFIG_VERSION, modules: DEFAULT_MODULES.slice() };
}

/**
 * 规范化统计配置。
 * @param {*} raw settings.statistics 原始值
 * @returns {{version:number, modules:string[]}}
 */
function normalizeConfig(raw) {
  if (raw == null || typeof raw !== 'object') return defaultConfig();
  if (!Array.isArray(raw.modules)) {
    // 显式带了坏的 modules 字段 → 视为空模块（不崩、不重置）；
    // 完全没有 modules 字段 → 默认配置。
    if (Object.prototype.hasOwnProperty.call(raw, 'modules')) {
      return { version: CONFIG_VERSION, modules: [] };
    }
    return defaultConfig();
  }
  const seen = new Set();
  const modules = [];
  raw.modules.forEach((id) => {
    if (typeof id === 'string' && VALID_MODULES.indexOf(id) >= 0 && !seen.has(id)) {
      seen.add(id);
      modules.push(id);
    }
  });
  return { version: CONFIG_VERSION, modules };
}

/** 某模块是否启用 */
function isEnabled(config, moduleId) {
  const cfg = config && Array.isArray(config.modules) ? config.modules : [];
  return cfg.indexOf(moduleId) >= 0;
}

/** 用模块 ID 集合构造配置（用于「恢复默认」/ 保存开关，先规范化） */
function withModules(modules) {
  return normalizeConfig({ version: CONFIG_VERSION, modules });
}

module.exports = {
  CONFIG_VERSION,
  MONTHLY_MODULES,
  YEARLY_MODULES,
  VALID_MODULES,
  DEFAULT_MODULES,
  defaultConfig,
  normalizeConfig,
  isEnabled,
  withModules,
};
