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
    writeCounts: {},
    writeFailFor: null,
    writeCallFail: null,
    corruptSafetyOnRename: null,
    mutateBillFileAfterRename: null,
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
      const n = (faults.writeCounts[p] || 0) + 1;
      faults.writeCounts[p] = n;
      if (faults.writeFailFor && faults.writeFailFor(p)) {
        throw new Error('WRITE_FAIL ' + p);
      }
      if (faults.writeCallFail && faults.writeCallFail(p, n)) {
        throw new Error('WRITE_FAIL ' + p);
      }
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
      // 安全点写入后立即损坏（模拟安全点结构不合格）
      if (faults.corruptSafetyOnRename && newPath.indexOf('restore-safety.json') >= 0) {
        memFiles.set(newPath, toBuf(faults.corruptSafetyOnRename));
        faults.corruptSafetyOnRename = null;
      }
      // 月份分片写入后篡改（模拟「写成功但落盘内容被外部改坏」）
      if (
        faults.mutateBillFileAfterRename &&
        /\/bills\/\d{4}-\d{2}\.json$/.test(newPath)
      ) {
        try {
          const obj = JSON.parse(memFiles.get(newPath).toString('utf8'));
          const mutated = faults.mutateBillFileAfterRename(obj);
          if (mutated) memFiles.set(newPath, toBuf(JSON.stringify(mutated)));
        } catch (e) {}
        faults.mutateBillFileAfterRename = null;
      }
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

/* =================== Q8 恢复中途写入失败 → 按安全点回滚 =================== */
console.log('Q8 恢复中途写入失败 → 按安全点回滚');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  const extra10 = Object.assign({}, good.data.bills[0], {
    id: 'q8-10-target',
    occurredAt: at(2026, 10, 5),
  });
  good.data.bills = good.data.bills.concat([extra10]);
  fs.writeText(paths.billFile('2026-11'), CORRUPT_11);
  const raw11 = rawOf(paths.billFile('2026-11'));
  // 恢复写 2026-10 时失败（09 已成功），触发回滚
  global.wx.__faults.writeFailFor = (p) => p.indexOf('/bills/2026-10.json') >= 0;

  const { res, err } = runRestore(good);
  eq(res, null, 'Q8 恢复失败');
  eq(err && err.code, 'ATOMIC_WRITE_FAILED', 'Q8 抛出写入失败错误');
  eq(err && err.mutationStarted, true, 'Q8 mutationStarted=true');
  eq(err && err.rollbackAttempted, true, 'Q8 rollbackAttempted=true');
  eq(err && err.rollbackCompleted, true, 'Q8 rollbackCompleted=true');
  eq(fs.exists(paths.legacyRestoreSafety()), true, 'Q8 安全点保留');
  eq(ledger.readMonthFile('2026-09').bills.length, 1, 'Q8 回滚恢复安全点账单');
  eq(fs.exists(paths.billFile('2026-10')), false, 'Q8 失败的 2026-10 未落盘');
  eq(ledger.rangeBills(null, null).length, 1, 'Q8 账本无多余账单');

  const b = batches();
  eq(b.length, 1, 'Q8 恢复阶段留下 1 个隔离批次');
  eq(
    sameAs(paths.quarantineDir(b[0]) + '/2026-11.json', raw11),
    true,
    'Q8 隔离字节与原字节一致'
  );
  const meta = fs.readJSON(paths.quarantineDir(b[0]) + '/meta.json', null);
  eq(meta && meta.trigger, 'restore', 'Q8 隔离触发动作=restore');
}

/* =================== Q9 rollback 隔离失败 → 中止破坏性回滚 =================== */
console.log('Q9 rollback 隔离失败 → 中止破坏性回滚');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  const extra10 = Object.assign({}, good.data.bills[0], {
    id: 'q9-10-target',
    occurredAt: at(2026, 10, 6),
  });
  const extra11 = Object.assign({}, good.data.bills[0], {
    id: 'q9-11-target',
    occurredAt: at(2026, 11, 6),
  });
  good.data.bills = good.data.bills.concat([extra10, extra11]);
  fs.writeText(paths.billFile('2026-11'), CORRUPT_11);
  const raw11 = rawOf(paths.billFile('2026-11'));
  // 恢复写 2026-10 时失败；2026-11 保持损坏（尚未覆盖），回滚时隔离写入失败
  global.wx.__faults.writeFailFor = (p) => p.indexOf('/bills/2026-10.json') >= 0;
  global.wx.__faults.quarantineWriteCallFail = 2;

  const { res, err } = runRestore(good);
  eq(res, null, 'Q9 恢复失败');
  eq(err && err.code, 'ATOMIC_WRITE_FAILED', 'Q9 保留原始恢复错误码');
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

