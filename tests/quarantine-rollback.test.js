/**
 * tests/quarantine-rollback.test.js — v1.4.0 / QA-01 删前隔离转存
 *
 * 验证目标：恢复 / 回滚清空月份分片之前，「存在但不可解析」的分片原始字节先被抄到
 *   <USER_DATA_PATH>/quarantine/<批次>/，且原字节**完全一致**（逐字节比较）；
 *   同时不改变恢复 / 回滚的任何既有语义，隔离失败绝不让主流程失败。
 *
 *   QA01-1 恢复成功但存在损坏月 → 损坏月被删除，原始字节在 quarantine 可取回且完全一致
 *   QA01-2 恢复失败回滚（MONTH_CORRUPT）→ 恢复仍按原样抛错；两处调用点（restore /
 *          import-rollback）各留一批可恢复字节，均与原字节一致
 *   QA01-3 隔离写入失败（注入）→ 恢复照常成功，只留一条警告，且警告不含账单内容
 *   QA01-4 无损坏分片 → 不创建 quarantine 目录（不做无谓 IO）
 *   QA01-5 meta.json 字段齐备（原路径 / 字节数 / 时间 / 触发动作 / 失败原因），不含用户内容
 *
 * 运行：node tests/quarantine-rollback.test.js
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
  assert(actual === expected, msg + '（期望 ' + expected + '，实际 ' + actual + '）');
}

/* ---------- 内存文件系统 mock：按 wx 语义保留原始字节 ---------- */
function toBuf(data) {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (Buffer.isBuffer(data)) return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(String(data), 'utf8');
}

