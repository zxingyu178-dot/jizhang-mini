// components/statistics-panel/statistics-panel.js
// 统计 Panel V1（v0.3.0）：月度 / 年度切换，纯 WXSS 柱图 / 条形图。
// 计算全部走 data/statistics 纯函数，页面只负责取数与展示；不引图表库。
const store = require('../../data/index');
const money = require('../../data/money');
const util = require('../../utils/util');
const M = require('../../data/statistics/month');
const Y = require('../../data/statistics/year');
const R = require('../../data/statistics/range');
const dateUtil = require('../../data/date');

function currentYM() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function shiftYM(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
/** 'YYYY-MM-DD' → 当日起始/结束时间戳（v1.1.1 起复用 data/date，结束含 999ms） */
function dayStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return dateUtil.startOfLocalDay(y, m, d);
}
function dayEnd(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return dateUtil.endOfLocalDay(y, m, d);
}

// 柱区可用高度（rpx）：容器高 - 标签高 - 少量顶部间隙。固定值，避免 height:% 解析问题。
var BAR_ZONE_DAILY_RPX = 180; // 220(容器) - 34(标签) - 6(间隙)
var BAR_ZONE_MONTH_RPX = 200; // 240(容器) - 34(标签) - 6(间隙)
function withBarHeight(points, zoneRpx) {
  return points.map((p) => Object.assign({}, p, {
    barHeightRpx: Math.round((p.percent / 100) * zoneRpx),
  }));
}

/** 账单 → 分类明细列表项（点击支出排行时弹；只含该分类支出，收入不混入） */
function toCatItems(bills, catId) {
  return M.listCategoryExpenseBills(bills, catId).map((b) => {
    const d = new Date(b.occurredAt);
    return {
      id: b.id,
      date: d.getMonth() + 1 + '月' + d.getDate() + '日',
      amountText: '-' + money.formatCents(b.amountCents),
      isExpense: true,
      note: b.note || b.merchant || '',
    };
  });
}

