/**
 * tests/quarantine-rollback.test.js — v1.4.1 Gate 1 数据安全（fail-closed）
 *
 * 验证目标：
 *   1. 隔离完整（逐字节回读校验 + meta）才允许删除 / 覆盖；
 *   2. 隔离任一环节失败 → 中止恢复，原始分片保留且字节不变；
 *   3. 恢复中途失败 → 按安全点回滚；回滚前隔离失败 → 中止回滚、保留安全点；
 *   4. 错误对象带 mutationStarted / rollbackAttempted / rollbackCompleted；
 *   5. 日志 / meta 不含账单金额、商户、备注、ID。
 *
 * 用例：
 *   Q1  无损坏账本 → 正常恢复，不建隔离目录
 *   Q2  损坏分片隔离成功 → 字节完全一致，允许清理
 *   Q3  隔离文件写入失败 → 中止清理，原文件保留
 *   Q4  隔离目录创建失败 → 中止清理
 *   Q5  隔离后回读不一致 → 中止清理
 *   Q6  多个损坏分片、其中一个失败 → 所有原始文件保留
 *   Q7  meta 写入失败 → 不允许清理
 *   Q8  恢复中途异常 → 按安全点回滚（rollbackCompleted=true）
 *   Q9  rollback 隔离失败 → 中止破坏性回滚，安全点保留
 *   Q10 无法创建安全点 → 原账本完全不变
 *   Q11 不可解析 JSON（含中文）→ 原始字节得到保护
 *   Q12 非法数据结构 → 错误明确，不得静默删除
 *
 * 运行：node tests/quarantine-rollback.test.js
 */
'use strict';

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
  assert(actual === expected, msg + '（期望 ' + expected + '，实际 ' + actual + '）');
}
function includes(hay, needle, msg) {
  assert(String(hay).indexOf(needle) >= 0, msg + '（缺少 ' + needle + '）');
}

/* ---------- 内存文件系统 mock：保留原始字节 + 故障注入 ---------- */
function toBuf(data) {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (Buffer.isBuffer(data)) return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(String(data), 'utf8');
}

function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const faults = {
    quarantineWriteFail: false,
    quarantineWriteFailMatch: null,
    quarantineWriteCallFail: 0,
    quarantineReadBackMismatchFor: new Set(),
    quarantineReadBackMismatchMatch: null,
    quarantineDirFail: false,
    metaWriteFail: false,
    safetyWriteFail: false,
    unlinkFailFor: new Set(),
    quarantineShardWrites: 0,
  };
  const fsm = {
    accessSync(p) {
      if (memFiles.has(p) || memDirs.has(p)) return;
      throw new Error('ENOENT ' + p);
    },
    mkdirSync(p, recursive) {
      if (faults.quarantineDirFail && p.indexOf('/quarantine/') >= 0) {
        throw new Error('QUARANTINE_DIR_FAIL ' + p);
      }
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
      let buf = memFiles.get(p);
      if (
        faults.quarantineReadBackMismatchFor.has(p) ||
        (faults.quarantineReadBackMismatchMatch && faults.quarantineReadBackMismatchMatch(p))
      ) {
        faults.quarantineReadBackMismatchFor.delete(p);
        faults.quarantineReadBackMismatchMatch = null;
        const bad = Buffer.from(buf);
        if (bad.length) bad[0] = bad[0] ^ 0xff;
        buf = bad;
      }
      if (encoding) return buf.toString(encoding);
      return Buffer.from(buf);
    },
    writeFileSync(p, data) {
      const isQuarantine = p.indexOf('/quarantine/') >= 0;
      const isMeta = p.indexOf('/meta.json') >= 0;
      if (isQuarantine && !isMeta) {
        faults.quarantineShardWrites += 1;
        if (faults.quarantineWriteFail) throw new Error('QUARANTINE_WRITE_FAIL ' + p);
        if (faults.quarantineWriteFailMatch && faults.quarantineWriteFailMatch(p)) {
          throw new Error('QUARANTINE_WRITE_FAIL ' + p);
        }
        if (
          faults.quarantineWriteCallFail &&
          faults.quarantineShardWrites === faults.quarantineWriteCallFail
        ) {
          throw new Error('QUARANTINE_WRITE_FAIL ' + p);
        }
      }
      if (faults.metaWriteFail && isMeta) throw new Error('META_WRITE_FAIL ' + p);
      if (faults.safetyWriteFail && p.indexOf('restore-safety.json') >= 0) {
        throw new Error('SAFETY_WRITE_FAIL ' + p);
      }
      memFiles.set(p, toBuf(data));
    },
    unlinkSync(p) {
      if (faults.unlinkFailFor.has(p)) throw new Error('UNLINK_FAIL ' + p);
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
      const add = (k) => {
        if (k.indexOf(prefix) !== 0) return;
        const rest = k.slice(prefix.length);
        if (!rest) return;
        const idx = rest.indexOf('/');
        out.add(idx < 0 ? rest : rest.slice(0, idx));
      };
      memFiles.forEach((v, k) => add(k));
      memDirs.forEach((k) => add(k));
      return [...out];
    },
  };
  return {
    env: { USER_DATA_PATH: '/usr' },
    getFileSystemManager: () => fsm,
    __memFiles: memFiles,
    __memDirs: memDirs,
    __faults: faults,
  };
}