function buildWx() {
  const memFiles = new Map(); // path -> Buffer（原始字节）
  const memDirs = new Set();
  const faults = { quarantineWriteFail: false, unlinkFailFor: new Set() };
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
    readFileSync(p, encoding) {
      if (!memFiles.has(p)) throw new Error('ENOENT ' + p);
      const buf = memFiles.get(p);
      // 与 wx 一致：不传 encoding → 原始二进制；传 utf8 → 文本
      if (encoding) return buf.toString(encoding);
      return Buffer.from(buf);
    },
    writeFileSync(p, data) {
      if (faults.quarantineWriteFail && p.indexOf('/quarantine/') >= 0) {
        throw new Error('QUARANTINE_WRITE_FAIL ' + p);
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

/* ---------- 捕获 console.warn（校验降级警告内容） ---------- */
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

/** 建立一个月 2026-09 合法账单，返回备份对象（由生产代码自身生成，避免手搓形状） */
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

/** 找出全部隔离批次目录（按名字升序） */
function batches() {
  return fs
    .listDir(paths.DIR.quarantine)
    .filter((n) => /^\d{8}-\d{6}-\d{3}(-\d+)?$/.test(n))
    .sort();
}

/* =================== QA01-1：恢复成功路径也必须留字节 =================== */
// 说明：形状非法（JSON 合法但 bills 非数组）的分片无法走到本步——安全点 buildBackup()
// 里的 rangeBills() 会在读取时直接抛 TypeError，恢复根本进不到删除阶段（既有行为，本用例不改）。
// 真实会「被读成空再删掉」的是**解析失败**的分片，故此处只造一个损坏月。
fresh();
warns.length = 0;
const good1 = seedAndBuild();
fs.writeText(paths.billFile('2026-11'), CORRUPT_11);
const raw11 = Buffer.from(fs.readBuffer(paths.billFile('2026-11')));

let r1 = null;
let threw1 = null;
try {
  r1 = backup.restoreBackup(good1);
} catch (e) {
  threw1 = e;
}
eq(threw1, null, 'QA01-1 恢复成功（不因存在损坏月而失败）');
eq(r1 && r1.restored, 1, 'QA01-1 恢复条数正确');
eq(fs.exists(paths.billFile('2026-11')), false, 'QA01-1 损坏月原文件已按原语义删除');

const b1 = batches();
eq(b1.length, 1, 'QA01-1 生成 1 个隔离批次');
const dir1 = paths.quarantineDir(b1[0]);
eq(fs.exists(dir1 + '/2026-11.json'), true, 'QA01-1 损坏月原始字节已转存');
eq(
  Buffer.compare(Buffer.from(fs.readBuffer(dir1 + '/2026-11.json')), raw11),
  0,
  'QA01-1 转存字节与原字节完全一致（含多字节中文）'
);
eq(fs.readText(dir1 + '/2026-11.json'), CORRUPT_11, 'QA01-1 转存文本与原文逐字符一致');

/* =================== QA01-5：meta 字段齐备且不含用户内容 =================== */
const meta1 = fs.readJSON(dir1 + '/meta.json', null);
assert(!!meta1, 'QA01-5 meta.json 存在且可解析');
eq(meta1.format, quarantine.META_FORMAT, 'QA01-5 meta.format 正确');
eq(meta1.trigger, quarantine.TRIGGERS.RESTORE, 'QA01-5 meta.trigger=restore');
assert(typeof meta1.createdAt === 'string' && meta1.createdAt.length >= 20, 'QA01-5 meta.createdAt 是 ISO 时间');
eq(meta1.items.length, 1, 'QA01-5 meta.items 记录损坏分片');
const it11 = meta1.items.filter((x) => x.ym === '2026-11')[0];
assert(!!it11, 'QA01-5 meta 含 2026-11 条目');
eq(it11.originalPath, paths.billFile('2026-11'), 'QA01-5 meta 记录原路径');
eq(it11.bytes, raw11.length, 'QA01-5 meta 记录字节数');
eq(it11.reason, 'MONTH_CORRUPT', 'QA01-5 meta 记录失败原因（错误码）');
const metaTxt = JSON.stringify(meta1);
eq(metaTxt.indexOf('老王便利店') >= 0, false, 'QA01-5 meta 不含商户内容');
eq(metaTxt.indexOf('12345') >= 0, false, 'QA01-5 meta 不含金额内容');
eq(metaTxt.indexOf('b-leak') >= 0, false, 'QA01-5 meta 不含账单 ID / 备注内容');

/* =================== QA01-4：无损坏分片 → 不建目录 =================== */
fresh();
warns.length = 0;
const good4 = seedAndBuild();
let r4 = null;
let threw4 = null;
try {
  r4 = backup.restoreBackup(good4);
} catch (e) {
  threw4 = e;
}
eq(threw4, null, 'QA01-4 无损坏分片时恢复成功');
eq(r4 && r4.restored, 1, 'QA01-4 恢复条数正确');
eq(batches().length, 0, 'QA01-4 无损坏分片不创建隔离批次');
eq(fs.exists(paths.DIR.quarantine), false, 'QA01-4 连 quarantine 根目录都不创建');
eq(warns.length, 0, 'QA01-4 不产生隔离告警');

/* =================== QA01-2：失败回滚 + 两处调用点都留字节 =================== */
fresh();
warns.length = 0;
const good2 = seedAndBuild();
// 备份里加一笔 2026-11 账单 → 恢复时该月仍存在损坏文件（unlink 注入失败）→ MONTH_CORRUPT
const extraBill = Object.assign({}, good2.data.bills[0], {
  id: 'b-11-target',
  occurredAt: at(2026, 11, 5),
});
good2.data.bills = good2.data.bills.concat([extraBill]);
fs.writeText(paths.billFile('2026-11'), CORRUPT_11);
const raw2 = Buffer.from(fs.readBuffer(paths.billFile('2026-11')));
// 注入：删除该分片失败（模拟 unlink 受限），使恢复阶段仍会读到损坏月
global.wx.__faults.unlinkFailFor.add(paths.billFile('2026-11'));

let threw2 = null;
try {
  backup.restoreBackup(good2);
} catch (e) {
  threw2 = e;
}
assert(!!threw2, 'QA01-2 恢复按原语义抛出异常');
eq(threw2 && threw2.code, 'MONTH_CORRUPT', 'QA01-2 抛出 MONTH_CORRUPT（语义未改）');

const b2 = batches();
eq(b2.length, 2, 'QA01-2 两处调用点各留 1 个隔离批次（restore + import-rollback）');
const metaA = fs.readJSON(paths.quarantineDir(b2[0]) + '/meta.json', null);
const metaB = fs.readJSON(paths.quarantineDir(b2[1]) + '/meta.json', null);
const triggers = [metaA && metaA.trigger, metaB && metaB.trigger].sort();
eq(triggers.join(','), 'import-rollback,restore', 'QA01-2 两批触发动作分别为 restore / import-rollback');
b2.forEach((name, i) => {
  const p = paths.quarantineDir(name) + '/2026-11.json';
  eq(fs.exists(p), true, 'QA01-2 批次#' + (i + 1) + ' 含 2026-11 原始字节');
  eq(
    Buffer.compare(Buffer.from(fs.readBuffer(p)), raw2),
    0,
    'QA01-2 批次#' + (i + 1) + ' 字节与原字节完全一致'
  );
});
// 回滚语义保持：安全点里的 2026-09 账单已回来（损坏月不在安全点，故不会凭空出现）
const after2 = ledger.rangeBills(null, null).filter((b) => b.ym !== '2026-11');
const sep2 = ledger.readMonthFile('2026-09').bills;
eq(sep2.length, 1, 'QA01-2 回滚后 2026-09 仍为安全点的 1 笔（回滚语义未改）');
eq(after2.length, 1, 'QA01-2 回滚后账本无多余账单');

/* =================== QA01-3：隔离写入失败 → 主流程不受影响 =================== */
fresh();
warns.length = 0;
const good3 = seedAndBuild();
fs.writeText(paths.billFile('2026-11'), CORRUPT_11);
global.wx.__faults.quarantineWriteFail = true;

let r3 = null;
let threw3 = null;
try {
  r3 = backup.restoreBackup(good3);
} catch (e) {
  threw3 = e;
}
eq(threw3, null, 'QA01-3 隔离写入失败时恢复照常成功（不因此失败）');
eq(r3 && r3.restored, 1, 'QA01-3 恢复条数正确');
eq(fs.exists(paths.billFile('2026-11')), false, 'QA01-3 原语义不变：损坏月仍被删除');
assert(warns.length >= 1, 'QA01-3 留下降级警告（' + warns.length + ' 条）');
const warnTxt = warns.join(' | ');
eq(warnTxt.indexOf('/quarantine/') >= 0, true, 'QA01-3 警告提到隔离路径');
eq(warnTxt.indexOf('老王便利店') >= 0, false, 'QA01-3 警告不含商户内容');
eq(warnTxt.indexOf('12345') >= 0, false, 'QA01-3 警告不含金额内容');

/* =================== QA01-3b：回滚阶段隔离失败也不影响回滚 =================== */
fresh();
warns.length = 0;
const good3b = seedAndBuild();
const extra3b = Object.assign({}, good3b.data.bills[0], {
  id: 'b-11-target2',
  occurredAt: at(2026, 11, 6),
});
good3b.data.bills = good3b.data.bills.concat([extra3b]);
fs.writeText(paths.billFile('2026-11'), CORRUPT_11);
global.wx.__faults.unlinkFailFor.add(paths.billFile('2026-11'));
global.wx.__faults.quarantineWriteFail = true; // 隔离写入失败（含回滚阶段）

let threw3b = null;
try {
  backup.restoreBackup(good3b);
} catch (e) {
  threw3b = e;
}
eq(threw3b && threw3b.code, 'MONTH_CORRUPT', 'QA01-3b 隔离失败时仍抛原本的 MONTH_CORRUPT');
eq(ledger.readMonthFile('2026-09').bills.length, 1, 'QA01-3b 回滚照常完成（安全点 2026-09 已回来）');
// 隔离写入全部失败 → 批次目录可能存在（记录尝试），但里面不应有任何可用字节
const copied3b = batches().filter((n) =>
  fs.exists(paths.quarantineDir(n) + '/2026-11.json')
);
eq(copied3b.length, 0, 'QA01-3b 隔离写入失败 → 无任何分片被转存（符合预期）');
assert(warns.length >= 1, 'QA01-3b 留下降级警告');
eq(
  warns.join(' | ').indexOf('老王便利店') >= 0,
  false,
  'QA01-3b 回滚阶段警告同样不含账单内容'
);

/* =================== 纯函数：findUnreadableMonths 判定口径 =================== */fresh();
ledger.addBill({
  type: 'expense',
  amountCents: 100,
  categoryId: 'c-food',
  occurredAt: at(2026, 9, 10),
});
fs.writeText(paths.billFile('2026-10'), SHAPE_BAD_10);
fs.writeText(paths.billFile('2026-11'), CORRUPT_11);
const found = quarantine.findUnreadableMonths();
eq(found.length, 2, 'findUnreadableMonths 只挑出不可解析分片（合法月不入选）');
eq(
  found.map((x) => x.ym).join(','),
  '2026-10,2026-11',
  'findUnreadableMonths 覆盖 INVALID_SHAPE 与 CORRUPT'
);
eq(found[0].code, 'MONTH_INVALID_SHAPE', 'INVALID_SHAPE 记录错误码');
eq(found[1].code, 'MONTH_CORRUPT', 'CORRUPT 记录错误码');

/* =================== 汇总 =================== */
console.warn = origWarn;
console.log('quarantine-rollback tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) {
  process.exit(1);
}
console.log('ALL QUARANTINE / ROLLBACK TESTS PASSED');
