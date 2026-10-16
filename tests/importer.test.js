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
const diagnosis = require(path.join(ROOT, 'packages', 'importer', 'core', 'diagnosis'));
const wechatAdapter = require(path.join(ROOT, 'packages', 'importer', 'adapters', 'wechat'));
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
  // v0.2.2：「支出 5.00 已全额退款」收/支明确，按官方正常入账 → ready=5、needconfirm=0
  eq(session.counts.ready, 5, '微信 ready=5');
  eq(session.counts.needconfirm, 0, '微信 needconfirm=0（退款不拦截）');
  eq(session.counts.skipped, 0, '微信不计收支不进 bills（不计入）');

  // 脱敏诊断（成功会话）
  assert(session.diagnostic, '微信成功会话带诊断对象');
  eq(session.diagnostic.headerFound, true, '微信诊断表头找到');
  eq(session.diagnostic.source, 'wechat', '诊断来源 wechat');
  eq(session.diagnostic.fileType, 'xlsx', '诊断文件类型 xlsx');
  assert(session.diagnostic.totalDataRows >= 5, '微信诊断数据行计数 ≥5');

  // 确认导入
  const r = commit.commitImport(session);
  eq(r.imported, 5, '微信导入 5 笔');
  const all = store.rangeBills();
  eq(all.length, 5, '账本 5 笔');

  // 每笔导入账单必须有 id / createdAt / updatedAt（曾因 commit 绕过 createBill 导致 id 缺失）
  all.forEach((b, i) => {
    assert(typeof b.id === 'string' && b.id.length > 0, '导入账单第 ' + i + ' 笔有 id');
    assert(typeof b.createdAt === 'number' && typeof b.updatedAt === 'number', '导入账单第 ' + i + ' 笔有时间戳');
  });

  // 支出 59.10、收入 88.88
  let exp = 0;
  let inc = 0;
  all.forEach((b) => {
    if (b.type === 'expense') exp += b.amountCents;
    else inc += b.amountCents;
  });
  eq(exp, 5910, '微信支出合计 59.10');
  eq(inc, 8888, '微信收入合计 88.88');

  // 重复导入：全部 existing
  const session2 = await runParse(store, 'wechat-current.xlsx', 'wechat');
  eq(session2.counts.existing, 5, '重复导入全部 existing');
}

async function testWechatCsv() {
  const store = freshStore();
  const session = await runParse(store, 'wechat-legacy.csv', 'wechat');
  eq(session.counts.ready, 2, '微信 CSV ready=2（表头位置变化）');
  commit.commitImport(session);
  eq(store.rangeBills().length, 2, '微信 CSV 导入 2 笔');
}

