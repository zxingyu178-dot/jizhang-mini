// tests/e2e/bar-shading-shots.js
// v1.5.3 柱体「6 档明暗台阶」真渲染取证：在开发者工具模拟器里截月度 / 年度两张柱图，
// 再对截图做像素列采样，量出「相邻档之间的亮度跳变」。
//
// 为什么要有这个脚本：v1.5.1 的教训是「离线验证通过 ≠ 组件里渲染通过」。
// 台阶这类像素级效果只能看真截图，任何 JS 单测 / SVG 源码断言都证明不了它画出来了。
//
// 取证口径（每条都是踩过的坑）：
//   1. 走生产代码路径：柱子必须来自 utils/bar-shading.buildBarsSVG → data-URI → <image>；
//   2. 主题必须读组件自己的判断（panel.callMethod('shareThemeKey')），不信外部状态 ——
//      v1.5.0 就是在这里误判过，把「截图旧帧」当成「组件读错主题」；
//   3. **每阶段都 reLaunch 重建整页**：Skyline 下 <image> 换了 data-URI 后 automator 的
//      screenshot 会一直返回旧帧（image 图层不重绘）。柱图现在正是 <image>，
//      不重建就会截到上一版画面，取证等于没做；
//   4. 截图先落系统临时目录，disconnect 之后再归档，避免 IDE 监听项目目录触发重编译；
//   5. 断言用「采样列里出现几个不同的档位色」：旧版两色标软过渡会得到几十种颜色，
//      新版硬台阶只有 5 种实色。颜色种数本身就是「台阶有没有落地」的判据。
//
// 用法：node tests/e2e/bar-shading-shots.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const { ensureAutomation, sleep } = require('./launcher');
const png = require('./png-lite');

const STAGE_DIR = process.env.BAR_STAGE || path.join(os.tmpdir(), 'bar-shading-shots');
const OUT_DIR = process.env.BAR_OUT || path.join(config.PROJECT_ROOT, 'docs', 'screenshots', 'bar-shading');

/** 台阶跳变下限（色阶）：低于这个值肉眼看不出来，等于没画 */
const MIN_STEP_JUMP = 4;
/** 采样列里允许的实色种数上限：超过就是软过渡（旧版），不是硬台阶 */
const MAX_DISTINCT = 8;

