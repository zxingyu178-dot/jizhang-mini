// tests/e2e/module-manage.js — 统计模块管理 GUI 验证（v1.3.0 Gate 3）
// 验证：统计 Tab → 管理 Bottom Sheet 弹出 → 开关立即生效（modMap / 列表）→
// 恢复默认 → 关闭。截图在 disconnect 后归档（带 _simulator 后缀）。
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
    // 切到统计 Tab（自定义 tab，用真实元素 tap）
    const tabs = await page.$$('.tabs__item');
    await tabs[0].tap();
    await sleep(900); // 等 panel activate（内部 220ms）+ 取数

    const panel = await page.$('#statisticsPanel');
    if (!panel) throw new Error('找不到 statisticsPanel');
    let pd = await panel.data();
    ok(pd.mode === 'month', '统计面板处于月度模式');
    ok(Array.isArray(pd.shareList) && pd.shareList.length > 0, '默认分类占比列表有数据');

    // 打开管理
    const manageBtn = await panel.$('.manage-btn');
    ok(!!manageBtn, '存在管理按钮');
    await manageBtn.tap();
    await sleep(700);
    pd = await panel.data();
    ok(pd.showManage === true, '点击管理后 Bottom Sheet 打开');
    ok(pd.moduleRows.length === 6, '月度管理列出 6 个模块（actual=' + pd.moduleRows.length + ')');

    // 截图：Bottom Sheet 打开态（存内存）
    const shotOpen = await mp.screenshot();

    // 关闭分类占比（组件方法，构造 switch change 事件）
    const beforeShare = !!pd.modMap['category-share'];
    await panel.callMethod('onToggleModule', {
      currentTarget: { dataset: { id: 'category-share' } },
      detail: { value: !beforeShare },
    });
    await sleep(800);
    pd = await panel.data();
    ok(pd.modMap['category-share'] !== true, '关闭后 modMap 移除 category-share');
    ok(pd.shareList.length === 0, '关闭后分类占比列表清空');
    ok(pd.showManage === true, '操作后 Bottom Sheet 仍打开');
    // 其它模块仍在
    ok(pd.modMap['daily-expense-trend'] === true, '每日花费趋势仍启用');

    // 截图：关闭分类占比后
    const shotOff = await mp.screenshot();

    // 恢复默认
    await panel.callMethod('onResetModules', {});
    await sleep(800);
    pd = await panel.data();
    ok(pd.modMap['category-share'] === true, '恢复默认后分类占比重新启用');
    ok(pd.modMap['custom-range'] !== true, '恢复默认后 custom-range 仍关闭');

    // 关闭弹层
    await panel.callMethod('onCloseManage', {});
    await sleep(600);
    pd = await panel.data();
    ok(pd.showManage === false, 'Bottom Sheet 已关闭');

    // 归档截图（disconnect 后写项目内，避免触发重编译）
    const shots = [
      { name: 'module-manage-open_simulator.png', data: shotOpen },
      { name: 'module-manage-off_simulator.png', data: shotOff },
    ];
    await mp.disconnect();
    await sleep(300);
    fs.mkdirSync(config.SHOT_DIR, { recursive: true });
    shots.forEach((s) => {
      const buf = Buffer.from(s.data, 'base64');
      fs.writeFileSync(path.join(config.SHOT_DIR, s.name), buf);
      log('已归档截图：' + s.name + ' (' + buf.length + ' bytes)');
    });
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
