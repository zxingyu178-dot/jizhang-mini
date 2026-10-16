/**
 * data/categories.js — 分类定义、读写与管理（v0.6.0）
 *
 * 与 Android DailyValue 对齐：核心 5 类（builtin，名称不可改、不可归档）+
 * 预置 7 类（builtin=false，可改名 / 改图标 / 归档）。
 *
 * 分类对象：{ id, name, emoji, builtin, sort, archived }
 *
 * 软归档（不物理删除）：
 *   - 用户「删除」自定义分类 → archived=true；
 *   - 新记账表单（getActiveCategories）看不到已归档分类；
 *   - 历史账单仍经 getCategory(id) 解析出原名称 / 图标，避免历史账因找不到分类全变「其他」。
 *
 * Mini Bill 不保存分类快照，统一靠 getCategory 动态解析，因此改名 / 归档只需改本文件一处，
 * 无需同步更新历史账单（比 Android 简单）。
 */
const fs = require('./fs');
const paths = require('./paths');
const { genId } = require('../utils/util');

/** 系统核心分类（固定 id，builtin=true，名称不可改、不可归档） */
const CORE_BUILTINS = [
  { id: 'c-food', name: '餐饮', emoji: '🍚', builtin: true, sort: 1 },
  { id: 'c-transport', name: '交通', emoji: '🚗', builtin: true, sort: 2 },
  { id: 'c-shopping', name: '购物', emoji: '🛍️', builtin: true, sort: 3 },
  { id: 'c-fun', name: '娱乐', emoji: '🎮', builtin: true, sort: 4 },
  { id: 'c-life', name: '生活', emoji: '🏠', builtin: true, sort: 5 },
];

/** 默认预置分类（builtin=false，可改名 / 改图标 / 归档） */
const DEFAULT_PRESETS = [
  { id: 'c-drink', name: '饮料', emoji: '🥤', builtin: false, sort: 6 },
  { id: 'c-bill', name: '话费', emoji: '📱', builtin: false, sort: 7 },
  { id: 'c-salary', name: '工资', emoji: '💰', builtin: false, sort: 8 },
  { id: 'c-medical', name: '医疗', emoji: '💊', builtin: false, sort: 9 },
  { id: 'c-housing', name: '住房', emoji: '🏢', builtin: false, sort: 10 },
  { id: 'c-travel', name: '旅行', emoji: '✈️', builtin: false, sort: 11 },
  { id: 'c-other', name: '其他', emoji: '📦', builtin: false, sort: 12 },
];

const DEFAULT_CATEGORIES = [...CORE_BUILTINS, ...DEFAULT_PRESETS].map((c) =>
  Object.assign({ archived: false }, c)
);

/** 名称最大字数（trim 后） */
const NAME_MAX = 8;

/** 旧 v0.1.0 分类 value（无 c- 前缀）→ 新 c- id */
const LEGACY_MAP = {
  food: 'c-food',
  transport: 'c-transport',
  shopping: 'c-shopping',
  housing: 'c-housing',
  entertainment: 'c-fun',
  medical: 'c-medical',
  education: 'c-other',
  other_expense: 'c-other',
  salary: 'c-salary',
  parttime: 'c-other',
  bonus: 'c-other',
  investment: 'c-other',
  other_income: 'c-other',
};

/** 规范化单个分类（兼容旧数据：缺省 archived=false、builtin=false） */
function normalizeCategory(c) {
  return {
    id: c.id,
    name: c.name,
    emoji: c.emoji || '📦',
    builtin: c.builtin === true,
    sort: Number.isFinite(c.sort) ? c.sort : 0,
    archived: c.archived === true,
  };
}

/** 首次启动写入默认分类（已存在则保留用户数据） */
function ensureCategories() {
  const existing = fs.readJSON(paths.FILE.categories, null);
  if (existing && Array.isArray(existing) && existing.length) {
    return existing.map(normalizeCategory);
  }
  fs.writeJSON(paths.FILE.categories, DEFAULT_CATEGORIES);
  return DEFAULT_CATEGORIES.slice();
}

/** 读全部分类（含已归档，供历史账单解析） */
function getCategories() {
  const raw = fs.readJSON(paths.FILE.categories, DEFAULT_CATEGORIES);
  return (Array.isArray(raw) ? raw : []).map(normalizeCategory);
}

/** 读未归档分类（供记账 / 周期表单选择） */
function getActiveCategories() {
  return getCategories().filter((c) => !c.archived);
}

