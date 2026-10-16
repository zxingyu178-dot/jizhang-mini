/**
 * data/budget/rules.js — 预算规则历史（存于 settings.budget）
 *
 * 关键设计：保存「规则历史」而非单一 dailyBudget。
 * 以后从 ¥30 改成 ¥40 只新增一条规则，不会重算历史月份。
 * 某一天适用规则：effectiveFrom <= 当天、且日期最近的一条。
 * 关闭预算不删历史：新增 { enabled:false, effectiveFrom }，之前仍按原规则。
 *
 * 纯函数（normalize/resolve/apply）与 IO（get/save）分开，纯函数可在 Node 测试。
 */
const settings = require('../settings');

const DEFAULT_BUDGET = { version: 1, weekStartsOn: 1, rules: [] };

/** 规整 budget state（缺字段补默认，rules 按 effectiveFrom 升序） */
function normalizeState(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const rules = Array.isArray(b.rules) ? b.rules.slice() : [];
  rules.sort((a, c) => (a.effectiveFrom < c.effectiveFrom ? -1 : a.effectiveFrom > c.effectiveFrom ? 1 : 0));
  return {
    version: 1,
    weekStartsOn: b.weekStartsOn === 0 ? 0 : 1, // 周一为默认周起点（1）
    rules,
  };
}

/** 从 settings 读 budget state */
function getBudgetState() {
  return normalizeState(settings.getSettings().budget);
}

/**
 * 某日期适用的规则：effectiveFrom <= dateStr、且日期最近一条。
 * 无规则返回 null。
 */
function resolveRuleForDate(state, dateStr) {
  let hit = null;
  for (let i = 0; i < state.rules.length; i++) {
    const r = state.rules[i];
    if (r.effectiveFrom <= dateStr) {
      if (!hit || r.effectiveFrom >= hit.effectiveFrom) hit = r;
    }
  }
  return hit;
}

/** 当天预算是否启用（适用规则存在且 enabled） */
function isEnabledOn(state, dateStr) {
  const r = resolveRuleForDate(state, dateStr);
  return Boolean(r && r.enabled);
}

/** 当天每日预算（整数分）；无规则 / 禁用 → 0 */
function dailyCentsOn(state, dateStr) {
  const r = resolveRuleForDate(state, dateStr);
  return r && r.enabled ? Math.max(0, Math.round(r.dailyCents || 0)) : 0;
}

/**
 * 写入一条规则（返回新 state，不直接 IO）：
 *  - 同一 effectiveFrom 已存在 → 替换当天规则（保留原 id / createdAt）；
 *  - 否则新增；最后按 effectiveFrom 排序。
 */
function applyRule(state, input) {
  const next = normalizeState(state);
  const effectiveFrom = input.effectiveFrom;
  const rule = {
    id: input.id || ('b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    enabled: input.enabled !== false,
    dailyCents: Math.max(0, Math.round(input.dailyCents || 0)),
    effectiveFrom,
    createdAt: input.createdAt || Date.now(),
  };
  const idx = next.rules.findIndex((r) => r.effectiveFrom === effectiveFrom);
  if (idx >= 0) {
    rule.id = input.id || next.rules[idx].id;
    rule.createdAt = input.createdAt || next.rules[idx].createdAt;
    next.rules[idx] = rule;
  } else {
    next.rules.push(rule);
  }
  next.rules.sort((a, c) => (a.effectiveFrom < c.effectiveFrom ? -1 : a.effectiveFrom > c.effectiveFrom ? 1 : 0));
  return next;
}

/** 便捷：读-改-写一条规则（持久化到 settings） */
function saveBudgetRule(input) {
  const next = applyRule(getBudgetState(), input);
  settings.updateSettings({ budget: next });
  return next;
}

module.exports = {
  DEFAULT_BUDGET,
  normalizeState,
  getBudgetState,
  resolveRuleForDate,
  isEnabledOn,
  dailyCentsOn,
  applyRule,
  saveBudgetRule,
};
