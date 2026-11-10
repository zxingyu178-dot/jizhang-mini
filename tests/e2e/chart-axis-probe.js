// tests/e2e/chart-axis-probe.js — 坐标轴（v1.4.4）GUI 实拍验证
//
// 目的：三张图加完横纵坐标后，用真实模拟器截图证明
//   1. Y 轴 3 档金额刻度与网格线对齐、不压曲线、不被裁切；
//   2. X 轴标签不重叠；
//   3. 深浅两套主题下刻度文字与网格线都跟着变；
//   4. 窄屏刻度字号降档；
//   5. 极端数据（0.01 元 / 999 万元 / 全 0）不崩、不出 NaN。
//
// 数据安全：只改当月 / 本年账单分片，跑完原样写回（同 visual-sweep 的做法）。
// 运行：node tests/e2e/chart-axis-probe.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const { ensureAutomation, sleep } = require('./launcher');

const OUT_DIR = process.env.AXIS_SHOT_DIR
  || path.join(config.ARTIFACTS_ROOT, 'chart-axis', new Date().toISOString().replace(/[:.]/g, '-'));
// 测试进行中的截图必须落在项目目录之外：微信开发者工具监听项目目录，
// 截图一旦写进项目会触发「文件变更 → 自动重编译」，automator 的 WebSocket 随即失步
// （之后所有命令报 timeout waiting for automator response）。全部用例跑完、disconnect 之后再归档。
const STAGE_DIR = path.join(os.tmpdir(), 'dailyvalue-axis-shots');
const REPORT = path.join(OUT_DIR, 'axis-report.json');
const report = { shots: [], data: {}, notes: [] };

function ymOf(d) {
  return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
}

/** 造一份「看起来像真人」的当月账单：金额有量级差，但不到万元级 */
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

function buildSingleBill(now, cents, label) {
  const ts = new Date(now.getFullYear(), now.getMonth(), 6, 12, 0).getTime();
  return [{
    id: 'e2e-axis-' + label,
    type: 'expense',
    amountCents: cents,
    categoryId: 'c-food',
    occurredAt: ts,
    title: '',
    merchant: label,
    note: '',
    source: 'manual',
    sourceTxnId: null,
    importBatchId: null,
    createdAt: ts,
    updatedAt: ts,
    ledgerImpact: 'normal',
  }];
}

/** 只在每月 1~3 号有支出：用来验证累计折线「截止在真实数据末端」而不是平到月末 */
function buildEarlyStopBills(now) {
  const bills = [];
  for (let d = 1; d <= 3; d++) {
    const ts = new Date(now.getFullYear(), now.getMonth(), d, 10, 0).getTime();
    bills.push({
      id: 'e2e-axis-early-' + d,
      type: 'expense',
      amountCents: 3200 + d * 1800,
      categoryId: 'c-food',
      occurredAt: ts,
      title: '',
      merchant: 'early ' + d,
      note: '',
      source: 'manual',
      sourceTxnId: null,
      importBatchId: null,
      createdAt: ts,
      updatedAt: ts,
      ledgerImpact: 'normal',
    });
  }
  return bills;
}

/** 每天金额完全相同：累计曲线为一条斜线（斜率恒定，最容易看出「平的尾巴」） */
function buildUniformBills(now) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const days = Math.min(now.getDate(), 20);
  const bills = [];
  for (let d = 1; d <= days; d++) {
    const ts = new Date(y, m, d, 12, 0).getTime();
    bills.push({
      id: 'e2e-axis-uni-' + d,
      type: 'expense',
      amountCents: 5000,
      categoryId: 'c-transport',
      occurredAt: ts,
      title: '',
      merchant: 'uniform ' + d,
      note: '',
      source: 'manual',
      sourceTxnId: null,
      importBatchId: null,
      createdAt: ts,
      updatedAt: ts,
      ledgerImpact: 'normal',
    });
  }
  return bills;
}

async function shot(mp, name) {
  const b64 = await mp.screenshot();
  fs.mkdirSync(STAGE_DIR, { recursive: true });
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(path.join(STAGE_DIR, name + '.png'), buf);
  report.shots.push({ name: name, file: path.join(OUT_DIR, name + '.png'), bytes: buf.length });
  console.log('[axis] 截图 ' + name + ' (' + Math.round(buf.length / 1024) + 'KB)');
}

/** 主题档位（顺序与 pages/appearance 的 OPTIONS 一致） */
const THEME_OPTIONS = ['跟随系统', '深色', '浅色'];
const THEME_INDEX = { dark: 1, light: 2 };

/**
 * 切主题并断言生效（v1.4.4 终检补丁）：
 * 上一版场景 1 直接拍 `-dark` 却从未切主题 → 实拍全是浅色。
 * 现在每次拍摄前都必须显式切到目标主题、并断言外观页 themeMode 与主页 themeClass。
 */