Component({
  data: {
    mode: 'month', // month | year
    // 月度
    ym: '',
    monthLabel: '',
    canNextMonth: false,
    mExpense: '0.00',
    mIncome: '0.00',
    mBalance: '0.00',
    daily: [],
    rank: [],
    cmp: { income: '0.00', expense: '0.00', incomeBar: 0, expenseBar: 0 },
    // 预算日历 + 节奏摘要（无任何预算规则时显示轻空态）
    budgetCalendar: null,
    budgetEmpty: false,
    pace: [],
    // 年度
    year: 0,
    canNextYear: false,
    yExpense: '0.00',
    yIncome: '0.00',
    yBalance: '0.00',
    yCount: 0,
    yAvg: '0.00',
    highest: '',
    lowest: '',
    monthly: [],
    yearRank: [],
    // 自定义日期统计（月度区域）
    crStart: '',
    crEnd: '',
    crMaxStart: '2099-12-31',
    crMaxEnd: '2099-12-31',
    crStats: null, // {expense, income, balance, count}
    crInvalid: false, // 开始晚于结束
    // 年度回顾再补三项（Gate 5）
    yrLargest: null, // {dateLabel, title, amountText}
    yrLargestId: '',
    yrTopCat: null, // {name, emoji, count}
    yrTopMonth: null, // {label, count}
  },
  lifetimes: {
    attached() {
      // 不在此加载：组件位于 swiper-item 中，未激活时其布局尺寸未就绪，
      // 此时取数会让柱状图首次渲染异常。等 main 在该 item 首次激活时调用 activate()。
    },
  },
  methods: {
    /** 由 main 在 swiper-item 首次激活时调用；仅首次执行初始取数 */
    activate() {
      if (this._activated) return;
      this._activated = true;
      // 等 swiper 切换动画结束、布局稳定后再取数，确保图表能正常渲染
      setTimeout(() => {
        if (this.data.mode === 'year') this.loadYear(this.data.year || new Date().getFullYear());
        else this.loadMonth(this.data.ym || currentYM());
      }, 220);
    },
    refresh() {
      if (this.data.mode === 'year') this.loadYear(this.data.year);
      else this.loadMonth(this.data.ym);
    },
    /* ---------- 模式切换 ---------- */
    onModeMonth() {
      if (this.data.mode === 'month') return;
      this.setData({ mode: 'month' });
      this.loadMonth(this.data.ym || currentYM());
    },
    onModeYear() {
      if (this.data.mode === 'year') return;
      this.setData({ mode: 'year' });
      this.loadYear(this.data.year || new Date().getFullYear());
    },
    /* ---------- 月度取数 ---------- */
    loadMonth(ym) {
      const bills = store.rangeBills(ym, ym);
      const resolveCategory = store.getCategoryResolver(); // 单次渲染快照
      const [y, m] = ym.split('-').map(Number);
      const ov = M.computeMonthOverview(bills);
      const daily = withBarHeight(M.computeDailyExpenseTrend(bills, y, m).points, BAR_ZONE_DAILY_RPX);
      const rank = M.computeCategoryRanking(bills, resolveCategory).top.map((x) => ({
        ...x,
        centsText: money.formatCents(x.cents),
      }));
      const cmp = M.computeIncomeExpenseCompare(bills);

      // 预算日历地图 + 节奏摘要：
      //  从未设置过预算规则 → 轻空态（不再显示整页灰色日历）；
      //  存在过规则 → 规则历史逐天取数（无预算日格子灰色）。
      const today = util.formatDate(new Date());
      const hasBudgetRules = store.getBudgetState().rules.length > 0;
      // 自定义日期统计：首次默认当月 1 日 ~ 今天，之后保留用户选择
      let crStart = this.data.crStart;
      let crEnd = this.data.crEnd;
      if (!crStart || !crEnd) {
        crStart = ym + '-01';
        crEnd = today;
      }
      const cr = this.buildCustomRange(crStart, crEnd);
      let budgetCalendar = null;
      let pace = [];
      if (hasBudgetRules) {
        budgetCalendar = store.buildBudgetCalendar(y, m, today);
        // 节奏摘要随所选月份走：当前月=本周/本月截至今日+上周/上月；
        // 历史月=本月/上月最终结果（不再错误显示今天的「截至今日」数据）。
        const paceCtx = store.buildBudgetMonthPace(y, m, today);
        pace = paceCtx.items.map((p) => ({
          label: p.label,
          text: (p.delta >= 0 ? '+' : '-') + '¥' + money.formatCents(Math.abs(p.delta)),
          positive: p.delta >= 0,
          hasBudget: p.hasBudget,
        }));
      }

      this.setData({
        ym,
        monthLabel: y + '年' + m + '月',
        canNextMonth: ym < currentYM(),
        mExpense: money.formatCents(ov.expense),
        mIncome: money.formatCents(ov.income),
        mBalance: money.formatCents(ov.balance),
        daily,
        rank,
        cmp: {
          income: money.formatCents(cmp.income),
          expense: money.formatCents(cmp.expense),
          incomeBar: cmp.incomeBar,
          expenseBar: cmp.expenseBar,
        },
        budgetCalendar,
        budgetEmpty: !hasBudgetRules,
        pace,
        crStart,
        crEnd,
        crStats: cr.crStats,
        crInvalid: cr.crInvalid,
      });
    },
    /* ---------- 自定义日期统计 ---------- */
    /** 由起止日期字符串计算范围统计；开始晚于结束 → 无效（不偷偷交换） */
    buildCustomRange(crStart, crEnd) {
      if (!crStart || !crEnd) return { crStats: null, crInvalid: false };
      // 'YYYY-MM-DD' 字典序即时间序，可直接比较
      if (crStart > crEnd) return { crStats: null, crInvalid: true };
      const stats = R.computeRangeStats(store.rangeBills(), dayStart(crStart), dayEnd(crEnd));
      return {
        crStats: {
          expense: money.formatCents(stats.expense),
          income: money.formatCents(stats.income),
          balance: money.formatCents(stats.balance),
          count: stats.count,
        },
        crInvalid: false,
      };
    },
    onCrStart(e) {
      const crStart = e.detail.value;
      const cr = this.buildCustomRange(crStart, this.data.crEnd);
      this.setData({ crStart, crStats: cr.crStats, crInvalid: cr.crInvalid });
    },
    onCrEnd(e) {
      const crEnd = e.detail.value;
      const cr = this.buildCustomRange(this.data.crStart, crEnd);
      this.setData({ crEnd, crStats: cr.crStats, crInvalid: cr.crInvalid });
    },
    onPrevMonth() {
      this.loadMonth(shiftYM(this.data.ym, -1));
    },
    onNextMonth() {
      if (!this.data.canNextMonth) return;
      this.loadMonth(shiftYM(this.data.ym, 1));
    },
    /* ---------- 年度取数 ---------- */
    loadYear(year) {
      const bills = store.rangeBills(year + '-01', year + '-12');
      const resolveCategory = store.getCategoryResolver(); // 单次渲染快照
      const ov = Y.computeYearOverview(bills, year);
      const monthly = withBarHeight(Y.computeMonthlyTrend(bills, year).points, BAR_ZONE_MONTH_RPX);
      const ext = Y.computeExpenseExtremes(bills, year);
      const yearRank = Y.computeYearCategoryRanking(bills, resolveCategory).top.map((x) => ({
        ...x,
        centsText: money.formatCents(x.cents),
      }));
      // 年度回顾再补三项（Gate 5）
      const largestBill = Y.findLargestExpense(bills);
      let yrLargest = null;
      let yrLargestId = '';
      if (largestBill) {
        const ld = new Date(largestBill.occurredAt);
        const lcat = resolveCategory(largestBill.categoryId);
        yrLargest = {
          dateLabel: ld.getMonth() + 1 + '月' + ld.getDate() + '日',
          title: largestBill.title || largestBill.merchant || lcat.name || '支出',
          amountText: '¥' + money.formatCents(largestBill.amountCents),
        };
        yrLargestId = largestBill.id;
      }
      const topCat = Y.findMostRecordedCategory(bills, resolveCategory);
      const yrTopCat = topCat
        ? { categoryId: topCat.categoryId, name: topCat.name, emoji: topCat.emoji, count: topCat.count }
        : null;
      const topMonth = Y.findMostActiveMonth(bills);
      const yrTopMonth = topMonth ? { label: topMonth.month + '月', month: topMonth.month, count: topMonth.count } : null;
      this.setData({
        year,
        canNextYear: year < new Date().getFullYear(),
        yExpense: money.formatCents(ov.expense),
        yIncome: money.formatCents(ov.income),
        yBalance: money.formatCents(ov.balance),
        yCount: ov.count,
        yAvg: money.formatCents(ov.monthlyAvg),
        highest: ext.highest ? ext.highest.month + '月 · ¥' + money.formatCents(ext.highest.expense) : '—',
        lowest: ext.lowest ? ext.lowest.month + '月 · ¥' + money.formatCents(ext.lowest.expense) : '—',
        monthly,
        yearRank,
        yrLargest,
        yrLargestId,
        yrTopCat,
        yrTopMonth,
      });
    },
    onPrevYear() {
      this.loadYear(this.data.year - 1);
    },
    onNextYear() {
      if (!this.data.canNextYear) return;
      this.loadYear(this.data.year + 1);
    },
    /* ---------- 年度回顾三项点击（Gate 5） ---------- */
    /** 最大单笔支出：直接打开该账单编辑（交由 main 复用 bill-form） */
    onTapYrLargest() {
      if (!this.data.yrLargestId) return;
      this.triggerEvent('openbill', { id: this.data.yrLargestId });
    },
    /** 记录最多分类：钻取该年 + 该分类（Bill Explorer） */
    onTapYrTopCat() {
      const c = this.data.yrTopCat;
      if (!c) return;
      wx.navigateTo({
        url: '/pages/search/search?year=' + this.data.year + '&category=' + c.categoryId,
      });
    },
    /** 最常消费月份：钻取该月（Bill Explorer） */
    onTapYrTopMonth() {
      const m = this.data.yrTopMonth;
      if (!m) return;
      const mm = String(m.month).padStart(2, '0');
      wx.navigateTo({
        url: '/pages/search/search?month=' + this.data.year + '-' + mm,
      });
    },
    /** 空态：前往预算设置页 */
    onBudgetSettings() {
      wx.navigateTo({ url: '/pages/budget-settings/budget-settings' });
    },
    /* ---------- 预算日详情：组装数据后交由 main 页面弹层（只读） ---------- */
    onTapDay(e) {
      const dateStr = e.currentTarget.dataset.date;
      if (!dateStr) return;
      const today = util.formatDate(new Date());
      // 未来日不打开详情（只读，无预算盈亏）
      if (dateStr > today) return;
      const d = store.buildBudgetDayDetail(dateStr);
      const resolveDayCategory = store.getCategoryResolver(); // 单次详情快照
      const dp = dateStr.split('-').map(Number);
      const title = dp[1] + '月' + dp[2] + '日';
      const payload = {
        title,
        hasBudget: d.hasBudget,
        budgetText: '¥' + money.formatCents(d.budgetCents),
        actualText: '¥' + money.formatCents(d.actualCents),
        delta: d.deltaCents,
        deltaLabel: d.deltaCents >= 0 ? '盈余' : '超支',
        deltaText:
          (d.deltaCents >= 0 ? '+' : '-') + '¥' + money.formatCents(Math.abs(d.deltaCents)),
        categories: d.categories.map((c) => ({
          categoryId: c.categoryId,
          name: c.name,
          emoji: c.emoji,
          centsText: '¥' + money.formatCents(c.cents),
        })),
        bills: d.bills.map((b) => {
          const cat = resolveDayCategory(b.categoryId);
          return {
            id: b.id,
            name: b.title || b.merchant || cat.name || '支出',
            amountText: '¥' + money.formatCents(b.amountCents),
          };
        }),
        billCount: d.billCount,
      };
      this.triggerEvent('daydetail', payload);
    },
    /* ---------- 分类明细：组装数据后交由 main 页面弹层展示 ----------
       （弹层需在页面级 fixed，组件内 fixed 会相对 swiper-item 定位错乱） */
    onTapMonthCat(e) {
      const catId = e.currentTarget.dataset.id;
      const bills = store.rangeBills(this.data.ym, this.data.ym);
      const items = toCatItems(bills, catId);
      const title = (store.getCategory(catId).name || '分类') + ' · ' + this.data.monthLabel;
      // 携带钻取上下文，供弹层「查看全部」跳到 Bill Explorer
      this.triggerEvent('categorydetail', {
        title, items, scope: 'month', categoryId: catId, ym: this.data.ym,
      });
    },
    onTapYearCat(e) {
      const catId = e.currentTarget.dataset.id;
      const bills = store.rangeBills(this.data.year + '-01', this.data.year + '-12');
      const items = toCatItems(bills, catId);
      const title = (store.getCategory(catId).name || '分类') + ' · ' + this.data.year + '年';
      this.triggerEvent('categorydetail', {
        title, items, scope: 'year', categoryId: catId, year: this.data.year,
      });
    },
    /** 年度 12 月趋势：点某个月柱 → Bill Explorer 该月全部账单 */
    onTapMonthBar(e) {
      const m = Number(e.currentTarget.dataset.month);
      if (!m) return;
      const ym = this.data.year + '-' + String(m).padStart(2, '0');
      wx.navigateTo({ url: '/pages/search/search?month=' + ym });
    },
  },
});
