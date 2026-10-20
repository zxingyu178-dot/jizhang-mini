/**
 * tests/disaster-recovery.test.js — v0.8.0 / G7 恢复灾难演练 + 升级矩阵
 *
 * 两大目标（发版前的「异常安全」总验收）：
 *
 *  A. 灾难演练（fail-closed + 原账本零污染）：
 *     面对损坏备份（非法 type / impact / amount / occurredAt / 重复 id / 非法规则 /
 *     非法预算规则）与损坏月份分片，恢复与写入必须被拒绝，且原账本逐字节不变
 *     （G2 落盘前校验在写安全点之前即拒绝，连安全点都不写）。
 *
 *  B. 升级矩阵（从每个历史起点都能干净升级到当前版本）：
 *     Fresh Install、Bill V1 / V2 / V3 月份分片、Backup V1 / V2 / V3 恢复，
 *     升级后分片版本=3、字段补齐、不可变字段保留、健康检查通过。
 *
 * 运行：node tests/disaster-recovery.test.js
 */
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
function eq(a, b, msg) {
  assert(a === b, msg + '（期望 ' + b + '，实际 ' + a + '）');
}

/* ---------- 内存文件系统（与 strict-read 同构，外加快照） ---------- */
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
  return {
    setWx() {
      global.wx = { env: { USER_DATA_PATH: '/usr' }, getFileSystemManager: () => fsm };
    },
    snapshot() {
      return new Map(Array.from(memFiles.entries()).map(([k, v]) => [k, v]));
    },
  };
}
function sameSnapshot(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (!b.has(k) || b.get(k) !== v) return false;
  }
  return true;
}

// 加载任何数据模块前，先给一个默认 wx（paths 模块加载时需读 wx.env.USER_DATA_PATH）。
// 各场景会用各自的 buildWx().setWx() 替换为独立内存文件系统。
buildWx().setWx();

const ROOT = path.join(__dirname, '..');
const store = require(path.join(ROOT, 'data', 'index'));
const fs = require(path.join(ROOT, 'data', 'fs'));
const paths = require(path.join(ROOT, 'data', 'paths'));
const categories = require(path.join(ROOT, 'data', 'categories'));
const ledger = require(path.join(ROOT, 'data', 'ledger'));

const TS = new Date(2026, 8, 5, 12, 0).getTime();
const CATS = [
  { id: 'c-food', name: '餐饮', emoji: '🍚', builtin: true, sort: 1, archived: false },
];

/** 一份「干净」的 V3 备份；mutate 可注入损坏 */
function cleanV3Backup(mutate) {
  const backup = {
    format: 'daily-value-mini-backup',
    schemaVersion: 3,
    appVersion: '0.7.0',
    exportedAt: '2026-09-01T00:00:00.000Z',
    data: {
      bills: [
        { id: 'b1', type: 'expense', amountCents: 1000, categoryId: 'c-food', occurredAt: TS, title: '', ledgerImpact: 'normal' },
      ],
      categories: CATS.map((c) => Object.assign({}, c)),
      settings: { currency: '¥', theme: 'dark' },
      recurringRules: [],
    },
  };
  if (mutate) mutate(backup);
  return backup;
}

/** 建立一个「已知良好」的已初始化账本（含 1 笔 10 月账） */
function buildGoodStore() {
  const c = buildWx();
  c.setWx();
  store.init();
  store.addBill({
    type: 'expense',
    amountCents: 2500,
    categoryId: 'c-food',
    occurredAt: new Date(2026, 9, 5, 12, 0).getTime(),
  });
  return c;
}

/** 断言：恢复该备份被拒绝，且原账本快照逐字节不变 */
function expectRejectedAndClean(label, mutate) {
  const c = buildGoodStore();
  const before = c.snapshot();
  let rejected = false;
  let msg = '';
  try {
    store.restoreBackup(cleanV3Backup(mutate));
  } catch (e) {
    rejected = true;
    msg = e.message;
  }
  assert(rejected, '灾难演练：' + label + ' 恢复被拒绝');
  assert(sameSnapshot(before, c.snapshot()), '灾难演练：' + label + ' 原账本零污染（' + msg + '）');
}

/* ==================== A. 灾难演练 ==================== */

