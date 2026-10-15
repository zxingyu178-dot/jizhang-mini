// utils/util.js
// 通用格式化工具

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

// Date -> 'YYYY-MM-DD'
function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date)
  return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-')
}

// 金额格式化：1234.5 -> '1,234.50'
function formatMoney(n) {
  const num = Number(n) || 0
  return num
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// 生成唯一 ID
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * 把 'YYYY-MM-DD' 与时分合并为本地时间戳。
 * - hours/minutes 为 null/undefined（新增）：使用当前时分；
 * - 传入原始时分（编辑）：只替换年月日，保留原时分。
 */
function dateWithTime(dateStr, hours, minutes) {
  const p = String(dateStr).split('-').map(Number)
  let h = hours
  let m = minutes
  if (h == null || m == null) {
    const now = new Date()
    h = now.getHours()
    m = now.getMinutes()
  }
  return new Date(p[0], p[1] - 1, p[2], h, m, 0, 0).getTime()
}

// 日期友好显示：今天 / 昨天 / M月D日
function friendlyDate(dateStr) {
  const today = formatDate(new Date())
  const yesterday = formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000))
  if (dateStr === today) return '今天'
  if (dateStr === yesterday) return '昨天'
  const parts = (dateStr || '').split('-')
  if (parts.length === 3) return Number(parts[1]) + '月' + Number(parts[2]) + '日'
  return dateStr
}

module.exports = {
  pad,
  formatDate,
  formatMoney,
  genId,
  dateWithTime,
  friendlyDate
}
