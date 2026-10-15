// packages/importer/adapters/alipay.js
// 支付宝个人对账 Adapter（Excel / CSV，GBK 由 detector 解码）：按表头识别。
// 字段：交易时间/交易分类/交易对方/对方账号/商品说明/收/支/金额/收付款方式/交易状态/交易订单号/商家订单号/备注
const money = require('../../../data/money');
const normalizer = require('../core/normalizer');
const diagnosis = require('../core/diagnosis');

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

function findHeader(rows) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].map((c) => String(c).trim());
    const hasTime = r.some((h) => h.replace(/\s/g, '') === '交易时间');
    const hasFlow = r.some((h) => h.replace(/\s/g, '') === '收/支' || h === '收支');
    if (hasTime && hasFlow) return { index: i, headers: r };
  }
  return null;
}

function colIndex(headers, name) {
  const target = name.replace(/\s/g, '');
  let idx = headers.findIndex((h) => h.replace(/\s/g, '') === target);
  if (idx < 0) {
    // 模糊匹配：去标点后包含
    idx = headers.findIndex((h) => h.replace(/[\s/]/g, '') === target.replace(/[\s/]/g, ''));
  }
  return idx;
}

function get(row, idx) {
  if (idx < 0) return '';
  return String(row[idx] == null ? '' : row[idx]);
}

function mapCategory(raw) {
  const t = String(raw || '').trim();
  if (CATEGORY_MAP[t]) return CATEGORY_MAP[t];
  // 关键字包含
  const hit = Object.keys(CATEGORY_MAP).find((k) => t.indexOf(k) >= 0 || k.indexOf(t) >= 0);
  return hit ? CATEGORY_MAP[hit] : 'c-other';
}

function parseRows(rows, source, diag) {
  const h = findHeader(rows);
  if (!h) {
    diagnosis.setHeader(diag, false, -1);
    throw new Error('没有找到支付宝账单表头，请确认是支付宝「个人对账」账单');
  }
  diagnosis.setHeader(diag, true, h.index);
  const H = h.headers;
  const ci = {
    time: colIndex(H, '交易时间'),
    category: colIndex(H, '交易分类'),
    counterpart: colIndex(H, '交易对方'),
    goods: colIndex(H, '商品说明'),
    flow: colIndex(H, '收/支'),
    amount: colIndex(H, '金额'),
    status: colIndex(H, '交易状态'),
    txnid: colIndex(H, '交易订单号'),
    remark: colIndex(H, '备注'),
  };

  const bills = [];
  for (let i = h.index + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => !String(c).trim())) continue;
    if (diag) diag.totalDataRows += 1;

    const flow = get(r, ci.flow).trim();
    let type;
    if (flow === '支出') type = 'expense';
    else if (flow === '收入') type = 'income';
    else if (flow === '不计收支' || flow === '' || flow === '/' || flow === '-' || flow === '其他' || flow === '资金占用') {
      if (diag) diag.nonFlowSkipped += 1;
      continue; // 不计收支 / 占位 / 资金占用 → 正常跳过
    } else {
      diagnosis.addError(diag, i, '收/支', ci.flow, '取值无法识别（应为“支出/收入/不计收支”）');
      continue;
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
    const status = get(r, ci.status).trim();
    const category = mapCategory(get(r, ci.category));

    const b = normalizer.makeBill({
      type,
      amountCents,
      categoryId: category,
      occurredAt,
      merchant,
      note,
      source,
      sourceTxnId: txnId,
    });
    b.fingerprint = normalizer.makeFingerprint(b);

    // 退款 / 关闭 / 失败 / 冻结：现金流不确定 → 需确认
    if (/退款|关闭|失败|冻结|未支付|已退回|撤销/.test(status)) {
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
  mapCategory,
};
