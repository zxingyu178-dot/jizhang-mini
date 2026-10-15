// pages/stats/stats.js 统计页
const db = require('../../utils/db')
const util = require('../../utils/util')

Page({
  data: {
    type: 'expense',
    totalText: '0.00',
    items: [],
    isEmpty: true,
    types: [
      { value: 'expense', label: '支出' },
      { value: 'income', label: '收入' }
    ]
  },

  onShow() {
    this.loadData()
  },

  switchType(e) {
    this.setData({ type: e.currentTarget.dataset.type }, () => this.loadData())
  },

  loadData() {
    const all = db.getAllRecords()
    const { total, items } = db.categoryStats(all, this.data.type)
    const mapped = items.map((it) => ({
      value: it.value,
      label: it.label,
      emoji: it.emoji,
      amountText: util.formatMoney(it.amount),
      percentText: it.percent.toFixed(1),
      percent: it.percent
    }))
    this.setData({
      totalText: util.formatMoney(total),
      items: mapped,
      isEmpty: mapped.length === 0
    })
  }
})
