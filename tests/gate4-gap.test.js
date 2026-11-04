/**
 * tests/gate4-gap.test.js — v1.4.0 Gate 4 核心业务 / 数据安全「缺口补测」
 *
 * 只补既有 42 个套件没覆盖到的缺口，不重复已有断言：
 *   G1 金额精度（checklist 1「金额精度」）
 *      - 分口径：浮点 0.1+0.2、100×0.01 累加无漂移、超大额、格式化负数
 *      - 非法 / 半成品输入的实际口径（记录行为，供人工判定）
 *      - 表单层：粘贴三位小数被夹取到两位，不静默截断入库
 *   G2 重开应用后持久化 + 编辑/删除后统计同步（checklist 1）
 *      - 清模块缓存重建 store 实例（等价冷启动）读回账单
 *      - 编辑金额 / 跨月移动 / 删除后，月度统计与账本一致
 *   G3 周期重启后 catch-up（checklist 3「重启后周期检查」）
 *      - 冷启动后补齐到期账单且与重启前一致（幂等、不重复）
 *   G4 数据合同冻结（checklist 9）
 *      - Bill V3 / Backup V3 / Recurring Store V1 / Budget V1 / Statistics V1
 *        常量与关键结构字段集合
 *   G5 release 下测试注入不可达（数据安全 8 项之 1）
 *      - pages/main/main.js 五个 __* 入口的静态守卫契约（守卫在 require 测试模块之前）
 *
 * 运行：node tests/gate4-gap.test.js
 */
'use strict';

