/**
 * data/recurring/index.js — 周期记账统一入口（v0.6.0）
 *
 * 对外暴露：规则查询 / CRUD / 启停 / 生成器触发 / 迁移直写。
 * categories.archiveCategory 延迟 require 本文件的 countRulesByCategory 做 Gate E 检查。
 */
const core = require('./core');
const store = require('./store');
const generator = require('./generator');

/** 新建规则（编辑器字段），返回新规则 */
function createRule(input) {
  return store.addRule(input);
}

/** 更新规则（部分字段） */
function editRule(id, patch) {
  return store.updateRule(id, patch);
}

/** 删除规则（仅删规则；已生成 Bill 全部保留） */
function deleteRule(id) {
  return store.removeRule(id);
}

/**
 * 停用 / 启用：
 *  - 停用：enabled=false，不生成；
 *  - 重新启用：scheduleEffectiveAt=now，不补停用期间的账，只处理此后。
 */
function setRuleEnabled(id, enabled) {
  const patch = { enabled: !!enabled };
  if (enabled) patch.scheduleEffectiveAt = Date.now();
  return store.updateRule(id, patch);
}

module.exports = {
  core,
  store,
  // 查询
  getRules: store.getRules,
  getRule: store.getRule,
  countRulesByCategory: store.countRulesByCategory,
  // 写入
  createRule,
  editRule,
  deleteRule,
  setRuleEnabled,
  // 迁移（Gate F/G：直接写规范化规则数组）
  replaceAllRules: store.replaceAllRules,
  // 生成
  generateDueBills: generator.generateDueBills,
  countDueForRule: generator.countDueForRule,
  runRecurringGenerator: generator.runRecurringGenerator,
};
