// components/statistics-panel/statistics-panel.js
// 统计 Panel：本阶段仅基础月度数字 + 高质量 Glass 空态（图表后续版本）。
const db = require('../../utils/db.js');
const util = require('../../utils/util.js');

Component({
  data: {
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
    loadData() {
      const now = new Date();
      const monthPrefix = util.formatDate(now).substring(0, 7);
      const monthLabel = now.getFullYear() + '年' + (now.getMonth() + 1) + '月';
      const all = db.getAllRecords();
      const monthBills = all.filter((r) => (r.date || '').indexOf(monthPrefix) === 0);
      let expense = 0;
      let income = 0;
      monthBills.forEach((r) => {
        if (r.type === 'income') income += Number(r.amount) || 0;
        else expense += Number(r.amount) || 0;
      });
      this.setData({
        monthLabel,
        monthExpense: util.formatMoney(expense),
        monthIncome: util.formatMoney(income),
      });
    },
  },
});
