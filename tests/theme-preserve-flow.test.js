/**
 * tests/theme-preserve-flow.test.js — v1.3.4 Final Closure P1
 *
 * 验证「一次性、可消费、可取消的主题保留标记」在真实页面时序下的行为，
 * 不是孤立测两个计数器，而是按用户真实操作逐步驱动 theme + 数据层：
 *
 *   时序 1：纯主题切换 → 返回主页，圆环展开/选中态保持（preserve=true），且只消费一次；
 *   时序 2：切主题 → 备份恢复（不同账单+主题）→ 返回主页，统计必须完整刷新（preserve=false）；
 *   时序 3：切主题 → 分类/周期/预算/导入等非主题页 → 返回主页，不跳过必要刷新（preserve=false）。
 *
 * 主页 onShow 的消费调用与 pages/main/main.js 完全一致（theme.consumeThemePreserve）；
 * 设置页非主题入口的取消调用与 pages/settings/settings.js 完全一致（theme.cancelThemePreserve）。
 *
 * 运行：node tests/theme-preserve-flow.test.js
 */
const path = require('path');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) {
  assert(a === b, msg + '（期望 ' + b + '，实际 ' + a + ')');
}

/* ---------- 完整内存文件系统 ---------- */
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
      if (!memFiles.has(p)) throw new Error('ENOENT ' + p);
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
      memDirs.forEach((d) => {
        if (d.startsWith(prefix)) {
          const rest = d.slice(prefix.length);
          if (rest && !rest.includes('/')) out.add(rest);
        }
      });
      return [...out];
    },
    statSync(p) {
      const isDir = memDirs.has(p);
      const isFile = memFiles.has(p);
      if (!isDir && !isFile) throw new Error('ENOENT ' + p);
      return { isDirectory: () => isDir, isFile: () => isFile };
    },
  };
  return {
    setWx() {
      global.wx = { env: { USER_DATA_PATH: '/usr' }, getFileSystemManager: () => fsm };
    },
  };
}

buildWx().setWx();

const ROOT = path.join(__dirname, '..');
const store = require(path.join(ROOT, 'data', 'index'));
const theme = require(path.join(ROOT, 'utils', 'theme'));
const M = require(path.join(ROOT, 'data', 'statistics', 'month'));

/**
 * 主页协调器替身：onShow 与 pages/main/main.js 的消费逻辑逐字一致，
 * 记录每次回主页得到的 preserveStatistics。
 */
function createMainPage() {
  const record = [];
  return {
    onShow() {
      const preserveStatistics = theme.consumeThemePreserve();
      record.push(preserveStatistics);
      return preserveStatistics;
    },
    record,
  };
}

/**
 * 设置页导航替身：与 pages/settings/settings.js 各入口的取消调用一致。
 * 进入外观页（主题操作）不取消；进入任何非主题页都取消。
 */
function enterAppearance() { /* 主题入口：不取消标记 */ }
function enterNonThemePage() { theme.cancelThemePreserve(); }

store.init();
theme._resetForTest();
theme.init();

/* ==================== 时序 1：纯主题切换，返回主页状态保持且只消费一次 ==================== */
(function () {
  const main = createMainPage();

  // 首次进入主页：无标记 → 完整刷新
  eq(main.onShow(), false, 'T1 初始进入主页无保留标记');
  eq(theme.hasThemePreserve(), false, 'T1 消费后无待处理标记');

  // 主页 → 设置 → 外观（主题入口，不取消），用户主动切浅色
  enterAppearance();
  const r = theme.setThemeMode('light');
  eq(r.ok, true, 'T1 主动切浅色成功');
  eq(theme.hasThemePreserve(), true, 'T1 切主题后建立一次性保留标记');

  // 返回设置（settings.onShow 不取消）→ 返回主页：消费标记，保留圆环展开/选中
  eq(main.onShow(), true, 'T1 纯主题返回主页 preserve=true（圆环状态保持）');
  eq(theme.hasThemePreserve(), false, 'T1 标记消费后立即清零');

  // 再次回前台（无新操作）：标记已消费，不会残留误判
  eq(main.onShow(), false, 'T1 纯主题事件只消费一次，后续回主页不再 preserve');
  eq(main.record.join(','), 'false,true,false', 'T1 主页 preserve 时序正确');
})();

