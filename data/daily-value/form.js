/**
 * data/daily-value/form.js — 日价表单纯函数
 *
 * 把「日价物品」表单（daily-value-form）里与平台无关的逻辑抽成纯函数，
 * 便于 Node 单元测试：名称回退、提交条件、编辑 patch 构造。
 */

/** 'yyyy-MM-dd' 本地零点时间戳（日价专属物品账单落在起算日所在月份分片） */
function startOfLocalDay(dateStr) {
  const p = String(dateStr).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0).getTime();
}

/** 编辑名称回退：title → merchant → 分类名 → 日价物品 */
function resolveEditTitle(bill, category) {
  if (bill && bill.title) return bill.title;
  if (bill && bill.merchant) return bill.merchant;
  if (category && category.name) return category.name;
  return '日价物品';
}

/** 提交条件：名称非空且金额非 0（UI 按钮态必须与 onSubmit 完全一致） */
function computeFormCanSubmit(title, amountCents) {
  return String(title).trim().length > 0 && amountCents !== 0;
}

/**
 * 构造编辑提交 patch：
 * - daily-value-only：账单时间(occurredAt)跟随起算日（可能跨月）；
 * - normal：原交易时间(occurredAt)保持原值，只改 dailyValue.startDate。
 */
function buildEditPatch(input) {
  const patch = {
    title: input.title,
    type: 'expense',
    amountCents: input.amountCents,
    categoryId: input.categoryId,
    note: input.note,
    dailyValue: { enabled: true, mode: 'elapsed', startDate: input.startDate },
  };
  if (input.ledgerImpact === 'daily-value-only') {
    patch.occurredAt = startOfLocalDay(input.startDate);
  } else {
    patch.occurredAt = input.originalOccurredAt;
  }
  return patch;
}

module.exports = {
  startOfLocalDay,
  resolveEditTitle,
  computeFormCanSubmit,
  buildEditPatch,
};
