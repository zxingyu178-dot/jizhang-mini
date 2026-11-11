// tests/e2e/donut-depth-shots.js
// v1.5.0 车削双层环（方向 A）真渲染取证：在开发者工具模拟器里截「深/浅主题 × 6/12 段」。
//
// 取证口径：
//   1. 走生产代码路径 —— 截图里的 SVG 必须由 data/statistics/donut.js 的 buildDonutSVG 生成，
//      不注入任何手写 SVG（与 donut-render-probe.js 的 Gate 0 隔离实验相反）；
//   2. 6/12 段用「直接给组件 segments 赋值」构造（种子账单只能造出 5 段 / 8 段）；
//      真实数据路径单独留一张（seedDonut → 5 段），两件事都要有；
//   3. 每张图同时记录 diagSnapshot（svgLen / uriLen / circleCount / theme / segCount），
//      体积与画面同源；截图文件名里的主题必须与 snapshot.theme 一致，不一致就重来；
//   4. 截图先落系统临时目录，disconnect 之后再归档到 docs/screenshots/donut-depth/，
//      避免 IDE 监听项目目录触发重编译、把 automator 会话打断；
//   5. 实测坑：Skyline 上页面滚动期间 automator 的 screenshot 请求会失步
//      （"timeout waiting for automator response"），且跨页跳转后旧页面状态会被继承
//      （残留 segments / 选中态）。因此每个截图阶段都自包含：连不上就重连、
//      主题不对就再切、状态不对就显式重置，最后校验 snapshot 再落图。
//
// 用法：node tests/e2e/donut-depth-shots.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { ensureAutomation, sleep } = require('./launcher');

const STAGE_DIR = process.env.DEPTH_STAGE || path.join(os.tmpdir(), 'donut-depth-shots');
const OUT_DIR = process.env.DEPTH_OUT || path.join(config.PROJECT_ROOT, 'docs', 'screenshots', 'donut-depth');

/** 6 段 / 12 段测试用比例（12 段为组件上限，最接近线上最坏情况） */
const R6 = [0.38, 0.22, 0.16, 0.12, 0.08, 0.04];
const R12 = [0.26, 0.17, 0.13, 0.10, 0.08, 0.07, 0.05, 0.04, 0.035, 0.03, 0.02, 0.015];
const CATS = ['c-food', 'c-shopping', 'c-life', 'c-transport', 'c-fun', 'c-drink',
  'c-bill', 'c-medical', 'c-housing', 'c-travel', 'c-pet', 'c-gift'];

function makeSegs(ratios) {
  return ratios.map((r, i) => ({
    categoryId: CATS[i % CATS.length],
    name: '分类' + (i + 1),
    ratio: r,
    cents: Math.round(r * 100000),
    percentText: (r * 100).toFixed(1),
    aggregate: i === ratios.length - 1 && ratios.length > 1,
  }));
}

