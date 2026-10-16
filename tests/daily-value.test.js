/**
 * tests/daily-value.test.js — Daily Value 核心（v0.4.0）单元测试
 *
 * 覆盖：Bill V1→V2 无损、Ledger 边界（daily-value-only）、日价纯函数口径、
 *   独立新增 / 普通账单开关、曲线、里程碑、Android .dvbackup 迁移与合并、
 *   Mini 备份 V2 与 V1 兼容。
 * 用内存文件系统 mock wx，无需测试框架、无需真机。运行：node tests/daily-value.test.js
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
  assert(actual === expected, msg + ' (expected=' + expected + ', actual=' + actual + ')');
}
function approx(actual, expected, eps, msg) {
  assert(Math.abs(actual - expected) <= eps, msg + ' (expected~' + expected + ', actual=' + actual + ')');
}

/* ---------- 内存 wx 环境（与 data.test.js 一致） ---------- */
function buildWx(initialStorage) {
  const memFiles = new Map();
  const memDirs = new Set();
  const storage = Object.assign({}, initialStorage || {});
  const fsm = {
    accessSync(path) {
      if (memFiles.has(path) || memDirs.has(path)) return;
      throw new Error('ENOENT ' + path);
    },
    mkdirSync(path, recursive) {
      if (recursive) {
        const parts = path.split('/');
        let cur = '';
        parts.forEach((p, i) => {
          if (i === 0 && p === '') cur = '';
          else {
            cur = cur + '/' + p;
            memDirs.add(cur);
          }
        });
      } else memDirs.add(path);
    },
    readFileSync(path) {
      if (!memFiles.has(path)) throw new Error('ENOENT file ' + path);
      return memFiles.get(path);
    },
    writeFileSync(path, data) {
      memFiles.set(path, String(data));
    },
    unlinkSync(path) {
      if (!memFiles.has(path)) throw new Error('ENOENT file ' + path);
      memFiles.delete(path);
    },
    readdirSync(path) {
      const prefix = path.endsWith('/') ? path : path + '/';
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
  };
  const wx = {
    env: { USER_DATA_PATH: '/usr' },
    getFileSystemManager: () => fsm,
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => { storage[k] = v; },
    __memFiles: memFiles,
  };
  return wx;
}

function loadStore(wx) {
  global.wx = wx;
  Object.keys(require.cache).forEach((k) => {
    if (k.replace(/\\/g, '/').includes('/jizhang-mini/data/')) delete require.cache[k];
    if (k.replace(/\\/g, '/').includes('/jizhang-mini/packages/importer/')) delete require.cache[k];
  });
  return require('../data/index');
}

const TODAY = '2026-10-16';
const dv = require('../data/daily-value/index');
const dvForm = require('../data/daily-value/form');

function makeBill(partial) {
  return Object.assign({
    id: 'b' + Math.random().toString(36).slice(2),
    type: 'expense',
    amountCents: 10000,
    categoryId: 'c-shopping',
    occurredAt: new Date(2026, 8, 1).getTime(),
    title: '',
    ledgerImpact: 'normal',
  }, partial);
}

/* ================= A. 日价口径（DV-DAY / DV-TOTAL / DV-LIST） ================= */
console.log('A. 日价口径');
{
  // DV-DAY-01 购买当天 elapsed=1
  eq(dv.elapsedDays('2026-10-16', TODAY), 1, 'DV-DAY-01 当天 elapsed=1');
  // DV-DAY-02 昨天 elapsed=1
  eq(dv.elapsedDays('2026-10-15', TODAY), 1, 'DV-DAY-02 昨天 elapsed=1');
  // DV-DAY-03 相差 100 日历日=100
  eq(dv.elapsedDays('2026-07-08', TODAY), 100, 'DV-DAY-03 100 日历日=100');
  // DV-DAY-04 DST 不影响：跨美国夏令时边界（2026-03-08 春令）仍按日历日
  eq(dv.elapsedDays('2026-03-05', '2026-03-12'), 7, 'DV-DAY-04 DST 边界日历日=7');

  // 单笔日价：¥6088 / 355 天 ≈ 17.146 元/天 → 1714.6 分/天
  const mac = makeBill({
    amountCents: 608800,
    title: 'MacBook Pro',
    ledgerImpact: 'daily-value-only',
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2025-10-26' },
    occurredAt: new Date(2025, 9, 26).getTime(),
  });
  eq(dv.elapsedDays('2025-10-26', TODAY), 355, 'MacBook elapsed=355');
  approx(dv.dailyValueCentsOf(mac, TODAY) / 100, 17.15, 0.01, 'MacBook 日价 ¥17.15/天');

  // DV-TOTAL-01 总日价：两件启用物品之和
  const other = makeBill({
    amountCents: 10000,
    ledgerImpact: 'normal',
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-10-01' },
    occurredAt: new Date(2026, 9, 1).getTime(),
  });
  const total = dv.totalDailyValueCents([mac, other], TODAY);
  const expected = dv.dailyValueCentsOf(mac, TODAY) + dv.dailyValueCentsOf(other, TODAY);
  approx(total, expected, 0.01, 'DV-TOTAL-01 总日价=两笔之和');

  // DV-LIST-01 只选 enabled
  const disabled = makeBill({ dailyValue: undefined, ledgerImpact: 'normal' });
  const list = dv.computeDailyValueList([mac, other, disabled], TODAY, () => ({ name: '购物', emoji: '🛍' }));
  eq(list.length, 2, 'DV-LIST-01 只含 enabled（2 件）');
  // DV-LIST-02 按当前日价降序
  assert(list[0].currentCents >= list[1].currentCents, 'DV-LIST-02 按日价降序');
  // 名称回退 title
  eq(list.find((x) => x.title === 'MacBook Pro').name, 'MacBook Pro', '列表 name 取 title');
}

/* ================= B. Ledger 边界（DV-LEDGER） ================= */
console.log('B. Ledger 边界');
{
  const wx = buildWx();
  const store = loadStore(wx);
  store.init();

  // 日价专属物品：¥3999
  const dvOnly = store.addBill({
    type: 'expense', amountCents: 399900, categoryId: 'c-other',
    title: '仅日价物品', occurredAt: new Date(2026, 8, 1).getTime(),
    ledgerImpact: 'daily-value-only',
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-09-01' },
  });
  // 普通账单：¥100
  const normal = store.addBill({
    type: 'expense', amountCents: 10000, categoryId: 'c-food',
    occurredAt: new Date(2026, 8, 2).getTime(),
  });
  // normal+dailyValue：¥50
  const normalDv = store.addBill({
    type: 'expense', amountCents: 5000, categoryId: 'c-shopping',
    occurredAt: new Date(2026, 8, 3).getTime(),
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-09-03' },
  });

  const s = store.monthSummary('2026-09');
  // DV-LEDGER-01 仅日价不进 monthSummary：支出只有 100+50=150，count=2
  eq(s.expense, 15000, 'DV-LEDGER-01 月支出不含仅日价（150 元）');
  eq(s.count, 2, 'DV-LEDGER-01 count 只数 normal（2）');

  // DV-LEDGER-02 不进 monthGrouped
  const grouped = store.monthGrouped('2026-09');
  const groupedIds = [].concat(...grouped.map((d) => d.bills.map((b) => b.id)));
  assert(!groupedIds.includes(dvOnly.id), 'DV-LEDGER-02 仅日价不进时间线');
  assert(groupedIds.includes(normalDv.id), 'DV-LEDGER-04 normal+dailyValue 进时间线');

  // DV-LEDGER-03 不进普通搜索（页面 filter：ledgerImpact!=='daily-value-only'）
  const searchable = store.rangeBills().filter((b) => b.ledgerImpact !== 'daily-value-only');
  assert(!searchable.some((b) => b.id === dvOnly.id), 'DV-LEDGER-03 仅日价不进普通搜索');

  // DV-LEDGER-04 normal+dailyValue 正常进统计
  const dvItems = store.listDailyValueItems();
  assert(dvItems.some((b) => b.id === normalDv.id), 'DV-LEDGER-04 normal+dailyValue 进日价');
  assert(dvItems.some((b) => b.id === dvOnly.id), '仅日价物品进日价列表');

  // 月份导航：仅日价物品所在月若同时有 normal 仍在；此处验证 listAccountingMonths 含 9 月
  assert(store.listAccountingMonths().includes('2026-09'), '9 月有 normal，进导航');
}

/* ================= C. 新增语义（DV-FORM） ================= */
console.log('C. 新增语义');
{
  const wx = buildWx();
  const store = loadStore(wx);
  store.init();

  // DV-FORM-01 独立新增 → daily-value-only
  const item = store.addBill({
    type: 'expense', amountCents: 608800, categoryId: 'c-shopping',
    title: 'MacBook Pro', occurredAt: new Date(2026, 8, 1).getTime(),
    source: 'manual', ledgerImpact: 'daily-value-only',
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-09-01' },
  });
  eq(item.ledgerImpact, 'daily-value-only', 'DV-FORM-01 独立新增 daily-value-only');
  eq(store.monthSummary('2026-09').expense, 0, 'DV-FORM-01 不增支出');

  // DV-FORM-02 普通账单开启日价 → normal
  const bill = store.addBill({
    type: 'expense', amountCents: 10000, categoryId: 'c-food',
    occurredAt: new Date(2026, 9, 5).getTime(),
    ledgerImpact: 'normal',
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-10-05' },
  });
  eq(bill.ledgerImpact, 'normal', 'DV-FORM-02 普通账单 ledgerImpact=normal');
  eq(store.monthSummary('2026-10').expense, 10000, 'DV-FORM-02 正常计支出 100');
  assert(store.listDailyValueItems().some((x) => x.id === bill.id), 'DV-FORM-02 同时进日价');

  // DV-FORM-03 关闭日价（patch.dailyValue=null）：账单仍在，日价移除
  store.updateBill(bill.id, { dailyValue: null });
  eq(store.monthSummary('2026-10').expense, 10000, 'DV-FORM-03 关日价账单仍在');
  assert(!store.listDailyValueItems().some((x) => x.id === bill.id), 'DV-FORM-03 关日价后退出日价');
}

/* ================= D. 曲线（DV-CURVE） ================= */
console.log('D. 曲线');
{
  // 短周期（10 天）：逐日
  const short = makeBill({
    amountCents: 10000,
    occurredAt: new Date(2026, 9, 6).getTime(),
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-10-06' },
  });
  const sc = dv.buildDailyValueCurve(short, TODAY);
  eq(sc.length, 10, '短周期 10 天逐日（day1..10，共 10 点）');
  // DV-CURVE-01 第 1 天存在
  eq(sc[0].day, 1, 'DV-CURVE-01 第 1 天存在');
  approx(sc[0].valueCents, 10000, 0.01, '第 1 天日价=原价');

  // DV-CURVE-02 今天存在（最后一点 day=elapsed=10）
  eq(sc[sc.length - 1].day, 10, 'DV-CURVE-02 今天（第10天）存在');
  // DV-CURVE-03 单调下降
  assert(sc.every((p, i) => i === 0 || p.valueCents <= sc[i - 1].valueCents), 'DV-CURVE-03 曲线单调下降');

  // 长周期（5 年=1825 天）：DV-CURVE-04 不超过采样上限
  const long = makeBill({
    amountCents: 999999,
    occurredAt: new Date(2021, 9, 16).getTime(),
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2021-10-16' },
  });
  const lc = dv.buildDailyValueCurve(long, TODAY);
  assert(lc.length <= 120, 'DV-CURVE-04 长周期采样 <=120');
  eq(lc[0].day, 1, '长曲线含第 1 天');
  // 2021-10-16 → 2026-10-16 跨 2024 闰年：5*365+1=1826
  eq(lc[lc.length - 1].day, 1826, '长曲线含今天（第1826天）');
  assert(lc.every((p, i) => i === 0 || p.valueCents <= lc[i - 1].valueCents), '长曲线单调下降');
}

/* ================= E. 里程碑（DV-MS） ================= */
console.log('E. 里程碑');
{
  // DV-MS-01 使用节点：elapsed=355（2025-10-26 → 2026-10-16）
  const usage = dv.computeUsageMilestones('2025-10-26', TODAY);
  const targets = usage.map((u) => u.target);
  [7, 30, 100, 365].forEach((t) => assert(targets.includes(t), 'DV-MS-01 含 ' + t + ' 天节点'));
  // 7/30/100 已达成（elapsed355），365 未达成
  eq(usage.find((u) => u.target === 100).achieved, true, '100 天已达成');
  eq(usage.find((u) => u.target === 365).achieved, false, '365 天未达成');

  // DV-MS-02 价格节点：¥6088
  const price = dv.computeDailyPriceMilestones(608800, 355);
  const byTarget = {};
  price.forEach((m) => { byTarget[m.targetYuan] = m; });
  [100, 50, 20, 10].forEach((t) => assert(byTarget[t], 'DV-MS-02 含 ¥' + t + '/天节点'));
  eq(byTarget[100].requiredDays, 61, '¥100 → 第 61 天');
  eq(byTarget[50].requiredDays, 122, '¥50 → 第 122 天');
  eq(byTarget[20].requiredDays, 305, '¥20 → 第 305 天');
  eq(byTarget[10].requiredDays, 609, '¥10 → 第 609 天');
  // elapsed=355：¥100/50/20 已达成，¥10 未达成
  eq(byTarget[20].achieved, true, '¥20 已达成（355>=305）');
  eq(byTarget[10].achieved, false, '¥10 未达成（355<609）');
}

/* ================= F. Android .dvbackup 迁移（DV-IMPORT） ================= */
console.log('F. Android .dvbackup 迁移');
{
  const wx = buildWx();
  const store = loadStore(wx);
  store.init();

  const dvAdapter = require('../packages/importer/adapters/dailyvalue');
  const dedupe = require('../packages/importer/core/dedupe');
  const commit = require('../packages/importer/core/commit');

  // Android backup：normal+dailyValue（x1）+ daily-value-only（x2）
  const backup = {
    format: 'daily-value-backup',
    schemaVersion: 1,
    data: {
      bills: [
        {
          id: 'x1', type: 'expense', amount: 100, categoryId: 'c-shopping',
          date: '2026-09-10', timestamp: new Date(2026, 8, 10).getTime(),
          ledgerImpact: 'normal',
          dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-09-10' },
        },
        {
          id: 'x2', type: 'expense', amount: 200, categoryId: 'c-other',
          date: '2026-09-01', timestamp: new Date(2026, 8, 1).getTime(),
          title: '仅日价物品', ledgerImpact: 'daily-value-only',
          dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-09-01' },
        },
      ],
      categories: [],
    },
  };

  let normalized = dvAdapter.parseBackup(backup).bills;
  eq(normalized.length, 2, '解析出 2 笔');
  // DV-IMPORT-01 normal+dailyValue 字段
  const n1 = normalized.find((b) => b.sourceTxnId === 'x1');
  eq(n1.ledgerImpact, 'normal', 'DV-IMPORT-01 x1 normal');
  assert(n1.dailyValue && n1.dailyValue.enabled, 'DV-IMPORT-01 x1 含 dailyValue');
  // DV-IMPORT-02 daily-value-only 字段
  const n2 = normalized.find((b) => b.sourceTxnId === 'x2');
  eq(n2.ledgerImpact, 'daily-value-only', 'DV-IMPORT-02 x2 daily-value-only');
  assert(n2.dailyValue && n2.dailyValue.enabled, 'DV-IMPORT-02 x2 含 dailyValue');

  // 提交
  const session = { bills: dedupe.classify(normalized), counts: dedupe.countByStatus(dedupe.classify(normalized)) };
  commit.commitImport(session);
  // DV-IMPORT-01 normal 进统计
  eq(store.monthSummary('2026-09').expense, 10000, 'DV-IMPORT-01 普通账单进月支出（100）');
  // DV-IMPORT-02 仅日价进日价列表
  const dvList = store.listDailyValueItems();
  assert(dvList.some((x) => x.title === '仅日价物品'), 'DV-IMPORT-02 仅日价进日价列表');
  assert(dvList.some((x) => x.id === store.rangeBills().find((b) => b.sourceTxnId === 'dailyvalue:x1').id), 'x1 进日价列表');

  // DV-IMPORT-03 再次导入：不重复（existing，无补丁）
  const normalized2 = dvAdapter.parseBackup(backup).bills;
  const classified2 = dedupe.classify(normalized2);
  const c2 = dedupe.countByStatus(classified2);
  eq(c2.existing, 2, 'DV-IMPORT-03 再次导入全部 existing');
  const beforeCount = store.rangeBills().length;
  commit.commitImport({ bills: classified2, counts: c2 });
  eq(store.rangeBills().length, beforeCount, 'DV-IMPORT-03 条数不变');
}

/* ================= G. 合并补日价（sourceTxnId 命中） ================= */
console.log('G. 合并补日价');
{
  const wx = buildWx();
  const store = loadStore(wx);
  store.init();
  const dvAdapter = require('../packages/importer/adapters/dailyvalue');
  const dedupe = require('../packages/importer/core/dedupe');
  const commit = require('../packages/importer/core/commit');

  // 旧版导入：x1 已在账本（无 dailyValue，模拟旧版）
  const oldBill = store.addBill({
    type: 'expense', amountCents: 10000, categoryId: 'c-shopping',
    occurredAt: new Date(2026, 8, 10).getTime(),
    source: 'import', sourceTxnId: 'dailyvalue:x1', ledgerImpact: 'normal',
  });

  // 新版 backup 含 dailyValue
  const backup = {
    format: 'daily-value-backup',
    data: {
      bills: [{
        id: 'x1', type: 'expense', amount: 100, categoryId: 'c-shopping',
        timestamp: new Date(2026, 8, 10).getTime(),
        ledgerImpact: 'normal',
        dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-09-10' },
      }],
    },
  };
  const normalized = dvAdapter.parseBackup(backup).bills;
  const classified = dedupe.classify(normalized);
  eq(classified[0].status, 'merge', '标记 merge（补充日价）');
  const r = commit.commitImport({ bills: classified, counts: dedupe.countByStatus(classified) });
  eq(r.merged, 1, '合并 1 条');
  const updated = store.getBill(oldBill.id);
  assert(updated.dailyValue && updated.dailyValue.enabled, '本地账单补得 dailyValue');
  eq(store.monthSummary('2026-09').expense, 10000, '合并不重复计支出');
}

/* ================= H. Mini 备份 V2 与 V1 兼容（DV-BACKUP） ================= */
console.log('H. Mini 备份 V2 / V1 兼容');
{
  const wx = buildWx();
  const store = loadStore(wx);
  store.init();
  // normal+dailyValue 与 daily-value-only
  store.addBill({
    type: 'expense', amountCents: 10000, categoryId: 'c-shopping',
    occurredAt: new Date(2026, 8, 3).getTime(),
    ledgerImpact: 'normal',
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-09-03' },
  });
  store.addBill({
    type: 'expense', amountCents: 5000, categoryId: 'c-other',
    title: '仅日价', occurredAt: new Date(2026, 8, 1).getTime(),
    ledgerImpact: 'daily-value-only',
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-09-01' },
  });

  // DV-BACKUP-01 V2 完整备份
  const backup = store.buildBackup();
  eq(backup.schemaVersion, 3, 'DV-BACKUP-01 schemaVersion=3');
  assert(backup.data.bills.some((b) => b.dailyValue && b.dailyValue.enabled), 'DV-BACKUP-01 含 dailyValue');
  eq(backup.data.bills.some((b) => b.ledgerImpact === 'daily-value-only'), true, 'DV-BACKUP-01 含 daily-value-only');

  // DV-BACKUP-02 V2 恢复日价完整
  const store2 = loadStore(buildWx());
  store2.init();
  store2.restoreBackup(backup);
  const items = store2.listDailyValueItems();
  eq(items.length, 2, 'DV-BACKUP-02 恢复后日价 2 件');
  eq(store2.monthSummary('2026-09').expense, 10000, 'DV-BACKUP-02 月支出仅 normal（100）');

  // DV-BACKUP-03 旧 V1 备份仍能恢复
  const v1 = {
    format: 'daily-value-mini-backup',
    schemaVersion: 1,
    appVersion: '0.3.2',
    exportedAt: new Date().toISOString(),
    data: {
      bills: [{
        id: 'old1', type: 'expense', amountCents: 2000, categoryId: 'c-food',
        occurredAt: new Date(2026, 8, 5).getTime(),
        merchant: '', note: '', source: 'manual',
      }],
      categories: store2.getCategories(),
      settings: {},
    },
  };
  const store3 = loadStore(buildWx());
  store3.init();
  const r3 = store3.restoreBackup(v1);
  eq(r3.restored, 1, 'DV-BACKUP-03 V1 恢复 1 条');
  const restoredBill = store3.rangeBills()[0];
  eq(restoredBill.title, '', 'DV-BACKUP-03 V1 账单补 title');
  eq(restoredBill.ledgerImpact, 'normal', 'DV-BACKUP-03 V1 账单补 ledgerImpact');
  eq(store3.monthSummary('2026-09').expense, 2000, 'DV-BACKUP-03 V1 金额正确');
}

/* ================= I. V1 分片 → V2 无损迁移（DV-MODEL-01/02/03） ================= */
console.log('I. Bill V1→V2 无损');
{
  const wx = buildWx();
  const store = loadStore(wx);
  store.init();

  // 手工构造 V1 分片（version=1，无 title/ledgerImpact/dailyValue）
  const v1Bills = [
    {
      id: 'v1-a', type: 'expense', amountCents: 1234, categoryId: 'c-food',
      occurredAt: new Date(2026, 8, 10, 9, 30).getTime(),
      merchant: '某店', note: '午饭', source: 'manual', sourceTxnId: null,
      importBatchId: null, createdAt: 1, updatedAt: 1,
    },
    {
      id: 'v1-b', type: 'income', amountCents: 500000, categoryId: 'c-salary',
      occurredAt: new Date(2026, 8, 5).getTime(),
      merchant: '', note: '工资', source: 'manual', sourceTxnId: null,
      importBatchId: null, createdAt: 2, updatedAt: 2,
    },
  ];
  store.fs.writeJSON(store.paths.billFile('2026-09'), { ym: '2026-09', version: 1, bills: v1Bills });
  // 重置 manifest → 重新 init 触发 schema 迁移
  store.fs.remove(store.paths.FILE.manifest);
  const status = store.init();

  // DV-MODEL-01 无损：id/amountCents/occurredAt 不变，条数不变
  eq(status.schemaMigration.status, 'done', 'schema 迁移 done');
  const mf = store.ledger.readMonthFile('2026-09');
  eq(mf.version, 3, '分片经 V1→V2→V3 升级 version=3');
  eq(mf.bills.length, 2, '条数不变');
  const a = mf.bills.find((b) => b.id === 'v1-a');
  eq(a.amountCents, 1234, 'DV-MODEL-01 amountCents 不变');
  eq(a.occurredAt, v1Bills[0].occurredAt, 'DV-MODEL-01 occurredAt 不变');
  // DV-MODEL-02 title 持久化（补空串）
  eq(a.title, '', 'DV-MODEL-02 title 补空串');
  eq(a.ledgerImpact, 'normal', 'ledgerImpact 补 normal');
  // 迁移后正常统计
  eq(store.monthSummary('2026-09').expense, 1234, '迁移后月支出正确');

  // 幂等：再次 init 不重复
  store.init();
  eq(store.ledger.readMonthFile('2026-09').bills.length, 2, '重复 init 不重复');
}

/* ================= J. 编辑 startDate 作用域（DV-EDIT-NORMAL / DV-EDIT-ONLY） ================= */
console.log('J. 编辑 startDate 作用域');
{
  const wx = buildWx();
  const store = loadStore(wx);
  store.init();

  // normal + dailyValue：2026-10-10 18:32 ¥6000
  const orig = new Date(2026, 9, 10, 18, 32, 0).getTime();
  const normal = store.addBill({
    type: 'expense', amountCents: 600000, categoryId: 'c-shopping',
    occurredAt: orig, source: 'manual', ledgerImpact: 'normal',
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-10-10' },
  });
  // 模拟组件编辑：起算日改到 2026-09-01
  const patch = dvForm.buildEditPatch({
    title: '电脑', amountCents: 600000, categoryId: 'c-shopping', note: '',
    startDate: '2026-09-01', ledgerImpact: 'normal', originalOccurredAt: orig,
  });
  store.updateBill(normal.id, patch);
  // DV-EDIT-NORMAL-01 occurredAt 保持原值
  eq(store.getBill(normal.id).occurredAt, orig, 'DV-EDIT-NORMAL-01 occurredAt 不变');
  // DV-EDIT-NORMAL-02 月份不移动
  eq(store.monthSummary('2026-10').expense, 600000, 'DV-EDIT-NORMAL-02 10月金额不变');
  eq(store.monthSummary('2026-09').expense, 0, 'DV-EDIT-NORMAL-02 9月不增加');
  eq(store.getBill(normal.id).dailyValue.startDate, '2026-09-01', 'startDate 已更新');

  // daily-value-only：原 2026-10-01
  const only = store.addBill({
    type: 'expense', amountCents: 10000, categoryId: 'c-other',
    title: '仅日价', occurredAt: new Date(2026, 9, 1).getTime(),
    source: 'manual', ledgerImpact: 'daily-value-only',
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-10-01' },
  });
  // 起算日改到 2026-08-15
  const patch2 = dvForm.buildEditPatch({
    title: '仅日价', amountCents: 10000, categoryId: 'c-other', note: '',
    startDate: '2026-08-15', ledgerImpact: 'daily-value-only', originalOccurredAt: only.occurredAt,
  });
  store.updateBill(only.id, patch2);
  // DV-EDIT-ONLY-01 occurredAt 跟随起算日
  const moved = store.getBill(only.id);
  eq(moved.occurredAt, dvForm.startOfLocalDay('2026-08-15'), 'DV-EDIT-ONLY-01 occurredAt 跟随 startDate');
  eq(moved.dailyValue.startDate, '2026-08-15', 'DV-EDIT-ONLY-01 startDate 更新');
}

/* ================= K. 日价表单校验（DV-FORM-VALID） ================= */
console.log('K. 日价表单校验');
{
  // DV-FORM-VALID-01 title 为空 / 空白 → submit disabled
  eq(dvForm.computeFormCanSubmit('', 10000), false, 'DV-FORM-VALID-01 空标题不可提交');
  eq(dvForm.computeFormCanSubmit('   ', 10000), false, 'DV-FORM-VALID-01 空白标题不可提交');
  // DV-FORM-VALID-02 normal bill 无 title 时按 merchant→分类名→兜底回退
  eq(dvForm.resolveEditTitle({ title: '', merchant: '', categoryId: 'c-food' }, { name: '餐饮' }), '餐饮', 'DV-FORM-VALID-02 回退分类名');
  eq(dvForm.resolveEditTitle({ title: '', merchant: '瑞幸', categoryId: 'c-food' }, { name: '餐饮' }), '瑞幸', 'DV-FORM-VALID-02 回退 merchant');
  eq(dvForm.resolveEditTitle({ title: 'MacBook', merchant: '苹果', categoryId: 'c-shopping' }, { name: '购物' }), 'MacBook', 'DV-FORM-VALID-02 优先 title');
  eq(dvForm.resolveEditTitle({ title: '', merchant: '', categoryId: 'c-food' }, null), '日价物品', 'DV-FORM-VALID-02 兜底日价物品');
  // DV-FORM-VALID-03 显示可提交状态与 onSubmit 条件一致（名称非空 且 金额非0）
  eq(dvForm.computeFormCanSubmit('电脑', 0), false, 'DV-FORM-VALID-03 金额 0 不可提交');
  eq(dvForm.computeFormCanSubmit('电脑', 600000), true, 'DV-FORM-VALID-03 名称+金额可提交');
  eq(dvForm.computeFormCanSubmit('', 600000), false, 'DV-FORM-VALID-03 标题空不可提交');
}

/* ================= 汇总 ================= */
console.log('\ndaily-value tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL DAILY VALUE TESTS PASSED');
