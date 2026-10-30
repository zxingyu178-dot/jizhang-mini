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

/* ==================== C：clearDonut 跨月清理 ==================== */
buildMemWx().setWx();
const store = require(path.join(ROOT, 'data', 'index'));
const seed = require(path.join(ROOT, 'utils', 'e2e-donut-seed'));
store.init();

// 两个月各注入一条带 E2E_DONUT 标识的账单，再加一条不同备注的真实账单
store.addBill({
  type: 'expense', amount: 10, categoryId: 'c-food', note: seed.E2E_DONUT_TAG,
  occurredAt: new Date(2026, 8, 10, 12).getTime(),
});
store.addBill({
  type: 'expense', amount: 20, categoryId: 'c-fun', note: seed.E2E_DONUT_TAG,
  occurredAt: new Date(2026, 9, 10, 12).getTime(),
});
store.addBill({
  type: 'expense', amount: 30, categoryId: 'c-life', note: '真实账单',
  occurredAt: new Date(2026, 9, 11, 12).getTime(),
});
eq(store.listMonths().length, 2, 'C 已建立两个月分片');

const cr = seed.clearDonut();
eq(cr.scannedMonthCount, 2, 'C 清理扫描全部 2 个月');
eq(cr.removed, 2, 'C 跨月删除 2 条测试账单');
eq(cr.months.join(','), '2026-09,2026-10', 'C 清理覆盖两个月');
const remaining = store.rangeBills();
eq(remaining.length, 1, 'C 清理后只剩 1 条真实账单');
eq(remaining[0].note, '真实账单', 'C 真实账单未被误删');

// 幂等：再清理一次应 removed=0
const cr2 = seed.clearDonut();
eq(cr2.removed, 0, 'C 重复清理幂等（0 条）');

/* ---------- 汇总 ---------- */
console.log('\nmigtest-sandbox tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
