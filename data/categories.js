/**
 * data/categories.js — 分类定义与读写
 *
 * 与 Android DailyValue 对齐：核心 5 类（builtin，不可删）+ 预置 7 类（可删）。
 * 分类对象：{ id, name, emoji, builtin, sort }
 */
const fs = require('./fs');
const paths = require('./paths');

/** 系统核心分类（固定 id，不可删） */
const CORE_BUILTINS = [
  { id: 'c-food', name: '餐饮', emoji: '🍚', builtin: true, sort: 1 },
  { id: 'c-transport', name: '交通', emoji: '🚗', builtin: true, sort: 2 },
  { id: 'c-shopping', name: '购物', emoji: '🛍️', builtin: true, sort: 3 },
  { id: 'c-fun', name: '娱乐', emoji: '🎮', builtin: true, sort: 4 },
  { id: 'c-life', name: '生活', emoji: '🏠', builtin: true, sort: 5 },
];

/** 默认预置分类（可删/改名） */
const DEFAULT_PRESETS = [
  { id: 'c-drink', name: '饮料', emoji: '🥤', builtin: false, sort: 6 },
  { id: 'c-bill', name: '话费', emoji: '📱', builtin: false, sort: 7 },
  { id: 'c-salary', name: '工资', emoji: '💰', builtin: false, sort: 8 },
  { id: 'c-medical', name: '医疗', emoji: '💊', builtin: false, sort: 9 },
  { id: 'c-housing', name: '住房', emoji: '🏢', builtin: false, sort: 10 },
  { id: 'c-travel', name: '旅行', emoji: '✈️', builtin: false, sort: 11 },
  { id: 'c-other', name: '其他', emoji: '📦', builtin: false, sort: 12 },
];

const DEFAULT_CATEGORIES = [...CORE_BUILTINS, ...DEFAULT_PRESETS];

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

/** 首次启动写入默认分类（已存在则保留用户数据） */
function ensureCategories() {
  const existing = fs.readJSON(paths.FILE.categories, null);
  if (existing && Array.isArray(existing) && existing.length) return existing;
  fs.writeJSON(paths.FILE.categories, DEFAULT_CATEGORIES);
  return DEFAULT_CATEGORIES;
}

/** 读全部分类 */
function getCategories() {
  return fs.readJSON(paths.FILE.categories, DEFAULT_CATEGORIES);
}

/** 按 id 查分类；找不到返回"其他" */
function getCategory(id) {
  const all = getCategories();
  return all.find((c) => c.id === id) || { id: 'c-other', name: '其他', emoji: '📦', builtin: false, sort: 12 };
}

/** 旧分类 value 映射到新 id */
function mapLegacyCategory(value) {
  return LEGACY_MAP[value] || 'c-other';
}

module.exports = {
  CORE_BUILTINS,
  DEFAULT_PRESETS,
  DEFAULT_CATEGORIES,
  ensureCategories,
  getCategories,
  getCategory,
  mapLegacyCategory,
};
