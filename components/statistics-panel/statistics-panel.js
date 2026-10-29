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
const statCfg = require('../../data/statistics/config');
const donut = require('../../data/statistics/donut');
const { pickCategoryVisual } = require('../../data/category-icons');

/** 模块 ID → 中文展示名（管理 Bottom Sheet 用） */
const MODULE_LABELS = {
  'category-share': '分类占比',
  'daily-expense-trend': '每日花费趋势',
  'cumulative-trend': '累计消费趋势',
  'budget-analysis': '预算分析',
  'income-expense-compare': '收入 / 支出对比',
  'custom-range': '自定义日期统计',
  'year-monthly-trend': '12 个月支出趋势',
  'year-review': '年度回顾',
};

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
/** 'YYYY-MM' → 该月最后一天 'YYYY-MM-DD'（处理闰年 / 大小月） */
function lastDateOfYM(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return ym + '-' + String(last).padStart(2, '0');
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
    // Hero V2 摘要（v1.3.0）：记录数 / 最高消费日 / 日均支出
    mCount: 0,
    mTopDay: '—',
    mTopDayAmount: '—',
    mDailyAvg: '—',
    // 月度最大单笔（独立卡，点击打开账单编辑）
    mLargest: null,
    mLargestId: '',
    // 分类占比（category-donut + 列表；列表点击钻取 Bill Explorer）
    shareSegments: [],
    shareList: [],
    shareAggregated: false,
    shareExpanded: false,
    fullShareList: [],
    shareSelectedId: '', // 圆环 / 图例选中的分类 id（聚合为 AGGREGATE id）
    shareAggCount: 0, // 聚合「其他」包含的真实分类数
    daily: [],
    // 累计消费趋势（cumulative-trend，默认关闭）
    cumPoints: [],
    cumMax: 0,
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
    // 全年分类占比（复用 category-donut，使用完整年度分类列表）
    yearShareSegments: [],
    yearShareList: [],
    yearShareAggregated: false,
    yearShareExpanded: false,
    yearFullShareList: [],
    yearShareSelectedId: '',
    yearShareAggCount: 0,
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
    // 模块定制（Gate 3）
    showManage: false,
    enabledModules: [], // 当前启用模块 ID
    modMap: {}, // 模块 ID → 是否启用（WXML 条件用）
    moduleRows: [], // 管理弹层行 {id,label,checked,scope}
    scrollInto: '', // 临时滚动定位（GUI 验证用）
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
      // 与 activate 一致地兜底：组件可能尚未激活（data.ym 仍为空串），
      // 直接 loadMonth('') 会解析出 NaN 年月，需回退到当前月 / 当前年。
      if (this.data.mode === 'year') this.loadYear(this.data.year || new Date().getFullYear());
      else this.loadMonth(this.data.ym || currentYM());
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
    /* ---------- 月度取数（Lazy Compute：关闭的可选模块不计算） ---------- */
    loadMonth(ym) {
      const bills = store.rangeBills(ym, ym);
      const resolveCategory = store.getCategoryResolver(); // 单次渲染快照
      const [y, m] = ym.split('-').map(Number);
      const config = store.getSettings().statistics;
      const on = (id) => statCfg.isEnabled(config, id);
      const toShareRow = (x) => Object.assign({}, x, { centsText: money.formatCents(x.cents) });

      // —— 强制保留：Hero 概览 ——
      const ov = M.computeMonthOverview(bills);
      // Hero V2 摘要：最高消费日 / 日均支出（均从当月 normal 账单现算，不新增存储）
      const topDay = M.findTopExpenseDay(bills, y, m);
      const dailyAvgCents = M.computeDailyAverageExpense(bills, y, m, new Date());
      // —— 强制保留：月度最大单笔（独立卡，点击 triggerEvent openbill） ——
      const largestBill = M.findLargestExpense(bills);
      let mLargest = null;
      let mLargestId = '';
      if (largestBill) {
        const lcat = resolveCategory(largestBill.categoryId);
        const ld = new Date(largestBill.occurredAt);
        mLargest = Object.assign(
          {
            title: largestBill.title || largestBill.merchant || lcat.name || '支出',
            dateLabel: ld.getMonth() + 1 + '-' + ld.getDate(),
            amountText: '¥' + money.formatCents(largestBill.amountCents),
          },
          pickCategoryVisual(lcat)
        );
        mLargestId = largestBill.id;
      }

      const patch = {
        ym,
        monthLabel: y + '年' + m + '月',
        canNextMonth: ym < currentYM(),
        mExpense: money.formatCents(ov.expense),
        mIncome: money.formatCents(ov.income),
        mBalance: money.formatCents(ov.balance),
        mCount: ov.count,
        mTopDay: topDay ? topDay.day + '日' : '—',
        mTopDayAmount: topDay ? '¥' + money.formatCents(topDay.cents) : '—',
        mDailyAvg: '¥' + money.formatCents(dailyAvgCents),
        mLargest,
        mLargestId,
        enabledModules: config.modules.slice(),
        modMap: config.modules.reduce((acc, id) => { acc[id] = true; return acc; }, {}),
      };

      // —— 分类占比（category-share） ——
      patch.shareSelectedId = ''; // 切月重置选中
      if (on('category-share')) {
        const share = M.computeCategoryShare(bills, resolveCategory);
        // 圆环与图例同一套颜色解析，保证颜色完全一致
        const colored = donut.resolveSegmentColors(share.segments);
        const fullColored = donut.resolveSegmentColors(share.all);
        patch.shareSegments = colored;
        patch.shareList = colored.map(toShareRow);
        patch.shareAggregated = share.aggregated;
        patch.shareExpanded = false;
        patch.fullShareList = fullColored.map(toShareRow);
        patch.shareAggCount = share.aggregated ? share.all.length - M.TOP_N_WHEN_AGGREGATED : 0;
      } else {
        // 关闭：清空，避免显示上次旧结果
        patch.shareSegments = [];
        patch.shareList = [];
        patch.fullShareList = [];
        patch.shareAggregated = false;
        patch.shareExpanded = false;
        patch.shareAggCount = 0;
      }

      // —— 每日花费趋势（daily-expense-trend） ——
      patch.daily = on('daily-expense-trend')
        ? withBarHeight(M.computeDailyExpenseTrend(bills, y, m).points, BAR_ZONE_DAILY_RPX)
        : [];

      // —— 累计消费趋势（cumulative-trend，默认关闭） ——
      if (on('cumulative-trend')) {
        const cum = M.computeCumulativeTrend(bills, y, m);
        patch.cumPoints = cum.points;
        patch.cumMax = cum.max;
      } else {
        patch.cumPoints = [];
        patch.cumMax = 0;
      }

      // —— 收入 / 支出对比（income-expense-compare） ——
      if (on('income-expense-compare')) {
        const cmp = M.computeIncomeExpenseCompare(bills);
        patch.cmp = {
          income: money.formatCents(cmp.income),
          expense: money.formatCents(cmp.expense),
          incomeBar: cmp.incomeBar,
          expenseBar: cmp.expenseBar,
        };
      } else {
        patch.cmp = { income: '0.00', expense: '0.00', incomeBar: 0, expenseBar: 0 };
      }

      // —— 预算分析（budget-analysis） ——
      const today = util.formatDate(new Date());
      const hasBudgetRules = store.getBudgetState().rules.length > 0;
      patch.budgetEmpty = !hasBudgetRules;
      if (on('budget-analysis') && hasBudgetRules) {
        patch.budgetCalendar = store.buildBudgetCalendar(y, m, today);
        // 节奏摘要随所选月份走：当前月=本周/本月截至今日+上周/上月；历史月=本月/上月最终。
        const paceCtx = store.buildBudgetMonthPace(y, m, today);
        patch.pace = paceCtx.items.map((p) => ({
          label: p.label,
          text: (p.delta >= 0 ? '+' : '-') + '¥' + money.formatCents(Math.abs(p.delta)),
          positive: p.delta >= 0,
          hasBudget: p.hasBudget,
        }));
      } else {
        patch.budgetCalendar = null;
        patch.pace = [];
      }

      // —— 自定义日期统计（custom-range，默认关闭） ——
      if (on('custom-range')) {
        let crStart = this.data.crStart;
        let crEnd = this.data.crEnd;
        if (!crStart || !crEnd) {
          // 首次：当前月=1 日~今天；历史月=1 日~该月最后一天
          crStart = ym + '-01';
          crEnd = ym === today.slice(0, 7) ? today : lastDateOfYM(ym);
        }
        const cr = this.buildCustomRange(crStart, crEnd);
        patch.crStart = crStart;
        patch.crEnd = crEnd;
        patch.crStats = cr.crStats;
        patch.crInvalid = cr.crInvalid;
      } else {
        // 关闭：清空统计结果（保留已选日期，重新开启时恢复）
        patch.crStats = null;
        patch.crInvalid = false;
      }

      this.setData(patch);
    },
    /* ---------- 自定义日期统计 ---------- */
    /** 由起止日期字符串计算范围统计；开始晚于结束 → 无效（不偷偷交换） */
    buildCustomRange(crStart, crEnd) {
      if (!crStart || !crEnd) return { crStats: null, crInvalid: false };
      // 'YYYY-MM-DD' 字典序即时间序，可直接比较
      if (crStart > crEnd) return { crStats: null, crInvalid: true };
      // 只读取覆盖该日期范围的月份分片（crStart/crEnd 所在月），不再全历史读取
      const ymStart = crStart.slice(0, 7);
      const ymEnd = crEnd.slice(0, 7);
      const stats = R.computeRangeStats(store.rangeBills(ymStart, ymEnd), dayStart(crStart), dayEnd(crEnd));
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
    /* ---------- 年度取数（Lazy Compute：年度可选模块按开关计算） ---------- */
    loadYear(year) {
      const bills = store.rangeBills(year + '-01', year + '-12');
      const resolveCategory = store.getCategoryResolver(); // 单次渲染快照
      const config = store.getSettings().statistics;
      const on = (id) => statCfg.isEnabled(config, id);

      // —— 强制保留：年度 Hero ——
      const ov = Y.computeYearOverview(bills, year);
      const ext = Y.computeExpenseExtremes(bills, year);
      const yearRank = Y.computeYearCategoryRanking(bills, resolveCategory).top.map((x) => ({
        ...x,
        centsText: money.formatCents(x.cents),
      }));

      const patch = {
        year,
        canNextYear: year < new Date().getFullYear(),
        yExpense: money.formatCents(ov.expense),
        yIncome: money.formatCents(ov.income),
        yBalance: money.formatCents(ov.balance),
        yCount: ov.count,
        yAvg: money.formatCents(ov.monthlyAvg),
        highest: ext.highest ? ext.highest.month + '月 · ¥' + money.formatCents(ext.highest.expense) : '—',
        lowest: ext.lowest ? ext.lowest.month + '月 · ¥' + money.formatCents(ext.lowest.expense) : '—',
        yearRank,
        enabledModules: config.modules.slice(),
        modMap: config.modules.reduce((acc, id) => { acc[id] = true; return acc; }, {}),
      };

      // —— 12 个月支出趋势（year-monthly-trend） ——
      patch.monthly = on('year-monthly-trend')
        ? withBarHeight(Y.computeMonthlyTrend(bills, year).points, BAR_ZONE_MONTH_RPX)
        : [];

      // —— 年度回顾（year-review）：最大单笔 / 记录最多分类 / 最常消费月 ——
      if (on('year-review')) {
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
          ? {
              categoryId: topCat.categoryId,
              name: topCat.name,
              emoji: topCat.emoji,
              iconType: topCat.iconType,
              iconValue: topCat.iconValue,
              count: topCat.count,
            }
          : null;
        const topMonth = Y.findMostActiveMonth(bills);
        const yrTopMonth = topMonth
          ? { label: topMonth.month + '月', month: topMonth.month, count: topMonth.count }
          : null;
        patch.yrLargest = yrLargest;
        patch.yrLargestId = yrLargestId;
        patch.yrTopCat = yrTopCat;
        patch.yrTopMonth = yrTopMonth;
      } else {
        patch.yrLargest = null;
        patch.yrLargestId = '';
        patch.yrTopCat = null;
        patch.yrTopMonth = null;
      }

      // —— 全年分类占比（固定模块：复用 category-donut，使用完整年度分类列表） ——
      patch.yearShareSelectedId = ''; // 切年重置选中
      const yearShare = M.computeCategoryShare(bills, resolveCategory);
      const toYearShareRow = (x) => Object.assign({}, x, { centsText: money.formatCents(x.cents) });
      const yColored = donut.resolveSegmentColors(yearShare.segments);
      const yFullColored = donut.resolveSegmentColors(yearShare.all);
      patch.yearShareSegments = yColored;
      patch.yearShareList = yColored.map(toYearShareRow);
      patch.yearShareAggregated = yearShare.aggregated;
      patch.yearShareExpanded = false;
      patch.yearFullShareList = yFullColored.map(toYearShareRow);
      patch.yearShareAggCount = yearShare.aggregated
        ? yearShare.all.length - M.TOP_N_WHEN_AGGREGATED
        : 0;

      this.setData(patch);
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
          iconType: c.iconType,
          iconValue: c.iconValue,
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
    /** 年度钻取公共逻辑：真实分类 → Bill Explorer 该年该分类支出；聚合 → 展开列表 */
    drillYearShare(segment) {
      if (!segment) return;
      if (segment.aggregate || segment.categoryId === M.AGGREGATE_OTHER_ID) {
        this.setData({ yearShareExpanded: true });
        return;
      }
      wx.navigateTo({
        url: '/pages/search/search?year=' + this.data.year + '&category=' + segment.categoryId + '&type=expense',
      });
    },
    /** 全年分类占比行点击 */
    onTapYearShareRow(e) {
      this.drillYearShare({
        categoryId: e.currentTarget.dataset.id,
        aggregate: !!e.currentTarget.dataset.agg,
      });
    },
    /** 年度圆环选中分段：同步图例高亮（不跳转） */
    onYearDonutSelect(e) {
      const seg = e.detail.segment;
      if (!seg) return;
      this.setData({ yearShareSelectedId: seg.categoryId });
    },
    /** 年度圆环中心点击：执行钻取 */
    onYearDonutDrill(e) {
      this.drillYearShare(e.detail.segment);
    },
    /** 全年分类占比：查看全部 / 收起 */
    onToggleYearShareExpand() {
      this.setData({ yearShareExpanded: !this.data.yearShareExpanded });
    },
    /** 年度 12 月趋势：点某个月柱 → Bill Explorer 该月全部账单 */
    onTapMonthBar(e) {
      const m = Number(e.currentTarget.dataset.month);
      if (!m) return;
      const ym = this.data.year + '-' + String(m).padStart(2, '0');
      wx.navigateTo({ url: '/pages/search/search?month=' + ym });
    },
    /** 月度最大单笔：直接打开该账单编辑（main 已绑定 openbill 复用 bill-form） */
    onTapMonthLargest() {
      if (!this.data.mLargestId) return;
      this.triggerEvent('openbill', { id: this.data.mLargestId });
    },
    /** 月度钻取公共逻辑：真实分类 → Bill Explorer 当月该分类支出；聚合 → 展开列表 */
    drillMonthShare(segment) {
      if (!segment) return;
      if (segment.aggregate || segment.categoryId === M.AGGREGATE_OTHER_ID) {
        this.setData({ shareExpanded: true });
        return;
      }
      wx.navigateTo({
        url: '/pages/search/search?month=' + this.data.ym + '&category=' + segment.categoryId + '&type=expense',
      });
    },
    /** 分类占比行点击 */
    onTapShareRow(e) {
      this.drillMonthShare({
        categoryId: e.currentTarget.dataset.id,
        aggregate: !!e.currentTarget.dataset.agg,
      });
    },
    /** 月度圆环选中分段：同步图例高亮（不跳转） */
    onDonutSelect(e) {
      const seg = e.detail.segment;
      if (!seg) return;
      this.setData({ shareSelectedId: seg.categoryId });
    },
    /** 月度圆环中心点击：执行钻取 */
    onDonutDrill(e) {
      this.drillMonthShare(e.detail.segment);
    },
    /** 查看全部 / 收起完整分类列表 */
    onToggleShareExpand() {
      this.setData({ shareExpanded: !this.data.shareExpanded });
    },
    /* ---------- 统计模块管理（Gate 3） ---------- */
    /** 打开管理弹层：按当前模式组装模块行（月度 / 年度各一组） */
    onOpenManage() {
      const config = store.getSettings().statistics;
      const scope = this.data.mode === 'year' ? statCfg.YEARLY_MODULES : statCfg.MONTHLY_MODULES;
      const moduleRows = scope.map((id) => ({
        id,
        label: MODULE_LABELS[id] || id,
        checked: statCfg.isEnabled(config, id),
      }));
      this.setData({ showManage: true, moduleRows });
    },
    /** 关闭管理弹层 */
    onCloseManage() {
      this.setData({ showManage: false });
    },
    /** 开关某模块：更新配置 → 原子持久化 → 立即重新加载（真 Lazy Compute） */
    onToggleModule(e) {
      const id = e.currentTarget.dataset.id;
      const value = e.detail.value;
      const current = store.getSettings().statistics;
      const set = new Set(current.modules);
      if (value) set.add(id);
      else set.delete(id);
      // 按 VALID_MODULES 标准顺序输出，避免顺序漂移
      const ordered = statCfg.VALID_MODULES.filter((mid) => set.has(mid));
      const next = statCfg.withModules(ordered);
      store.updateSettings({ statistics: next });
      const moduleRows = this.data.moduleRows.map((r) =>
        r.id === id ? Object.assign({}, r, { checked: value }) : r
      );
      this.setData({ moduleRows, enabledModules: next.modules });
      if (this.data.mode === 'year') this.loadYear(this.data.year);
      else this.loadMonth(this.data.ym);
    },
    /** 恢复默认：持久化默认配置 → 刷新弹层行并重新加载 */
    onResetModules() {
      const def = statCfg.defaultConfig();
      store.updateSettings({ statistics: def });
      const moduleRows = this.data.moduleRows.map((r) =>
        Object.assign({}, r, { checked: statCfg.isEnabled(def, r.id) })
      );
      this.setData({ moduleRows, enabledModules: def.modules });
      if (this.data.mode === 'year') this.loadYear(this.data.year);
      else this.loadMonth(this.data.ym);
    },
  },
});
