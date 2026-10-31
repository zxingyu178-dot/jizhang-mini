// utils/e2e-donut-seed.js
// E2E 圆环命中测试的种子数据桥接（v1.3.4 Review Fix 再加固）。
//
// 安全收口（本版本）：
//   1. 移除 buildSeed 中原先无条件执行的 clearLegacyDonut，也不再自动删除仅凭
//      E2E_DONUT / SELFTEST 裸备注识别的账单——裸备注不携带 runId，无法确认归属，
//      真实账单备注恰好等于该值时必须保留；
//   2. runId 在注入账单之前先 registerRun（空 billIds）登记；
//   3. 每笔账单创建后立即 addBillToRun 登记其 ID，支持中途异常退出时清理本次已登记账单；
//   4. 清理统一走 test-registry 的 fail-safe 精确清理（三重核对 + 兜底仅已登记 runId）。
//
// 仅在 develop / trial 测试桥接路径使用，release 下入口 fail-closed、不可达。
const testRegistry = require('./test-registry');

/** 旧版本裸标识：仅保留常量供测试构造「备注巧合」的真实账单，不再用于删除判定。 */
const E2E_DONUT_TAG = 'E2E_DONUT';

/* ---------------- 注入 ---------------- */

/**
 * 注入种子账单并返回创建结果。
 * @param {object} store 数据层
 * @param {Array<{categoryId:string, amount:number}>} rows 种子行
 * @param {string} kind run 类型前缀
 */
function buildSeed(store, rows, kind) {
  const now = new Date();

  // 干净起点：先清历史「已登记」命名空间测试账单（fail-safe，不碰裸备注真实账单）。
  const preClean = testRegistry.cleanupTestBills(store);

  // runId 先登记（空 billIds），再注入账单。
  const runId = testRegistry.makeRunId(kind);
  testRegistry.registerRun({ runId, kind, billIds: [] });

  const created = [];
  rows.forEach((s, i) => {
    const at = new Date(
      now.getFullYear(),
      now.getMonth(),
      Math.min(i + 1, 27),
      12,
      0
    ).getTime();
    const bill = store.addBill({
      type: 'expense',
      amount: s.amount,
      categoryId: s.categoryId,
      note: testRegistry.encodeTestNote(runId),
      occurredAt: at,
    });
    // 每笔创建后及时登记 ID，支持中途异常退出时清理本次已登记账单。
    testRegistry.addBillToRun(runId, bill.id);
    created.push({ id: bill.id, categoryId: bill.categoryId, amountCents: bill.amountCents });
  });

  return {
    ym: store.ledger.ymOf(now.getTime()),
    runId,
    preCleaned: preClean.removed,
    created,
    createdIds: created.map((c) => c.id),
  };
}

/** 注入前清理残留（幂等 + 异常自愈），再注入固定 5 分类支出。 */
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

/* ---------------- 清理 ---------------- */

/**
 * 清理测试种子：统一走 test-registry fail-safe 精确清理。
 * 不凭裸备注删除任何账单。
 */
function clearDonut() {
  const store = require('../data/index');
  const cr = testRegistry.cleanupTestBills(store);
  return {
    scannedMonthCount: store.listMonths().length,
    months: cr.months,
    removed: cr.removed,
    removedIds: cr.removedById.concat(cr.removedByScan),
    corrupt: cr.corrupt,
  };
}

module.exports = {
  E2E_DONUT_TAG, // 保留导出名兼容引用；语义为旧版本裸标识，不用于删除
  seedDonut,
  seedDonutMany,
  clearDonut,
};