/* =================== R13 有效月份分片删除失败 =================== */
console.log('R13 有效月份分片删除失败 → 中止，不叠加写入');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  ledger.addBill({
    type: 'expense',
    amountCents: 880,
    categoryId: 'c-food',
    occurredAt: at(2026, 8, 8),
    note: 'R13八月账单',
  });
  const id08 = ledger.readMonthFile('2026-08').bills[0].id;
  const backend = backup.buildBackup();
  backend.data.bills = backend.data.bills.filter((b) => ledger.ymOf(b.occurredAt) !== '2026-08');
  backend.data.bills.push(
    Object.assign({}, backend.data.bills[0], {
      id: 'r13-10-target',
      occurredAt: at(2026, 10, 1),
      note: 'R13新账单',
    })
  );
  global.wx.__faults.unlinkFailFor.add(paths.billFile('2026-08'));

  const { res, err } = runRestore(backend);
  eq(res, null, 'R13 恢复未成功');
  eq(err && err.code, 'RESTORE_DELETE_FAILED', 'R13 抛出 RESTORE_DELETE_FAILED');
  eq(err && err.rollbackAttempted, true, 'R13 尝试回滚');
  eq(err && err.rollbackCompleted, true, 'R13 回滚完成');
  eq(fs.exists(paths.billFile('2026-08')), true, 'R13 原 2026-08 分片保留');
  eq(fs.exists(paths.billFile('2026-09')), true, 'R13 原 2026-09 分片保留');
  eq(fs.exists(paths.billFile('2026-10')), false, 'R13 备份账单未写入');
  eq(ledger.readMonthFile('2026-08').bills[0].id, id08, 'R13 2026-08 账单 ID 不变');
  eq(ledger.rangeBills(null, null).length, 2, 'R13 账本仍为原两笔（未叠加）');
}

/* =================== R13b 多月份删除中途失败 =================== */
console.log('R13b 多月份删除中途失败 → 已删月份由回滚恢复');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  ledger.addBill({
    type: 'expense',
    amountCents: 770,
    categoryId: 'c-food',
    occurredAt: at(2026, 7, 7),
    note: 'R13b七月账单',
  });
  ledger.addBill({
    type: 'expense',
    amountCents: 880,
    categoryId: 'c-food',
    occurredAt: at(2026, 8, 8),
    note: 'R13b八月账单',
  });
  const id07 = ledger.readMonthFile('2026-07').bills[0].id;
  const id08 = ledger.readMonthFile('2026-08').bills[0].id;
  const backend = backup.buildBackup();
  backend.data.bills = backend.data.bills.filter(
    (b) => ['2026-07', '2026-08'].indexOf(ledger.ymOf(b.occurredAt)) < 0
  );
  backend.data.bills.push(
    Object.assign({}, backend.data.bills[0], {
      id: 'r13b-10-target',
      occurredAt: at(2026, 10, 4),
      note: 'R13b新账单',
    })
  );
  global.wx.__faults.unlinkFailFor.add(paths.billFile('2026-08'));

  const { res, err } = runRestore(backend);
  eq(res, null, 'R13b 恢复未成功');
  eq(err && err.code, 'RESTORE_DELETE_FAILED', 'R13b 抛出 RESTORE_DELETE_FAILED');
  eq(err && err.rollbackCompleted, true, 'R13b 回滚完成');
  eq(fs.exists(paths.billFile('2026-07')), true, 'R13b 已删除的 2026-07 被回滚恢复');
  eq(ledger.readMonthFile('2026-07').bills[0].id, id07, 'R13b 2026-07 账单 ID 不变');
  eq(fs.exists(paths.billFile('2026-08')), true, 'R13b 2026-08 保留');
  eq(ledger.readMonthFile('2026-08').bills[0].id, id08, 'R13b 2026-08 账单 ID 不变');
  eq(fs.exists(paths.billFile('2026-10')), false, 'R13b 备份新账单未写入');
  eq(ledger.rangeBills(null, null).length, 3, 'R13b 账本仍为原三笔');
}

