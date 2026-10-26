// packages/importer/core/commit.js
// 原子化导入提交：
//   1. 写快照安全点；
//   2. 内存中按月份合并，再逐月份写文件；
//   3. 写后重新读取校验条数；
//   任一步失败 → 用快照完整恢复，原账本不变。
const fs = require('../../../data/fs');
const paths = require('../../../data/paths');
const backup = require('../../../data/backup');
const ledger = require('../../../data/ledger');
const categories = require('../../../data/categories');
const recurringStore = require('../../../data/recurring/store');
const recurringGenerator = require('../../../data/recurring/generator');

/**
 * 导入 / 恢复写入规则后，立即重算 nextOccurrence 并补齐到期账单（fire-and-forget）。
 * 生成器内部带并发锁、永不 reject、单规则异常隔离，无需用户把小程序切后台再回来。
 * 已随备份导入的历史周期账单因确定性 id 命中而跳过，不会重复生成。
 */
function scheduleRecurringCatchup() {
  try {
    const p = recurringGenerator.runRecurringGenerator();
    if (p && typeof p.catch === 'function') {
      p.catch((e) => console.error('导入后周期补齐失败', e));
    }
  } catch (e) {
    console.error('导入后周期补齐失败', e);
  }
}

/**
 * 幂等写入 Gate F 自定义分类（同 id 跳过、同名复用、否则按确定性 id 新建），
 * 并把得到的 id 映射应用到内存 bills 的 categoryId。
 * @returns idRemap
 */
function ensureExtraCategories(session, bills) {
  const remap = {};
  (session.extraCategories || []).forEach((c) => {
    // 备份中的分类为有效分类：若 Mini 已有同 id 分类（哪怕之前被归档），复用并恢复为 active
    const existing = categories.getCategories().find((x) => x.id === c.id);
    if (existing) {
      if (existing.archived) categories.restoreCategory(existing.id);
      remap[c.id] = existing.id;
      return;
    }
    const dup = categories.findDuplicateName(c.name);
    if (dup) {
      // 同名分类处于归档状态时复用并恢复 active，避免导入的周期规则引用新记账里看不到的归档分类
      if (dup.archived) categories.restoreCategory(dup.id);
      remap[c.id] = dup.id;
      return;
    }
    const r = categories.addCategory({
      id: c.id,
      name: c.name,
      emoji: c.emoji,
      iconType: c.iconType,
      iconValue: c.iconValue,
    });
    remap[c.id] = r.ok ? r.category.id : c.id;
  });
  const keys = Object.keys(remap);
  if (keys.length) {
    bills.forEach((b) => {
      if (remap[b.categoryId]) b.categoryId = remap[b.categoryId];
    });
  }
  return remap;
}

/** 幂等写入 Gate G 周期规则（同 id 跳过；categoryId 应用分类映射） */
function ensureExtraRules(session, remap) {
  (session.extraRecurringRules || []).forEach((r) => {
    if (remap[r.categoryId]) r.categoryId = remap[r.categoryId];
    if (recurringStore.getRule(r.id)) return;
    recurringStore.addRule(r);
  });
}

/** NormalizedBill -> ledger Bill 字段（透传 title / ledgerImpact / dailyValue） */
function toLedgerBill(b, batchId) {
  const out = {
    type: b.type,
    amountCents: b.amountCents,
    categoryId: b.categoryId,
    occurredAt: b.occurredAt,
    title: b.title || '',
    merchant: b.merchant,
    note: b.note,
    source: 'import',
    sourceTxnId: b.source && b.sourceTxnId ? b.source + ':' + b.sourceTxnId : null,
    importBatchId: batchId,
    ledgerImpact: b.ledgerImpact === 'daily-value-only' ? 'daily-value-only' : 'normal',
  };
  // 仅在合法启用时挂 dailyValue（与数据层 Bill V2 形态一致）
  if (b.dailyValue && b.dailyValue.enabled === true && b.dailyValue.startDate) {
    out.dailyValue = {
      enabled: true,
      mode: 'elapsed',
      startDate: String(b.dailyValue.startDate).slice(0, 10),
    };
  }
  // 周期账单：关联迁移后的规则 id（有才挂，Bill V3）
  if (b.recurringRuleId) out.recurringRuleId = b.recurringRuleId;
  return out;
}