async function testWechatRealLayout() {
  const store = freshStore();
  const session = await runParse(store, 'wechat-real-layout.xlsx', 'wechat');
  const d = session.diagnostic;

  // 真实布局：1~17 行说明，第 18 行表头(index 17)，金额列=金额(元)
  eq(d.headerFound, true, '真实布局表头找到');
  eq(d.headerRowIndex, 17, '表头第 18 行(index 17)');
  // 数据行 66 = 支出 45 + 收入 21 + 中性 0
  eq(d.totalDataRows, 66, '数据行 66');
  eq(d.expenseRows, 45, '支出 45');
  eq(d.incomeRows, 21, '收入 21');
  eq(d.nonFlowSkipped, 0, '中性 0');
  eq(d.missingColumns.length, 0, '金额(元) 已识别，无缺失关键列');

  // 全部 ready，无 needconfirm（退款行不被大面积拦截）
  eq(session.counts.ready, 66, '66 笔全部 ready');
  eq(session.counts.needconfirm, 0, 'needconfirm=0');

  const ready = session.bills.filter((b) => b.status === 'ready');
  // 部分退款原支出：expense 1.00；退款收入：income 0.05
  const refundOrig = ready.find((b) => b.type === 'expense' && b.amountCents === 100);
  const refundIncome = ready.find((b) => b.type === 'income' && b.amountCents === 5);
  assert(!!refundOrig, '部分退款原支出 expense 1.00 正常入账');
  assert(!!refundIncome, '退款收入 income 0.05 正常入账');

  // 收支总额：支出 43×10 + 1 + 50 = 481.00；收入 19×20 + 0.05 + 100 = 480.05
  let exp = 0;
  let inc = 0;
  ready.forEach((b) => {
    if (b.type === 'expense') exp += b.amountCents;
    else inc += b.amountCents;
  });
  eq(exp, 48100, '真实布局支出合计 481.00');
  eq(inc, 48005, '真实布局收入合计 480.05');

  // 提交 + 重复导入全部 existing
  commit.commitImport(session);
  eq(store.rangeBills().length, 66, '导入 66 笔');
  const session2 = await runParse(store, 'wechat-real-layout.xlsx', 'wechat');
  eq(session2.counts.existing, 66, '同一文件导入两次全部 existing');
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
  // v0.4.0 起 daily-value-only（含日价）也完整导入，ready=3
  eq(session.counts.ready, 3, 'DV backup ready=3（含仅日价物品）');
  commit.commitImport(session);
  const all = store.rangeBills();
  eq(all.length, 3, 'DV backup 导入 3 笔');
  // 日价物品字段完整（title / ledgerImpact / dailyValue）
  const dvBill = all.find((b) => b.ledgerImpact === 'daily-value-only');
  eq(dvBill ? dvBill.title : '', '虚构笔记本', '日价物品 title 迁移');
  eq(dvBill && dvBill.dailyValue ? dvBill.dailyValue.startDate : '', '2026-09-01', '日价 dailyValue 迁移');
  // 原 id 去重：再次导入全部 existing（不重复，也无补丁）
  const session2 = await runParse(store, 'dailyvalue-backup.json', 'dailyvalue');
  eq(session2.counts.existing, 3, 'DV backup 重复导入 existing');
}

