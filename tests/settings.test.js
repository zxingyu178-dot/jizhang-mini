/**
 * tests/settings.test.js — 设置页减法（v0.4.1）静态测试
 *
 * 设置主页结构直接体现在 .wxml / .js / app.json 中，用只读静态断言验证：
 *   SETTINGS-01 主页不再包含导入说明（说明移到数据导入页）
 *   SETTINGS-02 主页不再直接显示最近导入列表（移到数据导入页）
 *   SETTINGS-03 无 emoji 装饰图标
 *   SETTINGS-04 备份与恢复为统一入口（合并原备份/恢复两个入口）
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.error('  FAIL: ' + msg);
  }
}

const root = path.join(__dirname, '..');
const wxml = fs.readFileSync(path.join(root, 'pages/settings/settings.wxml'), 'utf8');
const js = fs.readFileSync(path.join(root, 'pages/settings/settings.js'), 'utf8');
const appJson = fs.readFileSync(path.join(root, 'app.json'), 'utf8');

console.log('设置页减法');

// SETTINGS-01 主页不再包含导入说明
assert(!wxml.includes('导入说明'), 'SETTINGS-01 主页不含「导入说明」');
assert(!wxml.includes('微信账单导入前需在微信中'), 'SETTINGS-01 主页不含微信导入说明正文');

// SETTINGS-02 主页不再直接显示最近导入列表
assert(!wxml.includes('最近导入'), 'SETTINGS-02 主页不含「最近导入」区块');
assert(!wxml.includes('sec-note'), 'SETTINGS-02 主页不含导入说明卡 class');

// SETTINGS-03 无 emoji 装饰图标（emoji / 符号块）
const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
assert(!emojiRe.test(wxml), 'SETTINGS-03 主页无 emoji 装饰图标');
assert(!wxml.includes('📥') && !wxml.includes('💾') && !wxml.includes('📂'), 'SETTINGS-03 无旧数据 emoji');

// SETTINGS-04 备份与恢复为统一入口
assert(wxml.includes('备份与恢复'), 'SETTINGS-04 主页含「备份与恢复」统一入口');
assert(js.includes("'/pages/backup-restore/backup-restore'"), 'SETTINGS-04 导航到备份与恢复页');
assert(!wxml.includes('备份数据'), 'SETTINGS-04 主页无独立「备份数据」入口');
assert(!wxml.includes('恢复备份'), 'SETTINGS-04 主页无独立「恢复备份」入口');

// 其余保留项与新页面注册
assert(wxml.includes('数据导入'), '主页保留「数据导入」');
assert(wxml.includes('数据与隐私'), '主页含「数据与隐私」');
assert(js.includes('/pages/data-privacy/data-privacy'), '导航到数据与隐私页');
assert(appJson.includes('pages/backup-restore/backup-restore'), 'app.json 注册备份与恢复页');
assert(appJson.includes('pages/data-privacy/data-privacy'), 'app.json 注册数据与隐私页');

console.log('\nsettings tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL SETTINGS TESTS PASSED');