/* =================== R14–R18 安全点结构不合格 =================== */
function runInvalidSafetyCase(label, mutateTemplate, expectedRollbackCode) {
  fresh();
  warns.length = 0;
  const good = seedAndBuild();
  const originalId = good.data.bills[0].id;
  const template = backup.buildBackup();
  const injected = mutateTemplate(template);
  good.data.bills = good.data.bills.concat([
    Object.assign({}, good.data.bills[0], {
      id: 'invalid-safety-extra',
      occurredAt: at(2026, 9, 21),
    }),
  ]);
  // 恢复写 2026-09 必定失败 → 在「尚无任何写入」时触发回滚
  global.wx.__faults.writeFailFor = (p) => p.indexOf('/bills/2026-09.json') >= 0;
  global.wx.__faults.corruptSafetyOnRename =
    injected === null ? '{not-json' : JSON.stringify(injected);

  const { res, err } = runRestore(good);
  eq(res, null, label + ' 恢复未成功');
  eq(err && err.rollbackAttempted, true, label + ' 尝试回滚');
  eq(err && err.rollbackCompleted, false, label + ' 回滚未完成（不谎报成功）');
  eq(
    err && err.rollbackError && err.rollbackError.code,
    expectedRollbackCode,
    label + ' 明确记录安全点不合格'
  );
  eq(fs.exists(paths.legacyRestoreSafety()), true, label + ' 安全点保留');
  const mf = ledger.readMonthFile('2026-09');
  eq(mf.bills.length, 1, label + ' 当前账本未被删除 / 改写');
  eq(mf.bills[0].id, originalId, label + ' 当前账单 ID 不变');
}

runInvalidSafetyCase(
  'R14 安全点 JSON 损坏',
  () => null,
  'ROLLBACK_SAFETY_UNAVAILABLE'
);
runInvalidSafetyCase(
  'R15 安全点 bills 非数组',
  (t) => {
    t.data.bills = 'not-array';
    return t;
  },
  'ROLLBACK_SAFETY_INVALID'
);
runInvalidSafetyCase(
  'R16 安全点 bills 含非法对象',
  (t) => {
    t.data.bills = [null];
    return t;
  },
  'ROLLBACK_SAFETY_INVALID'
);
runInvalidSafetyCase(
  'R17 安全点 categories 非数组',
  (t) => {
    t.data.categories = 'not-array';
    return t;
  },
  'ROLLBACK_SAFETY_INVALID'
);
runInvalidSafetyCase(
  'R18 安全点重复 Bill ID',
  (t) => {
    t.data.bills = [t.data.bills[0], Object.assign({}, t.data.bills[0])];
    return t;
  },
  'ROLLBACK_SAFETY_INVALID'
);
runInvalidSafetyCase(
  'R18b 安全点 settings 缺失',
  (t) => {
    t.data.settings = null;
    return t;
  },
  'ROLLBACK_SAFETY_INVALID'
);

/* =================== R19 恢复后额外账单 → 精确对账拦截 =================== */
console.log('R19 恢复后额外账单 → 精确对账拦截并回滚');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  const originalId = good.data.bills[0].id;
  good.data.bills = good.data.bills.concat([
    Object.assign({}, good.data.bills[0], {
      id: 'r19-second',
      occurredAt: at(2026, 9, 12),
    }),
  ]);
  global.wx.__faults.mutateBillFileAfterRename = (mf) => {
    mf.bills.push(
      Object.assign({}, mf.bills[0], { id: 'r19-extra', note: 'R19外部多出' })
    );
    return mf;
  };

  const { res, err } = runRestore(good);
  eq(res, null, 'R19 恢复未成功');
  eq(err && err.code, 'RESTORE_INTEGRITY_FAILED', 'R19 抛出 RESTORE_INTEGRITY_FAILED');
  eq(err && err.extraCount, 1, 'R19 识别出 1 笔额外账单');
  eq(err && err.rollbackCompleted, true, 'R19 回滚完成');
  const mf = ledger.readMonthFile('2026-09');
  eq(mf.bills.length, 1, 'R19 回滚后账本恢复安全点');
  eq(mf.bills[0].id, originalId, 'R19 原账单 ID 不变');
}

