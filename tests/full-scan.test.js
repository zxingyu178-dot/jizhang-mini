/**
 * tests/full-scan.test.js — 全量扫描（数据注入 + 统计一致性 + 导入矩阵 + 图表几何）
 *
 * 目的：不靠手点界面，用「真实数据层 + 内存文件系统」把整条链路跑一遍：
 *   注入账单 → 读回账本 → 月度统计 → 累计趋势 SVG 几何 → 三种来源导入 → 重复导入去重。
 *
 * 断言原则：只测不变量（数量守恒、金额合计一致、累计单调、比例关系），
 * 不写死易变的期望值；唯一写死的是「注入时的构造值」，因为它们由本文件生成。
 *
 * 运行：node tests/full-scan.test.js
 */
const path = require('path');
const fs = require('fs');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) {
  assert(a === b, msg + '（期望 ' + b + '，实际 ' + a + '）');
}
function near(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, msg + '（期望 ' + b + '±' + tol + '，实际 ' + a + '）');
}

/* ---------- 内存 wx 环境（与 importer.test.js 同构） ---------- */
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
          else { cur = cur + '/' + x; memDirs.add(cur); }
        });
      } else memDirs.add(p);
    },
    readFileSync(p) {
      if (!memFiles.has(p)) throw new Error('ENOENT ' + p);
      return memFiles.get(p);
    },
    writeFileSync(p, data) { memFiles.set(p, String(data)); },
    unlinkSync(p) {
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
      memFiles.forEach((v, k) => {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          if (rest && !rest.includes('/')) out.add(rest);
        }
      });
      return [...out];
    },
    readFile({ success, fail: f }) {
      if (pendingBuffer) success({ data: pendingBuffer });
      else f({ errMsg: 'no pending' });
    },
  };

  return {
    env: { USER_DATA_PATH: '/usr' },
    getFileSystemManager: () => fsm,
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => { storage[k] = v; },
    __setPending: (b) => { pendingBuffer = b; },
    __files: memFiles,
  };
}

const ROOT = path.join(__dirname, '..');
global.wx = buildWx();

const store = require(path.join(ROOT, 'data', 'index'));
const ledger = require(path.join(ROOT, 'data', 'ledger'));
const M = require(path.join(ROOT, 'data', 'statistics', 'month'));
const C = require(path.join(ROOT, 'data', 'statistics', 'cumulative'));
const detector = require(path.join(ROOT, 'packages', 'importer', 'core', 'detector'));
const commit = require(path.join(ROOT, 'packages', 'importer', 'core', 'commit'));
const FIX = path.join(__dirname, 'fixtures');

function freshStore() {
  global.wx = buildWx();
  store.init();
  return store;
}

/** 构造一笔账单（amount 单位：分） */
function mkBill(type, cents, y, mo, d, hh, cat, extra) {
  return Object.assign({
    type,
    amountCents: cents,
    categoryId: cat || (type === 'income' ? 'c-salary' : 'c-food'),
    occurredAt: new Date(y, mo - 1, d, hh == null ? 12 : hh, 0).getTime(),
    ledgerImpact: 'normal',
  }, extra || {});
}

/** 注入：按月份分组批量写入（走真实 addBills 写路径） */
function inject(bills) {
  const byMonth = {};
  bills.forEach((b) => {
    const d = new Date(b.occurredAt);
    const ym = d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
    (byMonth[ym] = byMonth[ym] || []).push(b);
  });
  Object.keys(byMonth).forEach((ym) => store.addBills(byMonth[ym]));
  return byMonth;
}

/* =========================================================
 * A. 数据注入 → 读回 → 统计一致性
 * ======================================================= */
console.log('A. 数据注入与统计一致性');

