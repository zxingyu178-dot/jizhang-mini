// utils/device.js 单元测试（Node assert，无需测试框架）
// 用法：node tests/device.test.js
const assert = require('assert');
const device = require('../utils/device');

function mockDevice(windowInfo, menuInfo) {
  global.wx = {
    getWindowInfo: () => windowInfo,
    getMenuButtonBoundingClientRect: () => menuInfo,
  };
  device.reset();
}

function test(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
  } catch (e) {
    console.log('FAIL: ' + name + ' -> ' + e.message);
    process.exitCode = 1;
  }
}

test('iPhone SE 375x667（Home 键，无底部安全区）', () => {
  mockDevice(
    { platform: 'ios', windowWidth: 375, windowHeight: 667, pixelRatio: 2, statusBarHeight: 20,
      safeArea: { top: 20, bottom: 667, left: 0, right: 375 } },
    { top: 24, bottom: 56, left: 287, right: 361, width: 74, height: 32 }
  );
  const m = device.measure();
  assert.strictEqual(m.safeBottom, 0);
  assert.strictEqual(m.windowWidth, 375);
});

test('iPhone 12 390x844（刘海 + Home Indicator）', () => {
  mockDevice(
    { platform: 'ios', windowWidth: 390, windowHeight: 844, pixelRatio: 3, statusBarHeight: 47,
      safeArea: { top: 47, bottom: 808, left: 0, right: 390 } },
    { top: 52, bottom: 86, left: 297, right: 381, width: 84, height: 34 }
  );
  const m = device.measure();
  assert.strictEqual(m.safeBottom, 36); // 844 - 808
  assert.strictEqual(m.gap, 5);
  assert.strictEqual(m.navBarHeight, 44); // 34 + 5*2
  assert.strictEqual(m.headerHeight, 91); // 47 + 44
});

test('iPhone 14 Pro Max 430x932（灵动岛）', () => {
  mockDevice(
    { platform: 'ios', windowWidth: 430, windowHeight: 932, pixelRatio: 3, statusBarHeight: 54,
      safeArea: { top: 59, bottom: 878, left: 0, right: 430 } },
    { top: 59, bottom: 93, left: 332, right: 416, width: 84, height: 34 }
  );
  const m = device.measure();
  assert.strictEqual(m.safeBottom, 54); // 932 - 878
  assert.strictEqual(m.safeInsets.top, 59);
});

test('Android 360x800（无底部安全区）', () => {
  mockDevice(
    { platform: 'android', windowWidth: 360, windowHeight: 800, pixelRatio: 3, statusBarHeight: 24,
      safeArea: { top: 24, bottom: 800, left: 0, right: 360 } },
    { top: 28, bottom: 64, left: 270, right: 354, width: 84, height: 36 }
  );
  const m = device.measure();
  assert.strictEqual(m.safeBottom, 0);
  assert.strictEqual(m.isAndroid, true);
});

test('无 safeArea 设备（fallback 到状态栏）', () => {
  mockDevice(
    { platform: 'ios', windowWidth: 320, windowHeight: 568, pixelRatio: 2, statusBarHeight: 20 },
    { top: 24, bottom: 56, left: 232, right: 306, width: 74, height: 32 }
  );
  const m = device.measure();
  assert.strictEqual(m.safeBottom, 0);
  assert.strictEqual(m.safeInsets.top, 20);
});

test('测量结果只计算一次并缓存', () => {
  const first = device.measure();
  global.wx.getWindowInfo = () => { throw new Error('不应再次调用 getWindowInfo'); };
  const second = device.measure();
  assert.strictEqual(first, second);
});

console.log('--- device.test.js 完成 ---');
