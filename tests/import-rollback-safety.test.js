/**
 * tests/import-rollback-safety.test.js — v1.4.2 最终补丁
 *
 * P1：普通导入失败回滚不得覆盖导入前原始安全点。
 *   - 原始安全点：<USER_DATA_PATH>/legacy/restore-safety.json
 *   - 内部回滚临时安全点：legacy/import-rollback-safety-<batchId>.json
 *
 * 覆盖：
 *   A. 跨月份导入、第二个月写入失败 → 回滚成功，原始安全点保持导入前状态，临时安全点清理
 *   B. 同一场景 + 回滚再次写入失败 → 原始安全点保留、临时安全点保留、rollbackCompleted=false
 *   C. 正常导入成功 → 不产生临时安全点
 *
 * 运行：node tests/import-rollback-safety.test.js
 */
'use strict';

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
  assert(a === b, msg + '（期望 ' + b + '，实际 ' + a + '）');
}

function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const faults = {
    writeCallFail: null,
    writeCounts: {},
    unlinkFailMatch: null,
    unlinkNoopMatch: null,
  };
  const fsm = {
    accessSync(p) {
      if (memFiles.has(p) || memDirs.has(p)) return;
      throw new Error('ENOENT ' + p);
    },
    mkdirSync(p, recursive) {
      if (recursive) {
        let cur = '';
        p.split('/').forEach((x, i) => {
          if (i === 0 && x === '') cur = '';
          else {
            cur = cur + '/' + x;
            memDirs.add(cur);
          }
        });
      } else memDirs.add(p);
    },
    readFileSync(p, encoding) {
      if (!memFiles.has(p)) throw new Error('ENOENT ' + p);
      const v = memFiles.get(p);
      if (encoding) return v;
      return Buffer.from(v, 'utf8');
    },
    writeFileSync(p, data) {
      const n = (faults.writeCounts[p] || 0) + 1;
      faults.writeCounts[p] = n;
      if (faults.writeCallFail && faults.writeCallFail(p, n)) {
        throw new Error('WRITE_FAIL ' + p);
      }
      memFiles.set(p, typeof data === 'string' ? data : String(data));
    },
    unlinkSync(p) {
      if (faults.unlinkFailMatch && faults.unlinkFailMatch(p)) throw new Error('UNLINK_FAIL ' + p);
      // 未抛错但不删除：模拟「unlink 返回成功、文件却仍在」的真实故障
      if (faults.unlinkNoopMatch && faults.unlinkNoopMatch(p)) return;
      if (!memFiles.has(p)) throw new Error('ENOENT');
      memFiles.delete(p);
    },
    renameSync(a, b) {
      if (!memFiles.has(a)) throw new Error('ENOENT ' + a);
      if (memFiles.has(b)) throw new Error('file already exists ' + b);
      memFiles.set(b, memFiles.get(a));
      memFiles.delete(a);
    },
    readdirSync(p) {
      const prefix = p.endsWith('/') ? p : p + '/';
      const out = new Set();
      const add = (k) => {
        if (k.indexOf(prefix) !== 0) return;
        const rest = k.slice(prefix.length);
        if (!rest) return;
        const i = rest.indexOf('/');
        out.add(i < 0 ? rest : rest.slice(0, i));
      };
      memFiles.forEach((v, k) => add(k));
      memDirs.forEach((k) => add(k));
      return [...out];
    },
  };
  return {
    env: { USER_DATA_PATH: '/usr' },
    getFileSystemManager: () => fsm,
    getStorageSync: () => undefined,
    setStorageSync: () => {},
    getAppBaseInfo: () => ({ theme: 'dark' }),
    __faults: faults,
    __files: memFiles,
  };
}

