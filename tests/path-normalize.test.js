/**
 * tests/path-normalize.test.js — SVG 离散化工具测试（v1.3.0）
 *
 * 验证曲线（C/S/Q/T/A）与基础元素（circle/rect/line/polyline）统一转换为
 * 只含 M/L/Z 的 <path>，并对全部 49 个内置图标做无异常 / 无 NaN / 无越界回归。
 * 纯函数，无需真机。运行：node tests/path-normalize.test.js
 */
let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error('  FAIL: ' + msg); }
}
function near(a, b, eps, msg) {
  assert(Math.abs(a - b) <= eps, msg + ' (expected~' + b + ', actual=' + a + ')');
}

const { flatten, normalizeBody } = require('../utils/path-normalize');
const categoryIcons = require('../data/category-icons');

// 提取 d 中最后一个坐标点（L 与数字连写，故用正则）
function lastPoint(d) {
  const all = [...d.matchAll(/-?\d+\.?\d*/g)].map(Number);
  return [all[all.length - 2], all[all.length - 1]];
}

/* ================= A. flatten 基本命令 ================= */
console.log('A. flatten 命令转换');
{
  // 相对 H/V 转绝对 L
  const f1 = flatten('M3 2 v7 h4');
  assert(/^M3 2 L3 9 L7 9$/.test(f1), 'A1 相对 v/h 转绝对 L：' + f1);
  // 输出不再含曲线命令
  const f2 = flatten('M3 2 C3 4 5 6 7 8');
  assert(!/[CSQTAHVSQTA]/.test(f2.toUpperCase().replace(/[ML]/g, '')), 'A2 贝塞尔转 L，无曲线命令');
  const nums2 = [...f2.matchAll(/-?\d+\.?\d*/g)].map(Number);
  assert(nums2.every((v) => !Number.isNaN(v)), 'A3 无 NaN');
  // 贝塞尔终点保留 (7,8)
  const p2 = lastPoint(f2);
  near(p2[0], 7, 0.001, 'A4 贝塞尔终点 x');
  near(p2[1], 8, 0.001, 'A5 贝塞尔终点 y');
  // 圆弧离散化：半圆，终点正确
  const f3 = flatten('M4 9 A5 5 0 0 0 4 19');
  assert(!/A/.test(f3), 'A6 圆弧转 L');
  const p3 = lastPoint(f3);
  near(p3[0], 4, 0.01, 'A7 圆弧终点 x');
  near(p3[1], 19, 0.01, 'A8 圆弧终点 y');
  // Z 保留
  const f4 = flatten('M3 2 L7 2 L7 9 Z');
  assert(/Z$/.test(f4.trim()), 'A9 Z 保留');
}

/* ================= B. normalizeBody 元素转换 ================= */
console.log('B. normalizeBody 元素统一为 path');
{
  const body =
    '<circle cx="8" cy="8" r="4"/>' +
    '<rect x="2" y="2" width="6" height="6"/>' +
    '<line x1="1" y1="1" x2="5" y2="5"/>' +
    '<polyline points="1 1 4 2 5 6"/>';
  const nb = normalizeBody(body);
  assert(!/circle|rect|line|polyline/.test(nb), 'B1 基础元素全部转为 path');
  assert((nb.match(/<path/g) || []).length === 4, 'B2 输出 4 个 path');
  // 圆角矩形也能转换且无 NaN
  const nb2 = normalizeBody('<rect x="3" y="3" width="18" height="18" rx="2"/>');
  const nums = [...nb2.matchAll(/-?\d+\.?\d*/g)].map(Number);
  assert(nums.every((v) => !Number.isNaN(v)), 'B3 圆角矩形无 NaN');
}

/* ================= C. 全部 49 图标回归 ================= */
console.log('C. 49 个内置图标离散化回归');
{
  const ids = Object.keys(categoryIcons.ICONS);
  assert(ids.length === 49, 'C1 内置图标数为 49，实际=' + ids.length);
  for (const id of ids) {
    const ic = categoryIcons.builtinIconById(id);
    let nb;
    try { nb = normalizeBody(ic.body); } catch (e) { assert(false, 'C2 ' + id + ' 抛异常 ' + e.message); continue; }
    // 只含 path 元素
    assert(!/<(?!path\b)/.test(nb), 'C2 ' + id + ' 只含 path 元素');
    // 每个 d 只含 M/L/Z
    for (const m of nb.matchAll(/<path d="([^"]*)"/g)) {
      const cmds = [...new Set(m[1].match(/[A-Za-z]/g) || [])];
      assert(cmds.every((c) => c === 'M' || c === 'L' || c === 'Z'),
        'C3 ' + id + ' d 只含 M/L/Z，实际=' + cmds.join(','));
      const vals = [...m[1].matchAll(/-?\d+\.?\d*/g)].map(Number);
      assert(vals.every((v) => !Number.isNaN(v)), 'C4 ' + id + ' 无 NaN');
      assert(vals.every((v) => v >= -0.5 && v <= 24.5), 'C5 ' + id + ' 坐标在 viewBox 内');
    }
  }
}

/* ================= 汇总 ================= */
console.log('\nSVG 离散化测试：pass=' + pass + ' fail=' + fail);
if (fail > 0) process.exit(1);
console.log('全部通过');
process.exit(0);
