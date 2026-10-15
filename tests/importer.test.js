/**
 * tests/importer.test.js — 统一导入引擎（M4）端到端测试
 *
 * 内存文件系统 mock wx（含异步 readFile），真实虚构夹具走完整流程：
 *   detector.parseFile → 校验 → 去重 → commit.commitImport → 账本，再重复导入验证去重。
 * 运行：node tests/importer.test.js
 */
const fs = require('fs');
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
function eq(actual, expected, msg) {
  assert(actual === expected, msg + ' (expected=' + expected + ', actual=' + actual + ')');
}

/* ---------- 内存 wx 环境 ---------- */
function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const storage = {};
  let pendingBuffer = null;

  const fsm = {
    accessSync(p) {
      if (memFiles.has(p) || memDirs.has(p)) return;
      throw new Error('ENOENT');
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
    // detector 用的异步读文件
    readFile({ success, fail: f }) {
      if (pendingBuffer) success({ data: pendingBuffer });
      else f({ errMsg: 'no pending' });
    },
  };

  const wx = {
    env: { USER_DATA_PATH: '/usr' },
    getFileSystemManager: () => fsm,
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => {
      storage[k] = v;
    },
    __setPending: (b) => {
      pendingBuffer = b;
    },
  };
  return wx;
}

/* ---------- 装载工程模块（先给默认 wx，供模块顶层使用） ---------- */
const ROOT = path.join(__dirname, '..');
global.wx = buildWx();
const store = require(path.join(ROOT, 'data', 'index'));
const detector = require(path.join(ROOT, 'packages', 'importer', 'core', 'detector'));
const commit = require(path.join(ROOT, 'packages', 'importer', 'core', 'commit'));
const FIX = path.join(__dirname, 'fixtures');

function freshStore() {
  global.wx = buildWx();
  store.init();
  return store;
}

function runParse(store, fileName, hintedSource) {
  const buf = fs.readFileSync(path.join(FIX, fileName));
  global.wx.__setPending(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return detector.parseFile({
    path: '/tmp/' + fileName,
    size: buf.length,
    name: fileName,
    hintedSource,
  });
}

/* ---------- 用例 ---------- */

async function testWechat() {
  const store = freshStore();
  const session = await runParse(store, 'wechat-current.xlsx', 'wechat');
  eq(session.counts.ready, 4, '微信 ready=4');
  eq(session.counts.needconfirm, 1, '微信 needconfirm=1');
  eq(session.counts.skipped, 0, '微信不计收支不进 bills（不计入）');

  // 确认导入
  const r = commit.commitImport(session);
  eq(r.imported, 4, '微信导入 4 笔');
  const all = store.rangeBills();
  eq(all.length, 4, '账本 4 笔');

  // 支出 54.1、收入 88.88
  let exp = 0;
  let inc = 0;
  all.forEach((b) => {
    if (b.type === 'expense') exp += b.amountCents;
    else inc += b.amountCents;
  });
  eq(exp, 5410, '微信支出合计 54.10');
  eq(inc, 8888, '微信收入合计 88.88');

  // 重复导入：全部 existing
  const session2 = await runParse(store, 'wechat-current.xlsx', 'wechat');
  eq(session2.counts.existing, 4, '重复导入全部 existing');
}

async function testWechatCsv() {
  const store = freshStore();
  const session = await runParse(store, 'wechat-legacy.csv', 'wechat');
  eq(session.counts.ready, 2, '微信 CSV ready=2（表头位置变化）');
  commit.commitImport(session);
  eq(store.rangeBills().length, 2, '微信 CSV 导入 2 笔');
}

async function testAlipay() {
  const store = freshStore();
  const session = await runParse(store, 'alipay-current.xlsx', 'alipay');
  eq(session.counts.ready, 4, '支付宝 ready=4');
  eq(session.counts.needconfirm, 1, '支付宝关闭交易 needconfirm');
  commit.commitImport(session);

  // 分类映射
  const all = store.rangeBills();
  const cats = {};
  all.forEach((b) => {
    cats[b.categoryId] = (cats[b.categoryId] || 0) + 1;
  });
  eq(cats['c-food'], 1, '餐饮映射');
  eq(cats['c-transport'], 1, '交通映射');
  eq(cats['c-shopping'], 1, '服饰→购物映射');
  eq(cats['c-other'], 1, '收入(其他)');
}

async function testAlipayGbk() {
  const store = freshStore();
  const session = await runParse(store, 'alipay-gbk.csv', 'alipay');
  eq(session.counts.ready, 2, '支付宝 GBK ready=2');
  const samples = session.bills.filter((b) => b.status === 'ready');
  // 验证 GBK 中文解码正确
  const hasMedical = samples.some((b) => b.categoryId === 'c-medical');
  const hasHousing = samples.some((b) => b.categoryId === 'c-housing');
  assert(hasMedical, 'GBK 医疗解码正确');
  assert(hasHousing, 'GBK 住房解码正确');
  commit.commitImport(session);
  eq(store.rangeBills().length, 2, 'GBK 导入 2 笔');
}

async function testDailyValueCsv() {
  const store = freshStore();
  const session = await runParse(store, 'dailyvalue.csv', 'dailyvalue');
  eq(session.counts.ready, 3, 'DV CSV ready=3（仅日价跳过）');
  commit.commitImport(session);
  const all = store.rangeBills();
  eq(all.length, 3, 'DV CSV 导入 3 笔');
}

async function testDailyValueBackup() {
  const store = freshStore();
  const session = await runParse(store, 'dailyvalue-backup.json', 'dailyvalue');
  eq(session.counts.ready, 2, 'DV backup ready=2（仅日价跳过）');
  commit.commitImport(session);
  const all = store.rangeBills();
  eq(all.length, 2, 'DV backup 导入 2 笔');
  // 原 id 去重
  const session2 = await runParse(store, 'dailyvalue-backup.json', 'dailyvalue');
  eq(session2.counts.existing, 2, 'DV backup 重复导入 existing');
}

async function testMiniRestore() {
  const store = freshStore();
  // 先造 3 笔
  store.addBill({ type: 'expense', amountCents: 100, categoryId: 'c-food' });
  store.addBill({ type: 'expense', amountCents: 200, categoryId: 'c-fun' });
  store.addBill({ type: 'expense', amountCents: 300, categoryId: 'c-life' });
  eq(store.rangeBills().length, 3, '恢复前 3 笔');

  const session = await runParse(store, 'mini-backup.json', '');
  eq(session.isRestore, true, '识别为完整恢复');
  commit.commitRestore(session);
  eq(store.rangeBills().length, 1, '恢复后为备份的 1 笔（覆盖）');
}

async function run() {
  const tests = [
    testWechat,
    testWechatCsv,
    testAlipay,
    testAlipayGbk,
    testDailyValueCsv,
    testDailyValueBackup,
    testMiniRestore,
  ];
  for (const t of tests) {
    try {
      await t();
    } catch (e) {
      fail++;
      console.error('  FAIL in ' + t.name + ': ' + e.message);
    }
  }
  console.log('\nimporter tests: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

run();