// A1. 非法 type，不得被偷偷修成 expense
expectRejectedAndClean('非法 type', (b) => {
  b.data.bills[0].type = 'foobar';
});
// A2. 非法 ledgerImpact，不得被修成 normal
expectRejectedAndClean('非法 ledgerImpact', (b) => {
  b.data.bills[0].ledgerImpact = 'zzz';
});
// A3. 非数值 amount
expectRejectedAndClean('非数值 amountCents', (b) => {
  b.data.bills[0].amountCents = 'abc';
});
// A4. occurredAt=0（会被 createBill 改成 now 的陷阱）
expectRejectedAndClean('occurredAt=0', (b) => {
  b.data.bills[0].occurredAt = 0;
});
// A5. 缺失 id（createBill 会自动生成的陷阱）
expectRejectedAndClean('缺失 bill id', (b) => {
  delete b.data.bills[0].id;
});
// A6. 重复 bill id
expectRejectedAndClean('重复 bill id', (b) => {
  b.data.bills.push(Object.assign({}, b.data.bills[0], { note: 'dup' }));
});
// A7. 重复 category id
expectRejectedAndClean('重复 category id', (b) => {
  b.data.categories.push(Object.assign({}, b.data.categories[0]));
});
// A8. 重复周期规则 id
expectRejectedAndClean('重复周期规则 id', (b) => {
  const r = {
    id: 'r1', enabled: true, type: 'expense', amountCents: 2800, categoryId: 'c-food',
    frequency: 'monthly', interval: 1, day: 1, startDate: '2026-09-01', time: '09:00',
  };
  b.data.recurringRules = [r, Object.assign({}, r)];
});
// A9. 非法周期规则（startDate 非真实日期）
expectRejectedAndClean('非法周期规则 startDate', (b) => {
  b.data.recurringRules = [
    {
      id: 'r1', enabled: true, type: 'expense', amountCents: 2800, categoryId: 'c-food',
      frequency: 'daily', interval: 1, startDate: 'nope', time: '09:00',
    },
  ];
});
// A10. 重复预算规则 id
expectRejectedAndClean('重复预算规则 id', (b) => {
  const r = { id: 'bd1', enabled: true, dailyCents: 10000, effectiveFrom: '2026-09-01' };
  b.data.settings.budget = { version: 1, weekStartsOn: 0, rules: [r, Object.assign({}, r)] };
});
// A11. 非法预算规则（effectiveFrom 非真实日期）
expectRejectedAndClean('非法预算规则 effectiveFrom', (b) => {
  b.data.settings.budget = {
    version: 1,
    weekStartsOn: 0,
    rules: [{ id: 'bd1', enabled: true, dailyCents: 10000, effectiveFrom: 'nope' }],
  };
});
// A12. 周期规则引用不存在的分类
expectRejectedAndClean('周期规则引用未知分类', (b) => {
  b.data.recurringRules = [
    {
      id: 'r1', enabled: true, type: 'expense', amountCents: 2800, categoryId: 'c-ghost',
      frequency: 'daily', interval: 1, startDate: '2026-09-01', time: '09:00',
    },
  ];
});

// A13. 损坏月份分片：写入 fail-closed，原始损坏内容不被覆盖
(function () {
  const c = buildWx();
  c.setWx();
  store.init();
  const f10 = paths.billFile('2026-10');
  const ORIGINAL = '<<CORRUPT ORIGINAL FOR RECOVERY>>';
  fs.writeText(f10, ORIGINAL);
  const before = c.snapshot();
  let rejected = false;
  try {
    ledger.addBill({ type: 'expense', amountCents: 100, categoryId: 'c-food', occurredAt: new Date(2026, 9, 7, 12, 0).getTime() });
  } catch (e) {
    rejected = e.code === 'MONTH_CORRUPT';
  }
  assert(rejected, '灾难演练：损坏月份 addBill 抛 MONTH_CORRUPT');
  assert(sameSnapshot(before, c.snapshot()), '灾难演练：损坏月份原始内容未被覆盖');
})();

/* ==================== B. 升级矩阵 ==================== */

/** 在空 FS 中放置分类/设置 + 一个历史月份分片（不写 manifest），再跑 init 全流程 */
function initWithLegacyMonth(version, bills) {
  const c = buildWx();
  c.setWx();
  fs.writeJSON(paths.FILE.categories, categories.DEFAULT_CATEGORIES);
  fs.writeJSON(paths.FILE.settings, { currency: '¥', theme: 'dark' });
  fs.writeJSON(paths.billFile('2026-09'), { ym: '2026-09', version, bills });
  store.init();
  return c;
}

// B1. Fresh Install：空目录初始化到当前版本，健康
(function () {
  const c = buildWx();
  c.setWx();
  const st = store.init();
  eq(st.schemaVersion, 3, 'Fresh Install：manifest schemaVersion=3');
  assert(fs.exists(paths.FILE.categories), 'Fresh Install：默认分类已建');
  assert(fs.exists(paths.FILE.settings), 'Fresh Install：默认设置已建');
  const rep = store.runHealthScan();
  assert(rep.ok, 'Fresh Install：健康检查通过（errors=' + rep.errors.length + '）');
})();

