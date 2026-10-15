// packages/importer/adapters/wechat.js
// 微信个人账单 Adapter（XLSX / CSV）：使用共享 header 解析，按表头识别，不按行号。
// 字段：交易时间/交易类型/交易对方/商品/收/支/金额(元)/支付方式/当前状态/交易单号/商户单号/备注
const money = require('../../../data/money');
const normalizer = require('../core/normalizer');
const diagnosis = require('../core/diagnosis');
const header = require('../core/header');

// 列别名组（原始写法，header 内部归一化）
const ALIASES = {
  time: ['交易时间'],
  counterpart: ['交易对方', '对方'],
  goods: ['商品', '商品名称'],
  flow: ['收/支', '收支'],
  amount: ['金额', '金额(元)', '金额（元）', '交易金额', '交易金额(元)', '交易金额（元）'],
  payMethod: ['支付方式', '付款方式'],
  status: ['当前状态', '交易状态'],
  txnid: ['交易单号', '交易订单号', '微信订单号'],
  mchId: ['商户单号', '商家订单号'],
  remark: ['备注'],
};

// 表头锚点（相对稳定的「交易时间 + 收/支」），用于定位表头行
const ANCHOR = [ALIASES.time, ALIASES.flow];
// 锚点定位后必须存在的关键业务列
const REQUIRED = [ALIASES.time, ALIASES.flow, ALIASES.amount];
const PRIMARY = ['交易时间', '收/支', '金额'];

const NEUTRAL = ['不计收支', '', '/', '-', '中性', '其他'];

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

function parseRows(rows, source, diag) {
  const anchor = header.findHeaderRow(rows, ANCHOR);
  if (!anchor) {
    diagnosis.setHeader(diag, false, -1);
    throw new Error('没有找到微信账单表头，请确认是微信「个人对账」账单');
  }
  diagnosis.setHeader(diag, true, anchor.index);
  const H = anchor.headers;

  const ci = {
    time: header.findColumn(H, ALIASES.time),
    counterpart: header.findColumn(H, ALIASES.counterpart),
    goods: header.findColumn(H, ALIASES.goods),
    flow: header.findColumn(H, ALIASES.flow),
    amount: header.findColumn(H, ALIASES.amount),
    payMethod: header.findColumn(H, ALIASES.payMethod),
    status: header.findColumn(H, ALIASES.status),
    txnid: header.findColumn(H, ALIASES.txnid),
    mchId: header.findColumn(H, ALIASES.mchId),
    remark: header.findColumn(H, ALIASES.remark),
  };

  // 表头已识别但关键列缺失（典型：官方把「金额」改成「金额(元)」之外的新写法）
  // 明确报错，不进入“0 笔正常结果”。
  const missing = header.missingColumns(H, REQUIRED, PRIMARY);
  if (missing.length) {
    diagnosis.setMissingColumns(diag, missing);
    throw new Error('账单格式已识别，但“' + missing.join('、') + '”列格式发生变化，请点「复制诊断」反馈');
  }

  const bills = [];
  for (let i = anchor.index + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => !String(c).trim())) continue;
    if (diag) diag.totalDataRows += 1;

    const flowRaw = get(r, ci.flow).trim();
    const status = get(r, ci.status).trim();

    let type = null;
    if (flowRaw === '支出') {
      type = 'expense';
      if (diag) diag.expenseRows += 1;
    } else if (flowRaw === '收入') {
      type = 'income';
      if (diag) diag.incomeRows += 1;
    } else if (NEUTRAL.indexOf(flowRaw) >= 0) {
      if (diag) diag.nonFlowSkipped += 1;
      continue; // 不计收支 / 占位 → 正常跳过
    } else {
      // 收/支取值无法识别：状态也异常才留待 needconfirm；状态正常则记为解析错误。
      if (!/退款|撤销|关闭|失败|异常|未支付|已退回|交易关闭/.test(status)) {
        diagnosis.addError(diag, i, '收/支', ci.flow, '取值无法识别（应为支出/收入/不计收支）');
        continue;
      }
      // type 保持 null，进入金额/时间解析后标 needconfirm
    }

    const amountCents = Math.abs(money.parseAmountToCents(get(r, ci.amount)));
    const occurredAt = normalizer.parseDateTime(get(r, ci.time));
    if (!occurredAt) {
      diagnosis.addError(diag, i, '交易时间', ci.time, '缺失或无法解析');
      continue;
    }
    if (!amountCents) {
      diagnosis.addError(diag, i, '金额', ci.amount, '缺失或无法解析');
      continue;
    }

    const merchant = get(r, ci.counterpart).trim();
    const goods = get(r, ci.goods).trim();
    const remark = get(r, ci.remark).trim();
    let note = goods;
    if (remark && remark !== goods) note = goods ? goods + ' · ' + remark : remark;
    const txnId = get(r, ci.txnid).trim();

    const b = normalizer.makeBill({
      type: type || 'expense',
      amountCents,
      categoryId: guessCategory(merchant + ' ' + goods),
      occurredAt,
      merchant,
      note,
      source,
      sourceTxnId: txnId,
    });
    b.fingerprint = normalizer.makeFingerprint(b);

    // 仅当官方「收/支」无法识别、且交易状态又异常时，才进入需确认。
    // 收/支已明确时，即使“已退款”，也按官方方向正常入账（与微信账单总额保持一致）。
    if (!type && /退款|撤销|关闭|失败|异常|未支付|已退回|交易关闭/.test(status)) {
      b.status = 'needconfirm';
      b.statusReason = '收/支未识别且交易状态异常（' + status + '），请确认收入/支出方向';
    }
    bills.push(b);
  }
  return bills;
}

module.exports = {
  parseRows,
  ALIASES,
};