/**
 * 提交导入。
 * @param {object} session detector 产出的会话
 * @param {object} opts { includeSuspect:boolean }
 * @returns {{ imported:number, batchId:string, months:string[] }}
 */
function commitImport(session, opts) {
  opts = opts || {};
  const include = (b) =>
    b.status === 'ready' || (opts.includeSuspect && b.status === 'suspect');
  const toImport = session.bills.filter(include);
  // 「补充日价」：命中已存在账单，不新增条数，只在安全快照内补写 dailyValue/title
  const toMerge = session.bills.filter((b) => b.status === 'merge');

  // 1. 快照（原子写，安全点自身不能写坏）
  const safety = paths.legacyRestoreSafety();
  fs.writeJSONAtomic(safety, backup.buildBackup());

  const beforeCount = ledger.rangeBills().length;
  const batchId = 'imp-' + Date.now();

  try {
    // 0. Gate F/G：先幂等写入自定义分类与周期规则（账单 categoryId 已重映射）
    const remap = ensureExtraCategories(session, session.bills);
    ensureExtraRules(session, remap);

    // 1.5 补充日价（原位更新，不新增账单）
    toMerge.forEach((b) => {
      if (!b.existingId || !b.mergePatch) return;
      ledger.updateBill(b.existingId, b.mergePatch);
    });

    // 2. 按月份分组
    const groups = {};
    toImport.forEach((b) => {
      const ym = ledger.ymOf(b.occurredAt);
      if (!groups[ym]) groups[ym] = [];
      groups[ym].push(b);
    });

    // 3. 逐月份写（严格读：先对全部目标月预检，损坏月整批中止并回滚，绝不覆盖）
    const months = Object.keys(groups).sort();
    months.forEach((ym) => ledger.readMonthFileStrict(ym));
    months.forEach((ym) => {
      const mf = ledger.readMonthFileStrict(ym);
      // 必须经 createBill 补全 id / createdAt / updatedAt 等必需字段；
      // 直接写 toLedgerBill 结果会让所有导入账单缺少 id，导致无法编辑 / 跨月 / 迁移。
      mf.bills = mf.bills.concat(groups[ym].map((b) => ledger.createBill(toLedgerBill(b, batchId))));
      ledger.writeMonthFile(ym, mf);
    });

    // 4. 写后校验
    const afterCount = ledger.rangeBills().length;
    if (afterCount - beforeCount !== toImport.length) {
      throw new Error('导入条数校验不一致');
    }

    // 5. Gate G：规则已写入，立即重算 nextOccurrence / 补齐到期账单（带历史账单的确定性 id 会跳过）
    scheduleRecurringCatchup();

    return { imported: toImport.length, merged: toMerge.length, batchId, months };
  } catch (e) {
    // 回滚到快照（救命回滚：跳过健康门，避免健康校验阻断回滚本身）
    const saved = fs.readJSON(safety, null);
    if (saved) backup.restoreBackup(saved, { skipHealth: true });
    throw e;
  }
}

/** 完整恢复（Mini 备份） */
function commitRestore(session) {
  const result = backup.restoreBackup(session.restoreObj);
  // 恢复后立即重算周期 nextOccurrence / 补齐到期账单（不强制用户切后台再回来）
  scheduleRecurringCatchup();
  return {
    imported: result.restored,
    months: result.months,
    warningCount: result.warningCount || 0,
    warnings: result.warnings || [],
  };
}

module.exports = {
  commitImport,
  commitRestore,
  toLedgerBill,
};
