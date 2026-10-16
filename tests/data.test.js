/**
 * tests/data.test.js — 正式本地数据层（M2）单元测试
 *
 * 用内存文件系统 mock wx（FileSystemManager / Storage / env），无需测试框架、无需真机。
 * 运行：node tests/data.test.js
 */

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error('  FAIL: ' + msg);
  }
}
function eq(actual, expected, msg) {
  assert(actual === expected, msg + ' (expected=' + expected + ', actual=' + actual + ')');
}

/* ---------- 内存 wx 环境 ---------- */
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
          if (i === 0 && p === '') {
            cur = '';
          } else {
            cur = cur + '/' + p;
            memDirs.add(cur);
          }
        });
      } else {
        memDirs.add(path);
      }
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
    setStorageSync: (k, v) => {
      storage[k] = v;
    },
    // 测试观察用
    __memFiles: memFiles,
    __memDirs: memDirs,
    __storage: storage,
  };
  return wx;
}

/** 加载一个全新数据层实例（清除 data 模块缓存） */
function loadStore(wx) {
  global.wx = wx;
  Object.keys(require.cache).forEach((k) => {
    if (k.replace(/\\/g, '/').includes('/jizhang-mini/data/')) delete require.cache[k];
  });
  return require('../data/index');
}

/* ---------- 场景一：有旧 jm_records，走无损迁移 ---------- */
console.log('场景一：旧 jm_records 无损迁移');
{
  const legacy = [
    { id: 'aaa', createdAt: 1760000000000, type: 'expense', amount: 25.5, category: 'food', date: '2026-10-15', note: '午餐' },
    { id: 'bbb', createdAt: 1760000001000, type: 'income', amount: 1000, category: 'salary', date: '2026-10-15' },
    { id: 'ccc', createdAt: 1760000002000, type: 'expense', amount: 12, category: 'transport', date: '2026-09-30' },
  ];
  const wx = buildWx({ jm_records: legacy });
  const store = loadStore(wx);

  const status = store.init();
  eq(status.migration.status, 'done', '迁移状态 done');
  eq(status.migration.recordCount, 3, '迁移 3 条');
  eq(status.migration.expenseCents, 2550 + 1200, '迁移支出总额 3750 分');
  eq(status.migration.incomeCents, 100000, '迁移收入总额 100000 分');

  // 旧 jm_records 未被删除
  assert(Array.isArray(wx.__storage.jm_records) && wx.__storage.jm_records.length === 3, 'jm_records 保留未删');

  // 备份文件存在
  assert(wx.__memFiles.has('/usr/legacy/jm_records.backup.json'), '原始数组已备份到 legacy');

  // 月份分片
  const months = store.listMonths();
  assert(months.includes('2026-09') && months.includes('2026-10'), '两个月份分片存在');

  // 10 月统计
  const s10 = store.monthSummary('2026-10');
  eq(s10.expense, 2550, '10月支出 2550');
  eq(s10.income, 100000, '10月收入 100000');
  eq(s10.balance, 100000 - 2550, '10月结余');
  const s9 = store.monthSummary('2026-09');
  eq(s9.expense, 1200, '9月支出 1200');

  // 迁移分类映射
  const bills10 = store.monthGrouped('2026-10');
  const migrated = store.rangeBills(null, null);
  const foodBill = migrated.find((b) => b.id === 'mig-aaa');
  eq(foodBill.categoryId, 'c-food', 'food 映射为 c-food');
  eq(foodBill.amountCents, 2550, '金额转为分');
  eq(foodBill.note, '午餐', '备注保留');

  // 幂等：再 init 不应重复迁移
  const again = store.init();
  eq(again.migration.status, 'done', '重复 init 状态仍 done');
  eq(store.rangeBills(null, null).length, 3, '重复 init 不重复写入，仍 3 条');
}