/* A1：30 天 99 笔（复刻「随便一看」那种真实形态：多天、多笔、有收入） */
{
  const s = freshStore();
  const bills = [];
  let expectExpense = 0;
  let expectIncome = 0;
  const dailyExpense = {};

  for (let d = 1; d <= 30; d++) {
    for (let k = 0; k < 3; k++) {
      const cents = 1000 + d * 37 + k * 101; // 10.00 元起，确定性构造
      bills.push(mkBill('expense', cents, 2026, 9, d, 9 + k));
      expectExpense += cents;
      dailyExpense[d] = (dailyExpense[d] || 0) + cents;
    }
  }
  for (let i = 0; i < 9; i++) {
    const d = 1 + i * 3;
    bills.push(mkBill('income', 50000, 2026, 9, d, 20));
    expectIncome += 50000;
  }

  eq(bills.length, 99, 'A1 注入 99 笔');
  inject(bills);

  const readBack = store.rangeBills();
  eq(readBack.length, 99, 'A1 读回 99 笔（数量守恒）');
  eq(readBack.filter((b) => b.type === 'expense').length, 90, 'A1 支出 90 笔');
  eq(readBack.filter((b) => b.type === 'income').length, 9, 'A1 收入 9 笔');

  const ov = M.computeMonthOverview(readBack);
  eq(ov.count, 99, 'A1 概览记录数 99');
  eq(ov.expense, expectExpense, 'A1 概览支出合计 = 注入合计');
  eq(ov.income, expectIncome, 'A1 概览收入合计 = 注入合计');
  eq(ov.balance, expectIncome - expectExpense, 'A1 结余 = 收入 - 支出');

  const ms = store.monthSummary('2026-09');
  eq(ms.expense, expectExpense, 'A1 账本 monthSummary 支出一致');
  eq(ms.count, 99, 'A1 账本 monthSummary 笔数一致');

  // 每日趋势：31 天里 9 月有 30 天
  const daily = M.computeDailyExpenseTrend(readBack, 2026, 9);
  eq(daily.points.length, 30, 'A1 每日趋势 30 个点');
  eq(daily.max, Math.max.apply(null, Object.keys(dailyExpense).map((k) => dailyExpense[k])), 'A1 每日趋势峰值 = 注入的最大单日支出');
  let dailySum = 0;
  daily.points.forEach((p) => { dailySum += p.cents; });
  eq(dailySum, expectExpense, 'A1 每日趋势合计 = 支出合计（无漏日/重复）');

  // 日均：不在该月内 → 分母为整月 30 天
  const avg = M.computeDailyAverageExpense(readBack, 2026, 9, new Date(2026, 11, 1));
  eq(avg, Math.round(expectExpense / 30), 'A1 日均支出 = 支出 / 30 天（历史月按整月）');

  // 最高消费日 / 最大单笔
  const top = M.findTopExpenseDay(readBack, 2026, 9);
  eq(top.cents, daily.max, 'A1 最高消费日金额 = 每日峰值');
  const largest = M.findLargestExpense(readBack);
  eq(largest.amountCents, Math.max.apply(null, bills.filter((b) => b.type === 'expense').map((b) => b.amountCents)), 'A1 最大单笔 = 注入最大单笔');

  // 累计趋势：末值必须等于当月总支出
  const cum = M.computeCumulativeTrend(readBack, 2026, 9);
  eq(cum.points.length, 30, 'A1 累计 30 个点');
  eq(cum.points[cum.points.length - 1].cumCents, expectExpense, 'A1 累计末值 = 当月总支出');
  eq(cum.max, expectExpense, 'A1 累计 max = 总支出');
  let mono = true;
  for (let i = 1; i < cum.points.length; i++) {
    if (cum.points[i].cumCents < cum.points[i - 1].cumCents) mono = false;
  }
  assert(mono, 'A1 累计单调不减');
}

/* A2：单日 1 笔 */
{
  const s = freshStore();
  inject([mkBill('expense', 12345, 2026, 3, 8, 10)]);
  const bills = store.rangeBills();
  const daily = M.computeDailyExpenseTrend(bills, 2026, 3);
  eq(daily.points.length, 31, 'A2 3 月 31 个点');
  eq(daily.points.filter((p) => p.cents > 0).length, 1, 'A2 只有 1 天有支出');
  const cum = M.computeCumulativeTrend(bills, 2026, 3);
  eq(cum.points[30].cumCents, 12345, 'A2 月末累计 = 该笔金额');
  // 当月分母 = 截至今天的天数（8 日 → 除以 8）
  const avg = M.computeDailyAverageExpense(bills, 2026, 3, new Date(2026, 2, 8));
  eq(avg, Math.round(12345 / 8), 'A2 当月日均分母 = 截至今天的天数（8 天）');
}

