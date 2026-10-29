// tests/e2e/cumulative-view.js — 累计消费趋势 GUI 验证（v1.3.0 Gate G）
// 开启 cumulative-trend → 确认组件渲染（data-URI 非空、points 有数据）→ 截图 → 恢复默认。
'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { ensureAutomation, sleep } = require('./launcher');

async function main() {
  const log = (...a) => console.log('[e2e]', ...a);
  const mp = await ensureAutomation(config, log);
  const checks = [];
  const ok = (cond, msg) => { checks.push({ cond, msg }); log((cond ? 'PASS ' : 'FAIL ') + msg); };

  try {
    let page = await mp.currentPage();
    const tabs = await page.$$('.tabs__item');
    await tabs[0].tap();
    await sleep(900);

    const panel = await page.$('#statisticsPanel');
    if (!panel) throw new Error('找不到 statisticsPanel');

    // 开启累计消费趋势（经组件方法，构造 switch change）
    let pd = await panel.data();
    await panel.callMethod('onToggleModule', {
      currentTarget: { dataset: { id: 'cumulative-trend' } },
      detail: { value: true },
    });
    await sleep(1000);

    pd = await panel.data();
    ok(pd.modMap['cumulative-trend'] === true, '累计趋势模块已启用');
    ok(pd.cumPoints.length > 0, '累计 points 有数据（actual=' + pd.cumPoints.length + ')');
    ok(pd.cumMax > 0, '累计 max > 0');

    // 读取内部组件，确认 data-URI 已生成
    const cumEl = await panel.$('cumulative-trend');
    ok(!!cumEl, '存在 cumulative-trend 组件');
    if (cumEl) {
      const cd = await cumEl.data();
      ok(typeof cd.uri === 'string' && cd.uri.indexOf('data:image/svg+xml') === 0, '组件 SVG data-URI 已生成');
    }

    // 滚动到累计卡片再截图（scroll-into-view 是 Skyline 下可靠的真实滚动）
    await panel.setData({ scrollInto: 'cumCard' });
    await sleep(800);
    const shot = await mp.screenshot();
    await panel.setData({ scrollInto: '' });
    await sleep(300);

    // 恢复默认（cumulative-trend 默认关闭）
    await panel.callMethod('onResetModules', {});
    await sleep(900);
    pd = await panel.data();
    ok(pd.modMap['cumulative-trend'] !== true, '恢复默认后累计趋势关闭');

    await mp.disconnect();
    await sleep(300);
    fs.mkdirSync(config.SHOT_DIR, { recursive: true });
    const buf = Buffer.from(shot, 'base64');
    const name = 'cumulative-trend-view_simulator.png';
    fs.writeFileSync(path.join(config.SHOT_DIR, name), buf);
    log('已归档截图：' + name + ' (' + buf.length + ' bytes)');
  } catch (e) {
    await mp.disconnect().catch(() => {});
    console.error('GUI 验证异常：', e && e.message ? e.message : e);
    process.exit(1);
  }

  const failed = checks.filter((c) => !c.cond);
  log('GUI 检查汇总：' + (checks.length - failed.length) + '/' + checks.length + ' 通过');
  process.exit(failed.length ? 1 : 0);
}

main();