global.wx = buildWx();
const ROOT = path.join(__dirname, '..');
const fs = require(path.join(ROOT, 'data', 'fs'));
const paths = require(path.join(ROOT, 'data', 'paths'));
const ledger = require(path.join(ROOT, 'data', 'ledger'));
const backup = require(path.join(ROOT, 'data', 'backup'));
const store = require(path.join(ROOT, 'data', 'index'));
const commit = require(path.join(ROOT, 'packages', 'importer', 'core', 'commit'));

function at(y, m, d) {
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}
function fresh() {
  global.wx = buildWx();
  store.init();
  ledger.addBill({
    type: 'expense',
    amountCents: 1999,
    categoryId: 'c-food',
    occurredAt: at(2026, 9, 10),
    note: '原始账单',
  });
  return global.wx;
}
function makeSession() {
  return {
    source: 'alipay',
    fileName: 'e2e.csv',
    counts: { ready: 2 },
    bills: [
      {
        status: 'ready',
        type: 'expense',
        amountCents: 100,
        categoryId: 'c-food',
        occurredAt: at(2026, 9, 20),
        merchant: '导入商户A',
        note: '导入A',
        source: 'alipay',
        sourceTxnId: 'T-A',
      },
      {
        status: 'ready',
        type: 'expense',
        amountCents: 200,
        categoryId: 'c-food',
        occurredAt: at(2026, 10, 20),
        merchant: '导入商户B',
        note: '导入B',
        source: 'alipay',
        sourceTxnId: 'T-B',
      },
    ],
  };
}
function safetyBills(file) {
  const obj = fs.readJSON(file, null);
  return obj && obj.data && Array.isArray(obj.data.bills) ? obj.data.bills : [];
}
function tempSafetyFiles() {
  return fs.listDir(paths.DIR.legacy).filter((n) => n.indexOf('import-rollback-safety-') === 0);
}

/* ==================== A. 回滚成功，原始安全点不被覆盖 ==================== */
console.log('A. 导入失败回滚成功：原始安全点保持导入前状态');
{
  const wx = fresh();
  const preIds = ledger.rangeBills().map((b) => b.id).sort();
  wx.__faults.writeCallFail = (p, n) => p.indexOf('/bills/2026-10.json') >= 0 && n === 1;

  let err = null;
  try {
    commit.commitImport(makeSession());
  } catch (e) {
    err = e;
  }
  assert(!!err, 'A 导入按预期失败');
  eq(err && err.rollbackAttempted, true, 'A 尝试回滚');
  eq(err && err.rollbackCompleted, true, 'A 回滚成功');

  const saved = safetyBills(paths.legacyRestoreSafety());
  eq(saved.length, 1, 'A 原始安全点仍为 1 笔（导入前）');
  eq(saved[0].id, preIds[0], 'A 原始安全点账单 ID 未变');
  eq(saved[0].note, '原始账单', 'A 原始安全点内容未变');
  eq(
    saved.some((b) => String(b.sourceTxnId || '').indexOf('alipay:T-') >= 0),
    false,
    'A 原始安全点不含导入账单'
  );

  const afterIds = ledger.rangeBills().map((b) => b.id).sort();
  eq(afterIds.join(','), preIds.join(','), 'A 账本恢复为导入前集合');
  eq(fs.exists(paths.billFile('2026-10')), false, 'A 失败月份未落盘');
  eq(tempSafetyFiles().length, 0, 'A 回滚成功后临时安全点已清理');
  eq(fs.exists(err.rollbackSafetyPath), false, 'A 临时安全点文件确实不存在（删后复查）');
  eq(
    err.rollbackSafetyCleanup && err.rollbackSafetyCleanup.ok,
    true,
    'A 清理状态记录为成功'
  );
  eq(
    err.rollbackSafetyCleanup && err.rollbackSafetyCleanup.code,
    'ROLLBACK_SAFETY_CLEANED',
    'A 清理成功错误码'
  );
  eq(
    err.rollbackSafetyCleanup && err.rollbackSafetyCleanup.path,
    err.rollbackSafetyPath,
    'A 清理状态带文件路径'
  );
}

