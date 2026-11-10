/**
 * data/recurring/store.js — 周期规则持久化与 CRUD（v0.6.0）
 *
 * 存储：<USER_DATA_PATH>/recurring.json = { version:1, rules:[] }
 * 金额一律整数分（amountCents）。
 *
 * 本文件不依赖 ledger（避免循环依赖），只负责规则的读写；
 * 账单生成在 generator.js。
 */
const fs = require('../fs');
const paths = require('../paths');
const core = require('./core');
const { genId } = require('../../utils/util');

const STORE_VERSION = 1;
const EMPTY = { version: STORE_VERSION, rules: [] };

/** 读取原始存储（不存在返回空） */
function readStore() {
  const raw = fs.readJSON(paths.FILE.recurring, null);
  if (!raw || typeof raw !== 'object') return Object.assign({}, EMPTY);
  return {
    version: STORE_VERSION,
    rules: Array.isArray(raw.rules) ? raw.rules : [],
  };
}

/** 写入存储（原子写） */
function writeStore(rules) {
  fs.writeJSONAtomic(paths.FILE.recurring, { version: STORE_VERSION, rules });
}

/**
 * 严格读 store（所有 mutation 路径用）：文件不存在 → 空 store（可建）；
 * 文件存在但损坏 / 不是对象 → 抛错（fail-closed），绝不退回空 store 再覆盖。
 */
function readStoreStrict() {
  if (!fs.exists(paths.FILE.recurring)) return { version: STORE_VERSION, rules: [] };
  const raw = fs.readJSONStrict(paths.FILE.recurring);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw fs.fileError('FILE_CORRUPT', paths.FILE.recurring, 'recurring store 不是对象');
  }
  return {
    version: STORE_VERSION,
    rules: Array.isArray(raw.rules) ? raw.rules : [],
  };
}

/** 读取全部规则（严格，规范化；mutation 用） */
function getRulesStrict() {
  return readStoreStrict().rules.map(normalizeRule);
}

/**
 * createdAt 是否「已有合法值」：必须是有限正数（毫秒时间戳）。
 *
 * v1.4.2 修复：旧实现是 `raw.createdAt || Date.now()`，只靠 truthy 判断 ——
 * 字符串 / 负数会被原样保留（非法值入库），而缺失 / 0 / NaN 每次调用都取一次
 * `Date.now()`，同一份数据被规范化两次就会得到两个不同时间戳。
 */
