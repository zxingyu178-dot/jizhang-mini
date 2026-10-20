// tests/e2e/launcher.js
// 幂等启动/连接微信开发者工具自动化实例。
// 关键点（实测踩坑）：
//   1. 新版 IDE（Stable 2.02.2608080）的 `cli auto --help` 只列 --port/--token，
//      但 `--auto-port` 仍向后兼容；automator 0.12.1 内部也写死走 --auto-port。
//   2. 必须加 --trust-project，否则可能卡在「信任项目」，端口不监听。
//   3. 启动后 9420 是 WebSocket（约 15~25s 就绪）；HTTP 端口号在日志里动态变化，忽略即可。
//   4. 已有自动化实例在跑时直接复用，不重复拉起 IDE。
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const config = require('./config');
const automator = require(config.AUTOMATOR);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 尝试连接一次，带 5s 硬超时；失败返回 null（不抛错）。 */
async function connectOnce(wsEndpoint) {
  return Promise.race([
    automator.connect({ wsEndpoint }).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);
}

/**
 * 等待小程序首页编译完成（页面栈非空、当前页可读取）。
 * 9420 端口监听后 IDE 仍在编译，此时页面栈为空；在首页就绪前发路由命令会
 * 打断首屏加载、造成永久黑屏，因此必须先轮询到页面就绪。
 */
async function waitForReady(mp, timeoutMs, log = () => {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '页面栈为空';
  while (Date.now() < deadline) {
    try {
      const stack = await mp.pageStack();
      const cur = await mp.currentPage().catch(() => null);
      if (Array.isArray(stack) && stack.length > 0 && cur && cur.path) {
        log('小程序首页已就绪：' + cur.path);
        return { path: cur.path, depth: stack.length };
      }
      last = `页面栈长度=${stack.length}`;
    } catch (e) {
      last = '探测失败：' + (e && e.message ? e.message : e);
    }
    await sleep(1500);
  }
  throw new Error(`等待首页就绪超时（${timeoutMs}ms）：${last}。`);
}

/**
 * 拉起 `cli auto`。
 *
 * Windows 踩坑（本机实测，两种 node 直 spawn 均失败）：
 *   1) 托管 node（v24）直接 spawn cli.bat（shell:true）：IDE 子进程写
 *      User Data\<hash>\Default\.cli 时反复 EPERM，automation 端口起不来。
 *   2) 沙箱 node（v22）能拉起，但隐藏/无独立窗口时模拟器「不渲染首页」，
 *      pageStack 长期为 0，waitForReady 超时。
 * 唯一稳定方式：通过 PowerShell `Start-Process -WindowStyle Minimized` 让
 * cli.bat 在独立、最小化窗口启动（等价人工运行 cli auto），IDE 才会完整
 * 编译并渲染首页；之后 harness 轮询连接即可。
 *
 * 非 Windows 仍用 node spawn（.bat 需 shell:true，含空格路径需加引号）。
 */
function spawnCli(config, log) {
  const args = [
    'auto',
    '--project', config.PROJECT_ROOT,
    '--auto-port', String(config.AUTO_PORT),
    '--trust-project',
  ];
  log('启动 IDE 自动化:', config.CLI_PATH, args.join(' '));

  if (process.platform === 'win32') {
    const ps = `Start-Process -FilePath '${config.CLI_PATH}' -ArgumentList @(${args.map((a) => `'${a}'`).join(',')}) -WindowStyle Minimized`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = (tag) => (chunk) => {
      const s = chunk.toString().trim();
      if (s) log(`cli[${tag}] ${s}`);
    };
    child.stdout.on('data', onData('out'));
    child.stderr.on('data', onData('err'));
    child.on('error', (e) => log('cli 启动错误: ' + e.message));
    return child;
  }

  const q = (s) => (/\s/.test(String(s)) ? `"${s}"` : String(s));
  const child = spawn(q(config.CLI_PATH), args.map(q), {
    shell: true,
    windowsHide: true,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const onData = (tag) => (chunk) => {
    const s = chunk.toString().trim();
    if (s) log(`cli[${tag}] ${s}`);
  };
  child.stdout.on('data', onData('out'));
  child.stderr.on('data', onData('err'));
  child.on('error', (e) => log('cli 启动错误: ' + e.message));
  return child;
}

/**
 * 确保自动化可用并返回 miniProgram 实例。
 * 先尝试复用已在监听的端口；连不上才拉起 CLI，随后轮询直到超时。
 */
async function ensureAutomation(config, log = () => {}) {
  let mp = await connectOnce(config.WS_ENDPOINT);
  if (mp) {
    log('已连接运行中的自动化实例，等待首页就绪…');
    await waitForReady(mp, config.READY_TIMEOUT_MS, log);
    return mp;
  }

  if (!fs.existsSync(config.CLI_PATH)) {
    throw new Error(
      '找不到微信开发者工具 CLI：' + config.CLI_PATH +
      '\n请安装开发者工具，或用环境变量 WECHAT_CLI 指定 cli 路径。'
    );
  }

  spawnCli(config, log);

  const deadline = Date.now() + config.LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(2000);
    mp = await connectOnce(config.WS_ENDPOINT);
    if (mp) {
      // 端口已连通，但首页可能还在编译；在同一连接上继续等待页面就绪。
      const remain = Math.max(8000, deadline - Date.now());
      await waitForReady(mp, Math.min(remain, config.READY_TIMEOUT_MS), log);
      return mp;
    }
  }
  throw new Error(
    `等待自动化端口 ${config.AUTO_PORT} 超时（${config.LAUNCH_TIMEOUT_MS}ms）。\n` +
    '排查：1) 开发者工具「设置→安全设置」开启服务端口；2) 确认能正常打开项目；3) 手动运行 cli auto 查看报错。'
  );
}

module.exports = { ensureAutomation, connectOnce, waitForReady, sleep };