/* A3：满月 31 天 */
{
  const s = freshStore();
  const bills = [];
  for (let d = 1; d <= 31; d++) bills.push(mkBill('expense', 100 * d, 2026, 10, d, 12));
  inject(bills);
  const read = store.rangeBills();
  eq(M.computeDailyExpenseTrend(read, 2026, 10).points.length, 31, 'A3 10 月 31 天');
  eq(M.computeCumulativeTrend(read, 2026, 10).points.length, 31, 'A3 累计 31 点');
  eq(M.computeCumulativeTrend(read, 2026, 10).max, 100 * (1 + 31) * 31 / 2, 'A3 累计总额 = 等差数列和');
}

/* A4：闰年 2 月 */
{
  const s = freshStore();
  const bills = [mkBill('expense', 5000, 2028, 2, 29, 12), mkBill('expense', 3000, 2027, 2, 28, 12)];
  inject(bills);
  const b2028 = store.rangeBills().filter((b) => new Date(b.occurredAt).getFullYear() === 2028);
  eq(M.computeDailyExpenseTrend(b2028, 2028, 2).points.length, 29, 'A4 2028-02 有 29 天（闰年）');
  eq(M.computeDailyExpenseTrend(b2028, 2028, 2).points[28].cents, 5000, 'A4 29 日那笔落在第 29 个点');
}

/* A5：daily-value-only 不进统计 / 不进月度合计 */
{
  const s = freshStore();
  inject([
    mkBill('expense', 6666, 2026, 5, 5, 12),
    mkBill('expense', 9999, 2026, 5, 6, 12, 'c-food', { ledgerImpact: 'daily-value-only', title: '日价物品' }),
  ]);
  const read = store.rangeBills();
  eq(read.length, 2, 'A5 两笔都在账本里');
  const ov = M.computeMonthOverview(read);
  eq(ov.count, 1, 'A5 概览只算 normal 那笔');
  eq(ov.expense, 6666, 'A5 概览支出只含 normal');
  eq(store.monthSummary('2026-05').count, 1, 'A5 monthSummary 只算 normal');
}

/* A6：跨月隔离 */
{
  const s = freshStore();
  inject([
    mkBill('expense', 1111, 2026, 7, 31, 12),
    mkBill('expense', 2222, 2026, 8, 1, 12),
  ]);
  eq(store.monthSummary('2026-07').expense, 1111, 'A6 7 月只含 7 月那笔');
  eq(store.monthSummary('2026-08').expense, 2222, 'A6 8 月只含 8 月那笔');
  eq(store.listMonths().length, 2, 'A6 两个月份分片');
}

/* A7：大账本注入（批量写，观察耗时） */
{
  const s = freshStore();
  const N = 5000;
  const bills = [];
  for (let i = 0; i < N; i++) {
    const d = 1 + (i % 28);
    const mo = 1 + (i % 12);
    bills.push(mkBill('expense', 100 + (i % 900), 2025, mo, d, 12));
  }
  const t0 = Date.now();
  inject(bills);
  const tWrite = Date.now() - t0;
  const t1 = Date.now();
  const read = store.rangeBills();
  const ov = M.computeMonthOverview(read);
  const tRead = Date.now() - t1;
  eq(read.length, N, 'A7 注入 ' + N + ' 笔全部读回');
  eq(ov.count, N, 'A7 概览笔数一致');
  const expect = bills.reduce((a, b) => a + b.amountCents, 0);
  eq(ov.expense, expect, 'A7 合计一致');
  console.log('     A7 批量写入 ' + N + ' 笔 ' + tWrite + 'ms，读回+统计 ' + tRead + 'ms');
}

/* =========================================================
 * B. 导入（微信 / 支付宝 GBK / DailyValue）+ 去重 + 大数据
 * ======================================================= */
