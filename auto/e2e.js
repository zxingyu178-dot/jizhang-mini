/**
 * auto/e2e.js — 调用页面 __selftest，在真实运行时验证数据层
 */
const automator = require('miniprogram-automator');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  await delay(800);
  const page = await mp.currentPage();
  const result = await page.callMethod('__migtest');
  console.log('=== E2E RESULT ===');
  console.log(JSON.stringify(result, null, 2));
  await mp.disconnect();
  console.log('=== DONE ===');
})().catch((e) => {
  console.error('SCRIPT ERROR:', e.message);
  process.exit(1);
});