/* ==================== 时序 2：切主题 → 备份恢复（不同账单+主题）→ 返回主页完整刷新 ==================== */
(function () {
  const main = createMainPage();

  // 旧账本：10 月两笔深色账单
  const oldTs = new Date(2026, 9, 10, 12).getTime();
  store.addBill({ type: 'expense', amountCents: 10000, categoryId: 'c-food', occurredAt: oldTs });
  store.addBill({ type: 'expense', amountCents: 5000, categoryId: 'c-transport', occurredAt: oldTs });
  eq(M.computeMonthOverview(store.rangeBills('2026-10', '2026-10')).expense, 15000, 'T2 旧账本 10 月支出 15000');

  // 用户在外观页切主题（此时仍是深色账本，仅主题变化）→ 建立标记
  enterAppearance();
  theme.setThemeMode('dark'); // 已为 dark，同模式不变化、不标记；先切到 light 制造真实变化
  theme.setThemeMode('light');
  eq(theme.hasThemePreserve(), true, 'T2 切主题后建立保留标记');

  // 返回设置 → 进入备份恢复（非主题入口：取消标记）
  enterNonThemePage();
  eq(theme.hasThemePreserve(), false, 'T2 进入备份恢复页即取消保留标记');

  // 恢复一份「主题不同、账单不同」的浅色备份
  const sepTs = new Date(2026, 8, 10, 12).getTime();
  const octTs = new Date(2026, 9, 12, 12).getTime();
  const backup = {
    format: 'daily-value-mini-backup',
    schemaVersion: 3,
    appVersion: '1.3.4',
    exportedAt: '2026-10-20T00:00:00.000Z',
    data: {
      bills: [
        { id: 'n1', type: 'expense', amountCents: 20000, categoryId: 'c-life', occurredAt: sepTs, title: '', ledgerImpact: 'normal' },
        { id: 'n2', type: 'expense', amountCents: 30000, categoryId: 'c-food', occurredAt: octTs, title: '', ledgerImpact: 'normal' },
      ],
      categories: [
        { id: 'c-food', name: '餐饮', emoji: '🍚', builtin: true, sort: 1, archived: false },
        { id: 'c-life', name: '生活', emoji: '🧴', builtin: true, sort: 2, archived: false },
      ],
      settings: { currency: '¥', theme: 'light' },
      recurringRules: [],
    },
  };
  store.restoreBackup(backup); // 内部 reloadFromStorage 再次取消标记
  eq(theme.hasThemePreserve(), false, 'T2 restoreBackup→reloadFromStorage 后标记仍取消');
  eq(theme.getEffectiveTheme(), 'light', 'T2 恢复后主题为 light');

  // 返回设置 → 返回主页：消费得到 false，统计完整刷新
  eq(main.onShow(), false, 'T2 备份恢复后返回主页 preserve=false（统计完整刷新）');

  // 取数口径与 statistics-panel 一致：现取账单现算，验证是新账本而非旧账本
  const oct = M.computeMonthOverview(store.rangeBills('2026-10', '2026-10'));
  eq(oct.expense, 30000, 'T2 10 月统计刷新为新账本 30000（非旧 15000）');
  eq(oct.count, 1, 'T2 10 月为新账本 1 笔');
  const sep = M.computeMonthOverview(store.rangeBills('2026-09', '2026-09'));
  eq(sep.expense, 20000, 'T2 新账本 9 月支出 20000');
})();

/* ==================== 时序 3：切主题 → 分类/周期/预算/导入等非主题页 → 返回主页不跳过刷新 ==================== */
(function () {
  const nonThemePages = ['分类管理', '周期记账', '预算设置', '数据导入'];
  nonThemePages.forEach((name) => {
    // 每个非主题页都先制造一次真实主题切换，建立标记
    theme.setThemeMode(theme.getThemeMode() === 'light' ? 'dark' : 'light');
    eq(theme.hasThemePreserve(), true, 'T3 进入「' + name + '」前已建立主题标记');

    // 进入该非主题页（对应 settings 导航）：取消标记
    enterNonThemePage();
    eq(theme.hasThemePreserve(), false, 'T3 进入「' + name + '」取消主题标记');

    // 返回主页：消费得到 false，不跳过必要刷新
    const main = createMainPage();
    eq(main.onShow(), false, 'T3 从「' + name + '」返回主页 preserve=false');
  });
})();

/* ==================== 附加：取消后重新切主题可再次建立；标记不累积 ==================== */
(function () {
  theme._resetForTest();
  theme.init();
  const startMode = theme.getThemeMode();
  const otherMode = startMode === 'light' ? 'dark' : 'light';
  theme.setThemeMode(otherMode);
  eq(theme.hasThemePreserve(), true, 'T4 切主题建立标记');
  theme.cancelThemePreserve();
  eq(theme.hasThemePreserve(), false, 'T4 取消后标记清除');
  theme.setThemeMode(startMode);
  eq(theme.hasThemePreserve(), true, 'T4 取消后重新切主题可再次建立标记');
  // 重复 mark 不累积，consume 一次即清零
  theme.markThemePreserve();
  theme.markThemePreserve();
  eq(theme.consumeThemePreserve(), true, 'T4 多次 mark 仍是一次待消费事件');
  eq(theme.consumeThemePreserve(), false, 'T4 第二次 consume 已无标记（不累积）');
})();

/* ---------- 汇总 ---------- */
console.log('\ntheme-preserve-flow tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL THEME PRESERVE FLOW TESTS PASSED');
