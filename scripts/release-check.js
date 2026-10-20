/**
 * scripts/release-check.js — v0.8.0 / G8 发布前一次性检查（Release Check）
 *
 * 一条命令确认发版前所有「静态门」：
 *   1. 版本一致性：utils/version.js 的 APP_VERSION 与 package.json#version 相同，且为 x.y.z；
 *   2. 配置文件：app.json / project.config.json / sitemap.json 合法且关键项齐全（Skyline、AppID）；
 *   3. 页面与分包：app.json 中 pages / subpackages 指向的页面文件真实存在；
 *   4. 数据合同冻结：Bill 月份分片=V3、Backup=V3、Recurring Store=V1、Manifest=V3；
 *   5. Health fixtures：tests/fixtures 关键夹具存在；
 *   6. 包体估算：主包 / importer 分包 / 总包大小，按微信阈值给 PASS/WARN/FAIL；
 *   7. 单元测试（默认）：spawn `node tests/run-all.js`，须全绿（--no-tests 可跳过）。
 *
 * 用法：node scripts/release-check.js [--no-tests]
 * 退出码：0 全部通过（允许 WARN）；1 存在 FAIL。
 */
const nodeFs = require('fs');
const nodePath = require('path');
const { spawnSync } = require('child_process');

const ROOT = nodePath.join(__dirname, '..');

let failures = 0;
let warnings = 0;
function pass(msg) {
  console.log('  [PASS] ' + msg);
}
function warn(msg) {
  warnings++;
  console.log('  [WARN] ' + msg);
}
function fail(msg) {
  failures++;
  console.log('  [FAIL] ' + msg);
}
function readJson(file) {
  return JSON.parse(nodeFs.readFileSync(file, 'utf8'));
}
function section(title) {
  console.log('\n==== ' + title + ' ====');
}

/* ---------- 1. 版本一致性 ---------- */
section('1. 版本一致性');
const { APP_VERSION } = require(nodePath.join(ROOT, 'utils', 'version'));
const pkg = readJson(nodePath.join(ROOT, 'package.json'));
if (/^\d+\.\d+\.\d+$/.test(APP_VERSION)) pass('APP_VERSION 格式合法：' + APP_VERSION);
else fail('APP_VERSION 不是 x.y.z：' + APP_VERSION);
if (APP_VERSION === pkg.version) pass('utils/version.js 与 package.json 版本一致：' + APP_VERSION);
else fail('版本不一致：version.js=' + APP_VERSION + '，package.json=' + pkg.version);

/* ---------- 2. 配置文件 ---------- */
section('2. 配置文件');
let appJson;
try {
  appJson = readJson(nodePath.join(ROOT, 'app.json'));
  pass('app.json 合法');
} catch (e) {
  fail('app.json 解析失败：' + e.message);
}
if (appJson) {
  if (appJson.renderer === 'skyline') pass('渲染器为 Skyline');
  else fail('渲染器不是 skyline：' + appJson.renderer);
  if (Array.isArray(appJson.pages) && appJson.pages.length) pass('pages 已声明 ' + appJson.pages.length + ' 个');
  else fail('app.json 缺少 pages');
}
try {
  const proj = readJson(nodePath.join(ROOT, 'project.config.json'));
  if (/^wx[0-9a-f]{16}$/.test(proj.appid)) pass('project.config.json AppID 合法：' + proj.appid);
  else fail('project.config.json AppID 异常：' + proj.appid);
} catch (e) {
  fail('project.config.json 解析失败：' + e.message);
}
try {
  const sm = readJson(nodePath.join(ROOT, 'sitemap.json'));
  pass('sitemap.json 合法（rules=' + (sm.rules ? sm.rules.length : 0) + '）');
} catch (e) {
  fail('sitemap.json 解析失败：' + e.message);
}

/* ---------- 3. 页面 / 分包文件存在 ---------- */
section('3. 页面与分包');
function checkPage(p) {
  const required = ['.js', '.wxml'];
  const optional = ['.json', '.wxss'];
  let ok = true;
  required.forEach((ext) => {
    if (!nodeFs.existsSync(nodePath.join(ROOT, p + ext))) {
      fail('页面缺少必需文件：' + p + ext);
      ok = false;
    }
  });
  optional.forEach((ext) => {
    if (!nodeFs.existsSync(nodePath.join(ROOT, p + ext))) warn('页面可选文件缺失：' + p + ext);
  });
  if (ok) pass('页面文件齐全：' + p);
}
if (appJson) {
  appJson.pages.forEach(checkPage);
  (appJson.subpackages || []).forEach((sp) => {
    if (!nodeFs.existsSync(nodePath.join(ROOT, sp.root))) fail('分包目录不存在：' + sp.root);
    else pass('分包目录存在：' + sp.root);
    (sp.pages || []).forEach((p) => checkPage(nodePath.join(sp.root, p).split(nodePath.sep).join('/')));
  });
}

