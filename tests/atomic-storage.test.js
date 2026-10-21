/**
 * tests/atomic-storage.test.js — v1.1.0 / Gate 0 原子写与故障注入单元测试
 *
 * 验证核心目标：写入失败最多导致「这次修改没保存」，绝不能导致「整个旧文件消失 / 半截 JSON」。
 *   ATOMIC-01 tmp 写失败      → 原 settings 完整、无 tmp 残留
 *   ATOMIC-02 rename 失败     → 原 categories 完整、tmp 被清理
 *   ATOMIC-03 旧 recurring 损坏 → updateRule 拒绝、不创建新空 recurring、不覆盖损坏文件
 *   ATOMIC-04 月份文件损坏     → addBill 继续 fail-closed、不覆盖损坏文件
 *   ATOMIC-05 原子写成功       → 无 tmp / .bak 残留（含覆盖写）
 *   另补 updateJSONAtomic（create / validate 失败不写）行为。
 *
 * 内存文件系统 mock wx，运行：node tests/atomic-storage.test.js
 */
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
  assert(actual === expected, msg + ' (expected=' + expected + ', actual=' + actual);
}

/* ---------- 可注入故障的内存 wx ---------- */
function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const faults = {}; // 动态故障开关：tmpWrite / rename
  const fsm = {
    accessSync(p) {
      if (memFiles.has(p) || memDirs.has(p)) return;
      throw new Error('ENOENT ' + p);
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
      if (faults.tmpWrite && p.endsWith('.tmp')) throw new Error('TMP_WRITE_FAIL');
      memFiles.set(p, String(data));
    },
    unlinkSync(p) {
      if (!memFiles.has(p)) throw new Error('ENOENT');
      memFiles.delete(p);
    },
    renameSync(oldPath, newPath) {
      if (!memFiles.has(oldPath)) throw new Error('ENOENT');
      if (memFiles.has(newPath)) throw new Error('file already exists');
      if (faults.rename) throw new Error('RENAME_FAIL');
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
    __memFiles: memFiles,
    __faults: faults,
  };
}

function fresh() {
  global.wx = buildWx();
}

fresh();
const fs = require('../data/fs');
const paths = require('../data/paths');
const ledger = require('../data/ledger');
const recurringStore = require('../data/recurring/store');

function threw(fn, msg) {
  let t = false;
  try {
    fn();
  } catch (e) {
    t = true;
  }
  eq(t, true, msg);
}

/* ---------- ATOMIC-01：tmp 写失败 → 原 settings 完整 ---------- */
fresh();
const origSettings = {
  currency: '¥',
  theme: 'dark',
  budget: { rules: [{ id: 'r1', period: 'daily', amountCents: 5000 }] },
};
fs.writeJSONAtomic(paths.FILE.settings, origSettings);
global.wx.__faults.tmpWrite = true;
threw(
  () => fs.writeJSONAtomic(paths.FILE.settings, { currency: '¥', theme: 'light' }),
  'ATOMIC-01 tmp 写失败向上抛错'
);
const kept01 = fs.readJSONStrict(paths.FILE.settings);
eq(kept01.theme, 'dark', 'ATOMIC-01 原 settings 完整（theme 仍 dark）');
eq(kept01.budget.rules.length, 1, 'ATOMIC-01 原 budget rules 保留');
eq(global.wx.__memFiles.has(paths.FILE.settings + '.tmp'), false, 'ATOMIC-01 无 tmp 残留');
eq(global.wx.__memFiles.has(paths.FILE.settings + '.bak'), false, 'ATOMIC-01 无 bak 残留');