async function applyTheme(mp, expect) {
  const idx = THEME_INDEX[expect];
  if (idx == null) throw new Error('未知主题档：' + expect);
  await mp.callWxMethod('navigateTo', { url: '/pages/appearance/appearance' });
  await sleep(1800);
  const ap = await mp.currentPage();
  const rows = await ap.$$('.row');
  if (!rows || rows.length !== 3) throw new Error('外观页主题项数量异常：' + (rows ? rows.length : 0));
  await rows[idx].tap();
  await sleep(1400);
  const apData = await ap.data();
  const ok = apData.themeMode === expect && apData.themeClass === 'theme-' + expect;
  report.themeChecks = report.themeChecks || [];
  report.themeChecks.push({ step: 'apply ' + expect, options: THEME_OPTIONS, tappedIndex: idx, themeMode: apData.themeMode, themeClass: apData.themeClass, ok: ok });
  if (!ok) throw new Error('切主题失败：期望 ' + expect + '，实测 themeMode=' + apData.themeMode + ' themeClass=' + apData.themeClass);
  await mp.callWxMethod('navigateBack', { delta: 1 });
  await sleep(1500);
}

/** 拍摄并断言页面根容器 class：证明这张图确实是目标主题（不是「以为是深色」） */
async function shotWithTheme(mp, page, name, expect) {
  const tc = page ? await page.data('themeClass').catch(() => '') : '';
  const ok = tc === 'theme-' + expect;
  report.themeChecks = report.themeChecks || [];
  report.themeChecks.push({ step: name, expect: expect, themeClass: tc, ok: ok });
  console.log('[axis] ' + (ok ? '✓' : '✗') + ' ' + name + ' themeClass=' + tc + '（期望 theme-' + expect + '）');
  await shot(mp, name);
  report.shots[report.shots.length - 1].themeClass = tc;
  if (!ok) throw new Error(name + ' 拍摄前 themeClass 不是 theme-' + expect + '（实测 ' + tc + '）');
}

/**
 * 采集元素矩形（CSS px）：对比度脚本要靠它精确裁到「刻度文字 / 网格线」，
 * 而不是靠肉眼猜坐标。失败只记录，不影响截图。
 */
async function collectRects(scope, rootSelector, tickSel, gridSel) {
  const out = { ticks: [], grids: [], bars: [] };
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
  // 柱子矩形：供对比度脚本量「柱外 2px 与卡片底色的差」（发光糊边的判据）
  const barEls = await root.$$('.bar').catch(() => []);
  for (const el of barEls) {
    const o = await el.offset().catch(() => null);
    if (o) out.bars.push({ rect: o });
  }
  return out;
}

/** 把某张图的刻度 / 网格矩形存进报告（键 = 截图名），供 scripts/axis-contrast.js 量对比度 */
async function saveRects(shotName, scope, rootSelector, tickSel, gridSel) {
  const r = await collectRects(scope, rootSelector, tickSel, gridSel);
  report.data.rects = report.data.rects || {};
  report.data.rects[shotName] = r;
  console.log('[axis] 采集矩形 ' + shotName + '：刻度 ' + r.ticks.length + ' 条，网格 ' + r.grids.length + ' 条');
}

/** 用例间的非致命步骤：单步失败只记录，不中断整轮（Skyline 统计页偶发 automator 超时） */
async function safe(label, fn) {
  try {
    await fn();
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    console.log('[axis] ⚠ ' + label + ' 失败：' + msg);
    report.notes.push(label + ' 失败：' + msg);
  }
}

/** 写当月分片（原样备份 → 覆盖 → 返回备份供恢复） */
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
    const payload = JSON.stringify({ ym: arg.ym, version: 3, bills: arg.bills }, null, 2);
    fsm.writeFileSync(arg.path, payload, 'utf8');
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

