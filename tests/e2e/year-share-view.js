// tests/e2e/year-share-view.js — 全年分类占比 GUI 验证（v1.3.0 Gate H）
// 切年度 → 确认 category-donut 渲染（data-URI 非空、segments 与列表一致）→ 截图 → 切回月度。
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
    await sleep(800);

    const panel = await page.$('#statisticsPanel');
    if (!panel) throw new Error('找不到 statisticsPanel');

    // 切年度
    await panel.callMethod('onModeYear', {});
    await sleep(1100);
    let pd = await panel.data();
    ok(pd.mode === 'year', '已切换年度模式');
    ok(pd.yearShareList.length > 0, '年度占比列表有数据（actual=' + pd.yearShareList.length + ')');
    ok(pd.yearShareSegments.length > 0, '年度 segments 有数据');

    // 圆环与列表段数一致
    eq2(pd.yearShareSegments.length, pd.yearShareList.length, '圆环段数与列表一致');

    // 滚动到年度占比卡片
    await panel.setData({ scrollInto: 'yearShareCard' });
    await sleep(800);

    // 读取内部 donut 组件，确认 data-URI
    const donutEl = await panel.$('category-donut');
    ok(!!donutEl, '存在 category-donut 组件');
    if (donutEl) {
      const dd = await donutEl.data();
      ok(typeof dd.uri === 'string' && dd.uri.indexOf('data:image/svg+xml') === 0, 'Donut SVG data-URI 已生成');
    }

    const shot = await mp.screenshot();
    await panel.setData({ scrollInto: '' });
    await sleep(200);

    // 切回月度（恢复初始）
    await panel.callMethod('onModeMonth', {});
    await sleep(900);
    pd = await panel.data();
    ok(pd.mode === 'month', '已切回月度模式');

    await mp.disconnect();
    await sleep(300);
    fs.mkdirSync(config.SHOT_DIR, { recursive: true });
    const buf = Buffer.from(shot, 'base64');
    const name = 'year-share-view_simulator.png';
    fs.writeFileSync(path.join(config.SHOT_DIR, name), buf);
    log('已归档截图：' + name + ' (' + buf.length + ' bytes)');
  } catch (e) {
    await mp.disconnect().catch(() => {});
    console.error('GUI 验证异常：', e && e.message ? e.message : e);
    process.exit(1);
  }

  function eq2(a, b, msg) { ok(a === b, msg + '（' + a + ' vs ' + b + ')'); }

  const failed = checks.filter((c) => !c.cond);
  log('GUI 检查汇总：' + (checks.length - failed.length) + '/' + checks.length + ' 通过');
  process.exit(failed.length ? 1 : 0);
}

main();
