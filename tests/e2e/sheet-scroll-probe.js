// tests/e2e/sheet-scroll-probe.js
// v1.4.0 UI-01 专项探针：Bottom Sheet 内容区高度预算 / 可滚性验证（只读，不改业务代码）
//
//   1) 390×844 常规内容：量面板 / 内容区 / 保存按钮几何，与改造前对照（几何零变化验证）；
//   2) 超高场景：mock wx.getWindowInfo 返回 windowHeight=568（等价矮屏视口），
//      让预算算出「内容装不下」→ 验证内容区真的能滚、保存按钮能滚到可见；
//   3) 留图三张（normal / overflow 顶 / overflow 滚到底），带 sha1 自证未冻帧。
//
// 用法：
//   node tests/e2e/sheet-scroll-probe.js
//   PROBE_TAG=before|after   截图与报告前缀（默认 after）
//   PROBE_STAGE=<dir>        截图暂存目录（默认系统临时目录）
//
// 铁律：测试期间不往项目目录写文件（会触发 IDE 自动重编译、打断 automator 会话），
//      截图与报告先落系统临时目录，disconnect 之后再归档。
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const config = require('./config');
const { ensureAutomation, sleep } = require('./launcher');

const TAG = process.env.PROBE_TAG || 'after';
const STAGE_DIR = process.env.PROBE_STAGE || path.join(os.tmpdir(), 'jizhang-mini-sheet-probe');

const logs = [];
const log = (m) => {
  const s = String(m);
  logs.push(s);
  console.log(s);
};
const r1 = (v) => Math.round(v * 10) / 10;
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);

const shots = [];
async function shot(mp, name) {
  const data = await mp.screenshot();
  const buf = Buffer.from(data, 'base64');
  const h = sha1(buf);
  shots.push({ name: 'v1.4.0_' + name + '_' + TAG, buf });
  log('  截图 ' + name + ' sha1=' + h);
  return h;
}

async function box(el) {
  if (!el) return null;
  const o = await el.offset();
  const s = await el.size();
  return {
    l: r1(o.left), t: r1(o.top), w: r1(s.width), h: r1(s.height),
    r: r1(o.left + s.width), b: r1(o.top + s.height),
  };
}

/** 保存按钮在 slot 内的 bill-form 里，跨组件边界，需逐层进（page.$ 直接选拿不到） */
async function findSave(page, sheet) {
  try {
    const dbg = await page.$('.dbg__save');
    if (dbg) return dbg;
  } catch (e) {
    /* 继续尝试下一种 */
  }
  try {
    const forms = (await sheet.$$('bill-form')) || [];
    for (const f of forms) {
      const el = await f.$('.bf-submit');
      if (el) return el;
    }
  } catch (e) {
    /* 继续尝试下一种 */
  }
  try {
    const byId = await page.$('#billForm');
    if (byId) {
      const el = await byId.$('.bf-submit');
      if (el) return el;
    }
  } catch (e) {
    /* 继续 */
  }
  try {
    return (await page.$('.bf-submit')) || null;
  } catch (e) {
    return null;
  }
}

/** 量一个 sheet 的关键几何（面板 / 内容区外壳 / 滚动内容自然高 / 保存按钮） */
async function measureSheet(page, sheet) {
  const panelEl = (await sheet.$$('.bs-panel'))[0];
  const bodyEl = (await sheet.$$('.bs-body'))[0];
  const scrollEl = (await sheet.$$('.bs-scroll'))[0];
  const innerEl = (await sheet.$$('.bs-body__inner'))[0];
  const saveEl = await findSave(page, sheet);
  const panel = await box(panelEl);
  const body = await box(bodyEl);
  const scrollBox = await box(scrollEl);
  const inner = await box(innerEl);
  const save = await box(saveEl);
  const data = await sheet.data();
  return {
    panel, body, scroll: scrollBox, inner, save,
    state: { bodyH: data.bodyH, scrollable: data.scrollable, visible: data.visible },
    // 保存按钮底边相对面板底边：>0 表示按钮被挤出面板（不可达）
    saveBottomVsPanel: panel && save ? r1(save.b - panel.b) : null,
    // 面板内可滚动余量：内容自然高 - 滚动区高
    scrollOverflow: inner && scrollBox ? r1(inner.h - scrollBox.h) : null,
  };
}

