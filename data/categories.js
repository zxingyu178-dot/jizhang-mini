/**
 * data/categories.js — 分类定义、读写与管理（v1.2.0 分类视觉系统）
 *
 * 与 Android DailyValue 对齐：核心 5 类（builtin，名称不可改、不可归档）+
 * 预置 7 类（builtin=false，可改名 / 改图标 / 归档）。
 *
 * 分类对象：
 *   { id, name, emoji, iconType:'builtin'|'emoji', iconValue, builtin, sort, archived }
 *   - iconType='builtin' → iconValue 存 category-icons 的图标 id，渲染本地 SVG；
 *   - iconType='emoji'   → iconValue 存 emoji 字符，渲染文本 emoji；
 *   - emoji 始终保留，作为旧数据兼容与渲染失败兜底。
 *
 * 无损视觉迁移（旧数据无 iconType）：
 *   - 默认分类若 emoji 仍等于系统默认 emoji（用户没改过）→ 升级为 builtin 本地图标；
 *   - 用户已手动改过 emoji → 保持 emoji 模式，绝不强行改回系统 SVG；
 *   - 用户自定义分类（非默认 id）→ 保持 emoji 模式。
 *
 * 软归档（不物理删除）：新记账表单看不到已归档分类；历史账单经 getCategory 仍能
 * 解析原名 / 图标。Mini Bill 不保存分类快照，统一靠 getCategory 动态解析。
 */
const fs = require('./fs');
const paths = require('./paths');
const { genId } = require('../utils/util');
const categoryIcons = require('./category-icons');

/**
 * 默认分类 id → 内置图标 id（与 Android 图标 id 完全一致）。
 * 同时作为「旧数据无损迁移」时的默认图标依据。
 */
const DEFAULT_ICON_BY_CAT = {
  'c-food': 'dining',
  'c-transport': 'transport',
  'c-shopping': 'shopping',
  'c-fun': 'fun',
  'c-life': 'life',
  'c-drink': 'drink',
  'c-bill': 'phone-bill',
  'c-salary': 'salary',
  'c-medical': 'medical',
  'c-housing': 'housing',
  'c-travel': 'travel',
  'c-other': 'other',
};

/** 默认分类 id → 系统初始 emoji（用于判断用户是否手动改过 emoji） */
const DEFAULT_EMOJI_BY_CAT = {
  'c-food': '🍚',
  'c-transport': '🚗',
  'c-shopping': '🛍️',
  'c-fun': '🎮',
  'c-life': '🏠',
  'c-drink': '🥤',
  'c-bill': '📱',
  'c-salary': '💰',
  'c-medical': '💊',
  'c-housing': '🏢',
  'c-travel': '✈️',
  'c-other': '📦',
};

/** 系统核心分类（固定 id，builtin=true，名称不可改、不可归档；图标可改） */
const CORE_BUILTINS = [
  { id: 'c-food', name: '餐饮', emoji: '🍚', iconType: 'builtin', iconValue: 'dining', builtin: true, sort: 1 },
  { id: 'c-transport', name: '交通', emoji: '🚗', iconType: 'builtin', iconValue: 'transport', builtin: true, sort: 2 },
  { id: 'c-shopping', name: '购物', emoji: '🛍️', iconType: 'builtin', iconValue: 'shopping', builtin: true, sort: 3 },
  { id: 'c-fun', name: '娱乐', emoji: '🎮', iconType: 'builtin', iconValue: 'fun', builtin: true, sort: 4 },
  { id: 'c-life', name: '生活', emoji: '🏠', iconType: 'builtin', iconValue: 'life', builtin: true, sort: 5 },
];