const path = require('path');
const fsNode = require('fs');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.error('  FAIL: ' + msg);
  }
}
function eq(actual, expected, msg) {
  assert(actual === expected, msg + '（期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual) + '）');
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fsNode.readFileSync(path.join(ROOT, rel), 'utf8');

/* ============================================================
 * 内存 wx 文件系统（与 tests/data.test.js 同构，仅覆盖本次需要的能力）
 * ============================================================ */
function buildWx(initialStorage) {
  const memFiles = new Map();
  const memDirs = new Set();
  const storage = Object.assign({}, initialStorage || {});

  const fsm = {
    accessSync(p) {
      if (memFiles.has(p) || memDirs.has(p)) return;
      throw new Error('ENOENT ' + p);
    },
    mkdirSync(p, recursive) {
      if (recursive) {
        const parts = p.split('/');
        let cur = '';
        parts.forEach((seg, i) => {
          if (i === 0 && seg === '') cur = '';
          else { cur = cur + '/' + seg; memDirs.add(cur); }
        });
      } else {
        memDirs.add(p);
      }
    },
    readFileSync(p) {
      if (!memFiles.has(p)) throw new Error('ENOENT file ' + p);
      return memFiles.get(p);
    },
    writeFileSync(p, data) {
      memFiles.set(p, String(data));
    },
    unlinkSync(p) {
      if (!memFiles.has(p)) throw new Error('ENOENT file ' + p);
      memFiles.delete(p);
    },
    renameSync(from, to) {
      if (!memFiles.has(from)) throw new Error('ENOENT file ' + from);
      if (memFiles.has(to)) throw new Error('file already exists ' + to);
      memFiles.set(to, memFiles.get(from));
      memFiles.delete(from);
    },
    readdirSync(p) {
      const prefix = p.endsWith('/') ? p : p + '/';
      const out = new Set();
      memFiles.forEach((v, k) => {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          if (rest && rest.indexOf('/') < 0) out.add(rest);
        }
      });
      memDirs.forEach((d) => {
        if (d.startsWith(prefix)) {
          const rest = d.slice(prefix.length);
          if (rest && rest.indexOf('/') < 0) out.add(rest);
        }
      });
      return [...out];
    },
  };

  return {
    env: { USER_DATA_PATH: '/usr' },
    getFileSystemManager: () => fsm,
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => { storage[k] = v; },
    hideKeyboard(opts) { if (opts && typeof opts.complete === 'function') opts.complete(); },
    showModal(opts) { if (opts && typeof opts.success === 'function') opts.success({ confirm: false, cancel: true }); },
    showToast() {},
    navigateBack() {},
    __memFiles: memFiles,
    __storage: storage,
  };
}

/** 清掉 data 层模块缓存并重新 require —— 等价「杀掉小程序再冷启动」 */
function loadStore(wx) {
  global.wx = wx;
  Object.keys(require.cache).forEach((k) => {
    if (k.replace(/\\/g, '/').indexOf('/jizhang-mini/data/') >= 0) delete require.cache[k];
  });
  return require(path.join(ROOT, 'data', 'index'));
}

function at(y, m, d, hh, mm) {
  return new Date(y, m - 1, d, hh == null ? 12 : hh, mm || 0, 0, 0);
}

/* ============================================================
 * G1 金额精度（纯函数口径）
 * ============================================================ */
console.log('G1 金额精度：分口径');
const money = require(path.join(ROOT, 'data', 'money'));
{
  // 浮点累加不产生分位漂移
  eq(money.parseAmountToCents(0.1 + 0.2), 30, 'G1 0.1+0.2 → 30 分（无 0.30000000000000004 漂移）');
  eq(money.yuanToCents(0.1 + 0.2), 30, 'G1 yuanToCents(0.1+0.2) → 30 分');

  let sum = 0;
  for (let i = 0; i < 100; i += 1) sum += money.parseAmountToCents(0.01);
  eq(sum, 100, 'G1 100 笔 ¥0.01 累加 = 100 分（不出现 99/101）');

  // 字符串输入的常见形态
  eq(money.parseAmountToCents('25.8'), 2580, 'G1 "25.8" → 2580 分（补零）');
  eq(money.parseAmountToCents(' 25.5 '), 2550, 'G1 前后空格被忽略');
  eq(money.parseAmountToCents('.5'), 50, 'G1 ".5" → 50 分（缺整数位）');
  eq(money.parseAmountToCents('5.'), 500, 'G1 "5." → 500 分（缺小数位）');
  eq(money.parseAmountToCents('0'), 0, 'G1 "0" → 0 分');
  eq(money.parseAmountToCents('¥-12.30'), -1230, 'G1 "¥-12.30" → -1230 分');

  // 极端数值：不溢出、不丢精度
  eq(money.parseAmountToCents('99999999.99'), 9999999999, 'G1 99999999.99 → 9999999999 分（无精度丢失）');
  assert(Number.isSafeInteger(money.parseAmountToCents('99999999.99')), 'G1 超大额仍是安全整数（未超 Number.MAX_SAFE_INTEGER）');

  // 格式化
  eq(money.formatCents(0), '0.00', 'G1 formatCents(0) → 0.00');
  eq(money.formatCents(-1230), '-12.30', 'G1 formatCents(-1230) → -12.30（负号在前）');
  eq(money.formatCents(999999999), '9,999,999.99', 'G1 千分位格式');
  eq(money.parseAmountToCents(money.formatCents(123456)), 123456, 'G1 格式化 → 再次解析可逆（编辑回填安全）');

  // 非法 / 半成品输入的**实际口径**（记录，不判缺陷：UI 层 canSubmit 拦截 0）
  eq(money.parseAmountToCents(''), 0, 'G1 空串 → 0 分（由 canSubmit 拦截，不入库）');
  eq(money.parseAmountToCents('abc'), 0, 'G1 纯非数字 → 0 分（同上）');
  eq(money.parseAmountToCents('-0.00'), 0, 'G1 "-0.00" → 0 分（不产生 -0）');
  // 记录口径：三位小数截断到两位（不是四舍五入）；表单层另有夹取，见 G2
  eq(money.parseAmountToCents('25.999'), 2599, 'G1 三位小数口径=截断（25.999→2599，非 2600）');
  // 记录口径：科学计数法只取首位数字
  eq(money.parseAmountToCents('1e3'), 100, 'G1 "1e3" 实际解析=100 分（只取 "1"，属非法输入口径）');
}

/* ============================================================
 * G1b 表单层：粘贴三位小数被夹取到两位，不静默入库
 * ============================================================ */
console.log('G1b 表单金额夹取（bill-form）');
{
  const fakeStore = {
    getActiveCategories() { return [{ id: 'c-food', name: '餐饮', sort: 1 }]; },
    getCategory(id) { return { id: id || 'c-food', name: '餐饮', sort: 1, emoji: '🍚' }; },
    addBill() { return { id: 'x' }; },
    updateBill() {},
    deleteBill() {},
    getBill() { return null; },
    getCategoryResolver() { return () => ({ name: '餐饮', emoji: '🍚' }); },
  };
  const storePath = require.resolve(path.join(ROOT, 'data', 'index.js'));
  const savedCache = require.cache[storePath];
  require.cache[storePath] = {
    id: storePath, filename: storePath, loaded: true, exports: fakeStore,
  };

  let captured = null;
  const savedComponent = global.Component;
  global.Component = (def) => { captured = def; };
  global.wx = buildWx();
  require(path.join(ROOT, 'components', 'bill-form', 'bill-form.js'));
  global.Component = savedComponent;
  require.cache[storePath] = savedCache;

  const def = captured;
  const inst = {
    data: JSON.parse(JSON.stringify(def.data || {})),
    setData(patch) { Object.keys(patch).forEach((k) => { inst.data[k] = patch[k]; }); },
    triggerEvent() {},
  };
  Object.keys(def.methods).forEach((k) => {
    if (typeof def.methods[k] === 'function') inst[k] = def.methods[k].bind(inst);
  });

  inst.applyAmount('25.999');
  eq(inst.data.amountText, '25.99', 'G1b 粘贴 25.999 → 夹取为 25.99（第 3 位小数不进表单）');
  eq(inst.data.canSubmit, true, 'G1b 夹取后 canSubmit=true');

  inst.applyAmount('0.005');
  eq(inst.data.amountText, '0.00', 'G1b 0.005 → 0.00（第三位被夹掉，不四舍五入进位）');
  eq(inst.data.canSubmit, false, 'G1b 0.00 视为空金额，canSubmit=false（不可提交 0 元）');

  inst.applyAmount('');
  eq(inst.data.canSubmit, false, 'G1b 清空金额 → canSubmit=false');

  inst.applyAmount('1,234.56');
  eq(inst.data.amountText, '1,234.56', 'G1b 千分位回填不被误夹取');
  eq(inst.data.canSubmit, true, 'G1b 千分位回填 canSubmit=true');
}

/* ============================================================
 * G2 重开应用后持久化 + 编辑/删除后统计同步
 * ============================================================ */
console.log('G2 冷启动持久化与统计同步');
{
  const wx = buildWx();
  let store = loadStore(wx);
  store.init();

  const e1 = store.addBill({
    type: 'expense', amountCents: 2550, categoryId: 'c-food',
    merchant: '瑞幸', note: '拿铁', occurredAt: at(2026, 10, 15, 9).getTime(),
  });
  const e2 = store.addBill({
    type: 'expense', amountCents: 1200, categoryId: 'c-transport',
    occurredAt: at(2026, 10, 16, 8).getTime(),
  });
  const i1 = store.addBill({
    type: 'income', amountCents: 100000, categoryId: 'c-salary',
    occurredAt: at(2026, 10, 15, 10).getTime(),
  });

  const before = store.monthSummary('2026-10');
  eq(before.expense, 3750, 'G2 冷启动前 10 月支出 3750 分');
  eq(before.income, 100000, 'G2 冷启动前 10 月收入 100000 分');
  eq(before.count, 3, 'G2 冷启动前 10 月 3 笔');

  /* --- 冷启动：清模块缓存，用同一份文件系统重建 store --- */
  store = loadStore(wx);
  const status = store.init();
  eq(status.ok !== false, true, 'G2 冷启动 init 未进入保护模式');
  const reopened = store.monthSummary('2026-10');
  eq(reopened.expense, 3750, 'G2 冷启动后支出仍为 3750（持久化）');
  eq(reopened.income, 100000, 'G2 冷启动后收入仍为 100000');
  eq(reopened.count, 3, 'G2 冷启动后仍 3 笔（无重复写入）');
  eq(store.monthGrouped('2026-10').length, 2, 'G2 冷启动后分组天数仍为 2 天');

  /* --- 编辑金额 → 月度统计同步 --- */
  store.updateBill(e1.id, { amountCents: 3000 });
  const afterEdit = store.monthSummary('2026-10');
  eq(afterEdit.expense, 4200, 'G2 编辑 25.50→30.00 后月支出 4200（同步重算）');
  eq(afterEdit.count, 3, 'G2 编辑不新增条数');

  /* --- 跨月移动 → 两个月统计同步 --- */
  store.updateBill(e2.id, { occurredAt: at(2026, 9, 20, 8).getTime() });
  eq(store.monthSummary('2026-10').expense, 3000, 'G2 跨月移动后 10 月支出降为 3000');
  eq(store.monthSummary('2026-09').expense, 1200, 'G2 跨月移动后 9 月支出为 1200');
  eq(store.monthGrouped('2026-10').length, 1, 'G2 10 月分组天数降为 1');

  /* --- 删除 → 统计同步，且冷启动后仍不存在 --- */
  store.deleteBill(i1.id);
  const afterDel = store.monthSummary('2026-10');
  eq(afterDel.income, 0, 'G2 删除收入后 10 月收入 0');
  eq(afterDel.count, 1, 'G2 删除后 10 月 1 笔');

  store = loadStore(wx);
  store.init();
  eq(store.monthSummary('2026-10').count, 1, 'G2 删除结果已落盘（冷启动后仍 1 笔）');
  eq(store.monthSummary('2026-10').income, 0, 'G2 删除结果已落盘（收入 0）');
  eq(store.monthSummary('2026-09').expense, 1200, 'G2 跨月移动结果已落盘');
  eq(store.getBill(e1.id).amountCents, 3000, 'G2 编辑结果已落盘（3000 分）');
}

/* ============================================================
 * G3 周期重启后 catch-up（补齐 + 幂等）
 * ============================================================ */
console.log('G3 周期重启后 catch-up');
{
  const wx = buildWx();
  let store = loadStore(wx);
  store.init();

  const rule = store.recurring.createRule({
    type: 'expense', amountCents: 1000, categoryId: 'c-food', note: '早餐',
    frequency: 'daily', interval: 1, day: 1, startDate: '2026-10-01', time: '00:00',
  });

  const r1 = store.recurring.generateDueBills(at(2026, 10, 10, 12));
  eq(r1.totalGenerated, 10, 'G3 首次生成 10-01~10-10 共 10 笔');
  eq(r1.failedRules, 0, 'G3 首次生成无失败规则');
  eq(store.monthSummary('2026-10').count, 10, 'G3 账本 10 笔');

  /* --- 冷启动（用户关掉小程序几天后再打开）--- */
  store = loadStore(wx);
  store.init();
  const r2 = store.recurring.generateDueBills(at(2026, 10, 13, 12));
  eq(r2.totalGenerated, 3, 'G3 重启后补齐 10-11~10-13 共 3 笔（catch-up）');
  eq(store.monthSummary('2026-10').count, 13, 'G3 补齐后账本 13 笔');
  eq(store.monthSummary('2026-10').expense, 13000, 'G3 补齐后 10 月支出 13000 分');

  /* --- 同一天再次 onShow（重复触发）不得重复生成 --- */
  const r3 = store.recurring.generateDueBills(at(2026, 10, 13, 18));
  eq(r3.totalGenerated, 0, 'G3 同日重复触发生成 0 笔（幂等）');
  eq(store.monthSummary('2026-10').count, 13, 'G3 重复触发后仍 13 笔');

  /* --- 再冷启动一次，仍不重复 --- */
  store = loadStore(wx);
  store.init();
  const r4 = store.recurring.generateDueBills(at(2026, 10, 13, 20));
  eq(r4.totalGenerated, 0, 'G3 二次冷启动后重复触发仍 0 笔');
  eq(store.monthSummary('2026-10').count, 13, 'G3 二次冷启动后仍 13 笔');

  /* --- 规则与生成账单的绑定关系在冷启动后仍成立 --- */
  const bills = store.rangeBills('2026-10', '2026-10');
  const recurringBills = bills.filter((b) => b.recurringRuleId === rule.id);
  eq(recurringBills.length, 13, 'G3 13 笔均带 recurringRuleId=规则 id');
  const asc = recurringBills.slice().sort((a, b) => a.occurredAt - b.occurredAt);
  eq(asc[0].occurredAt < asc[12].occurredAt, true, 'G3 冷启动后账单时间跨 10 天（首末不同日）');
  eq(store.recurring.getRule(rule.id).lastGeneratedDate, '2026-10-13', 'G3 游标推进到 2026-10-13 且已落盘');
}

/* ============================================================
 * G1c 记账表单：分类切换 / 收支切换 / 日价开关联动 / 提交载荷
 * （checklist 1「分类切换」「商户备注」与 checklist 2「业务边界」此前无用例）
 * ============================================================ */
console.log('G1c 表单分类切换与提交载荷');
{
  const added = [];
  const updated = [];
  const catActive = [
    { id: 'c-food', name: '餐饮', sort: 1, emoji: '🍚' },
    { id: 'c-salary', name: '工资', sort: 2, emoji: '💰' },
    { id: 'c-transport', name: '交通', sort: 3, emoji: '🚌' },
  ];
  const fakeStore = {
    getActiveCategories() { return catActive; },
    getCategory(id) { return catActive.find((c) => c.id === id) || { id: id, name: '归档类', emoji: '📦' }; },
    rangeBills() { return []; },
    getBill() { return null; },
    getCategoryResolver() { return (id) => ({ name: id, emoji: '🍚' }); },
    addBill(payload) { added.push(payload); return { id: 'new-1' }; },
    updateBill(id, payload) { updated.push({ id: id, payload: payload }); },
    deleteBill() {},
  };
  const storePath = require.resolve(path.join(ROOT, 'data', 'index.js'));
  const savedCache = require.cache[storePath];
  require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeStore };
  let captured = null;
  const savedComponent = global.Component;
  global.Component = (def) => { captured = def; };
  global.wx = buildWx();
  // bill-form 在 G1b 已加载过，必须清缓存才能重新捕获定义
  delete require.cache[require.resolve(path.join(ROOT, 'components', 'bill-form', 'bill-form.js'))];
  require(path.join(ROOT, 'components', 'bill-form', 'bill-form.js'));
  global.Component = savedComponent;
  require.cache[storePath] = savedCache;

  const def = captured;
  function makeInst() {
    const inst = {
      data: JSON.parse(JSON.stringify(def.data || {})),
      events: [],
      setData(patch) { Object.keys(patch).forEach((k) => { inst.data[k] = patch[k]; }); },
      triggerEvent(name, detail) { inst.events.push({ name: name, detail: detail }); },
    };
    Object.keys(def.methods).forEach((k) => {
      if (typeof def.methods[k] === 'function') inst[k] = def.methods[k].bind(inst);
    });
    return inst;
  }

  const inst = makeInst();
  inst.data.todayStr = '2026-11-04';
  inst.data.dateStr = '2026-11-04';

  // 分类切换：点非默认分类后立即生效，并进提交载荷
  inst.onCategory({ currentTarget: { dataset: { id: 'c-transport' } } });
  eq(inst.data.categoryId, 'c-transport', 'G1c 点选「交通」后 categoryId 切换');
  eq(inst.data.showAllCats, false, 'G1c 初始未展开全部分类');
  inst.onShowAllCats();
  eq(inst.data.showAllCats, true, 'G1c 点「全部分类」后展开');

  // 收支切换：分类表全项目通用（getActiveCategories 不分收支），已选中分类保留；
  // 切收入时「计算日价」强制关闭（日价只对支出物品有意义）。
  inst.data.dailyValueEnabled = true;
  inst.onType({ currentTarget: { dataset: { type: 'income' } } });
  eq(inst.data.type, 'income', 'G1c 切到收入');
  eq(inst.data.categoryId, 'c-transport', 'G1c 切收入时已选分类保留（分类表收支通用）');
  eq(inst.data.dailyValueEnabled, false, 'G1c 切收入时关闭「计算日价」开关');

  // 兜底：当前分类不在可选列表（如已被归档且非本次引用）→ 回落到该类型默认分类
  inst.data.categoryId = 'c-not-in-list';
  inst.onType({ currentTarget: { dataset: { type: 'expense' } } });
  eq(inst.data.type, 'expense', 'G1c 切回支出');
  eq(inst.data.categoryId, 'c-food', 'G1c 无效分类 → 回落支出默认（餐饮）');

  // 提交载荷：分类 / 商户备注 trim / 日价关闭时不带 dailyValue
  inst.data.amountText = '38.50';
  inst.data.canSubmit = true;
  inst.data.categoryId = 'c-transport';
  inst.data.merchant = '  虚构商户  ';
  inst.data.note = '  虚构备注  ';
  inst.data.dailyValueEnabled = false;
  inst.onSubmit();
  eq(added.length, 1, 'G1c 提交一次落库一次');
  const p1 = added[0];
  eq(p1.amountCents, 3850, 'G1c 载荷金额 3850 分');
  eq(p1.categoryId, 'c-transport', 'G1c 载荷分类=所选交通');
  eq(p1.merchant, '虚构商户', 'G1c 商户首尾空格被 trim');
  eq(p1.note, '虚构备注', 'G1c 备注首尾空格被 trim');
  eq(p1.dailyValue, undefined, 'G1c 日价关闭时不写 dailyValue');
  eq(p1.type, 'expense', 'G1c 载荷类型=expense');

  // 业务边界：开启「计算日价」的支出仍然是普通账单（进账），不是 daily-value-only
  const inst2 = makeInst();
  inst2.data.todayStr = '2026-11-04';
  inst2.data.dateStr = '2026-11-04';
  inst2.data.amountText = '12.00';
  inst2.data.canSubmit = true;
  inst2.data.dailyValueEnabled = true;
  inst2.onSubmit();
  const p2 = added[1];
  eq(!!p2.dailyValue && p2.dailyValue.enabled, true, 'G1c 开启日价 → 载荷带 dailyValue.enabled');
  eq(p2.dailyValue.startDate, '2026-11-04', 'G1c 日价起算日=账单日期');
  eq(p2.ledgerImpact, undefined, 'G1c 载荷不传 ledgerImpact（由数据层默认 normal → 仍进普通账本）');
  const ledgerMod = require(path.join(ROOT, 'data', 'ledger.js'));
  eq(ledgerMod.normalizeLedgerImpact(p2.ledgerImpact), 'normal', 'G1c 日价-enabled 账单账务口径=normal（进账，符合设计）');
  eq(ledgerMod.normalizeLedgerImpact('daily-value-only'), 'daily-value-only', 'G1c 仅日价账单口径=daily-value-only（不进账）');
}