async function main() {
  const log = (...a) => console.log('[bar]', ...a);
  const report = { createdAt: new Date().toISOString(), phases: [], failures: [] };
  let mp = null;

  const connect = async () => {
    mp = await ensureAutomation(config, log);
    return mp;
  };
  const drop = () => {
    try { if (mp && typeof mp.disconnect === 'function') mp.disconnect(); } catch (e) { /* ignore */ }
    mp = null;
  };

  /** 冷启动到统计页：reLaunch 会让整页节点重建，绕开 Skyline 的 image 旧帧 */
  const goStatistics = async () => {
    await mp.callWxMethod('reLaunch', { url: '/pages/main/main' });
    await sleep(3000);
    let cur = null;
    for (let i = 0; i < 8 && !cur; i++) {
      const p = await mp.currentPage().catch(() => null);
      if (p && p.path === 'pages/main/main') cur = p;
      else await sleep(700);
    }
    if (!cur) throw new Error('reLaunch 后拿不到 pages/main/main');
    await cur.setData({ current: 0, sheetShow: false });
    await sleep(1800);
    const d = await cur.data();
    if (d.current !== 0) throw new Error('切不到统计页（current=' + d.current + '）');
    return cur;
  };

  const getPanel = async () => {
    const cur = await mp.currentPage();
    const p = await cur.$('#statisticsPanel');
    if (!p) throw new Error('找不到 #statisticsPanel');
    return p;
  };

  /** 走真实 UI 切主题（直接改 settings 再 reLaunch 不会重跑 App.onLaunch，主题不生效） */
  const switchTheme = async (target) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (!mp) await connect();
        const cur0 = await mp.currentPage();
        if (!cur0 || cur0.path !== 'pages/main/main') {
          await mp.callWxMethod('reLaunch', { url: '/pages/main/main' });
          await sleep(2400);
        }
        await mp.callWxMethod('navigateTo', { url: '/pages/appearance/appearance' });
        await sleep(1700);
        const ap = await mp.currentPage();
        const ad = await ap.data();
        const idx = (ad.options || []).findIndex((o) => o.value === target);
        if (idx < 0) throw new Error('外观页找不到主题选项 ' + target);
        const rows = await ap.$$('.row');
        if (!rows[idx]) throw new Error('外观页 .row 数量不足（' + rows.length + '）');
        await rows[idx].tap();
        await sleep(1300);
        await mp.callWxMethod('navigateBack', { delta: 1 });
        await sleep(2000);
        return true;
      } catch (e) {
        log('切主题 ' + target + ' 第 ' + attempt + ' 次失败：' + ((e && e.message) || e));
        drop();
        await sleep(1800);
      }
    }
    throw new Error('切主题 ' + target + ' 连续 3 次失败');
  };

  const { analyze } = require('./bar-analyze');

  /**
   * 页面背景亮度（0~255）：取左边缘一列的中位亮度。
   * 用来判断「这一帧到底是深色还是浅色」——组件自报的主题不可信，
   * 只认像素（v1.5.0 的误判就是信了状态没信画面）。
   */
  function pageBgLuma(img) {
    const xs = [2, 3, 4];
    const vals = [];
    for (let i = 0; i < xs.length; i++) {
      for (let y = 260; y < img.height - 120; y += 17) {
        const o = (y * img.width + xs[i]) * 4;
        vals.push(png.luma([img.data[o], img.data[o + 1], img.data[o + 2]]));
      }
    }
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)] || 0;
  }
  /**
   * 单阶段：切主题 → reLaunch 重建 → 切模式 → 校验图源与主题 → 截图 → 裁柱区 → 采样。
   * @param {boolean} isMonthly true=12 月柱（年度模式） false=日支出柱（月度模式）
   */
  const phase = async (name, themeKey, isMonthly) => {
    log('--- 阶段 ' + name + '（主题 ' + themeKey + '，' + (isMonthly ? '年度 12 月' : '月度日支出') + '）');
    if (!mp) await connect();
    await switchTheme(themeKey);
    await goStatistics();

    const panel = await getPanel();
    // 顺序很关键：loadMonth / loadYear 的 patch 里会把 modMap 整体重置成「全部启用」，
    // 先覆盖会被冲掉（实测第一次跑就是截到了完整页面、柱图还在屏幕外）。
    // 所以先切模式，再覆盖 modMap，之后不再触发任何重算。
    await panel.callMethod(isMonthly ? 'onModeYear' : 'onModeMonth');
    await sleep(1800);
    // 把上方模块关掉，让目标图进入视口。
    // 走 modMap 而不是滚动：实测 scroll-into-view 在 Skyline 下不生效，
    // wx.pageScrollTo 会直接把 automator 会话打成 timeout。
    // 关 → 开 两步是必需的：Skyline 下 <image> 换 data-URI 后 automator 的 screenshot
    // 会一直返回旧帧（v1.5.0 环形图取证踩过同一个坑）。先整块卸载再挂回来，
    // 节点重建才会重新栅格化。modMap 只是「用户可见的模块」配置，不动几何 / 数据 / 口径。
    const targetMod = isMonthly ? { 'year-monthly-trend': true } : { 'daily-expense-trend': true };
    await panel.setData({ modMap: {} });
    await sleep(700);
    await panel.setData({ modMap: targetMod });
    await sleep(1600);

    const pd = await panel.data();
    const componentTheme = await panel.callMethod('shareThemeKey');
    const uri = isMonthly ? pd.monthlyBarUri : pd.dailyBarUri;
    const pts = isMonthly ? pd.monthly : pd.daily;
    const axis = isMonthly ? pd.monthlyAxis : pd.dailyAxis;
    const svg = uri && uri.indexOf('base64,') > 0
      ? Buffer.from(uri.split('base64,')[1], 'base64').toString('ascii')
      : '';
    const fills = Array.from(new Set((svg.match(/fill="#[0-9a-f]{6}"/g) || []).map((f) => f.replace(/fill="|"/g, '').toLowerCase())));
    const check = {
      componentTheme: componentTheme,
      mode: pd.mode,
      pointCount: (pts || []).length,
      zoneRpx: axis && axis.zoneRpx,
      uriLen: uri ? uri.length : 0,
      svgLen: svg.length,
      rectCount: (svg.match(/<rect/g) || []).length,
      pathCount: (svg.match(/<path/g) || []).length,
      fills: fills,
    };
    log('图源 ' + JSON.stringify(check));
    if (componentTheme !== themeKey) throw new Error('组件主题不符：' + componentTheme + ' ≠ ' + themeKey);
    if (pd.mode !== (isMonthly ? 'year' : 'month')) throw new Error('模式不符：' + pd.mode);
    if (!uri) throw new Error('图源为空');
    if (fills.length < 3) throw new Error('图源实色档位不足 3 种：' + JSON.stringify(fills));

    // 拿一帧「主题对、且真的画着柱子」的截图。
    // Skyline 下截图会滞后于 setData（v1.5.0 环形图取证踩过，本轮又踩了三次）：
    // 实测滞后不止一帧 —— 有一次组件自报 light 而像素还是深色底，另一次像素对了
    // 但画面还停在「月度 + 分类占比」。所以这里用「背景亮度 + 能不能解析出柱区」
    // 两个条件一起验收这一帧，不满足就重截，而不是拿错帧去做结论。
    let img = null;
    let res = null;
    for (let i = 1; i <= 8; i++) {
      const b64 = await mp.screenshot();
      const cand = png.decode(Buffer.from(b64, 'base64'));
      const bg = pageBgLuma(cand);
      const wantLight = themeKey === 'light';
      const themeOk = wantLight ? bg > 150 : bg < 90;
      const cand2 = themeOk ? analyze(cand, fills, 12) : null;
      const barsOk = !!(cand2 && !cand2.error);
      log('取帧 ' + i + '：背景亮度 ' + bg.toFixed(1) + (themeOk ? ' 主题✓' : ' 主题✗')
        + (barsOk ? ' 柱区✓(' + cand2.bands.length + ' 档)' : ' 柱区✗ ' + (cand2 ? cand2.error : '')));
      if (themeOk && barsOk) { img = cand; res = cand2; break; }
      await sleep(1000);
    }
    if (!img) throw new Error('连续 8 帧都拿不到「' + themeKey + ' 主题 + 有柱区」的画面');

    if (!fs.existsSync(STAGE_DIR)) fs.mkdirSync(STAGE_DIR, { recursive: true });
    const sys = await mp.systemInfo();
    log('截图 ' + img.width + 'x' + img.height + ' 窗口 ' + sys.windowWidth + 'x' + sys.windowHeight);
    fs.writeFileSync(path.join(STAGE_DIR, 'full_' + name + '.png'), png.encode(img)); // 现场全图，定位失败时用来肉眼排查

    log('柱区定位 ' + JSON.stringify(res.bbox) + ' 采样列 x=' + res.sampleX + ' 柱高 ' + res.barH + 'px 同基线列数 ' + res.colCount);

    const b = res.bbox;
    const pad = 4;
    const cropImg = png.crop(img, b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + 1 + pad * 2, b.y1 - b.y0 + 1 + pad * 2);
    fs.writeFileSync(path.join(STAGE_DIR, 'crop_' + name + '.png'), png.encode(cropImg));
    fs.writeFileSync(path.join(STAGE_DIR, 'zoom3x_' + name + '.png'), png.encode(png.scale(cropImg, 3)));

    log('档位 ' + JSON.stringify(res.bands) + ' 跳变 ' + JSON.stringify(res.jumps));

    const out = {
      name: name, theme: themeKey, mode: pd.mode, check: check,
      shot: img.width + 'x' + img.height,
      window: sys.windowWidth + 'x' + sys.windowHeight,
      analyze: res,
      cropPx: cropImg.width + 'x' + cropImg.height,
    };
    report.phases.push(out);

    if (res.distinctCount > MAX_DISTINCT) {
      throw new Error(name + '：采样列出现 ' + res.distinctCount + ' 种颜色，是软过渡不是硬台阶（疑似旧帧）');
    }
    if (res.bands.length < 5) {
      throw new Error(name + '：只采到 ' + res.bands.length + ' 档（应 ≥5），柱顶可能被裁掉或柱高不足');
    }
    if (res.jumps && res.jumps.min < MIN_STEP_JUMP) {
      throw new Error(name + '：相邻档最小跳变 ' + res.jumps.min + ' < ' + MIN_STEP_JUMP);
    }
    return out;
  };

  /** 单阶段失败就重连再来一次（Skyline 下第一次截图经常是旧帧） */
  const withRetry = async (label, fn, tries = 3) => {
    for (let i = 1; i <= tries; i++) {
      try {
        return await fn();
      } catch (e) {
        const msg = (e && e.message) || String(e);
        log('[' + label + '] 第 ' + i + ' 次失败：' + msg);
        report.failures.push({ label: label, attempt: i, message: msg });
        drop();
        await sleep(2200);
      }
    }
    return null;
  };

  try {
    await withRetry('warmup', async () => {
      await connect();
      const cur = await goStatistics();
      // 种子：只注入当前年月的测试账单（env 守卫：仅 develop/trial 允许）。
      // 不注入的话「本月」没有支出 → 日支出柱图是空态，图源里一个矩形都没有，
      // 这不是 bug 而是设计（整月无支出显示空态文案），但也就没东西可取证。
      await cur.callMethod('__e2eClearDonut');
      const seeded = await cur.callMethod('__e2eSeedDonut');
      report.seed = { created: (seeded.created || []).length, ym: seeded.ym };
      log('种子 ' + JSON.stringify(report.seed));
      await sleep(1200);
    });

    // BAR_ONLY=year_dark,year_light 可只跑指定阶段（调试 / 单条重跑用）
    const only = (process.env.BAR_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
    const want = (label) => !only.length || only.indexOf(label) >= 0;
    const steps = [
      ['year_dark', 'dark', true],
      ['year_light', 'light', true],
      ['daily_dark', 'dark', false],
      ['daily_light', 'light', false],
    ];
    let failed = null;
    for (const st of steps) {
      if (!want(st[0])) continue;
      const ok = await withRetry(st[0], () => phase(st[0], st[1], st[2]));
      if (!ok && !failed) failed = st[0];
    }
    if (failed) throw new Error(failed + ' 取证失败');

    // 收尾：清测试账单、恢复深色
    try {
      const cur = await mp.currentPage();
      await cur.callMethod('__e2eClearDonut');
      report.cleaned = true;
    } catch (e) { log('清理种子失败 ' + e.message); }
    try { await switchTheme('dark'); } catch (e) { log('恢复深色失败 ' + e.message); }
    report.ok = report.phases.length === (only.length || 4);
  } catch (e) {
    report.error = (e && e.message) || String(e);
    log('异常：' + report.error);
  } finally {
    log('断连，开始归档（避免写项目目录触发重编译）');
    drop();
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = fs.existsSync(STAGE_DIR) ? fs.readdirSync(STAGE_DIR).filter((f) => /\.png$/.test(f)) : [];
  for (const f of files) fs.copyFileSync(path.join(STAGE_DIR, f), path.join(OUT_DIR, f));
  report.archived = files;
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  log('归档到 ' + OUT_DIR + '，共 ' + files.length + ' 张');

  const hard = report.failures.filter((f) => f.attempt >= 1);
  if (report.ok) {
    log('取证通过：4 个阶段的采样列都呈硬台阶');
  } else {
    log('取证未通过。失败记录：');
    hard.forEach((f) => log('  ✗ [' + f.label + ' #' + f.attempt + '] ' + f.message));
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
