const automator = require('miniprogram-automator');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });
  const page = await mp.currentPage();
  console.log('page:', page.path);
  await page.callMethod('onAdd');
  await delay(1000);
  const d = await page.data();
  console.log('sheetShow:', d.sheetShow, '| title:', d.sheetTitle);
  await mp.disconnect();
  console.log('DONE');
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
