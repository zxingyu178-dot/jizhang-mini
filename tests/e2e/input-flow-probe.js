// tests/e2e/input-flow-probe.js
// 「记账输入」链路效率探针（只读为主，造的数据跑完即删）。
//
// 现有 real-tap.js A1~F1 验证的是「输入正确性」（金额算对、备注不坏、落库正确）；
// 本探针量的是**效率与可感知性**，即「日常记一笔到底要费多少事」：
//   M1 打开表单首屏，保存按钮是否可见（要不要先滚一下才能存）
//   M2 表单内容比可视区高多少（滚动成本）
//   M3 点「更多」展开分类后，保存按钮被推到哪里、能否收起
//   M4 日期行有没有「昨天 / 前天」快捷入口（补记昨天是高频动作）
//   M5 保存后用户拿到什么反馈（toast / 列表定位 / 是否知道自己记上了）
//   M6 改日期到上月保存后，当前月列表能否看到这笔（会不会以为没记上）
//   M7 连续记同类账：保存后重开，分类与日期是否被继承
//
// 用法：node tests/e2e/input-flow-probe.js
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const { ensureAutomation, sleep } = require('./launcher');

const PREFIX = 'E2E输入链路探针';
const STAGE = path.join(os.tmpdir(), 'jizhang-input-flow-probe');
const log = (...a) => console.log('[probe]', ...a);
const r1 = (v) => Math.round(v * 10) / 10;
const ymOf = (d) => d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);

