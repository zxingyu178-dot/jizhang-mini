/**
 * tests/id-repair.test.js — 历史账单缺 id 修复测试
 *
 * 模拟真机：早期写入的月份文件中账单无 id（导致 schema 迁移抛错进保护模式）。
 * 验证 repairMissingIds 确定性补 id、不改语义、幂等、已有 id 不动，
 * 且修复后完整 init()（含 schema 迁移）不再抛错。
 *
 * 运行：node tests/id-repair.test.js
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
function eq(a, b, msg) {
  assert(a === b, msg + '（期望 ' + b + '，实际 ' + a);
}

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
    setStorageSync: (k, v) => {
      storage[k] = v;
    },
    __fsm: fsm,
  };
}

global.wx = buildWx();
const ROOT = path.join(__dirname, '..');
const store = require(path.join(ROOT, 'data', 'index'));
const idRepair = require(path.join(ROOT, 'data', 'id-repair'));

/* 先正常初始化，建立 manifest/categories/settings 等基础文件 */
store.init();

/* ---------- 构造真机历史：月份文件含无 id 账单（V2 形态） ---------- */
function noIdBill(o) {
  const b = {
    type: 'expense',
    categoryId: 'c-food',
    amountCents: 1000,
    occurredAt: new Date(2024, 8, 10, 12).getTime(),
    title: '',
    ledgerImpact: 'normal',
    dailyValue: { isDailyValue: false, amountCents: 0 },
  };
  return Object.assign(b, o);
}

const monthA = {
  ym: '2024-09',
  version: 2,
  bills: [
    noIdBill({ amountCents: 2000, occurredAt: new Date(2024, 8, 5, 8).getTime() }),
    noIdBill({ amountCents: 3500, occurredAt: new Date(2024, 8, 15, 19).getTime() }),
  ],
};
const monthB = {
  ym: '2025-11',
  version: 2,
  bills: [
    noIdBill({ amountCents: 4000, occurredAt: new Date(2025, 10, 1, 9).getTime() }),
    noIdBill({ amountCents: 5000, occurredAt: new Date(2025, 10, 20, 12).getTime() }),
    // 一条已有 id 的账单，修复时必须保持不变
    Object.assign(noIdBill({ amountCents: 6000, occurredAt: new Date(2025, 10, 25, 18).getTime() }), { id: 'keep-existing-1' }),
  ],
};
global.wx.__fsm.writeFileSync(store.paths.billFile('2024-09'), JSON.stringify(monthA));
global.wx.__fsm.writeFileSync(store.paths.billFile('2025-11'), JSON.stringify(monthB));

// 修复前：4 条无 id、1 条有 id
const beforeA = JSON.parse(global.wx.__fsm.readFileSync(store.paths.billFile('2024-09')));
const beforeB = JSON.parse(global.wx.__fsm.readFileSync(store.paths.billFile('2025-11')));
eq(beforeA.bills.filter((b) => !idRepair.hasId(b)).length, 2, '2024-09 修复前 2 条无 id');
eq(beforeB.bills.filter((b) => !idRepair.hasId(b)).length, 2, '2025-11 修复前 2 条无 id');

/* ---------- 1. 执行修复 ---------- */
const res = idRepair.repairMissingIds();
eq(res.repaired, 4, 'repairMissingIds 返回修复 4 条');

const afterA = JSON.parse(global.wx.__fsm.readFileSync(store.paths.billFile('2024-09')));
const afterB = JSON.parse(global.wx.__fsm.readFileSync(store.paths.billFile('2025-11')));
eq(afterA.bills.filter((b) => idRepair.hasId(b)).length, 2, '2024-09 修复后全部有 id');
eq(afterB.bills.filter((b) => idRepair.hasId(b)).length, 3, '2025-11 修复后全部有 id');

// 已有 id 的账单 id 不变
const kept = afterB.bills.find((b) => b.id === 'keep-existing-1');
assert(!!kept, '已有 id 的账单 id 保持不变');
eq(kept.amountCents, 6000, '保留账单内容不变');

// 补 id 前缀与内容语义
afterA.bills.forEach((b, i) => {
  assert(typeof b.id === 'string' && b.id.indexOf('fix-2024-09-' + i + '-') === 0, '修复 id 符合 fix-ym-i-hash：' + b.id);
  eq(b.ledgerImpact, 'normal', '修复账单 ledgerImpact 不变');
  eq(b.dailyValue.isDailyValue, false, '修复账单 dailyValue 不变');
});
// 关键金额 / 时间逐一核对（不改变语义；sortBills 降序，最新在前）
eq(afterA.bills[0].amountCents, 3500, '2024-09 排序后第1条(9/15)金额不变');
eq(afterA.bills[1].amountCents, 2000, '2024-09 排序后第2条(9/5)金额不变');

/* ---------- 2. 幂等：再跑一次不重复修补、id 不变 ---------- */
const idsBefore = [...afterA.bills, ...afterB.bills].map((b) => b.id);
const res2 = idRepair.repairMissingIds();
eq(res2.repaired, 0, '第二次修复 repaired=0（幂等）');
const afterA2 = JSON.parse(global.wx.__fsm.readFileSync(store.paths.billFile('2024-09')));
const afterB2 = JSON.parse(global.wx.__fsm.readFileSync(store.paths.billFile('2025-11')));
const idsAfter = [...afterA2.bills, ...afterB2.bills].map((b) => b.id);
eq(idsAfter.join(','), idsBefore.join(','), '幂等：所有 id 与首次修复后一致');

/* ---------- 3. 修复后完整 init()（含 schema 迁移）不再抛错 ---------- */
let initOk = true;
try {
  store.init();
} catch (e) {
  initOk = false;
  console.error('  init 抛错: ' + e.message);
}
assert(initOk, '修复后完整 init() 不抛错（不再进入保护模式）');

// 迁移后账单仍可正常读取、条数正确
const all = store.rangeBills();
const fixCount = all.filter((b) => String(b.id).indexOf('fix-') === 0).length;
eq(fixCount, 4, '迁移后 4 条修复账单仍在且保留 id');

console.log('id-repair tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