/* ---------- 4. 数据合同冻结 ---------- */
section('4. 数据合同冻结');
global.wx = {
  env: { USER_DATA_PATH: '/usr' },
  getFileSystemManager: () => ({
    accessSync() {
      throw new Error('ENOENT');
    },
    mkdirSync() {},
  }),
};
try {
  const ledger = require(nodePath.join(ROOT, 'data', 'ledger'));
  const backup = require(nodePath.join(ROOT, 'data', 'backup'));
  const recurringStore = require(nodePath.join(ROOT, 'data', 'recurring', 'store'));
  const manifest = require(nodePath.join(ROOT, 'data', 'manifest'));
  if (ledger.SCHEMA_VERSION === 3) pass('Bill 月份分片版本 V3');
  else fail('Bill 分片版本不是 3：' + ledger.SCHEMA_VERSION);
  if (Array.isArray(ledger.SUPPORTED_MONTH_VERSIONS) && ledger.SUPPORTED_MONTH_VERSIONS.join('') === '123') {
    pass('Strict Read 兼容月份版本 1/2/3');
  } else fail('SUPPORTED_MONTH_VERSIONS 异常：' + ledger.SUPPORTED_MONTH_VERSIONS);
  if (backup.SCHEMA_VERSION === 3) pass('Backup 版本 V3');
  else fail('Backup 版本不是 3：' + backup.SCHEMA_VERSION);
  if (recurringStore.STORE_VERSION === 1) pass('Recurring Store 版本 V1');
  else fail('Recurring Store 版本不是 1：' + recurringStore.STORE_VERSION);
  if (manifest.SCHEMA_VERSION === 3) pass('Manifest Schema 版本 V3');
  else fail('Manifest 版本不是 3：' + manifest.SCHEMA_VERSION);
} catch (e) {
  fail('数据合同检查异常：' + e.message);
}

/* ---------- 5. Health fixtures ---------- */
section('5. Health fixtures');
const fixtureDir = nodePath.join(ROOT, 'tests', 'fixtures');
if (nodeFs.existsSync(fixtureDir)) {
  const files = nodeFs.readdirSync(fixtureDir);
  if (files.length) pass('tests/fixtures 存在，含 ' + files.length + ' 项');
  else fail('tests/fixtures 为空');
  [
    'dailyvalue-backup-custom.json',
  ].forEach((f) => {
    if (nodeFs.existsSync(nodePath.join(fixtureDir, f))) pass('关键夹具存在：' + f);
    else fail('关键夹具缺失：' + f);
  });
} else {
  fail('tests/fixtures 目录不存在');
}

/* ---------- 6. 包体估算 ---------- */
section('6. 包体估算');
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'docs', 'tests', 'scripts']);
const IGNORE_FILES = new Set([
  'README.md', 'package.json', 'package-lock.json', '.gitignore', '.eslintrc.js',
  'debug.log', 'project.config.json', 'project.private.config.json',
]);
const CODE_EXT = /\.(js|json|wxml|wxss|wxs|png|jpg|jpeg|gif|svg)$/;
function walk(dir) {
  const out = [];
  nodeFs.readdirSync(dir).forEach((name) => {
    const full = nodePath.join(dir, name);
    const st = nodeFs.statSync(full);
    if (st.isDirectory()) {
      if (IGNORE_DIRS.has(name)) return;
      out.push(...walk(full));
    } else if (CODE_EXT.test(name) && !IGNORE_FILES.has(name)) {
      out.push({ rel: nodePath.relative(ROOT, full).split(nodePath.sep).join('/'), size: st.size });
    }
  });
  return out;
}
const KB = 1024;
const MB = 1024 * 1024;
const allFiles = walk(ROOT);
const IMPORTER_PREFIX = 'packages/importer/';
let mainBytes = 0;
let importerBytes = 0;
const mainBig = [];
allFiles.forEach((f) => {
  if (f.rel.startsWith(IMPORTER_PREFIX)) importerBytes += f.size;
  else {
    mainBytes += f.size;
    if (f.size > 50 * KB) mainBig.push(f);
  }
});
const totalBytes = mainBytes + importerBytes;
function fmt(n) {
  return (n / KB).toFixed(1) + ' KB';
}
console.log('  主包（含主包源码）：' + fmt(mainBytes));
console.log('  importer 分包：' + fmt(importerBytes));
console.log('  总包：' + fmt(totalBytes) + '（' + allFiles.length + ' 个文件）');
// 微信阈值：主包/单分包 2MB，总包 20MB
if (mainBytes > 2 * MB) fail('主包超过 2MB 限制');
else if (mainBytes > 1.5 * MB) warn('主包接近 2MB 限制');
else pass('主包在 2MB 限制内');
if (importerBytes > 2 * MB) fail('importer 分包超过 2MB 限制');
else if (importerBytes > 1.8 * MB) warn('importer 分包接近 2MB 限制');
else pass('importer 分包在 2MB 限制内');
if (totalBytes > 20 * MB) fail('总包超过 20MB 限制');
else pass('总包在 20MB 限制内');
mainBig.sort((a, b) => b.size - a.size).slice(0, 5).forEach((f) => {
  console.log('    · ' + f.rel + ' ' + fmt(f.size));
});

/* ---------- 7. 单元测试 ---------- */
const runTests = process.argv.indexOf('--no-tests') < 0;
if (runTests) {
  section('7. 单元测试（npm test）');
  const r = spawnSync(process.execPath, [nodePath.join(ROOT, 'tests', 'run-all.js')], { stdio: 'inherit' });
  if (r.status === 0) pass('全部单元测试通过');
  else fail('单元测试失败（退出码 ' + r.status + '）');
} else {
  console.log('\n==== 7. 单元测试（已用 --no-tests 跳过） ====');
}

/* ---------- 汇总 ---------- */
console.log('\n==================== 汇总 ====================');
console.log('FAIL：' + failures + '，WARN：' + warnings);
if (failures > 0) {
  console.error('发布检查未通过，请先修复以上 FAIL 项。');
  process.exit(1);
}
console.log('发布检查通过（版本 ' + APP_VERSION + '，警告 ' + warnings + ' 项）。');
process.exit(0);
