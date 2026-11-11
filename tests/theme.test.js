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
 *   THEME-16~18 恢复 light/system/dark 后 Theme Manager 即时同步（不重启）
 *   THEME-19 本地非法 theme ensureSettings 后 canonical dark 落盘
 *   THEME-20 规范化后 buildBackup 可被自身 validator 接受
 *   THEME-RELOAD-01 reloadFromStorage 重读磁盘并通知
 *   CHROME-GUARD-01/02 手动模式触发 chrome guard / system 模式内容跟随
 *   THEME-PERSIST-01/02/03 主题持久化成功才生效 / 写失败保持旧主题不 emit
 *   THEME-RESUME-01/02 system 前台校准跟随 / 手动模式不跟随
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
    renameSync(oldPath, newPath) {
      if (!memFiles.has(oldPath)) throw new Error('ENOENT');
      if (memFiles.has(newPath)) throw new Error('file already exists');
      memFiles.set(newPath, memFiles.get(oldPath));
      memFiles.delete(oldPath);
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
  themeCbs.length = 0; // 新 wx 下旧系统主题回调已失效，清空避免累积
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

  /* ============================================================
   * v0.9.1：恢复主题同步 / Settings 规范化 / Native Chrome Guard
   * ============================================================ */

  /* ---- THEME-16 恢复 light backup，Theme Manager 立即 light（不重启） ---- */
  sysTheme = 'dark';
  theme.setThemeMode('dark');
  const bk16 = backup.buildBackup();
  bk16.data.settings.theme = 'light';
  let calls16 = 0;
  const off16 = theme.subscribe(() => calls16++);
  backup.restoreBackup(bk16);
  eq(theme.getThemeMode(), 'light', 'THEME-16 恢复后 mode light');
  eq(theme.getEffectiveTheme(), 'light', 'THEME-16 恢复后 effective light');
  eq(calls16, 1, 'THEME-16 订阅页面即时收到更新');
  off16();

  /* ---- THEME-17 恢复 system backup，mode 立即 system ---- */
  sysTheme = 'dark';
  theme.setThemeMode('dark');
  const bk17 = backup.buildBackup();
  bk17.data.settings.theme = 'system';
  backup.restoreBackup(bk17);
  eq(theme.getThemeMode(), 'system', 'THEME-17 恢复后 mode system');
  eq(theme.getEffectiveTheme(), 'dark', 'THEME-17 系统深色 effective dark');

  /* ---- THEME-18 恢复 dark backup，订阅页面立即 dark ---- */
  sysTheme = 'dark';
  theme.setThemeMode('light');
  const bk18 = backup.buildBackup();
  bk18.data.settings.theme = 'dark';
  let calls18 = 0;
  const off18 = theme.subscribe(() => calls18++);
  backup.restoreBackup(bk18);
  eq(theme.getThemeMode(), 'dark', 'THEME-18 恢复后 mode dark');
  eq(theme.getEffectiveTheme(), 'dark', 'THEME-18 恢复后 effective dark');
  eq(calls18, 1, 'THEME-18 订阅页面即时收到更新');
  off18();

  /* ---- THEME-19 本地非法 theme，ensureSettings 后 canonical dark 并落盘 ---- */
  fsApi.writeJSON(paths.FILE.settings, { currency: '¥', theme: 'blue' });
  const ens19 = store.settings.ensureSettings();
  eq(ens19.theme, 'dark', 'THEME-19 ensureSettings 规范化 theme dark');
  eq(fsApi.readJSON(paths.FILE.settings, null).theme, 'dark', 'THEME-19 磁盘非法 theme 已修正 dark');
  eq(store.settings.getSettings().theme, 'dark', 'THEME-19 getSettings 返回规范化 dark');

  /* ---- THEME-20 规范化后 buildBackup 可被自身 validator 接受 ---- */
  fsApi.writeJSON(paths.FILE.settings, { currency: '¥', theme: 'blue' });
  store.settings.ensureSettings();
  const bk20 = backup.buildBackup();
  const vr20 = validator.validateBackupRaw(bk20);
  assert(vr20.ok, 'THEME-20 规范化后生成的备份可被自身 validator 接受');
  assert(!vr20.errors.some((e) => e.code === 'backup-settings-theme-invalid'), 'THEME-20 不应报 theme 非法');

  /* ---- THEME-RELOAD-01 reloadFromStorage 重新读取磁盘并通知 ---- */
  theme.setThemeMode('dark');
  fsApi.writeJSON(paths.FILE.settings, { currency: '¥', theme: 'light' });
  let callsR = 0;
  const offR = theme.subscribe(() => callsR++);
  theme.reloadFromStorage();
  eq(theme.getThemeMode(), 'light', 'RELOAD-01 reload 后 mode light');
  eq(theme.getEffectiveTheme(), 'light', 'RELOAD-01 reload 后 effective light');
  eq(callsR, 1, 'RELOAD-01 reload 即时通知订阅');
  offR();

  /* ---- CHROME-GUARD-01 手动模式系统变化：内容不变，触发 chrome guard ---- */
  theme.setThemeMode('light');
  let chromeN = 0;
  let chromeEff = null;
  const offC = theme.onChromeNeed((eff) => { chromeN++; chromeEff = eff; });
  themeCbs.forEach((cb) => cb({ theme: 'dark' }));
  eq(chromeN, 1, 'CHROME-GUARD-01 手动模式系统变化触发一次 guard');
  eq(chromeEff, 'light', 'CHROME-GUARD-01 guard 回传当前 effective light');
  eq(theme.getEffectiveTheme(), 'light', 'CHROME-GUARD-01 内容主题不变仍 light');
  offC();

  /* ---- CHROME-GUARD-02 system 模式系统变化：内容跟随，不触发 chrome guard ---- */
  theme.setThemeMode('system');
  let chromeN2 = 0;
  const offC2 = theme.onChromeNeed(() => chromeN2++);
  themeCbs.forEach((cb) => cb({ theme: 'light' }));
  eq(chromeN2, 0, 'CHROME-GUARD-02 system 模式不触发 chrome guard');
  eq(theme.getEffectiveTheme(), 'light', 'CHROME-GUARD-02 system 内容跟随 light');
  offC2();

  /* ============================================================
   * v1.0.0：主题持久化可靠性 / 前台恢复校准
   * ============================================================ */

  /* ---- THEME-PERSIST-01 写成功才切换并返回 ok ---- */
  sysTheme = 'dark';
  freshInit({ currency: '¥', theme: 'dark' });
  const rP1 = theme.setThemeMode('light');
  assert(rP1.ok === true, 'PERSIST-01 写成功返回 ok=true');
  eq(theme.getEffectiveTheme(), 'light', 'PERSIST-01 写成功后 effective light');
  eq(fsApi.readJSON(paths.FILE.settings, null).theme, 'light', 'PERSIST-01 磁盘 theme light');

  /* ---- THEME-PERSIST-02 写失败：保持旧主题，返回 ok=false ---- */
  freshInit({ currency: '¥', theme: 'dark' });
  const fsm = global.wx.getFileSystemManager();
  const origWrite = fsm.writeFileSync;
  fsm.writeFileSync = function () { throw new Error('EIO disk full'); };
  const rP2 = theme.setThemeMode('light');
  fsm.writeFileSync = origWrite;
  assert(rP2.ok === false, 'PERSIST-02 写失败返回 ok=false');
  eq(theme.getThemeMode(), 'dark', 'PERSIST-02 写失败 mode 保持 dark');
  eq(theme.getEffectiveTheme(), 'dark', 'PERSIST-02 写失败 effective 保持 dark');
  eq(fsApi.readJSON(paths.FILE.settings, null).theme, 'dark', 'PERSIST-02 磁盘 theme 仍 dark');

  /* ---- THEME-PERSIST-03 写失败不 emit 假状态 ---- */
  freshInit({ theme: 'dark' });
  const fsm3 = global.wx.getFileSystemManager();
  const origWrite3 = fsm3.writeFileSync;
  fsm3.writeFileSync = function () { throw new Error('EIO'); };
  let callsP3 = 0;
  const offP3 = theme.subscribe(() => callsP3++);
  const rP3 = theme.setThemeMode('light');
  fsm3.writeFileSync = origWrite3;
  offP3();
  assert(rP3.ok === false, 'PERSIST-03 写失败 ok=false');
  eq(callsP3, 0, 'PERSIST-03 写失败不 emit 假状态');

  /* ---- THEME-RESUME-01 system 后台 Dark→Light（事件丢失），onShow 校准变 Light ---- */
  sysTheme = 'dark';
  freshInit({ theme: 'system' });
  eq(theme.getEffectiveTheme(), 'dark', 'RESUME-01 初始 effective dark');
  sysTheme = 'light'; // 模拟后台期间系统切换、未下发 onThemeChange
  let callsR1 = 0;
  const offR1 = theme.subscribe(() => callsR1++);
  const rsR1 = theme.refreshSystemTheme();
  offR1();
  assert(rsR1.effectiveTheme === 'light', 'RESUME-01 校准后 effective light');
  eq(theme.getEffectiveTheme(), 'light', 'RESUME-01 effective 变 light');
  eq(callsR1, 1, 'RESUME-01 订阅页面收到一次更新');

  /* ---- THEME-RESUME-02 manual dark 系统变化不受影响 ---- */
  sysTheme = 'dark';
  freshInit({ theme: 'dark' });
  sysTheme = 'light';
  let callsR2 = 0;
  const offR2 = theme.subscribe(() => callsR2++);
  const rsR2 = theme.refreshSystemTheme();
  offR2();
  assert(rsR2.effectiveTheme === 'dark', 'RESUME-02 手动 dark 校准后仍 dark');
  eq(theme.getEffectiveTheme(), 'dark', 'RESUME-02 effective 保持 dark');
  eq(callsR2, 0, 'RESUME-02 手动模式不 emit');
  sysTheme = 'dark';

  /* ============================================================
   * v1.3.4：主题变更计数器（onShow 识别主题变化、跳过统计面板重载）
   * ============================================================ */
  freshInit({ theme: 'dark' });
  eq(theme.getChangeCounter(), 0, 'COUNTER-01 重置后初始序号为 0');
  theme.setThemeMode('light');
  eq(theme.getChangeCounter(), 1, 'COUNTER-02 切主题 emit 后序号 +1');
  theme.setThemeMode('dark');
  eq(theme.getChangeCounter(), 2, 'COUNTER-02 再次切主题序号继续 +1');
  // 同 mode 重复设置：无变化不 emit，序号不变
  theme.setThemeMode('dark');
  eq(theme.getChangeCounter(), 2, 'COUNTER-03 同模式重复设置不递增');
  // 写失败：不 emit，序号不变
  const fsmC = global.wx.getFileSystemManager();
  const origC = fsmC.writeFileSync;
  fsmC.writeFileSync = function () { throw new Error('EIO'); };
  theme.setThemeMode('light');
  fsmC.writeFileSync = origC;
  eq(theme.getChangeCounter(), 2, 'COUNTER-04 写失败不 emit 序号保持');
  theme._resetForTest();
  eq(theme.getChangeCounter(), 0, 'COUNTER-05 _resetForTest 归零序号');

  /* ============================================================
   * v1.3.4 Review Fix：纯主题序号（仅用户主动 setThemeMode 递增）
   * ============================================================ */
  freshInit({ theme: 'dark' });
  eq(theme.getThemeOnlyCounter(), 0, 'THEMEONLY-01 初始纯主题序号为 0');
  theme.setThemeMode('light');
  eq(theme.getThemeOnlyCounter(), 1, 'THEMEONLY-02 用户主动切主题 +1');
  theme.setThemeMode('dark');
  eq(theme.getThemeOnlyCounter(), 2, 'THEMEONLY-02 再次主动切换继续 +1');
  theme.setThemeMode('dark');
  eq(theme.getThemeOnlyCounter(), 2, 'THEMEONLY-03 同模式重复设置不递增');
  theme.reloadFromStorage(); // 备份恢复路径
  eq(theme.getThemeOnlyCounter(), 2, 'THEMEONLY-04 reloadFromStorage 不递增纯主题序号');
  theme.refreshSystemTheme(); // 前台校准路径
  eq(theme.getThemeOnlyCounter(), 2, 'THEMEONLY-05 refreshSystemTheme 不递增纯主题序号');
  const fsmTO = global.wx.getFileSystemManager();
  const origTO = fsmTO.writeFileSync;
  fsmTO.writeFileSync = function () { throw new Error('EIO'); };
  theme.setThemeMode('light');
  fsmTO.writeFileSync = origTO;
  eq(theme.getThemeOnlyCounter(), 2, 'THEMEONLY-06 写失败不递增纯主题序号');
  theme._resetForTest();
  eq(theme.getThemeOnlyCounter(), 0, 'THEMEONLY-07 _resetForTest 归零');

  /* ============================================================
   * v1.4.5：主题色（accent）—— 4 套配色 × 深/浅
   * ============================================================ */

  /* ---- ACCENT-NORM-01 非法值一律归一 indigo（fail-safe） ---- */
  eq(theme.normalizeAccent(undefined), 'indigo', 'ACCENT-NORM-01 undefined → indigo');
  eq(theme.normalizeAccent(null), 'indigo', 'ACCENT-NORM-01 null → indigo');
  eq(theme.normalizeAccent('blue'), 'indigo', 'ACCENT-NORM-01 非法 blue → indigo');
  eq(theme.normalizeAccent(123), 'indigo', 'ACCENT-NORM-01 数字 123 → indigo');
  eq(theme.normalizeAccent(''), 'indigo', 'ACCENT-NORM-01 空串 → indigo');
  ['indigo', 'teal', 'amber', 'rose'].forEach((a) => {
    eq(theme.normalizeAccent(a), a, 'ACCENT-NORM-02 合法值 ' + a + ' 保持');
  });

  /* ---- ACCENT-01 老用户 settings 无 accent → indigo，其余行为不变 ---- */
  sysTheme = 'dark';
  s = freshInit({ currency: '¥', theme: 'dark' });
  eq(s.accent, 'indigo', 'ACCENT-01 无 accent 字段 → indigo');
  eq(s.accentClass, 'accent-indigo', 'ACCENT-01 accentClass accent-indigo');
  eq(s.themeClass, 'theme-dark', 'ACCENT-01 themeClass 语义不变');
  eq(s.themeMode, 'dark', 'ACCENT-01 themeMode 语义不变');
  eq(s.effectiveTheme, 'dark', 'ACCENT-01 effectiveTheme 语义不变');

  /* ---- ACCENT-02 非法 accent 落盘 → 归一 indigo，不崩 ---- */
  s = freshInit({ theme: 'light', accent: 'purple' });
  eq(s.accent, 'indigo', 'ACCENT-02 非法 accent 归一 indigo');
  eq(s.accentClass, 'accent-indigo', 'ACCENT-02 非法 accent class accent-indigo');

  /* ---- ACCENT-03 snapshot 两两组合 8 种：themeClass + accentClass 同时正确 ---- */
  const ACCENT_KEYS = ['indigo', 'teal', 'amber', 'rose'];
  let comboOk = 0;
  ACCENT_KEYS.forEach((a) => {
    ['dark', 'light'].forEach((m) => {
      const st = freshInit({ theme: m, accent: a });
      if (st.themeClass === 'theme-' + m && st.accentClass === 'accent-' + a && st.accent === a) {
        comboOk++;
      } else {
        assert(false, 'ACCENT-03 组合 ' + a + '/' + m + ' 期望 theme-' + m + ' + accent-' + a + '，实际 ' + st.themeClass + ' + ' + st.accentClass);
      }
    });
  });
  eq(comboOk, 8, 'ACCENT-03 4 套 × 深/浅 8 种组合 snapshot 全部正确');

  /* ---- ACCENT-04 getAccentPalette 8 种组合的 4 个色值全对 ---- */
  const EXPECT_PALETTE = {
    indigo: {
      dark: ['#7c86ff', '#5b67f0', '#7c86ff', '#0b0d16'],
      light: ['#6e78f5', '#5660e0', '#4b55cf', '#ffffff'],
    },
    teal: {
      dark: ['#2ec4b6', '#1f9e93', '#2ec4b6', '#06231f'],
      light: ['#0f8f83', '#0b6f66', '#0a6a61', '#ffffff'],
    },
    amber: {
      dark: ['#f0a33e', '#d4862a', '#f0a33e', '#2a1a05'],
      light: ['#a8680a', '#8a5408', '#8a5408', '#ffffff'],
    },
    rose: {
      dark: ['#f0658f', '#d44a75', '#f0658f', '#2b0a14'],
      light: ['#cf3a69', '#ad2b53', '#ad2b53', '#ffffff'],
    },
  };
  ACCENT_KEYS.forEach((a) => {
    ['dark', 'light'].forEach((m) => {
      freshInit({ theme: m, accent: a });
      const p = theme.getAccentPalette();
      const want = EXPECT_PALETTE[a][m];
      const got = [p.primary, p.primaryDeep, p.primaryText, p.onPrimary];
      eq(got.join(','), want.join(','), 'ACCENT-04 ' + a + '/' + m + ' palette 四色');
      eq(p.effectiveTheme, m, 'ACCENT-04 ' + a + '/' + m + ' effectiveTheme 回传');
      eq(p.accent, a, 'ACCENT-04 ' + a + '/' + m + ' accent 回传');
    });
  });

  /* ---- ACCENT-05 setAccent 持久化 + 即时通知；同值不重复 emit ---- */
  freshInit({ currency: '¥', theme: 'dark' });
  let callsA5 = 0;
  const offA5 = theme.subscribe(() => callsA5++);
  const rA5 = theme.setAccent('teal');
  assert(rA5.ok === true, 'ACCENT-05 setAccent 成功返回 ok=true');
  eq(callsA5, 1, 'ACCENT-05 setAccent 通知订阅一次');
  eq(rA5.accentClass, 'accent-teal', 'ACCENT-05 返回值带新 accentClass');
  eq(fsApi.readJSON(paths.FILE.settings, null).accent, 'teal', 'ACCENT-05 磁盘 accent=teal');
  eq(fsApi.readJSON(paths.FILE.settings, null).currency, '¥', 'ACCENT-05 保留其它 settings 字段');
  theme.setAccent('teal');
  eq(callsA5, 1, 'ACCENT-05 同 accent 重复设置不 emit');
  offA5();

  /* ---- ACCENT-06 写盘失败：保持旧主题色、不 emit、ok=false ---- */
  freshInit({ theme: 'dark', accent: 'amber' });
  const fsmA6 = global.wx.getFileSystemManager();
  const origA6 = fsmA6.writeFileSync;
  fsmA6.writeFileSync = function () { throw new Error('EIO disk full'); };
  let callsA6 = 0;
  const offA6 = theme.subscribe(() => callsA6++);
  const rA6 = theme.setAccent('rose');
  fsmA6.writeFileSync = origA6;
  offA6();
  assert(rA6.ok === false, 'ACCENT-06 写失败 ok=false');
  eq(theme.getAccent(), 'amber', 'ACCENT-06 写失败保持旧 accent amber');
  eq(callsA6, 0, 'ACCENT-06 写失败不 emit 假状态');
  eq(theme.getAccentClass(), 'accent-amber', 'ACCENT-06 getAccentClass 同步保持');

  /* ---- ACCENT-07 备份恢复：reloadFromStorage 一并重读 accent ---- */
  freshInit({ theme: 'dark', accent: 'indigo' });
  fsApi.writeJSON(paths.FILE.settings, { theme: 'light', accent: 'rose', currency: '¥' });
  let callsA7 = 0;
  const offA7 = theme.subscribe(() => callsA7++);
  theme.reloadFromStorage();
  offA7();
  eq(theme.getAccent(), 'rose', 'ACCENT-07 reload 后 accent=rose');
  eq(theme.getAccentClass(), 'accent-rose', 'ACCENT-07 reload 后 class accent-rose');
  eq(callsA7, 1, 'ACCENT-07 accent+theme 同时变化只通知一次');

  /* ---- ACCENT-08 _resetForTest 归位 indigo ---- */
  theme._resetForTest();
  eq(theme.getAccent(), 'indigo', 'ACCENT-08 _resetForTest 归位 indigo');
  eq(theme.getAccentClass(), 'accent-indigo', 'ACCENT-08 _resetForTest class');

  /* ---- ACCENT-09 app.wxss：4 套 × 深/浅 共 8 组，6 个变量定义齐 + 按钮/文字硬规则 ---- */
  const nodeFs = require('fs');
  const wxss = nodeFs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8').replace(/\s+/g, ' ');
  /** 取 `.theme-x.accent-y { ... }` 块正文（未闭合返回 null） */
  function accentBlock(mode, accent) {
    const sel = '.theme-' + mode + '.accent-' + accent;
    const at = wxss.indexOf(sel + ' {');
    if (at < 0) return null;
    const open = wxss.indexOf('{', at);
    const close = wxss.indexOf('}', open);
    if (open < 0 || close < 0) return null;
    return wxss.slice(open + 1, close);
  }
  const VAR6 = ['--primary', '--primary-deep', '--primary-text', '--on-primary', '--primary-glow', '--primary-tint'];
  ['dark', 'light'].forEach((m) => {
    ACCENT_KEYS.forEach((a) => {
      const body = accentBlock(m, a);
      assert(body !== null, 'ACCENT-09 app.wxss 缺少 .theme-' + m + '.accent-' + a + ' 覆盖块');
      if (!body) return;
      VAR6.forEach((v) => {
        const re = new RegExp('(^|;)\\s*' + v + '\\s*:\\s*[^;]+;');
        assert(re.test(body), 'ACCENT-09 ' + m + '/' + a + ' 缺少 ' + v);
      });
      // 硬规则 2：深色绝不写死白字（亮主色 + 白字只有 2.10~2.17）
      if (m === 'dark') {
        assert(!/--on-primary\s*:\s*#ffffff/i.test(body), 'ACCENT-09 深色 ' + a + ' 的 --on-primary 不许是白色');
      }
    });
  });
  // 硬规则 1：按钮底按模式取不同变量（深色 primary / 浅色 primary-deep）
  ['indigo', 'teal', 'amber', 'rose'].forEach((a) => {
    const dk = accentBlock('dark', a) || '';
    const lt = accentBlock('light', a) || '';
    assert(/--button-primary\s*:\s*linear-gradient\([^)]*var\(--primary\)/.test(dk),
      'ACCENT-10 深色 ' + a + ' 按钮底从 --primary 起');
    assert(/--button-primary\s*:\s*linear-gradient\([^;]*var\(--primary-deep\)/.test(lt),
      'ACCENT-10 浅色 ' + a + ' 按钮底从 --primary-deep 起');
  });

  /* ---- ACCENT-11 14 个页面根节点同时挂 themeClass 与 accentClass ---- */
  const PAGE_WXML = [
    'packages/importer/pages/import/import.wxml',
    'packages/importer/pages/preview/preview.wxml',
    'packages/importer/pages/result/result.wxml',
    'pages/appearance/appearance.wxml',
    'pages/backup-restore/backup-restore.wxml',
    'pages/budget-settings/budget-settings.wxml',
    'pages/category-manage/category-manage.wxml',
    'pages/daily-value-detail/detail.wxml',
    'pages/data-privacy/data-privacy.wxml',
    'pages/main/main.wxml',
    'pages/recurring/recurring.wxml',
    'pages/release-notes/release-notes.wxml',
    'pages/search/search.wxml',
    'pages/settings/settings.wxml',
  ];
  PAGE_WXML.forEach((rel) => {
    const wxml = nodeFs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert(/\{\{themeClass\}\}\s+\{\{accentClass\}\}/.test(wxml.split('\n')[0]),
      'ACCENT-11 ' + rel + ' 根节点须同时挂 themeClass 与 accentClass');
  });

  /* ---- ACCENT-12 主色不再被当文字用（应统一走 --primary-text） ---- */
  const WXSS_DIRS = ['pages', 'components', 'packages'];
  function walkWxss(dir, out) {
    nodeFs.readdirSync(dir).forEach((name) => {
      const full = path.join(dir, name);
      const st = nodeFs.statSync(full);
      if (st.isDirectory()) walkWxss(full, out);
      else if (/\.wxss$/.test(name)) out.push(full);
    });
    return out;
  }
  let primaryTextOffenders = [];
  WXSS_DIRS.forEach((d) => {
    const dir = path.join(ROOT, d);
    if (!nodeFs.existsSync(dir)) return;
    walkWxss(dir, []).forEach((file) => {
      const txt = nodeFs.readFileSync(file, 'utf8');
      txt.split(/\r?\n/).forEach((line, i) => {
        if (/^\s*color:\s*var\(--primary\)\s*;/.test(line)) {
          primaryTextOffenders.push(path.relative(ROOT, file) + ':' + (i + 1));
        }
      });
    });
  });
  assert(primaryTextOffenders.length === 0,
    'ACCENT-12 仍有 color: var(--primary) 未改为 --primary-text：' + primaryTextOffenders.join('、'));

  /* ---- ACCENT-13 6 处 JS 硬编码主色改为跟主题色走（功能级，不是文本扫描） ---- */
  // a) icon / category-icon 的 brand / onbrand tone
  let catIconDef = null;
  const origComponent = global.Component;
  global.Component = (d) => {
    if (d.methods && d.methods.resolveColor && d.methods.refresh) {
      // 通过 properties 里的 iconType 区分 icon 与 category-icon
      if (d.properties && d.properties.iconType) catIconDef = d;
      else iconDef = d;
    } else origComponent(d);
  };
  require(path.join(ROOT, 'components', 'category-icon', 'category-icon'));
  global.Component = origComponent;

  function makeIconOf(def, tone, data) {
    const d = Object.assign({ uri: '', w: 22, h: 22, name: 'search', size: 22, tone, color: '' }, data || {});
    const inst = { data: d, setData(p) { Object.assign(d, p); } };
    Object.keys(def.methods).forEach((k) => { inst[k] = def.methods[k].bind(inst); });
    return inst;
  }
  assert(catIconDef !== null, 'ACCENT-13a 未能捕获 category-icon 组件定义');
  ['indigo', 'teal', 'amber', 'rose'].forEach((a) => {
    ['dark', 'light'].forEach((m) => {
      freshInit({ theme: m, accent: a });
      const pal = theme.getAccentPalette();
      const i1 = makeIconOf(iconDef, 'brand');
      const i2 = makeIconOf(catIconDef, 'brand');
      const i3 = makeIconOf(iconDef, 'onbrand');
      const i4 = makeIconOf(catIconDef, 'onbrand');
      eq(i1.resolveColor(), pal.primary, 'ACCENT-13a icon brand ' + a + '/' + m);
      eq(i2.resolveColor(), pal.primary, 'ACCENT-13a category-icon brand ' + a + '/' + m);
      eq(i3.resolveColor(), pal.onPrimary, 'ACCENT-13b icon onbrand ' + a + '/' + m);
      eq(i4.resolveColor(), pal.onPrimary, 'ACCENT-13b category-icon onbrand ' + a + '/' + m);
    });
  });

  // b) 统计页累计折线：buildCumulativeSVG 接受 lineColor，缺省回落默认靛蓝
  const cumulation = require(path.join(ROOT, 'data', 'statistics', 'cumulative'));
  const cumPts = [{ day: 1, cumCents: 100 }, { day: 2, cumCents: 300 }];
  const svgDefault = cumulation.buildCumulativeSVG(cumPts, 300, '#333', { w: 320, h: 180 }, { padLeft: 30 });
  assert(svgDefault.indexOf('stroke="' + cumulation.LINE_COLOR + '"') >= 0,
    'ACCENT-13c 未传 lineColor 时回落默认靛蓝（旧调用方行为不变）');
  ['indigo', 'teal', 'amber', 'rose'].forEach((a) => {
    ['dark', 'light'].forEach((m) => {
      freshInit({ theme: m, accent: a });
      const primary = theme.getAccentPalette().primary;
      const svg = cumulation.buildCumulativeSVG(cumPts, 300, '#333', { w: 320, h: 180 }, { padLeft: 30, lineColor: primary });
      assert(svg.indexOf('stroke="' + primary + '"') >= 0, 'ACCENT-13c 累计折线用主题色 ' + a + '/' + m);
      assert(svg.indexOf('fill="' + primary + '" fill-opacity') >= 0, 'ACCENT-13c 累计面积用主题色 ' + a + '/' + m);
    });
  });

  // c) 首页日价曲线（Canvas 调色板）：用假 ctx 跑一次 draw，断言实际下发的线色 / 面积色
  let curveDef = null;
  const origComponent2 = global.Component;
  global.Component = (d) => {
    if (d.properties && d.properties.billId && d.methods && d.methods.draw) curveDef = d;
    else origComponent2(d);
  };
  require(path.join(ROOT, 'components', 'daily-value-curve', 'daily-value-curve'));
  global.Component = origComponent2;
  assert(curveDef !== null, 'ACCENT-13d 未能捕获 daily-value-curve 组件定义');

  function drawColors(accent, mode) {
    freshInit({ theme: mode, accent });
    const calls = { stroke: [], fill: [], stops: [], strokeW: [], translate: [] };
    // v1.5.1：车削三描边用到 save / translate / restore（Canvas 2D 官方 API），
    // 假 ctx 必须一并提供，否则测不到真实绘制路径。
    const ctx = {
      strokeStyle: '', fillStyle: '', lineWidth: 0, lineJoin: '', lineCap: '', font: '', textAlign: '', textBaseline: '',
      clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {},
      save() {}, restore() {},
      translate(x, y) { calls.translate.push([x, y]); },
      fill() { calls.fill.push(this.fillStyle); },
      stroke() { calls.stroke.push(this.strokeStyle); calls.strokeW.push(this.lineWidth); },
      fillText() {},
      createLinearGradient() {
        return { addColorStop(pos, color) { calls.stops.push(color); } };
      },
    };
    const d = { ready: true, tipShow: false };
    const inst = {
      data: d,
      setData(p) { Object.assign(d, p); },
      _ctx: ctx,
      _size: { w: 320, h: 180 },
      _points: [{ date: '2026-11-01', day: 1, valueCents: 30000 }, { date: '2026-11-02', day: 2, valueCents: 15000 }],
    };
    inst.data = Object.assign({}, d, { billId: 'x' });
    Object.keys(curveDef.methods).forEach((k) => { inst[k] = curveDef.methods[k].bind(inst); });
    // getPoints 用预置点，避免依赖 store
    inst.getPoints = () => inst._points;
    inst.draw();
    return calls;
  }
  ['indigo', 'teal', 'amber', 'rose'].forEach((a) => {
    ['dark', 'light'].forEach((m) => {
      const colors = drawColors(a, m);
      const primary = theme.getAccentPalette().primary;
      const rgb = [1, 3, 5].map((i) => parseInt(primary.slice(i, i + 2), 16)).join(',');
      assert(colors.stroke.indexOf(primary) >= 0, 'ACCENT-13d 日价曲线折线用主题色 ' + a + '/' + m + '（实测 ' + colors.stroke.join('|') + '）');
      const areaHit = colors.stops.concat(colors.fill).some((f) => String(f).indexOf(rgb) >= 0);
      assert(areaHit, 'ACCENT-13d 日价曲线面积/高亮点用主题色 rgb(' + rgb + ') ' + a + '/' + m + '（实测 ' + colors.stops.concat(colors.fill).join('|') + '）');
      // v1.5.1 车削三描边：暗缘 > 本体 > 高光 的线宽关系（规则，不是死值）
      const strokes = colors.stroke.map((s, i) => ({ s, w: colors.strokeW[i] })).filter((x) => x.w >= 0.5);
      const rim = strokes.find((x) => x.w > 3);
      const spec = strokes.find((x) => x.w < 1.2);
      assert(rim && spec, 'ACCENT-13e 日价曲线有暗缘（宽 >3）与高光（宽 <1.2）两道描边 ' + a + '/' + m +
        '（实测宽度 ' + colors.strokeW.join('|') + '）');
      assert(colors.translate.some((t) => t[1] < 0), 'ACCENT-13e 高光整体上移（translate 的 y 为负）' + a + '/' + m);
    });
  });

  /* ---- 汇总 ---- */
  console.log('\ntheme tests: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
  console.log('ALL THEME TESTS PASSED');
}

run().catch((e) => {
  console.error('测试异常', e);
  process.exit(1);
});
