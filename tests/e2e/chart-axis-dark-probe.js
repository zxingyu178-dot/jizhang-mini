// tests/e2e/chart-axis-dark-probe.js
// v1.4.4 深色主题坐标轴「补证」实拍（2026-11-10 返工）
//
// 背景：chart-axis-probe.js 的场景 1 直接拍「-dark」，但从未先把主题切到深色，
// 结果三张 -dark 实为浅色（axis-01 与 axis-04 像素差异仅 48/447265）。
// 本脚本补上这段证据链：
//   1. 进外观页 → 点 index 1（深色，见 pages/appearance/appearance.js OPTIONS）→
//      截图设置项本身（勾选态可见），并断言 themeMode/effectiveTheme = dark；
//   2. 回主页统计面板，拍 daily / cumulative / year-monthly 三张深色图，
//      每张都断言根容器 themeClass 为 theme-dark（不能只靠肉眼）；
//   3. 跑完恢复账单分片，主题保持深色（默认值，不回切浅色）。
// 运行：node tests/e2e/chart-axis-dark-probe.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const { ensureAutomation, sleep } = require('./launcher');

const OUT_DIR = process.env.AXIS_SHOT_DIR
  || path.join(config.ARTIFACTS_ROOT, 'chart-axis', new Date().toISOString().replace(/[:.]/g, '-'));
// 截图先落系统临时目录：写进项目目录会触发 IDE 重编译、automator WebSocket 失步
const STAGE_DIR = path.join(os.tmpdir(), 'dailyvalue-axis-dark-shots');
const REPORT = path.join(OUT_DIR, 'dark-report.json');
const report = { shots: [], data: {}, asserts: [], notes: [] };

const THEME_OPTIONS = ['跟随系统', '深色', '浅色'];
const DARK_INDEX = THEME_OPTIONS.indexOf('深色');

function ymOf(d) {
  return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
}

function buildNormalBills(now) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const cats = ['c-food', 'c-transport', 'c-shopping', 'c-entertainment', 'c-home'];
  const days = Math.min(now.getDate(), 26);
  const bills = [];
  let seq = 0;
  for (let d = 1; d <= days; d++) {
    const n = 1 + (d % 3);
    for (let k = 0; k < n; k++) {
      seq += 1;
      const ts = new Date(y, m, d, 9 + k * 3, 10).getTime();
      bills.push({
        id: 'e2e-axis-' + seq,
        type: 'expense',
        amountCents: 680 + d * 137 + k * 2450,
        categoryId: cats[(d + k) % cats.length],
        occurredAt: ts,
        title: '',
        merchant: 'axis 商户' + d,
        note: '',
        source: 'manual',
        sourceTxnId: null,
        importBatchId: null,
        createdAt: ts,
        updatedAt: ts,
        ledgerImpact: 'normal',
      });
    }
  }
  return bills;
}

async function shot(mp, name) {
  const b64 = await mp.screenshot();
  fs.mkdirSync(STAGE_DIR, { recursive: true });
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(path.join(STAGE_DIR, name + '.png'), buf);
  report.shots.push({ name: name, file: path.join(OUT_DIR, name + '.png'), bytes: buf.length });
  console.log('[dark] 截图 ' + name + ' (' + Math.round(buf.length / 1024) + 'KB)');
}

function assert(label, cond, detail) {
  const ok = !!cond;
  report.asserts.push({ label: label, ok: ok, detail: detail });
  console.log('[dark] ' + (ok ? '✓' : '✗') + ' ' + label + (detail ? ' — ' + detail : ''));
  if (!ok) throw new Error('断言失败：' + label + (detail ? '（' + detail + '）' : ''));
}

async function backupShard(mp, ym) {
  return mp.evaluate((ymArg) => {
    const fsm = wx.getFileSystemManager();
    const p = wx.env.USER_DATA_PATH + '/bills/' + ymArg + '.json';
    let before = null;
    try {
      const raw = String(fsm.readFileSync(p, 'utf8'));
      let obj = null;
      try { obj = JSON.parse(raw); } catch (e) { obj = null; }
      if (obj && Array.isArray(obj.bills)) {
        obj.bills = obj.bills.filter((b) => !(b && typeof b.id === 'string' && b.id.indexOf('e2e-axis-') === 0));
        before = JSON.stringify(obj, null, 2);
      } else {
        before = raw;
      }
    } catch (e) { before = null; }
    return { path: p, before: before };
  }, ym);
}

async function writeShard(mp, shardPath, ym, bills) {
  await mp.evaluate((arg) => {
    const fsm = wx.getFileSystemManager();
    try { fsm.mkdirSync(wx.env.USER_DATA_PATH + '/bills', true); } catch (e) { /* 已存在 */ }
    fsm.writeFileSync(arg.path, JSON.stringify({ ym: arg.ym, version: 3, bills: arg.bills }, null, 2), 'utf8');
    return true;
  }, { path: shardPath, ym: ym, bills: bills });
}

