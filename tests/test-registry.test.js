/**
 * tests/test-registry.test.js — v1.3.4 测试注册表（运行 ID + 持久化清单 + 命名空间清理）
 *
 * 验证：
 *   1. makeRunId 唯一且前缀正确；
 *   2. encodeTestNote / isTestNote / runIdFromNote 只认命名空间前缀，拒绝普通备注；
 *   3. readRegistry 缺失 / 损坏自愈不抛；writeRegistry / registryExists / registerRun；
 *   4. cleanupTestBills 按账单 ID 精确删 + 命名空间兜底，绝不删无前缀真实账单。
 *
 * 运行：node tests/test-registry.test.js
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

/* ---------- 内存文件系统（data/fs 经 wx.getFileSystemManager 调用） ---------- */
function buildMemWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const fsm = {
    accessSync(p) {
      if (memFiles.has(p) || memDirs.has(p)) return;
      throw new Error('ENOENT ' + p);
    },
    mkdirSync(p) {
      p.split('/').reduce((cur, x) => {
        const nxt = cur ? cur + '/' + x : '/' + x;
        memDirs.add(nxt);
        return nxt;
      }, '');
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
      if (!memFiles.has(oldPath)) throw new Error('ENOENT ' + oldPath);
      if (memFiles.has(newPath)) throw new Error('file already exists ' + newPath);
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
  };
  return {
    fsm,
    setWx() {
      global.wx = { env: { USER_DATA_PATH: '/usr' }, getFileSystemManager: () => fsm };
    },
  };
}

const ROOT = path.join(__dirname, '..');
buildMemWx().setWx();

const reg = require(path.join(ROOT, 'utils', 'test-registry'));

/* ---------- 1. makeRunId ---------- */
const ids = new Set();
for (let i = 0; i < 50; i++) ids.add(reg.makeRunId('donut'));
eq(ids.size, 50, '1 连续生成 50 个 runId 全部唯一');
eq(reg.makeRunId('selftest').indexOf('selftest-') === 0, true, '1 runId 带指定前缀');
eq(reg.makeRunId().indexOf('run-') === 0, true, '1 缺省前缀为 run');

/* ---------- 2. note 编码 / 识别 / 提取 ---------- */
const note = reg.encodeTestNote('donut-123-abc');
eq(note, reg.TEST_NOTE_PREFIX + 'donut-123-abc', '2 encodeTestNote 带命名空间前缀');
eq(reg.isTestNote(note), true, '2 isTestNote 识别命名空间 note');
eq(reg.runIdFromNote(note), 'donut-123-abc', '2 runIdFromNote 正确提取 runId');

['E2E_DONUT', '__SELFTEST__', '真实消费', '瑞幸咖啡', '', null, undefined, 123].forEach((n) => {
  eq(reg.isTestNote(n), false, '2 isTestNote 拒绝普通/非字符串 note：' + String(n));
  eq(reg.runIdFromNote(n), null, '2 runIdFromNote 非测试 note 返回 null：' + String(n));
});

/* ---------- 3. 清单自愈与读写 ---------- */
eq(reg.registryExists(), false, '3 初始无清单文件');
const empty = reg.readRegistry();
eq(empty.version, 1, '3 缺失时 readRegistry 返回空骨架 version');
eq(empty.runs.length, 0, '3 缺失时 readRegistry 返回空 runs');

reg.writeRegistry({ version: 1, runs: [] });
eq(reg.registryExists(), true, '3 write 后清单存在');

reg.registerRun({ runId: 'r1', kind: 'donut', billIds: ['b1', 'b2'] });
reg.registerRun({ runId: 'r2', kind: 'selftest', billIds: ['b3'] });
const loaded = reg.readRegistry();
eq(loaded.runs.length, 2, '3 registerRun 追加两次');
eq(loaded.runs[0].runId, 'r1', '3 首次登记内容正确');
eq(loaded.runs[0].billIds.length, 2, '3 首次登记账单 ID 保留');
eq(loaded.runs[1].createdAt !== undefined, true, '3 缺省补 createdAt');

// 损坏文件自愈（不抛，回空骨架）
const fs = require(path.join(ROOT, 'data', 'fs'));
fs.writeText(fs.userRoot() + '/' + reg.REGISTRY_FILE_NAME, '{这不是合法JSON');
const healed = reg.readRegistry();
eq(healed.runs.length, 0, '3 损坏清单自愈回空骨架');

