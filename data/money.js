/**
 * data/money.js — 金额工具（核心一律用整数分，避免浮点误差）
 *
 * 存储 / 统计：amountCents（整数，¥25.50 = 2550）
 * 显示：再换算回元
 */

/** 元(number) -> 分 */
function yuanToCents(yuan) {
  return Math.round((Number(yuan) || 0) * 100);
}

/**
 * 解析任意金额输入为分
 * 支持："¥25.80"、"￥25.80"、"25.80"、"1,234.56"、25.5、"-12.30"
 */
function parseAmountToCents(input) {
  if (typeof input === 'number') {
    return Math.round(input * 100);
  }
  let s = String(input == null ? '' : input);
  // 去掉货币符号、逗号、空白
  s = s.replace(/[¥￥$,\s]/g, '');
  let neg = false;
  if (s[0] === '-') {
    neg = true;
    s = s.slice(1);
  }
  if (s[0] === '+') s = s.slice(1);
  const parts = s.split('.');
  const yuanPart = parts[0] || '0';
  let frac = parts[1] || '';
  if (frac.length > 2) frac = frac.slice(0, 2);
  while (frac.length < 2) frac += '0';
  const yuan = parseInt(yuanPart, 10) || 0;
  const fracCents = parseInt(frac, 10) || 0;
  const cents = yuan * 100 + fracCents;
  return neg ? -cents : cents;
}

/** 分 -> 元(number) */
function centsToYuan(cents) {
  return (cents || 0) / 100;
}

/** 分 -> "25.50"（带千分位，无符号） */
function formatCents(cents) {
  const c = Number(cents) || 0;
  const neg = c < 0;
  const abs = Math.abs(c);
  const yuan = Math.floor(abs / 100);
  const frac = abs % 100;
  const ys = String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let s = ys + '.' + (frac < 10 ? '0' : '') + frac;
  return (neg ? '-' : '') + s;
}

/** 分 -> "¥25.50" */
function formatCentsWithSymbol(cents) {
  return '¥' + formatCents(cents);
}

module.exports = {
  yuanToCents,
  parseAmountToCents,
  centsToYuan,
  formatCents,
  formatCentsWithSymbol,
};