/* ============================================================
 * G3b 导入中断：目标月份损坏 → 整批中止 + 回滚，原账本不变
 * （checklist 6「中断与异常输入」；commit.js 先预检再写，回滚走 backup.rollback）
 * ============================================================ */
console.log('G3b 导入中断与回滚');
{
  const wx = buildWx();
  let store = loadStore(wx);
  store.init();

  // 既有账本：2026-09 一笔（这是「真实数据」，回滚后必须逐字节不变）
  store.addBill({
    type: 'expense', amountCents: 1200, categoryId: 'c-transport',
    note: '既有账单', occurredAt: at(2026, 9, 20, 8).getTime(),
  });
  const sepBefore = wx.__memFiles.get('/usr/bills/2026-09.json');
  eq(typeof sepBefore, 'string', 'G3b 2026-09 分片已生成');
  eq(store.monthSummary('2026-09').count, 1, 'G3b 既有 9 月 1 笔');

  // 目标月 2026-11 人为损坏（模拟「用户账单文件被外部工具写坏」）
  const CORRUPT = '{这不是合法JSON';
  wx.__memFiles.set('/usr/bills/2026-11.json', CORRUPT);

  // 清 commit 缓存，确保它用的是本次 loadStore 的 data 模块实例
  const commitPath = require.resolve(path.join(ROOT, 'packages', 'importer', 'core', 'commit.js'));
  delete require.cache[commitPath];
  const commit = require(commitPath);

  const session = {
    bills: [{
      status: 'ready', type: 'expense', amountCents: 500, categoryId: 'c-food',
      occurredAt: at(2026, 11, 5, 12).getTime(), title: '', merchant: '虚构商户', note: '虚构备注',
    }],
  };

  let threw = null;
  try {
    commit.commitImport(session);
  } catch (e) {
    threw = e;
  }
  assert(!!threw, 'G3b 目标月损坏时整批中止并抛错（不静默成功）');
  assert(!!threw && /MONTH_/.test(String(threw.message)), 'G3b 抛错带 MONTH_* 错误码，实际：' + (threw && threw.message));

  // 回滚断言：既有账本逐字节不变、没有半截账单落库
  eq(wx.__memFiles.get('/usr/bills/2026-09.json'), sepBefore, 'G3b 2026-09 分片逐字节不变（回滚成功）');
  // 【已知缺陷 QA-04 · 当前行为固化】rollback() 先删全部月份分片再按安全点重写，
  // 而安全点来自 rangeBills()（损坏月读成空），因此损坏月的**原始字节被删除**，
  // data/protection.js 的 buildRawExport() 抢救材料随之丢失。
  // 修复后本断言应改为：损坏分片原始字节仍存在（或已转存到隔离目录）。
  eq(wx.__memFiles.get('/usr/bills/2026-11.json'), undefined,
    'G3b【已知缺陷 QA-04，当前行为】回滚后损坏分片原始字节被删除（未被隔离保留）');
  eq(store.monthSummary('2026-09').count, 1, 'G3b 回滚后 9 月仍 1 笔');
  eq(store.rangeBills().length, 1, 'G3b 全库仍 1 笔（无半截导入账单）');

  // 安全点快照存在（回滚依据），且恢复后可正常再导入
  eq(wx.__memFiles.has('/usr/legacy/restore-safety.json') || store.rangeBills().length === 1, true,
    'G3b 回滚后账本处于一致状态');
  wx.__memFiles.delete('/usr/bills/2026-11.json');
  const ok = commit.commitImport(session);
  eq(ok.imported, 1, 'G3b 修复损坏月后同一批可正常导入（回滚未留下坏状态）');
  eq(store.monthSummary('2026-11').count, 1, 'G3b 正常导入后 11 月 1 笔');
}

