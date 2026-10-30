/**
 * tests/migtest-sandbox.test.js — v1.3.3 Gate 0 测试入口守卫与账本安全
 *
 * 三类验证：
 *   A. 隔离迁移沙箱 runMigtestSandbox：复用真实 legacyToBill，条数/金额/月份/分类映射
 *      正确，结束后整个沙箱目录删除；
 *   B. 正式账本零接触：沙箱不创建正式 bills / manifest 等路径；
 *   C. clearDonut 跨月清理：扫描全部月份、删除跨月残留的测试账单，真实账单保留。
 *
 * 运行：node tests/migtest-sandbox.test.js
 */
const path = require('path');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) {
  assert(a === b, msg + '（期望 ' + b + '，实际 ' + a + '）');
}

/* ---------- 内存文件系统（含 statSync / rmdirSync，供沙箱递归删除） ---------- */
function buildMemWx() {
  const memFiles = new Map();
  const memDirs = new Set();
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
      if (!memFiles.has(p)) throw new Error('ENOENT ' + p);
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
      memDirs.forEach((d) => {
        if (d.startsWith(prefix)) {
          const rest = d.slice(prefix.length);
          if (rest && !rest.includes('/')) out.add(rest);
        }
      });
      return [...out];
    },
    statSync(p) {
      const isDir = memDirs.has(p);
      const isFile = memFiles.has(p);
      if (!isDir && !isFile) throw new Error('ENOENT ' + p);
      return { isDirectory: () => isDir, isFile: () => isFile };
    },
    rmdirSync(p) {
      if (!memDirs.has(p)) throw new Error('ENOENT ' + p);
      const pfx = p + '/';
      let nonEmpty = false;
      memFiles.forEach((v, k) => { if (k.startsWith(pfx)) nonEmpty = true; });
      memDirs.forEach((d) => { if (d.startsWith(pfx)) nonEmpty = true; });
      if (nonEmpty) throw new Error('directory not empty ' + p);
      memDirs.delete(p);
    },
  };
  return {
    fsm,
    setWx() {
      global.wx = { env: { USER_DATA_PATH: '/usr' }, getFileSystemManager: () => fsm };
    },
  };
}

const ROOT = path.join(__dirname, '..');

/* ==================== A + B：隔离迁移沙箱 ==================== */
buildMemWx().setWx();
const sandbox = require(path.join(ROOT, 'utils', 'migtest-sandbox'));
const dataFs = require(path.join(ROOT, 'data', 'fs'));

const r = sandbox.runMigtestSandbox();
eq(r.recordCount, 3, 'A 转换 3 条');
eq(r.actualCount, 3, 'A 沙箱分片读回 3 条');
eq(r.months.join(','), '2026-09,2026-10', 'A 跨两个月（9/10）');
eq(r.incomeCents, 100000, 'A 收入 1000 元=100000 分');
eq(r.expenseCents, 3750, 'A 支出 25.5+12=37.5 元=3750 分');
eq(r.foodCategory, 'c-food', 'A 旧分类 food 映射 c-food');
eq(r.backupExists, true, 'A 沙箱内旧数据备份存在');
eq(r.sandboxRemoved, true, 'A 结束后沙箱已标记删除');

// B：沙箱目录已不存在，且正式账本路径从未被创建（零接触）
eq(dataFs.exists('/usr/__migtest_sandbox__'), false, 'B 沙箱根目录已删除');
eq(dataFs.exists('/usr/bills'), false, 'B 正式 bills 目录未被沙箱触碰');
eq(dataFs.exists('/usr/manifest.json'), false, 'B 正式 manifest 未被触碰');
eq(dataFs.exists('/usr/legacy'), false, 'B 正式 legacy 目录未被触碰');

/* ==================== C：测试数据清理（运行 ID + 命名空间） ==================== */
// 关键边界：release 下测试桥接入口 fail-closed、模块不可达，真实用户账本不会被任何
// 测试清理触碰；以下针对 develop/trial 测试环境，验证按 ID 精确清理 + 命名空间兜底，
// 普通真实账单（非测试命名空间、非 legacy 标识）绝不被删除。

// C1：全新账本（无测试清单），clearDonut 不凭裸 legacy 标识删除
buildMemWx().setWx();
const store1 = require(path.join(ROOT, 'data', 'index'));
const seed1 = require(path.join(ROOT, 'utils', 'e2e-donut-seed'));
const reg1 = require(path.join(ROOT, 'utils', 'test-registry'));
store1.init();
store1.addBill({
  type: 'expense', amount: 30, categoryId: 'c-life', note: seed1.E2E_DONUT_TAG,
  occurredAt: new Date(2026, 9, 11, 12).getTime(),
});
eq(reg1.registryExists(), false, 'C1 全新账本无测试清单');
eq(seed1.clearDonut().removed, 0, 'C1 全新账本不凭裸备注删除');
eq(store1.rangeBills().length, 1, 'C1 备注巧合的账单仍在');