/* =================== R20 恢复后数量相同但 ID 不同 =================== */
console.log('R20 恢复后数量相同但 ID 不同 → 精确对账拦截');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  const originalId = good.data.bills[0].id;
  good.data.bills = good.data.bills.concat([
    Object.assign({}, good.data.bills[0], {
      id: 'r20-second',
      occurredAt: at(2026, 9, 13),
    }),
  ]);
  global.wx.__faults.mutateBillFileAfterRename = (mf) => {
    mf.bills[0].id = 'r20-ghost';
    return mf;
  };

  const { res, err } = runRestore(good);
  eq(res, null, 'R20 恢复未成功');
  eq(err && err.code, 'RESTORE_INTEGRITY_FAILED', 'R20 抛出 RESTORE_INTEGRITY_FAILED');
  eq(err && err.missingCount, 1, 'R20 识别 1 笔缺失');
  eq(err && err.extraCount, 1, 'R20 识别 1 笔多余');
  eq(err && err.rollbackCompleted, true, 'R20 回滚完成');
  eq(ledger.readMonthFile('2026-09').bills[0].id, originalId, 'R20 回滚恢复原 ID');
}

/* =================== R21 元数据写入失败 → 回滚并核对 =================== */
console.log('R21 分类写入失败 → 回滚并恢复元数据');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  const originalId = good.data.bills[0].id;
  good.data.bills = good.data.bills.concat([
    Object.assign({}, good.data.bills[0], {
      id: 'r21-second',
      occurredAt: at(2026, 10, 2),
    }),
  ]);
  global.wx.__faults.writeCallFail = (p, n) =>
    p.indexOf('/categories.json') >= 0 && n === 1;

  const { res, err } = runRestore(good);
  eq(res, null, 'R21 恢复未成功');
  eq(err && err.code, 'ATOMIC_WRITE_FAILED', 'R21 暴露元数据写入失败');
  eq(err && err.rollbackCompleted, true, 'R21 回滚完成');
  eq(ledger.readMonthFile('2026-09').bills[0].id, originalId, 'R21 账本恢复安全点');
  eq(fs.exists(paths.billFile('2026-10')), false, 'R21 多余月份已回滚删除');
  assert(Array.isArray(fs.readJSON(paths.FILE.categories, null)), 'R21 分类文件可正常读取');
}

/* =================== R22 回滚写入再次失败 → 明确报告未完成 =================== */
console.log('R22 回滚写入再次失败 → 明确报告未完成');
fresh();
warns.length = 0;
{
  const good = seedAndBuild();
  good.data.bills = good.data.bills.concat([
    Object.assign({}, good.data.bills[0], {
      id: 'r22-second',
      occurredAt: at(2026, 9, 14),
    }),
    Object.assign({}, good.data.bills[0], {
      id: 'r22-10',
      occurredAt: at(2026, 10, 3),
    }),
  ]);
  // seedAndBuild 已写过一次 2026-09；恢复写第 2 次，回滚写第 3 次时失败
  global.wx.__faults.writeCallFail = (p, n) =>
    (p.indexOf('/bills/2026-10.json') >= 0 && n === 1) ||
    (p.indexOf('/bills/2026-09.json') >= 0 && n === 3);

  const { res, err } = runRestore(good);
  eq(res, null, 'R22 恢复未成功');
  eq(err && err.rollbackAttempted, true, 'R22 尝试回滚');
  eq(err && err.rollbackCompleted, false, 'R22 回滚未完成');
  eq(
    err && err.rollbackError && err.rollbackError.code,
    'ATOMIC_WRITE_FAILED',
    'R22 记录回滚写入失败'
  );
  eq(fs.exists(paths.legacyRestoreSafety()), true, 'R22 安全点保留');
  eq(ledger.readMonthFile('2026-09').bills.length, 2, 'R22 现场为恢复阶段写入的内容（未被谎报恢复）');
}

/* =================== 汇总 =================== */
console.warn = origWarn;
console.log('\nquarantine-rollback tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL QUARANTINE / ROLLBACK TESTS PASSED');
