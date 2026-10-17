// tests/e2e/helpers.js
// GUI 测试上下文：页面导航、元素等待、断言、标准化截图。
// 所有页面无 tabBar（顶部「统计/记账/日价」是 main 内自定义 swiper），
// 因此用例间只用 navigateBack 清栈回主页（栈深 1），再 navigateTo 到目标页，保证栈深一致、可重复。
// 全程不使用 reLaunch：实测冷启动首屏就绪前 reLaunch 会打断首屏加载、页面栈永久为空；
// 同一会话多次 reLaunch 也会让 WebSocket 与新页面失步。
'use strict';

const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Ctx {
  constructor(mp, config) {
    this.mp = mp;
    this.config = config;
    this.results = [];
    this.consoleLogs = [];
    this.exceptions = [];
  }

  sleep(ms) { return sleep(ms); }

  /** 包裹一个用例：捕获异常、记录耗时、失败自动截图。 */
  async test(name, fn) {
    const t0 = Date.now();
    try {
      await fn();
      const ms = Date.now() - t0;
      this.results.push({ name, ok: true, ms });
      console.log(`  \u2713 PASS  ${name} (${ms}ms)`);
    } catch (e) {
      const ms = Date.now() - t0;
      const msg = (e && e.message) || String(e);
      this.results.push({ name, ok: false, ms, error: msg });
      console.log(`  \u00d7 FAIL  ${name} :: ${msg}`);
      try {
        await this.shot(`FAIL_${this.results.length}`);
      } catch (_) { /* 忽略失败截图自身错误 */ }
    }
  }

  /**
   * 用 navigateBack 把页面栈清回只剩主页（栈深 1）。
   * 关键：绝不在用例之间反复 reLaunch——实测 automator 0.12.1 在一次会话里多次
   * reLaunch 会让 WebSocket 与新页面失步，随后所有请求报
   * "timeout waiting for automator response"。套件只在启动时冷 reLaunch 一次。
   */
  async backToHome() {
    let stack = [];
    try {
      stack = await this.mp.pageStack();
    } catch (e) {
      stack = [];
    }
    const depth = Array.isArray(stack) ? stack.length : 1;
    if (depth > 1) {
      await this.mp.callWxMethod('navigateBack', { delta: depth - 1 });
      await sleep(1500);
    }
  }

  /** 确保当前停留在主页（不 reLaunch）。 */
  async home() {
    await this.backToHome();
    await sleep(700);
    return this.mp.currentPage();
  }

  /** 回主页清栈后 navigateTo 到目标页（无 tabBar，子页均用 navigateTo）。 */
  async goto(route, readySelector) {
    await this.backToHome();
    await sleep(500);
    await this.mp.callWxMethod('navigateTo', { url: route });
    await sleep(1000);
    const page = await this.mp.currentPage();
    if (readySelector) await this.waitFor(page, readySelector, 9000);
    return page;
  }

  async back() {
    await this.mp.callWxMethod('navigateBack', { delta: 1 });
    await sleep(1300);
    return this.mp.currentPage();
  }

  /** 轮询等待元素出现（Page.$ 找不到返回 null，故用 $$ 计数）。 */
  async waitFor(page, selector, timeout = 9000) {
    const deadline = Date.now() + timeout;
    let els = [];
    while (Date.now() < deadline) {
      els = await page.$$(selector);
      if (els.length) return els;
      await sleep(300);
    }
    throw new Error(`等待元素超时：${selector}`);
  }

  async tap(page, selector) {
    const el = await page.$(selector);
    if (!el) throw new Error(`元素不存在：${selector}`);
    await el.tap();
    return el;
  }

  async pageData(page) {
    return page.data();
  }

  /**
   * 标准截图：测试中先写入「项目外」暂存目录 SHOT_STAGE_DIR/<name>_simulator.png，
   * 由 run.js 在结束、disconnect 后再复制到项目内 docs/screenshots/e2e 归档。
   * 强制 _simulator 后缀：这些是开发者工具模拟器图，绝不冒充真机图。
   * 切勿直接写进项目目录——会触发 IDE 自动重编译、打断 automator 会话（见 config.js）。
   */
  async shot(name) {
    const dir = this.config.SHOT_STAGE_DIR;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const file = path.join(dir, `${name}_simulator.png`);
    await this.mp.screenshot({ path: file });
    return file;
  }

  /* ---------------- 断言（直接抛错，由 test 捕获） ---------------- */

  ok(cond, msg) {
    if (!cond) throw new Error(msg || '期望为真');
  }

  eq(actual, expected, what) {
    if (actual !== expected) {
      throw new Error(`${what} 期望「${expected}」，实际「${actual}」`);
    }
  }

  truthy(v, what) {
    if (!v) throw new Error(`${what} 期望非空，实际「${v}」`);
  }

  includes(haystack, needle, what) {
    if (String(haystack == null ? '' : haystack).indexOf(needle) < 0) {
      throw new Error(`${what} 期望包含「${needle}」，实际「${haystack}」`);
    }
  }

  summary() {
    const pass = this.results.filter((r) => r.ok).length;
    const fail = this.results.length - pass;
    return { total: this.results.length, pass, fail, results: this.results };
  }
}

module.exports = { Ctx, sleep };