/* ---------- 4. cleanupTestBills ---------- */
// 用真实数据层（内存 wx），构造 store
const store = require(path.join(ROOT, 'data', 'index'));
store.init();

// 普通真实账单（无前缀），任何清理都不能删
store.addBill({
  type: 'expense', amount: 50, categoryId: 'c-fun', note: '真实消费',
  occurredAt: new Date(2026, 9, 1, 12).getTime(),
});
// 一笔命名空间测试账单（模拟本次 run）
const runId = reg.makeRunId('donut');
const tb = store.addBill({
  type: 'expense', amount: 10, categoryId: 'c-food',
  note: reg.encodeTestNote(runId),
  occurredAt: new Date(2026, 9, 2, 12).getTime(),
});
reg.registerRun({ runId, kind: 'donut', billIds: [tb.id] });
eq(store.rangeBills().length, 2, '4 共 2 条（1 真实 + 1 测试）');

const cr = reg.cleanupTestBills(store);
eq(cr.removed, 1, '4 清理 1 条测试账单');
eq(cr.removedById.length, 1, '4 按清单账单 ID 精确删除');
eq(cr.removedByScan.length, 0, '4 精确删除命中、无需兜底扫描');
const left = store.rangeBills();
eq(left.length, 1, '4 清理后剩 1 条');
eq(left[0].note, '真实消费', '4 无前缀真实账单保留');
eq(reg.readRegistry().runs.length, 0, '4 全量清理后清单 runs 清空');

// 4.1 清单丢失（runs 空）：账单 runId 未登记，兜底也不删（fail-safe，宁可残留不误删）
const ghost = reg.makeRunId('ghost');
store.addBill({
  type: 'expense', amount: 8, categoryId: 'c-food',
  note: reg.encodeTestNote(ghost),
  occurredAt: new Date(2026, 9, 3, 12).getTime(),
});
reg.writeRegistry({ version: 1, runs: [] });
const gr = reg.cleanupTestBills(store);
eq(gr.removed, 0, '4.1 清单 runs 空时兜底不删未登记账单');
eq(gr.removedByScan.length, 0, '4.1 未登记 runId 不在兜底范围');
eq(store.rangeBills().length, 2, '4.1 真实账单与未登记账单均保留');

// 4.2 runId 限定：只清指定 run，其他 run 保留
const keepRun = reg.makeRunId('keep');
const otherRun = reg.makeRunId('other');
const kb = store.addBill({
  type: 'expense', amount: 5, categoryId: 'c-food', note: reg.encodeTestNote(keepRun),
  occurredAt: new Date(2026, 9, 4, 12).getTime(),
});
store.addBill({
  type: 'expense', amount: 6, categoryId: 'c-fun', note: reg.encodeTestNote(otherRun),
  occurredAt: new Date(2026, 9, 5, 12).getTime(),
});
reg.registerRun({ runId: keepRun, kind: 'donut', billIds: [kb.id] });
reg.registerRun({ runId: otherRun, kind: 'donut', billIds: [] });
const limited = reg.cleanupTestBills(store, { runId: otherRun });
eq(limited.removed, 1, '4.2 仅清理指定 run');
eq(reg.readRegistry().runs.length, 1, '4.2 清单保留未清理的 run');
eq(store.rangeBills().some((b) => b.note === reg.encodeTestNote(keepRun)), true, '4.2 其他 run 账单保留');

/* ---------- 5. P1-1 安全专项（独立内存环境） ---------- */
function freshEnv() {
  buildMemWx().setWx();
  const s = require(path.join(ROOT, 'data', 'index'));
  s.init();
  return s;
}

// 5.1 真实账单备注恰好为 E2E_DONUT（裸备注），任何清理都保留
(function () {
  const s = freshEnv();
  const real = s.addBill({
    type: 'expense', amount: 30, categoryId: 'c-life', note: 'E2E_DONUT',
    occurredAt: new Date(2026, 9, 11, 12).getTime(),
  });
  const r = reg.makeRunId('donut');
  reg.registerRun({ runId: r, kind: 'donut', billIds: [] });
  const cr = reg.cleanupTestBills(s);
  eq(cr.removed, 0, '5.1 裸备注 E2E_DONUT 真实账单不被清理');
  eq(s.rangeBills().some((b) => b.id === real.id), true, '5.1 E2E_DONUT 真实账单保留');
})();