/** 按 id 查分类（含已归档；找不到返回「其他」） */
function getCategory(id) {
  const all = getCategories();
  return (
    all.find((c) => c.id === id) || {
      id: 'c-other',
      name: '其他',
      emoji: '📦',
      builtin: false,
      sort: 12,
      archived: false,
    }
  );
}

/** 旧分类 value 映射到新 id */
function mapLegacyCategory(value) {
  return LEGACY_MAP[value] || 'c-other';
}

/**
 * 重名检查（trim 后比较；excludeId 用于编辑时排除自身）。
 * 返回已存在的同名分类；未命中返回 null。
 */
function findDuplicateName(name, excludeId) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  return (
    getCategories().find(
      (c) => c.id !== excludeId && c.name.trim() === trimmed
    ) || null
  );
}

/** 校验名称：trim 后 1~NAME_MAX 字，返回 { ok, name } */
function validateName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed.length > NAME_MAX) return { ok: false };
  return { ok: true, name: trimmed };
}

/**
 * 新增分类。
 * @param {{name:string, emoji?:string, id?:string}} input
 * @returns {{ok:boolean, reason?:string, category?:object}}
 * 支持传入 id（Android 迁移用确定性 id dvcat-xxx）；否则自动生成。
 */
function addCategory(input) {
  input = input || {};
  const v = validateName(input.name);
  if (!v.ok) return { ok: false, reason: 'invalid-name' };
  if (findDuplicateName(v.name, null)) return { ok: false, reason: 'duplicate' };

  const all = getCategories();
  if (input.id && all.some((c) => c.id === input.id)) {
    return { ok: false, reason: 'duplicate-id' };
  }
  const maxSort = all.reduce((m, c) => Math.max(m, c.sort || 0), 0);
  const category = {
    id: input.id || genId(),
    name: v.name,
    emoji: String(input.emoji || '').trim() || '📦',
    builtin: false,
    sort: maxSort + 1,
    archived: false,
  };
  all.push(category);
  fs.writeJSON(paths.FILE.categories, all);
  return { ok: true, category };
}

/**
 * 编辑分类（名称 / 图标）。核心分类名称不可改；图标可改。
 * @returns {{ok:boolean, reason?:string, category?:object}}
 */
function updateCategory(id, patch) {
  patch = patch || {};
  const all = getCategories();
  const cat = all.find((c) => c.id === id);
  if (!cat) return { ok: false, reason: 'not-found' };

  if (patch.name !== undefined) {
    if (cat.builtin) return { ok: false, reason: 'builtin' };
    const v = validateName(patch.name);
    if (!v.ok) return { ok: false, reason: 'invalid-name' };
    if (findDuplicateName(v.name, id)) return { ok: false, reason: 'duplicate' };
    cat.name = v.name;
  }
  if (patch.emoji !== undefined) {
    const emoji = String(patch.emoji).trim();
    if (emoji) cat.emoji = emoji;
  }
  fs.writeJSON(paths.FILE.categories, all);
  return { ok: true, category: cat };
}

/**
 * 归档分类（软删除）。
 * - 核心分类不可归档；
 * - 被周期规则引用时不可归档（Gate E），返回 recurringCount；
 * - 历史账单不受影响（getCategory 仍能解析）。
 * @returns {{ok:boolean, reason?:string, recurringCount?:number}}
 */
function archiveCategory(id) {
  const all = getCategories();
  const cat = all.find((c) => c.id === id);
  if (!cat) return { ok: false, reason: 'not-found' };
  if (cat.builtin) return { ok: false, reason: 'builtin' };

  // Gate E：被周期规则引用时阻止归档（延迟 require，避免底层反向依赖）
  try {
    const recurring = require('./recurring/index');
    const usage = recurring.countRulesByCategory(id);
    if (usage > 0) return { ok: false, reason: 'in-use', recurringCount: usage };
  } catch (e) {
    // recurring 模块尚未建立：跳过检查
  }

  cat.archived = true;
  fs.writeJSON(paths.FILE.categories, all);
  return { ok: true };
}

/** 恢复已归档分类 */
function restoreCategory(id) {
  const all = getCategories();
  const cat = all.find((c) => c.id === id);
  if (!cat) return { ok: false, reason: 'not-found' };
  cat.archived = false;
  fs.writeJSON(paths.FILE.categories, all);
  return { ok: true, category: cat };
}

module.exports = {
  CORE_BUILTINS,
  DEFAULT_PRESETS,
  DEFAULT_CATEGORIES,
  NAME_MAX,
  normalizeCategory,
  ensureCategories,
  getCategories,
  getActiveCategories,
  getCategory,
  mapLegacyCategory,
  findDuplicateName,
  addCategory,
  updateCategory,
  archiveCategory,
  restoreCategory,
};
