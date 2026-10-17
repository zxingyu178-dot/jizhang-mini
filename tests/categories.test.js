/**
 * tests/categories.test.js — 分类管理（v0.6.0 Gate A/E）单元测试
 *
 * 覆盖：默认 12 分类（核心 5 内置不可归档/改名）、自定义新增、重名拒绝、
 *   软归档（新表单不可见、历史账单仍可解析）、恢复、编辑、
 *   被周期规则引用时禁止归档。
 * 内存文件系统 mock wx，无需真机。运行：node tests/categories.test.js
 */
const path = require('path');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.error('  FAIL: ' + msg);
  }
}
function eq(actual, expected, msg) {
  assert(actual === expected, msg + ' (expected=' + expected + ', actual=' + actual + ')');
}

/* ---------- 内存 wx 环境（与 importer.test.js 一致） ---------- */
function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const storage = {};
  const fsm = {
    accessSync(p) {
      if (memFiles.has(p) || memDirs.has(p)) return;
      throw new Error('ENOENT');
    },
    mkdirSync(p, recursive) {
      if (recursive) {
        const parts = p.split('/');
        let cur = '';
        parts.forEach((x, i) => {
          if (i === 0 && x === '') cur = '';
          else {
            cur = cur + '/' + x;
            memDirs.add(cur);
          }
        });
      } else memDirs.add(p);
    },
    readFileSync(p) {
      if (!memFiles.has(p)) throw new Error('ENOENT ' + p);
      return memFiles.get(p);
    },
    writeFileSync(p, data) {
      memFiles.set(p, String(data));
    },
    unlinkSync(p) {
      if (!memFiles.has(p)) throw new Error('ENOENT');
      memFiles.delete(p);
    },
    readdirSync(p) {
      const prefix = p.endsWith('/') ? p : p + '/';
      const out = new Set();
      memFiles.forEach((v, k) => {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          if (rest && !rest.includes('/')) out.add(rest);
        }
      });
      return [...out];
    },
  };
  return {
    env: { USER_DATA_PATH: '/usr' },
    getFileSystemManager: () => fsm,
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => { storage[k] = v; },
  };
}

const ROOT = path.join(__dirname, '..');
global.wx = buildWx();
const store = require(path.join(ROOT, 'data', 'index'));

function freshStore() {
  global.wx = buildWx();
  store.init();
  return store;
}

/* ================= A. 默认分类与核心保护 ================= */
console.log('A. 默认分类与核心保护');
{
  const s = freshStore();
  const C = s.categories;
  const all = C.getCategories();
  eq(all.length, 12, '默认 12 分类');
  eq(C.getActiveCategories().length, 12, '默认全部 active');

  // 核心 5 类存在且 builtin
  ['c-food', 'c-transport', 'c-shopping', 'c-fun', 'c-life'].forEach((id) => {
    const c = C.getCategory(id);
    eq(c.builtin, true, id + ' 核心内置');
  });

  // 核心分类不可归档
  const r1 = C.archiveCategory('c-food');
  eq(r1.ok, false, '核心分类不可归档');
  eq(r1.reason, 'builtin', '核心归档返回 builtin');

  // 核心分类不可改名
  const r2 = C.updateCategory('c-food', { name: '吃饭' });
  eq(r2.ok, false, '核心分类不可改名');

  // 预置分类 builtin=false（饮料/话费/工资/医疗/住房/旅行/其他）
  ['c-drink', 'c-bill', 'c-salary', 'c-medical', 'c-housing', 'c-travel', 'c-other'].forEach((id) => {
    eq(C.getCategory(id).builtin, false, id + ' 预置非内置');
  });
}

/* ================= B. 自定义新增 + 重名 ================= */
console.log('B. 自定义新增与重名');
{
  const s = freshStore();
  const C = s.categories;

  // 新增自定义分类
  const add = C.addCategory({ name: '咖啡', emoji: '☕' });
  eq(add.ok, true, '新增咖啡成功');
  assert(add.category.id, '新分类有 id');
  eq(add.category.builtin, false, '新分类非内置');
  eq(C.getCategories().length, 13, '新增后 13 分类');

  // 重名拒绝（含 trim）
  const dup = C.addCategory({ name: ' 咖啡 ' });
  eq(dup.ok, false, '重名拒绝');
  eq(dup.reason, 'duplicate', '重名返回 duplicate');

  // 名称非法：空
  eq(C.addCategory({ name: '' }).ok, false, '空名称拒绝');
  // 超长：9 字
  eq(C.addCategory({ name: '一二三四五六七八九' }).ok, false, '超长名称拒绝');

  // 确定性 id（Android 迁移用）
  const withId = C.addCategory({ id: 'dvcat-pet', name: '宠物', emoji: '🐶' });
  eq(withId.ok, true, '带 id 新增成功');
  eq(withId.category.id, 'dvcat-pet', '保留传入 id');
  // 同 id 再建拒绝
  eq(C.addCategory({ id: 'dvcat-pet', name: '别的' }).ok, false, '同 id 拒绝');

  // 编辑非核心分类名称
  const upd = C.updateCategory(add.category.id, { name: '咖啡奶茶' });
  eq(upd.ok, true, '编辑自定义分类成功');
  eq(C.getCategory(add.category.id).name, '咖啡奶茶', '名称已更新');

  // emoji 缺省
  const noEmoji = C.addCategory({ name: '数码' });
  eq(noEmoji.category.emoji, '📦', '缺省 emoji 📦');
}