// B2. Bill V1 → V3：无 title/ledgerImpact 的旧账单升级后字段补齐，金额/时间不变
(function () {
  const v1Bill = {
    id: 'v1-a', type: 'expense', amountCents: 3600, categoryId: 'c-food',
    occurredAt: new Date(2026, 8, 3, 8, 30).getTime(),
  };
  initWithLegacyMonth(1, [v1Bill]);
  const mf = ledger.readMonthFileStrict('2026-09');
  eq(mf.version, 3, 'Bill V1：分片升级到 version=3');
  const b = mf.bills.find((x) => x.id === 'v1-a');
  assert(!!b, 'Bill V1：账单保留');
  eq(b.title, '', 'Bill V1：补 title');
  eq(b.ledgerImpact, 'normal', 'Bill V1：补 ledgerImpact=normal');
  eq(b.amountCents, 3600, 'Bill V1：金额不变');
  eq(b.type, 'expense', 'Bill V1：type 不变');
  eq(b.occurredAt, v1Bill.occurredAt, 'Bill V1：occurredAt 不变');
  assert(store.runHealthScan().ok, 'Bill V1：升级后健康通过');
})();

// B3. Bill V2 → V3：title/ledgerImpact/dailyValue 保留，补 recurringRuleId 形态
(function () {
  const v2Bill = {
    id: 'v2-a', type: 'expense', amountCents: 9900, categoryId: 'c-food',
    occurredAt: new Date(2026, 8, 4, 9, 0).getTime(),
    title: '咖啡', ledgerImpact: 'normal',
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-09-01' },
  };
  initWithLegacyMonth(2, [v2Bill]);
  const mf = ledger.readMonthFileStrict('2026-09');
  eq(mf.version, 3, 'Bill V2：分片升级到 version=3');
  const b = mf.bills.find((x) => x.id === 'v2-a');
  eq(b.title, '咖啡', 'Bill V2：title 保留');
  eq(b.ledgerImpact, 'normal', 'Bill V2：ledgerImpact 保留');
  assert(b.dailyValue && b.dailyValue.startDate === '2026-09-01', 'Bill V2：dailyValue 保留');
  eq(b.amountCents, 9900, 'Bill V2：金额不变');
  assert(store.runHealthScan().ok, 'Bill V2：升级后健康通过');
})();

// B4. Bill V3：已是当前版本，保持不变
(function () {
  const v3Bill = {
    id: 'v3-a', type: 'expense', amountCents: 1200, categoryId: 'c-transport',
    occurredAt: new Date(2026, 8, 5, 18, 0).getTime(),
    title: '', ledgerImpact: 'normal', recurringRuleId: 'r-weekly',
  };
  initWithLegacyMonth(3, [v3Bill]);
  const mf = ledger.readMonthFileStrict('2026-09');
  eq(mf.version, 3, 'Bill V3：保持 version=3');
  const b = mf.bills.find((x) => x.id === 'v3-a');
  eq(b.recurringRuleId, 'r-weekly', 'Bill V3：recurringRuleId 保留');
  // 引用一个不存在的规则只是 warning（删除规则后历史保留），健康仍 ok
  assert(store.runHealthScan().ok, 'Bill V3：健康通过（孤儿规则为 warning）');
})();

/** 构造某个 schemaVersion 的「正常」备份（不含任何损坏） */
function normalBackup(version) {
  const bills = [
    { id: 'bk1', type: 'expense', amountCents: 1000, categoryId: 'c-food', occurredAt: TS },
    { id: 'bk2', type: 'income', amountCents: 5000, categoryId: 'c-salary', occurredAt: TS },
  ];
  const backup = {
    format: 'daily-value-mini-backup',
    schemaVersion: version,
    appVersion: '0.x.0',
    exportedAt: '2026-09-01T00:00:00.000Z',
    data: {
      bills,
      categories: CATS.concat([{ id: 'c-salary', name: '工资', emoji: '💰', builtin: false, sort: 8, archived: false }]),
      settings: { currency: '¥', theme: 'dark' },
    },
  };
  if (version === 1) {
    // V1：无 title/ledgerImpact/dailyValue，无 recurringRules
  } else if (version === 2) {
    backup.data.bills = bills.map((b) => Object.assign({ title: '', ledgerImpact: 'normal' }, b));
    // 注：上一行展开顺序保证 title/ledgerImpact 在场
  } else {
    backup.data.bills = bills.map((b) => Object.assign({ title: '', ledgerImpact: 'normal' }, b));
    backup.data.recurringRules = [];
  }
  return backup;
}

// B5-B7. Backup V1 / V2 / V3 正常备份恢复成功
[1, 2, 3].forEach((v) => {
  (function () {
    const c = buildGoodStore();
    let result = null;
    let err = null;
    try {
      result = store.restoreBackup(normalBackup(v));
    } catch (e) {
      err = e;
    }
    assert(!err, '升级矩阵：Backup V' + v + ' 恢复成功（' + (err ? err.message : 'ok') + '）');
    if (result) {
      eq(result.restored, 2, '升级矩阵：Backup V' + v + ' 恢复 2 笔');
      assert(store.runHealthScan().ok, '升级矩阵：Backup V' + v + ' 恢复后健康通过');
    }
  })();
});

/* ---------- 汇总 ---------- */
console.log('disaster-recovery tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
