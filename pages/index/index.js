// pages/index/index.js 明细页
const db = require('../../utils/db')
const util = require('../../utils/util')

Page({
  data: {
    month: '',
    groups: [],
    totalIncome: '0.00',
    totalExpense: '0.00',
    balance: '0.00',
    isEmpty: true
  },

  onShow() {
    // 每次切到该页都重新读取，确保记账后数据即时刷新
    this.loadData()
  },

  loadData() {
    const all = db.getAllRecords()
    const month = util.formatDate(new Date()).slice(0, 7) // YYYY-MM
    const monthRecords = all.filter((r) => (r.date || '').slice(0, 7) === month)
    const s = db.summary(monthRecords)

    const groups = db.groupByDate(all).map((g) => ({
      date: g.date,
      friendlyDate: util.friendlyDate(g.date),
      incomeText: util.formatMoney(g.income),
      expenseText: util.formatMoney(g.expense),
      showIncome: g.income > 0,
      showExpense: g.expense > 0,
      records: g.records.map((r) => {
        const cat = db.getCategory(r.type, r.category)
        return {
          id: r.id,
          type: r.type,
          emoji: cat.emoji,
          categoryLabel: cat.label,
          note: r.note,
          amountText: (r.type === 'income' ? '+' : '-') + util.formatMoney(r.amount)
        }
      })
    }))

    this.setData({
      month,
      groups,
      totalIncome: util.formatMoney(s.income),
      totalExpense: util.formatMoney(s.expense),
      balance: util.formatMoney(s.balance),
      isEmpty: all.length === 0
    })
  },

  goAdd() {
    wx.switchTab({ url: '/pages/add/add' })
  },

  // 点击记录：删除（二次确认）
  onRecordTap(e) {
    const id = e.currentTarget.dataset.id
    wx.showActionSheet({
      itemList: ['删除该笔记录'],
      itemColor: '#fa5151',
      success: (res) => {
        if (res.tapIndex !== 0) return
        wx.showModal({
          title: '确认删除',
          content: '确定删除这笔记录吗？',
          confirmText: '删除',
          confirmColor: '#fa5151',
          success: (m) => {
            if (!m.confirm) return
            db.deleteRecord(id)
            this.loadData()
            wx.showToast({ title: '已删除', icon: 'success' })
          }
        })
      }
    })
  }
})