async function main() {
  const log = (...a) => console.log('[depth]', ...a);
  const shots = [];
  const report = { phases: [], failures: [] };
  let mp = null;
  const consoleLogs = [];
  const exceptions = [];

  const connect = async () => {
    mp = await ensureAutomation(config, log);
    mp.on('console', (c) => consoleLogs.push(c));
    mp.on('exception', (c) => exceptions.push(c));
    return mp;
  };
  const drop = () => {
    try { if (mp && typeof mp.disconnect === 'function') mp.disconnect(); } catch (e) { /* ignore */ }
    mp = null;
  };

  const goStatistics = async () => {
    let cur = await mp.currentPage();
    if (!cur || cur.path !== 'pages/main/main') {
      await mp.callWxMethod('reLaunch', { url: '/pages/main/main' });
      await sleep(2600);
      cur = await mp.currentPage();
    }
    // 三个 tab 是 swiper + current 索引：直接置 current=0（统计页），比点 tab 稳
    // （实测点 tab 偶尔不生效，截到的会是「记账」页，圆环根本不在画面里）；
    // 同时关掉「记一笔」底部浮层——它会盖住整页，导致截图里看不到圆环。
    await cur.setData({ current: 0, sheetShow: false });
    await sleep(1400);
    let d = await cur.data();
    if (d.current !== 0) {
      const tabs = await cur.$$('.tabs__item');
      if (tabs.length) await tabs[0].tap();
      await sleep(1200);
      d = await cur.data();
    }
    if (d.current !== 0) throw new Error('切不到统计页（current=' + d.current + '）');
    return cur;
  };

  const getDonut = async () => {
    let p = null;
    for (let i = 0; i < 6 && !p; i++) {
      const cur = await mp.currentPage();
      p = await cur.$('#statisticsPanel');
      if (!p) {
        // 懒加载 / 页面还在切换：把 swiper 归位到统计页再等一会儿
        try { await cur.setData({ current: 0 }); } catch (e) { /* ignore */ }
        await sleep(1000);
      }
    }
    if (!p) throw new Error('找不到 #statisticsPanel');
    let d = await p.$('#monthDonut');
    if (!d) {
      // 面板可能停在年度模式（上轮用例遗留）→ 切回月度再取
      try { await p.callMethod('onModeMonth'); } catch (e) { /* 无此方法就继续 */ }
      await sleep(1200);
      try { await p.callMethod('refresh'); } catch (e) { /* ignore */ }
      await sleep(1200);
      d = await p.$('#monthDonut');
    }
    if (!d) throw new Error('找不到 #monthDonut');
    return { panel: p, donut: d };
  };

  const snapshot = async (donut) => {
    try { return await donut.callMethod('diagSnapshot'); } catch (e) { return null; }
  };

  /** 走真实 UI 切主题（外观页点选），失败允许重连后重试 */
  const switchTheme = async (target) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (!mp) await connect();
        await mp.callWxMethod('navigateTo', { url: '/pages/appearance/appearance' });
        await sleep(1700);
        const ap = await mp.currentPage();
        const ad = await ap.data();
        const idx = (ad.options || []).findIndex((o) => o.value === target);
        if (idx < 0) throw new Error('外观页找不到主题选项 ' + target);
        const rows = await ap.$$('.row');
        if (!rows[idx]) throw new Error('外观页 .row 数量不足（' + rows.length + '）');
        await rows[idx].tap();
        await sleep(1200);
        await mp.callWxMethod('navigateBack', { delta: 1 });
        await sleep(2000);
        return true;
      } catch (e) {
        log('切主题 ' + target + ' 第 ' + attempt + ' 次失败：' + ((e && e.message) || e));
        drop();
        await sleep(1800);
      }
    }
    return false;
  };

  /** 通用重试壳：失步就断开重连再试（不改被测代码，只重建会话） */
  const withRetry = async (name, fn, tries = 4) => {
    let lastMsg = '';
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        if (!mp) await connect();
        return await fn();
      } catch (e) {
        lastMsg = (e && e.message) || String(e);
        log(name + ' 第 ' + attempt + ' 次失败：' + lastMsg);
        report.failures.push({ label: name, attempt, message: lastMsg });
        drop();
        await sleep(2000);
      }
    }
    throw new Error(name + ' 重试 ' + tries + ' 次仍失败：' + lastMsg);
  };

  /**
   * 自包含截图阶段：主题对齐 / 状态重置 / 校验 snapshot / 截图，全部在阶段内自愈。
   * @param {string} label 文件名后缀
   * @param {Array|null} segs 注入的 segments；null = 用面板真实数据
   * @param {{theme:string, selection?:number, expectSegs?:number}} opt
   */
  const capture = async (label, segs, opt) => {
    const wantTheme = opt.theme;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        if (!mp) await connect();
        await goStatistics();
        let h = await getDonut();

        // ① 主题对齐
        let snap = await snapshot(h.donut);
        if (!snap || snap.theme !== wantTheme) {
          log('[' + label + '] 主题为 ' + (snap && snap.theme) + '，切到 ' + wantTheme);
          if (!(await switchTheme(wantTheme))) throw new Error('切主题失败');
          h = await getDonut();
        }

        // ② 状态重置：清选中 + 面板刷新回真实数据
        await h.panel.setData({ scrollInto: 'monthShareCard' });
        await sleep(2400);
        h = await getDonut();
        await h.donut.callMethod('clearSelection');
        await h.panel.callMethod('refresh');
        await sleep(1600);

        // ③ 注入目标状态。实测坑：Skyline 下 <image> 换了 data-URI 后，
        // automator 的 screenshot 会一直返回旧帧（image 图层不重绘）。
        // 绕法 = 先清空面板 segments 让组件销毁、再重新赋值让它整体重建（触发图层重绘）。
        const realSegs = (await h.panel.data()).shareSegments || [];
        const targetSegs = segs || realSegs;
        await h.panel.setData({ shareSegments: [] });
        await sleep(600);
        await h.panel.setData({ shareSegments: targetSegs });
        await sleep(1600);
        h = await getDonut();
        if (opt && typeof opt.selection === 'number') {
          await h.donut.callMethod('applySelection', opt.selection);
          await sleep(1200);
        }

        // ④ 校验快照（主题 / 段数），不符就重来
        snap = await snapshot(h.donut);
        if (!snap) throw new Error('diagSnapshot 不可用');
        if (snap.theme !== wantTheme) throw new Error('主题不符：' + snap.theme);
        const expectSegs = segs ? segs.length : opt.expectSegs;
        if (typeof expectSegs === 'number' && snap.segCount !== expectSegs) {
          throw new Error('段数不符：' + snap.segCount + ' ≠ ' + expectSegs);
        }

        const data = await mp.screenshot();
        const buf = Buffer.from(data, 'base64');
        const name = 'donut_depth_' + label;
        const sha1 = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
        shots.push({ name, buf });
        report.phases.push({ label, name, bytes: buf.length, sha1, snap });
        log('[' + label + '] ' + buf.length + 'B sha1=' + sha1 + ' ' + JSON.stringify(snap));
        return true;
      } catch (e) {
        const msg = (e && e.message) || String(e);
        log('[' + label + '] 第 ' + attempt + ' 次失败：' + msg);
        report.failures.push({ label, attempt, message: msg });
        drop();
        await sleep(2000);
      }
    }
    return false;
  };

  try {
    await withRetry('setup', async () => {
      await connect();
      const page = await goStatistics();
      // 种子：真实数据路径（5 类支出 → 5 段）
      await page.callMethod('__e2eClearDonut');
      const seeded = await page.callMethod('__e2eSeedDonut');
      report.seed = { created: seeded.created.length, ym: seeded.ym };
      log('已注入种子 ' + JSON.stringify(report.seed));
    });

    // 几何盒（换算截图裁剪区域用）
    await withRetry('geometry', async () => {
      const h = await getDonut();
      const rootEl = await h.donut.$('.cd');
      const size = await rootEl.size();
      const off = await rootEl.offset();
      report.geometry = { left: off.left, top: off.top, width: size.width, height: size.height };
      const sys = await mp.systemInfo();
      report.screen = { windowWidth: sys.windowWidth, windowHeight: sys.windowHeight, pixelRatio: sys.pixelRatio };
      log('屏幕 ' + JSON.stringify(report.screen) + ' 圆环盒 ' + JSON.stringify(report.geometry));
    });

    // DEPTH_ONLY=label1,label2 可只跑指定阶段（调试探路用，不影响正式取证）
    const only = (process.env.DEPTH_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
    const want = (label) => !only.length || only.indexOf(label) >= 0;
    // DEPTH_SET_THEME=light|dark：只切主题、不截图（供「每阶段一个会话」的取证方式预热主题）
    const setTheme = (process.env.DEPTH_SET_THEME || '').trim();
    // DEPTH_KEEP_THEME=1：结束时不要把主题恢复成 dark（跨会话取证要保住当前主题）
    const keepTheme = process.env.DEPTH_KEEP_THEME === '1';

    if (setTheme) {
      const ok = await switchTheme(setTheme);
      report.ok = ok;
      log('主题已设为 ' + setTheme + '（不截图）');
      throw new Error('__set_theme_only__');
    }

    // —— 深色 ——（真实数据 / 6 段 / 6 段选中态 / 12 段）
    if (want('real5_dark')) await capture('real5_dark', null, { theme: 'dark', expectSegs: 5 });
    if (want('seg6_dark')) await capture('seg6_dark', makeSegs(R6), { theme: 'dark' });
    if (want('seg6_dark_selected')) await capture('seg6_dark_selected', makeSegs(R6), { theme: 'dark', selection: 1 });
    if (want('seg12_dark')) await capture('seg12_dark', makeSegs(R12), { theme: 'dark' });

    // —— 浅色 ——（6 段 / 12 段）
    if (want('seg6_light')) await capture('seg6_light', makeSegs(R6), { theme: 'light' });
    if (want('seg12_light')) await capture('seg12_light', makeSegs(R12), { theme: 'light' });

    // 收尾：清种子、恢复深色
    try {
      const cur = await mp.currentPage();
      await cur.callMethod('__e2eClearDonut');
    } catch (e) { log('clearDonut 失败 ' + e.message); }
    if (!keepTheme) {
      try { await switchTheme('dark'); } catch (e) { log('恢复深色失败 ' + e.message); }
    }

    report.ok = report.phases.length >= 4;
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (msg !== '__set_theme_only__') {
      report.error = msg;
      log('异常：' + report.error);
    }
  } finally {
    report.consoleLogs = consoleLogs;
    report.exceptions = exceptions;
    report.uniqueFrames = new Set(shots.map((s) => crypto.createHash('sha1').update(s.buf).digest('hex'))).size;
    drop();
    await sleep(400);
    fs.mkdirSync(STAGE_DIR, { recursive: true });
    shots.forEach((s) => fs.writeFileSync(path.join(STAGE_DIR, s.name + '.png'), s.buf));
    fs.writeFileSync(path.join(STAGE_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    log('暂存 ' + shots.length + ' 张到 ' + STAGE_DIR);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    shots.forEach((s) => fs.writeFileSync(path.join(OUT_DIR, s.name + '.png'), s.buf));
    fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    log('归档 ' + shots.length + ' 张到 ' + OUT_DIR + '（不同帧 ' + report.uniqueFrames + ' 个）');
    process.exit(report.ok ? 0 : 1);
  }
}

main();
