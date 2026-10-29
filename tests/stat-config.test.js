/**
 * tests/stat-config.test.js — 统计模块配置合同测试（v1.3.0 Gate 3）
 *
 * 覆盖 data/statistics/config.js：默认、缺失、未知 ID 丢弃、重复去重、
 * 合法空数组全关不重置、坏 modules / 损坏配置不抛错、isEnabled、withModules。
 * 运行：node tests/stat-config.test.js
 */
const path = require('path');
const C = require(path.join(__dirname, '..', 'data', 'statistics', 'config'));

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) { assert(a === b, msg + ' (expected=' + b + ', actual=' + a + ')'); }
function arrEq(a, b, msg) {
  assert(Array.isArray(a) && a.join(',') === b.join(','), msg + ' (expected=[' + b + '], actual=[' + a + '])');
}

// 1. 默认配置
eq(C.defaultConfig().version, C.CONFIG_VERSION, '默认配置 version=1');
arrEq(C.defaultConfig().modules, C.DEFAULT_MODULES, '默认模块正确');
assert(C.defaultConfig().modules.indexOf('custom-range') < 0, 'custom-range 默认关闭');

// 2. 缺失 / 非对象 → 默认
arrEq(C.normalizeConfig(null).modules, C.DEFAULT_MODULES, 'null → 默认');
arrEq(C.normalizeConfig(undefined).modules, C.DEFAULT_MODULES, 'undefined → 默认');
arrEq(C.normalizeConfig('bad').modules, C.DEFAULT_MODULES, '字符串 → 默认');
arrEq(C.normalizeConfig(42).modules, C.DEFAULT_MODULES, '数字 → 默认');

// 3. 空 modules 字段缺失 → 默认
arrEq(C.normalizeConfig({ version: 1 }).modules, C.DEFAULT_MODULES, '有 version 无 modules → 默认');

// 4. 合法空数组 → 空模块（不重置）
arrEq(C.normalizeConfig({ version: 1, modules: [] }).modules, [], '合法空数组 → 全关，不重置');
eq(C.normalizeConfig({ modules: [] }).version, 1, '空数组结果 version=1');

// 5. 坏的 modules 字段（显式带）→ 空模块，不抛错
arrEq(C.normalizeConfig({ version: 1, modules: 'x' }).modules, [], '坏 modules 字符串 → 空');
arrEq(C.normalizeConfig({ modules: null }).modules, [], 'modules=null → 空');

// 6. 未知 ID 丢弃
arrEq(
  C.normalizeConfig({ modules: ['category-share', 'nope', 'budget-analysis'] }).modules,
  ['category-share', 'budget-analysis'],
  '未知 ID 丢弃'
);

// 7. 重复 ID 去重
arrEq(
  C.normalizeConfig({ modules: ['category-share', 'category-share', 'budget-analysis', 'budget-analysis'] }).modules,
  ['category-share', 'budget-analysis'],
  '重复 ID 去重'
);

// 8. 全部非法 → 空模块（不擅自回默认）
arrEq(C.normalizeConfig({ modules: ['a', 'b', 1, null] }).modules, [], '全部非法 → 空模块');

// 9. 非字符串元素丢弃
arrEq(
  C.normalizeConfig({ modules: ['category-share', 5, true, { x: 1 }] }).modules,
  ['category-share'],
  '非字符串元素丢弃'
);

// 10. 全部合法模块可被接受（含年度）
arrEq(
  C.normalizeConfig({ modules: C.VALID_MODULES }).modules,
  C.VALID_MODULES,
  '全部 VALID_MODULES 可接受'
);

// 11. isEnabled
assert(C.isEnabled(C.defaultConfig(), 'category-share') === true, 'isEnabled 命中');
assert(C.isEnabled(C.defaultConfig(), 'custom-range') === false, 'isEnabled 未命中');
assert(C.isEnabled(null, 'category-share') === false, 'isEnabled 对 null 安全');
assert(C.isEnabled({ modules: [] }, 'category-share') === false, 'isEnabled 空配置 false');

// 12. withModules 规范化
arrEq(C.withModules(['category-share', 'category-share', 'bad']).modules, ['category-share'], 'withModules 去重+丢弃');
eq(C.withModules([]).version, 1, 'withModules version=1');

// 13. 月度 / 年度模块集合不重叠且并集 = VALID
const overlap = C.MONTHLY_MODULES.filter((m) => C.YEARLY_MODULES.indexOf(m) >= 0);
eq(overlap.length, 0, '月度与年度模块无重叠');
arrEq(C.VALID_MODULES, C.MONTHLY_MODULES.concat(C.YEARLY_MODULES), 'VALID = 月度 + 年度');

console.log('\nstat-config tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
