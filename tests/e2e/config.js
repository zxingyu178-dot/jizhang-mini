// tests/e2e/config.js
// miniprogram-automator GUI 端到端测试的统一配置。
// 设计目标：零硬编码、跨平台、可用环境变量覆盖，一条命令可重复跑。
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// 自动化 WebSocket 端口（cli auto --auto-port）。可用 AUTO_PORT 覆盖。
const AUTO_PORT = Number(process.env.AUTO_PORT || 9420);
const WS_ENDPOINT = `ws://127.0.0.1:${AUTO_PORT}`;

// 首页（无 tabBar，pages[0] 即 main）。
const HOME_ROUTE = '/pages/main/main';

// 等待 IDE 自动化端口就绪的最长时间（首次启动 IDE 较慢）。
const LAUNCH_TIMEOUT_MS = Number(process.env.E2E_LAUNCH_TIMEOUT || 180000);

// 端口连通后，等待小程序「首页编译完成、页面栈非空」的最长时间。
// 关键：9420 端口监听 ≠ 小程序就绪。首次冷启动时 IDE 先开端口，再编译项目；
// 若在首页就绪前发 reLaunch/navigateTo，会打断首屏加载，导致页面栈永久为空、模拟器黑屏。
const READY_TIMEOUT_MS = Number(process.env.E2E_READY_TIMEOUT || 120000);

// 截图最终归档目录（项目内，用于提交 git / HANDOFF 引用）。统一带 _simulator 后缀，
// 与真机截图区分。
const SHOT_DIR = process.env.E2E_SHOT_DIR || path.join(PROJECT_ROOT, 'docs', 'screenshots', 'e2e');

// 测试进行中的截图「暂存目录」，必须在项目根目录之外：
// 微信开发者工具会监听项目目录，截图一旦写进项目（docs/...）会触发「文件变更→自动重新编译」，
// 模拟器随即 reload，automator 的 WebSocket 会失步、之后所有命令报
// "timeout waiting for automator response"。因此测试中先写到系统临时目录，
// 全部用例跑完、disconnect 之后再由 run.js 复制回 SHOT_DIR（此时编译不再影响测试）。
const SHOT_STAGE_DIR = process.env.E2E_SHOT_STAGE_DIR
  || path.join(os.tmpdir(), 'dailyvalue-mini-e2e-shots');

// 解析微信开发者工具 CLI 路径（优先环境变量，其次各平台默认安装位置）。
function resolveCliPath() {
  if (process.env.WECHAT_CLI && fs.existsSync(process.env.WECHAT_CLI)) {
    return process.env.WECHAT_CLI;
  }
  const candidates = os.platform() === 'win32'
    ? [
        'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
        'C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat',
      ]
    : [
        '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
      ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0]; // 找不到也返回，由 launcher 报清晰错误
}

const CLI_PATH = resolveCliPath();

// 从项目 node_modules 解析 automator，避免依赖运行时 cwd。
const AUTOMATOR = require.resolve('miniprogram-automator', { paths: [PROJECT_ROOT] });

module.exports = {
  PROJECT_ROOT,
  AUTO_PORT,
  WS_ENDPOINT,
  HOME_ROUTE,
  LAUNCH_TIMEOUT_MS,
  READY_TIMEOUT_MS,
  SHOT_DIR,
  SHOT_STAGE_DIR,
  CLI_PATH,
  AUTOMATOR,
};