async function parseFixture(fileName, hintedSource) {
  const buf = fs.readFileSync(path.join(FIX, fileName));
  global.wx.__setPending(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return detector.parseFile({ path: '/tmp/' + fileName, size: buf.length, name: fileName, hintedSource });
}

async function partB() {
  console.log('B. 导入矩阵');

  // B1 微信 CSV
  {
    const s = freshStore();
    const session = await parseFixture('wechat-legacy.csv', 'wechat');
    eq(session.counts.ready, 2, 'B1 微信 CSV 待导入 2 笔');
    const r = commit.commitImport(session);
    eq(r.imported, 2, 'B1 实际导入 2 笔');
    eq(s.rangeBills().length, 2, 'B1 账本 2 笔');
    const exp = s.rangeBills().filter((b) => b.type === 'expense').reduce((a, b) => a + b.amountCents, 0);
    assert(exp > 0, 'B1 支出金额 > 0');

    // B2 重复导入 → 全部 existing
    const session2 = await parseFixture('wechat-legacy.csv', 'wechat');
    eq(session2.counts.existing, 2, 'B2 重复导入全部识别为已存在');
    eq(session2.counts.ready, 0, 'B2 重复导入没有新增待导入');
    eq(s.rangeBills().length, 2, 'B2 账本没有变多');
  }

  // B3 支付宝 GBK CSV（编码兼容）
  {
    const s = freshStore();
    const session = await parseFixture('alipay-gbk.csv', 'alipay');
    assert(session.counts.ready > 0, 'B3 支付宝 GBK 解析出待导入记录（实际 ' + session.counts.ready + '）');
    const r = commit.commitImport(session);
    eq(s.rangeBills().length, r.imported, 'B3 账本笔数 = 导入笔数');
    eq(r.imported, session.counts.ready, 'B3 待导入全部落账');
  }

  // B4 DailyValue CSV
  {
    const s = freshStore();
    const session = await parseFixture('dailyvalue.csv', 'dailyvalue');
    assert(session.counts.ready > 0, 'B4 DailyValue CSV 解析出记录（实际 ' + session.counts.ready + '）');
    commit.commitImport(session);
    assert(s.rangeBills().length > 0, 'B4 账本已写入');
  }

  // B5 非法内容：不写账本
  {
    const s = freshStore();
    const bad = Buffer.from('这不是账单\n随便写点东西\n', 'utf8');
    global.wx.__setPending(bad.buffer.slice(bad.byteOffset, bad.byteOffset + bad.byteLength));
    let session = null;
    let thrown = null;
    try {
      session = await detector.parseFile({ path: '/tmp/bad.csv', size: bad.length, name: 'bad.csv' });
    } catch (e) { thrown = e; }
    if (session) {
      assert(session.counts.ready === 0, 'B5 非法内容待导入 0 笔');
    } else {
      assert(!!thrown, 'B5 非法内容被明确报错（' + (thrown && thrown.code) + '）');
    }
    eq(s.rangeBills().length, 0, 'B5 非法内容没有写入账本');
  }

  // B6 大数据：3 万行 CSV 预览耗时
  {
    const s = freshStore();
    const head = '微信支付账单明细（虚构）\n\n交易时间,交易类型,交易对方,商品,收/支,金额,支付方式,当前状态,交易单号,商户单号,备注\n';
    const rows = [];
    const N = 30000;
    for (let i = 0; i < N; i++) {
      const d = 1 + (i % 28);
      const hh = String(i % 24).padStart(2, '0');
      const mm = String(i % 60).padStart(2, '0');
      rows.push('2026-09-' + String(d).padStart(2, '0') + ' ' + hh + ':' + mm + ':00,商户消费,虚构商户' + i + ',商品' + i + ',支出,'
        + (1 + (i % 500)) + '.00,零钱,支付成功,4200000000' + String(i).padStart(12, '0') + ',M' + String(i).padStart(8, '0') + ',');
    }
    const csv = head + rows.join('\n') + '\n';
    const buf = Buffer.from(csv, 'utf8');
    global.wx.__setPending(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const t0 = Date.now();
    const session = await detector.parseFile({ path: '/tmp/big.csv', size: buf.length, name: 'big.csv', hintedSource: 'wechat' });
    const ms = Date.now() - t0;
    console.log('     B6 3 万行 CSV 预览解析 ' + ms + 'ms（门槛 1500ms）');
    assert(ms < 1500, 'B6 3 万行预览 < 1500ms（实际 ' + ms + 'ms）');
    eq(session.counts.ready, N, 'B6 3 万行全部进入待导入');
    eq(s.rangeBills().length, 0, 'B6 预览阶段不写账本');
  }
}

/* =========================================================
 * C. 累计趋势图几何（这就是「随便一看」看到的那个问题）
 * ======================================================= */
function parseGeom(svg) {
  const vb = svg.match(/viewBox="([^"]+)"/);
  if (!vb) return null;
  const nums = vb[1].trim().split(/\s+/).map(Number);
  const coords = [...svg.matchAll(/[ML]([0-9.]+) ([0-9.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  return { vbW: nums[2], vbH: nums[3], coords };
}

function partC() {
  console.log('C. 累计趋势图几何（宽高比 / 铺满 / 越界）');
  const BOX = { w: 320, h: 180 }; // components/statistics-panel 里 width=320 height=180

  // C1 正常 30 天数据
  {
    const bills = [];
    for (let d = 1; d <= 30; d++) bills.push(mkBill('expense', 1000 + d * 100, 2026, 9, d, 12));
    const cum = M.computeCumulativeTrend(bills, 2026, 9);
    const svg = C.buildCumulativeSVG(cum.points, cum.max, 'rgba(255,255,255,0.12)', BOX);
    const g = parseGeom(svg);
    assert(!!g, 'C1 能解析出 viewBox');
    if (g) {
      near(g.vbW / g.vbH, BOX.w / BOX.h, 0.02, 'C1 viewBox 宽高比 = 显示盒比例（否则 aspectFit 会两侧留白）');
      const xs = g.coords.map((c) => c.x);
      const span = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) / g.vbW;
      assert(span >= 0.85, 'C1 折线横向铺满 viewBox（实际 ' + (span * 100).toFixed(1) + '%）');
      const out = g.coords.filter((c) => c.x < -0.01 || c.x > g.vbW + 0.01 || c.y < -0.01 || c.y > g.vbH + 0.01);
      eq(out.length, 0, 'C1 所有坐标都在 viewBox 内（不越界）');
    }
  }

  // C2 单点（只有一天有数据）
  {
    const bills = [mkBill('expense', 8888, 2026, 4, 1, 12)];
    const cum = M.computeCumulativeTrend(bills, 2026, 4);
    const svg = C.buildCumulativeSVG(cum.points, cum.max, '#333', BOX);
    const g = parseGeom(svg);
    // 面积 path = 折线点 + 2 个底边闭合点
    assert(!!g && g.coords.length >= 30, 'C2 30 天仍有 30 个折线点（含面积闭合点 ' + (g ? g.coords.length : 0) + '）');
  }

  // C3 空数据
  {
    const svg = C.buildCumulativeSVG([], 0, '#333', BOX);
    eq((svg.match(/<path/g) || []).length, 0, 'C3 空数据不画 path');
    const g = parseGeom(svg);
    assert(!!g && g.vbW === BOX.w, 'C3 空数据 viewBox 与显示盒一致');
  }

  // C4 面积必须闭合到底边
  {
    const bills = [mkBill('expense', 500, 2026, 6, 10, 12)];
    const cum = M.computeCumulativeTrend(bills, 2026, 6);
    const svg = C.buildCumulativeSVG(cum.points, cum.max, '#333', BOX);
    const pathD = svg.match(/<path d="([^"]+)"/)[1];
    assert(/Z\s*$/.test(pathD), 'C4 面积路径闭合（以 Z 结尾）');
    const g = parseGeom(svg);
    const ys = g.coords.map((c) => c.y);
    near(Math.max.apply(null, ys), g.vbH - g.vbH * 0.12, 1.5, 'C4 面积底边 = 绘图区底边');
  }
}

partC();

partB().then(() => {
  console.log('\nfull-scan tests: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}).catch((e) => {
  console.error('B 段异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