function fresh() {
  global.wx = buildWx();
}

/* ---------- 捕获 console.warn ---------- */
const warns = [];
const origWarn = console.warn;
console.warn = function () {
  warns.push([].slice.call(arguments).join(' '));
};

fresh();
const fs = require('../data/fs');
const paths = require('../data/paths');
const ledger = require('../data/ledger');
const backup = require('../data/backup');
const quarantine = require('../data/quarantine');

/* 损坏文本：含多字节中文 + 账单内容，用于同时验证「字节一致」与「内容不外泄」 */
const CORRUPT_11 =
  '{"ym":"2026-11","version":3,"bills":[{"id":"b-leak","amountCents":12345,"merchant":"老王便利店"';
const SHAPE_BAD_10 = '{"ym":"2026-10","version":3,"bills":"not-an-array"}';

function at(y, m, d) {
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}

/** 建立 2026-09 一笔合法账单，返回生产代码生成的备份对象 */
function seedAndBuild() {
  ledger.addBill({
    type: 'expense',
    amountCents: 1999,
    categoryId: 'c-food',
    occurredAt: at(2026, 9, 10),
    note: '主食',
  });
  return backup.buildBackup();
}

function batches() {
  return fs
    .listDir(paths.DIR.quarantine)
    .filter((n) => /^\d{8}-\d{6}-\d{3}(-\d+)?$/.test(n))
    .sort();
}

function runRestore(b) {
  try {
    return { res: backup.restoreBackup(b), err: null };
  } catch (e) {
    return { res: null, err: e };
  }
}

function rawOf(p) {
  return Buffer.from(fs.readBuffer(p));
}

function sameAs(p, expected) {
  if (!fs.exists(p)) return false;
  return Buffer.compare(rawOf(p), expected) === 0;
}

/* =================== Q1 无损坏账本 =================== */
console.log('Q1 无损坏账本 → 正常恢复');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  good.data.bills = good.data.bills.concat([
    Object.assign({}, good.data.bills[0], { id: 'q1-extra', occurredAt: at(2026, 9, 11) }),
  ]);
  const { res, err } = runRestore(good);
  eq(err, null, 'Q1 恢复成功');
  eq(res && res.restored, 2, 'Q1 恢复条数正确');
  eq(res && res.quarantine && res.quarantine.targetCount, 0, 'Q1 无损坏分片');
  eq(res && res.quarantine && res.quarantine.safeToProceed, true, 'Q1 隔离检查通过');
  eq(batches().length, 0, 'Q1 不创建隔离目录');
  eq(warns.length, 0, 'Q1 无隔离告警');
}

