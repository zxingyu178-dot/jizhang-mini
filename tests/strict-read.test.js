/**
 * tests/strict-read.test.js — v0.8.0 / G1 Strict Month Read 单元测试
 *
 * 验证：
 *   - fs.readJSONStrict 区分「不存在 / 损坏 / 合法」；
 *   - ledger.readMonthFileStrict 区分 missing / corrupt / invalid-shape / unsupported-version，兼容旧 V1/V2；
 *   - 所有写路径（addBill / addBills / deleteBill / updateBill）对损坏月份 fail-closed，
 *     绝不以空账本继续、绝不覆盖可抢救的原始损坏文件。
 *
 * 内存文件系统 mock wx，运行：node tests/strict-read.test.js
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

/* ---------- 内存 wx（与 data.test.js 同构） ---------- */
function buildWx() {
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
  return { env: { USER_DATA_PATH: '/usr' }, getFileSystemManager: () => fsm };
}

global.wx = buildWx();
const fs = require('../data/fs');
const paths = require('../data/paths');
const ledger = require('../data/ledger');

function fresh() {
  global.wx = buildWx();
}
function expectCode(fn, code, msg) {
  let got = null;
  try {
    fn();
  } catch (e) {
    got = e.code;
  }
  eq(got, code, msg);
}

/* ---------- A. fs.readJSONStrict ---------- */
fresh();
expectCode(() => fs.readJSONStrict(paths.FILE.categories), 'FILE_MISSING', '不存在抛 FILE_MISSING');

fresh();
fs.writeText(paths.FILE.categories, '### NOT JSON ###');
expectCode(() => fs.readJSONStrict(paths.FILE.categories), 'FILE_CORRUPT', '损坏抛 FILE_CORRUPT');

fresh();
fs.writeJSON(paths.FILE.categories, { a: 1 });
eq(fs.readJSONStrict(paths.FILE.categories).a, 1, '合法 JSON 正常解析');

/* ---------- B. ledger.readMonthFileStrict ---------- */
fresh();
let empty = ledger.readMonthFileStrict('2026-10');
eq(empty.version, 3, '不存在月份返回可建空分片（version=3）');
eq(empty.bills.length, 0, '空分片 bills=[]');

fresh();
fs.writeText(paths.billFile('2026-10'), '### CORRUPT ###');
expectCode(() => ledger.readMonthFileStrict('2026-10'), 'MONTH_CORRUPT', '损坏月份抛 MONTH_CORRUPT');

fresh();
fs.writeText(paths.billFile('2026-10'), JSON.stringify({ ym: '2026-10', version: 3, bills: 'nope' }));
expectCode(() => ledger.readMonthFileStrict('2026-10'), 'MONTH_INVALID_SHAPE', 'bills 非数组抛 MONTH_INVALID_SHAPE');

fresh();
fs.writeText(paths.billFile('2026-10'), JSON.stringify({ ym: '2026-10', version: 9, bills: [] }));
expectCode(() => ledger.readMonthFileStrict('2026-10'), 'MONTH_UNSUPPORTED_VERSION', '非法版本抛 MONTH_UNSUPPORTED_VERSION');

fresh();
[1, 2, 3].forEach((v) => {
  fs.writeText(paths.billFile('2026-10'), JSON.stringify({ ym: '2026-10', version: v, bills: [] }));
  eq(ledger.readMonthFileStrict('2026-10').version, v, '旧版本 V' + v + ' 分片可严格读取');
});

/* ---------- C. addBill 损坏月份 fail-closed，不覆盖原始损坏 ---------- */
fresh();
const f10 = paths.billFile('2026-10');
const ORIGINAL = '<<CORRUPT ORIGINAL PAYLOAD>>';
fs.writeText(f10, ORIGINAL);
const ts10 = new Date(2026, 9, 10, 12, 0).getTime();
expectCode(
  () => ledger.addBill({ type: 'expense', amountCents: 100, categoryId: 'c-food', occurredAt: ts10 }),
  'MONTH_CORRUPT',
  'addBill 对损坏月份抛错'
);
eq(fs.readText(f10), ORIGINAL, 'addBill 未覆盖损坏月份的原始内容');

/* ---------- D. addBills 任一目标月损坏，整批不写 ---------- */
fresh();
const f09 = paths.billFile('2026-09');
const f10b = paths.billFile('2026-10');
fs.writeText(f09, '<<SEPT CORRUPT>>'); // 9 月损坏
expectCode(
  () =>
    ledger.addBills([
      { type: 'expense', amountCents: 100, categoryId: 'c-food', occurredAt: new Date(2026, 8, 5, 12, 0).getTime() },
      { type: 'expense', amountCents: 200, categoryId: 'c-food', occurredAt: new Date(2026, 9, 5, 12, 0).getTime() },
    ]),
  'MONTH_CORRUPT',
  'addBills 预检到损坏月份抛错'
);
eq(fs.readText(f09), '<<SEPT CORRUPT>>', '9 月损坏内容保持不变');
eq(fs.exists(f10b), false, '10 月未被部分写入（整批不写）');

/* ---------- E. deleteBill / updateBill 遇损坏月份 fail-closed ---------- */
fresh();
// 先建一笔合法账单
const bill = ledger.addBill({
  type: 'expense',
  amountCents: 300,
  categoryId: 'c-food',
  occurredAt: new Date(2026, 9, 2, 12, 0).getTime(),
});
// 再制造一个损坏月份（listMonths 会遍历到）
fs.writeText(paths.billFile('2026-08'), '<<AUG CORRUPT>>');
expectCode(() => ledger.deleteBill(bill.id), 'MONTH_CORRUPT', 'deleteBill 遍历到损坏月份抛错');
expectCode(
  () => ledger.updateBill(bill.id, { note: 'x' }),
  'MONTH_CORRUPT',
  'updateBill 遍历到损坏月份抛错'
);

/* ---------- 汇总 ---------- */
console.log('strict-read tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) {
  process.exit(1);
}
