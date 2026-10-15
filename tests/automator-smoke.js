/**
 * tests/automator-smoke.js — 微信开发者工具模拟器烟雾测试（需先开启 IDE 自动化端口）
 *
 * 不纳入 `npm test`（那是纯 Node 单测）；本脚本需要运行中的微信开发者工具：
 *   cli.bat auto --project <项目根> --auto-port 9420
 * 然后：
 *   node tests/automator-smoke.js
 *
 * 校验：
 *   1. 首页正常加载（主包，不预下载 importer）
 *   2. 进入设置页触发 importer 分包预下载
 *   3. 进入分包「数据导入」页可正常打开
 * 并在 docs/screenshots 输出 v021_*.png 三张截图。
 */
const automator = require('miniprogram-automator');
const path = require('path');

const WS = process.env.WS_ENDPOINT || 'ws://127.0.0.1:9420';
const CLI = 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat';
const PROJECT = path.join(__dirname, '..');
const SHOT = path.join(__dirname, '..', 'docs', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint: WS });
    console.log('已连接到现有自动化实例');
  } catch (e) {
    console.log('未发现自动化实例，启动并编译 IDE（首次较慢）…');
    mp = await automator.launch({ cliPath: CLI, projectPath: PROJECT });
    console.log('IDE 已启动并连接');
  }
  const logs = [];
  const pageErrors = [];
  mp.on('console', (msg) => {
    const args = Array.isArray(msg.args) ? msg.args.join(' ') : String(msg.args);
    logs.push((msg.type || 'log') + '| ' + args);
  });
  try {
    mp.on('pageError', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  } catch (e) {}

  async function step(name, fn) {
    try {
      await fn();
      console.log('STEP OK   : ' + name);
    } catch (e) {
      console.log('STEP FAIL : ' + name + ' -> ' + (e && e.message ? e.message : JSON.stringify(e)));
      throw e;
    }
  }

  // 1) 首页（主包）
  await step('reLaunch 首页', () => mp.reLaunch({ url: '/pages/main/main' }));
  await sleep(3500);
  const homeLogs = logs.slice();
  await step('截图首页', () => mp.screenshot({ path: path.join(SHOT, 'v021_1_home.png') }));

  // 2) 设置页（preloadRule 在此触发 importer 预下载）
  await step('进入设置页', () => mp.navigateTo({ url: '/pages/settings/settings' }));
  await sleep(3000);
  const settingsLogs = logs.slice(homeLogs.length);
  await step('截图设置页', () => mp.screenshot({ path: path.join(SHOT, 'v021_2_settings.png') }));

  // 3) 分包「数据导入」页（真正加载 importer）
  await step('进入分包导入页', () => mp.navigateTo({ url: '/packages/importer/pages/import/import' }));
  await sleep(3000);
  const importPage = await mp.currentPage();
  await step('截图导入页', () => mp.screenshot({ path: path.join(SHOT, 'v021_3_import.png') }));

  const preloadOnHome = homeLogs.some((l) => l.indexOf('preload') >= 0 && l.indexOf('importer') >= 0);
  const preloadOnSettings = settingsLogs.some((l) => l.indexOf('preload') >= 0 && l.indexOf('importer') >= 0);

  console.log('\n当前页面 route = ' + (importPage && importPage.route));
  console.log('首页阶段是否预下载 importer = ' + preloadOnHome + '（期望 false）');
  console.log('设置阶段是否预下载 importer = ' + preloadOnSettings + '（期望 true）');

  console.log('\n--- 首页 preload 相关日志 ---');
  homeLogs.filter((l) => l.indexOf('preload') >= 0).forEach((l) => console.log(l));
  console.log('--- 设置 preload 相关日志 ---');
  settingsLogs.filter((l) => l.indexOf('preload') >= 0).forEach((l) => console.log(l));

  const errors = logs.filter((l) => /^error\|/.test(l) && l.indexOf('preloadSubpackages') < 0);
  if (errors.length) {
    console.log('\n--- error 级日志（' + errors.length + '）---');
    errors.forEach((l) => console.log(l));
  }
  if (pageErrors.length) {
    console.log('\n--- pageError（' + pageErrors.length + '）---');
    pageErrors.forEach((l) => console.log(l));
  }

  await mp.disconnect();

  const pageOk = importPage && /importer\/pages\/import\/import/.test(importPage.route || '');
  if (!pageOk) {
    console.error('\nSMOKE FAIL：分包导入页未打开');
    process.exit(1);
  }
  if (pageErrors.length) {
    console.error('\nSMOKE FAIL：存在页面运行时错误');
    process.exit(1);
  }
  console.log('\nSMOKE DONE');
  process.exit(0);
})().catch((e) => {
  console.error('SMOKE FAIL: ' + (e && e.message ? e.message : JSON.stringify(e)));
  process.exit(1);
});