/** 默认预置分类（builtin=false，可改名 / 改图标 / 归档） */
const DEFAULT_PRESETS = [
  { id: 'c-drink', name: '饮料', emoji: '🥤', iconType: 'builtin', iconValue: 'drink', builtin: false, sort: 6 },
  { id: 'c-bill', name: '话费', emoji: '📱', iconType: 'builtin', iconValue: 'phone-bill', builtin: false, sort: 7 },
  { id: 'c-salary', name: '工资', emoji: '💰', iconType: 'builtin', iconValue: 'salary', builtin: false, sort: 8 },
  { id: 'c-medical', name: '医疗', emoji: '💊', iconType: 'builtin', iconValue: 'medical', builtin: false, sort: 9 },
  { id: 'c-housing', name: '住房', emoji: '🏢', iconType: 'builtin', iconValue: 'housing', builtin: false, sort: 10 },
  { id: 'c-travel', name: '旅行', emoji: '✈️', iconType: 'builtin', iconValue: 'travel', builtin: false, sort: 11 },
  { id: 'c-other', name: '其他', emoji: '📦', iconType: 'builtin', iconValue: 'other', builtin: false, sort: 12 },
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

/**
 * 解析输入的图标字段，返回 { iconType, iconValue, emoji }。
 * 优先显式 iconType/iconValue；兼容直接传 emoji；都没有则默认 builtin/other。
 */
function resolveIconInput(input) {
  input = input || {};
  if (input.iconType === 'builtin' && input.iconValue && categoryIcons.isBuiltinId(input.iconValue)) {
    const def = categoryIcons.builtinIconById(input.iconValue);
    return { iconType: 'builtin', iconValue: input.iconValue, emoji: def.glyph };
  }
  if (input.iconType === 'emoji') {
    const ev = String(input.iconValue || '').trim();
    if (ev) return { iconType: 'emoji', iconValue: ev, emoji: ev };
  }
  const em = String(input.emoji || '').trim();
  if (em) return { iconType: 'emoji', iconValue: em, emoji: em };
  const def = categoryIcons.builtinIconById('other');
  return { iconType: 'builtin', iconValue: 'other', emoji: def.glyph };
}

/**
 * 规范化单个分类（兼容旧数据：缺省 archived=false、builtin=false，并做无损视觉迁移）。
 */
function normalizeCategory(c) {
  const emoji = c.emoji || '📦';
  const base = {
    id: c.id,
    name: c.name,
    emoji,
    builtin: c.builtin === true,
    sort: Number.isFinite(c.sort) ? c.sort : 0,
    archived: c.archived === true,
  };

  // 已有显式且合法的图标字段：校验后保留。
  if (c.iconType === 'builtin' && c.iconValue && categoryIcons.isBuiltinId(c.iconValue)) {
    base.iconType = 'builtin';
    base.iconValue = c.iconValue;
    return base;
  }
  if (c.iconType === 'emoji') {
    const ev = String(c.iconValue || '').trim();
    if (ev) {
      base.iconType = 'emoji';
      base.iconValue = ev;
      return base;
    }
  }

  // 旧数据（无有效 iconType）：无损视觉迁移。
  const defaultIcon = DEFAULT_ICON_BY_CAT[c.id];
  const defaultEmoji = DEFAULT_EMOJI_BY_CAT[c.id];
  if (defaultIcon && emoji === defaultEmoji) {
    // 默认分类且 emoji 未被用户改动 → 升级本地 SVG。
    base.iconType = 'builtin';
    base.iconValue = defaultIcon;
  } else {
    // 用户改过 emoji，或自定义分类 → 保持 emoji 模式。
    base.iconType = 'emoji';
    base.iconValue = emoji;
  }
  return base;
}

/**
 * 严格读分类（所有 mutation 路径用）：文件不存在 → 默认分类（可建）；
 * 文件存在但损坏 / 不是数组 → 抛错（fail-closed），绝不退回默认再覆盖。
 */
function readCategoriesStrict() {
  if (!fs.exists(paths.FILE.categories)) return DEFAULT_CATEGORIES.slice();
  const raw = fs.readJSONStrict(paths.FILE.categories);
  if (!Array.isArray(raw)) {
    throw fs.fileError('FILE_CORRUPT', paths.FILE.categories, 'categories 不是数组');
  }
  return raw.map(normalizeCategory);
}

/** 首次启动写入默认分类（已存在则保留用户数据；原子写） */
function ensureCategories() {
  const existing = fs.readJSON(paths.FILE.categories, null);
  if (existing && Array.isArray(existing) && existing.length) {
    return existing.map(normalizeCategory);
  }
  fs.writeJSONAtomic(paths.FILE.categories, DEFAULT_CATEGORIES);
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

/** 找不到分类时的兜底「其他」（与历史账单解析保持一致） */
const FALLBACK_OTHER = {
  id: 'c-other',
  name: '其他',
  emoji: '📦',
  iconType: 'builtin',
  iconValue: 'other',
  builtin: false,
  sort: 12,
  archived: false,
};

/** 按 id 查分类（含已归档；找不到返回「其他」） */
function getCategory(id) {
  return getCategoryMap()[id] || FALLBACK_OTHER;
}

/**
 * 一次读盘，构建 id → 分类 的内存映射（含已归档）。
 * 用于单次渲染/计算批次的批量解析，避免每条账单都读一次 categories.json。
 * 注意：这是「单次快照」，不做全局永久缓存——分类改名/归档后下一次 refresh 重新读取即生效。
 */
function getCategoryMap() {
  const all = getCategories();
  const map = {};
  for (let i = 0; i < all.length; i++) map[all[i].id] = all[i];
  return map;
}

/**
 * 一次读盘，返回基于内存快照的分类解析函数 (id → 分类)。
 * 找不到（含已归档以外的悬空 id）统一回退「其他」。
 */
function getCategoryResolver() {
  const map = getCategoryMap();
  return function resolveCategory(id) {
    return map[id] || FALLBACK_OTHER;
  };
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
 * @param {{name:string, iconType?:string, iconValue?:string, emoji?:string, id?:string}} input
 * @returns {{ok:boolean, reason?:string, category?:object}}
 * 支持传入 id（Android 迁移用确定性 id dvcat-xxx）；否则自动生成。
 */
function addCategory(input) {
  input = input || {};
  const v = validateName(input.name);
  if (!v.ok) return { ok: false, reason: 'invalid-name' };

  let all;
  try {
    all = readCategoriesStrict(); // 损坏即抛，不退回默认
  } catch (e) {
    return { ok: false, reason: 'read-failed' };
  }
  if (all.some((c) => c.name.trim() === v.name)) {
    return { ok: false, reason: 'duplicate' };
  }
  if (input.id && all.some((c) => c.id === input.id)) {
    return { ok: false, reason: 'duplicate-id' };
  }
  const maxSort = all.reduce((m, c) => Math.max(m, c.sort || 0), 0);
  const icon = resolveIconInput(input);
  const category = Object.assign(
    {
      id: input.id || genId(),
      name: v.name,
      builtin: false,
      sort: maxSort + 1,
      archived: false,
    },
    icon
  );
  all.push(category);
  try {
    fs.writeJSONAtomic(paths.FILE.categories, all);
  } catch (e) {
    return { ok: false, reason: 'write-failed' };
  }
  return { ok: true, category };
}

/**
 * 编辑分类（名称 / 图标）。核心分类名称不可改；图标可改。
 * @returns {{ok:boolean, reason?:string, category?:object}}
 */
function updateCategory(id, patch) {
  patch = patch || {};
  let all;
  try {
    all = readCategoriesStrict();
  } catch (e) {
    return { ok: false, reason: 'read-failed' };
  }
  const cat = all.find((c) => c.id === id);
  if (!cat) return { ok: false, reason: 'not-found' };

  if (patch.name !== undefined) {
    if (cat.builtin) return { ok: false, reason: 'builtin' };
    const v = validateName(patch.name);
    if (!v) return { ok: false, reason: 'invalid-name' };
    if (all.some((c) => c.id !== id && c.name.trim() === v.name)) {
      return { ok: false, reason: 'duplicate' };
    }
    cat.name = v.name;
  }

  // 图标更新（显式 iconType/iconValue）。
  if (patch.iconType !== undefined) {
    const icon = resolveIconInput(patch);
    cat.iconType = icon.iconType;
    cat.iconValue = icon.iconValue;
    cat.emoji = icon.emoji;
  } else if (patch.emoji !== undefined) {
    // 兼容旧的 emoji-only patch：转为 emoji 模式。
    const emoji = String(patch.emoji).trim();
    if (emoji) {
      cat.emoji = emoji;
      cat.iconType = 'emoji';
      cat.iconValue = emoji;
    }
  }

  try {
    fs.writeJSONAtomic(paths.FILE.categories, all);
  } catch (e) {
    return { ok: false, reason: 'write-failed' };
  }
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
  let all;
  try {
    all = readCategoriesStrict();
  } catch (e) {
    return { ok: false, reason: 'read-failed' };
  }
  const cat = all.find((c) => c.id === id);
  if (!cat) return { ok: false, reason: 'not-found' };
  if (cat.builtin) return { ok: false, reason: 'builtin' };

  // Gate E：被周期规则引用时阻止归档。先 strict 校验 recurring.json 可读取
  // （损坏则 fail-closed），再 countRulesByCategory。
  let usage;
  try {
    if (fs.exists(paths.FILE.recurring)) fs.readJSONStrict(paths.FILE.recurring);
    const recurring = require('./recurring/index');
    usage = recurring.countRulesByCategory(id);
  } catch (e) {
    return { ok: false, reason: 'recurring-check-failed' };
  }
  if (!Number.isFinite(usage)) return { ok: false, reason: 'recurring-check-failed' };
  if (usage > 0) return { ok: false, reason: 'in-use', recurringCount: usage };

  cat.archived = true;
  try {
    fs.writeJSONAtomic(paths.FILE.categories, all);
  } catch (e) {
    return { ok: false, reason: 'write-failed' };
  }
  return { ok: true };
}

/** 恢复已归档分类 */
function restoreCategory(id) {
  let all;
  try {
    all = readCategoriesStrict();
  } catch (e) {
    return { ok: false, reason: 'read-failed' };
  }
  const cat = all.find((c) => c.id === id);
  if (!cat) return { ok: false, reason: 'not-found' };
  cat.archived = false;
  try {
    fs.writeJSONAtomic(paths.FILE.categories, all);
  } catch (e) {
    return { ok: false, reason: 'write-failed' };
  }
  return { ok: true, category: cat };
}

module.exports = {
  CORE_BUILTINS,
  DEFAULT_PRESETS,
  DEFAULT_CATEGORIES,
  DEFAULT_ICON_BY_CAT,
  DEFAULT_EMOJI_BY_CAT,
  NAME_MAX,
  resolveIconInput,
  normalizeCategory,
  readCategoriesStrict,
  ensureCategories,
  getCategories,
  getActiveCategories,
  getCategory,
  getCategoryMap,
  getCategoryResolver,
  mapLegacyCategory,
  findDuplicateName,
  addCategory,
  updateCategory,
  archiveCategory,
  restoreCategory,
};
