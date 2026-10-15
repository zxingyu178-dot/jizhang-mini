// components/accounting-panel/accounting-panel.js
// 记账 Panel：月份标题 + 本月支出/收入/结余 + 按天分组账单列表。
// 数据来自正式本地数据层（data/index，Bill V1 / 整数分 / 月份分片）。
const store = require('../../data/index');
const money = require('../../data/money');

function currentYM() {
  const d = new Date();
  const m = d.getMonth() + 1;
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : '' + m);
}

Component({
  data: {
    ym: '',
    monthLabel: '',
    monthExpense: '0.00',
    monthIncome: '0.00',
    monthBalance: '0.00',
    groups: [],
    isEmpty: true,
    canNext: false,
  },
  lifetimes: {
    attached() {
      this.loadData();
    },
  },
  methods: {
    /** 供父页面在新增/导入后调用刷新 */
    refresh() {
      this.loadData();
    },
    /** 切换月份（M3 月份切换使用）；不传则读当前/当月 */
    loadData(ym) {
      const target = ym || this.data.ym || currentYM();
      const parts = target.split('-');
      const monthLabel = parts[0] + '年' + Number(parts[1]) + '月';

      const summary = store.monthSummary(target);
      const grouped = store.monthGrouped(target);

      const groups = grouped.map((g) => ({
        date: g.label,
        dateLabel: g.label,
        dayExpense: money.formatCents(g.expense),
        dayIncome: money.formatCents(g.income),
        records: g.bills.map((b) => {
          const cat = store.getCategory(b.categoryId);
          const isExp = b.type === 'expense';
          return {
            id: b.id,
            emoji: cat.emoji,
            name: b.merchant || cat.name,
            note: b.note,
            amountText: (isExp ? '-' : '+') + money.formatCents(b.amountCents),
            isExpense: isExp,
          };
        }),
      }));

      this.setData({
        ym: target,
        monthLabel,
        monthExpense: money.formatCents(summary.expense),
        monthIncome: money.formatCents(summary.income),
        monthBalance: money.formatCents(summary.balance),
        groups,
        isEmpty: summary.count === 0,
        canNext: target < currentYM(),
      });
    },
    /** 上一月 */
    onPrevMonth() {
      const [y, m] = this.data.ym.split('-').map(Number);
      const d = new Date(y, m - 2, 1);
      const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      this.loadData(ym);
    },
    /** 下一月（不超过当前月） */
    onNextMonth() {
      if (!this.data.canNext) return;
      const [y, m] = this.data.ym.split('-').map(Number);
      const d = new Date(y, m, 1);
      const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      this.loadData(ym);
    },
    onTapBill(e) {
      // M3：打开账单详情/编辑 Bottom Sheet
      const id = e.currentTarget.dataset.id;
      this.triggerEvent('tapbill', { id });
    },
  },
});
