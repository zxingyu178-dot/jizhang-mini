// tests/e2e/insight-probe.js — B-2 第一批「图表结论行」GUI 实拍验证
//
// 目的：4 张统计图（分类占比 / 每日花费 / 累计消费 / 12 个月）加的结论行，
//   在真实模拟器 + 深浅两套主题 + 4 个场景下证明：
//   1. 正常数据：4 条结论都渲染出来，文案与口径对得上（金额、预测值、峰值日）；
//   2. 空态：当月无支出 → 结论行全部不渲染，且不挤乱布局；
//   3. 历史月份：累计图结论是「日均」而不是「月末约」；
//   4. 窄屏：结论行单行显示（量元素高度）、不出现省略号、宽度仍在 360px 内容区内。
//
// 数据安全：只改当月 / 上月 / 两个年度月份分片，跑完原样写回（含「本来不存在」→ 删掉）。
// 主题与统计模块开关同样跑完恢复原状。
// 运行：node tests/e2e/insight-probe.js
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const { ensureAutomation, sleep } = require('./launcher');
const axis = require('../../data/statistics/axis');

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = process.env.INSIGHT_SHOT_DIR || path.join(config.ARTIFACTS_ROOT, 'insight', STAMP);
// 截图先落系统临时目录：写进项目目录会触发 IDE 自动重编译、打断 automator 会话
const STAGE_DIR = path.join(os.tmpdir(), 'dailyvalue-insight-shots');
const REPORT = path.join(OUT_DIR, 'insight-report.json');
const report = { shots: [], checks: [], data: {}, notes: [] };

function ymOf(d) {
  return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
}
function shiftYm(ym, delta) {
  const p = ym.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1 + delta, 1);
  return ymOf(d);
}

/* ---------------- 造数据（金额有量级差、分类有明确最大项） ---------------- */

function bill(id, type, cents, categoryId, y, m, d, hour, merchant) {
  const ts = new Date(y, m, d, hour || 12, 0).getTime();
  return {
    id: id,
    type: type,
    amountCents: cents,
    categoryId: categoryId,
    occurredAt: ts,
    title: '',
    merchant: merchant || '',
    note: '',
    source: 'manual',
    sourceTxnId: null,
    importBatchId: null,
    createdAt: ts,
    updatedAt: ts,
    ledgerImpact: 'normal',
  };
}

/** 当月正常数据：餐饮是最大项（≈70%），11/08 是峰值 ¥127 */
function buildNormalMonth(now) {
  const y = now.getFullYear();
  const m = now.getMonth();
  return [
    bill('e2e-ins-01', 'expense', 2000, 'c-food', y, m, 3, 12, '午餐'),
    bill('e2e-ins-02', 'expense', 850, 'c-transport', y, m, 5, 8, '地铁'),
    bill('e2e-ins-03', 'expense', 12700, 'c-food', y, m, 8, 19, '聚餐'),
    bill('e2e-ins-04', 'expense', 3600, 'c-shopping', y, m, 9, 15, '日用品'),
    bill('e2e-ins-05', 'expense', 2500, 'c-fun', y, m, 10, 20, '电影'),
    bill('e2e-ins-06', 'expense', 1200, 'c-food', y, m, 11, 12, '早餐'),
  ];
}

/** 上月（历史月）数据：总额与天数都不同，用来验证「日均」而不是「月末预测」 */
function buildPrevMonth(now) {
  const p = shiftYm(ymOf(now), -1).split('-').map(Number);
  const y = p[0];
  const m = p[1] - 1;
  return [
    bill('e2e-ins-p1', 'expense', 30000, 'c-housing', y, m, 2, 10, '房租'),
    bill('e2e-ins-p2', 'expense', 5600, 'c-food', y, m, 6, 12, '聚餐'),
    bill('e2e-ins-p3', 'expense', 4200, 'c-transport', y, m, 14, 9, '打车'),
    bill('e2e-ins-p4', 'expense', 8800, 'c-shopping', y, m, 21, 16, '衣服'),
  ];
}

