/**
 * tests/protection.test.js — v0.8.0 / G6 数据保护模式工具测试
 *
 * 覆盖：正常数据诊断/原始导出；损坏月份时原始文本被原样保留（不改义、不置空），
 * 诊断 integrity.ok=false。
 *
 * 运行：node tests/protection.test.js
 */
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
function eq(a, b, msg) {
  assert(a === b, msg + '（期望 ' + b + '，实际 ' + a + '）');
}

function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
  const storage = {};
  let sysTheme = 'dark';
  const chromeCalls = [];
  const fsm = {
    accessSync(p) {
      if (memFiles.has(p) || memDirs.has(p)) return;
      throw new Error('ENOENT ' + p);
    },
    mkdirSync(p, recursive) {
      if (recursive) {
        const parts = p.split('/');
        let cur = '';
        parts.forEach((x, i) => {
          if (i === 0 && x === '') cur = '';
          else {
            cur = cur + '/' + x;
            memDirs.add(cur);
          }
        });
      } else memDirs.add(p);
    },
    readFileSync(p) {
      if (!memFiles.has(p)) throw new Error('ENOENT ' + p);
      return memFiles.get(p);
    },
    writeFileSync(p, data) {
      memFiles.set(p, String(data));
    },
    unlinkSync(p) {
      if (!memFiles.has(p)) throw new Error('ENOENT');
      memFiles.delete(p);
    },
    readdirSync(p) {
      const prefix = p.endsWith('/') ? p : p + '/';
      const out = new Set();
      memFiles.forEach((v, k) => {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          if (rest && !rest.includes('/')) out.add(rest);
        }
      });
      return [...out];
    },
  };
  return {
    env: { USER_DATA_PATH: '/usr' },
    getFileSystemManager: () => fsm,
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => {
      storage[k] = v;
    },
    getAppBaseInfo: () => ({ theme: sysTheme }),
    onThemeChange: (cb) => { fsm.__themeCb = cb; },
    setNavigationBarColor: (o) => chromeCalls.push(Object.assign({ kind: 'nav' }, o)),
    setBackgroundColor: (o) => chromeCalls.push(Object.assign({ kind: 'bg' }, o)),
    __fsm: fsm,
    __chromeCalls: chromeCalls,
    __setSysTheme: (t) => { sysTheme = t; },
  };
}

global.wx = buildWx();
const ROOT = path.join(__dirname, '..');
const store = require(path.join(ROOT, 'data', 'index'));
const protection = require(path.join(ROOT, 'data', 'protection'));

/* ---------- 1. 正常数据：诊断 + 原始导出 ---------- */
store.init();
store.addBill({
  type: 'expense', amountCents: 2000, categoryId: 'c-food',
  occurredAt: new Date(2026, 9, 10, 12).getTime(),
});
store.recurring.createRule({
  type: 'expense', amountCents: 10000, categoryId: 'c-housing',
  frequency: 'monthly', interval: 1, day: 1, startDate: '2026-09-01', time: '09:00',
});

const diag = protection.buildDiagnostic();
eq(diag.format, 'daily-value-diagnostic', '诊断 format 正确');
eq(diag.integrity.ok, true, '正常数据诊断 integrity.ok');

const raw = protection.buildRawExport();
eq(raw.format, 'daily-value-raw-export', '原始导出 format 正确');
assert(raw.files['categories.json'] !== undefined, '原始导出含 categories.json');
assert(raw.files['settings.json'] !== undefined, '原始导出含 settings.json');
assert(raw.files['recurring.json'] !== undefined, '原始导出含 recurring.json');
assert(raw.files['bills/2026-10.json'] !== undefined, '原始导出含 bills/2026-10.json');

/* ---------- 2. 损坏月份：原始文本原样保留，诊断标记不 ok ---------- */
global.wx.__fsm.writeFileSync(store.paths.billFile('2026-10'), 'CORRUPT{{not-json');
const raw2 = protection.buildRawExport();
eq(raw2.files['bills/2026-10.json'], 'CORRUPT{{not-json', '损坏月份原始文本原样保留（不改义、不置空）');

const diag2 = protection.buildDiagnostic();
eq(diag2.integrity.ok, false, '损坏后诊断 integrity.ok=false');

/* ---------- 3. 损坏顶层文件：原始文本保留 ---------- */
global.wx.__fsm.writeFileSync(store.paths.FILE.categories, '###bad-categories###');
const raw3 = protection.buildRawExport();
eq(raw3.files['categories.json'], '###bad-categories###', '损坏 categories 原始文本保留');

/* ---------- 4. PROTECTION-THEME：保护模式 onShow 仍先校准主题 / 原生窗口 ---------- */
const paths = require(path.join(ROOT, 'data', 'paths'));
const theme = require(path.join(ROOT, 'utils', 'theme'));
let capturedApp = null;
global.App = (cfg) => { capturedApp = cfg; };
delete require.cache[require.resolve(path.join(ROOT, 'app.js'))];
require(path.join(ROOT, 'app.js'));
const appCfg = capturedApp;

// PROTECTION-THEME-01：保护模式 + system + 后台 Dark→Light（事件未送达）→ 回前台主题刷新
theme._resetForTest();
global.wx.__setSysTheme('dark');
global.wx.__fsm.writeFileSync(paths.FILE.settings, JSON.stringify({ currency: '¥', theme: 'system' }));
theme.init();
appCfg.protection = { ok: false };
global.wx.__setSysTheme('light'); // 模拟后台期间系统切换，onThemeChange 未下发
global.wx.__chromeCalls.length = 0;
appCfg.onShow();
eq(appCfg.globalData.effectiveTheme, 'light', 'PROTECTION-THEME-01 保护模式回前台 effective=light');
eq(theme.getEffectiveTheme(), 'light', 'PROTECTION-THEME-01 Theme Manager effective=light');
eq(appCfg.globalData.themeMode, 'system', 'PROTECTION-THEME-01 themeMode 仍 system');
const navLight = global.wx.__chromeCalls.filter((c) => c.kind === 'nav');
assert(navLight.length > 0 && navLight[navLight.length - 1].frontColor === '#000000',
  'PROTECTION-THEME-01 原生窗口重守为浅色（前景黑）');

// PROTECTION-THEME-02：保护模式 + manual dark + 系统 Dark→Light → 内容不变但 Chrome 重守
theme._resetForTest();
global.wx.__setSysTheme('dark');
global.wx.__fsm.writeFileSync(paths.FILE.settings, JSON.stringify({ currency: '¥', theme: 'dark' }));
theme.init();
appCfg.protection = { ok: false };
global.wx.__setSysTheme('light');
global.wx.__chromeCalls.length = 0;
appCfg.onShow();
eq(appCfg.globalData.effectiveTheme, 'dark', 'PROTECTION-THEME-02 手动深色内容不跟随系统（仍 dark）');
eq(theme.getEffectiveTheme(), 'dark', 'PROTECTION-THEME-02 Theme Manager effective=dark');
const navDark = global.wx.__chromeCalls.filter((c) => c.kind === 'nav');
assert(navDark.length > 0 && navDark[navDark.length - 1].frontColor === '#ffffff',
  'PROTECTION-THEME-02 原生窗口仍按深色重守（前景白）');

console.log('protection tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
