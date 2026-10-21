// data/export/csv.js — 账单 CSV 导出纯函数（v1.1.0 Gate 6）
//
// 列：日期 / 类型 / 金额 / 分类 / 名称/商户 / 备注 / 来源
// 编码：UTF-8 BOM（Excel / WPS / Numbers 可直接打开）。
// 注意：CSV 只用于查看 / 分析，不用于完整恢复。
// 金额为纯数字（不带千分位），便于 Excel 直接按数值处理。

const BOM = '\uFEFF';
const HEADER = ['日期', '类型', '金额', '分类', '名称/商户', '备注', '来源'];

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** CSV 字段转义：含逗号 / 双引号 / 换行时用双引号包裹，内部双引号翻倍。 */
function csvField(v) {
  const s = v == null ? '' : String(v);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** 整数分 -> 纯数字金额文本（无千分位，如 5999.00）。 */
function plainAmount(cents) {
  const c = Math.abs(Number(cents) || 0);
  const yuan = Math.floor(c / 100);
  const frac = c % 100;
  return yuan + '.' + (frac < 10 ? '0' : '') + frac;
}

/** 时间戳 -> 「YYYY-MM-DD HH:mm」。 */
function dateTimeText(ts) {
  const d = new Date(ts);
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  );
}

/** 来源标签：周期 / 导入 / 手动。 */
function sourceLabel(b) {
  if (b.source === 'recurring') return '周期';
  if (b.source === 'import') return '导入';
  return '手动';
}

/**
 * 生成账单 CSV（含 UTF-8 BOM）。
 * 排除 daily-value-only（非真实账单），按时间升序。
 * @param {Array} bills 全部账单
 * @param {(id:string)=>{name:string,emoji:string}} [resolveCategory]
 * @returns {string}
 */
function buildBillsCSV(bills, resolveCategory) {
  const resolve = typeof resolveCategory === 'function' ? resolveCategory : () => ({ name: '', emoji: '' });
  const lines = [HEADER.map(csvField).join(',')];
  const list = (Array.isArray(bills) ? bills : [])
    .filter((b) => b && b.ledgerImpact !== 'daily-value-only')
    .slice()
    .sort((a, b) => a.occurredAt - b.occurredAt);
  list.forEach((b) => {
    const cat = resolve(b.categoryId) || { name: '' };
    const line = [
      dateTimeText(b.occurredAt),
      b.type === 'income' ? '收入' : '支出',
      plainAmount(b.amountCents),
      cat.name || '',
      b.title || b.merchant || '',
      b.note || '',
      sourceLabel(b),
    ].map(csvField).join(',');
    lines.push(line);
  });
  return BOM + lines.join('\r\n');
}

module.exports = { buildBillsCSV, csvField, plainAmount };