/* =================== Q2 + Q11 隔离成功 / 不可解析 JSON 字节保护 =================== */
console.log('Q2/Q11 损坏分片隔离成功 → 字节完全一致');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  fs.writeText(paths.billFile('2026-11'), CORRUPT_11);
  const raw11 = rawOf(paths.billFile('2026-11'));

  const { res, err } = runRestore(good);
  eq(err, null, 'Q2 恢复成功');
  eq(res && res.restored, 1, 'Q2 恢复条数正确');
  eq(res && res.quarantine && res.quarantine.targetCount, 1, 'Q2 识别 1 个损坏分片');
  eq(res && res.quarantine && res.quarantine.copiedCount, 1, 'Q2 成功转存 1 个');
  eq(res && res.quarantine && res.quarantine.complete, true, 'Q2 隔离完整');
  eq(fs.exists(paths.billFile('2026-11')), false, 'Q2 隔离完整后按原语义删除损坏月');

  const b = batches();
  eq(b.length, 1, 'Q2 生成 1 个隔离批次');
  const dir = paths.quarantineDir(b[0]);
  eq(sameAs(dir + '/2026-11.json', raw11), true, 'Q2 转存字节与原字节完全一致');
  eq(fs.readText(dir + '/2026-11.json'), CORRUPT_11, 'Q11 多字节中文逐字符一致');

  const meta = fs.readJSON(dir + '/meta.json', null);
  eq(meta && meta.complete, true, 'Q2 meta.complete=true');
  eq(meta && meta.items[0].verified, true, 'Q2 meta 记录逐字节校验通过');
  eq(meta && meta.items[0].bytes, raw11.length, 'Q2 meta 记录字节数');
  eq(meta && meta.items[0].reason, 'MONTH_CORRUPT', 'Q2 meta 记录错误码');
  const metaTxt = JSON.stringify(meta);
  eq(metaTxt.indexOf('老王便利店') >= 0, false, 'Q2 meta 不含商户');
  eq(metaTxt.indexOf('12345') >= 0, false, 'Q2 meta 不含金额');
  eq(metaTxt.indexOf('b-leak') >= 0, false, 'Q2 meta 不含账单 ID');
}

/* =================== Q3 隔离写入失败 =================== */
console.log('Q3 隔离写入失败 → 中止清理，原文件保留');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  fs.writeText(paths.billFile('2026-11'), CORRUPT_11);
  const raw11 = rawOf(paths.billFile('2026-11'));
  global.wx.__faults.quarantineWriteFail = true;

  const { res, err } = runRestore(good);
  eq(res, null, 'Q3 恢复未成功');
  eq(err && err.code, 'QUARANTINE_INCOMPLETE', 'Q3 抛出 QUARANTINE_INCOMPLETE');
  eq(err && err.mutationStarted, false, 'Q3 未开始任何破坏性修改');
  eq(err && err.rollbackAttempted, false, 'Q3 未执行回滚');
  eq(err && err.quarantine && err.quarantine.safeToProceed, false, 'Q3 结果标记不安全');
  eq(sameAs(paths.billFile('2026-11'), raw11), true, 'Q3 原始损坏分片字节不变');
  eq(ledger.readMonthFile('2026-09').bills.length, 1, 'Q3 账本未被覆盖');
  eq(fs.exists(paths.legacyRestoreSafety()), false, 'Q3 未写安全点（隔离在安全点之前）');

  const txt = warns.join(' | ');
  eq(txt.indexOf('老王便利店') >= 0, false, 'Q3 警告不含商户');
  eq(txt.indexOf('12345') >= 0, false, 'Q3 警告不含金额');
}

/* =================== Q4 目录创建失败 =================== */
console.log('Q4 隔离目录创建失败 → 中止清理');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  fs.writeText(paths.billFile('2026-11'), CORRUPT_11);
  const raw11 = rawOf(paths.billFile('2026-11'));
  global.wx.__faults.quarantineDirFail = true;

  const { res, err } = runRestore(good);
  eq(res, null, 'Q4 恢复未成功');
  eq(err && err.code, 'QUARANTINE_INCOMPLETE', 'Q4 抛出 QUARANTINE_INCOMPLETE');
  eq(err && err.quarantine && err.quarantine.skipped, 'dir-failed', 'Q4 标记 dir-failed');
  eq(sameAs(paths.billFile('2026-11'), raw11), true, 'Q4 原始分片保留');
  eq(ledger.readMonthFile('2026-09').bills.length, 1, 'Q4 账本未被覆盖');
}

/* =================== Q5 回读不一致 =================== */
console.log('Q5 隔离后回读不一致 → 中止清理');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  fs.writeText(paths.billFile('2026-11'), CORRUPT_11);
  const raw11 = rawOf(paths.billFile('2026-11'));
  global.wx.__faults.quarantineReadBackMismatchMatch = (p) =>
    p.indexOf('/quarantine/') >= 0 && p.indexOf('2026-11.json') >= 0;

  const { res, err } = runRestore(good);
  eq(res, null, 'Q5 恢复未成功');
  eq(err && err.code, 'QUARANTINE_INCOMPLETE', 'Q5 抛出 QUARANTINE_INCOMPLETE');
  const failed = (err && err.quarantine && err.quarantine.failedCount) || 0;
  eq(failed, 1, 'Q5 记录 1 个失败分片');
  eq(sameAs(paths.billFile('2026-11'), raw11), true, 'Q5 原始分片字节不变');
  eq(ledger.readMonthFile('2026-09').bills.length, 1, 'Q5 账本未被覆盖');
}