/* ==================== B. 回滚也失败：两套安全点都保留 ==================== */
console.log('B. 回滚再次失败：原始安全点与临时安全点均保留');
{
  const wx = fresh();
  const preIds = ledger.rangeBills().map((b) => b.id).sort();
  // seed 写 09 一次；导入写 09 第二次；回滚写 09 第三次失败
  wx.__faults.writeCallFail = (p, n) =>
    (p.indexOf('/bills/2026-10.json') >= 0 && n === 1) ||
    (p.indexOf('/bills/2026-09.json') >= 0 && n === 3);

  let err = null;
  try {
    commit.commitImport(makeSession());
  } catch (e) {
    err = e;
  }
  assert(!!err, 'B 导入按预期失败');
  eq(err && err.rollbackAttempted, true, 'B 尝试回滚');
  eq(err && err.rollbackCompleted, false, 'B 回滚未完成');
  assert(!!err.rollbackSafetyPath, 'B 错误对象记录临时安全点路径');
  eq(fs.exists(err.rollbackSafetyPath), true, 'B 临时安全点保留');

  const saved = safetyBills(paths.legacyRestoreSafety());
  eq(saved.length, 1, 'B 原始安全点仍为 1 笔');
  eq(saved[0].id, preIds[0], 'B 原始安全点 ID 未变');
  eq(
    saved.some((b) => b.sourceTxnId === 'alipay:T-A' || b.sourceTxnId === 'alipay:T-B'),
    false,
    'B 原始安全点未被部分写入状态覆盖'
  );

  const temp = safetyBills(err.rollbackSafetyPath);
  assert(temp.length >= 1, 'B 临时安全点保存了回滚前现场');
  eq(
    err.rollbackSafetyCleanup && err.rollbackSafetyCleanup.code,
    'ROLLBACK_SAFETY_CLEANUP_SKIPPED',
    'B 回滚未完成时显式标记「未执行清理」'
  );
}

/* ==================== C. 正常导入成功 ==================== */
console.log('C. 正常导入成功：不产生临时安全点');
{
  fresh();
  const r = commit.commitImport(makeSession());
  eq(r.imported, 2, 'C 导入 2 笔');
  eq(ledger.rangeBills().length, 3, 'C 账本 = 原 1 + 导入 2');
  eq(tempSafetyFiles().length, 0, 'C 正常导入不产生临时安全点');
}

/* ==================== D. 清理接口抛异常：不影响回滚结论、文件保留 ==================== */
console.log('D. 临时安全点删除接口抛异常：回滚仍算成功，文件保留并可诊断');
{
  const wx = fresh();
  const preIds = ledger.rangeBills().map((b) => b.id).sort();
  wx.__faults.writeCallFail = (p, n) => p.indexOf('/bills/2026-10.json') >= 0 && n === 1;
  wx.__faults.unlinkFailMatch = (p) => p.indexOf('import-rollback-safety-') >= 0;

  let err = null;
  try {
    commit.commitImport(makeSession());
  } catch (e) {
    err = e;
  }
  assert(!!err, 'D 导入按预期失败');
  eq(err && err.rollbackAttempted, true, 'D 尝试回滚');
  eq(err && err.rollbackCompleted, true, 'D 回滚成功（清理失败不得把回滚报成失败）');
  eq(err && err.rollbackSafetyCleanup && err.rollbackSafetyCleanup.ok, false, 'D 清理状态为失败');
  eq(
    err && err.rollbackSafetyCleanup && err.rollbackSafetyCleanup.code,
    'ROLLBACK_SAFETY_CLEANUP_FAILED',
    'D 明确错误码'
  );
  eq(
    err && err.rollbackSafetyCleanup && err.rollbackSafetyCleanup.path,
    err.rollbackSafetyPath,
    'D 明确文件路径'
  );
  eq(fs.exists(err.rollbackSafetyPath), true, 'D 清理失败 → 临时安全点保留');
  eq(tempSafetyFiles().length, 1, 'D 目录里正好保留这 1 个临时安全点');

  // 已完成的账本恢复不受影响
  const afterIds = ledger.rangeBills().map((b) => b.id).sort();
  eq(afterIds.join(','), preIds.join(','), 'D 账本仍恢复为导入前集合');
  eq(fs.exists(paths.billFile('2026-10')), false, 'D 失败月份仍未落盘');
  // 原始安全点未被清理失败波及
  const saved = safetyBills(paths.legacyRestoreSafety());
  eq(saved.length, 1, 'D 原始安全点保留且仍为导入前 1 笔');
  eq(saved[0] && saved[0].id, preIds[0], 'D 原始安全点账单 ID 未变');
}

