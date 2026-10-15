// components/statistics-panel/statistics-panel.js
// 统计 Panel V1（v0.3.0）：月度 / 年度切换，纯 WXSS 柱图 / 条形图。
// 计算全部走 data/statistics 纯函数，页面只负责取数与展示；不引图表库。
const store = require('../../data/index');
const money = require('../../data/money');
const M = require('../../data/statistics/month');
const Y = require('../../data/statistics/year');

function currentYM() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function shiftYM(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/** 账单 → 分类明细列表项（点击排行时弹） */
function toCatItems(bills, catId) {
  return bills
    .filter((b) => b.categoryId === catId && b.ledgerImpact !== 'daily-value-only')
    .slice()
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .map((b) => {
      const d = new Date(b.occurredAt);
      return {
        id: b.id,
        date: d.getMonth() + 1 + '月' + d.getDate() + '日',
        amountText: (b.type === 'expense' ? '-' : '+') + money.formatCents(b.amountCents),
        isExpense: b.type === 'expense',
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
    // 分类明细弹层
    catDetail: { show: false, title: '', items: [] },
  },
  lifetimes: {
    attached() {
      this.loadMonth(currentYM());
    },
  },
  methods: {
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
      const [y, m] = ym.split('-').map(Number);
      const ov = M.computeMonthOverview(bills);
      const daily = M.computeDailyExpenseTrend(bills, y, m).points;
      const rank = M.computeCategoryRanking(bills, store.getCategory.bind(store)).top.map((x) => ({
        ...x,
        centsText: money.formatCents(x.cents),
      }));
      const cmp = M.computeIncomeExpenseCompare(bills);
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
      });
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
      const ov = Y.computeYearOverview(bills, year);
      const monthly = Y.computeMonthlyTrend(bills, year).points;
      const ext = Y.computeExpenseExtremes(bills, year);
      const yearRank = Y.computeYearCategoryRanking(bills, store.getCategory.bind(store)).top.map((x) => ({
        ...x,
        centsText: money.formatCents(x.cents),
      }));
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
      });
    },
    onPrevYear() {
      this.loadYear(this.data.year - 1);
    },
    onNextYear() {
      if (!this.data.canNextYear) return;
      this.loadYear(this.data.year + 1);
    },
    /* ---------- 分类明细弹层 ---------- */
    onTapMonthCat(e) {
      const catId = e.currentTarget.dataset.id;
      const bills = store.rangeBills(this.data.ym, this.data.ym);
      const items = toCatItems(bills, catId);
      const title = (store.getCategory(catId).name || '分类') + ' · ' + this.data.monthLabel;
      this.setData({ catDetail: { show: true, title, items } });
    },
    onTapYearCat(e) {
      const catId = e.currentTarget.dataset.id;
      const bills = store.rangeBills(this.data.year + '-01', this.data.year + '-12');
      const items = toCatItems(bills, catId);
      const title = (store.getCategory(catId).name || '分类') + ' · ' + this.data.year + '年';
      this.setData({ catDetail: { show: true, title, items } });
    },
    onCloseCat() {
      this.setData({ 'catDetail.show': false });
    },
    noop() {
      /* 阻止明细弹层内部点击冒泡到遮罩 */
    },
  },
});