// 5.2 真实账单 ID 被错误写入测试清单，三重核对拦截、账单保留
(function () {
  const s = freshEnv();
  const real = s.addBill({
    type: 'expense', amount: 88, categoryId: 'c-fun', note: '真实消费',
    occurredAt: new Date(2026, 9, 12, 12).getTime(),
  });
  const r = reg.makeRunId('donut');
  reg.registerRun({ runId: r, kind: 'donut', billIds: [real.id] }); // 故意误入真实 ID
  const cr = reg.cleanupTestBills(s);
  eq(cr.removed, 0, '5.2 真实账单 ID 误入清单不被删除');
  eq(cr.removedById.length, 0, '5.2 三重核对（note/runId 不匹配）拦截');
  eq(s.rangeBills().some((b) => b.id === real.id), true, '5.2 真实账单保留');
})();

// 5.3 测试中途异常退出：本次已登记测试账单可被清理
(function () {
  const s = freshEnv();
  const r = reg.makeRunId('donut');
  reg.registerRun({ runId: r, kind: 'donut', billIds: [] });
  const tb = s.addBill({
    type: 'expense', amount: 10, categoryId: 'c-food',
    note: reg.encodeTestNote(r),
    occurredAt: new Date(2026, 9, 13, 12).getTime(),
  });
  reg.addBillToRun(r, tb.id); // 第一笔已及时登记，后续逻辑模拟异常（不继续）
  const cr = reg.cleanupTestBills(s);
  eq(cr.removed, 1, '5.3 异常退出后本次已登记测试账单可清理');
  eq(s.rangeBills().some((b) => b.id === tb.id), false, '5.3 已登记测试账单已删除');
  eq(reg.readRegistry().runs.length, 0, '5.3 清理后清单 run 移除');
})();

// 5.4 清理指定 run 时，真实账单与其他 run 账单均保留
(function () {
  const s = freshEnv();
  const real = s.addBill({
    type: 'expense', amount: 66, categoryId: 'c-fun', note: '真实消费',
    occurredAt: new Date(2026, 9, 14, 12).getTime(),
  });
  const runA = reg.makeRunId('a');
  const runB = reg.makeRunId('b');
  reg.registerRun({ runId: runA, kind: 'donut', billIds: [] });
  reg.registerRun({ runId: runB, kind: 'donut', billIds: [] });
  const bA = s.addBill({
    type: 'expense', amount: 11, categoryId: 'c-food',
    note: reg.encodeTestNote(runA),
    occurredAt: new Date(2026, 9, 15, 12).getTime(),
  });
  reg.addBillToRun(runA, bA.id);
  const bB = s.addBill({
    type: 'expense', amount: 22, categoryId: 'c-life',
    note: reg.encodeTestNote(runB),
    occurredAt: new Date(2026, 9, 16, 12).getTime(),
  });
  reg.addBillToRun(runB, bB.id);
  const cr = reg.cleanupTestBills(s, { runId: runA }); // 仅清理 runA
  eq(cr.removed, 1, '5.4 仅清理 runA 的账单');
  eq(s.rangeBills().some((b) => b.id === bA.id), false, '5.4 runA 账单已删');
  eq(s.rangeBills().some((b) => b.id === bB.id), true, '5.4 runB 账单保留');
  eq(s.rangeBills().some((b) => b.id === real.id), true, '5.4 真实账单保留');
  eq(reg.readRegistry().runs.length, 1, '5.4 清单保留 runB');
})();