/* =================== Q6 多损坏分片，其中一个失败 =================== */
console.log('Q6 多个损坏分片、其中一个失败 → 所有原始文件保留');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  fs.writeText(paths.billFile('2026-10'), SHAPE_BAD_10);
  fs.writeText(paths.billFile('2026-11'), CORRUPT_11);
  const raw10 = rawOf(paths.billFile('2026-10'));
  const raw11 = rawOf(paths.billFile('2026-11'));
  global.wx.__faults.quarantineWriteFailMatch = (p) => p.indexOf('2026-11.json') >= 0;

  const { res, err } = runRestore(good);
  eq(res, null, 'Q6 恢复未成功');
  eq(err && err.code, 'QUARANTINE_INCOMPLETE', 'Q6 抛出 QUARANTINE_INCOMPLETE');
  eq(err && err.quarantine && err.quarantine.targetCount, 2, 'Q6 识别 2 个损坏分片');
  eq(err && err.quarantine && err.quarantine.copiedCount, 1, 'Q6 仅 1 个转存成功');
  eq(err && err.quarantine && err.quarantine.failedCount, 1, 'Q6 记录 1 个失败');
  eq(sameAs(paths.billFile('2026-10'), raw10), true, 'Q6 2026-10 原始字节保留');
  eq(sameAs(paths.billFile('2026-11'), raw11), true, 'Q6 2026-11 原始字节保留');
  eq(ledger.readMonthFile('2026-09').bills.length, 1, 'Q6 账本未被覆盖');
}

/* =================== Q7 meta 写入失败 =================== */
console.log('Q7 meta 写入失败 → 不允许清理');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  fs.writeText(paths.billFile('2026-11'), CORRUPT_11);
  const raw11 = rawOf(paths.billFile('2026-11'));
  global.wx.__faults.metaWriteFail = true;

  const { res, err } = runRestore(good);
  eq(res, null, 'Q7 恢复未成功');
  eq(err && err.code, 'QUARANTINE_INCOMPLETE', 'Q7 抛出 QUARANTINE_INCOMPLETE');
  eq(err && err.quarantine && err.quarantine.metaWritten, false, 'Q7 meta 未写入');
  eq(sameAs(paths.billFile('2026-11'), raw11), true, 'Q7 原始分片保留');
  eq(ledger.readMonthFile('2026-09').bills.length, 1, 'Q7 账本未被覆盖');
}

/* =================== Q8 恢复中途异常 → 按安全点回滚 =================== */
console.log('Q8 恢复中途异常 → 按安全点回滚');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  const extra = Object.assign({}, good.data.bills[0], {
    id: 'q8-11-target',
    occurredAt: at(2026, 11, 5),
  });
  good.data.bills = good.data.bills.concat([extra]);
  fs.writeText(paths.billFile('2026-11'), CORRUPT_11);
  const raw11 = rawOf(paths.billFile('2026-11'));
  global.wx.__faults.unlinkFailFor.add(paths.billFile('2026-11'));

  const { res, err } = runRestore(good);
  eq(res, null, 'Q8 恢复失败');
  eq(err && err.code, 'MONTH_CORRUPT', 'Q8 抛出 MONTH_CORRUPT');
  eq(err && err.mutationStarted, true, 'Q8 mutationStarted=true');
  eq(err && err.rollbackAttempted, true, 'Q8 rollbackAttempted=true');
  eq(err && err.rollbackCompleted, true, 'Q8 rollbackCompleted=true');
  eq(fs.exists(paths.legacyRestoreSafety()), true, 'Q8 安全点保留');
  eq(ledger.readMonthFile('2026-09').bills.length, 1, 'Q8 回滚恢复安全点账单');
  eq(ledger.rangeBills(null, null).filter((b) => b.ym !== '2026-11').length, 1, 'Q8 无多余账单');

  const b = batches();
  eq(b.length, 2, 'Q8 恢复 + 回滚各留 1 个隔离批次');
  b.forEach((name, i) => {
    eq(
      sameAs(paths.quarantineDir(name) + '/2026-11.json', raw11),
      true,
      'Q8 批次#' + (i + 1) + ' 字节与原字节一致'
    );
  });
  const triggers = b
    .map((n) => {
      const m = fs.readJSON(paths.quarantineDir(n) + '/meta.json', null);
      return m && m.trigger;
    })
    .sort();
  eq(triggers.join(','), 'import-rollback,restore', 'Q8 两批触发动作正确');
}

