// data/statistics/month.js
// 月度统计纯函数：输入「当月账单数组」，输出概览 / 每日支出趋势 / 分类排行 / 收支对比。
// 规则：
//   - 仅统计 ledgerImpact === 'normal'（'daily-value-only' 不进账）；
//   - 不直接依赖 store / 分类表，分类名由 resolveCategory 注入，便于单测；
//   - 金额一律整数分。

/** 是否计入账本（与 ledger.monthSummary 口径一致） */
function inLedger(b) {
  return b && b.ledgerImpact !== 'daily-value-only';
}

/**
 * 月度概览
 * @returns {{income:number, expense:number, balance:number, count:number}}
 */
function computeMonthOverview(bills) {
  let income = 0;
  let expense = 0;
  let count = 0;
  (bills || []).forEach((b) => {
    if (!inLedger(b)) return;
    count += 1;
    if (b.type === 'income') income += b.amountCents;
    else expense += b.amountCents;
  });
  return { income, expense, balance: income - expense, count };
}

/**
 * 每日支出趋势（正序，含当月每一天，便于画细柱）。
 * @param {Array} bills 当月账单
 * @param {number} year
 * @param {number} month 1-12
 * @returns {{points:Array, max:number}}
 */
function computeDailyExpenseTrend(bills, year, month) {
  const days = new Date(year, month, 0).getDate(); // month 月天数
  const points = [];
  for (let d = 1; d <= days; d++) {
    points.push({ day: d, label: d + '日', cents: 0, percent: 0, showLabel: false });
  }
  (bills || []).forEach((b) => {
    if (!inLedger(b) || b.type !== 'expense') return;
    const d = new Date(b.occurredAt).getDate();
    if (d >= 1 && d <= days) points[d - 1].cents += b.amountCents;
  });
  let max = 0;
  points.forEach((p) => {
    if (p.cents > max) max = p.cents;
  });
  // 横轴标签抽稀到约 6 个（手机窄屏不叠）
  const step = Math.ceil(days / 6);
  points.forEach((p) => {
    p.percent = max ? Math.round((p.cents / max) * 100) : 0;
    if (p.day - 1 === 0 || (p.day - 1) % step === 0 || p.day === days) p.showLabel = true;
  });
  return { points, max };
}

/**
 * 分类支出排行（降序），并给出 Top 5。
 * @param {Array} bills 当月账单
 * @param {(id:string)=>{name:string,emoji:string}} [resolveCategory]
 * @returns {{total:number, list:Array, top:Array}}
 */
function computeCategoryRanking(bills, resolveCategory) {
  const map = {};
  (bills || []).forEach((b) => {
    if (!inLedger(b) || b.type !== 'expense') return;
    const c = b.categoryId || 'c-other';
    if (!map[c]) map[c] = { categoryId: c, cents: 0, count: 0 };
    map[c].cents += b.amountCents;
    map[c].count += 1;
  });
  let total = 0;
  Object.keys(map).forEach((k) => {
    total += map[k].cents;
  });
  const list = Object.keys(map).map((k) => {
    const x = map[k];
    const cat = resolveCategory ? resolveCategory(k) : { name: k, emoji: '' };
    return {
      categoryId: x.categoryId,
      name: cat.name || '其他',
      emoji: cat.emoji || '',
      cents: x.cents,
      count: x.count,
      percent: total ? Math.round((x.cents / total) * 100) : 0,
      barPercent: 0,
    };
  });
  list.sort((a, b) => b.cents - a.cents);
  const maxC = list.length ? list[0].cents : 0;
  list.forEach((x) => {
    x.barPercent = maxC ? Math.round((x.cents / maxC) * 100) : 0;
  });
  return { total, list, top: list.slice(0, 5) };
}

/**
 * 某分类的「支出」账单明细（点击支出排行时用）。
 * 只返回计入账本、type==='expense' 且分类匹配的账单，按时间倒序；
 * 收入账单不得混入（即便它和支出属于同一分类）。
 * @returns {Array}
 */
function listCategoryExpenseBills(bills, catId) {
  return (bills || [])
    .filter((b) => inLedger(b) && b.type === 'expense' && (b.categoryId || 'c-other') === catId)
    .slice()
    .sort((a, b) => b.occurredAt - a.occurredAt);
}

/**
 * 收入 / 支出对比（两根相对条）
 * @returns {{income:number, expense:number, incomeBar:number, expenseBar:number}}
 */
function computeIncomeExpenseCompare(bills) {
  const o = computeMonthOverview(bills);
  const max = Math.max(o.income, o.expense, 1);
  return {
    income: o.income,
    expense: o.expense,
    incomeBar: Math.round((o.income / max) * 100),
    expenseBar: Math.round((o.expense / max) * 100),
  };
}

module.exports = {
  inLedger,
  computeMonthOverview,
  computeDailyExpenseTrend,
  computeCategoryRanking,
  listCategoryExpenseBills,
  computeIncomeExpenseCompare,
};
