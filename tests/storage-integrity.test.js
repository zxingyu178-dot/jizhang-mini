/**
 * tests/storage-integrity.test.js — v0.8.0 / G4 Storage Integrity Scan 单元测试
 *
 * 覆盖：正常数据全 VALID；各文件 JSON 损坏 → CORRUPT；结构错误 → INVALID_SHAPE；
 * version 非法 → UNSUPPORTED_VERSION；首次安装（全 MISSING）→ ok（MISSING 不算损坏）。
 *
 * 运行：node tests/storage-integrity.test.js
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

/* ---------- 内存 wx（含可写损坏文本的 fsm） ---------- */
function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const storage = {};
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
    setStorageSync: (k, v) => {
      storage[k] = v;
    },
    __fsm: fsm,
  };
}

global.wx = buildWx();
const ROOT = path.join(__dirname, '..');
const store = require(path.join(ROOT, 'data', 'index'));
const si = require(path.join(ROOT, 'data', 'storage-integrity'));

function fileStatus(scan, kind) {
  const e = scan.files.find((x) => x.kind === kind);
  return e ? e.status : '???';
}
function monthStatus(scan, ym) {
  const e = scan.months.find((x) => x.file.indexOf(ym) >= 0);
  return e ? e.status : '???';
}

/** 初始化一个含账单 + 周期规则的正常账本 */
function freshStore() {
  global.wx = buildWx();
  store.init();
  store.addBill({
    type: 'expense', amountCents: 2000, categoryId: 'c-food',
    occurredAt: new Date(2026, 9, 10, 12).getTime(),
  });
  store.recurring.createRule({
    type: 'expense', amountCents: 10000, categoryId: 'c-housing',
    frequency: 'monthly', interval: 1, day: 1, startDate: '2026-09-01', time: '09:00',
  });
  return global.wx;
}

/* ---------- 1. 正常数据：全部 VALID ---------- */
freshStore();
const good = si.scanStorage();
assert(good.ok === true, '正常账本扫描 ok');
assert(fileStatus(good, 'manifest') === 'VALID', 'manifest VALID');
assert(fileStatus(good, 'categories') === 'VALID', 'categories VALID');
assert(fileStatus(good, 'settings') === 'VALID', 'settings VALID');
assert(fileStatus(good, 'recurring') === 'VALID', 'recurring VALID');
assert(monthStatus(good, '2026-10') === 'VALID', '2026-10 月份 VALID');

/* ---------- 2. 各文件 JSON 损坏 → CORRUPT ---------- */
function corruptFile(kind, file) {
  const wx = freshStore();
  wx.__fsm.writeFileSync(file, '{ this is not json ');
  const scan = si.scanStorage();
  assert(scan.ok === false, kind + ' 损坏后 ok=false');
  assert(fileStatus(scan, kind) === 'CORRUPT', kind + ' CORRUPT');
}
corruptFile('manifest', store.paths.FILE.manifest);
corruptFile('categories', store.paths.FILE.categories);
corruptFile('settings', store.paths.FILE.settings);
corruptFile('recurring', store.paths.FILE.recurring);

/* ---------- 3. 月份文件损坏 → CORRUPT ---------- */
{
  const wx = freshStore();
  wx.__fsm.writeFileSync(store.paths.billFile('2026-10'), '[[[bad');
  const scan = si.scanStorage();
  assert(monthStatus(scan, '2026-10') === 'CORRUPT', '损坏月份 CORRUPT');
  assert(scan.ok === false, '损坏月份后 ok=false');
}

/* ---------- 4. 结构错误 → INVALID_SHAPE ---------- */
{
  const wx = freshStore();
  wx.__fsm.writeFileSync(store.paths.FILE.categories, JSON.stringify({ not: 'array' }));
  const scan = si.scanStorage();
  assert(fileStatus(scan, 'categories') === 'INVALID_SHAPE', 'categories 非数组 INVALID_SHAPE');
}
{
  const wx = freshStore();
  wx.__fsm.writeFileSync(store.paths.FILE.settings, JSON.stringify([1, 2]));
  const scan = si.scanStorage();
  assert(fileStatus(scan, 'settings') === 'INVALID_SHAPE', 'settings 非对象 INVALID_SHAPE');
}

/* ---------- 5. version 非法 → UNSUPPORTED_VERSION ---------- */
{
  const wx = freshStore();
  wx.__fsm.writeFileSync(
    store.paths.FILE.recurring,
    JSON.stringify({ version: 9, rules: [] })
  );
  const scan = si.scanStorage();
  assert(fileStatus(scan, 'recurring') === 'UNSUPPORTED_VERSION', 'recurring version=9 UNSUPPORTED_VERSION');
}

/* ---------- 6. 首次安装：全 MISSING，ok（MISSING 不算损坏） ---------- */
{
  global.wx = buildWx();
  const scan = si.scanStorage();
  assert(fileStatus(scan, 'manifest') === 'MISSING', '首装 manifest MISSING');
  assert(fileStatus(scan, 'categories') === 'MISSING', '首装 categories MISSING');
  assert(fileStatus(scan, 'settings') === 'MISSING', '首装 settings MISSING');
  assert(fileStatus(scan, 'recurring') === 'MISSING', '首装 recurring MISSING');
  assert(scan.ok === true, '首装全 MISSING 视为 ok（可初始化）');
}

console.log('storage-integrity tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
