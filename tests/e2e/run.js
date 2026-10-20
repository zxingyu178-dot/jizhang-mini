// tests/e2e/run.js
// 一键 GUI 端到端回归入口。
//
// 用法：
//   node tests/e2e/run.js            # 自动启动/复用 IDE，跑完黄金路径
//   npm run e2e
//
// 可选环境变量：
//   WECHAT_CLI   微信开发者工具 cli 路径
//   AUTO_PORT    自动化 WebSocket 端口（默认 9420）
//   E2E_SHOT_DIR 截图输出目录
//   E2E_LAUNCH_TIMEOUT 首次启动等待上限（ms）
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { ensureAutomation, sleep } = require('./launcher');
const { Ctx } = require('./helpers');
const goldenPath = require('./golden-path');

/**
 * 用例结束、断开 automator 后，把测试中存于内存的截图 base64 写入项目内归档目录。
 * 必须在 disconnect 之后做：
 *   1. 写文件进项目会触发 IDE 自动重编译，测试期间不能发生；
 *   2. 后台 node 处于文件沙箱，无法写项目外/系统 Temp，只能在结束后写项目目录。
 */
function publishShots(ctx) {
  const dest = config.SHOT_DIR;
  const shots = (ctx && ctx.shots) || [];
  fs.mkdirSync(dest, { recursive: true });
  // 清掉上一轮的 png，保证归档只反映本次运行
  fs.readdirSync(dest)
    .filter((f) => f.endsWith('.png'))
    .forEach((f) => fs.rmSync(path.join(dest, f), { force: true }));
  shots.forEach((s) => {
    console.log(`  落盘 ${s.name}.png （截图时页面：${s.path || '未知'}）`);
    fs.writeFileSync(path.join(dest, s.name + '.png'), Buffer.from(s.data, 'base64'));
  });
  return fs.readdirSync(dest).filter((f) => f.endsWith('.png'));
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function main() {
  console.log('================ DailyValue Mini · E2E 回归 ================');
  console.log('时间      :', timestamp());
  console.log('项目      :', config.PROJECT_ROOT);
  console.log('自动化端口:', config.WS_ENDPOINT);
  console.log('CLI       :', config.CLI_PATH);
  console.log('截图目录  :', config.SHOT_DIR);
  console.log('----------------------------------------------------------');

  const mp = await ensureAutomation(config, console.log);
  const ctx = new Ctx(mp, config);

  // 收集小程序运行时日志/异常（用于排查，不直接判失败）
  mp.on('console', (e) => {
    ctx.consoleLogs.push(e);
  });
  mp.on('exception', (e) => {
    ctx.exceptions.push(e);
  });

  // ensureAutomation 已等待首页（pages/main/main）编译就绪，再给一点稳定时间即可。
  // 切勿在首屏就绪前后调用 reLaunch——会打断冷启动首屏加载、导致页面栈为空与模拟器黑屏。
  // 用例间清栈统一交给 helpers.backToHome()（navigateBack）。
  await sleep(1500);

  let fatal = null;
  try {
    await goldenPath(ctx);
  } catch (e) {
    fatal = e;
  }

  const s = ctx.summary();
  console.log('----------------------------------------------------------');
  console.log(`结果：${s.pass}/${s.total} 通过，${s.fail} 失败`);
  if (s.fail) {
    console.log('失败用例：');
    s.results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.name}\n      ${r.error}`));
  }

  if (ctx.exceptions.length) {
    console.log(`小程序运行时异常（${ctx.exceptions.length} 条，仅提示）：`);
    ctx.exceptions.slice(0, 5).forEach((e) => {
      console.log('  !', (e && e.message) ? e.message : JSON.stringify(e));
    });
  }

  // 断开 ws 连接（IDE 保留运行，下次可复用）。必须先断开，再把截图复制进项目目录。
  try { await mp.disconnect(); } catch (_) {}

  // 截图测试中以 base64 存内存，断开后再写入项目归档（避免触发 IDE 重编译、规避沙箱写限制）。
  const shots = publishShots(ctx);
  console.log(`截图（${shots.length}）：${config.SHOT_DIR}`);

  if (fatal) {
    console.error('运行中断:', fatal && fatal.stack ? fatal.stack : fatal);
    process.exit(1);
  }
  process.exit(s.fail ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E 启动失败:', e && e.message ? e.message : e);
  process.exit(1);
});
