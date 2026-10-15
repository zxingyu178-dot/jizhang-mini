/**
 * auto/check_sep.js — 切到9月读取导入账单（验证写入到月份分片）。
 */
const automator = require('miniprogram-automator');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  const page = await mp.currentPage();
  console.log('page:', page.path);
  const panel = await page.$('#accountingPanel');
  await panel.callMethod('onPrevMonth');
  await delay(1000);
  const d = await panel.data();
  console.log('monthLabel:', d.monthLabel);
  console.log('expense/income/balance:', d.monthExpense, d.monthIncome, d.monthBalance);
  console.log('isEmpty:', d.isEmpty);
  console.log('groups:', JSON.stringify((d.groups || []).map((g) => ({
    day: g.date,
    count: (g.records || []).length,
    names: (g.records || []).map((r) => r.name + ' ' + r.amountText),
  }))));
  await mp.disconnect();
  console.log('DONE');
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