async function openStatsPanel(mp, log) {
  await mp.reLaunch('/pages/main/main');
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

async function main() {
  const log = (...a) => console.log('[axis]', ...a);
  const mp = await ensureAutomation(config, log);
  const now = new Date();
  const ym = ymOf(now);
  let backup = null;
  let themeChanged = false;

  try {
    backup = await backupShard(mp, ym);
    fs.writeFileSync(path.join(os.tmpdir(), 'dailyvalue-axis-backup.json'), JSON.stringify(backup));

    /* ---------- 场景 1：正常数据 · 深色 · 三张图 ---------- */
    await writeShard(mp, backup.path, ym, buildNormalBills(now));
    // 拍摄前必须先真的切到深色（否则 -dark 名不副实，上一轮就是这么翻车的）
    await applyTheme(mp, 'dark');
    themeChanged = true;
    let page = await openStatsPanel(mp, log);
    let panel = await page.$('#statisticsPanel');
    if (!panel) throw new Error('找不到 statisticsPanel');
    await enableModule(panel, 'daily-expense-trend');
    await enableModule(panel, 'cumulative-trend');
    await sleep(1000);

    // 视口 CSS 宽高：对比度脚本用「截图宽 / windowWidth」还原缩放比，把 offset 映射成截图像素
    report.data.viewport = await mp.evaluate(() => {
      const i = wx.getSystemInfoSync();
      return { windowWidth: i.windowWidth, windowHeight: i.windowHeight, pixelRatio: i.pixelRatio, theme: i.theme };
    });

    let pd = await panel.data();
    report.data.normalMonth = {
      dailyAxis: pd.dailyAxis,
      cumMonth: pd.cumMonth,
      cumMax: pd.cumMax,
      showLabels: (pd.daily || []).filter((p) => p.showLabel).map((p) => p.label),
      barMax: (pd.daily || []).reduce((m, p) => Math.max(m, p.barHeightRpx), 0),
    };
    log('每日图刻度：' + JSON.stringify((pd.dailyAxis || {}).ticks));
    log('X 标签：' + (pd.daily || []).filter((p) => p.showLabel).map((p) => p.label).join(' '));

    await scrollTo(panel, 'dailyCard');
    await saveRects('axis-01-daily-dark', panel, '#dailyCard', '.ca__tick', '.ca__grid');
    await shotWithTheme(mp, page, 'axis-01-daily-dark', 'dark');
    await safe('累计趋势-深色', async () => {
      await scrollTo(panel, 'cumCard');
      const cumEl0 = await panel.$('cumulative-trend');
      if (cumEl0) await saveRects('axis-02-cumulative-dark', cumEl0, '.ct', '.ct__tick', '__none__');
      await shotWithTheme(mp, page, 'axis-02-cumulative-dark', 'dark');
    });

    // 累计趋势组件内部数据（刻度文字条数 / 是否画进 SVG）
    const cumEl = await panel.$('cumulative-trend');
    if (cumEl) {
      const cd = await cumEl.data();
      report.data.cumulativeComponent = {
        yTicks: (cd.yTicks || []).map((t) => t.label + '@' + t.topPx),
        xLabels: (cd.xLabels || []).map((t) => t.label + '@' + t.leftPx),
        gutterPx: cd.gutterPx,
        fontPx: cd.fontPx,
        svgHasTextTag: typeof cd.uri === 'string'
          && Buffer.from(String(cd.uri).split(',')[1] || '', 'base64').toString('ascii').indexOf('<text') >= 0,
      };
      log('累计图刻度文字：' + JSON.stringify(report.data.cumulativeComponent.yTicks));
      log('累计图日期标签：' + JSON.stringify(report.data.cumulativeComponent.xLabels));
    }

    // 年度 12 个月
    await safe('年度月份图', async () => {
      await panel.callMethod('onModeYear', {});
      await sleep(1600);
      await enableModule(panel, 'year-monthly-trend');
      await sleep(1200);
      pd = await panel.data();
      report.data.yearAxis = {
        monthlyAxis: pd.monthlyAxis,
        shownMonths: (pd.monthly || []).filter((p) => p.showLabel).map((p) => p.label),
      };
      log('月份图刻度：' + JSON.stringify((pd.monthlyAxis || {}).ticks));
      log('月份标签：' + (pd.monthly || []).filter((p) => p.showLabel).map((p) => p.label).join(' '));
      await scrollTo(panel, 'yearMonthlyCard');
      await saveRects('axis-03-year-monthly-dark', panel, '#yearMonthlyCard', '.ca__tick', '.ca__grid');
      await shotWithTheme(mp, page, 'axis-03-year-monthly-dark', 'dark');
    });

    /* ---------- 场景 2：浅色主题 ---------- */
    await safe('浅色主题', async () => {
      await applyTheme(mp, 'light');
      themeChanged = true;

      page = await openStatsPanel(mp, log);
      panel = await page.$('#statisticsPanel');
      await enableModule(panel, 'daily-expense-trend');
      await enableModule(panel, 'cumulative-trend');
      await sleep(1400);
      await scrollTo(panel, 'dailyCard');
      await saveRects('axis-04-daily-light', panel, '#dailyCard', '.ca__tick', '.ca__grid');
      await shotWithTheme(mp, page, 'axis-04-daily-light', 'light');
      await scrollTo(panel, 'cumCard');
      const cumElL = await panel.$('cumulative-trend');
      if (cumElL) await saveRects('axis-05-cumulative-light', cumElL, '.ct', '.ct__tick', '__none__');
      await shotWithTheme(mp, page, 'axis-05-cumulative-light', 'light');
    });

    /* ---------- 场景 3：窄屏刻度（字号降档） ---------- */
    await safe('窄屏刻度', async () => {
      await panel.setData({ isNarrow: true });
      await panel.callMethod('rebuildAxis', true);
      await sleep(1200);
      pd = await panel.data();
      report.data.narrowAxis = { dailyAxis: pd.dailyAxis };
      await scrollTo(panel, 'dailyCard');
      await saveRects('axis-06-daily-narrow-font', panel, '#dailyCard', '.ca__tick', '.ca__grid');
      await shotWithTheme(mp, page, 'axis-06-daily-narrow-font', 'light');
      report.notes.push('窄屏：模拟器视口宽度无法通过 automator 修改，本张验证「刻度字号 + 标签密度」；'
        + '真实 360px 布局由 tests/chart-axis.test.js 第 8.7 节与 WXSS 只用 px/flex 保证。');
    });

    /* ---------- 场景 4：极端数据（切回深色，顺带验证深色下的极端态） ---------- */
    await applyTheme(mp, 'dark');
    const extremes = [
      ['tiny', buildSingleBill(now, 1, 'tiny'), 'axis-07-extreme-tiny', '0.01 元', false],
      ['huge', buildSingleBill(now, 999999900, 'huge'), 'axis-08-extreme-huge', '9,999,999 元', false],
      ['empty', [], 'axis-09-empty', '无数据', true],
      ['early', buildEarlyStopBills(now), 'axis-10-extreme-early-stop', '只在 1~3 号有支出（截止日右侧留空）', true],
      ['uniform', buildUniformBills(now), 'axis-11-extreme-uniform', '每天金额相同（累计为斜线）', true],
    ];
    for (const [key, bills, shotName, label, alsoCum] of extremes) {
      await safe('极端数据-' + label, async () => {
        await writeShard(mp, backup.path, ym, bills);
        const p2 = await openStatsPanel(mp, log);
        const pn2 = await p2.$('#statisticsPanel');
        await enableModule(pn2, 'daily-expense-trend');
        await enableModule(pn2, 'cumulative-trend');
        await sleep(1400);
        const d2 = await pn2.data();
        report.data['extreme_' + key] = {
          label: label,
          ticks: (d2.dailyAxis || {}).ticks,
          gutterPx: (d2.dailyAxis || {}).gutterPx,
          dailyEmpty: !!d2.dailyEmpty,
          cumEmpty: !!d2.cumEmpty,
          cumMax: d2.cumMax,
          cumPoints: (d2.cumPoints || []).length,
        };
        log('极端 ' + label + '：刻度 ' + JSON.stringify(((d2.dailyAxis || {}).ticks || []).map((t) => t.label)));
        await scrollTo(pn2, 'dailyCard');
        await shotWithTheme(mp, p2, shotName, 'dark');
        if (alsoCum) {
          await scrollTo(pn2, 'cumCard');
          await shotWithTheme(mp, p2, shotName + '-cum', 'dark');
        }
      });
    }

    log('完成，截图 ' + report.shots.length + ' 张');
  } catch (e) {
    console.error('[axis] 异常：', e && e.message ? e.message : e);
    report.error = String(e && e.message ? e.message : e);
    process.exitCode = 1;
  } finally {
    if (backup) {
      const ok = await restoreShard(mp, backup);
      log(ok ? '已恢复原始分片' : '⚠ 恢复失败，备份见系统临时目录 dailyvalue-axis-backup.json');
    }
    if (themeChanged) {
      try {
        await mp.callWxMethod('navigateTo', { url: '/pages/appearance/appearance' });
        await sleep(1500);
        const ap = await mp.currentPage();
        const rows = await ap.$$('.row');
        // 恢复深色（index 1）
        if (rows && rows[1]) { await rows[1].tap(); await sleep(900); }
        await mp.callWxMethod('navigateBack', { delta: 1 });
        await sleep(800);
      } catch (e) { /* 主题恢复失败不影响结论，仅记录 */ }
    }

    // 先断开连接，再把截图从系统临时目录归档进项目：
    // 归档写文件会触发 IDE 重编译，必须在测试全部结束之后做。
    try { await mp.disconnect(); } catch (e) { /* 忽略 */ }
    try {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      report.shots.forEach((s) => {
        const src = path.join(STAGE_DIR, s.name + '.png');
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT_DIR, s.name + '.png'));
      });
      fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
      console.log('[axis] 归档 ' + report.shots.length + ' 张到 ' + OUT_DIR);
      console.log('[axis] 报告：' + REPORT);
    } catch (e) {
      console.error('[axis] 归档失败：' + (e && e.message ? e.message : e));
    }
  }
}

main();