async function main() {
  const report = {};
  const shots = [];
  const mp = await ensureAutomation(config, log);
  const sleepMs = (ms) => sleep(ms);
  let page;

  const box = async (el) => {
    if (!el) return null;
    const off = await el.offset();
    const sz = await el.size();
    return {
      t: r1(off.top), l: r1(off.left), w: r1(sz.width), h: r1(sz.height),
      b: r1(off.top + sz.height), r: r1(off.left + sz.width),
    };
  };
  const shot = async (name) => { shots.push({ name, data: await mp.screenshot() }); };
  const waitSheet = async (want, timeout = 8000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const d = await page.data();
      if (d.sheetShow === want) return true;
      await sleepMs(150);
    }
    throw new Error('等待 sheetShow=' + want + ' 超时');
  };
  const openSheet = async () => {
    const fab = await page.$('.fab-wrap');
    if (!fab) throw new Error('找不到 FAB');
    await fab.tap();
    await waitSheet(true);
    await sleepMs(800);
    const form = await page.$('#billForm');
    if (!form) throw new Error('找不到 #billForm');
    return form;
  };
  const closeSheet = async () => {
    try { await page.callMethod('onSheetClose'); } catch (e) { /* 忽略 */ }
    await waitSheet(false).catch(() => {});
    await sleepMs(500);
  };
  const formData = async () => mp.evaluate(() => {
    try {
      const p = getCurrentPages();
      const cur = p[p.length - 1];
      const c = cur.selectComponent('#billForm');
      return c ? JSON.parse(JSON.stringify(c.data)) : null;
    } catch (e) { return null; }
  });

  // toast 探针（原生 UI，DOM 查不到，只能拦调用）
  let toastInstalled = false;
  try {
    await mp.mockWxMethod('showToast', function (opt) {
      try {
        const app = getApp();
        app.__probeToasts = (app.__probeToasts || []).concat([String((opt && opt.title) || '')]);
      } catch (e) { /* 忽略 */ }
    });
    await mp.evaluate(() => { getApp().__probeToasts = []; return true; });
    toastInstalled = true;
  } catch (e) { toastInstalled = false; }
  const readToasts = () => mp.evaluate(() => (getApp().__probeToasts || []).slice()).catch(() => []);
  const clearToasts = () => mp.evaluate(() => { getApp().__probeToasts = []; return true; }).catch(() => {});

  // 备份本月 + 上月分片
  const now = new Date();
  const curYM = ymOf(now);
  const prevYM = ymOf(new Date(now.getFullYear(), now.getMonth() - 1, 15));
  const backup = await mp.evaluate((arg) => {
    const fsm = wx.getFileSystemManager();
    const readOne = (ym) => {
      const p = wx.env.USER_DATA_PATH + '/bills/' + ym + '.json';
      try { return { ym, p, raw: String(fsm.readFileSync(p, 'utf8')) }; } catch (e) { return { ym, p, raw: null }; }
    };
    return [readOne(arg.a), readOne(arg.b)];
  }, { a: curYM, b: prevYM });
  fs.mkdirSync(STAGE, { recursive: true });
  fs.writeFileSync(path.join(STAGE, 'ledger-backup.json'), JSON.stringify(backup, null, 2));
  log('分片已备份：' + curYM + ' / ' + prevYM);

  await mp.reLaunch(config.HOME_ROUTE);
  await sleepMs(2600);
  page = await mp.currentPage();
  const view = await page.data();
  const VW = view.windowWidth;
  const VH = view.windowHeight;
  report.view = { VW, VH, safeBottom: view.safeBottom };
  log('视口 ' + VW + '×' + VH);

  if (view.current !== 1) {
    const tabs = await page.$$('.tabs__item');
    await tabs[1].tap();
    await sleepMs(900);
    page = await mp.currentPage();
  }

  /* ============ M1 / M2 首屏可见性与滚动成本 ============ */
  let form = await openSheet();
  const sheetHost = (await page.$$('bottom-sheet'))[0];
  const panel = await box((await sheetHost.$$('.bs-panel'))[0]);
  const scrollEl = (await sheetHost.$$('.bs-scroll'))[0];
  const scrollBox = await box(scrollEl);
  const innerBox = await box((await sheetHost.$$('.bs-body__inner'))[0]);
  const amountBox = await box(await form.$('.bf-amount'));
  const catsBox = await box(await form.$('.bf-cats-grid'));
  const submitBox = await box(await form.$('.bf-submit'));

  report.m1 = {
    panelTop: panel ? panel.t : null,
    panelH: panel ? panel.h : null,
    amount: amountBox,
    cats: catsBox,
    submit: submitBox,
    submitVisible: !!submitBox && submitBox.b <= VH + 0.5,
    submitBelowFoldPx: submitBox ? r1(Math.max(0, submitBox.b - VH)) : null,
  };
  report.m2 = {
    contentH: innerBox ? r1(innerBox.h) : null,
    scrollH: scrollBox ? r1(scrollBox.h) : null,
    overflowH: innerBox && scrollBox ? r1(Math.max(0, innerBox.h - scrollBox.h)) : null,
  };
  log('M1 首屏：保存按钮 bottom=' + (submitBox && submitBox.b) + ' / 视口 ' + VH
    + ' → ' + (report.m1.submitVisible ? '可见' : '需下滚 ' + report.m1.submitBelowFoldPx + 'px'));
  log('M2 内容高=' + report.m2.contentH + ' 可视高=' + report.m2.scrollH + ' 溢出=' + report.m2.overflowH);
  await shot('01_sheet_open');

  /* ============ M4 日期行结构 ============ */
  const rows = [];
  const rowEls = await form.$$('.bf-row');
  for (const el of rowEls) {
    const cls = await el.attribute('class');
    const kids = await el.$$('*');
    rows.push({ cls: String(cls || ''), text: String(await el.text()).trim(), childCount: kids.length });
  }
  const chips = await form.$$('.bf-chip');
  const dateText = await (async () => {
    const el = await form.$('.bf-row__value');
    return el ? String(await el.text()).trim() : null;
  })();
  report.m4 = { rows, chipsCount: chips.length, dateValueText: dateText, hasQuickDate: chips.length > 0 };
  log('M4 表单行 ' + rows.length + ' 行，快捷日期按钮 ' + chips.length + ' 个，日期显示「' + dateText + '」');

  /* ============ M3 展开「更多」 ============ */
  const countCats = async () => {
    const all = await form.$$('.bf-cat');
    let pure = 0;
    for (const el of all) {
      const c = String((await el.attribute('class')) || '');
      if (c.indexOf('bf-cat--more') < 0) pure++;
    }
    return pure;
  };
  const recentCount = await countCats();
  const moreBtn = await form.$('.bf-cat--more');
  if (moreBtn) {
    await moreBtn.tap();
    await sleepMs(700);
    const allCount = await countCats();
    const submitAfter = await box(await form.$('.bf-submit'));
    const innerAfter = await box((await sheetHost.$$('.bs-body__inner'))[0]);
    const moreAfter = (await form.$$('.bf-cat--more')).length;
    const collapseCount = (await form.$$('.bf-cats-collapse')).length;
    report.m3 = {
      recentCount, allCount,
      submitAfter,
      submitBelowFoldAfterPx: submitAfter ? r1(Math.max(0, submitAfter.b - VH)) : null,
      innerHAfter: innerAfter ? r1(innerAfter.h) : null,
      moreBtnStillPresent: moreAfter > 0,
      collapseEntryPresent: collapseCount > 0,
    };
    log('M3 分类 ' + recentCount + ' → ' + allCount + ' 个；展开后保存按钮 bottom='
      + (submitAfter && submitAfter.b) + '（超出视口 ' + report.m3.submitBelowFoldAfterPx
      + 'px）；收起入口=' + (collapseCount > 0));

    // 收起后是否回到首屏可见
    if (collapseCount > 0) {
      await (await form.$('.bf-cats-collapse')).tap();
      await sleepMs(700);
      const collapsedCount = await countCats();
      const submitCollapsed = await box(await form.$('.bf-submit'));
      report.m3.afterCollapse = {
        catCount: collapsedCount,
        submit: submitCollapsed,
        submitVisible: !!submitCollapsed && submitCollapsed.b <= VH + 0.5,
      };
      log('M3 收起后：分类 ' + collapsedCount + ' 个，保存按钮 bottom='
        + (submitCollapsed && submitCollapsed.b) + ' → '
        + (report.m3.afterCollapse.submitVisible ? '首屏可见' : '仍不可见'));
      await shot('02b_more_collapsed');
      // 再展开一次，供后面选一个非默认分类
      await (await form.$('.bf-cat--more')).tap();
      await sleepMs(600);
    }
    await shot('02_more_expanded');
  } else {
    report.m3 = { error: '无「更多」按钮', recentCount };
  }

  // 选一个**非默认**分类（默认是餐饮 c-food），否则「是否继承」会被默认值伪装成通过
  let pickedCat = null;
  try {
    const cats = await form.$$('.bf-cat');
    const cands = [];
    for (const el of cats) {
      const c = String((await el.attribute('class')) || '');
      if (c.indexOf('bf-cat--more') >= 0) continue;
      cands.push(el);
    }
    if (cands.length >= 4) {
      await cands[3].tap();
      await sleepMs(300);
      let d = await formData();
      if (d && d.categoryId === 'c-food' && cands.length >= 5) {
        await cands[4].tap();
        await sleepMs(300);
        d = await formData();
      }
      pickedCat = d ? d.categoryId : null;
    }
  } catch (e) { /* 忽略 */ }
  const dBefore = await formData();
  report.pickedCategoryId = (dBefore && dBefore.categoryId) || pickedCat;
  log('已选分类：' + report.pickedCategoryId + '（默认是 c-food，用于验证保存后是否被沿用）');
  // 收起，回到首屏态再测保存
  try {
    const cb = await form.$('.bf-cats-collapse');
    if (cb) { await cb.tap(); await sleepMs(500); }
  } catch (e) { /* 忽略 */ }

  /* ============ M5 保存后的反馈 ============ */
  await clearToasts();
  const amountInput = await form.$('.bf-amount__input');
  await amountInput.tap();
  await sleepMs(400);
  await amountInput.input('3.21');
  await sleepMs(500);
  const textInputs = await form.$$('.bf-row__input');
  if (textInputs.length >= 2) {
    await textInputs[1].tap();
    await sleepMs(300);
    await textInputs[1].input(PREFIX + '-A');
    await sleepMs(400);
  }
  await clearToasts();
  const submitBefore = await box(await form.$('.bf-submit'));
  const submitBtn = await form.$('.bf-submit');
  await submitBtn.tap();
  await sleepMs(1500);
  const dAfter = await page.data();
  const toastList5 = await readToasts();
  const acc = await page.$('#accountingPanel');
  let tlFirst = null;
  let tlScrollTop = null;
  try {
    const items = await acc.$$('.tl-item');
    if (items.length) tlFirst = String(await items[0].text()).replace(/\s+/g, ' ').trim();
    const sv = await acc.$$('.panel-scroll');
    if (sv.length) tlScrollTop = await sv[0].scrollTop();
  } catch (e) { /* 忽略 */ }
  report.m5 = {
    sheetClosed: dAfter.sheetShow === false,
    toastInstalled,
    toasts: toastList5,
    timelineFirstRow: tlFirst,
    timelineScrollTop: tlScrollTop,
    submitVisibleBeforeTap: submitBefore ? submitBefore.b <= VH + 0.5 : null,
  };
  log('M5 保存后：sheet 关闭=' + (dAfter.sheetShow === false)
    + ' · toast=' + JSON.stringify(toastList5) + ' · 时间线首行=' + JSON.stringify(tlFirst)
    + ' · scrollTop=' + tlScrollTop);
  await sleepMs(400);
  await shot('03_after_save');

  /* ============ M7 重开表单：分类 / 日期是否继承 ============ */
  const form2 = await openSheet();
  const d7 = await formData();
  report.m7 = {
    pickedCategoryId: report.pickedCategoryId,
    categoryIdAfterReopen: d7 ? d7.categoryId : null,
    dateStrAfterReopen: d7 ? d7.dateStr : null,
    amountTextAfterReopen: d7 ? d7.amountText : null,
    merchantAfterReopen: d7 ? d7.merchant : null,
    noteAfterReopen: d7 ? d7.note : null,
    categoryInherited: !!(d7 && d7.categoryId === report.pickedCategoryId),
  };
  log('M7 重开：分类=' + report.m7.categoryIdAfterReopen + '（保存前 ' + report.pickedCategoryId
    + '，继承=' + report.m7.categoryInherited + '）· 日期=' + report.m7.dateStrAfterReopen
    + ' · 金额=' + JSON.stringify(report.m7.amountTextAfterReopen));

  /* ============ M6 跨月保存 ============ */
  const prevDate = prevYM + '-15';
  await form2.callMethod('onDate', { detail: { value: prevDate } });
  await sleepMs(300);
  const amt2 = await form2.$('.bf-amount__input');
  await amt2.tap();
  await sleepMs(300);
  await amt2.input('8.88');
  await sleepMs(400);
  const t2 = await form2.$$('.bf-row__input');
  if (t2.length >= 2) {
    await t2[1].tap();
    await sleepMs(250);
    await t2[1].input(PREFIX + '-B');
    await sleepMs(350);
  }
  await clearToasts();
  const readAcc = () => mp.evaluate(() => {
    try {
      const p = getCurrentPages();
      const cur = p[p.length - 1];
      const c = cur.selectComponent('#accountingPanel');
      return c && c.data ? { ym: c.data.ym, label: c.data.monthLabel } : null;
    } catch (e) { return null; }
  }).catch(() => null);
  const accBefore = await readAcc();
  const heroBefore = accBefore ? accBefore.label : null;
  const submit2 = await form2.$('.bf-submit');
  await submit2.tap();
  await sleepMs(1600);
  const d6 = await page.data();
  const accAfter = await readAcc();
  const toast6 = await readToasts();
  const acc6 = await page.$('#accountingPanel');
  const notes = [];
  try {
    const els = await acc6.$$('.tl-item__note');
    for (const el of els) notes.push(String(await el.text()).trim());
  } catch (e) { /* 忽略 */ }
  report.m6 = {
    targetDate: prevDate,
    heroMonthBefore: heroBefore,
    heroMonthAfter: accAfter ? accAfter.label : null,
    accYmAfter: accAfter ? accAfter.ym : null,
    sheetClosed: d6.sheetShow === false,
    toasts: toast6,
    crossMonthVisibleInCurrentList: notes.indexOf(PREFIX + '-B') >= 0,
    visibleNotes: notes.slice(0, 8),
  };
  log('M6 跨月保存：日期=' + prevDate + ' · Hero 月份 ' + heroBefore + ' → ' + (accAfter && accAfter.label)
    + ' · 当前列表可见=' + report.m6.crossMonthVisibleInCurrentList + ' · toast=' + JSON.stringify(toast6));
  await sleepMs(300);
  await shot('04_cross_month');

  /* ============ 清理 ============ */
  try {
    await closeSheet();
    const removed = await mp.evaluate((arg) => {
      const store = require('../../data/index');
      let n = 0;
      store.rangeBills().forEach((b) => {
        if (b && typeof b.note === 'string' && b.note.indexOf(arg.prefix) === 0) {
          store.deleteBill(b.id);
          n++;
        }
      });
      return n;
    }, { prefix: PREFIX }).catch(() => null);
    log('已删测试账单 ' + removed + ' 笔');
  } catch (e) { log('删除失败：' + (e && e.message)); }

  try {
    await mp.evaluate((arg) => {
      const fsm = wx.getFileSystemManager();
      arg.list.forEach((x) => { if (x.raw != null) { try { fsm.writeFileSync(x.p, x.raw, 'utf8'); } catch (e) { /* 忽略 */ } } });
      return true;
    }, { list: backup });
    log('分片已按备份还原');
  } catch (e) { log('还原失败：' + (e && e.message)); }

  try {
    fs.mkdirSync(STAGE, { recursive: true });
    shots.forEach((s) => fs.writeFileSync(path.join(STAGE, s.name + '.png'), Buffer.from(s.data, 'base64')));
    fs.writeFileSync(path.join(STAGE, 'report.json'), JSON.stringify(report, null, 2));
    log('报告与截图：' + STAGE);
  } catch (e) { log('落盘失败：' + (e && e.message)); }

  try { await mp.restoreWxMethod('showToast'); } catch (e) { /* 忽略 */ }
  try { await mp.disconnect(); } catch (e) { /* 忽略 */ }
  return report;
}

if (require.main === module) {
  main().then((r) => {
    console.log('\n========== 探针结论 ==========');
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  }).catch((e) => {
    console.error('探针失败：' + ((e && e.stack) || e));
    try {
      fs.mkdirSync(STAGE, { recursive: true });
      fs.writeFileSync(path.join(STAGE, 'error.txt'), String((e && e.stack) || e));
    } catch (_) { /* 忽略 */ }
    process.exit(1);
  });
}