/** 年度：在 3 月 / 7 月各放一笔，给 12 个月图一个明确的最高月 */
function buildYearMonth(now, month, cents) {
  return [bill('e2e-ins-y' + month, 'expense', cents, 'c-life', now.getFullYear(), month - 1, 5, 12, '年度')];
}

/* ---------------- 分片读写（原样备份 → 覆盖 → 恢复） ---------------- */

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
        obj.bills = obj.bills.filter((b) => !(b && typeof b.id === 'string' && b.id.indexOf('e2e-ins-') === 0));
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

/* ---------------- 截图 / 主题 / 面板 ---------------- */

async function shot(mp, name) {
  const b64 = await mp.screenshot();
  fs.mkdirSync(STAGE_DIR, { recursive: true });
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(path.join(STAGE_DIR, name + '.png'), buf);
  report.shots.push({ name: name, file: path.join(OUT_DIR, name + '.png'), bytes: buf.length });
  console.log('[ins] 截图 ' + name + '（' + Math.round(buf.length / 1024) + 'KB）');
}

const THEME_INDEX = { dark: 1, light: 2 };

async function applyTheme(mp, expect) {
  await mp.callWxMethod('navigateTo', { url: '/pages/appearance/appearance' });
  await sleep(1600);
  const ap = await mp.currentPage();
  const rows = await ap.$$('.row');
  if (!rows || rows.length < 3) throw new Error('外观页主题项数量异常：' + (rows ? rows.length : 0));
  await rows[THEME_INDEX[expect]].tap();
  await sleep(1300);
  const d = await ap.data();
  report.checks.push({ step: 'applyTheme ' + expect, themeMode: d.themeMode, ok: d.themeMode === expect });
  if (d.themeMode !== expect) throw new Error('切主题失败：期望 ' + expect + '，实测 ' + d.themeMode);
  await mp.callWxMethod('navigateBack', { delta: 1 });
  await sleep(1400);
}

async function shotThemed(mp, page, name, expect) {
  const tc = page ? await page.data('themeClass').catch(() => '') : '';
  const ok = tc === 'theme-' + expect;
  report.checks.push({ step: name, themeClass: tc, expect: 'theme-' + expect, ok: ok });
  console.log('[ins] ' + (ok ? '✓' : '✗') + ' ' + name + ' themeClass=' + tc);
  await shot(mp, name);
  if (!ok) throw new Error(name + ' 拍摄前 themeClass 不是 theme-' + expect + '（实测 ' + tc + '）');
}

async function openStats(mp) {
  await mp.reLaunch('/pages/main/main');
  await sleep(1900);
  const page = await mp.currentPage();
  const tabs = await page.$$('.tabs__item');
  if (tabs && tabs[0]) await tabs[0].tap();
  await sleep(1300);
  const panel = await page.$('#statisticsPanel');
  if (!panel) throw new Error('找不到 statisticsPanel');
  return { page, panel };
}

async function enableModule(panel, id) {
  const d = await panel.data();
  if ((d.enabledModules || []).indexOf(id) >= 0) return;
  await panel.callMethod('onToggleModule', {
    currentTarget: { dataset: { id: id } },
    detail: { value: true },
  });
  await sleep(320);
}

async function scrollTo(panel, id) {
  await panel.setData({ scrollInto: id });
  await sleep(750);
}

async function safe(label, fn) {
  try {
    await fn();
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    console.log('[ins] ⚠ ' + label + ' 失败：' + msg);
    report.notes.push(label + ' 失败：' + msg);
  }
}

