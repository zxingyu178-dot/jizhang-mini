// components/accounting-panel/accounting-panel.js
// 记账 Panel：月份标题 + 本月收支/结余 + 按天分组账单列表。
// PoC 阶段读取 Legacy wx.Storage（jm_records），M2 数据层完成后切换为正式 Bill V1。
const db = require('../../utils/db.js');
const util = require('../../utils/util.js');

Component({
  data: {
    monthLabel: '',
    monthExpense: '0.00',
    monthIncome: '0.00',
    monthBalance: '0.00',
    groups: [],
    isEmpty: true,
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

      const raw = db.groupByDate(monthBills);
      const groups = raw.map((g) => ({
        date: g.date,
        dateLabel: util.friendlyDate(g.date),
        dayExpense: g.expense.toFixed(2),
        dayIncome: g.income.toFixed(2),
        records: g.records.map((r) => {
          const cat = db.getCategory(r.type, r.category);
          const isExp = r.type === 'expense';
          return {
            id: r.id,
            emoji: cat.emoji,
            name: cat.label,
            note: r.note,
            amountText: (isExp ? '-' : '+') + util.formatMoney(r.amount),
            isExpense: isExp,
          };
        }),
      }));

      this.setData({
        monthLabel,
        monthExpense: util.formatMoney(expense),
        monthIncome: util.formatMoney(income),
        monthBalance: util.formatMoney(income - expense),
        groups,
        isEmpty: monthBills.length === 0,
      });
    },
  },
});
