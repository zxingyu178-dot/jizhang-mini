// tests/e2e/input-form-shots.js
// 「记一笔」表单的视觉复查：深色 / 浅色 / 编辑态各留一帧，并读账本确认测试数据已清。
// 只用真实点击 + 文件系统读取；不改业务代码、不长期留数据。
//
// 注：automator 的 evaluate 里 require 相对路径不可用（实测报
// "module '../../data/index.js' is not defined"），因此数据层一律走 getApp().$store。
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const { ensureAutomation, sleep } = require('./launcher');

const STAGE = path.join(os.tmpdir(), 'jizhang-input-form-shots');
const log = (...a) => console.log('[shots]', ...a);

async function main() {
  const mp = await ensureAutomation(config, log);
  const sleepMs = (ms) => sleep(ms);
  const shots = [];

  const ledgerInfo = () => mp.evaluate(() => {
    try {
      const store = getApp().$store;
      const all = store.rangeBills();
      return {
        total: all.length,
        probeLeft: all.filter((b) => typeof b.note === 'string' && b.note.indexOf('E2E输入链路探针') === 0).length,
        tempLeft: all.filter((b) => b.note === '视觉复查临时单').length,
      };
    } catch (e) { return { error: String((e && e.message) || e) }; }
  });

  log('账本（跑前）：' + JSON.stringify(await ledgerInfo()));

  let page = await mp.currentPage();
  if ((await page.data()).current !== 1) {
    const tabs = await page.$$('.tabs__item');
    await tabs[1].tap();
    await sleepMs(900);
    page = await mp.currentPage();
  }

  const openSheet = async () => {
    await (await page.$('.fab-wrap')).tap();
    await sleepMs(1200);
    return page.$('#billForm');
  };
  const closeSheet = async () => {
    try { await page.callMethod('onSheetClose'); } catch (e) { /* 忽略 */ }
    await sleepMs(700);
  };
  const shot = async (name) => {
    await sleepMs(500);
    shots.push({ name, data: await mp.screenshot() });
  };

  /* ---------- 深色 ---------- */
  let form = await openSheet();
  await shot('d1_dark_sheet');
  await (await form.$('.bf-cat--more')).tap();
  await sleepMs(900);
  await shot('d2_dark_expanded');
  await (await form.$('.bf-cats-collapse')).tap();
  await sleepMs(700);

  const chips = await form.$$('.bf-chip');
  log('chip 数量（今天态应为 2）：' + chips.length);
  if (chips.length) {
    await chips[0].tap();
    await sleepMs(600);
    const after = await form.$$('.bf-chip');
    const txt = [];
    for (const c of after) txt.push(String(await c.text()).trim());
    log('切到昨天后的 chip：' + JSON.stringify(txt));
    await shot('d3_dark_yesterday');
  }
  await closeSheet();

  /* ---------- 编辑态 ---------- */
  const tempId = await mp.evaluate(() => {
    try {
      const b = getApp().$store.addBill({
        type: 'expense', amountCents: 1280, categoryId: 'c-food',
        merchant: '瑞幸咖啡', note: '视觉复查临时单', occurredAt: Date.now(),
      });
      return b.id;
    } catch (e) { return 'ERR:' + ((e && e.message) || e); }
  });
  log('临时账单：' + tempId);
  if (tempId && String(tempId).indexOf('ERR:') !== 0) {
    await page.callMethod('refreshPanels').catch(() => {});
    await sleepMs(1000);
    const items = await (await page.$('#accountingPanel')).$$('.tl-item');
    if (items.length) {
      await items[0].tap();
      await sleepMs(1200);
      await shot('d4_dark_edit');
      await closeSheet();
    }
    await mp.evaluate((id) => {
      try { getApp().$store.deleteBill(id); return true; } catch (e) { return false; }
    }, tempId);
    await page.callMethod('refreshPanels').catch(() => {});
    log('临时账单已删除');
  }

  /* ---------- 浅色（走真实 UI：外观页选「浅色」） ---------- */
  await mp.callWxMethod('navigateTo', { url: '/pages/appearance/appearance' });
  await sleepMs(1300);
  let ap = await mp.currentPage();
  const lightRow = await ap.$('.row[data-value="light"]');
  if (!lightRow) throw new Error('外观页找不到「浅色」选项');
  await lightRow.tap();
  await sleepMs(900);
  log('切浅色：themeMode=' + (await ap.data()).themeMode + ' / class=' + (await ap.data()).themeClass);
  await mp.callWxMethod('navigateBack', { delta: 1 });
  await sleepMs(1400);
  page = await mp.currentPage();
  log('返回主页：themeClass=' + (await page.data()).themeClass);
  form = await openSheet();
  await shot('l1_light_sheet');
  await (await form.$('.bf-cat--more')).tap();
  await sleepMs(900);
  await shot('l2_light_expanded');
  await closeSheet();

  /* ---------- 恢复深色（同一 UI 路径） ---------- */
  await mp.callWxMethod('navigateTo', { url: '/pages/appearance/appearance' });
  await sleepMs(1300);
  ap = await mp.currentPage();
  const darkRow = await ap.$('.row[data-value="dark"]');
  if (darkRow) await darkRow.tap();
  await sleepMs(800);
  log('恢复深色：themeMode=' + (await ap.data()).themeMode);
  await mp.callWxMethod('navigateBack', { delta: 1 });
  await sleepMs(1200);

  const finalInfo = await ledgerInfo();
  log('账本（跑后）：' + JSON.stringify(finalInfo));

  fs.mkdirSync(STAGE, { recursive: true });
  shots.forEach((s) => fs.writeFileSync(path.join(STAGE, s.name + '.png'), Buffer.from(s.data, 'base64')));
  log('截图目录：' + STAGE);
  try { await mp.disconnect(); } catch (e) { /* 忽略 */ }
  return finalInfo;
}

if (require.main === module) {
  main().then((r) => { console.log('\nRESULT ' + JSON.stringify(r)); process.exit(0); })
    .catch((e) => { console.error('失败：' + ((e && e.stack) || e)); process.exit(1); });
}
