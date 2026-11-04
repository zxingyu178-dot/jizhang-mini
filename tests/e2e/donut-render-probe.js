// tests/e2e/donut-render-probe.js
// v1.4.0 Gate 0 诊断探针：在开发者工具模拟器里逐层隔离「圆环为什么看不到」。
//
// 做法：不碰业务代码，直接对 category-donut 组件实例 setData({uri}) 注入受控 SVG 变体，
// 一次只改一个变量（宽高 / 颜色格式 / 轨道透明度 / 选中态透明属性），每步读回
// image 的 load|error 状态并截图。base64 里首个变体 = 组件当前真实产物（现状对照）。
//
// 用法：
//   node tests/e2e/donut-render-probe.js            # 跑全部变体
//   PROBE_VARIANTS=cur,min  只跑指定变体（逗号分隔）
//   PROBE_STAGE=<dir>       覆盖截图暂存/归档目录
// 铁律：测试中截图不落项目内（会触发 IDE 重编译、杀死会话），disconnect 后再写归档目录。
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { ensureAutomation, sleep } = require('./launcher');

/* ---------------- SVG 变体构造 ---------------- */

const R = 40;
const CX = 50;
const STROKE = 12;
const CIRC = 2 * Math.PI * R;
const HEX = ['#4E79F0', '#F0A24E', '#4EF0A2', '#A24EF0', '#F04E79', '#4EC9F0', '#F0D24E'];

function n(v) {
  // 固定小数位，避免科学计数法（SVG 数值容错差）
  return (Math.round(v * 1000) / 1000).toString();
}

/**
 * 按选项拼一个圆环 SVG。所有变量都由 opts 显式控制，便于一次只改一项。
 * @param {object} o {ratios, colors, width, height, par, track, dimIndex, dimAttr}
 */
function svgDonut(o) {
  const root = ['xmlns="http://www.w3.org/2000/svg"', 'viewBox="0 0 100 100"'];
  if (o.width != null) root.push('width="' + o.width + '"');
  if (o.height != null) root.push('height="' + o.height + '"');
  if (o.par) root.push('preserveAspectRatio="' + o.par + '"');

  let body = '';
  if (o.track) {
    body += '<circle cx="' + CX + '" cy="' + CX + '" r="' + R + '" fill="none" stroke="' + o.track.color +
      '" stroke-width="' + STROKE + '"' +
      (o.track.opacity != null ? ' stroke-opacity="' + o.track.opacity + '"' : '') + '/>';
  }
  let acc = 0;
  (o.ratios || []).forEach((ratio, i) => {
    const dash = ratio * CIRC;
    const rest = CIRC - dash;
    const off = -acc * CIRC;
    acc += ratio;
    const color = o.colors[i % o.colors.length];
    const dim = o.dimIndex != null ? (o.dimIndex === i ? 1 : 0.28) : null;
    body += '<circle cx="' + CX + '" cy="' + CX + '" r="' + R + '" fill="none" stroke="' + color +
      '" stroke-width="' + STROKE + '" stroke-dasharray="' + n(dash) + ' ' + n(rest) +
      '" stroke-dashoffset="' + n(off) + '"' +
      (dim != null ? ' ' + (o.dimAttr || 'opacity') + '="' + dim + '"' : '') +
      ' transform="rotate(-90 ' + CX + ' ' + CX + ')"/>';
  });
  return '<svg ' + root.join(' ') + '>' + body + '</svg>';
}

const HSL = ['hsl(210, 62%, 60%)', 'hsl(30, 62%, 60%)', 'hsl(140, 62%, 60%)', 'hsl(280, 62%, 60%)', 'hsl(340, 62%, 60%)'];