/* ---------- 场景二：无旧数据，全新账本 ---------- */
console.log('场景二：全新账本 CRUD');
{
  const wx = buildWx();
  const store = loadStore(wx);
  store.init();
  eq(store.getStatus().migration.status, 'skipped', '无旧数据迁移 skipped');
  eq(store.listMonths().length, 0, '初始无月份分片');

  // 新增账单
  const b1 = store.addBill({ type: 'expense', amount: 18, categoryId: 'c-food', note: '咖啡', occurredAt: new Date(2026, 9, 15, 10).getTime() });
  const b2 = store.addBill({ type: 'expense', amountCents: 2350, categoryId: 'c-transport', occurredAt: new Date(2026, 9, 15, 18).getTime() });
  eq(b1.amountCents, 1800, 'addBill 元自动转分');
  eq(b2.amountCents, 2350, 'addBill 支持直接传分');

  const s = store.monthSummary('2026-10');
  eq(s.expense, 1800 + 2350, '月度支出 4150');
  eq(s.count, 2, '月度 2 笔');

  // 按天分组
  const grouped = store.monthGrouped('2026-10');
  eq(grouped.length, 1, '一天分组');
  eq(grouped[0].bills.length, 2, '当天 2 笔');
  eq(grouped[0].expense, 4150, '当天支出 4150');

  // 删除
  const deleted = store.deleteBill(b1.id);
  assert(deleted, '删除成功');
  eq(store.monthSummary('2026-10').expense, 2350, '删除后支出 2350');

  // 更新
  const updated = store.updateBill(b2.id, { note: '打车回家' });
  eq(updated.note, '打车回家', '更新备注');
}

/* ---------- 场景三：备份 / 恢复 ---------- */
console.log('场景三：完整备份与恢复');
{
  const wx = buildWx();
  const store = loadStore(wx);
  store.init();
  store.addBill({ type: 'expense', amount: 99.9, categoryId: 'c-shopping', occurredAt: new Date(2026, 9, 1).getTime() });
  store.addBill({ type: 'income', amount: 5000, categoryId: 'c-salary', occurredAt: new Date(2026, 9, 10).getTime() });

  const backup = store.buildBackup();
  eq(backup.format, 'daily-value-mini-backup', '备份格式标识');
  eq(backup.schemaVersion, 2, '备份 schema 版本（V2）');
  eq(backup.data.bills.length, 2, '备份含 2 账单');

  // 清空账本后恢复
  store.deleteBill(store.monthGrouped('2026-10')[0].bills[0].id);
  // 直接恢复原备份
  const r = store.restoreBackup(backup);
  eq(r.restored, 2, '恢复 2 条');
  const s = store.monthSummary('2026-10');
  eq(s.expense, 9990, '恢复后支出 9990');
  eq(s.income, 500000, '恢复后收入 500000');

  // 非法备份
  let threw = false;
  try {
    store.restoreBackup({ format: 'wrong', data: {} });
  } catch (e) {
    threw = true;
  }
  assert(threw, '非法备份被拒绝');
}

/* ---------- 金额工具边界 ---------- */
console.log('金额工具边界');
{
  const wx = buildWx();
  const store = loadStore(wx);
  const m = store.money;
  eq(m.parseAmountToCents('¥25.80'), 2580, '¥ 解析');
  eq(m.parseAmountToCents('￥25.80'), 2580, '全角￥ 解析');
  eq(m.parseAmountToCents('1,234.56'), 123456, '千分位解析');
  eq(m.parseAmountToCents(0.1), 10, '0.1 浮点转分无误差');
  eq(m.parseAmountToCents(2.01), 201, '2.01 浮点转分无误差');
  eq(m.formatCents(2550), '25.50', '分格式化');
  eq(m.formatCents(1234567), '12,345.67', '大额千分位格式化');
  eq(m.formatCentsWithSymbol(8), '¥0.08', '8分格式化');
}