/* ---------- ATOMIC-02：rename 失败 → 原 categories 完整 ---------- */
fresh();
const origCats = [
  { id: 'c1', name: '我的分类', emoji: '🎈', builtin: false, sort: 1, archived: false },
];
fs.writeJSONAtomic(paths.FILE.categories, origCats);
global.wx.__faults.rename = true;
threw(
  () =>
    fs.writeJSONAtomic(paths.FILE.categories, [
      { id: 'c1', name: '被改写', emoji: '🎈', builtin: false, sort: 1, archived: false },
    ]),
  'ATOMIC-02 rename 失败向上抛错'
);
const kept02 = fs.readJSONStrict(paths.FILE.categories);
eq(kept02[0].name, '我的分类', 'ATOMIC-02 原 categories 完整（名称未被改写）');
eq(global.wx.__memFiles.has(paths.FILE.categories + '.tmp'), false, 'ATOMIC-02 tmp 被清理');
eq(global.wx.__memFiles.has(paths.FILE.categories + '.bak'), false, 'ATOMIC-02 无 bak 残留');

/* ---------- ATOMIC-03：旧 recurring 损坏 → updateRule 拒绝、不创建新空 ---------- */
fresh();
fs.writeText(paths.FILE.recurring, '### CORRUPT RECURRING ###');
threw(
  () => recurringStore.updateRule('r1', { amountCents: 1000 }),
  'ATOMIC-03 旧 recurring 损坏 updateRule 抛错'
);
eq(
  fs.readText(paths.FILE.recurring),
  '### CORRUPT RECURRING ###',
  'ATOMIC-03 损坏文件未被覆盖'
);
eq(global.wx.__memFiles.has(paths.FILE.recurring + '.tmp'), false, 'ATOMIC-03 未创建 tmp');
eq(global.wx.__memFiles.has(paths.FILE.recurring + '.bak'), false, 'ATOMIC-03 未创建 bak');
// addRule 同样 fail-closed
threw(
  () => recurringStore.addRule({ frequency: 'daily', amountCents: 1000, categoryId: 'c-food' }),
  'ATOMIC-03b 旧 recurring 损坏 addRule 同样抛错'
);
eq(
  fs.readText(paths.FILE.recurring),
  '### CORRUPT RECURRING ###',
  'ATOMIC-03b addRule 未覆盖损坏文件'
);

/* ---------- ATOMIC-04：月份文件损坏 → addBill 继续 fail-closed ---------- */
fresh();
fs.writeText(paths.billFile('2026-10'), '### CORRUPT MONTH ###');
threw(
  () =>
    ledger.addBill({
      type: 'expense',
      amountCents: 100,
      categoryId: 'c-food',
      occurredAt: new Date(2026, 9, 10, 12, 0).getTime(),
    }),
  'ATOMIC-04 损坏月份 addBill 抛错'
);
eq(
  fs.readText(paths.billFile('2026-10')),
  '### CORRUPT MONTH ###',
  'ATOMIC-04 损坏月份未被覆盖'
);
eq(global.wx.__memFiles.has(paths.billFile('2026-10') + '.tmp'), false, 'ATOMIC-04 未创建 tmp');

/* ---------- ATOMIC-05：原子写成功 → 无 tmp / bak 残留（含覆盖写） ---------- */
fresh();
fs.writeJSONAtomic(paths.FILE.settings, { currency: '¥', theme: 'dark' });
eq(global.wx.__memFiles.has(paths.FILE.settings + '.tmp'), false, 'ATOMIC-05 首写无 tmp 残留');
eq(global.wx.__memFiles.has(paths.FILE.settings + '.bak'), false, 'ATOMIC-05 首写无 bak 残留');
fs.writeJSONAtomic(paths.FILE.settings, { currency: '¥', theme: 'light' });
eq(fs.readJSONStrict(paths.FILE.settings).theme, 'light', 'ATOMIC-05 覆盖写成功生效');
eq(global.wx.__memFiles.has(paths.FILE.settings + '.tmp'), false, 'ATOMIC-05 覆盖写无 tmp 残留');
eq(global.wx.__memFiles.has(paths.FILE.settings + '.bak'), false, 'ATOMIC-05 覆盖写无 bak 残留');

