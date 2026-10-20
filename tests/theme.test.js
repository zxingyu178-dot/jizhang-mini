/**
 * tests/theme.test.js — v0.9.0 Theme & Appearance 单元测试
 *
 * 覆盖：
 *   THEME-01 旧设置无 theme（文件缺失）→ dark
 *   THEME-02 theme=dark → effective dark
 *   THEME-03 theme=light → effective light
 *   THEME-04 theme=system + 系统 dark → dark
 *   THEME-05 theme=system + 系统 light → light
 *   THEME-06 非法 theme（blue/123/null）→ dark
 *   THEME-07 系统主题变化只影响 system 模式（手动 dark 不跟随）
 *   THEME-08 手动 light 不随系统改变
 *   THEME-09 设置即时持久化（保留其它字段）
 *   THEME-10 Backup V3 保存 theme
 *   THEME-11 Backup V3 恢复 theme
 *   THEME-12 旧备份无 theme → 默认 dark（validator 不报错）
 *   THEME-13 非法 Backup theme → fail-closed
 *   THEME-14 监听器取消后不再通知
 *   THEME-15 多个页面订阅同时更新
 *   ICON-THEME-01 dark secondary 图标色
 *   ICON-THEME-02 light secondary 图标色
 *   HEADER-BACK-01 返回键双击只导航一次
 *
 * 运行：node tests/theme.test.js
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
  assert(a === b, msg + '（期望 ' + b + '，实际 ' + a);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------- 内存 wx（文件系统 + 系统主题 + 主题回调） ---------- */
let sysTheme = 'dark';
const themeCbs = [];
function buildWx() {
  const memFiles = new Map();
  const memDirs = new Set();
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
    getAppBaseInfo: () => ({ theme: sysTheme }),
    getSystemInfoSync: () => ({ theme: sysTheme }),
    onThemeChange: (cb) => themeCbs.push(cb),
  };
}

global.wx = buildWx();
const ROOT = path.join(__dirname, '..');
const fsApi = require(path.join(ROOT, 'data', 'fs'));
const paths = require(path.join(ROOT, 'data', 'paths'));
const theme = require(path.join(ROOT, 'utils', 'theme'));
const store = require(path.join(ROOT, 'data', 'index'));
const backup = require(path.join(ROOT, 'data', 'backup'));
const validator = require(path.join(ROOT, 'data', 'backup-validator'));

/** 重置为「全新安装 + 指定 settings」并 init；settings=null 表示无文件。 */
function freshInit(settings) {
  global.wx = buildWx();
  theme._resetForTest();
  if (settings) fsApi.writeJSON(paths.FILE.settings, settings);
  return theme.init();
}

/* ---------- 捕获组件定义（icon / page-header） ---------- */
let iconDef = null;
let headerDef = null;
global.Component = (d) => {
  if (d.methods && d.methods.resolveColor) iconDef = d;
  else if (d.methods && d.methods.onBack) headerDef = d;
};
require(path.join(ROOT, 'components', 'icon', 'icon'));
require(path.join(ROOT, 'components', 'page-header', 'page-header'));