/* ================= C. 软归档与历史解析 ================= */
console.log('C. 软归档与历史解析');
{
  const s = freshStore();
  const C = s.categories;
  const add = C.addCategory({ name: '咖啡', emoji: '☕' });
  const catId = add.category.id;

  // 用该分类记一笔历史账单
  s.addBill({
    type: 'expense',
    amount: 3000,
    categoryId: catId,
    occurredAt: new Date(2026, 9, 5, 10, 0).getTime(),
  });

  // 归档
  const ar = C.archiveCategory(catId);
  eq(ar.ok, true, '归档自定义分类成功');

  // 归档后：getCategories 仍含（含归档），getActiveCategories 不含
  eq(C.getCategories().length, 13, '归档后 getCategories 仍 13');
  eq(C.getActiveCategories().length, 12, '归档后 active 12');
  assert(!C.getActiveCategories().some((c) => c.id === catId), '归档分类不在 active');

  // 历史账单仍能解析归档分类（getCategory 含归档）
  const resolved = C.getCategory(catId);
  eq(resolved.name, '咖啡', '历史账单仍解析归档分类名');
  eq(resolved.emoji, '☕', '历史账单仍解析归档分类图标');

  // 恢复
  const rs = C.restoreCategory(catId);
  eq(rs.ok, true, '恢复分类成功');
  eq(C.getActiveCategories().length, 13, '恢复后 active 13');

  // 不存在的分类
  eq(C.archiveCategory('nope').ok, false, '归档不存在分类返回失败');
  eq(C.restoreCategory('nope').ok, false, '恢复不存在分类返回失败');
}

/* ================= D. 被周期规则引用时禁止归档 ================= */
console.log('D. 周期引用保护');
{
  const s = freshStore();
  const C = s.categories;

  // 建一条引用「住房」的周期规则（住房为预置可归档分类）
  s.recurring.createRule({
    type: 'expense',
    amountCents: 200000,
    categoryId: 'c-housing',
    note: '房租',
    frequency: 'monthly',
    interval: 1,
    day: 1,
    startDate: '2026-10-01',
    time: '09:00',
  });

  // 归档被引用的「住房」应被阻止
  const r = C.archiveCategory('c-housing');
  eq(r.ok, false, '被周期引用分类禁止归档');
  eq(r.reason, 'in-use', '返回 in-use');
  eq(r.recurringCount, 1, '引用规则数=1');

  // 未被引用的预置分类可归档
  eq(C.archiveCategory('c-travel').ok, true, '未被引用分类可归档');
}

/* ================= E. 归档 fail-closed：周期引用检查异常不放行（v0.6.1） ================= */
console.log('E. 归档 fail-closed（周期引用检查异常）');
{
  const s = freshStore();
  const rec = s.recurring;
  const orig = rec.countRulesByCategory;
  // 模拟 recurring.json 损坏 / IO 失败：周期引用检查抛错
  rec.countRulesByCategory = function () {
    throw new Error('recurring.json corrupt');
  };
  const r = s.categories.archiveCategory('c-drink');
  eq(r.ok, false, '周期引用检查失败时禁止归档');
  eq(r.reason, 'recurring-check-failed', '返回 recurring-check-failed');
  eq(s.categories.getCategory('c-drink').archived, false, '分类未被归档（fail-closed 安全）');
  // 恢复检查后可正常归档
  rec.countRulesByCategory = orig;
  eq(s.categories.archiveCategory('c-drink').ok, true, '检查恢复后可正常归档');
}

/* ================= F. 批量分类解析快照 getCategoryMap / getCategoryResolver（v0.7.0 G7） ================= */
console.log('F. 分类解析单次快照');
{
  const s = freshStore();
  const C = s.categories;

  const map = C.getCategoryMap();
  assert(map['c-food'] && map['c-food'].name === '餐饮', 'map 含核心分类 c-food');
  eq(Object.keys(map).length, 12, 'map 覆盖默认 12 分类');

  // 快照在新增分类之前取得：不应包含之后新增的分类
  const resolverBefore = C.getCategoryResolver();
  const added = C.addCategory({ name: '咖啡测试', emoji: '☕' });
  const newId = added.category.id;
  eq(resolverBefore(newId).id, 'c-other', '旧快照不含之后新增分类（单次快照，非全局缓存）');

  // 新 resolver 反映新增分类
  const resolver2 = C.getCategoryResolver();
  eq(resolver2(newId).name, '咖啡测试', '新 resolver 解析新增分类');
  eq(resolver2('c-food').name, '餐饮', 'resolver 解析正常分类');

  // 归档后：旧 resolver 仍为归档前快照；新 resolver 仍能解析归档分类（历史账单语义）
  eq(C.archiveCategory(newId).ok, true, '归档自定义分类');
  eq(resolver2(newId).archived, false, 'resolver2 为归档前快照，archived 仍 false');
  const resolver3 = C.getCategoryResolver();
  eq(resolver3(newId).archived, true, '新 resolver 反映归档状态');
  eq(resolver3(newId).name, '咖啡测试', '新 resolver 仍能解析归档分类（历史账单不丢）');

  // 悬空 id 与空 id 回退「其他」
  eq(resolver3('no-such-id').id, 'c-other', '悬空 id 回退其他');
  eq(resolver3(undefined).id, 'c-other', '空 id 回退其他');
}

/* ================= 汇总 ================= */
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
process.exit(0);