/* ---------- 补充：updateJSONAtomic 行为 ---------- */
fresh();
// 文件不存在 → create 初始值
const created = fs.updateJSONAtomic(
  paths.FILE.categories,
  () => [{ id: 'x1', name: '初始', emoji: '📦', builtin: false, sort: 1, archived: false }],
  (arr) => arr
);
eq(created.length, 1, 'updateJSONAtomic 不存在时用 create 初始值');
// updater 变更被落盘
fs.updateJSONAtomic(
  paths.FILE.categories,
  () => [],
  (arr) => {
    arr.push({ id: 'x2', name: '新增', emoji: '🍜', builtin: false, sort: 2, archived: false });
    return arr;
  }
);
eq(fs.readJSONStrict(paths.FILE.categories).length, 2, 'updateJSONAtomic updater 变更落盘');
// validate 抛错 → 不写入（保持上一状态 2 条）
threw(
  () =>
    fs.updateJSONAtomic(
      paths.FILE.settings,
      () => ({}),
      (s) => {
        s.theme = 'dark';
      },
      () => {
        throw new Error('VALIDATE_FAIL');
      }
    ),
  'updateJSONAtomic validate 抛错向上传播'
);
// 原文件损坏 → updateJSONAtomic 抛错、不覆盖
fresh();
fs.writeText(paths.FILE.settings, '### CORRUPT ###');
threw(
  () =>
    fs.updateJSONAtomic(
      paths.FILE.settings,
      () => ({}),
      (s) => {
        s.theme = 'light';
      }
    ),
  'updateJSONAtomic 原文件损坏抛错'
);
eq(fs.readText(paths.FILE.settings), '### CORRUPT ###', 'updateJSONAtomic 损坏文件未被覆盖');

/* ---------- 补充：原子写残留识别（只识别报告，不自动删除/替换） ---------- */
const si = require('../data/storage-integrity');

// L1：正式文件 VALID + tmp 残留 → safeToClean
fresh();
fs.writeJSONAtomic(paths.FILE.settings, { currency: '¥', theme: 'dark' });
fs.writeText(paths.FILE.settings + '.tmp', JSON.stringify({ currency: '¥', theme: 'light' }));
const sL1 = si.scanStorage();
const lf1 = sL1.leftovers.find((l) => l.file === paths.FILE.settings + '.tmp');
eq(!!lf1, true, 'L1 识别到 VALID 文件旁的 tmp 残留');
eq(lf1.safeToClean, true, 'L1 正式文件 VALID → tmp safeToClean');
eq(lf1.artifactValid, true, 'L1 tmp 是合法 JSON');

// L2：正式文件 MISSING + bills 孤儿 tmp → safeToClean=false
fresh();
fs.writeText(paths.billFile('2026-09') + '.tmp', JSON.stringify({ ym: '2026-09', version: 3, bills: [] }));
const sL2 = si.scanStorage();
const lf2 = sL2.leftovers.find((l) => l.file === paths.billFile('2026-09') + '.tmp');
eq(!!lf2, true, 'L2 识别到 bills 目录孤儿 tmp');
eq(lf2.safeToClean, false, 'L2 正式文件 MISSING → 孤儿 tmp 不 safeToClean');
eq(lf2.targetStatus, 'MISSING', 'L2 targetStatus=MISSING');

// L3：正式文件 CORRUPT + bak 有效 → safeToClean=false、artifactValid=true
fresh();
fs.writeText(paths.FILE.settings, '### CORRUPT ###');
fs.writeText(paths.FILE.settings + '.bak', JSON.stringify({ currency: '¥', theme: 'dark' }));
const sL3 = si.scanStorage();
eq(sL3.ok, false, 'L3 正式文件损坏 scan.ok=false（进保护模式）');
const lf3 = sL3.leftovers.find((l) => l.file === paths.FILE.settings + '.bak');
eq(!!lf3, true, 'L3 识别到损坏文件旁的 bak 候选');
eq(lf3.artifactValid, true, 'L3 bak 是合法 JSON（可恢复候选）');
eq(lf3.safeToClean, false, 'L3 不自动清理/替换');

/* ---------- 汇总 ---------- */
console.log('atomic-storage tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) {
  process.exit(1);
}
console.log('ALL ATOMIC STORAGE TESTS PASSED');