/** 结论行的真实渲染体检：文本 / 单行高度 / 宽度是否仍在窄屏内容区内 */
async function inspectInsight(panel, scopeSelector, expectedSelector, fontPx, label) {
  const row = { label: label, fontPx: fontPx };
  const card = await panel.$(scopeSelector);
  if (!card) { row.found = false; report.data[label] = row; return row; }
  const el = await card.$(expectedSelector);
  if (!el) { row.found = false; report.data[label] = row; return row; }
  row.found = true;
  row.text = (await el.text()).trim();
  row.size = await el.size().catch(() => null);
  row.offset = await el.offset().catch(() => null);
  const lineH = Math.ceil(fontPx * 1.4) + 2; // 1.4 行高 + 2px 取整余量
  row.lineH = lineH;
  row.singleLine = !!(row.size && row.size.height <= lineH);
  row.hasEllipsis = row.text.indexOf('…') >= 0;
  row.widthPx = Math.round(axis.textWidthPx(row.text, fontPx));
  console.log('[ins] ' + label + '：' + JSON.stringify(row.text)
    + ' 高 ' + (row.size ? row.size.height : '?') + 'px（单行 ' + row.singleLine + '）'
    + ' 文字宽 ' + row.widthPx + 'px');
  report.data[label] = row;
  return row;
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const log = (...a) => console.log('[ins]', ...a);
  const mp = await ensureAutomation(config, log);
  const now = new Date();
  const ym = ymOf(now);
  const ymPrev = shiftYm(ym, -1);
  const year = now.getFullYear();
  const shards = {};
  let beforeModules = null;
  let themeChanged = false;

  try {
    /* ---------- 备份：当月 / 上月 / 3 月 / 7 月 ---------- */
    for (const key of [ym, ymPrev, year + '-03', year + '-07']) {
      shards[key] = await backupShard(mp, key);
    }
    fs.writeFileSync(path.join(os.tmpdir(), 'dailyvalue-insight-backup.json'),
      JSON.stringify(shards, null, 2), 'utf8');

    report.data.context = await mp.evaluate(() => {
      const i = wx.getSystemInfoSync();
      return { windowWidth: i.windowWidth, windowHeight: i.windowHeight, pixelRatio: i.pixelRatio };
    });
    // 图表卡内容区宽度（rpx→px）：结论行估算宽度必须落在它以内
    const contentPx = Math.round(638 * ((report.data.context.windowWidth || 375) / 750));
    report.data.chartContentPx = contentPx;
    log('视口 ' + report.data.context.windowWidth + 'px，图表内容区 ≈ ' + contentPx + 'px');

    /* ================= 场景 1/2：正常数据（深 / 浅） ================= */
    await writeShard(mp, shards[ym].path, ym, buildNormalMonth(now));
    await writeShard(mp, shards[ymPrev].path, ymPrev, buildPrevMonth(now));
    await writeShard(mp, shards[year + '-03'].path, year + '-03', buildYearMonth(now, 3, 100000));
    await writeShard(mp, shards[year + '-07'].path, year + '-07', buildYearMonth(now, 7, 200000));

    for (const theme of ['dark', 'light']) {
      await applyTheme(mp, theme);
      themeChanged = true;
      const { page, panel } = await openStats(mp);
      const d0 = await panel.data();
      if (!beforeModules) beforeModules = (d0.enabledModules || []).slice();
      await enableModule(panel, 'cumulative-trend');
      await sleep(1200);

      const pd = await panel.data();
      report.data['normal_' + theme] = {
        monthLabel: pd.monthLabel,
        categoryInsight: pd.categoryInsight,
        dailyInsight: pd.dailyInsight,
        cumInsight: pd.cumInsight,
        monthlyInsight: pd.monthlyInsight,
        mExpense: pd.mExpense,
        cumMax: pd.cumMax,
        dailyEmpty: pd.dailyEmpty,
        cumEmpty: pd.cumEmpty,
      };
      log(theme + ' 月结论：A=' + pd.categoryInsight + ' | B=' + pd.dailyInsight + ' | C=' + pd.cumInsight);

      // 断言：文案结构（口径见 data/statistics/insight.js）
      report.checks.push({ step: theme + ' A 分类占比结论', text: pd.categoryInsight, ok: /占 \d+%，是最大开销|占比最高，\d+%/.test(pd.categoryInsight || '') });
      report.checks.push({ step: theme + ' B 每日趋势结论', text: pd.dailyInsight, ok: /日均 ¥[\d,]+ · 最高 \d+\/\d\d ¥[\d,]+/.test(pd.dailyInsight || '') });
      report.checks.push({ step: theme + ' C 累计趋势结论（当月）', text: pd.cumInsight, ok: /已花 ¥[\d,]+ · 按当前速度月末约 ¥[\d,]+/.test(pd.cumInsight || '') });
      report.checks.forEach((c) => { if (c.step.indexOf(theme) === 0 && c.ok === false) throw new Error(c.step + ' 文案不符：' + c.text); });

      // 口径独立复核：月末预测 = 已花 ÷ 已过天数 × 当月总天数（不采信展示值，自己算一遍）
      const elapsed = now.getDate();
      const spanDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const forecast = Math.round((pd.cumMax * spanDays) / elapsed);
      const yuan = (c) => '¥' + String(Math.round(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      const okForecast = String(pd.cumInsight || '').indexOf(yuan(forecast)) >= 0;
      report.checks.push({ step: theme + ' C 预测值独立复核', expect: yuan(forecast), ok: okForecast });
      log(theme + ' 预测复核：' + pd.cumMax + '/' + elapsed + '*' + spanDays + ' = ' + forecast + ' 分 → ' + yuan(forecast) + ' ' + (okForecast ? '✓' : '✗'));
      if (!okForecast) throw new Error(theme + ' 月末预测与公式不符：期望含 ' + yuan(forecast) + '，实际 ' + pd.cumInsight);

      // 逐卡拍摄 + 渲染体检
      await scrollTo(panel, 'monthShareCard');
      const a = await inspectInsight(panel, '#monthShareCard', '.chart__insight', 11, theme + '_A_category');
      await shotThemed(mp, page, 'ins-01-' + theme + '-category', theme);

      await scrollTo(panel, 'dailyCard');
      const b = await inspectInsight(panel, '#dailyCard', '.chart__insight', 11, theme + '_B_daily');
      await shotThemed(mp, page, 'ins-02-' + theme + '-daily', theme);

      await scrollTo(panel, 'cumCard');
      const c = await inspectInsight(panel, '#cumCard', '.chart__insight', 11, theme + '_C_cumulative');
      await shotThemed(mp, page, 'ins-03-' + theme + '-cumulative', theme);

      [a, b, c].forEach((r) => {
        if (!r.found) throw new Error(theme + ' 结论行未渲染：' + r.label);
        if (!r.singleLine) throw new Error(theme + ' 结论行不是单行：' + r.label + ' 高 ' + (r.size && r.size.height));
        if (r.hasEllipsis) throw new Error(theme + ' 结论行被截断（出现省略号）：' + r.label + ' ' + r.text);
        if (r.widthPx > contentPx) throw new Error(theme + ' 结论行文字超宽：' + r.label + ' ' + r.widthPx + 'px > ' + contentPx + 'px');
      });

      await panel.callMethod('onModeYear', {});
      await sleep(1700);
      const yd = await panel.data();
      report.data['normalYear_' + theme] = {
        year: yd.year, monthlyInsight: yd.monthlyInsight, yExpense: yd.yExpense, yAvg: yd.yAvg,
        monthsWithData: (yd.monthly || []).filter((p) => p.expense > 0).map((p) => p.month + '月:' + p.expense),
      };
      log(theme + ' 年结论：D=' + yd.monthlyInsight + '（有数据月：' + report.data['normalYear_' + theme].monthsWithData.join(' ') + '）');
      const okD = /月均 ¥[\d,]+ · 最高 \d+ 月 ¥[\d,]+/.test(yd.monthlyInsight || '');
      report.checks.push({ step: theme + ' D 12 个月结论', text: yd.monthlyInsight, ok: okD });
      if (!okD) throw new Error(theme + ' D 12 个月结论文案不符：' + yd.monthlyInsight);

      await scrollTo(panel, 'yearMonthlyCard');
      const dd = await inspectInsight(panel, '#yearMonthlyCard', '.chart__insight', 11, theme + '_D_monthly');
      await shotThemed(mp, page, 'ins-04-' + theme + '-year-monthly', theme);
      if (!dd.found || !dd.singleLine || dd.hasEllipsis) throw new Error(theme + ' D 结论行异常：' + JSON.stringify(dd));

      /* ================= 场景 3/4：空态（深 / 浅） ================= */
      await writeShard(mp, shards[ym].path, ym, []);
      const empty = await openStats(mp);
      await enableModule(empty.panel, 'cumulative-trend');
      await sleep(1200);
      const ed = await empty.panel.data();
      report.data['empty_' + theme] = {
        categoryInsight: ed.categoryInsight,
        dailyInsight: ed.dailyInsight,
        cumInsight: ed.cumInsight,
        monthlyInsight: ed.monthlyInsight,
        dailyEmpty: ed.dailyEmpty,
        cumEmpty: ed.cumEmpty,
      };
      const allEmpty = !ed.categoryInsight && !ed.dailyInsight && !ed.cumInsight;
      report.checks.push({ step: theme + ' 空态：月内 3 条结论行全部不渲染', ok: allEmpty });
      if (!allEmpty) throw new Error(theme + ' 空态仍有结论行：' + JSON.stringify(report.data['empty_' + theme]));

      await empty.panel.setData({ scrollInto: 'monthShareCard' });
      await sleep(700);
      const emptyInsightEls = await empty.page.$$('.chart__insight').catch(() => []);
      report.checks.push({ step: theme + ' 空态：页面上 .chart__insight 节点数', count: emptyInsightEls.length, ok: emptyInsightEls.length === 0 });
      await shotThemed(mp, empty.page, 'ins-05-' + theme + '-empty-month', theme);

      // 年度空态：直接加载一个没有数据的年份（不写任何分片、不动真实账本）
      await empty.panel.callMethod('onModeYear', {});
      await sleep(1500);
      await empty.panel.callMethod('loadYear', 2019);
      await sleep(1500);
      const yEd = await empty.panel.data();
      report.data['emptyYear_' + theme] = { year: yEd.year, monthlyInsight: yEd.monthlyInsight };
      report.checks.push({ step: theme + ' 空态：12 个月全 0 → 结论行不渲染', ok: !yEd.monthlyInsight });
      if (yEd.monthlyInsight) throw new Error(theme + ' 年度空态仍有结论行：' + yEd.monthlyInsight);
      await empty.panel.setData({ scrollInto: 'yearMonthlyCard' });
      await sleep(700);
      await shotThemed(mp, empty.page, 'ins-06-' + theme + '-empty-year', theme);

      /* ================= 场景 5/6：历史月份（深 / 浅） ================= */
      await writeShard(mp, shards[ym].path, ym, buildNormalMonth(now));
      const hist = await openStats(mp);
      await enableModule(hist.panel, 'cumulative-trend');
      await sleep(1000);
      await hist.panel.callMethod('onPrevMonth', {});
      await sleep(1600);
      const hd = await hist.panel.data();
      report.data['history_' + theme] = {
        monthLabel: hd.monthLabel,
        categoryInsight: hd.categoryInsight,
        dailyInsight: hd.dailyInsight,
        cumInsight: hd.cumInsight,
      };
      log(theme + ' 历史月 ' + hd.monthLabel + '：A=' + hd.categoryInsight + ' | B=' + hd.dailyInsight + ' | C=' + hd.cumInsight);
      const okAvg = (hd.cumInsight || '').indexOf('日均') >= 0 && (hd.cumInsight || '').indexOf('月末约') < 0;
      report.checks.push({ step: theme + ' 历史月：累计结论用「日均」不用「月末约」', text: hd.cumInsight, ok: okAvg });
      if (!okAvg) throw new Error(theme + ' 历史月累计结论口径错：' + hd.cumInsight);
      // 月份标签口径：'YYYY年M月'（不补零，与既有 monthLabel 一致）
      const pp = ymPrev.split('-').map(Number);
      const expectedLabel = pp[0] + '年' + pp[1] + '月';
      report.checks.push({ step: theme + ' 历史月：切到上一月', expect: expectedLabel, text: hd.monthLabel, ok: hd.monthLabel === expectedLabel });
      if (hd.monthLabel !== expectedLabel) throw new Error(theme + ' 没有切到上月：' + hd.monthLabel);

      await hist.panel.setData({ scrollInto: 'dailyCard' });
      await sleep(700);
      const hb = await inspectInsight(hist.panel, '#dailyCard', '.chart__insight', 11, theme + '_H_daily');
      await shotThemed(mp, hist.page, 'ins-07-' + theme + '-history-daily', theme);
      await hist.panel.setData({ scrollInto: 'cumCard' });
      await sleep(700);
      const hc = await inspectInsight(hist.panel, '#cumCard', '.chart__insight', 11, theme + '_H_cumulative');
      await shotThemed(mp, hist.page, 'ins-08-' + theme + '-history-cumulative', theme);
      [hb, hc].forEach((r) => {
        if (!r.found || !r.singleLine || r.hasEllipsis) throw new Error(theme + ' 历史月结论行异常：' + JSON.stringify(r));
        if (r.widthPx > contentPx) throw new Error(theme + ' 历史月结论行超宽：' + r.label);
      });

      /* ================= 场景 7/8：窄屏（深 / 浅） ================= */
      const nar = await openStats(mp);
      await enableModule(nar.panel, 'cumulative-trend');
      await sleep(1000);
      await nar.panel.setData({ isNarrow: true });
      await nar.panel.callMethod('rebuildAxis', true);
      await sleep(1300);
      await nar.panel.setData({ scrollInto: 'dailyCard' });
      await sleep(800);
      const nb = await inspectInsight(nar.panel, '#dailyCard', '.chart__insight', 10, theme + '_N_daily');
      report.checks.push({ step: theme + ' 窄屏：结论行仍存在', ok: !!nb.found });
      report.checks.push({ step: theme + ' 窄屏：单行不换行（高度 ≤ ' + (nb.lineH || 0) + 'px）', size: nb.size, ok: !!nb.singleLine });
      report.checks.push({ step: theme + ' 窄屏：未被省略号裁切', text: nb.text, ok: !nb.hasEllipsis });
      report.checks.push({ step: theme + ' 窄屏：文字宽 ≤ 360px 内容区 ' + contentPx + 'px', widthPx: nb.widthPx, ok: nb.widthPx <= contentPx });
      if (!nb.singleLine || nb.hasEllipsis || nb.widthPx > contentPx) {
        throw new Error(theme + ' 窄屏结论行不合格：' + JSON.stringify(nb));
      }
      // 结论行与标题/图表不重叠：标题底 ≤ 结论行顶，结论行底 ≤ 图表顶
      await safe(theme + ' 窄屏几何（标题/结论/图表不重叠）', async () => {
        const card = await nar.panel.$('#dailyCard');
        const t = await (await card.$('.chart__title')).offset();
        const tSize = await (await card.$('.chart__title')).size();
        const i = await (await card.$('.chart__insight')).offset();
        const iSize = await (await card.$('.chart__insight')).size();
        const plot = await (await card.$('.ca')).offset();
        const gapTitle = i.top - (t.top + tSize.height);
        const gapChart = plot.top - (i.top + iSize.height);
        report.data[theme + '_narrow_geometry'] = { titleBottom: t.top + tSize.height, insightTop: i.top, insightBottom: i.top + iSize.height, chartTop: plot.top, gapTitlePx: gapTitle, gapChartPx: gapChart };
        report.checks.push({ step: theme + ' 窄屏：标题与结论行不重叠（间隙 ≥0）', gapPx: gapTitle, ok: gapTitle >= 0 });
        report.checks.push({ step: theme + ' 窄屏：结论行与图表不重叠（间隙 ≥0）', gapPx: gapChart, ok: gapChart >= 0 });
        if (gapTitle < 0 || gapChart < 0) throw new Error(theme + ' 窄屏结论行与相邻元素重叠：' + JSON.stringify(report.data[theme + '_narrow_geometry']));
      });
      await shotThemed(mp, nar.page, 'ins-09-' + theme + '-narrow-daily', theme);
      await nar.panel.setData({ scrollInto: 'cumCard' });
      await sleep(800);
      const nc = await inspectInsight(nar.panel, '#cumCard', '.chart__insight', 10, theme + '_N_cumulative');
      if (!nc.singleLine || nc.hasEllipsis || nc.widthPx > contentPx) {
        throw new Error(theme + ' 窄屏累计结论行不合格：' + JSON.stringify(nc));
      }
      await shotThemed(mp, nar.page, 'ins-10-' + theme + '-narrow-cumulative', theme);
    }

    log('完成，截图 ' + report.shots.length + ' 张，体检项 ' + report.checks.length + ' 条');
  } catch (e) {
    console.error('[ins] 异常：', e && e.message ? e.message : e);
    report.error = String(e && e.message ? e.message : e);
    process.exitCode = 1;
  } finally {
    // 1) 恢复分片
    for (const key of Object.keys(shards)) {
      const ok = await restoreShard(mp, shards[key]);
      console.log('[ins] ' + (ok ? '已恢复分片 ' : '⚠ 恢复失败 ') + key);
    }
    // 2) 恢复统计模块开关（探针里为拍累计图开过 cumulative-trend）
    await safe('恢复统计模块开关', async () => {
      if (!beforeModules) return;
      const page = await mp.currentPage();
      const panel = await page.$('#statisticsPanel');
      if (!panel) return;
      const d = await panel.data();
      const nowOn = d.enabledModules || [];
      const all = beforeModules.concat(nowOn.filter((id) => beforeModules.indexOf(id) < 0));
      for (const id of all) {
        const want = beforeModules.indexOf(id) >= 0;
        const have = nowOn.indexOf(id) >= 0;
        if (want !== have) {
          await panel.callMethod('onToggleModule', {
            currentTarget: { dataset: { id: id } }, detail: { value: want },
          });
          await sleep(300);
        }
      }
      console.log('[ins] 统计模块开关已恢复：' + JSON.stringify(beforeModules));
    });
    // 3) 主题恢复深色
    if (themeChanged) {
      await safe('恢复主题', async () => {
        await mp.callWxMethod('navigateTo', { url: '/pages/appearance/appearance' });
        await sleep(1500);
        const ap = await mp.currentPage();
        const rows = await ap.$$('.row');
        if (rows && rows[1]) { await rows[1].tap(); await sleep(900); }
        await mp.callWxMethod('navigateBack', { delta: 1 });
        await sleep(800);
      });
    }

    // 4) 先断连接，再把截图从系统临时目录归档进项目（写项目会触发 IDE 重编译）
    try { await mp.disconnect(); } catch (e) { /* 忽略 */ }
    try {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      report.shots.forEach((s) => {
        const src = path.join(STAGE_DIR, s.name + '.png');
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT_DIR, s.name + '.png'));
      });
      fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
      console.log('[ins] 归档 ' + report.shots.length + ' 张到 ' + OUT_DIR);
      console.log('[ins] 报告：' + REPORT);
    } catch (e) {
      console.error('[ins] 归档失败：' + (e && e.message ? e.message : e));
    }
  }
}

main();