/* ============================================================
 * G4 数据合同冻结
 * ============================================================ */console.log('G4 数据合同冻结');
{
  const ledger = require(path.join(ROOT, 'data', 'ledger.js'));
  const manifest = require(path.join(ROOT, 'data', 'manifest.js'));
  const backup = require(path.join(ROOT, 'data', 'backup.js'));
  const validator = require(path.join(ROOT, 'data', 'backup-validator.js'));
  const migV2 = require(path.join(ROOT, 'data', 'migration-schema.js'));
  const migV3 = require(path.join(ROOT, 'data', 'migration-schema-v3.js'));
  const statCfg = require(path.join(ROOT, 'data', 'statistics', 'config.js'));
  const health = require(path.join(ROOT, 'data', 'health.js'));

  eq(ledger.SCHEMA_VERSION, 3, 'G4 Bill 分片版本冻结在 V3');
  eq(manifest.SCHEMA_VERSION, 3, 'G4 Manifest 版本冻结在 V3');
  eq(backup.SCHEMA_VERSION, 3, 'G4 Backup 版本冻结在 V3');
  eq(JSON.stringify(backup.SUPPORTED_SCHEMA_VERSIONS), '[1,2,3]', 'G4 Backup 支持 V1/V2/V3（不接受 V4）');
  eq(JSON.stringify(validator.SUPPORTED_SCHEMA_VERSIONS), '[1,2,3]', 'G4 Validator 支持 V1/V2/V3');
  eq(JSON.stringify(ledger.SUPPORTED_MONTH_VERSIONS), '[1,2,3]', 'G4 月份分片支持 V1/V2/V3');
  // health 不导出常量，改为读源码确认认可版本集合仍为 [1,2,3]
  assert(/const VALID_SCHEMA_VERSIONS = \[1, 2, 3\];/.test(read('data/health.js')),
    'G4 健康检查认可 V1/V2/V3（源码常量未变）');
  eq(migV2.TARGET_VERSION, 2, 'G4 历史迁移阶段 2 目标版本未变');
  eq(migV3.TARGET_VERSION, 3, 'G4 当前迁移目标版本仍为 3（未被偷偷升级）');
  eq(statCfg.CONFIG_VERSION, 1, 'G4 统计模块配置版本 V1');

  // Bill V3 结构：工厂产出的字段集合冻结（新增字段会破坏导出/备份兼容）
  const bill = ledger.createBill({
    type: 'expense', amountCents: 100, categoryId: 'c-food', occurredAt: 1760000000000,
  });
  const billKeys = Object.keys(bill).sort();
  eq(billKeys.join(','), [
    'amountCents', 'categoryId', 'createdAt', 'id', 'importBatchId', 'ledgerImpact',
    'merchant', 'note', 'occurredAt', 'source', 'sourceTxnId', 'title', 'type', 'updatedAt',
  ].sort().join(','), 'G4 Bill V3 普通账单字段集合冻结');

  const dvBill = ledger.createBill({
    type: 'expense', amountCents: 100, categoryId: 'c-food', occurredAt: 1760000000000,
    dailyValue: { enabled: true, startDate: '2026-01-01' },
  });
  eq(JSON.stringify(dvBill.dailyValue), '{"enabled":true,"mode":"elapsed","startDate":"2026-01-01"}',
    'G4 dailyValue 结构冻结（enabled/mode=elapsed/startDate）');
  const recBill = ledger.createBill({
    type: 'expense', amountCents: 100, categoryId: 'c-food', occurredAt: 1760000000000,
    recurringRuleId: 'r-1',
  });
  eq(recBill.recurringRuleId, 'r-1', 'G4 周期账单带 recurringRuleId（V3 新增字段）');

  // Recurring Store V1 / Budget V1
  const recStoreSrc = read('data/recurring/store.js');
  assert(/const STORE_VERSION = 1;/.test(recStoreSrc), 'G4 Recurring Store 版本冻结在 V1');
  eq(recStoreSrc.indexOf('version:1, rules:[]') >= 0, true, 'G4 Recurring Store 存储结构注释仍为 { version:1, rules:[] }');
  const budgetSrc = read('data/budget/rules.js');
  assert(/const DEFAULT_BUDGET = \{ version: 1, weekStartsOn: 1, rules: \[\] \};/.test(budgetSrc),
    'G4 Budget V1 默认结构冻结（version/weekStartsOn/rules）');

  // Backup V3 载荷字段
  const wx2 = buildWx();
  global.wx = wx2;
  Object.keys(require.cache).forEach((k) => {
    if (k.replace(/\\/g, '/').indexOf('/jizhang-mini/data/') >= 0) delete require.cache[k];
  });
  const store2 = require(path.join(ROOT, 'data', 'index.js'));
  store2.init();
  store2.addBill({ type: 'expense', amountCents: 100, categoryId: 'c-food', occurredAt: at(2026, 10, 1, 9).getTime() });
  const bk = store2.buildBackup();
  eq(bk.schemaVersion, 3, 'G4 生成备份 schemaVersion=3');
  eq(bk.format, 'daily-value-mini-backup', 'G4 备份 format 标识未变');
  eq(JSON.stringify(Object.keys(bk.data).sort()), JSON.stringify(
    ['bills', 'categories', 'recurringRules', 'settings'].sort()
  ), 'G4 备份载荷字段集合冻结（budget 在 settings 内，不单列）');
  eq(store2.backup.validateBackup(bk), null, 'G4 自产备份通过自校验');
}

