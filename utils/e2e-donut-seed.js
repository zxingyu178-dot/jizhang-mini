// utils/e2e-donut-seed.js
// 圆环 E2E 的数据注入 / 清理逻辑（测试桥接模块），与业务逻辑解耦。
// 仅在非 release（develop/trial）由 pages/main 的薄委托调用；release 环境 main.js 已先
// fail-closed 拒绝，不会走到本文件的 require。因此本模块在正式发布环境为不可达死代码。
//
// 测试账单用固定专用标识 E2E_DONUT_TAG 精确全等匹配，绝不宽泛匹配误删真实账单。
// 每次注入前先清理同标识残留：异常退出后重跑也能自愈；返回创建 / 清理记录可追溯。

const E2E_DONUT_TAG = 'E2E_DONUT';

/** 注入前先清理同标识残留（幂等 + 异常退出自愈），再注入固定 5 分类支出 */
function seedDonut() {
  const store = require('../data/index');
  const now = new Date();
  const ym = store.ledger.ymOf(now.getTime());

  const preClean = clearDonut();

  const seed = [
    { categoryId: 'c-food', amount: 375.64 },
    { categoryId: 'c-shopping', amount: 204.04 },
    { categoryId: 'c-life', amount: 140.00 },
    { categoryId: 'c-transport', amount: 90.00 },
    { categoryId: 'c-fun', amount: 50.00 },
  ];
  const created = [];
  seed.forEach((s, i) => {
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
      note: E2E_DONUT_TAG,
      occurredAt: at,
    });
    created.push({ id: b.id, categoryId: b.categoryId, amountCents: b.amountCents });
  });

  return {
    ym,
    tag: E2E_DONUT_TAG,
    preCleaned: preClean.removed,
    created,
    createdIds: created.map((c) => c.id),
  };
}

/**
 * 注入 10 个分类（>8），用于 Top7+「其他」聚合展开回归（T22/T23）。
 * 同样先清理同标识残留；金额递减保证排序确定，复用同一 tag 与 clearDonut 清理。
 */
function seedDonutMany() {
  const store = require('../data/index');
  const now = new Date();
  const ym = store.ledger.ymOf(now.getTime());

  const preClean = clearDonut();

  const seed = [
    ['c-food', 380], ['c-shopping', 320], ['c-life', 260], ['c-transport', 210],
    ['c-fun', 170], ['c-drink', 130], ['c-bill', 100], ['c-medical', 80],
    ['c-housing', 60], ['c-travel', 40],
  ];
  const created = [];
  seed.forEach((s, i) => {
    const at = new Date(
      now.getFullYear(),
      now.getMonth(),
      Math.min(i + 1, 27),
      12,
      0
    ).getTime();
    const b = store.addBill({
      type: 'expense',
      amount: s[1],
      categoryId: s[0],
      note: E2E_DONUT_TAG,
      occurredAt: at,
    });
    created.push({ id: b.id, categoryId: b.categoryId, amountCents: b.amountCents });
  });

  return {
    ym,
    tag: E2E_DONUT_TAG,
    preCleaned: preClean.removed,
    created,
    createdIds: created.map((c) => c.id),
  };
}

/**
 * 跨全部月份清理 note 精确等于 E2E_DONUT_TAG 的账单（不触碰真实账单）。
 * 无参 rangeBills 扫描所有月份分片：即使测试异常退出、账单残留在旧月份，
 * 跨月后重跑也能发现并清理，不再只看当前月。每条记录带所属月份，清理结果可追溯；
 * 仍只认精确的 E2E_DONUT_TAG，绝不宽泛匹配误删真实账单。
 */
function clearDonut() {
  const store = require('../data/index');
  const bills = store.rangeBills(); // 无参：读取全部月份分片
  const removedRecords = [];
  const touchedMonths = {};
  bills.forEach((b) => {
    if (b.note === E2E_DONUT_TAG) {
      const ym = store.ledger.ymOf(b.occurredAt);
      store.deleteBill(b.id);
      removedRecords.push({ id: b.id, categoryId: b.categoryId, ym });
      touchedMonths[ym] = true;
    }
  });
  return {
    scannedMonthCount: store.listMonths().length,
    months: Object.keys(touchedMonths).sort(),
    tag: E2E_DONUT_TAG,
    removed: removedRecords.length,
    removedRecords,
  };
}

module.exports = { E2E_DONUT_TAG, seedDonut, seedDonutMany, clearDonut };
