/**
 * tests/donut-gesture.test.js — v1.3.3 Gate 1 圆环手势多指隔离
 *
 * 用 mock global.Component 捕获 category-donut 组件定义，构造可运行实例，
 * 直接驱动手势状态机，验证：
 *   A. findGestureTouch / pickEndTouch 严格 identifier 匹配，找不到返回 null，
 *      绝不拿另一根手指的坐标顶替；
 *   B. onTouchStart 已有手势时忽略新加入的手指，整个手势只绑定第一根手指；
 *   C. onTouchMove 只认绑定手指，别的手指移动不污染当前手势；
 *   D. onTouchEnd 其他手指先抬起时保持手势，不清理状态；
 *   E. 单指点击命中分段仍能选中（回归），点击中心孔不选中。
 *
 * 运行：node tests/donut-gesture.test.js
 */
const path = require('path');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) {
  assert(a === b, msg + '（期望 ' + b + '，实际 ' + a + '）');
}

/* ---------- mock wx（env + 选择器查询，rect 回调） ---------- */
global.wx = {
  env: { USER_DATA_PATH: '/usr' },
  createSelectorQuery() {
    return {
      in() { return this; },
      select() { return this; },
      boundingClientRect(cb) { this._cb = cb; return this; },
      exec() {
        if (this._cb) {
          const cb = this._cb;
          setImmediate(() => cb({ width: 160, height: 160, left: 0, top: 0 }));
        }
      },
    };
  },
};

/* ---------- mock 全局 Component，捕获组件定义 ---------- */
let captured = null;
global.Component = function (def) { captured = def; };

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'components', 'category-donut', 'category-donut'));

/** 构造触摸点 */
function t(id, x, y) { return { identifier: id, clientX: x, clientY: y, pageX: x, pageY: y }; }

/** 构造可运行实例（不跑 attached，手动初始化手势字段） */
function makeInstance(segments) {
  const inst = {
    data: JSON.parse(JSON.stringify(captured.data)),
    triggerEvent() {},
  };
  inst.data.segments = segments || [];
  inst.setData = function (patch) {
    Object.keys(patch).forEach((k) => { inst.data[k] = patch[k]; });
  };
  Object.keys(captured.methods).forEach((k) => {
    inst[k] = captured.methods[k].bind(inst);
  });
  inst._gSeq = 0;
  inst._clearGestureState();
  return inst;
}
const RECT = { width: 160, height: 160, left: 0, top: 0 };

/* ==================== A. 严格 identifier 匹配 ==================== */
console.log('触摸点查找严格匹配');
{
  const inst = makeInstance();
  inst._gId = 5;
  const list = [t(7, 100, 100), t(5, 50, 50)];
  eq(inst.findGestureTouch(list).identifier, 5, 'findGestureTouch 命中绑定 id=5');
  eq(inst.findGestureTouch([t(9, 1, 1)]), null, 'id 不在列表返回 null（不退回 list[0]）');
  eq(inst.findGestureTouch([]), null, '空列表返回 null');
  inst._gId = null;
  eq(inst.findGestureTouch(list), null, 'gId 缺失返回 null');

  eq(inst.pickEndTouch(list, 5).identifier, 5, 'pickEndTouch 命中 id=5');
  eq(inst.pickEndTouch([t(9, 1, 1)], 5), null, 'pickEndTouch 找不到返回 null');
  eq(inst.pickEndTouch(list, undefined), null, 'pickEndTouch gId 缺失返回 null');
}

/* ==================== B. onTouchStart 多指隔离 ==================== */
console.log('触摸开始只绑定第一根手指');
{
  const inst = makeInstance();
  inst.onTouchStart({ touches: [t(1, 40, 40)], changedTouches: [t(1, 40, 40)] });
  eq(inst._gActive, true, '第一根手指开始手势');
  eq(inst._gId, 1, '绑定 identifier=1');
  // 第二根手指加入：应被忽略，手势仍绑定 id=1、起始坐标不被重置
  inst.onTouchStart({ touches: [t(1, 40, 40), t(2, 80, 80)], changedTouches: [t(2, 80, 80)] });
  eq(inst._gId, 1, '第二根手指被忽略，仍绑定 id=1');
  eq(inst._gStartX, 40, '起始坐标未被第二根手指重置');
  eq(inst._gStartY, 40, '起始 Y 未被重置');
}

/* ==================== C. onTouchMove 只认绑定手指 ==================== */
console.log('移动只追踪绑定手指');
{
  const inst = makeInstance();
  inst.onTouchStart({ touches: [t(1, 40, 40)], changedTouches: [t(1, 40, 40)] });
  // 第二根手指移动（changedTouches 只有 id=2），绑定手指 id=1 在 touches 里未动
  inst.onTouchMove({ touches: [t(1, 40, 40), t(2, 90, 90)], changedTouches: [t(2, 90, 90)] });
  eq(inst._gMoved, false, '别的手指移动不标记当前手势滑动');
  eq(inst._gMaxDist, 0, '绑定手指 id=1 位移为 0');
  // 绑定手指移动 20px（超过 10px 阈值）
  inst.onTouchMove({ touches: [t(1, 60, 40)], changedTouches: [t(1, 60, 40)] });
  assert(inst._gMaxDist > 10, '绑定手指移动被记录（dist=' + inst._gMaxDist + '）');
  eq(inst._gMoved, true, '超阈值标记为滑动');
}

/* ==================== D + E：异步手势（统一在 async IIFE 内） ==================== */
(async () => {
  console.log('其他手指抬起不影响当前手势');
  const instD = makeInstance();
  instD.onTouchStart({ touches: [t(1, 40, 40)], changedTouches: [t(1, 40, 40)] });
  instD.onTouchStart({ touches: [t(1, 40, 40), t(2, 80, 80)], changedTouches: [t(2, 80, 80)] });
  // id=2 先抬起，id=1 仍在屏幕上
  await instD.onTouchEnd({ changedTouches: [t(2, 80, 80)] });
  eq(instD._gActive, true, '其他手指抬起，当前手势保持');
  eq(instD._gId, 1, '手势仍绑定 id=1');

  console.log('单指点击命中分段、中心孔不选中');
  const segs = [
    { categoryId: 'c-food', name: '餐饮', ratio: 1, cents: 1000, percentText: '100.0', aggregate: false },
  ];
  // 12 点方向环上：viewBox(50,10) → 本地(80,16)，命中唯一分段
  const inst = makeInstance(segs);
  inst.onTouchStart({ touches: [t(1, 80, 16)], changedTouches: [t(1, 80, 16)] });
  inst._gRect = RECT; // onTouchStart 异步填 rect，这里手动给定
  await inst.onTouchEnd({ changedTouches: [t(1, 80, 16)] });
  eq(inst.data.selectedIndex, 0, '单指点击命中分段 → 选中');
  eq(inst.data.hasSelection, true, 'hasSelection=true');
  eq(inst._gActive, false, '点击后手势已清理');

  // 中心孔：viewBox(50,50) → 本地(80,80)，dist=0 <34，不选中
  const inst2 = makeInstance(segs);
  inst2.onTouchStart({ touches: [t(1, 80, 80)], changedTouches: [t(1, 80, 80)] });
  inst2._gRect = RECT;
  await inst2.onTouchEnd({ changedTouches: [t(1, 80, 80)] });
  eq(inst2.data.selectedIndex, -1, '点击中心孔不选中');

  /* ---------- 汇总 ---------- */
  console.log('\ndonut-gesture tests: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
})();
