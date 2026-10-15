// pages/add/add.js 记一笔
const db = require('../../utils/db')
const util = require('../../utils/util')

Page({
  data: {
    type: 'expense',
    categories: db.CATEGORIES.expense,
    category: 'food',
    amount: '',
    date: '',
    note: '',
    types: [
      { value: 'expense', label: '支出' },
      { value: 'income', label: '收入' }
    ]
  },

  onLoad() {
    this.setData({ date: util.formatDate(new Date()) })
  },

  switchType(e) {
    const type = e.currentTarget.dataset.type
    const categories = db.CATEGORIES[type]
    this.setData({ type, categories, category: categories[0].value })
  },

  selectCategory(e) {
    this.setData({ category: e.currentTarget.dataset.value })
  },

  // 金额：仅数字、一个小数点、最多两位小数
  onAmountInput(e) {
    let v = (e.detail.value || '').replace(/[^\d.]/g, '')
    const parts = v.split('.')
    if (parts.length > 2) {
      v = parts[0] + '.' + parts.slice(1).join('')
    }
    v = v.replace(/\.(\d{0,2}).*$/, '.$1').replace(/^\./, '0.')
    this.setData({ amount: v })
  },

  onDateChange(e) {
    this.setData({ date: e.detail.value })
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value })
  },

  onSave() {
    const amount = parseFloat(this.data.amount)
    if (!amount || amount <= 0) {
      wx.showToast({ title: '请输入金额', icon: 'none' })
      return
    }
    db.addRecord({
      type: this.data.type,
      amount: Math.round(amount * 100) / 100,
      category: this.data.category,
      date: this.data.date,
      note: (this.data.note || '').trim()
    })
    wx.showToast({ title: '已保存', icon: 'success' })
    this.setData({ amount: '', note: '' })
    setTimeout(() => {
      wx.switchTab({ url: '/pages/index/index' })
    }, 400)
  }
})