/* ============================================================
 * G5 release 下测试注入不可达（静态守卫契约）
 * ============================================================ */
console.log('G5 测试入口守卫静态契约');
{
  const src = read('pages/main/main.js');

  /** 抠出某个页面方法体（到下一个同缩进方法或对象结束） */
  function bodyOf(name) {
    const start = src.indexOf('\n  ' + name + '(');
    if (start < 0) return null;
    const rest = src.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[A-Za-z_$][\w$]*\(/);
    return next < 0 ? rest : rest.slice(0, next + 1);
  }

  // 只允许这 5 个测试入口存在（新增未守卫入口会直接失败）
  const entries = (src.match(/\n {2}__[A-Za-z0-9_$]+\(/g) || []).map((s) => s.trim().replace('(', ''));
  eq(entries.sort().join(','), [
    '__e2eClearDonut', '__e2eSeedDonut', '__e2eSeedDonutMany', '__migtest', '__selftest',
  ].join(','), 'G5 测试入口清单冻结为 5 个（无新增未登记入口）');

  const expect = {
    __selftest: 'isDevEnv',            // 直接写真实账本 → 仅 develop
    __migtest: 'isDevEnv',             // 沙箱自检 → 仅 develop
    __e2eSeedDonut: 'isTestEnv',       // 注入测试账单 → develop/trial
    __e2eSeedDonutMany: 'isTestEnv',
    __e2eClearDonut: 'isTestEnv',
  };

  Object.keys(expect).forEach((name) => {
    const body = bodyOf(name);
    assert(!!body, 'G5 ' + name + ' 方法存在');
    if (!body) return;
    const guardCall = body.indexOf('env.' + expect[name] + '()');
    assert(guardCall > 0, 'G5 ' + name + ' 调用 env.' + expect[name] + '() 守卫');
    const throwIdx = body.indexOf('throw new Error');
    assert(throwIdx > 0, 'G5 ' + name + ' 守卫失败时抛错（fail-closed）');
    assert(throwIdx > guardCall, 'G5 ' + name + ' 先判断再抛错');

    // 关键：守卫必须在 require 测试模块之前，否则模块顶层副作用已经执行
    const requireIdx = body.search(/require\('\.\.\/\.\.\/utils\/(e2e-donut-seed|test-registry|migtest-sandbox)'\)/);
    if (requireIdx >= 0) {
      assert(requireIdx > throwIdx, 'G5 ' + name + ' 守卫通过后才 require 测试模块（release 下不可达）');
    }
  });

  // 业务页面不得出现测试命名空间写入（防止绕过 registry 直接写 __TEST__ 备注）
  const writeTestNote = /encodeTestNote\(/.test(src);
  eq(writeTestNote, true, 'G5 __selftest 通过 encodeTestNote 写命名空间备注（走统一登记）');
  const rawPrefix = /note:\s*['"]__TEST__/.test(src);
  eq(rawPrefix, false, 'G5 main.js 不手写 __TEST__ 备注字面量');
}

console.log('\ngate4-gap tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
