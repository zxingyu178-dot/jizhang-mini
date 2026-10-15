// packages/importer/adapters/wechat.js
// 微信个人账单 Adapter（XLSX / CSV）：按表头识别，不按行号。
// 字段：交易时间/交易类型/交易对方/商品/收/支/金额/支付方式/当前状态/交易单号/商户单号/备注
const money = require('../../../data/money');
const normalizer = require('../core/normalizer');

/** 找表头行（含「交易时间」和「收/支」） */
function findHeader(rows) {
  for (let i = 0;i < rows.length; i++) {
    const r = rows[i].map((c) => String(c).trim());
    const hasTime = r.some((h) => h.replace(/\s/g, '') === '交易时间');
    const hasFlow = r.some((h) => h.replace(/\s/g, '') === '收/支' || h === '收支');
    if (hasTime && hasFlow) return { index: i, headers: r };
  }
  return null;
}

function colIndex(headers, name) {
  const target = name.replace(/\s/g, '');
  return headers.findIndex((h) => h.replace(/\s/g, '') === target);
}

function get(row, idx) {
  if (idx < 0) return '';
  return String(row[idx] == null ? '' : row[idx]);
}

/** 微信无消费分类，仅做确定性关键字，其余 c-other */
function guessCategory(text) {
  if (/滴滴|地铁|公交|打车|出行|高速|停车|火车|机票|铁路/.test(text)) return 'c-transport';
  if (/医院|药店|药房|诊所|医疗|挂号/.test(text)) return 'c-medical';
  return 'c-other';
}

function parseRows(rows, source) {
  const h = findHeader(rows);
  if (!h) throw new Error('没有找到微信账单表头，请确认是微信「个人对账」账单');
  const H = h.headers;
  const ci = {
    time: colIndex(H, '交易时间'),
    counterpart: colIndex(H, '交易对方'),
    goods: colIndex(H, '商品'),
    flow: colIndex(H, '收/支'),
    amount: colIndex(H, '金额'),
    status: colIndex(H, '当前状态'),
    txnid: colIndex(H, '交易单号'),
    remark: colIndex(H, '备注'),
  };

  const bills = [];
  for (let i = h.index + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => !String(c).trim())) continue;

    const flow = get(r, ci.flow).trim();
    let type;
    if (flow === '支出') type = 'expense';
    else if (flow === '收入') type = 'income';
    else continue; // 不计收支 / 空 → 跳过

    const amountCents = Math.abs(money.parseAmountToCents(get(r, ci.amount)));
    const occurredAt = normalizer.parseDateTime(get(r, ci.time));
    if (!amountCents || !occurredAt) continue;

    const merchant = get(r, ci.counterpart).trim();
    const goods = get(r, ci.goods).trim();
    const remark = get(r, ci.remark).trim();
    let note = goods;
    if (remark && remark !== goods) note = goods ? goods + ' · ' + remark : remark;
    const txnId = get(r, ci.txnid).trim();
    const status = get(r, ci.status).trim();

    const catText = merchant + ' ' + goods;
    const b = normalizer.makeBill({
      type,
      amountCents,
      categoryId: guessCategory(catText),
      occurredAt,
      merchant,
      note,
      source,
      sourceTxnId: txnId,
    });
    b.fingerprint = normalizer.makeFingerprint(b);

    // 退款 / 撤销 / 关闭 / 失败：现金流方向不确定 → 需确认
    if (/退款|撤销|关闭|失败|未支付|已退回|交易关闭/.test(status)) {
      b.status = 'needconfirm';
      b.statusReason = '交易状态：' + status;
    }
    bills.push(b);
  }
  return bills;
}

module.exports = {
  parseRows,
  findHeader,
};
