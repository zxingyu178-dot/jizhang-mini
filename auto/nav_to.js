/**
 * auto/nav_to.js — 导航到指定页（settings / import / preview）。
 * 用法：node auto/nav_to.js settings|import
 */
const automator = require('miniprogram-automator');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const target = process.argv[2];
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  let page = await mp.currentPage();
  if (page.path !== 'pages/main/main') {
    try { await mp.reLaunch({ url: '/pages/main/main' }); } catch (e) {}
    await delay(1000);
  }
  page = await mp.currentPage();
  if (target === 'settings' || target === 'import') {
    await page.callMethod('onSettings');
    await delay(900);
    page = await mp.currentPage();
  }
  if (target === 'import') {
    await page.callMethod('onImport');
    await delay(1200);
    page = await mp.currentPage();
  }
  console.log('now:', page.path);
  await mp.disconnect();
  console.log('DONE');
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