/* ---------- v0.2.1 跨月编辑：10月→9月 ---------- */
console.log('v0.2.1 跨月编辑：10月→9月');
{
  const util = require('../utils/util');
  const wx = buildWx();
  const store = loadStore(wx);
  store.init();

  const b = store.addBill({
    type: 'expense', amountCents: 1800, categoryId: 'c-food', note: '咖啡',
    occurredAt: new Date(2026, 9, 15, 8, 30).getTime(),
  });
  eq(store.monthSummary('2026-10').expense, 1800, '初始 10 月支出 1800');
  eq(store.monthSummary('2026-09').expense, 0, '初始 9 月支出 0');

  const updated = store.updateBill(b.id, { occurredAt: util.dateWithTime('2026-09-20', 8, 30) });
  assert(updated, '跨月更新返回账单');
  eq(updated.id, b.id, '跨月编辑 Bill id 不变');
  eq(store.monthSummary('2026-10').expense, 0, '10→9 旧月统计减为 0');
  eq(store.monthSummary('2026-09').expense, 1800, '10→9 新月统计增为 1800');
  eq(store.ledger.countIdInMonth('2026-10', b.id), 0, '旧月已无该 id');
  eq(store.ledger.countIdInMonth('2026-09', b.id), 1, '新月恰有该 id 1 条');
  const d = new Date(updated.occurredAt);
  eq(d.getMonth() + 1, 9, '落到 9 月');
  eq(d.getDate(), 20, '日期为 20 日');
  eq(d.getHours(), 8, '保留原时 8 点');
  eq(d.getMinutes(), 30, '保留原分 30 分');
}

/* ---------- v0.2.1 跨月编辑：9月→10月 ---------- */
console.log('v0.2.1 跨月编辑：9月→10月');
{
  const util = require('../utils/util');
  const wx = buildWx();
  const store = loadStore(wx);
  store.init();

  const b = store.addBill({
    type: 'expense', amountCents: 2350, categoryId: 'c-transport',
    occurredAt: new Date(2026, 8, 3, 19, 5).getTime(),
  });
  eq(store.monthSummary('2026-09').expense, 2350, '初始 9 月支出 2350');

  const updated = store.updateBill(b.id, { occurredAt: util.dateWithTime('2026-10-05', 19, 5) });
  eq(updated.id, b.id, '9→10 id 不变');
  eq(store.monthSummary('2026-09').expense, 0, '9→10 旧月统计减 0');
  eq(store.monthSummary('2026-10').expense, 2350, '9→10 新月统计增 2350');
  eq(store.ledger.countIdInMonth('2026-09', b.id), 0, '旧月无 id');
  eq(store.ledger.countIdInMonth('2026-10', b.id), 1, '新月有 id');
}

/* ---------- v0.2.1 同月原位更新 ---------- */
console.log('v0.2.1 同月原位更新');
{
  const util = require('../utils/util');
  const wx = buildWx();
  const store = loadStore(wx);
  store.init();

  const b = store.addBill({
    type: 'expense', amountCents: 6000, categoryId: 'c-food',
    occurredAt: new Date(2026, 9, 10, 12, 0).getTime(),
  });
  const updated = store.updateBill(b.id, {
    note: '改了备注',
    occurredAt: util.dateWithTime('2026-10-28', 12, 0), // 仍在 10 月
  });
  eq(updated.note, '改了备注', '同月更新备注');
  eq(updated.id, b.id, '同月更新 id 不变');
  eq(store.monthSummary('2026-10').expense, 6000, '同月改日期统计不变');
  eq(store.ledger.countIdInMonth('2026-10', b.id), 1, '同月仅 1 条');
  eq(store.listMonths().length, 1, '只存在一个月份分片');
}

/* ---------- v0.2.1 跨月编辑失败回滚 ---------- */
console.log('v0.2.1 跨月编辑失败回滚');
{
  const util = require('../utils/util');
  const wx = buildWx();
  const store = loadStore(wx);
  store.init();

  const b = store.addBill({
    type: 'expense', amountCents: 1800, categoryId: 'c-food',
    occurredAt: new Date(2026, 9, 15, 8, 30).getTime(),
  });

  const fs = store.fs;
  const origWrite = fs.writeJSON;
  let hit = false;
  fs.writeJSON = function (p, o) {
    const pp = String(p).replace(/\\/g, '/');
    if (!hit && pp.indexOf('/bills/2026-09') >= 0) {
      hit = true;
      throw new Error('INJECTED_MOVE');
    }
    return origWrite(p, o);
  };

  let caught = '';
  try {
    // 10 月 → 9 月，写新分片(9月)时注入失败
    store.updateBill(b.id, { occurredAt: util.dateWithTime('2026-09-01', 8, 30) });
  } catch (e) {
    caught = e.message;
  }
  fs.writeJSON = origWrite;

  assert(caught.indexOf('INJECTED_MOVE') >= 0, '跨月写入失败向上抛错');
  eq(store.monthSummary('2026-10').expense, 1800, '回滚后旧月仍为 1800');
  eq(store.ledger.countIdInMonth('2026-10', b.id), 1, '回滚后旧月仍持有该 id');
  eq(store.ledger.countIdInMonth('2026-09', b.id), 0, '回滚后新月无该 id');
  // 回滚后可正常重试
  const retry = store.updateBill(b.id, { occurredAt: util.dateWithTime('2026-09-01', 8, 30) });
  eq(retry.id, b.id, '回滚后重试成功');
  eq(store.ledger.countIdInMonth('2026-09', b.id), 1, '重试后新月 1 条');
}