/* ---------- 6. P2 deleteBill 故障注入：删除失败保留注册，下次继续清理 ---------- */
(function () {
  const s = freshEnv();
  const r = reg.makeRunId('donut');
  reg.registerRun({ runId: r, kind: 'donut', billIds: [] });
  const b1 = s.addBill({
    type: 'expense', amount: 10, categoryId: 'c-food',
    note: reg.encodeTestNote(r), occurredAt: new Date(2026, 9, 17, 12).getTime(),
  });
  const b2 = s.addBill({
    type: 'expense', amount: 12, categoryId: 'c-life',
    note: reg.encodeTestNote(r), occurredAt: new Date(2026, 9, 18, 12).getTime(),
  });
  reg.addBillToRun(r, b1.id);
  reg.addBillToRun(r, b2.id);
  eq(s.rangeBills().length, 2, '6 故障前共 2 笔测试账单');

  // 故障注入：deleteBill 一律抛错（保存原始实现以便恢复）。
  const realDeleteBill = s.deleteBill.bind(s);
  let injectFail = true;
  s.deleteBill = function (id) {
    if (injectFail) throw new Error('inject deleteBill failure');
    return realDeleteBill(id);
  };

  const failed = reg.cleanupTestBills(s);
  eq(failed.removed, 0, '6 故障注入下没有账单被删除');
  eq(failed.failedBillIds.length, 2, '6 返回值记录 2 个删除失败的账单 ID');
  eq(failed.failedBillIds.indexOf(b1.id) >= 0 && failed.failedBillIds.indexOf(b2.id) >= 0, true, '6 失败 ID 包含两笔账单');
  // 账单仍在（未被误删）
  eq(s.rangeBills().length, 2, '6 删除失败后账单仍保留');
  // 关键：run 与 billId 仍在注册表，保留后续清理依据
  const keptReg = reg.readRegistry();
  eq(keptReg.runs.length, 1, '6 删除失败后 run 仍保留在注册表');
  eq(keptReg.runs[0].runId, r, '6 保留的 runId 正确');
  eq(keptReg.runs[0].billIds.length, 2, '6 保留的 billIds 含两个未清理 ID');
  eq(keptReg.runs[0].billIds.indexOf(b1.id) >= 0 && keptReg.runs[0].billIds.indexOf(b2.id) >= 0, true, '6 注册表保留两笔账单 ID');

  // 恢复 deleteBill 正常，下次 cleanup 依据保留的注册继续清理
  injectFail = false;
  const retry = reg.cleanupTestBills(s);
  eq(retry.removed, 2, '6 故障恢复后下次清理成功删除 2 笔');
  eq(retry.failedBillIds.length, 0, '6 重试无删除失败');
  eq(s.rangeBills().length, 0, '6 重试后账单全部清理');
  eq(reg.readRegistry().runs.length, 0, '6 重试成功后 run 从注册表移除');
})();

// 6.2 部分失败：一笔成功、一笔失败，清单只保留失败那笔
(function () {
  const s = freshEnv();
  const r = reg.makeRunId('donut');
  reg.registerRun({ runId: r, kind: 'donut', billIds: [] });
  const ok = s.addBill({
    type: 'expense', amount: 10, categoryId: 'c-food',
    note: reg.encodeTestNote(r), occurredAt: new Date(2026, 9, 19, 12).getTime(),
  });
  const bad = s.addBill({
    type: 'expense', amount: 11, categoryId: 'c-life',
    note: reg.encodeTestNote(r), occurredAt: new Date(2026, 9, 20, 12).getTime(),
  });
  reg.addBillToRun(r, ok.id);
  reg.addBillToRun(r, bad.id);

  const realDeleteBill = s.deleteBill.bind(s);
  s.deleteBill = function (id) {
    if (id === bad.id) throw new Error('inject partial failure');
    return realDeleteBill(id);
  };

  const partial = reg.cleanupTestBills(s);
  eq(partial.removed, 1, '6.2 成功删除 1 笔');
  eq(partial.failedBillIds.length, 1, '6.2 仅 1 笔删除失败');
  eq(partial.failedBillIds[0], bad.id, '6.2 失败 ID 为 bad 账单');
  const kept = reg.readRegistry();
  eq(kept.runs.length, 1, '6.2 run 因有失败账单而保留');
  eq(kept.runs[0].billIds.length, 1, '6.2 清单只保留失败那笔 ID');
  eq(kept.runs[0].billIds[0], bad.id, '6.2 保留的是失败账单 ID');
  eq(s.rangeBills().some((b) => b.id === ok.id), false, '6.2 成功那笔已删除');
  eq(s.rangeBills().some((b) => b.id === bad.id), true, '6.2 失败那笔仍残留待清理');
})();

console.log('\ntest-registry tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