async function restoreShard(mp, backup) {
  if (!backup) return false;
  for (let i = 0; i < 3; i++) {
    try {
      await mp.evaluate((arg) => {
        const fsm = wx.getFileSystemManager();
        if (arg.before === null) {
          try { fsm.unlinkSync(arg.path); } catch (e) { /* 本来没有 */ }
        } else {
          fsm.writeFileSync(arg.path, arg.before, 'utf8');
        }
        return true;
      }, backup);
      return true;
    } catch (e) {
      await sleep(1200);
    }
  }
  return false;
}

async function openStatsPanel(mp) {
  await mp.reLaunch(config.HOME_ROUTE);
  await sleep(1800);
  const page = await mp.currentPage();
  const tabs = await page.$$('.tabs__item');
  if (tabs && tabs[0]) await tabs[0].tap();
  await sleep(1200);
  return page;
}

async function enableModule(panel, id) {
  await panel.callMethod('onToggleModule', {
    currentTarget: { dataset: { id: id } },
    detail: { value: true },
  });
  await sleep(320);
}

async function scrollTo(panel, id) {
  await panel.setData({ scrollInto: id });
  await sleep(700);
}

/**
 * 采集元素矩形（CSS px）：对比度脚本要靠它精确裁到「刻度文字 / 网格线 / 卡片底色」，
 * 而不是靠肉眼猜坐标。失败只记录，不影响截图。
 */
async function collectRects(scope, rootSelector, tickSel, gridSel, label) {
  const out = { label: label, ticks: [], grids: [] };
  const root = await scope.$(rootSelector);
  if (!root) return out;
  out.root = await root.offset().catch(() => null);
  const tickEls = await root.$$(tickSel).catch(() => []);
  for (const el of tickEls) {
    const o = await el.offset().catch(() => null);
    const txt = await el.text().catch(() => '');
    if (o) out.ticks.push({ text: txt, rect: o });
  }
  const gridEls = await root.$$(gridSel).catch(() => []);
  for (const el of gridEls) {
    const o = await el.offset().catch(() => null);
    if (o) out.grids.push({ rect: o });
  }
  return out;
}

/** 断言主页确实是深色：根容器 class = theme-dark（页面上真实生效的 class，非配置推断） */
async function assertDarkOnPage(page, label) {
  const tc = await page.data('themeClass');
  assert(label + '：根容器 themeClass = theme-dark', tc === 'theme-dark', '实测 ' + tc);
  const shell = await page.$('.shell');
  if (shell) {
    const cls = await shell.attribute('class');
    assert(label + '：.shell 元素 class 含 theme-dark', String(cls || '').indexOf('theme-dark') >= 0, '实测 class="' + cls + '"');
  }
}

