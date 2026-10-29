// data/statistics/month.js
// 月度统计纯函数：输入「当月账单数组」，输出概览 / 每日支出趋势 / 分类排行 / 收支对比。
// 规则：
//   - 仅统计 ledgerImpact === 'normal'（'daily-value-only' 不进账）；
//   - 不直接依赖 store / 分类表，分类名由 resolveCategory 注入，便于单测；
//   - 金额一律整数分。

const { pickCategoryVisual } = require('../category-icons');

/** 是否计入账本（与 ledger.monthSummary 口径一致） */
function inLedger(b) {
  return b && b.ledgerImpact !== 'daily-value-only';
}

/**
 * 计算 month（1-12）月的日历天数；年月非法（NaN / 非有限数）时返回 NaN。
 * 集中口径，避免各调用方在非法输入下 new Array(NaN) 抛 RangeError。
 */
function monthDays(year, month) {
  if (!Number.isFinite(year) || !Number.isFinite(month)) return NaN;
  return new Date(year, month, 0).getDate();
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
  const days = monthDays(year, month); // month 月天数；非法时为 NaN，循环不执行、返回空
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
    return Object.assign(
      {
        categoryId: x.categoryId,
        name: cat.name || '其他',
        cents: x.cents,
        count: x.count,
        percent: total ? Math.round((x.cents / total) * 100) : 0,
        barPercent: 0,
      },
      pickCategoryVisual(cat)
    );
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

/* ===================== Statistics Core V2（v1.3.0） ===================== */

/** 聚合「其他」分类的稳定 id（不是真实分类，避免与 c-other 混淆） */
const AGGREGATE_OTHER_ID = '__aggregate_other__';
/** 圆环最多直接展示的分类数；超过则保留前 N 项并聚合其余 */
const MAX_DIRECT_SEGMENTS = 8;
const TOP_N_WHEN_AGGREGATED = 7;

/** 一位小数百分比文本（如 '40.9'）；仅用于显示，画图用 ratio。 */
function formatPercent1(cents, total) {
  if (!total) return '0.0';
  return (Math.round((cents / total) * 1000) / 10).toFixed(1);
}

/**
 * 分类占比（分类环形图数据源）。
 * 在 computeCategoryRanking 基础上增加：
 *   - ratio：精确比例 cents/total（圆环角度必须用它，不用四舍五入的百分比）；
 *   - percentText：一位小数百分比；
 *   - 分类 >8 时 Top7 + 聚合「其他」（AGGREGATE_OTHER_ID）。
 * @returns {{total:number, segments:Array, all:Array, aggregated:boolean}}
 *   segments 用于圆环与默认列表（可能含聚合项）；all 为全部真实分类，供「查看全部」。
 */
function computeCategoryShare(bills, resolveCategory) {
  const ranking = computeCategoryRanking(bills, resolveCategory);
  const total = ranking.total;
  const all = ranking.list.map((x) =>
    Object.assign({}, x, {
      ratio: total ? x.cents / total : 0,
      percentText: formatPercent1(x.cents, total),
      aggregate: false,
    })
  );

  let segments;
  let aggregated = false;
  if (all.length <= MAX_DIRECT_SEGMENTS) {
    segments = all;
  } else {
    aggregated = true;
    const head = all.slice(0, TOP_N_WHEN_AGGREGATED).map((x) => Object.assign({}, x));
    const rest = all.slice(TOP_N_WHEN_AGGREGATED);
    const restCents = rest.reduce((s, x) => s + x.cents, 0);
    const restCount = rest.reduce((s, x) => s + x.count, 0);
    head.push({
      categoryId: AGGREGATE_OTHER_ID,
      name: '其他',
      cents: restCents,
      count: restCount,
      ratio: total ? restCents / total : 0,
      percentText: formatPercent1(restCents, total),
      iconType: 'emoji',
      iconValue: '📦',
      emoji: '📦',
      aggregate: true,
    });
    segments = head;
  }
  return { total, segments, all, aggregated };
}

/**
 * 最高消费日：仅统计 normal 支出，按日合计取最大；同额取 day 小（确定性）。
 * @returns {{day:number, cents:number}|null}
 */
function findTopExpenseDay(bills, year, month) {
  const days = monthDays(year, month);
  // 年月非法：安全返回空值，由 UI 展示「—」，不抛 RangeError
  if (!Number.isFinite(days)) return null;
  const dayCents = new Array(days).fill(0);
  (bills || []).forEach((b) => {
    if (!inLedger(b) || b.type !== 'expense') return;
    const d = new Date(b.occurredAt).getDate();
    if (d >= 1 && d <= days) dayCents[d - 1] += b.amountCents;
  });
  let best = null;
  for (let i = 0; i < days; i++) {
    if (dayCents[i] <= 0) continue;
    if (!best || dayCents[i] > best.cents) best = { day: i + 1, cents: dayCents[i] };
  }
  return best;
}

/**
 * 日均支出（整数分）。当前月分母为「截至今天（含）」的天数；
 * 历史/未来月分母为整月天数。today 为可选 Date。
 * @returns {number}
 */
function computeDailyAverageExpense(bills, year, month, today) {
  const o = computeMonthOverview(bills);
  const daysInMonth = monthDays(year, month);
  let denom = daysInMonth;
  if (today && Number.isFinite(year) && today.getFullYear() === year && today.getMonth() === month - 1) {
    denom = Math.max(1, today.getDate());
  }
  // denom 非法（NaN）或 0 时安全返回 0，不出现除零
  return denom ? Math.round(o.expense / denom) : 0;
}

/**
 * 最大单笔支出：金额最大的 normal 支出账单；同额取 occurredAt 最早（确定性）。
 * @returns {Object|null} 原始账单
 */
function findLargestExpense(bills) {
  let largest = null;
  (bills || []).forEach((b) => {
    if (!inLedger(b) || b.type === 'income') return;
    if (
      !largest ||
      b.amountCents > largest.amountCents ||
      (b.amountCents === largest.amountCents && b.occurredAt < largest.occurredAt)
    ) {
      largest = b;
    }
  });
  return largest;
}

/**
 * 累计消费趋势（v1.3.0 Gate G）：逐日累计 normal 支出，结果单调不减。
 * 回答「这个月钱花得有多快」。收入与 daily-value-only 不参与。
 * @param {Array} bills 当月账单
 * @param {number} year
 * @param {number} month 1-12
 * @returns {{points:Array<{day:number,label:string,dayCents:number,cumCents:number,showLabel:boolean}>,total:number,max:number}}
 */
function computeCumulativeTrend(bills, year, month) {
  const days = monthDays(year, month);
  // 年月非法：安全返回空结果，不抛 RangeError
  if (!Number.isFinite(days)) return { points: [], total: 0, max: 0 };
  const dayCents = new Array(days).fill(0);
  (bills || []).forEach((b) => {
    if (!inLedger(b) || b.type !== 'expense') return;
    const d = new Date(b.occurredAt).getDate();
    if (d >= 1 && d <= days) dayCents[d - 1] += b.amountCents;
  });
  const step = Math.ceil(days / 6);
  const points = [];
  let acc = 0;
  for (let i = 0; i < days; i++) {
    acc += dayCents[i];
    points.push({
      day: i + 1,
      label: (i + 1) + '日',
      dayCents: dayCents[i],
      cumCents: acc,
      showLabel: i === 0 || i % step === 0 || i + 1 === days,
    });
  }
  return { points, total: acc, max: acc };
}

module.exports = {
  inLedger,
  monthDays,
  computeMonthOverview,
  computeDailyExpenseTrend,
  computeCategoryRanking,
  listCategoryExpenseBills,
  computeIncomeExpenseCompare,
  AGGREGATE_OTHER_ID,
  MAX_DIRECT_SEGMENTS,
  TOP_N_WHEN_AGGREGATED,
  computeCategoryShare,
  findTopExpenseDay,
  computeDailyAverageExpense,
  findLargestExpense,
  computeCumulativeTrend,
};
