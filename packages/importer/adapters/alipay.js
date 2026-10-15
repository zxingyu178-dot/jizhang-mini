// packages/importer/adapters/alipay.js
// 支付宝个人对账 Adapter（Excel / CSV，GBK 由 detector 解码，含纯 JS fallback）：
// 使用共享 header 解析，按表头识别，不按行号。
// 字段：交易时间/交易分类/交易对方/对方账号/商品说明/收/支/金额/收付款方式/交易状态/交易订单号/商家订单号/备注
const money = require('../../../data/money');
const normalizer = require('../core/normalizer');
const diagnosis = require('../core/diagnosis');
const header = require('../core/header');

// 支付宝分类 → Mini 分类
const CATEGORY_MAP = {
  餐饮美食: 'c-food',
  交通出行: 'c-transport',
  数码电器: 'c-shopping',
  服饰装扮: 'c-shopping',
  日用百货: 'c-shopping',
  住房物业: 'c-housing',
  文化休闲: 'c-fun',
  医疗健康: 'c-medical',
  教育培训: 'c-other', // Android 12 分类无教育
  金融保险: 'c-other',
  公益捐赠: 'c-other',
  商业服务: 'c-other',
  其他: 'c-other',
};

// 列别名组
const ALIASES = {
  time: ['交易时间'],
  category: ['交易分类'],
  counterpart: ['交易对方'],
  account: ['对方账号'],
  goods: ['商品说明', '商品'],
  flow: ['收/支', '收支'],
  amount: ['金额', '金额(元)', '金额（元）', '交易金额', '交易金额(元)'],
  payMethod: ['收/付款方式', '付款方式', '支付方式'],
  status: ['交易状态', '当前状态'],
  txnid: ['交易订单号', '交易单号', '订单号'],
  mchId: ['商家订单号', '商户单号'],
  remark: ['备注'],
};

const ANCHOR = [ALIASES.time, ALIASES.flow];
const REQUIRED = [ALIASES.time, ALIASES.flow, ALIASES.amount];
const PRIMARY = ['交易时间', '收/支', '金额'];

const NEUTRAL = ['不计收支', '', '/', '-', '其他', '资金占用'];

function get(row, idx) {
  if (idx < 0) return '';
  return String(row[idx] == null ? '' : row[idx]);
}

function mapCategory(raw) {
  const t = String(raw || '').trim();
  if (CATEGORY_MAP[t]) return CATEGORY_MAP[t];
  const hit = Object.keys(CATEGORY_MAP).find((k) => t.indexOf(k) >= 0 || k.indexOf(t) >= 0);
  return hit ? CATEGORY_MAP[hit] : 'c-other';
}

function parseRows(rows, source, diag) {
  const anchor = header.findHeaderRow(rows, ANCHOR);
  if (!anchor) {
    diagnosis.setHeader(diag, false, -1);
    throw new Error('没有找到支付宝账单表头，请确认是支付宝「个人对账」账单');
  }
  diagnosis.setHeader(diag, true, anchor.index);
  const H = anchor.headers;

  const ci = {
    time: header.findColumn(H, ALIASES.time),
    category: header.findColumn(H, ALIASES.category),
    counterpart: header.findColumn(H, ALIASES.counterpart),
    account: header.findColumn(H, ALIASES.account),
    goods: header.findColumn(H, ALIASES.goods),
    flow: header.findColumn(H, ALIASES.flow),
    amount: header.findColumn(H, ALIASES.amount),
    payMethod: header.findColumn(H, ALIASES.payMethod),
    status: header.findColumn(H, ALIASES.status),
    txnid: header.findColumn(H, ALIASES.txnid),
    mchId: header.findColumn(H, ALIASES.mchId),
    remark: header.findColumn(H, ALIASES.remark),
  };

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
      continue; // 不计收支 / 占位 / 资金占用 → 正常跳过
    } else {
      // 收/支无法识别：状态异常才留待 needconfirm；状态正常记解析错误。
      if (!/退款|撤销|关闭|失败|冻结|异常|未支付|已退回/.test(status)) {
        diagnosis.addError(diag, i, '收/支', ci.flow, '取值无法识别（应为支出/收入/不计收支）');
        continue;
      }
      // type 保持 null
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
    const category = mapCategory(get(r, ci.category));

    const b = normalizer.makeBill({
      type: type || 'expense',
      amountCents,
      categoryId: category,
      occurredAt,
      merchant,
      note,
      source,
      sourceTxnId: txnId,
    });
    b.fingerprint = normalizer.makeFingerprint(b);

    // 支付宝保守策略（v0.2.2 未调整支付宝，沿用 v0.2.0）：
    //  - 收/支明确但状态为「关闭/失败/未支付/冻结/撤销」，可能未发生真实扣款 → needconfirm；
    //  - 收/支无法识别且状态异常 → needconfirm；
    //  - 已退款/已退回属真实资金流，官方收/支已体现方向，按官方入账。
    const conservative = /关闭|失败|未支付|冻结|撤销/;
    if ((type && conservative.test(status)) || (!type && /退款|退回|关闭|失败|未支付|冻结|撤销|异常/.test(status))) {
      b.status = 'needconfirm';
      b.statusReason = !type
        ? '收/支未识别且交易状态异常（' + status + '），请确认收入/支出方向'
        : '交易状态“' + status + '”，可能未发生真实扣款，请确认';
    }
    bills.push(b);
  }
  return bills;
}

module.exports = {
  parseRows,
  mapCategory,
  ALIASES,
};