function isValidCreatedAt(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * 规范化单条规则（补全字段 + 周期字段钳制；金额整数分）。
 *
 * createdAt 归一规则（单一事实源，明确且可复现）：
 *   - 合法（有限正数）→ **原样保留**，绝不改写已有值，不做取整；
 *   - 缺失 / 非法（undefined / null / '' / 字符串 / NaN / 0 / 负数）→ 视为缺失，
 *     取 `now`（默认本次规范化时刻）。
 * @param {object} raw 原始规则
 * @param {number} [now] 本次规范化的统一时间戳（批量规范化时由调用方只取一次）
 */
function normalizeRule(raw, now) {
  raw = raw || {};
  const frequency = core.FREQUENCIES.indexOf(raw.frequency) >= 0 ? raw.frequency : 'daily';
  const safe = core.sanitizeRecurringRule(Object.assign({}, raw, { frequency }));
  // amountCents：非有限值（undefined/NaN）兜底为 0，避免 NaN 入库（generator 会跳过 0 金额规则）
  const amountCents = Number.isFinite(raw.amountCents)
    ? Math.max(0, Math.round(raw.amountCents))
    : 0;
  const out = {
    id: raw.id || genId(),
    enabled: safe.enabled,
    type: raw.type === 'income' ? 'income' : 'expense',
    amountCents,
    categoryId: raw.categoryId || 'c-other',
    note: raw.note || '',
    frequency,
    interval: safe.interval,
    day: safe.day,
    // startDate 原样保留为字符串（非法日期不在此静默兜底，由 generator/adapter 校验拦截，
    // 避免损坏规则被悄悄改写成「今天开始」而生成意外账单）。
    startDate: typeof raw.startDate === 'string' ? raw.startDate : '',
    time: safe.time,
    createdAt: isValidCreatedAt(raw.createdAt)
      ? raw.createdAt
      : isValidCreatedAt(now)
        ? now
        : Date.now(),
  };
  if (safe.month != null) out.month = safe.month;
  if (raw.scheduleEffectiveAt != null) {
    out.scheduleEffectiveAt = Number(raw.scheduleEffectiveAt);
  }
  if (raw.lastGeneratedDate) out.lastGeneratedDate = raw.lastGeneratedDate;
  if (raw.nextOccurrence) out.nextOccurrence = raw.nextOccurrence;
  if (raw.updatedAt != null) out.updatedAt = Number(raw.updatedAt);
  return out;
}

/** 读取全部规则（规范化） */
function getRules() {
  return readStore().rules.map(normalizeRule);
}

/** 按 id 查规则 */
function getRule(id) {
  return getRules().find((r) => r.id === id) || null;
}

/**
 * 新增规则（编辑器字段）。补 id / createdAt，规范化并保存。
 * @returns 新规则
 */
function addRule(input) {
  const rules = getRulesStrict(); // 损坏即抛，不退回空
  // 新建规则默认 enabled=true（显式传 false 才停用）；迁移/编辑走 normalizeRule 保留原值。
  const rule = normalizeRule(
    Object.assign({ id: genId(), createdAt: Date.now(), enabled: true }, input || {})
  );
  rules.push(rule);
  writeStore(rules);
  return rule;
}

/**
 * 更新规则（合并 patch；updatedAt=now）。
 * @returns {{ok:boolean, rule?:object}}
 */
function updateRule(id, patch) {
  const rules = getRulesStrict();
  const idx = rules.findIndex((r) => r.id === id);
  if (idx < 0) return { ok: false };
  const merged = Object.assign({}, rules[idx], patch, { id, updatedAt: Date.now() });
  rules[idx] = normalizeRule(merged);
  writeStore(rules);
  return { ok: true, rule: rules[idx] };
}

/** 删除规则（仅删规则；已生成 Bill 全部保留；严格读） */
function removeRule(id) {
  const rules = getRulesStrict().filter((r) => r.id !== id);
  writeStore(rules);
  return { ok: true };
}

/** 引用某分类的规则数量（含停用；分类归档前安全检查） */
function countRulesByCategory(categoryId) {
  return getRules().filter((r) => r.categoryId === categoryId).length;
}

/**
 * 批量规范化（恢复 / 回滚 / 迁移入口用）。
 *
 * **一次只取一个时间戳**：整批规则共用同一个 `now`，缺 createdAt 的规则全部取
 * 「本次操作时刻」，不虚构历史时间，也不会同一批里出现两个时间戳。
 * @param {Array} rules 原始规则数组
 * @param {number} [now] 统一时间戳（缺省取一次 Date.now()）
 * @returns {Array} 规范化后的新数组（不修改入参）
 */
function normalizeRules(rules, now) {
  const stamp = isValidCreatedAt(now) ? now : Date.now();
  return (Array.isArray(rules) ? rules : []).map((r) => normalizeRule(r, stamp));
}

/**
 * 直接用规范化后的规则数组覆盖保存（迁移用）。
 * ⚠️ 内部会再 normalize 一次；恢复 / 回滚请用 replaceAllRulesPrepared，
 *    否则缺 createdAt 的规则会被重新取一次 Date.now()，与已写入的内容对不上。
 */
function replaceAllRules(rules) {
  const normalized = rules.map(normalizeRule);
  writeStore(normalized);
  return normalized;
}

/**
 * 覆盖保存「已规范化」的规则（恢复 / 回滚专用）：不再二次 normalize。
 * 调用方必须传入 normalizeRules() 的返回值，并把**同一份数组**用于随后的
 * 元数据完整性核对，保证「写入的」与「核对的」是同一份结果。
 */
function replaceAllRulesPrepared(rules) {
  const list = Array.isArray(rules) ? rules : [];
  writeStore(list);
  return list;
}

module.exports = {
  STORE_VERSION,
  EMPTY,
  normalizeRule,
  normalizeRules,
  isValidCreatedAt,
  readStore,
  readStoreStrict,
  writeStore,
  getRules,
  getRulesStrict,
  getRule,
  addRule,
  updateRule,
  removeRule,
  countRulesByCategory,
  replaceAllRules,
  replaceAllRulesPrepared,
};