/** 由真实 ratios 派生变体表（cur 由运行时取组件真实 uri，不在此处） */
function buildVariants(ratios) {
  const one = [1];
  return [
    {
      key: 'min_nofill',
      desc: '最小静态：无宽高、单个 fill 红圆（验证 <image>+data-URI SVG 能不能出像素）',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="#FF3B30"/></svg>',
    },
    {
      key: 'min_wh',
      desc: '同上 + width/height=100',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="30" fill="#FF3B30"/></svg>',
    },
    {
      key: 'one_stroke_hex',
      desc: '单段整圈 stroke + dasharray（hex、有宽高、无轨道）',
      svg: svgDonut({ ratios: one, colors: ['#4E79F0'], width: 100, height: 100 }),
    },
    {
      key: 'real_hex_wh',
      desc: '真实比例 5 段 + hex + width/height（无轨道）',
      svg: svgDonut({ ratios, colors: HEX, width: 100, height: 100 }),
    },
    {
      key: 'real_hsl_wh',
      desc: '真实比例 5 段 + hsl（当前颜色格式）+ width/height —— 隔离 hsl',
      svg: svgDonut({ ratios, colors: HSL, width: 100, height: 100 }),
    },
    {
      key: 'real_hex_noWH',
      desc: '真实比例 5 段 + hex + 无宽高（当前根节点形态）—— 隔离宽高',
      svg: svgDonut({ ratios, colors: HEX }),
    },
    {
      key: 'real_hex_rgba_track',
      desc: '真实比例 + hex 分段 + rgba 轨道（当前轨道写法）—— 隔离 rgba',
      svg: svgDonut({ ratios, colors: HEX, width: 100, height: 100, track: { color: 'rgba(255,255,255,0.10)' } }),
    },
    {
      key: 'real_hex_trackopacity',
      desc: '真实比例 + hex 分段 + hex 轨道 + stroke-opacity —— 目标修复形态',
      svg: svgDonut({ ratios, colors: HEX, width: 100, height: 100, track: { color: '#FFFFFF', opacity: 0.1 } }),
    },
    {
      key: 'sel_opacity',
      desc: '选中态：dim 用 opacity 属性（当前写法）',
      svg: svgDonut({ ratios, colors: HEX, width: 100, height: 100, dimIndex: 0, dimAttr: 'opacity' }),
    },
    {
      key: 'sel_strokeopacity',
      desc: '选中态：dim 用 stroke-opacity 属性',
      svg: svgDonut({ ratios, colors: HEX, width: 100, height: 100, dimIndex: 0, dimAttr: 'stroke-opacity' }),
    },
    {
      key: 'track_rgba_only',
      desc: '只有轨道：rgba(255,255,255,0.10)（当前写法，零支出态就靠它）',
      svg: svgDonut({ ratios: [], colors: HEX, width: 100, height: 100, track: { color: 'rgba(255,255,255,0.10)' } }),
    },
    {
      key: 'track_hexopacity_only',
      desc: '只有轨道：hex + stroke-opacity（目标修复形态）',
      svg: svgDonut({ ratios: [], colors: HEX, width: 100, height: 100, track: { color: '#FFFFFF', opacity: 0.1 } }),
    },
    {
      key: 'empty_svg',
      desc: '空 SVG 基线：什么都没有（用于判定「什么都没画」的指纹）',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"></svg>',
    },
    {
      key: 'track_white_solid',
      desc: '轨道：纯白 hex 不透明（判定 rgba 到底有没有画）',
      svg: svgDonut({ ratios: [], colors: HEX, width: 100, height: 100, track: { color: '#FFFFFF' } }),
    },
    {
      key: 'track_rgba_half',
      desc: '轨道：rgba(255,255,255,0.5)（若 rgba 有效应比 0.10 明显更亮）',
      svg: svgDonut({ ratios: [], colors: HEX, width: 100, height: 100, track: { color: 'rgba(255,255,255,0.5)' } }),
    },
  ];
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);

/* ---------------- 修复后可见性验证（PROBE_MODE=verify） ---------------- */

/**
 * 走生产代码路径的真实状态截图：月度（默认）/ 选中一段 / 年度。
 * 不做任何 uri 注入 —— 截到的必须是组件自己用 buildDonutSVG 画出来的画面。
 */