/* =================== Q9 rollback 隔离失败 → 中止破坏性回滚 =================== */
console.log('Q9 rollback 隔离失败 → 中止破坏性回滚');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  const extra = Object.assign({}, good.data.bills[0], {
    id: 'q9-11-target',
    occurredAt: at(2026, 11, 6),
  });
  good.data.bills = good.data.bills.concat([extra]);
  fs.writeText(paths.billFile('2026-11'), CORRUPT_11);
  const raw11 = rawOf(paths.billFile('2026-11'));
  global.wx.__faults.unlinkFailFor.add(paths.billFile('2026-11'));
  // 第 1 次（恢复阶段）隔离成功；第 2 次（回滚阶段）写入失败
  global.wx.__faults.quarantineWriteCallFail = 2;

  const { res, err } = runRestore(good);
  eq(res, null, 'Q9 恢复失败');
  eq(err && err.code, 'MONTH_CORRUPT', 'Q9 保留原始恢复错误码');
  eq(err && err.rollbackAttempted, true, 'Q9 尝试回滚');
  eq(err && err.rollbackCompleted, false, 'Q9 回滚未完成（不谎报成功）');
  eq(
    err && err.rollbackError && err.rollbackError.code,
    'ROLLBACK_QUARANTINE_INCOMPLETE',
    'Q9 明确记录回滚隔离失败'
  );
  eq(fs.exists(paths.legacyRestoreSafety()), true, 'Q9 安全点保留');
  eq(sameAs(paths.billFile('2026-11'), raw11), true, 'Q9 原始损坏分片仍保留');
}

/* =================== Q10 无法创建安全点 =================== */
console.log('Q10 无法创建安全点 → 原账本完全不变');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  good.data.bills = good.data.bills.concat([
    Object.assign({}, good.data.bills[0], { id: 'q10-extra', occurredAt: at(2026, 9, 12) }),
  ]);
  global.wx.__faults.safetyWriteFail = true;

  const { res, err } = runRestore(good);
  eq(res, null, 'Q10 恢复未成功');
  eq(err && err.code, 'SAFETY_POINT_FAILED', 'Q10 抛出 SAFETY_POINT_FAILED');
  eq(err && err.mutationStarted, false, 'Q10 未开始修改');
  eq(ledger.readMonthFile('2026-09').bills.length, 1, 'Q10 原账本完全不变');
  eq(batches().length, 0, 'Q10 无损坏分片不建隔离目录');
}

/* =================== Q12 非法数据结构 =================== */
console.log('Q12 非法数据结构 → 错误明确、不得静默删除');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  fs.writeText(paths.billFile('2026-10'), SHAPE_BAD_10);
  const raw10 = rawOf(paths.billFile('2026-10'));

  const { res, err } = runRestore(good);
  eq(res, null, 'Q12 恢复未成功');
  eq(err && err.code, 'SAFETY_POINT_FAILED', 'Q12 抛出错明确的 SAFETY_POINT_FAILED');
  eq(err && err.reason, 'BUILD_OR_WRITE_FAILED', 'Q12 记录安全点构建失败原因');
  eq(
    err && Array.isArray(err.unreadable) && err.unreadable[0] && err.unreadable[0].ym,
    '2026-10',
    'Q12 指出不可解析月份'
  );
  eq(sameAs(paths.billFile('2026-10'), raw10), true, 'Q12 非法结构原始字节保留');
  eq(ledger.readMonthFile('2026-09').bills.length, 1, 'Q12 账本未被修改');
  eq(fs.exists(paths.billFile('2026-10')), true, 'Q12 未静默删除');
}

/* =================== 汇总 =================== */
console.warn = origWarn;
console.log('\nquarantine-rollback tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL QUARANTINE / ROLLBACK TESTS PASSED');
