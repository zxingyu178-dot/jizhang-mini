/**
 * data/budget/calendar.js — 预算日历地图 + 日详情（纯函数，整数分）
 *
 * 月历网格（周一→周日，weekStartsOn=1）：
 *   绿色 = 当天盈余、红色 = 当天超支、灰色 = 无预算 / 未来、紫色描边 = 今天。
 *   两档深浅：盈余较多 / 较少、轻微超支 / 明显超支（不做彩虹 Heatmap）。
 * 规则中途变更时，逐天取适用规则，历史自动分段稳定。
 */
const rules = require('./rules');
const core = require('./core');
const period = require('./period');
const dvCore = require('../daily-value/core');

const WEEK_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];

/** 当月天数（month 为 1-based） */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 即下月第0天
}

/**
 * 构造月历网格。
 * @param bills 账单数组
 * @param state budget rules state
 * @param year
 * @param month 1-based
 * @param todayStr
 * @return {year,month,weekHeaders,gridStart,leading,weeks:[[cell]]}
 */
function buildMonthCalendar(bills, state, year, month, todayStr) {
  const today = todayStr || dvCore.localDateKey();

  // 当月实际支出按本地日期归集
  const byDay = {};
  (bills || []).forEach((b) => {
    if (!core.consumesBudget(b)) return;
    const d = core.billLocalDate(b);
    byDay[d] = (byDay[d] || 0) + b.amountCents;
  });

  const firstStr = year + '-' + String(month).padStart(2, '0') + '-01';
  // 周一起：1日 weekday 映射到前置空格数（周一=0 … 周日=6）
  const firstWd = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const leading = firstWd === 0 ? 6 : firstWd - 1;
  const dim = daysInMonth(year, month);
  const totalCells = Math.ceil((leading + dim) / 7) * 7;
  const gridStart = period.addDays(firstStr, -leading);

  const weeks = [];
  for (let i = 0; i < totalCells; i++) {
    const dateStr = period.addDays(gridStart, i);
    const pm = dateStr.split('-').map(Number);
    const inMonth = pm[1] === month && pm[0] === year;
    const budgetCents = inMonth ? rules.dailyCentsOn(state, dateStr) : 0;
    const actualCents = inMonth ? byDay[dateStr] || 0 : 0;
    const delta = budgetCents - actualCents;

    let state2 = 'out';
    let level = 0;
    if (!inMonth) {
      state2 = 'out';
    } else if (dateStr > today) {
      state2 = 'future';
    } else if (budgetCents <= 0) {
      state2 = 'no-budget';
    } else if (delta >= 0) {
      state2 = 'surplus';
      // 盈余达到预算一半以上=较多（level2），否则较少（level1）
      level = delta * 2 >= budgetCents ? 2 : 1;
    } else {
      state2 = 'over';
      // 超支达到预算一半以上=明显（level2），否则轻微（level1）
      level = -delta * 2 >= budgetCents ? 2 : 1;
    }

    const cell = {
      day: pm[2],
      dateStr,
      inMonth,
      isToday: dateStr === today,
      budgetCents,
      actualCents,
      deltaCents: delta,
      state: state2,
      level,
    };
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(cell);
  }

  return {
    year,
    month,
    weekHeaders: WEEK_HEADERS,
    gridStart,
    leading,
    weeks,
  };
}

/**
 * 某一天的日详情（点击日历格的 Bottom Sheet 数据，只读）。
 * @param bills 账单数组
 * @param state budget rules state
 * @param dateStr
 * @param resolveCategory id → 分类对象（注入，保持纯函数；可传 store.getCategory）
 */
function buildDayDetail(bills, state, dateStr, resolveCategory) {
  const budgetCents = rules.dailyCentsOn(state, dateStr);
  const enabled = rules.isEnabledOn(state, dateStr);
  const dayBills = (bills || []).filter((b) => core.consumesBudget(b) && core.billLocalDate(b) === dateStr);

  let actualCents = 0;
  const catMap = {};
  dayBills.forEach((b) => {
    actualCents += b.amountCents;
    if (!catMap[b.categoryId]) catMap[b.categoryId] = { categoryId: b.categoryId, cents: 0 };
    catMap[b.categoryId].cents += b.amountCents;
  });

  const categories = Object.keys(catMap).map((cid) => {
    const cat = resolveCategory ? resolveCategory(cid) : null;
    return {
      categoryId: cid,
      name: cat && cat.name ? cat.name : '其他',
      emoji: cat && cat.emoji ? cat.emoji : '📦',
      cents: catMap[cid].cents,
    };
  }).sort((a, c) => c.cents - a.cents);

  const deltaCents = budgetCents - actualCents;

  return {
    dateStr,
    enabled,
    budgetCents,
    actualCents,
    deltaCents,
    hasBudget: budgetCents > 0,
    categories,
    billCount: dayBills.length,
    bills: dayBills,
  };
}

module.exports = {
  WEEK_HEADERS,
  daysInMonth,
  buildMonthCalendar,
  buildDayDetail,
};
