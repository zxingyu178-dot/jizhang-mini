// tests/e2e/ui-layout-probe.js
// v1.4.0 UI 兼容巡检探针（只读，不改业务代码）：
//   1) 逐页量关键节点的 boundingClientRect（offset/size），供离线判断横向溢出、
//      数字截断、按钮挤压、Header 换行；
//   2) 打开 Bottom Sheet 量「面板高度 vs 内容高度」，验证弹窗是否可滚 / 底部按钮是否被裁；
//   3) 高风险页留图（深色 / 浅色各一张），带 sha1 自证是否冻帧（铁律 7）。
//
// 用法：
//   node tests/e2e/ui-layout-probe.js
//   PROBE_STAGE=<dir> 覆盖截图暂存目录（默认系统临时目录下的 jizhang-mini-ui-probe）
// 铁律：截图与报告都不在测试期间写进项目目录（会触发 IDE 自动重编译、杀死会话），
//       disconnect 之后再落盘到暂存目录，由人工挑选复制进 docs/screenshots。
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const config = require('./config');
const { ensureAutomation, sleep } = require('./launcher');

const STAGE_DIR = process.env.PROBE_STAGE || path.join(os.tmpdir(), 'jizhang-mini-ui-probe');

const report = {
  startedAt: new Date().toISOString(),
  stageDir: STAGE_DIR,
  systemInfo: null,
  pages: {},
  sheets: {},
  shots: [],
  consoleLogs: [],
  exceptions: [],
  error: null,
};

const logs = [];
const log = (m) => { const s = String(m); logs.push(s); console.log(s); };
const r1 = (v) => Math.round(v * 10) / 10;
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);

const shots = [];
async function shot(mp, name) {
  const data = await mp.screenshot();
  const buf = Buffer.from(data, 'base64');
  const h = sha1(buf);
  shots.push({ name, buf, h });
  report.shots.push({ name: name + '_simulator', sha1: h });
  log('  截图 ' + name + ' sha1=' + h);
  return h;
}

/** 量一组选择器：返回 left/top/width/height/right/bottom */
async function measure(page, selectors) {
  const out = {};
  for (const s of selectors) {
    try {
      const el = await page.$(s);
      if (!el) { out[s] = null; continue; }
      const off = await el.offset();
      const sz = await el.size();
      out[s] = {
        l: r1(off.left), t: r1(off.top),
        w: r1(sz.width), h: r1(sz.height),
        r: r1(off.left + sz.width), b: r1(off.top + sz.height),
      };
    } catch (e) {
      out[s] = { error: (e && e.message) || String(e) };
    }
  }
  return out;
}

/** 页面级横向溢出判据：任一节点的 right 超过窗口宽度即记 overflow。 */
function findOverflow(rects, winW) {
  const bad = [];
  Object.keys(rects).forEach((k) => {
    const v = rects[k];
    if (!v || v.error || typeof v.r !== 'number') return;
    if (v.r > winW + 0.5) bad.push({ sel: k, right: v.r, over: r1(v.r - winW) });
  });
  return bad;
}

