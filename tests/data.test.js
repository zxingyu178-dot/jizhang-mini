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
  eq(backup.schemaVersion, 1, '备份 schema 版本');
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

/* ---------- 结果 ---------- */
console.log('\n==============================');
console.log('PASS: ' + pass + '  FAIL: ' + fail);
if (fail > 0) {
  process.exit(1);
}
console.log('ALL DATA LAYER TESTS PASSED');