async function runVerify(ctx) {
  const { mp, shot, report, log, panel, donutEl } = ctx;
  const phases = [];

  /** 走真实 UI 切主题：外观页 .row 按 options 顺序点选 */
  const switchTheme = async (target) => {
    await mp.callWxMethod('navigateTo', { url: '/pages/appearance/appearance' });
    await sleep(1200);
    const ap = await mp.currentPage();
    const ad = await ap.data();
    const idx = (ad.options || []).findIndex((o) => o.value === target);
    if (idx < 0) throw new Error('外观页找不到主题选项 ' + target);
    const rows = await ap.$$('.row');
    if (!rows[idx]) throw new Error('外观页 .row 数量不足（' + rows.length + '）');
    await rows[idx].tap();
    await sleep(900);
    await mp.callWxMethod('navigateBack', { delta: 1 });
    await sleep(1400);
  };

  const snapOf = async (label) => {
    let s = null;
    try { s = await donutEl.callMethod('diagSnapshot'); } catch (e) { s = null; }
    if (s) phases.push(Object.assign({ phase: label }, s));
    log('[' + label + '] ' + JSON.stringify(s));
    return s;
  };

  // ① 月度默认态（首帧）
  await snapOf('month');
  report.shots = report.shots || [];
  report.shots.push({ phase: 'month', sha1: await shot('v1.4.0_after_donut_month') });

  // ② 选中第一段（走组件 applySelection：中心切换 + 其余分段变淡）
  const dd0 = await donutEl.data();
  const seg0 = (dd0.segments || [])[0];
  if (seg0) {
    await donutEl.callMethod('applySelection', 0);
    await sleep(800);
    await snapOf('selected');
    report.shots.push({ phase: 'selected', sha1: await shot('v1.4.0_after_donut_selected') });
    await donutEl.callMethod('clearSelection');
    await sleep(600);
  }

  // ③ 年度占比（同一组件的第二处复用）
  await panel.setData({ scrollInto: 'yearShareCard' });
  await panel.callMethod('onModeYear');
  await sleep(1600);
  const yd = await panel.data();
  report.yearSegments = (yd.yearShareSegments || []).length;
  const yearDonut = await panel.$('#yearDonut');
  if (yearDonut) {
    await snapOf('year');
    report.shots.push({ phase: 'year', sha1: await shot('v1.4.0_after_donut_year') });
  } else {
    log('年度圆环未渲染（yearShareSegments=' + report.yearSegments + '）');
  }
  // 恢复月度
  await panel.callMethod('onModeMonth');
  await sleep(900);

  // ④ 浅色主题下的月度圆环（主题切换后必须仍然可见、且不是白底白环）
  try {
    await switchTheme('light');
    const page2 = await mp.currentPage();
    const panel2 = await page2.$('#statisticsPanel');
    if (panel2) {
      await panel2.setData({ scrollInto: 'monthShareCard' });
      await sleep(1000);
      const d2 = await panel2.$('#monthDonut');
      if (d2) {
        let s = null;
        try { s = await d2.callMethod('diagSnapshot'); } catch (e) { s = null; }
        if (s) phases.push(Object.assign({ phase: 'light' }, s));
        log('[light] ' + JSON.stringify(s));
        report.shots.push({ phase: 'light', sha1: await shot('v1.4.0_after_donut_light') });
      } else {
        log('浅色：找不到 #monthDonut');
      }
    }
  } catch (e) {
    log('浅色主题验证失败：' + ((e && e.message) || e));
  } finally {
    // 无论如何恢复深色，避免污染后续用例
    try { await switchTheme('dark'); } catch (e) { log('恢复深色失败：' + ((e && e.message) || e)); }
  }

  report.phases = phases;
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const only = (process.env.PROBE_VARIANTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const stageDir = process.env.PROBE_STAGE || path.join(config.PROJECT_ROOT, 'docs', 'screenshots');
  const log = (...a) => console.log('[probe]', ...a);
  const shots = [];
  const consoleLogs = [];
  const exceptions = [];
  const report = { variants: [] };

  const mp = await ensureAutomation(config, log);
  mp.on('console', (e) => consoleLogs.push(e));
  mp.on('exception', (e) => exceptions.push(e));

  const shot = async (name) => {
    const data = await mp.screenshot();
    const buf = Buffer.from(data, 'base64');
    shots.push({ name, buf });
    log('截图 ' + name + ' sha1=' + sha1(buf) + ' bytes=' + buf.length);
    return sha1(buf);
  };

  let donutEl = null;
  try {
    const page = await mp.currentPage();
    const tabs = await page.$$('.tabs__item');
    if (!tabs.length) throw new Error('找不到 .tabs__item');
    await tabs[0].tap();
    await sleep(900);

    // 注入固定种子（仅 develop 可用），保证 5 段真实比例
    await page.callMethod('__e2eClearDonut');
    await page.callMethod('__e2eSeedDonut');
    const panel = await page.$('#statisticsPanel');
    if (!panel) throw new Error('找不到 #statisticsPanel');
    await panel.callMethod('refresh');
    await sleep(1200);

    const pd = await panel.data();
    report.panel = {
      mode: pd.mode,
      shareSegments: (pd.shareSegments || []).length,
      shareList: (pd.shareList || []).length,
    };
    log('面板：mode=' + pd.mode + ' segments=' + report.panel.shareSegments);

    await panel.setData({ scrollInto: 'monthShareCard' });
    await sleep(1000);

    donutEl = await panel.$('#monthDonut');
    if (!donutEl) throw new Error('找不到 #monthDonut（圆环组件未渲染）');

    const rootEl = await donutEl.$('.cd');
    const off = await rootEl.offset();
    const sz = await rootEl.size();
    report.geometry = { left: off.left, top: off.top, width: sz.width, height: sz.height };

    // Gate 0 快照（组件内自带诊断，开发环境返回对象）
    let snap = null;
    try { snap = await donutEl.callMethod('diagSnapshot'); } catch (e) { snap = null; }
    const dd = await donutEl.data();
    report.gate0 = {
      diagSnapshot: snap,
      dataKeys: { uriLen: (dd.uri || '').length, imgStatus: dd.imgStatus, imgErr: dd.imgErr, size: dd.size },
      segmentsLen: (dd.segments || []).length,
    };
    log('Gate0 快照：' + JSON.stringify(report.gate0));

    const ratios = (dd.segments || []).map((s) => (s.ratio > 0 ? s.ratio : 0));
    if (!ratios.length) throw new Error('segments 为空，无法测真实比例');

    if (process.env.PROBE_MODE === 'verify') {
      await runVerify({ mp, shot, report, log, panel, donutEl });
    } else {
      // —— 现状截图（首帧最新鲜；Skyline 常驻首页后续帧可能冻结，下面用 sha1 对比自证）——
      await shot('v1.4.0_gate0_donut_before');
      const variants = buildVariants(ratios).filter((v) => !only.length || only.includes(v.key));
      const plan = [{ key: 'cur', desc: '组件当前真实产物（不注入）', keep: true }].concat(variants);

      for (const v of plan) {
        if (!v.keep) {
          await donutEl.setData({ uri: 'data:image/svg+xml;base64,' + b64(v.svg) });
          await sleep(900);
        }
        const cur = await donutEl.data();
        const h = await shot('v1.4.0_probe_' + v.key);
        report.variants.push({
          key: v.key,
          desc: v.desc,
          svgLen: v.svg ? v.svg.length : (v.keep ? report.gate0.dataKeys.uriLen : 0),
          hasWidth: v.svg ? /<svg[^>]*\swidth=/.test(v.svg) : null,
          hasHsl: v.svg ? /hsl\(/.test(v.svg) : null,
          hasRgba: v.svg ? /rgba\(/.test(v.svg) : null,
          imgStatus: cur.imgStatus,
          imgErr: cur.imgErr,
          shotSha1: h,
        });
        log('变体 ' + v.key + ' → imgStatus=' + cur.imgStatus + ' imgErr=' + (cur.imgErr || '-') + ' sha1=' + h);
      }
    }
  } catch (e) {
    report.error = (e && e.message) || String(e);
    log('探针异常：' + report.error);
  } finally {
    report.consoleLogs = consoleLogs.map((c) => (typeof c === 'string' ? c : JSON.stringify(c))).slice(0, 60);
    report.exceptions = exceptions.map((c) => (typeof c === 'string' ? c : JSON.stringify(c))).slice(0, 20);
    // automator 0.12.1 的 disconnect() 返回 undefined，不能直接 .catch()
    try { mp.disconnect(); } catch (e) { log('disconnect 异常：' + e.message); }
    await sleep(400);

    // disconnect 之后才落盘（避免触发 IDE 自动重编译）
    fs.mkdirSync(stageDir, { recursive: true });
    shots.forEach((s) => {
      fs.writeFileSync(path.join(stageDir, s.name + '_simulator.png'), s.buf);
    });
    const reportPath = path.join(stageDir, 'v1.4.0_probe-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    log('已归档 ' + shots.length + ' 张截图 + 报告到 ' + stageDir);

    // 冻帧自证：不同变体截图 sha1 若完全相同 = 截图 surface 未更新
    const hashes = shots.map((s) => sha1(s.buf));
    const unique = new Set(hashes);
    log('截图指纹：' + unique.size + ' 个不同 / ' + hashes.length + ' 张' +
      (unique.size < hashes.length ? ' ← 存在相同帧（可能冻帧，需单变体独立重跑）' : ''));
    process.exit(report.error ? 1 : 0);
  }
}

main();