/* ---------- v0.2.1 迁移：注入失败→0 污染→重跑成功无重复 ---------- */
console.log('v0.2.1 迁移失败回滚 + 幂等重跑');
{
  const legacy = [
    { id: 'a1', createdAt: 1760000000000, type: 'expense', amount: 10, category: 'food', date: '2026-10-01' },
    { id: 'a2', createdAt: 1760000001000, type: 'expense', amount: 20, category: 'transport', date: '2026-09-01' },
    { id: 'a3', createdAt: 1760000002000, type: 'income', amount: 500, category: 'salary', date: '2026-10-02' },
  ];
  const wx = buildWx({ jm_records: legacy });
  const store = loadStore(wx);
  const fs = store.fs;
  const origWrite = fs.writeJSON;

  // 第一次写非空 bills 分片即注入失败
  let injected = false;
  fs.writeJSON = function (p, o) {
    const pp = String(p).replace(/\\/g, '/');
    if (!injected && pp.indexOf('/bills/') >= 0 && o && Array.isArray(o.bills) && o.bills.length) {
      injected = true;
      throw new Error('INJECTED_MIG');
    }
    return origWrite(p, o);
  };

  let caught = '';
  try {
    store.init();
  } catch (e) {
    caught = e.message;
  }
  assert(caught.indexOf('INJECTED_MIG') >= 0, '迁移写入被人为注入失败');
  eq(store.rangeBills().length, 0, '迁移失败后账本 0 污染');
  eq(store.manifest.getMigration('jmRecords').status, 'failed', '迁移状态标记 failed');

  // 恢复写入，重新执行迁移
  fs.writeJSON = origWrite;
  const again = store.init();
  eq(again.migration.status, 'done', '重跑迁移成功 done');
  eq(again.migration.recordCount, 3, '重跑迁移 3 条');
  eq(store.rangeBills().length, 3, '重跑后恰好 3 条（无重复）');
  ['mig-a1', 'mig-a2', 'mig-a3'].forEach((id) => {
    const n = store.rangeBills().filter((b) => b.id === id).length;
    eq(n, 1, id + ' 重跑后恰好 1 条');
  });
  // 连续重启（再次 init）不重复
  store.init();
  store.init();
  eq(store.rangeBills().length, 3, '连续 init 不产生重复记录');
  // 总额正确
  eq(store.monthSummary('2026-10').expense, 1000, '10 月支出 1000');
  eq(store.monthSummary('2026-09').expense, 2000, '9 月支出 2000');
  eq(store.monthSummary('2026-10').income, 50000, '10 月收入 50000');
}

/* ---------- v0.2.1 编辑保留原始时分纯函数 ---------- */
console.log('v0.2.1 dateWithTime 合并日期与时分');
{
  const util = require('../utils/util');
  const d = new Date(util.dateWithTime('2026-09-01', 8, 5));
  eq(d.getFullYear(), 2026, '年 2026');
  eq(d.getMonth() + 1, 9, '月 9');
  eq(d.getDate(), 1, '日 1');
  eq(d.getHours(), 8, '时 8');
  eq(d.getMinutes(), 5, '分 5（个位数保留）');
  const d2 = new Date(util.dateWithTime('2026-12-31', 23, 59));
  eq(d2.getHours(), 23, '23 时');
  eq(d2.getMinutes(), 59, '59 分');
}

/* ---------- 结果 ---------- */
console.log('\n==============================');
console.log('PASS: ' + pass + '  FAIL: ' + fail);
if (fail > 0) {
  process.exit(1);
}
console.log('ALL DATA LAYER TESTS PASSED');
