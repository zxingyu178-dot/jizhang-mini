// utils/db.js
// 账单数据的本地存储与统计。数据仅保存在设备 wx.Storage，无后端、无网络。

const { genId } = require('./util')

const RECORD_KEY = 'jm_records'

// 收支分类：value 为稳定标识，label 为展示名，emoji 为占位图标
const CATEGORIES = {
  expense: [
    { value: 'food', label: '餐饮', emoji: '🍚' },
    { value: 'transport', label: '交通', emoji: '🚌' },
    { value: 'shopping', label: '购物', emoji: '🛍️' },
    { value: 'housing', label: '住房', emoji: '🏠' },
    { value: 'entertainment', label: '娱乐', emoji: '🎮' },
    { value: 'medical', label: '医疗', emoji: '💊' },
    { value: 'education', label: '教育', emoji: '📚' },
    { value: 'other_expense', label: '其他', emoji: '✏️' }
  ],
  income: [
    { value: 'salary', label: '工资', emoji: '💰' },
    { value: 'parttime', label: '兼职', emoji: '💼' },
    { value: 'bonus', label: '红包', emoji: '🧧' },
    { value: 'investment', label: '理财', emoji: '📈' },
    { value: 'other_income', label: '其他', emoji: '✏️' }
  ]
}

function getAllRecords() {
  return wx.getStorageSync(RECORD_KEY) || []
}

function saveAllRecords(list) {
  wx.setStorageSync(RECORD_KEY, list)
}

// 按日期倒序、同日按创建时间倒序
function sortRecords(list) {
  return list.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return (b.createdAt || 0) - (a.createdAt || 0)
  })
}

// 新增一条记录
function addRecord(data) {
  const list = getAllRecords()
  const record = Object.assign(
    {
      id: genId(),
      createdAt: Date.now()
    },
    data
  )
  list.push(record)
  saveAllRecords(sortRecords(list))
  return record
}

// 删除一条记录
function deleteRecord(id) {
  const list = getAllRecords().filter((r) => r.id !== id)
  saveAllRecords(list)
  return list
}

// 汇总：收入、支出、结余
function summary(list) {
  let income = 0
  let expense = 0
  ;(list || []).forEach((r) => {
    const amount = Number(r.amount) || 0
    if (r.type === 'income') income += amount
    else expense += amount
  })
  return {
    income,
    expense,
    balance: income - expense
  }
}

// 按日期分组（用于明细页）
function groupByDate(list) {
  const map = {}
  ;(list || []).forEach((r) => {
    if (!map[r.date]) {
      map[r.date] = { date: r.date, income: 0, expense: 0, records: [] }
    }
    const group = map[r.date]
    group.records.push(r)
    if (r.type === 'income') group.income += Number(r.amount) || 0
    else group.expense += Number(r.amount) || 0
  })
  return Object.keys(map)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((k) => map[k])
}

// 按类别统计（用于统计页）
function categoryStats(list, type) {
  const map = {}
  let total = 0
  ;(list || [])
    .filter((r) => r.type === type)
    .forEach((r) => {
      const amount = Number(r.amount) || 0
      map[r.category] = (map[r.category] || 0) + amount
      total += amount
    })
  const items = (CATEGORIES[type] || [])
    .filter((c) => map[c.value])
    .map((c) => ({
      value: c.value,
      label: c.label,
      emoji: c.emoji,
      amount: map[c.value],
      percent: total > 0 ? (map[c.value] / total) * 100 : 0
    }))
    .sort((a, b) => b.amount - a.amount)
  return { total, items }
}

// 查询某分类的展示信息
function getCategory(type, value) {
  const cats = CATEGORIES[type] || []
  return (
    cats.find((c) => c.value === value) || {
      value,
      label: '其他',
      emoji: '✏️'
    }
  )
}

module.exports = {
  CATEGORIES,
  getAllRecords,
  saveAllRecords,
  addRecord,
  deleteRecord,
  summary,
  groupByDate,
  categoryStats,
  getCategory
}