/* ---------- Gate F/G：自定义分类 + 周期规则迁移 ---------- */
async function testDailyValueCustom() {
  const store = freshStore();
  const session = await runParse(store, 'dailyvalue-backup-custom.json', 'dailyvalue');
  eq(session.counts.ready, 4, 'custom backup ready=4');
  // 会话带附加分类 / 规则
  eq(session.extraCategories.length, 2, '会话附带 2 个自定义分类');
  eq(session.extraRecurringRules.length, 3, '会话附带 3 条周期规则');

  commit.commitImport(session);

  // 自定义分类已按确定性 id 创建
  const catCoffee = store.categories.getCategory('dvcat-cat-coffee');
  eq(catCoffee.name, '咖啡', '咖啡分类迁入');
  eq(catCoffee.emoji, '☕', '咖啡 emoji 迁入');
  const catPet = store.categories.getCategory('dvcat-cat-pet');
  eq(catPet.name, '宠物', '宠物分类迁入');

  // 账单分类跟随映射，不再全部变 c-other
  const b1 = store.rangeBills().find((b) => b.sourceTxnId === 'dailyvalue:c-b1');
  eq(b1.categoryId, 'dvcat-cat-coffee', 'c-b1 映射到咖啡分类（非 c-other）');
  const b2 = store.rangeBills().find((b) => b.sourceTxnId === 'dailyvalue:c-b2');
  eq(b2.categoryId, 'dvcat-cat-pet', 'c-b2 映射到宠物分类');

  // 周期规则迁入（金额元→分，保留游标不从头补）
  const rules = store.recurring.getRules();
  eq(rules.length, 3, '3 条周期规则迁入');
  const rent = store.recurring.getRule('dvrule-rule-rent');
  assert(rent, '房租规则迁入');
  eq(rent.amountCents, 200000, '房租金额 200000');
  eq(rent.frequency, 'monthly', '房租频率 monthly');
  eq(rent.categoryId, 'c-housing', '房租分类 c-housing');
  eq(rent.lastGeneratedDate, '2026-10-01', '保留 lastGeneratedDate（不从头补）');
  eq(rent.nextOccurrence, '2026-11-01', '保留 nextOccurrence');
  // 引用自定义分类的规则
  const coffeeRule = store.recurring.getRule('dvrule-rule-coffee');
  eq(coffeeRule.categoryId, 'dvcat-cat-coffee', '周期规则分类跟随自定义分类');
  // 停用规则
  eq(store.recurring.getRule('dvrule-rule-old').enabled, false, '停用规则保留 false');

  // 历史周期账单：recurringRuleId 映射到 Mini 规则 id
  const b4 = store.rangeBills().find((b) => b.sourceTxnId === 'dailyvalue:c-b4');
  eq(b4.recurringRuleId, 'dvrule-rule-rent', '周期账单规则 id 映射');

  // 分类总数
  eq(store.categories.getCategories().length, 14, '分类 12+2=14');

  // 重复导入：分类 / 规则不重复
  const session2 = await runParse(store, 'dailyvalue-backup-custom.json', 'dailyvalue');
  commit.commitImport(session2);
  eq(store.categories.getCategories().length, 14, '重复导入分类不重复');
  eq(store.recurring.getRules().length, 3, '重复导入规则不重复');
  eq(store.rangeBills().length, 4, '重复导入账单不新增');
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

/* ---------- 脱敏诊断：行级收集 + 不外泄敏感内容 ---------- */
async function testDiagnosis() {
  const header = ['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额', '支付方式', '当前状态', '交易单号', '商户单号', '备注'];
  const rows = [
    ['微信支付账单明细（虚构）'],
    header,
    ['2026-10-15 12:31:00', '商户消费', '保密商户张三', '生椰拿铁', '支出', '¥18.00', '零钱', '支付成功', '420001AAA', 'M001', ''],
    ['2026-10-15 13:00:00', '商户消费', '某公司', '转账', '不计收支', '¥1.00', '零钱', '支付成功', '420001BBB', 'M002', ''],
    ['2026-10-15 14:00:00', '商户消费', '某公司2', '商品X', '无法识别的值', '¥5.00', '零钱', '支付成功', '420001CCC', 'M003', ''],
    ['2026-10-15 15:00:00', '商户消费', '某公司3', '商品Y', '支出', '', '零钱', '支付成功', '420001DDD', 'M004', ''],
  ];

  const diag = diagnosis.newDiagnostic();
  diag.source = 'wechat';
  diag.fileType = 'xlsx';
  const bills = wechatAdapter.parseRows(rows, 'wechat', diag);

  eq(bills.length, 1, '仅 1 条正常支出进入账单');
  eq(diag.headerFound, true, '表头找到');
  eq(diag.headerRowIndex, 1, '表头在第 2 行(0-based=1)');
  eq(diag.totalDataRows, 4, '数据行 4');
  eq(diag.nonFlowSkipped, 1, '不计收支 1 条');
  eq(diag.errors.length, 2, '行级错误 2 条（收支未知 + 金额缺失）');

  const text = diagnosis.toText(diag, '解析终止示例');
  assert(text.indexOf('保密商户张三') < 0, '诊断文本不含商户原文');
  assert(text.indexOf('生椰拿铁') < 0, '诊断文本不含商品原文');
  assert(text.indexOf('420001AAA') < 0, '诊断文本不含交易号');
  assert(text.indexOf('收/支') >= 0, '诊断文本含列名 收/支');
  assert(text.indexOf('微信账单') >= 0, '诊断文本含来源中文名');
  assert(text.indexOf('数据行') >= 0 && text.indexOf('4') >= 0, '诊断文本含数据行数');

  // 表头缺失：抛错且标记未找到
  const bad = diagnosis.newDiagnostic();
  let threw = false;
  try {
    wechatAdapter.parseRows([['乱七八糟'], ['a', 'b']], 'wechat', bad);
  } catch (e) {
    threw = true;
  }
  assert(threw, '无标准表头时抛错');
  eq(bad.headerFound, false, '诊断标记表头未找到');
}

async function run() {
  const tests = [
    testWechat,
    testWechatCsv,
    testWechatRealLayout,
    testAlipay,
    testAlipayGbk,
    testDailyValueCsv,
    testDailyValueBackup,
    testDailyValueCustom,
    testMiniRestore,
    testDiagnosis,
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
