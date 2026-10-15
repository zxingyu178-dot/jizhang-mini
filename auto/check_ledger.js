/**
 * auto/check_ledger.js — 回主页并读取账本（验证导入写入生效）。
 */
const automator = require('miniprogram-automator');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  let page = await mp.currentPage();
  console.log('start:', page.path);
  try {
    await page.callMethod('onFinish');
  } catch (e) {
    console.log('(onFinish warn: ' + e.message + ')');
  }
  await delay(2000);
  page = await mp.currentPage();
  console.log('now:', page.path);
  const d = await page.data();
  // 主页数据由 panel 组件持有，打印主页 data 键
  console.log('page data keys:', Object.keys(d));
  await mp.disconnect();
  console.log('DONE');
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
