/**
 * tests/csv-export.test.js — 账单 CSV 导出（v1.1.0 Gate 6）测试
 *
 * 完全虚构账单，覆盖 BOM / 表头 / 列顺序 / 排除日价单 / 字段转义 /
 * 纯数字金额 / 日期格式 / 类型与来源 / 时间升序 / 空账单。
 * 纯函数不依赖 wx，直接 require。
 * 运行：node tests/csv-export.test.js
 */
let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.error('  FAIL: ' + msg);
  }
}
function eq(actual, expected, msg) {
  assert(actual === expected, msg + ' (expected=' + expected + ', actual=' + actual + ')');
}

const C = require('../data/export/csv');

function bill(type, amount, y, mo, d, cat, extra) {
  return Object.assign(
    {
      id: 'b-' + y + mo + d + '-' + cat + '-' + amount,
      type,
      amountCents: Math.round(amount * 100),
      categoryId: cat,
      occurredAt: new Date(y, mo - 1, d, 12, 30).getTime(),
      ledgerImpact: 'normal',
    },
    extra || {}
  );
}
const CATS = {
  'c-food': { name: '餐饮', emoji: '🍚' },
  'c-shopping': { name: '购物', emoji: '🛍️' },
  'c-salary': { name: '工资', emoji: '💰' },
};
function resolveCat(id) {
  return CATS[id] || { name: '其他', emoji: '📦' };
}

const bills = [
  bill('expense', 22.6, 2026, 10, 16, 'c-food'),
  bill('expense', 5999, 2026, 1, 1, 'c-shopping'),
  bill('income', 6000, 2026, 9, 5, 'c-salary', { source: 'import' }),
  bill('expense', 999, 2026, 10, 25, 'c-shopping', { ledgerImpact: 'daily-value-only' }),
];

console.log('CSV 结构');
{
  const csv = C.buildBillsCSV(bills, resolveCat);
  // BOM
  assert(csv.charCodeAt(0) === 0xfeff, '以 UTF-8 BOM 开头');
  // 去掉 BOM 后按行解析
  const noBom = csv.slice(1);
  const lines = noBom.split('\r\n');
  eq(lines[0], '日期,类型,金额,分类,名称/商户,备注,来源', '表头 7 列正确');
  // 排除 daily-value-only：3 行数据
  eq(lines.length, 4, '3 笔账单（日价单已排除）+ 表头');
  // 时间升序：1月1日 → 9月5日 → 10月16日
  assert(lines[1].indexOf('2026-01-01 12:30') === 0, '第 1 行 = 1月1日（升序）');
  assert(lines[2].indexOf('2026-09-05 12:30') === 0, '第 2 行 = 9月5日');
  assert(lines[3].indexOf('2026-10-16 12:30') === 0, '第 3 行 = 10月16日');
  // 1月1日 购物行：类型支出、金额纯数字 5999.00（无千分位）、分类购物
  const row1 = lines[1].split(',');
  eq(row1[1], '支出', '类型 = 支出');
  eq(row1[2], '5999.00', '金额纯数字（无千分位）');
  eq(row1[3], '购物', '分类 = 购物');
  // 9月5日 工资：类型收入、来源导入
  const row2 = lines[2].split(',');
  eq(row2[1], '收入', '类型 = 收入');
  eq(row2[2], '6000.00', '收入金额');
  eq(row2[6], '导入', '来源 = 导入');
  // 10月16日 餐饮：来源手动
  eq(lines[3].split(',')[6], '手动', '来源 = 手动');
}

console.log('CSV 字段转义');
{
  // 备注含逗号
  const t1 = C.csvField('a,b,c');
  eq(t1, '"a,b,c"', '含逗号用双引号包裹');
  // 含双引号
  const t2 = C.csvField('he said "hi"');
  eq(t2, '"he said ""hi"""', '内部双引号翻倍');
  // 含换行
  const t3 = C.csvField('line1\nline2');
  eq(t3, '"line1\nline2"', '含换行用双引号包裹');
  // 普通字段不包裹
  eq(C.csvField('餐饮'), '餐饮', '普通字段不包裹');
  eq(C.csvField(null), '', 'null -> 空字符串');
  // 端到端：备注含逗号被引号包裹（作为一个字段，不破坏 CSV 结构）
  const csv = C.buildBillsCSV(
    [bill('expense', 10, 2026, 1, 1, 'c-food', { note: 'a,b,c' })],
    resolveCat
  );
  const lines = csv.slice(1).split('\r\n');
  assert(lines[1].indexOf('"a,b,c"') !== -1, '备注含逗号被引号包裹为一个字段');
}

console.log('空账单 / 边界');
{
  const csv = C.buildBillsCSV([], resolveCat);
  const lines = csv.slice(1).split('\r\n');
  eq(lines.length, 1, '空账单只有表头');
  // 无 resolver 不报错
  const csv2 = C.buildBillsCSV([bill('expense', 10, 2026, 1, 1, 'c-x')]);
  assert(csv2.indexOf('c-x') === -1, '未知分类在无 resolver 时分类名为空');
  // 非数组输入
  const csv3 = C.buildBillsCSV(null, resolveCat);
  eq(csv3.slice(1).split('\r\n').length, 1, '非数组输入安全降级');
}

console.log('\ncsv-export tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
