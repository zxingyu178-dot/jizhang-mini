// components/statistics-panel/statistics-panel.js
// 统计 Panel：本阶段仅基础月度数字 + 高质量 Glass 空态（图表后续版本）。
// 数据来自正式本地数据层（Bill V1 / 整数分 / 月份分片）。
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
  },
  lifetimes: {
    attached() {
      this.loadData();
    },
  },
  methods: {
    refresh() {
      this.loadData();
    },
    loadData(ym) {
      const target = ym || this.data.ym || currentYM();
      const parts = target.split('-');
      const monthLabel = parts[0] + '年' + Number(parts[1]) + '月';
      const summary = store.monthSummary(target);
      this.setData({
        ym: target,
        monthLabel,
        monthExpense: money.formatCents(summary.expense),
        monthIncome: money.formatCents(summary.income),
      });
    },
  },
});
