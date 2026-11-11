// tests/e2e/mom-probe.js — v1.4.6 Hero「同期环比」GUI 实拍验证
//
// 目的：证明同期环比在真实模拟器 + 深浅两套主题下：
//   1. 正常数据：Hero「本月支出」右侧渲染出「比上月同期多/少 X%」，文案与同期口径对得上；
//   2. 上月无数据：文案为「上月同期无支出」（⛔ 不是「少 100%」这种凭空结论）；
//   3. 两边都 0：整行不渲染（Hero 与改造前一致，DOM 里没有 .hero__mom）；
//   4. 窄屏：环比字号降到 10px，仍单行、不与金额重叠、Hero 三列位置不被挤动；
//   5. Hero 三个指标格几何未变：momText 有 / 无两种状态下 .hero__third 的 y 坐标一致（≤1px）。
//
// 数据安全：只改当月 / 上月两个月份分片，跑完原样写回（含「本来不存在」→ 删掉）。主题跑完恢复深色。
// 运行：node tests/e2e/mom-probe.js
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const { ensureAutomation, sleep } = require('./launcher');

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = process.env.MOM_SHOT_DIR || path.join(config.ARTIFACTS_ROOT, 'mom', STAMP);
// 截图先落系统临时目录：写进项目目录会触发 IDE 自动重编译、打断 automator 会话
const STAGE_DIR = path.join(os.tmpdir(), 'dailyvalue-mom-shots');
const REPORT = path.join(OUT_DIR, 'mom-report.json');
const report = { shots: [], checks: [], data: {}, notes: [] };

function ymOf(d) {
  return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
}
function shiftYm(ym, delta) {
  const p = ym.split('-').map(Number);
  return ymOf(new Date(p[0], p[1] - 1 + delta, 1));
}

/* ---------------- 造数据：当期 / 上月同期金额可控，便于反算百分比 ---------------- */
const CUR_CENTS = 10000; // 本月 1~2 日合计 ¥100
const PREV_CENTS = 8000; // 上月 1~2 日合计 ¥80  → 期望「比上月同期多 25%」

function bill(id, cents, y, m, d) {
  const ts = new Date(y, m, d, 12, 0).getTime();
  return {
    id: id, type: 'expense', amountCents: cents, categoryId: 'c-food', occurredAt: ts,
    title: '', merchant: '', note: '', source: 'manual', sourceTxnId: null,
    importBatchId: null, createdAt: ts, updatedAt: ts, ledgerImpact: 'normal',
  };
}