async function main() {
  const mp = await ensureAutomation(config, log);
  const report = { tag: TAG, startedAt: new Date().toISOString(), stageDir: STAGE_DIR, logs: null, error: null };
  const consoleLogs = [];
  mp.on('console', (e) => consoleLogs.push(e));

  try {
    await mp.callWxMethod('reLaunch', { url: config.HOME_ROUTE });
    await sleep(3000);
    let page = await mp.currentPage();
    const d0 = await page.data();
    report.viewport = { w: d0.windowWidth, h: d0.windowHeight, safeBottom: d0.safeBottom };
    log('视口：' + d0.windowWidth + '×' + d0.windowHeight + ' · safeBottom=' + d0.safeBottom);

    const openBillSheet = async () => {
      const tabs = await page.$$('.tabs__item');
      if (tabs && tabs.length > 1) {
        await tabs[1].tap(); // 记账 Tab
        await sleep(1200);
      }
      const fab = await page.$('.fab-wrap');
      if (!fab) throw new Error('找不到记账 FAB');
      await fab.tap();
      await sleep(1500);
      const sheets = await page.$$('bottom-sheet');
      if (!sheets || !sheets.length) throw new Error('弹层未出现');
      return sheets[0];
    };

    const closeBillSheet = async () => {
      try {
        await page.callMethod('onSheetClose');
      } catch (e) {
        log('关闭弹层失败：' + ((e && e.message) || e));
      }
      await sleep(1000);
    };

    /* ---------- 1. 常规内容（真实视口） ---------- */
    let sheet = await openBillSheet();
    report.normal = await measureSheet(page, sheet);
    report.normal.sha1 = await shot(mp, 'sheet_normal');
    log('常规态：面板 h=' + (report.normal.panel && report.normal.panel.h) +
      ' · 滚动区 h=' + (report.normal.scroll && report.normal.scroll.h) +
      ' · 内容自然高=' + (report.normal.inner && report.normal.inner.h) +
      ' · 保存按钮距面板底=' + report.normal.saveBottomVsPanel +
      ' · bodyH=' + report.normal.state.bodyH + ' scrollable=' + report.normal.state.scrollable);
    await closeBillSheet();

    /* ---------- 2. 超高场景：临时自检页（真实超高内容，不靠 mock） ---------- */
    // 说明：390×844 下现有业务弹层最高 685.7px < 743px（88% 上限），不存在天然超高；
    // 临时页 pages/__sheetdebug 造 30 行内容（≈936px）验证滚动链路，验证后删除该页。
    await mp.callWxMethod('navigateTo', { url: '/pages/__sheetdebug/sheet-debug' });
    await sleep(2600);
    page = await mp.currentPage();
    log('临时超高页：' + page.path);
    const dbgSheets = await page.$$('bottom-sheet');
    if (!dbgSheets || !dbgSheets.length) throw new Error('临时页弹层未出现');
    sheet = dbgSheets[0];

    report.overflowTop = await measureSheet(page, sheet);
    report.overflowTop.sha1 = await shot(mp, 'sheet_overflow_top');
    log('超高态（未滚）：面板 h=' + (report.overflowTop.panel && report.overflowTop.panel.h) +
      ' · 滚动区 h=' + (report.overflowTop.scroll && report.overflowTop.scroll.h) +
      ' · 内容自然高=' + (report.overflowTop.inner && report.overflowTop.inner.h) +
      ' · 保存按钮 t=' + (report.overflowTop.save && report.overflowTop.save.t) +
      ' b=' + (report.overflowTop.save && report.overflowTop.save.b) +
      ' · bodyH=' + report.overflowTop.state.bodyH + ' scrollable=' + report.overflowTop.state.scrollable);

    // 滚到底：验证底部按钮可以滚到面板内（可达）
    const scrollEls = await sheet.$$('.bs-scroll');
    let scrollOk = false;
    if (scrollEls && scrollEls.length) {
      try {
        await scrollEls[0].scrollTo(0, 4000);
        scrollOk = true;
      } catch (e) {
        log('scrollTo 失败：' + ((e && e.message) || e));
      }
    }
    await sleep(900);
    report.overflowScrolled = await measureSheet(page, sheet);
    report.overflowScrolled.scrollOk = scrollOk;
    report.overflowScrolled.sha1 = await shot(mp, 'sheet_overflow_scrolled');
    log('超高态（滚到底）：面板 h=' + (report.overflowScrolled.panel && report.overflowScrolled.panel.h) +
      ' · 保存按钮 t=' + (report.overflowScrolled.save && report.overflowScrolled.save.t) +
      ' b=' + (report.overflowScrolled.save && report.overflowScrolled.save.b) +
      ' · 距面板底=' + report.overflowScrolled.saveBottomVsPanel +
      ' · scrollTo=' + scrollOk);

    // 判定：滚到底后保存按钮完整落在面板内且落在屏幕内
    const sv = report.overflowScrolled.save;
    const pv = report.overflowScrolled.panel;
    const topSave = report.overflowTop.save;
    const cap = (d0.windowHeight || 844) * 0.88; // 742.72 @390×844，面板 CSS max-height:88%
    report.checks = {
      viewportH: d0.windowHeight,
      // 面板是否守住了 88% 上限
      panelCap: r1(cap),
      panelFitsCap: !!pv && pv.h <= cap + 0.5,
      panelHeight: pv ? pv.h : null,
      // 滚动区是否小于内容（= 真的需要滚）
      scrollAreaH: report.overflowScrolled.scroll ? report.overflowScrolled.scroll.h : null,
      contentNaturalH: report.overflowScrolled.inner ? report.overflowScrolled.inner.h : null,
      needsScroll: !!report.overflowScrolled.inner && !!report.overflowScrolled.scroll
        ? report.overflowScrolled.inner.h > report.overflowScrolled.scroll.h : null,
      // 滚动是否真的移动了按钮
      scrollDelta: topSave && sv ? r1(topSave.t - sv.t) : null,
      saveInsidePanel: !!sv && !!pv && sv.t >= pv.t - 0.5 && sv.b <= pv.b + 0.5,
    };
    report.reachable =
      report.checks.panelFitsCap && report.checks.needsScroll === true && report.checks.saveInsidePanel === true;
    log('判定：面板高 ' + report.checks.panelHeight + '（上限 ' + report.checks.panelCap + '，符合=' +
      report.checks.panelFitsCap + '）· 滚动区 ' + report.checks.scrollAreaH + ' / 内容 ' +
      report.checks.contentNaturalH + ' · 滚动位移 ' + report.checks.scrollDelta +
      ' · 按钮落在面板内=' + report.checks.saveInsidePanel);
    log('保存按钮滚动后可达：' + (report.reachable ? '是' : '否'));

    // 退出临时页（页面本身稍后整体删除）
    try {
      await mp.callWxMethod('navigateBack', { delta: 1 });
      await sleep(800);
    } catch (e) {
      log('退出临时页失败：' + ((e && e.message) || e));
    }
  } catch (e) {
    report.error = (e && e.message) || String(e);
    log('探针异常：' + report.error);
  } finally {
    report.logs = logs;
    report.console = consoleLogs.map((c) => (typeof c === 'string' ? c : JSON.stringify(c))).slice(0, 40);
    try {
      mp.disconnect();
    } catch (e) {
      log('disconnect 异常：' + ((e && e.message) || e));
    }
    await sleep(400);

    fs.mkdirSync(STAGE_DIR, { recursive: true });
    shots.forEach((s) => fs.writeFileSync(path.join(STAGE_DIR, s.name + '_simulator.png'), s.buf));
    fs.writeFileSync(
      path.join(STAGE_DIR, 'v1.4.0_sheet-probe-' + TAG + '.json'),
      JSON.stringify(report, null, 2),
      'utf8'
    );
    log('已归档 ' + shots.length + ' 张截图 + 报告到 ' + STAGE_DIR);
    process.exit(report.error ? 1 : 0);
  }
}

main();