async function main() {
  const log = (...a) => console.log('[dark]', ...a);
  const mp = await ensureAutomation(config, log);
  const now = new Date();
  const ym = ymOf(now);
  let backup = null;

  try {
    backup = await backupShard(mp, ym);
    fs.writeFileSync(path.join(os.tmpdir(), 'dailyvalue-axis-dark-backup.json'), JSON.stringify(backup));
    await writeShard(mp, backup.path, ym, buildNormalBills(now));

    /* ---------- 步骤 1：真的切到深色，并留下设置项证据 ---------- */
    await mp.callWxMethod('navigateTo', { url: '/pages/appearance/appearance' });
    await sleep(1800);
    let apPage = await mp.currentPage();
    assert('外观页已打开', String(apPage.path).indexOf('appearance') >= 0, apPage.path);

    const rows = await apPage.$$('.row');
    assert('外观页主题项数量 = 3', rows && rows.length === 3, '实测 ' + (rows ? rows.length : 0) + ' 项');

    await rows[DARK_INDEX].tap();
    await sleep(1500);

    const apData = await apPage.data();
    assert('点 index ' + DARK_INDEX + ' 后 themeMode = dark', apData.themeMode === 'dark', '实测 ' + apData.themeMode);
    assert('effectiveTheme = dark', apData.effectiveTheme === 'dark', '实测 ' + apData.effectiveTheme);
    assert('外观页根容器 class = theme-dark', apData.themeClass === 'theme-dark', '实测 ' + apData.themeClass);
    report.data.appearance = {
      options: THEME_OPTIONS,
      tappedIndex: DARK_INDEX,
      themeMode: apData.themeMode,
      effectiveTheme: apData.effectiveTheme,
      themeClass: apData.themeClass,
    };

    await sleep(400);
    await shot(mp, 'axis-00-theme-setting-dark');   // 证据图：设置项「深色」勾选态

    /* ---------- 步骤 2：深色下三张图 ---------- */
    await mp.callWxMethod('navigateBack', { delta: 1 });
    await sleep(1600);

    let page = await openStatsPanel(mp);
    await assertDarkOnPage(page, '统计面板（主页）');

    // 视口 CSS 宽高：对比度脚本用「截图宽 / windowWidth」还原缩放比，把 offset 映射成截图像素
    report.data.viewport = await mp.evaluate(() => {
      const i = wx.getSystemInfoSync();
      return { windowWidth: i.windowWidth, windowHeight: i.windowHeight, pixelRatio: i.pixelRatio, theme: i.theme };
    });
    log('视口：' + JSON.stringify(report.data.viewport));

    let panel = await page.$('#statisticsPanel');
    if (!panel) throw new Error('找不到 statisticsPanel');
    await enableModule(panel, 'daily-expense-trend');
    await enableModule(panel, 'cumulative-trend');
    await sleep(1200);

    const pd = await panel.data();
    report.data.normalMonth = {
      dailyAxis: pd.dailyAxis,
      cumMax: pd.cumMax,
      cumMonth: pd.cumMonth,
      tickLabels: ((pd.dailyAxis || {}).ticks || []).map((t) => t.label),
    };

    await scrollTo(panel, 'dailyCard');
    await assertDarkOnPage(page, '每日图拍摄前');
    report.data.rectsDaily = await collectRects(panel, '#dailyCard', '.ca__tick', '.ca__grid', 'daily');
    await shot(mp, 'axis-01-daily-dark');

    await scrollTo(panel, 'cumCard');
    report.data.rectsCum = await collectRects(panel, '#cumCard', '.ct__tick', '__none__', 'cum');
    await shot(mp, 'axis-02-cumulative-dark');

    const cumEl = await panel.$('cumulative-trend');
    if (cumEl) {
      // 自定义组件内部选择器要挂在组件元素上（跨 shadow 边界，panel.$$ 取不到）
      const cumRects = { label: 'cum', root: await cumEl.offset().catch(() => null), ticks: [] };
      const ctTicks = await cumEl.$$('.ct__tick').catch(() => []);
      for (const el of ctTicks) {
        const o = await el.offset().catch(() => null);
        const txt = await el.text().catch(() => '');
        if (o) cumRects.ticks.push({ text: txt, rect: o });
      }
      report.data.rectsCum = cumRects;
      const cd = await cumEl.data();
      report.data.cumulativeComponent = {
        yTicks: (cd.yTicks || []).map((t) => ({ label: t.label, topPx: t.topPx })),
        gutterPx: cd.gutterPx,
        fontPx: cd.fontPx,
      };
      log('累计图刻度：' + JSON.stringify(report.data.cumulativeComponent.yTicks));
    }

    // 年度 12 个月
    await panel.callMethod('onModeYear', {});
    await sleep(1600);
    await enableModule(panel, 'year-monthly-trend');
    await sleep(1200);
    const yd = await panel.data();
    report.data.yearAxis = {
      monthlyAxis: yd.monthlyAxis,
      shownMonths: (yd.monthly || []).filter((p) => p.showLabel).map((p) => p.label),
    };
    await scrollTo(panel, 'yearMonthlyCard');
    await assertDarkOnPage(page, '年度月份图拍摄前');
    report.data.rectsMonthly = await collectRects(panel, '#yearMonthlyCard', '.ca__tick', '.ca__grid', 'yearMonthly');
    await shot(mp, 'axis-03-year-monthly-dark');

    log('完成，深色截图 ' + report.shots.length + ' 张');
  } catch (e) {
    console.error('[dark] 异常：', e && e.message ? e.message : e);
    report.error = String(e && e.message ? e.message : e);
    process.exitCode = 1;
  } finally {
    if (backup) {
      const ok = await restoreShard(mp, backup);
      log(ok ? '已恢复原始分片' : '⚠ 恢复失败，备份见系统临时目录 dailyvalue-axis-dark-backup.json');
    }
    // 主题保持深色（项目默认值），不回切浅色，避免给下一轮留隐性状态

    try { await mp.disconnect(); } catch (e) { /* 忽略 */ }
    try {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      report.shots.forEach((s) => {
        const src = path.join(STAGE_DIR, s.name + '.png');
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT_DIR, s.name + '.png'));
      });
      fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
      console.log('[dark] 归档 ' + report.shots.length + ' 张到 ' + OUT_DIR);
      console.log('[dark] 报告：' + REPORT);
    } catch (e) {
      console.error('[dark] 归档失败：' + (e && e.message ? e.message : e));
    }
  }
}

main();
