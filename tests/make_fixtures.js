/**
 * tests/make_fixtures.js — 生成完全虚构的账单测试夹具。
 * 所有姓名、账号、流水号均为虚构，禁止放真实数据。
 * 运行：node tests/make_fixtures.js
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('../packages/importer/excel/xlsx');

const OUT = path.join(__dirname, 'fixtures');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

function writeXlsx(name, rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(path.join(OUT, name), buf);
}

// ---------- 微信账单（XLSX）：前 16 行说明，第 17 行表头 ----------
const wechatHeader = [
  '交易时间', '交易类型', '交易对方', '商品', '收/支', '金额',
  '支付方式', '当前状态', '交易单号', '商户单号', '备注',
];
const wechatRows = [
  ['微信支付账单明细'],
  ['说明：本文件为虚构测试数据'],
];
for (let i = 2; i < 16; i++) wechatRows.push(['']);
wechatRows.push(wechatHeader);
wechatRows.push(
  ['2026-10-15 08:32:11', '商户消费', '测试早餐店', '豆浆油条套餐', '支出', '¥12.50', '零钱', '支付成功', '4200000000000000000001', 'M2000000001', ''],
  ['2026-10-15 12:31:45', '商户消费', '虚构咖啡屋', '生椰拿铁', '支出', '¥18.00', '招商银行储蓄卡(0001)', '支付成功', '4200000000000000000002', 'M2000000002', ''],
  ['2026-10-14 18:05:20', '转账', '虚构打车平台', '快车费用', '支出', '¥23.60', '招商银行储蓄卡(0001)', '支付成功', '4200000000000000000003', 'M2000000003', ''],
  ['2026-10-10 09:00:00', '微信红包', '示例好友', '红包', '收入', '¥88.88', '零钱', '已收钱', '4200000000000000000004', '', '生日祝福'],
  ['2026-10-09 10:00:00', '零钱提现', '零钱', '提现到银行卡', '不计收支', '¥100.00', '零钱', '提现成功', '4200000000000000000005', '', ''],
  ['2026-10-08 14:00:00', '商户消费', '测试便利店', '退款订单', '支出', '¥5.00', '零钱', '已全额退款', '4200000000000000000006', 'M2000000006', '']
);
writeXlsx('wechat-current.xlsx', wechatRows);

// ---------- 微信账单（CSV，UTF-8）：第 3 行表头（位置变化） ----------
const wechatCsv = [
  ['微信支付账单明细（虚构）'],
  [''],
  wechatHeader,
  ['2026-09-20 19:42:10', '商户消费', '虚构火锅店', '双人套餐', '支出', '156.00', '零钱', '支付成功', '4200000000000000000007', 'M2000000007', ''],
  ['2026-09-15 12:00:00', '商户消费', '测试地铁', '地铁出行', '支出', '6.00', '零钱', '支付成功', '4200000000000000000008', 'M2000000008', ''],
];
function toCsv(rows) {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c == null ? '' : c);
          if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
          return s;
        })
        .join(',')
    )
    .join('\r\n');
}
fs.writeFileSync(path.join(OUT, 'wechat-legacy.csv'), '\uFEFF' + toCsv(wechatCsv), 'utf8');

// ---------- 支付宝账单（XLSX）：前 5 行说明，第 6 行表头 ----------
const alipayHeader = [
  '交易时间', '交易分类', '交易对方', '对方账号', '商品说明', '收/支',
  '金额', '收/付款方式', '交易状态', '交易订单号', '商家订单号', '备注',
];
const alipayRows = [
  ['支付宝交易记录明细（虚构）'],
];
for (let i = 1; i < 5; i++) alipayRows.push(['']);
alipayRows.push(alipayHeader);
alipayRows.push(
  ['2026-10-13 12:10:30', '餐饮美食', '虚构面馆', 'test*@example.com', '招牌牛肉面', '支出', '28.00', '余额宝', '交易成功', '20260000000000000001', 'S2000000001', ''],
  ['2026-10-12 08:15:00', '交通出行', '虚构公交公司', 'test2*@example.com', '公交充值', '支出', '50.00', '招商银行储蓄卡(0001)', '交易成功', '20260000000000000002', 'S2000000002', ''],
  ['2026-10-05 20:00:00', '服饰装扮', '虚构服装店', 'test3*@example.com', '外套', '支出', '299.00', '花呗', '交易成功', '20260000000000000003', 'S2000000003', ''],
  ['2026-10-01 10:00:00', '其他', '示例公司', 'test4*@example.com', '兼职工资', '收入', '2000.00', '余额', '交易成功', '20260000000000000004', 'S2000000004', ''],
  ['2026-09-28 15:00:00', '文化休闲', '虚构影院', 'test5*@example.com', '电影票', '支出', '45.00', '余额宝', '交易关闭', '20260000000000000005', 'S2000000005', '']
);
writeXlsx('alipay-current.xlsx', alipayRows);

// ---------- 支付宝账单（CSV，GBK 编码）：第 4 行表头 ----------
const alipayGbkRows = [
  ['支付宝交易记录明细（虚构）'],
  [''],
  [''],
  alipayHeader,
  ['2026-08-20 11:30:00', '医疗健康', '虚构药店', 't6*@example.com', '感冒药', '支出', '36.50', '余额', '交易成功', '20260000000000000006', 'S2000000006', ''],
  ['2026-08-15 09:00:00', '住房物业', '虚构物业', 't7*@example.com', '物业费', '支出', '320.00', '招商银行储蓄卡(0001)', '交易成功', '20260000000000000007', 'S2000000007', ''],
];
const gbkText = toCsv(alipayGbkRows);
// 从 xlsx.js 源码提取局部 cptable 段（cptable 定义在 XLSX 主体之前）。
const xlsxSrc = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'importer', 'excel', 'xlsx.js'),
  'utf8'
);
const cpStart = xlsxSrc.indexOf('var cptable=');
const cpEnd = xlsxSrc.indexOf('var XLSX=');
const cpt = new Function(xlsxSrc.slice(cpStart, cpEnd) + '; return cptable;')();
const encMap = cpt[936].enc;
// 双字节码页：ASCII 单字节，其余按 enc map 写双字节，未命中用 '?'
function encode936(text) {
  const bytes = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) {
      bytes.push(code);
    } else {
      const v = encMap[ch];
      if (v == null) bytes.push(0x3f);
      else bytes.push((v >> 8) & 0xff, v & 0xff);
    }
  }
  return Buffer.from(bytes);
}
fs.writeFileSync(path.join(OUT, 'alipay-gbk.csv'), encode936(gbkText));

// ---------- DailyValue CSV（Android 导出，UTF-8 BOM） ----------
const dvHeader = ['日期', '时间', '类型', '金额', '分类', '备注', '来源', '账本影响'];
const dvRows = [
  dvHeader,
  ['2026-09-10', '08:20', '支出', '15.00', '餐饮', '早餐', '手动', '普通账单'],
  ['2026-09-11', '19:00', '支出', '88.00', '购物', '日用品', '手动', '普通账单'],
  ['2026-09-12', '12:00', '收入', '5000.00', '工资', '月薪', '手动', '普通账单'],
  ['2026-09-13', '10:00', '支出', '1299.00', '其他', '耳机（日价）', '手动', '仅日价'],
];
fs.writeFileSync(path.join(OUT, 'dailyvalue.csv'), '\uFEFF' + toCsv(dvRows), 'utf8');

// ---------- DailyValue Android .dvbackup ----------
const dvBackup = {
  format: 'daily-value-backup',
  schemaVersion: 1,
  appVersion: '2.21.1',
  exportedAt: '2026-10-15T00:00:00.000Z',
  data: {
    bills: [
      {
        id: 'a-bill-1', type: 'expense', amount: 19.9, categoryId: 'c-food',
        categoryEmoji: '🍚', categoryName: '餐饮', note: '午餐', date: '2026-09-20',
        timestamp: new Date(2026, 8, 20, 12, 0).getTime(), source: 'manual', ledgerImpact: 'normal',
      },
      {
        id: 'a-bill-2', type: 'income', amount: 6000, categoryId: 'c-salary',
        categoryEmoji: '💰', categoryName: '工资', note: '工资', date: '2026-09-05',
        timestamp: new Date(2026, 8, 5, 10, 0).getTime(), source: 'manual', ledgerImpact: 'normal',
      },
      {
        id: 'a-bill-3', type: 'expense', amount: 3999, categoryId: 'c-other',
        categoryEmoji: '📦', categoryName: '其他', title: '虚构笔记本', note: '', date: '2026-09-01',
        timestamp: new Date(2026, 8, 1, 9, 0).getTime(), source: 'manual', ledgerImpact: 'daily-value-only',
      },
    ],
    categories: [],
    recurringRules: [],
    settings: {},
  },
};
fs.writeFileSync(path.join(OUT, 'dailyvalue-backup.json'), JSON.stringify(dvBackup, null, 2), 'utf8');

// ---------- Mini 完整备份 ----------
const miniBackup = {
  format: 'daily-value-mini-backup',
  schemaVersion: 1,
  appVersion: '0.2.0',
  exportedAt: '2026-10-15T00:00:00.000Z',
  data: {
    bills: [
      {
        id: 'm-bill-1', type: 'expense', amountCents: 2500, categoryId: 'c-food',
        occurredAt: new Date(2026, 9, 14, 12, 30).getTime(), merchant: '虚构餐厅',
        note: '午餐', source: 'manual', sourceTxnId: null, importBatchId: null,
        createdAt: Date.now(), updatedAt: Date.now(), ledgerImpact: 'normal',
      },
    ],
    categories: [],
    settings: {},
  },
};
fs.writeFileSync(path.join(OUT, 'mini-backup.json'), JSON.stringify(miniBackup, null, 2), 'utf8');

console.log('fixtures generated at', OUT);
