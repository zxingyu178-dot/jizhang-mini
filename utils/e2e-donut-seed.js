// utils/e2e-donut-seed.js
// 圆环 E2E 的数据注入 / 清理逻辑（测试桥接模块），与业务逻辑解耦。
// 仅在非 release（develop/trial）由 pages/main 的薄委托调用；release 环境 main.js 已先
// fail-closed 拒绝，不会走到本文件的 require。因此本模块在正式发布环境为不可达死代码。
//
// v1.3.4 安全收口：不再仅凭普通备注文本认定测试账单。每次注入生成唯一 runId，
// 账单 note 写带命名空间前缀的标记（__TEST__:<runId>），runId + 账单 ID 持久化到
// 独立测试清单（utils/test-registry）。清理优先按清单账单 ID 精确删除，兜底只扫描
// 命名空间前缀残留，绝不删除 note 不带测试前缀的真实账单。

const testRegistry = require('./test-registry');

// 旧版本（≤1.3.3）裸标识：仅用于测试环境升级时一次性清理残留，不再作为新账单标记。
const LEGACY_DONUT_TAG = 'E2E_DONUT';

/**
 * 清理旧版本（≤1.3.3）裸标识残留。仅在测试桥接流程内调用（release 不可达），
 * 用于升级后清掉历史测试账单；新账单一律不再使用该裸标识。
 */
function clearLegacyDonut(store) {
  const removed = [];
  store.rangeBills().forEach((b) => {
    if (b.note === LEGACY_DONUT_TAG) {
      const ym = store.ledger.ymOf(b.occurredAt);
      try {
        store.deleteBill(b.id);
        removed.push({ id: b.id, ym });
      } catch (e) {
        /* 忽略 */
      }
    }
  });
  return removed;
}

/** 注入公共逻辑：清理 → 生成 runId → 注入命名空间账单 → 持久化 run。 */
function buildSeed(store, rows, kind) {
  const now = new Date();
  const ym = store.ledger.ymOf(now.getTime());

  // 干净起点：先清历史命名空间测试账单，再清旧版本裸标识残留。
  const preClean = testRegistry.cleanupTestBills(store);
  const legacyRemoved = clearLegacyDonut(store);

  const runId = testRegistry.makeRunId(kind);
  const created = [];
  rows.forEach((s, i) => {
    const at = new Date(
      now.getFullYear(),
      now.getMonth(),
      Math.min(i + 1, 27),
      12,
      0
    ).getTime();
    const b = store.addBill({
      type: 'expense',
      amount: s.amount,
      categoryId: s.categoryId,
      note: testRegistry.encodeTestNote(runId),
      occurredAt: at,
    });
    created.push({ id: b.id, categoryId: b.categoryId, amountCents: b.amountCents });
  });

  // 持久化本次 run（runId + 账单 ID），供后续按 ID 精确清理。
  testRegistry.registerRun({
    runId,
    kind,
    billIds: created.map((c) => c.id),
  });

  return {
    ym,
    runId,
    preCleaned: preClean.removed,
    legacyRemoved: legacyRemoved.length,
    created,
    createdIds: created.map((c) => c.id),
  };
}

/** 注入前先清理残留（幂等 + 异常退出自愈），再注入固定 5 分类支出。 */
function seedDonut() {
  const store = require('../data/index');
  const rows = [
    { categoryId: 'c-food', amount: 375.64 },
    { categoryId: 'c-shopping', amount: 204.04 },
    { categoryId: 'c-life', amount: 140.00 },
    { categoryId: 'c-transport', amount: 90.00 },
    { categoryId: 'c-fun', amount: 50.00 },
  ];
  return buildSeed(store, rows, 'donut');
}

/**
 * 注入 10 个分类（>8），用于 Top7+「其他」聚合展开回归（T22/T23）。
 * 金额递减保证排序确定，复用同一 runId / 命名空间清理机制。
 */
function seedDonutMany() {
  const store = require('../data/index');
  const rows = [
    ['c-food', 380], ['c-shopping', 320], ['c-life', 260], ['c-transport', 210],
    ['c-fun', 170], ['c-drink', 130], ['c-bill', 100], ['c-medical', 80],
    ['c-housing', 60], ['c-travel', 40],
  ].map((r) => ({ categoryId: r[0], amount: r[1] }));
  return buildSeed(store, rows, 'donutMany');
}

/**
 * 跨全部月份清理测试账单：
 *   先按持久化清单的账单 ID 精确删除 + 命名空间前缀兜底；仅当测试清单本就存在
 *   （测试框架运行过的环境）时，再清旧版本裸标识残留，全新 / 真实账本不凭普通备注删除。
 * 不触碰 note 不带测试前缀的真实账单；每条记录可追溯。
 */
function clearDonut() {
  const store = require('../data/index');
  const hadRegistry = testRegistry.registryExists(); // 调用前状态，避免被本次 cleanup 改写
  const cr = testRegistry.cleanupTestBills(store);
  const legacyRemoved = hadRegistry ? clearLegacyDonut(store) : [];
  return {
    scannedMonthCount: store.listMonths().length,
    months: cr.months,
    removed: cr.removed + legacyRemoved.length,
    removedIds: cr.removedById.concat(cr.removedByScan),
    legacyRemoved: legacyRemoved.map((r) => r.id),
  };
}

module.exports = {
  E2E_DONUT_TAG: LEGACY_DONUT_TAG, // 保留导出名兼容引用；语义为旧版本裸标识
  seedDonut,
  seedDonutMany,
  clearDonut,
};