// C2：测试环境 seed 注入命名空间账单 + 普通真实账单，clear 按 ID 精确清理、真实账单保留
buildMemWx().setWx();
const store2 = require(path.join(ROOT, 'data', 'index'));
const seed2 = require(path.join(ROOT, 'utils', 'e2e-donut-seed'));
const reg2 = require(path.join(ROOT, 'utils', 'test-registry'));
store2.init();
store2.addBill({
  type: 'expense', amount: 50, categoryId: 'c-fun', note: '真实消费',
  occurredAt: new Date(2026, 9, 12, 12).getTime(),
});
const seedRes = seed2.seedDonut();
eq(seedRes.createdIds.length, 5, 'C2 seed 注入 5 条命名空间账单');
eq(seedRes.runId.indexOf('donut-') === 0, true, 'C2 生成唯一 runId');
eq(reg2.registryExists(), true, 'C2 已持久化测试清单');
eq(store2.rangeBills().filter((b) => reg2.isTestNote(b.note)).length, 5, 'C2 5 条账单带命名空间标记');
eq(store2.rangeBills().length, 6, 'C2 共 6 条（5 测试 + 1 真实）');

const c2 = seed2.clearDonut();
eq(c2.removed, 5, 'C2 清理 5 条测试账单');
eq(c2.removedIds.length, 5, 'C2 按账单 ID 精确清理');
const remain2 = store2.rangeBills();
eq(remain2.length, 1, 'C2 清理后剩 1 条真实账单');
eq(remain2[0].note, '真实消费', 'C2 普通真实账单保留');
eq(seed2.clearDonut().removed, 0, 'C3 重复清理幂等');

// C4：清单内容丢失（文件在但 runs 空），靠命名空间兜底扫描清理残留
store2.addBill({
  type: 'expense', amount: 10, categoryId: 'c-food',
  note: reg2.encodeTestNote(reg2.makeRunId('ghost')),
  occurredAt: new Date(2026, 9, 13, 12).getTime(),
});
reg2.writeRegistry({ version: 1, runs: [] }); // 模拟清单内容损坏 / 丢失
eq(seed2.clearDonut().removed, 1, 'C4 清单丢失时命名空间兜底扫描清理残留');
eq(store2.rangeBills().length, 1, 'C4 兜底后真实账单仍在');

/* ==================== D：异常路径清理（try/finally 故障注入） ==================== */
// data/fs 每次动态取 fsm，替换 global.wx 后，缓存的 sandbox 模块也会用新 fsm。
function withFaulty(setup) {
  const mem = buildMemWx();
  mem.setWx();
  setup(mem.fsm);
}

// D1：写入失败 → 原始异常向上抛，且 finally 仍清理沙箱
withFaulty((f) => {
  f.writeFileSync = function () { throw new Error('WRITE_FAULT_EIO'); };
});
let d1 = false;
try {
  sandbox.runMigtestSandbox();
} catch (e) {
  d1 = true;
  assert(e.message.indexOf('WRITE_FAULT_EIO') >= 0, 'D1 原始写入异常保留：' + e.message);
}
assert(d1, 'D1 写入失败确实抛错');
eq(dataFs.exists('/usr/__migtest_sandbox__'), false, 'D1 写入失败后沙箱仍被清理');

// D2：读回失败（readJSON 吞读错转空 fallback）→ 条数自检失败抛错，且 finally 仍清理
withFaulty((f) => {
  const origRead = f.readFileSync;
  f.readFileSync = function (p) {
    if (String(p).indexOf('/bills/') >= 0) throw new Error('READ_FAULT_EIO');
    return origRead(p);
  };
});
let d2 = false;
try {
  sandbox.runMigtestSandbox();
} catch (e) {
  d2 = true;
  assert(e.message.indexOf('迁移沙箱自检失败') >= 0, 'D2 读回失败触发自检异常：' + e.message);
}
assert(d2, 'D2 读回失败确实抛错');
eq(dataFs.exists('/usr/__migtest_sandbox__'), false, 'D2 读回失败后沙箱仍被清理');

// D3：主体异常 + 清理同时失败 → 清理异常不覆盖原始异常
withFaulty((f) => {
  f.writeFileSync = function () { throw new Error('ORIGINAL_WRITE_FAULT'); };
  f.rmdirSync = function () { throw new Error('CLEANUP_RMDIR_FAULT'); };
});
let d3 = false;
try {
  sandbox.runMigtestSandbox();
} catch (e) {
  d3 = true;
  assert(e.message.indexOf('ORIGINAL_WRITE_FAULT') >= 0, 'D3 原始异常未被清理错误覆盖：' + e.message);
  eq(e.message.indexOf('CLEANUP_RMDIR_FAULT') < 0, true, 'D3 清理异常未向上抛出');
}
assert(d3, 'D3 主体异常确实抛错');

/* ---------- 汇总 ---------- */
console.log('\nmigtest-sandbox tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
