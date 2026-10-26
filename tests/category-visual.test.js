/**
 * tests/category-visual.test.js — 分类视觉系统兼容测试（v1.2.0 Gate 8）
 *
 * 重点是「历史数据无损」，不为数量堆测试：
 *   - 旧分类无字段正常升级、默认 emoji 自动升级 builtin、用户改过的 emoji 不被覆盖；
 *   - builtin↔emoji 切换；Backup V3 roundtrip 保留图标；旧备份无图标字段仍能恢复；
 *   - Android 自定义 SVG/Emoji 分类导入；未知图标 fallback；归档分类历史显示；
 *   - 健康检查对视觉字段只 warning、不升级为结构错误。
 *
 * 内存文件系统 mock wx，无需真机。运行：node tests/category-visual.test.js
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

/* ---------- 内存 wx 环境（与 categories.test.js 一致） ---------- */
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
    renameSync(oldPath, newPath) {
      if (!memFiles.has(oldPath)) throw new Error('ENOENT');
      if (memFiles.has(newPath)) throw new Error('file already exists');
      memFiles.set(newPath, memFiles.get(oldPath));
      memFiles.delete(oldPath);
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
const categoriesModule = require(path.join(ROOT, 'data', 'categories'));
const dvAdapter = require(path.join(ROOT, 'packages', 'importer', 'adapters', 'dailyvalue'));

function freshStore() {
  global.wx = buildWx();
  store.init();
  return store;
}

/* ================= A. normalizeCategory 无损视觉迁移（纯函数） ================= */
console.log('A. 旧分类无损视觉迁移');
{
  const nc = categoriesModule.normalizeCategory;

  // A1 默认分类无 iconType、emoji 仍是系统默认 → 升级 builtin
  const a1 = nc({ id: 'c-food', name: '餐饮', emoji: '🍚' });
  eq(a1.iconType, 'builtin', 'A1 默认餐饮升级 builtin');
  eq(a1.iconValue, 'dining', 'A1 图标 dining');

  // A2 默认分类无 iconType、但用户已把 emoji 改成 🍺 → 保持 emoji，不被覆盖
  const a2 = nc({ id: 'c-drink', name: '饮料', emoji: '🍺' });
  eq(a2.iconType, 'emoji', 'A2 改过 emoji 保持 emoji 模式');
  eq(a2.iconValue, '🍺', 'A2 保留用户 emoji');

  // A3 非默认自定义分类无 iconType → 保持 emoji
  const a3 = nc({ id: 'x-custom', name: '宠物', emoji: '🐱' });
  eq(a3.iconType, 'emoji', 'A3 自定义分类保持 emoji');
  eq(a3.iconValue, '🐱', 'A3 自定义 emoji 保留');

  // A4 显式合法 builtin → 原样保留
  const a4 = nc({ id: 'x1', name: '咖啡', emoji: '☕', iconType: 'builtin', iconValue: 'coffee' });
  eq(a4.iconType, 'builtin', 'A4 显式 builtin 保留');
  eq(a4.iconValue, 'coffee', 'A4 builtin id 保留');

  // A5 显式 emoji → 原样保留
  const a5 = nc({ id: 'x2', name: '表情', emoji: '🎉', iconType: 'emoji', iconValue: '🎉' });
  eq(a5.iconType, 'emoji', 'A5 显式 emoji 保留');

  // A6 未知 builtin（iconValue 不在本地 49 内）→ 安全回退，不保留悬空图标
  const a6 = nc({ id: 'x3', name: '未知', emoji: '📦', iconType: 'builtin', iconValue: 'not-a-real-icon' });
  eq(a6.iconType, 'emoji', 'A6 未知 builtin 回退 emoji');
  assert(a6.iconValue !== 'not-a-real-icon', 'A6 不保留悬空 iconValue');

  // A7 缺 emoji 时兜底
  const a7 = nc({ id: 'x4', name: '空' });
  assert(a7.emoji, 'A7 缺 emoji 有兜底');
}

/* ================= B. 读取旧文件后的整体迁移（getCategories） ================= */
console.log('B. 旧版分类文件读取后迁移');
{
  const s = freshStore();
  // 模拟 v1.1.1 旧文件：默认分类仍是默认 emoji、无 iconType；一个分类用户改过 emoji
  const legacy = [
    { id: 'c-food', name: '餐饮', emoji: '🍚', builtin: true, sort: 1, archived: false },
    { id: 'c-drink', name: '饮料', emoji: '🍺', builtin: false, sort: 6, archived: false },
    { id: 'dvcat-pet', name: '宠物', emoji: '🐱', builtin: false, sort: 13, archived: false },
  ];
  s.fs.writeJSON(s.paths.FILE.categories, legacy);

  const cats = s.getCategories();
  const food = cats.find((c) => c.id === 'c-food');
  const drink = cats.find((c) => c.id === 'c-drink');
  const pet = cats.find((c) => c.id === 'dvcat-pet');
  eq(food.iconType, 'builtin', 'B1 旧默认餐饮升级 builtin');
  eq(food.iconValue, 'dining', 'B1 图标 dining');
  eq(drink.iconType, 'emoji', 'B2 改过的饮料保持 emoji');
  eq(drink.iconValue, '🍺', 'B2 用户 emoji 不被覆盖');
  eq(pet.iconType, 'emoji', 'B3 旧自定义分类保持 emoji');
}

/* ================= C. builtin ↔ emoji 切换（updateCategory） ================= */
console.log('C. 图标模式切换');
{
  const s = freshStore();
  const C = s.categories;
  // 预置 c-drink 初始 builtin/drink → 切到 emoji
  const r1 = C.updateCategory('c-drink', { iconType: 'emoji', iconValue: '🍻' });
  eq(r1.ok, true, 'C1 builtin→emoji 成功');
  eq(C.getCategory('c-drink').iconType, 'emoji', 'C1 已切 emoji');
  eq(C.getCategory('c-drink').iconValue, '🍻', 'C1 emoji 值');
  // 再切回 builtin
  const r2 = C.updateCategory('c-drink', { iconType: 'builtin', iconValue: 'coffee' });
  eq(r2.ok, true, 'C2 emoji→builtin 成功');
  eq(C.getCategory('c-drink').iconType, 'builtin', 'C2 已切 builtin');
  eq(C.getCategory('c-drink').iconValue, 'coffee', 'C2 builtin id');
  // 旧 emoji-only patch 兼容
  const r3 = C.updateCategory('c-drink', { emoji: '🥤' });
  eq(r3.ok, true, 'C3 旧 emoji patch 兼容');
  eq(C.getCategory('c-drink').iconType, 'emoji', 'C3 转 emoji 模式');
}

/* ================= D. Backup V3 roundtrip 保留图标 ================= */
console.log('D. 备份往返保留图标');
{
  const s = freshStore();
  // 给一个预置分类改图标，再新增一个 builtin 自定义分类
  s.categories.updateCategory('c-drink', { iconType: 'builtin', iconValue: 'coffee' });
  s.categories.addCategory({ name: '健身', iconType: 'builtin', iconValue: 'gym' });

  const backup = s.buildBackup();
  eq(backup.schemaVersion, 3, 'D0 备份为 V3');
  s.restoreBackup(backup);

  const drink = s.getCategory('c-drink');
  eq(drink.iconType, 'builtin', 'D1 恢复后 builtin 保留');
  eq(drink.iconValue, 'coffee', 'D1 图标 id 保留');
  const gym = s.getCategories().find((c) => c.name === '健身');
  assert(gym, 'D2 自定义分类恢复存在');
  eq(gym.iconValue, 'gym', 'D2 自定义 builtin 图标保留');
}

/* ================= E. 旧备份（无图标字段）仍能恢复 ================= */
console.log('E. 旧备份无图标字段恢复');
{
  const s = freshStore();
  const oldBackup = {
    format: 'daily-value-mini-backup',
    schemaVersion: 3,
    appVersion: '1.1.1',
    exportedAt: new Date().toISOString(),
    data: {
      bills: [],
      categories: [
        { id: 'c-food', name: '餐饮', emoji: '🍚', builtin: true, sort: 1, archived: false },
        { id: 'dvcat-x', name: '花', emoji: '🌸', builtin: false, sort: 13, archived: false },
      ],
      settings: s.getSettings(),
      recurringRules: [],
    },
  };
  const r = s.restoreBackup(oldBackup);
  assert(r.restored === 0, 'E0 旧备份恢复不报错');
  const food = s.getCategory('c-food');
  eq(food.iconType, 'builtin', 'E1 旧默认分类恢复后迁移 builtin');
  const flower = s.getCategory('dvcat-x');
  eq(flower.iconType, 'emoji', 'E2 旧自定义分类保持 emoji');
  eq(flower.iconValue, '🌸', 'E2 emoji 保留');
}

/* ================= F. Android .dvbackup 视觉接入 ================= */
console.log('F. Android 备份视觉接入');
{
  // F1 自定义分类：Android builtin 且 Mini 支持 → builtin
  const r1 = dvAdapter.mapBackupCategories([
    { id: 'cat-and-1', name: '咖啡', emoji: '☕', iconType: 'builtin', iconValue: 'coffee' },
  ]);
  eq(r1.toCreate.length, 1, 'F1 产出一个待建分类');
  eq(r1.toCreate[0].iconType, 'builtin', 'F1 复用 builtin');
  eq(r1.toCreate[0].iconValue, 'coffee', 'F1 builtin id 一致');

  // F2 自定义分类：emoji 模式 → 原样保留
  const r2 = dvAdapter.mapBackupCategories([
    { id: 'cat-and-2', name: '表情', emoji: '🎉', iconType: 'emoji', iconValue: '🎉' },
  ]);
  eq(r2.toCreate[0].iconType, 'emoji', 'F2 emoji 保留');
  eq(r2.toCreate[0].iconValue, '🎉', 'F2 emoji 值');

  // F3 Android builtin 但 Mini 不支持 → 退回 emoji
  const r3 = dvAdapter.mapBackupCategories([
    { id: 'cat-and-3', name: '未知', emoji: '🐲', iconType: 'builtin', iconValue: 'android-only-icon' },
  ]);
  eq(r3.toCreate[0].iconType, 'emoji', 'F3 不支持 builtin 回退 emoji');
  eq(r3.toCreate[0].iconValue, '🐲', 'F3 退回其 emoji');

  // F4 标准 12 类只做 id 映射，不进 toCreate（不覆盖本地图标）
  const r4 = dvAdapter.mapBackupCategories([
    { id: 'c-food', name: '餐饮', emoji: '🍚', iconType: 'builtin', iconValue: 'dining' },
  ]);
  eq(r4.toCreate.length, 0, 'F4 标准分类不重建');
  eq(r4.idMap['c-food'], 'c-food', 'F4 id 原样映射');

  // F5 无视觉字段的旧 Android 分类 → emoji 兜底
  const r5 = dvAdapter.mapBackupCategories([{ id: 'cat-and-5', name: '旧', emoji: '📦' }]);
  eq(r5.toCreate[0].iconType, 'emoji', 'F5 无字段走 emoji');
}

/* ================= G. 归档分类历史显示 ================= */
console.log('G. 归档分类历史显示');
{
  const s = freshStore();
  s.categories.addCategory({ name: '宠物', iconType: 'emoji', emoji: '🐱' });
  const petId = s.getCategories().find((c) => c.name === '宠物').id;
  s.categories.archiveCategory(petId);

  eq(s.getActiveCategories().some((c) => c.id === petId), false, 'G1 active 不含归档');
  eq(s.getCategories().some((c) => c.id === petId), true, 'G2 全量含归档，历史可解析');
  const archived = s.getCategory(petId);
  eq(archived.archived, true, 'G2 归档标记保留');
  assert(archived.iconType, 'G2 归档分类图标仍可解析');
}

/* ================= H. 健康检查：视觉字段只 warning ================= */
console.log('H. 健康检查视觉字段分级');
{
  const s = freshStore();
  const badCats = [
    { id: 'c-food', name: '餐饮', emoji: '🍚', iconType: 'weird', iconValue: 'x' },
    { id: 'c-drink', name: '饮料', emoji: '🥤', iconType: 'builtin', iconValue: 'missing-icon' },
    { id: 'c-other', name: '其他', emoji: '📦', iconType: 'builtin' },
  ];
  const report = s.analyzeHealth({
    rawMonthFiles: {},
    categories: badCats,
    recurringRulesRaw: [],
    budgetRulesRaw: [],
  });
  // 视觉问题不产生任何 error
  const visualErrors = report.errors.filter((e) => e.code.indexOf('icon') >= 0);
  eq(visualErrors.length, 0, 'H1 视觉字段不升级 error');
  const codes = report.warnings.map((w) => w.code);
  assert(codes.indexOf('category-icon-type-invalid') >= 0, 'H2 非法 iconType warning');
  assert(codes.indexOf('category-builtin-icon-unknown') >= 0, 'H3 未知 builtin warning');
  assert(codes.indexOf('category-icon-value-missing') >= 0, 'H4 缺 iconValue warning');
}

/* ================= 汇总 ================= */
console.log('\n分类视觉兼容测试：pass=' + pass + ' fail=' + fail);
if (fail > 0) process.exit(1);
console.log('全部通过');
process.exit(0);