/* ==================== E. 删后文件仍存在：按失败处理并保留 ==================== */
console.log('E. unlink 未抛错但文件仍存在：按清理失败处理、文件保留');
{
  const wx = fresh();
  const preIds = ledger.rangeBills().map((b) => b.id).sort();
  wx.__faults.writeCallFail = (p, n) => p.indexOf('/bills/2026-10.json') >= 0 && n === 1;
  wx.__faults.unlinkNoopMatch = (p) => p.indexOf('import-rollback-safety-') >= 0;

  let err = null;
  try {
    commit.commitImport(makeSession());
  } catch (e) {
    err = e;
  }
  assert(!!err, 'E 导入按预期失败');
  eq(err && err.rollbackCompleted, true, 'E 回滚成功');
  eq(err && err.rollbackSafetyCleanup && err.rollbackSafetyCleanup.ok, false, 'E 清理状态为失败');
  eq(
    err && err.rollbackSafetyCleanup && err.rollbackSafetyCleanup.stillExists,
    true,
    'E 复查到文件仍存在'
  );
  eq(
    err && err.rollbackSafetyCleanup && err.rollbackSafetyCleanup.code,
    'ROLLBACK_SAFETY_CLEANUP_FAILED',
    'E 明确错误码'
  );
  eq(fs.exists(err.rollbackSafetyPath), true, 'E 文件保留');
  eq(ledger.rangeBills().map((b) => b.id).sort().join(','), preIds.join(','), 'E 账本恢复不受影响');
  eq(safetyBills(paths.legacyRestoreSafety()).length, 1, 'E 原始安全点保留');
}

/* ==================== F. 只清理本轮文件：不批量清理历史安全点 ==================== */
console.log('F. 清理只针对本轮 batchId：历史安全点与原始安全点一律不动');
{
  const wx = fresh();
  // 预置历史遗留临时安全点（模拟上一轮清理失败留下的文件）
  const oldTemp = paths.importRollbackSafety('imp-old-batch-file');
  fs.writeJSONAtomic(oldTemp, { marker: 'history' });
  const preIds = ledger.rangeBills().map((b) => b.id).sort();
  wx.__faults.writeCallFail = (p, n) => p.indexOf('/bills/2026-10.json') >= 0 && n === 1;

  let err = null;
  try {
    commit.commitImport(makeSession());
  } catch (e) {
    err = e;
  }
  assert(!!err, 'F 导入按预期失败');
  eq(err && err.rollbackCompleted, true, 'F 回滚成功');
  eq(fs.exists(oldTemp), true, 'F 历史临时安全点未被批量清理');
  eq(fs.readJSON(oldTemp, null) && fs.readJSON(oldTemp, null).marker, 'history', 'F 历史文件内容未动');
  eq(fs.exists(err.rollbackSafetyPath), false, 'F 本轮临时安全点已清理');
  eq(safetyBills(paths.legacyRestoreSafety()).length, 1, 'F 原始安全点保留');
  eq(ledger.rangeBills().map((b) => b.id).sort().join(','), preIds.join(','), 'F 账本恢复');
}

/* ==================== 汇总 ==================== */
console.log('\nimport-rollback-safety tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL IMPORT ROLLBACK SAFETY TESTS PASSED');