async function main() {
  const mp = await ensureAutomation(config, log);
  const consoleLogs = [];
  const exceptions = [];
  mp.on('console', (e) => consoleLogs.push(e));
  mp.on('exception', (e) => exceptions.push(e));

  try {
    const cur = await mp.currentPage();
    const d0 = await cur.data();
    report.systemInfo = {
      windowWidth: d0.windowWidth,
      windowHeight: d0.windowHeight,
      statusBarHeight: d0.statusBarHeight,
      navBarHeight: d0.navBarHeight,
      headerHeight: d0.headerHeight,
      menuPad: d0.menuPad,
      headerCompact: d0.headerCompact,
    };
    const winW = d0.windowWidth || 375;
    log('窗口：' + winW + '×' + d0.windowHeight + ' · headerCompact=' + d0.headerCompact + ' · menuPad=' + d0.menuPad);

    /* ---------- 1. 主界面（首帧最新鲜） ---------- */
    // 注意：冷启动首帧时 Hero 面板还没加载完，会被拍成空白卡 —— 只作时序证据，
    // 不用作「主界面」归档图；真正的主界面图在最后回到首页、等面板加载完再拍。
    await shot(mp, 'v1.4.0_main_firstframe');
    let page = cur;
    let rects = await measure(page, [
      '.header', '.header__bar', '.header__title', '.header__search',
      '.header__search-text', '.header__setting', '.tabs',
    ]);
    report.pages.main = { windowWidth: winW, rects, overflow: findOverflow(rects, winW) };

    // 切到统计 Tab：同时验证「截图是否冻帧」（切 Tab 后 sha1 变化 = 未冻帧）
    const tabs = await page.$$('.tabs__item');
    if (tabs && tabs.length) {
      await tabs[0].tap();
      await sleep(1500);
    }
    const hStat = await shot(mp, 'v1.4.0_statistics_dark');
    report.pages.mainTabSwitchFrameChanged = hStat !== report.shots[0].sha1;

    rects = await measure(page, [
      '.month-title__text', '.hero__big', '.hero__half', '.share-row__amount',
      '.share-row__percent', '.cmp-val', '.pace__val', '.seg__item',
    ]);
    report.pages.statistics = { windowWidth: winW, rects, overflow: findOverflow(rects, winW) };

    // 记账 Tab：Hero 大金额 + 时间线
    if (tabs && tabs.length) {
      await tabs[1].tap();
      await sleep(1200);
    }
    await shot(mp, 'v1.4.0_accounting_dark');
    rects = await measure(page, ['.hero__expense', '.hero__sub-val', '.tl-item__amount', '.fab-wrap']);
    report.pages.accounting = { windowWidth: winW, rects, overflow: findOverflow(rects, winW) };

    // 记账表单 Bottom Sheet（金额 + 分类网格 + 提交）
    const fab = await page.$('.fab-wrap');
    if (fab) {
      await fab.tap();
      await sleep(1400);
      const sheets = await page.$$('bottom-sheet');
      const sheet = sheets[0];
      if (sheet) {
        const inner = await sheet.$$('.bs-body');
        const panel = (await sheet.$$('.bs-panel'))[0];
        const prect = panel ? { o: await panel.offset(), s: await panel.size() } : null;
        const bodyRect = inner[0] ? { o: await inner[0].offset(), s: await inner[0].size() } : null;
        const formRects = await measure(page, ['.bf-submit', '.bf-amount__input', '.bf-cat']);
        report.sheets.billForm = {
          data: await sheet.data(),
          panel: prect && { t: r1(prect.o.top), h: r1(prect.s.height), b: r1(prect.o.top + prect.s.height) },
          body: bodyRect && { h: r1(bodyRect.s.height) },
          rects: formRects,
          overflow: findOverflow(formRects, winW),
        };
        await shot(mp, 'v1.4.0_billform_dark');
      }
      // 关闭：直接调页面方法（点遮罩会命中面板本身，实测遮罩点击不可靠）
      try {
        await page.callMethod('onSheetClose');
      } catch (e) {
        const mask = await page.$('.bs-mask');
        if (mask) { await mask.tap(); }
      }
      await sleep(1000);
    }

    /* ---------- 2. 二级页 ---------- */
    const pages = [
      { route: '/pages/budget-settings/budget-settings', key: 'budget', ready: '.bs2-page', sels: ['.bs2-amount__input', '.bs2-amount__unit', '.bs2-amount__done', '.bs2-row__val', '.bs2-save'] },
      { route: '/pages/search/search', key: 'search', ready: '.search-page', sels: ['.s-input', '.s-filters__row', '.f-chip', '.f-chip--wide'] },
      { route: '/pages/recurring/recurring', key: 'recurring', ready: '.rc-page', sels: ['.rc-card__amount', '.rc-card__sub', '.rc-add'] },
      { route: '/pages/category-manage/category-manage', key: 'category', ready: '.cm-page', sels: ['.cm-row__name', '.cm-add', '.ce'] },
      { route: '/pages/settings/settings', key: 'settings', ready: '.settings-page', sels: ['.row__label', '.row__hint', '.row__right'] },
      { route: '/pages/backup-restore/backup-restore', key: 'backup', ready: '.br-page', sels: ['.br-action__sub', '.br-info__val'] },
    ];

    for (const p of pages) {
      // 回主页清栈（不 reLaunch）
      try {
        const stack = await mp.pageStack();
        if (Array.isArray(stack) && stack.length > 1) {
          await mp.callWxMethod('navigateBack', { delta: stack.length - 1 });
          await sleep(1200);
        }
      } catch (e) { /* 忽略 */ }
      await mp.callWxMethod('navigateTo', { url: p.route });
      await sleep(1200);
      const pg = await mp.currentPage();
      const dd = await pg.data();
      rects = await measure(pg, p.sels);
      report.pages[p.key] = {
        windowWidth: dd.windowWidth || winW,
        rects,
        overflow: findOverflow(rects, dd.windowWidth || winW),
      };
      // 底部安全区实测：内容末尾元素底边距屏幕底的距离（< safeBottom 即被指示条压住）
      if (p.key === 'settings') {
        const cards = await pg.$$('.glass-card.sec');
        const last = cards[cards.length - 1];
        if (last) {
          const o = await last.offset();
          const s = await last.size();
          report.pages.settings.lastCardBottomGap = r1((dd.windowHeight || 844) - (o.top + s.height));
        }
      }
      if (p.key === 'category' && rects['.cm-add']) {
        report.pages.category.addBtnBottomGap = r1((dd.windowHeight || 844) - rects['.cm-add'].b);
      }
      if (p.key === 'recurring') {
        const foot = await measure(pg, ['.rc-foot']);
        report.pages.recurring.footHeight = foot['.rc-foot'] ? foot['.rc-foot'].h : null;
      }
      await shot(mp, 'v1.4.0_' + p.key + '_dark');

      // 周期页：打开编辑器 Sheet 量可滚性
      if (p.key === 'recurring') {
        const add = await pg.$('.rc-add');
        const es = await pg.$('empty-state');
        try {
          if (add) await add.tap();
          else if (es) {
            const actions = await es.$$('.es__action');
            if (actions[0]) await actions[0].tap();
          }
          await sleep(1400);
          const sheets = await pg.$$('bottom-sheet');
          const sheet = sheets[sheets.length - 1];
          if (sheet) {
            const panel = (await sheet.$$('.bs-panel'))[0];
            const body = (await sheet.$$('.bs-body'))[0];
            const prect = panel ? { o: await panel.offset(), s: await panel.size() } : null;
            const brect = body ? { o: await body.offset(), s: await body.size() } : null;
            const inner = await measure(pg, ['.re-save', '.re-delete', '.re-chips']);
            report.sheets.recurring = {
              data: await sheet.data(),
              panel: prect && { t: r1(prect.o.top), h: r1(prect.s.height), b: r1(prect.o.top + prect.s.height) },
              body: brect && { t: r1(brect.o.top), h: r1(brect.s.height), b: r1(brect.o.top + brect.s.height) },
              rects: inner,
              // 内容底边是否越过面板底边 = 底部按钮被裁（Skyline 下 overflow:auto 不滚动）
              saveBottomVsPanel: (prect && inner['.re-save'])
                ? r1(inner['.re-save'].b - (prect.o.top + prect.s.height)) : null,
            };
            await shot(mp, 'v1.4.0_recurring_sheet_dark');
            const mask = await pg.$('.bs-mask');
            if (mask) { await mask.tap(); await sleep(800); }
          }
        } catch (e) {
          log('周期 Sheet 探测失败：' + ((e && e.message) || e));
        }
      }

      // 分类管理：打开编辑器 Sheet 量 Emoji / 图标网格
      if (p.key === 'category') {
        try {
          const addBtn = await pg.$('.cm-add');
          if (addBtn) {
            await addBtn.tap();
            await sleep(1300);
            const sheets = await pg.$$('bottom-sheet');
            const sheet = sheets[sheets.length - 1];
            if (sheet) {
              const panel = (await sheet.$$('.bs-panel'))[0];
              const prect = panel ? { o: await panel.offset(), s: await panel.size() } : null;
              const inner = await measure(pg, ['.ce__save', '.ce__emoji-input', '.ce__tab']);
              report.sheets.category = {
                data: await sheet.data(),
                panel: prect && { t: r1(prect.o.top), h: r1(prect.s.height), b: r1(prect.o.top + prect.s.height) },
                rects: inner,
                saveBottomVsPanel: (prect && inner['.ce__save'])
                  ? r1(inner['.ce__save'].b - (prect.o.top + prect.s.height)) : null,
              };
              await shot(mp, 'v1.4.0_category_sheet_dark');
              const mask = await pg.$('.bs-mask');
              if (mask) { await mask.tap(); await sleep(700); }
            }
          }
        } catch (e) {
          log('分类 Sheet 探测失败：' + ((e && e.message) || e));
        }
      }
    }

    /* ---------- 3. 浅色主题复拍关键页 ---------- */
    // 回主页 → 设置 → 外观 → 浅色；再逐页复拍（验证深浅尺寸一致）
    try {
      const stack = await mp.pageStack();
      if (Array.isArray(stack) && stack.length > 1) {
        await mp.callWxMethod('navigateBack', { delta: stack.length - 1 });
        await sleep(1000);
      }
      await mp.callWxMethod('navigateTo', { url: '/pages/appearance/appearance' });
      await sleep(1200);
      const ap = await mp.currentPage();
      const ad0 = await ap.data();
      const opts = await ap.$$('.ap-page .row');
      const lightIdx = (ad0.options || []).findIndex((o) => o.value === 'light');
      const darkIdx = (ad0.options || []).findIndex((o) => o.value === 'dark');
      if (opts && opts.length && lightIdx >= 0) {
        await opts[lightIdx].tap(); // OPTIONS 顺序：system / dark / light
        await sleep(1200);
        const ad = await ap.data();
        report.lightSwitch = {
          themeMode: ad.themeMode, themeClass: ad.themeClass, options: opts.length,
        };
        log('浅色切换：' + JSON.stringify(report.lightSwitch));
      }
      // 复拍预算页与搜索页（浅色）
      for (const p of [
        { route: '/pages/budget-settings/budget-settings', key: 'budget' },
        { route: '/pages/recurring/recurring', key: 'recurring' },
        { route: '/pages/search/search', key: 'search' },
      ]) {
        await mp.callWxMethod('navigateBack', { delta: 1 });
        await sleep(900);
        await mp.callWxMethod('navigateTo', { url: p.route });
        await sleep(1200);
        await shot(mp, 'v1.4.0_' + p.key + '_light');
      }
      // 回主页拍一张浅色（常驻首页可能冻帧，用 sha1 自证）
      await mp.callWxMethod('navigateBack', { delta: 1 });
      await sleep(2500); // 等面板数据加载完，避免拍到空白 Hero
      const hl = await shot(mp, 'v1.4.0_main_light');
      report.lightMainFrameChanged = hl !== report.shots[0].sha1;

      // 复原成深色（不把测试用的浅色设置留在用户数据里）
      await mp.callWxMethod('navigateTo', { url: '/pages/appearance/appearance' });
      await sleep(1200);
      const ap2 = await mp.currentPage();
      const ad2 = await ap2.data();
      const opts2 = await ap2.$$('.ap-page .row');
      const darkIdx2 = (ad2.options || []).findIndex((o) => o.value === 'dark');
      if (opts2 && opts2.length && darkIdx2 >= 0) {
        await opts2[darkIdx2].tap();
        await sleep(1000);
        const ad3 = await ap2.data();
        report.themeRestored = { themeMode: ad3.themeMode, themeClass: ad3.themeClass };
        log('主题复原：' + JSON.stringify(report.themeRestored));
      }
      await mp.callWxMethod('navigateBack', { delta: 1 });
      await sleep(800);
      // 回首页等面板加载完再拍主界面图（首帧 Hero 未加载，不能当交付图）
      await sleep(2000);
      const home = await mp.currentPage();
      const hd = await home.data();
      const hRects = await measure(home, [
        '.header__bar', '.header__title', '.header__search', '.header__search-text', '.header__setting',
      ]);
      report.pages.mainReady = {
        windowWidth: hd.windowWidth,
        headerCompact: hd.headerCompact,
        menuPad: hd.menuPad,
        rects: hRects,
        overflow: findOverflow(hRects, hd.windowWidth || winW),
        contentRightVsCapsule: hRects['.header__setting']
          ? r1((hd.windowWidth || winW) - (hd.menuPad || 0) - hRects['.header__setting'].r) : null,
      };
      await shot(mp, 'v1.4.0_main_dark');
    } catch (e) {
      report.lightSwitchError = (e && e.message) || String(e);
      log('浅色主题复拍失败：' + report.lightSwitchError);
    }
  } catch (e) {
    report.error = (e && e.message) || String(e);
    log('探针异常：' + report.error);
  } finally {
    report.consoleLogs = consoleLogs.map((c) => (typeof c === 'string' ? c : JSON.stringify(c))).slice(0, 40);
    report.exceptions = exceptions.map((c) => (typeof c === 'string' ? c : JSON.stringify(c))).slice(0, 20);
    report.logs = logs;
    try { mp.disconnect(); } catch (e) { log('disconnect 异常：' + e.message); }
    await sleep(400);

    fs.mkdirSync(STAGE_DIR, { recursive: true });
    shots.forEach((s) => fs.writeFileSync(path.join(STAGE_DIR, s.name + '_simulator.png'), s.buf));
    fs.writeFileSync(path.join(STAGE_DIR, 'v1.4.0_ui-probe-report.json'), JSON.stringify(report, null, 2), 'utf8');
    log('已归档 ' + shots.length + ' 张截图 + 报告到 ' + STAGE_DIR);
    process.exit(report.error ? 1 : 0);
  }
}

main();