async function run() {
  /* ---- THEME-01 无 settings 文件 → dark ---- */
  let s = freshInit(null);
  eq(s.themeMode, 'dark', 'THEME-01 无设置默认 mode dark');
  eq(s.effectiveTheme, 'dark', 'THEME-01 无设置默认 effective dark');
  eq(s.themeClass, 'theme-dark', 'THEME-01 无设置默认 class theme-dark');

  /* ---- THEME-02 theme=dark ---- */
  s = freshInit({ theme: 'dark', currency: '¥' });
  eq(s.effectiveTheme, 'dark', 'THEME-02 dark 生效 dark');

  /* ---- THEME-03 theme=light ---- */
  s = freshInit({ theme: 'light' });
  eq(s.effectiveTheme, 'light', 'THEME-03 light 生效 light');
  eq(s.themeClass, 'theme-light', 'THEME-03 light class theme-light');

  /* ---- THEME-04 system + 系统 dark ---- */
  sysTheme = 'dark';
  s = freshInit({ theme: 'system' });
  eq(s.effectiveTheme, 'dark', 'THEME-04 system 跟随系统 dark');

  /* ---- THEME-05 system + 系统 light ---- */
  sysTheme = 'light';
  s = freshInit({ theme: 'system' });
  eq(s.effectiveTheme, 'light', 'THEME-05 system 跟随系统 light');

  /* ---- THEME-06 非法 theme → dark ---- */
  sysTheme = 'dark';
  s = freshInit({ theme: 'blue' });
  eq(s.effectiveTheme, 'dark', 'THEME-06 非法 blue 归一 dark');
  s = freshInit({ theme: 123 });
  eq(s.effectiveTheme, 'dark', 'THEME-06 非法 123 归一 dark');
  s = freshInit({ theme: null });
  eq(s.effectiveTheme, 'dark', 'THEME-06 null 归一 dark');

  /* ---- THEME-07 手动 dark，系统变 light 不跟随 ---- */
  sysTheme = 'dark';
  freshInit({ theme: 'dark' });
  themeCbs.forEach((cb) => cb({ theme: 'light' }));
  eq(theme.getEffectiveTheme(), 'dark', 'THEME-07 手动 dark 不跟随系统变 light');

  /* ---- THEME-08 手动 light，系统变 dark 不跟随 ---- */
  freshInit({ theme: 'light' });
  themeCbs.forEach((cb) => cb({ theme: 'dark' }));
  eq(theme.getEffectiveTheme(), 'light', 'THEME-08 手动 light 不跟随系统变 dark');

  /* ---- THEME-09 setThemeMode 即时持久化，保留其它字段 ---- */
  freshInit({ currency: '¥', theme: 'dark' });
  theme.setThemeMode('light');
  const saved = fsApi.readJSON(paths.FILE.settings, null);
  eq(saved.theme, 'light', 'THEME-09 持久化 theme=light');
  eq(saved.currency, '¥', 'THEME-09 保留 currency 字段');

  /* ---- THEME-10 Backup V3 保存 theme ---- */
  freshInit(null);
  store.init();
  store.addBill({ type: 'expense', amountCents: 1000, occurredAt: Date.now() });
  theme.setThemeMode('light');
  const bk = backup.buildBackup();
  eq(bk.data.settings.theme, 'light', 'THEME-10 备份保存 theme=light');

  /* ---- THEME-11 Backup V3 恢复 theme ---- */
  bk.data.settings.theme = 'system';
  backup.restoreBackup(bk);
  const afterRestore = fsApi.readJSON(paths.FILE.settings, null);
  eq(afterRestore.theme, 'system', 'THEME-11 恢复后 theme=system');

  /* ---- THEME-12 旧备份无 theme → 默认 dark（validator 不报错） ---- */
  const oldBk = JSON.parse(JSON.stringify(bk));
  oldBk.schemaVersion = 3;
  delete oldBk.data.settings.theme;
  const vr12 = validator.validateBackupRaw(oldBk);
  assert(vr12.ok, 'THEME-12 无 theme 备份校验通过（默认 dark）');
  assert(
    !vr12.errors.some((e) => e.code === 'backup-settings-theme-invalid'),
    'THEME-12 无 theme 不应报 theme 非法'
  );

  /* ---- THEME-13 非法 Backup theme → fail-closed ---- */
  const badBk = JSON.parse(JSON.stringify(bk));
  badBk.data.settings.theme = 'blue';
  const vr13 = validator.validateBackupRaw(badBk);
  assert(!vr13.ok, 'THEME-13 非法 theme 校验不通过');
  assert(
    vr13.errors.some((e) => e.code === 'backup-settings-theme-invalid'),
    'THEME-13 应报 backup-settings-theme-invalid'
  );

  /* ---- THEME-14 取消订阅后不再通知 ---- */
  theme.setThemeMode('dark');
  let calls14 = 0;
  const off14 = theme.subscribe(() => calls14++);
  theme.setThemeMode('light');
  eq(calls14, 1, 'THEME-14 切换时回调被调用一次');
  off14();
  theme.setThemeMode('dark');
  eq(calls14, 1, 'THEME-14 取消后不再通知');

  /* ---- THEME-15 多页面订阅同时更新 ---- */
  theme.setThemeMode('dark');
  let cA = 0;
  let cB = 0;
  theme.subscribe(() => cA++);
  theme.subscribe(() => cB++);
  theme.setThemeMode('light');
  eq(cA, 1, 'THEME-15 订阅者 A 收到更新');
  eq(cB, 1, 'THEME-15 订阅者 B 收到更新');

  /* ---- ICON-THEME-01/02 图标 tone 主题色 ---- */
  function makeIcon(tone) {
    const d = { uri: '', w: 22, h: 22, name: 'search', size: 22, tone, color: '' };
    const inst = { data: d, setData(p) { Object.assign(d, p); } };
    Object.keys(iconDef.methods).forEach((k) => {
      inst[k] = iconDef.methods[k].bind(inst);
    });
    return inst;
  }
  theme.setThemeMode('dark');
  const ic1 = makeIcon('secondary');
  eq(ic1.resolveColor(), 'rgba(255,255,255,0.62)', 'ICON-THEME-01 dark secondary');
  theme.setThemeMode('light');
  const ic2 = makeIcon('secondary');
  eq(ic2.resolveColor(), 'rgba(25,28,40,0.58)', 'ICON-THEME-02 light secondary');

  /* ---- HEADER-BACK-01 返回键双击只导航一次 ---- */
  global.getCurrentPages = () => [{ route: 'a' }, { route: 'b' }];
  let navCount = 0;
  global.wx.navigateBack = () => { navCount++; };
  global.wx.hideKeyboard = (opts) => { if (opts && opts.complete) opts.complete(); };
  const hd = { data: { statusBarHeight: 20, headerHeight: 64 }, setData() {}, triggerEvent() {} };
  hd.onBack = headerDef.methods.onBack.bind(hd);
  hd.onBack();
  hd.onBack();
  await sleep(30);
  eq(navCount, 1, 'HEADER-BACK-01 快速双击只执行一次 navigateBack');

  /* ---- 汇总 ---- */
  console.log('\ntheme tests: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
  console.log('ALL THEME TESTS PASSED');
}

run().catch((e) => {
  console.error('测试异常', e);
  process.exit(1);
});