/** 本月：1 日 ¥60 + 2 日 ¥40（只落在月初，任何日期跑都 ≤ 今天） */
function buildCurrent(now) {
  return [
    bill('e2e-mom-c1', 6000, now.getFullYear(), now.getMonth(), 1),
    bill('e2e-mom-c2', 4000, now.getFullYear(), now.getMonth(), 2),
  ];
}
/** 上月：1 日 ¥50 + 2 日 ¥30（同区间对比，不被整月金额干扰） */
function buildPrev(now) {
  const p = shiftYm(ymOf(now), -1).split('-').map(Number);
  return [
    bill('e2e-mom-p1', 5000, p[0], p[1] - 1, 1),
    bill('e2e-mom-p2', 3000, p[0], p[1] - 1, 2),
  ];
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
        obj.bills = obj.bills.filter((b) => !(b && typeof b.id === 'string' && b.id.indexOf('e2e-mom-') === 0));
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

/* ---------------- 截图 / 主题 / 面板 ---------------- */
async function shot(mp, name) {
  const b64 = await mp.screenshot();
  fs.mkdirSync(STAGE_DIR, { recursive: true });
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(path.join(STAGE_DIR, name + '.png'), buf);
  report.shots.push({ name: name, file: path.join(OUT_DIR, name + '.png'), bytes: buf.length });
  console.log('[mom] 截图 ' + name + '（' + Math.round(buf.length / 1024) + 'KB）');
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
  console.log('[mom] ' + (ok ? '✓' : '✗') + ' ' + name + ' themeClass=' + tc);
  await shot(mp, name);
  if (!ok) throw new Error(name + ' 拍摄前 themeClass 不是 theme-' + expect + '（实测 ' + tc + '）');
}

async function openStats(mp) {
  await mp.reLaunch('/pages/main/main');
  await sleep(1900);
  const page = await mp.currentPage();
  const tabs = await page.$$('.tabs__item');
  if (tabs && tabs[0]) await tabs[0].tap();
  await sleep(1400);
  const panel = await page.$('#statisticsPanel');
  if (!panel) throw new Error('找不到 statisticsPanel');
  return { page, panel };
}

/** Hero 几何：三个指标格的 y 坐标（用于「有没有被挤动」的对照） */
async function heroGeometry(panel) {
  const card = await panel.$('#staHero');
  if (!card) return null;
  const thirds = await card.$$('.hero__third');
  const ys = [];
  for (const t of thirds) {
    const off = await t.offset();
    ys.push(Math.round(off.top * 100) / 100);
  }
  const head = await card.$('.hero__head');
  const headSize = head ? await head.size() : null;
  const label = await card.$('.hero__label');
  const labelSize = label ? await label.size() : null;
  const big = await card.$('.hero__big');
  const bigOff = big ? await big.offset() : null;
  return {
    thirdTops: ys,
    headHeight: headSize ? headSize.height : null,
    labelHeight: labelSize ? labelSize.height : null,
    bigTop: bigOff ? Math.round(bigOff.top * 100) / 100 : null,
  };
}

async function safe(label, fn) {
  try {
    await fn();
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    console.log('[mom] ⚠ ' + label + ' 失败：' + msg);
    report.notes.push(label + ' 失败：' + msg);
  }
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const log = (...a) => console.log('[mom]', ...a);
  const mp = await ensureAutomation(config, log);
  const now = new Date();
  const ym = ymOf(now);
  const ymPrev = shiftYm(ym, -1);
  const shards = {};
  let themeChanged = false;

  try {
    for (const key of [ym, ymPrev]) shards[key] = await backupShard(mp, key);
    fs.writeFileSync(path.join(os.tmpdir(), 'dailyvalue-mom-backup.json'), JSON.stringify(shards, null, 2), 'utf8');

    report.data.context = await mp.evaluate(() => {
      const i = wx.getSystemInfoSync();
      return { windowWidth: i.windowWidth, windowHeight: i.windowHeight, pixelRatio: i.pixelRatio };
    });
    log('视口 ' + report.data.context.windowWidth + 'px');

    /* ===== 场景 1/2/4：当期有数据（深 / 浅 / 窄屏） ===== */
    await writeShard(mp, shards[ym].path, ym, buildCurrent(now));
    await writeShard(mp, shards[ymPrev].path, ymPrev, buildPrev(now));

    // 期望文案：|100 - 80| / 80 = 25%
    const pct = Math.max(1, Math.round((Math.abs(CUR_CENTS - PREV_CENTS) / PREV_CENTS) * 100));
    const expectText = '比上月同期多 ' + pct + '%';
    report.data.expectText = expectText;

    for (const theme of ['dark', 'light']) {
      await applyTheme(mp, theme);
      themeChanged = true;
      const { page, panel } = await openStats(mp);
      const pd = await panel.data();
      report.data['hero_' + theme] = {
        monthLabel: pd.monthLabel, mExpense: pd.mExpense, momText: pd.momText, momDir: pd.momDir,
      };
      log(theme + ' ' + pd.monthLabel + ' mExpense=' + pd.mExpense + ' momText=' + JSON.stringify(pd.momText));

      const okText = pd.momText === expectText;
      report.checks.push({ step: theme + ' 环比文案', text: pd.momText, expect: expectText, ok: okText });
      if (!okText) throw new Error(theme + ' 环比文案不符：期望「' + expectText + '」，实际「' + pd.momText + '」');

      // DOM 真的渲染出来了（不是只有 data）
      const momEl = await panel.$('.hero__mom');
      report.checks.push({ step: theme + ' .hero__mom 节点存在', ok: !!momEl });
      if (!momEl) throw new Error(theme + ' .hero__mom 未渲染');
      const domText = (await momEl.text()).trim();
      const size = await momEl.size();
      const off = await momEl.offset();
      report.data['momDom_' + theme] = { text: domText, size, offset: off };
      report.checks.push({ step: theme + ' .hero__mom 文本 = data.momText', text: domText, ok: domText === pd.momText });
      if (domText !== pd.momText) throw new Error(theme + ' DOM 文本与 data 不一致：' + domText);

      // 有环比时的 Hero 几何（对照组 A）
      const geoWith = await heroGeometry(panel);
      report.data['geoWith_' + theme] = geoWith;
      log(theme + ' 有环比的 Hero 几何：' + JSON.stringify(geoWith));

      // 与金额不重叠：环比底 ≤ 金额顶
      const bigOff = geoWith.bigTop;
      const momBottom = off.top + size.height;
      const gap = bigOff - momBottom;
      report.checks.push({ step: theme + ' 环比与金额不重叠（间隙 ≥0）', gapPx: Math.round(gap * 100) / 100, ok: gap >= 0 });
      if (gap < 0) throw new Error(theme + ' 环比与金额重叠：' + JSON.stringify({ momBottom, bigTop: bigOff }));

      // 单行：高度不超过字号 1.4 倍 + 2px
      const lineH = Math.ceil(11 * 1.4) + 2;
      report.checks.push({ step: theme + ' 环比单行（高 ≤ ' + lineH + 'px）', height: size.height, ok: size.height <= lineH });
      if (size.height > lineH) throw new Error(theme + ' 环比换行了：高 ' + size.height + 'px');

      await shotThemed(mp, page, 'mom-0' + (theme === 'dark' ? '1' : '2') + '-' + theme + '-current-month', theme);

      // 对照组 B：把 momText 清空 → 环比节点消失，Hero 三个指标格 y 坐标应与 A 完全一致
      await panel.setData({ momText: '', momDir: '' });
      await sleep(600);
      const stillThere = await panel.$('.hero__mom');
      report.checks.push({ step: theme + ' momText 清空后节点消失', ok: !stillThere });
      if (stillThere) throw new Error(theme + ' momText 已清空但 .hero__mom 仍在');
      const geoWithout = await heroGeometry(panel);
      report.data['geoWithout_' + theme] = geoWithout;
      log(theme + ' 无环比的 Hero 几何：' + JSON.stringify(geoWithout));

      const dTop = geoWith.thirdTops.map((y, i) => Math.abs(y - geoWithout.thirdTops[i]));
      const maxD = Math.max.apply(null, dTop);
      report.checks.push({
        step: theme + ' Hero 三列 y 坐标：有环比 vs 无环比差值 ≤1px',
        deltas: dTop, ok: maxD <= 1,
      });
      if (maxD > 1) throw new Error(theme + ' Hero 三列被环挤压动：' + JSON.stringify(dTop));
      const dBig = Math.abs(geoWith.bigTop - geoWithout.bigTop);
      report.checks.push({ step: theme + ' 「本月支出」金额 y 坐标未动（≤1px）', delta: dBig, ok: dBig <= 1 });
      if (dBig > 1) throw new Error(theme + ' 金额位置被挤动：' + dBig + 'px');
      const dHead = Math.abs(geoWith.headHeight - geoWithout.headHeight);
      report.checks.push({ step: theme + ' 第一行高度未因环比长高（≤1px）', delta: dHead, ok: dHead <= 1 });
      if (dHead > 1) throw new Error(theme + ' 第一行被环比撑高：' + dHead + 'px');

      // 恢复（窄屏场景还要用）
      await panel.setData({ momText: pd.momText, momDir: pd.momDir });

      /* ===== 场景 4：窄屏样式（isNarrow=true，视口仍为模拟器宽度） ===== */
      if (theme === 'dark') {
        await panel.setData({ isNarrow: true });
        await panel.callMethod('rebuildAxis', true);
        await sleep(1200);
        const narrowMom = await panel.$('.hero__mom');
        const nSize = narrowMom ? await narrowMom.size() : null;
        report.data.narrow = { size: nSize };
        // 10px × 1.4 ≈ 14px + 2 容差
        const narrowLineH = Math.ceil(10 * 1.4) + 2;
        report.checks.push({ step: '窄屏：环比仍单行（高 ≤ ' + narrowLineH + 'px）', height: nSize && nSize.height, ok: !!nSize && nSize.height <= narrowLineH });
        await shotThemed(mp, page, 'mom-04-dark-narrow', theme);
        await panel.setData({ isNarrow: false });
        await panel.callMethod('rebuildAxis', false);
        await sleep(900);
      }
    }

    /* ===== 场景 3：上月无数据 ===== */
    // 前置：上一轮循环结束时主题停在浅色，这里显式切回深色（否则截图 themeClass 断言会红）
    await applyTheme(mp, 'dark');
    await writeShard(mp, shards[ymPrev].path, ymPrev, []);
    {
      const { page, panel } = await openStats(mp);
      const pd = await panel.data();
      report.data.prevEmpty = { mExpense: pd.mExpense, momText: pd.momText, momDir: pd.momDir };
      log('上月无数据：momText=' + JSON.stringify(pd.momText));
      const okNoPrev = pd.momText === '上月同期无支出';
      report.checks.push({ step: '上月无数据：文案为「上月同期无支出」（不假报 -100%）', text: pd.momText, ok: okNoPrev });
      if (!okNoPrev) throw new Error('上月无数据时环比文案异常：' + pd.momText);
      report.checks.push({ step: '上月无数据：不带方向色钩子（momDir 为空）', momDir: pd.momDir, ok: !pd.momDir });
      const momEl = await panel.$('.hero__mom');
      report.checks.push({ step: '上月无数据：环比节点仍渲染（有信息，不是空白）', ok: !!momEl });
      await shotThemed(mp, page, 'mom-03-dark-last-month-empty', 'dark');
    }

    /* ===== 场景 5（补充证据）：两边都 0 → 整行不渲染 ===== */
    await writeShard(mp, shards[ym].path, ym, []);
    {
      const { page, panel } = await openStats(mp);
      const pd = await panel.data();
      report.data.bothEmpty = { mExpense: pd.mExpense, momText: pd.momText, momDir: pd.momDir };
      log('两边都 0：momText=' + JSON.stringify(pd.momText));
      report.checks.push({ step: '两边都 0：momText 为空', text: pd.momText, ok: pd.momText === '' });
      if (pd.momText !== '') throw new Error('两边都 0 仍渲染环比：' + pd.momText);
      const momEl = await panel.$('.hero__mom');
      report.checks.push({ step: '两边都 0：DOM 里没有 .hero__mom（Hero 与改造前一致）', ok: !momEl });
      if (momEl) throw new Error('两边都 0 但 .hero__mom 节点存在');
      await shotThemed(mp, page, 'mom-05-dark-both-empty', 'dark');
    }

    log('完成，截图 ' + report.shots.length + ' 张，体检项 ' + report.checks.length + ' 条');
  } catch (e) {
    console.error('[mom] 异常：', e && e.message ? e.message : e);
    report.error = String(e && e.message ? e.message : e);
    process.exitCode = 1;
  } finally {
    for (const key of Object.keys(shards)) {
      const ok = await restoreShard(mp, shards[key]);
      console.log('[mom] ' + (ok ? '已恢复分片 ' : '⚠ 恢复失败 ') + key);
    }
    if (themeChanged) {
      await safe('恢复主题为深色', async () => {
        await mp.callWxMethod('navigateTo', { url: '/pages/appearance/appearance' });
        await sleep(1500);
        const ap = await mp.currentPage();
        const rows = await ap.$$('.row');
        if (rows && rows[1]) { await rows[1].tap(); await sleep(900); }
        await mp.callWxMethod('navigateBack', { delta: 1 });
        await sleep(800);
      });
    }
    try { await mp.disconnect(); } catch (e) { /* 忽略 */ }
    try {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      report.shots.forEach((s) => {
        const src = path.join(STAGE_DIR, s.name + '.png');
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT_DIR, s.name + '.png'));
      });
      fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
      console.log('[mom] 归档 ' + report.shots.length + ' 张到 ' + OUT_DIR);
      console.log('[mom] 报告：' + REPORT);
    } catch (e) {
      console.error('[mom] 归档失败：' + (e && e.message ? e.message : e));
    }
  }
}

main();
