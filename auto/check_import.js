/**
 * auto/check_import.js — 逐步导航诊断（每步 try/catch）。
 */
const automator = require('miniprogram-automator');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryStep(label, fn) {
  try {
    const r = await fn();
    console.log('[OK] ' + label);
    return r;
  } catch (e) {
    console.log('[ERR] ' + label + ': ' + (e && e.message));
    return null;
  }
}

async function main() {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' });

  let page = await mp.currentPage();
  console.log('start:', page.path);

  await tryStep('onSettings', () => page.callMethod('onSettings'));
  await delay(1000);
  page = await mp.currentPage();
  console.log('now:', page.path);

  await tryStep('onImport', () => page.callMethod('onImport'));
  await delay(1800);
  page = await mp.currentPage();
  console.log('now:', page.path);

  const data = await tryStep('data', () => page.data());
  if (data && data.sources) console.log('sources:', data.sources.map((s) => s.name));

  await mp.disconnect();
  console.log('DONE');
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
