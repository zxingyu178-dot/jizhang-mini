// tests/e2e/golden-path.js
// 黄金路径 GUI 回归（模拟器，automator）。
//
// T01–T12 只验证「接线」：页面渲染、data 绑定、按钮联动、关键交互闭环；
// 所有数学口径（预算/统计/日价/周期）交给 Node 单测，不在 GUI 堆边界。
//
//   T01 主界面：标题 / 三 Tab / 记账 FAB / 面板已渲染
//   T02 设置：版本号与 utils/version.js 一致、每日预算提示
//   T03 分类：系统核心 5 类只读、自定义分类行带归档按钮
//   T04 周期新建：每周·周日 ¥28（P0 覆盖 Android 周日 day=0 的等价 UI）、下次=下一个周日
//   T05 停用 / 重启用：停用显示「已停用」、重启用重算下次
//   T06 编辑只影响未来（改金额）+ 删除规则并恢复数据
//   T07 预算设置：表单联动 + 保存 ¥66/天（T08 用，结束在 T08 恢复原预算）
//   T08 预算 Hero：切预算模式、今日/本周/本月分段接线，随后恢复原预算
//   T09 搜索：初始空态 + 无结果空态（input focus 仅 DOM 断言，不截图）
//   T10 快速记账新增：FAB → 填金额/备注 → 保存进时间线
//   T11 快速记账编辑：回填 → 改金额 → 删除清理（幂等）
//   T12 日价新增：切日价 Tab → FAB → 建日价物品 → 进列表 → 详情删除清理
//
// 测试数据用固定标识（TEST_NOTE / TEST_BILL_NOTE / DV_TITLE），用例幂等：
// 开头清理、结尾删除，不污染用户数据。
'use strict';

const path = require('path');
const { APP_VERSION } = require(path.join(__dirname, '..', '..', 'utils', 'version.js'));

const TEST_NOTE = 'E2E回归';
const TEST_BILL_NOTE = 'E2E账单回归';
const DV_TITLE = 'E2E日价回归物品';

/**
 * 计算「严格未来的下一个星期 weekday」（weekday: 0=周日；不含今天）。
 * 返回 { key: 'yyyy-MM-dd', short: 'M月D日' }。
 * 关键：把规则 startDate 固定为「未来的目标星期」、time 固定 00:00，
 * 无论测试在星期几、几点运行，startDate 都在未来、没有任何到期记录，
 * 既不会弹「补记周期账单」，下次日期也唯一确定——彻底与运行当日的星期/钟点解耦。
 */
function nextFutureWeekday(weekday) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  let add = (weekday - d.getDay() + 7) % 7;
  if (add === 0) add = 7; // 今天正好是该星期时顺延到下周，保证严格未来
  d.setDate(d.getDate() + add);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return {
    key: `${d.getFullYear()}-${mm}-${dd}`,
    short: `${d.getMonth() + 1}月${d.getDate()}日`,
  };
}

// 全套用例统一引用的「未来周日」：新建规则的开始日 = 该日期，避免补记弹窗。
const FUTURE_SUNDAY = nextFutureWeekday(0);

module.exports = async function goldenPath(ctx) {
  const mp = ctx.mp;
  const sleep = ctx.sleep.bind(ctx);

  /** 删除所有带 TEST_NOTE 的测试规则（弹窗自动确认），保证用例幂等。 */
  async function cleanupTestRules(page) {
    await mp.mockWxMethod('showModal', { confirm: true, cancel: false });
    for (let guard = 0; guard < 20; guard++) {
      const d = await page.data();
      const target = d.rules.find((r) => r.note === TEST_NOTE);
      if (!target) break;
      await page.callMethod('onDelete', { currentTarget: { dataset: { id: target.id } } });
      await sleep(700);
    }
    await mp.restoreWxMethod('showModal');
  }

  const findTestRule = async (page) => {
    const d = await page.data();
    return d.rules.find((r) => r.note === TEST_NOTE);
  };

  /**
   * 打开周期新建编辑器。
   * 非空列表：底部 .rc-add 按钮；空列表：empty-state 组件内的动作按钮（.es__action，
   * 属于自定义组件内部节点，必须先拿到组件实例再用 $$ 穿透，page.$$ 跨组件返回 0）。
   */
  async function openRecurringEditor(page) {
    const add = await page.$('.rc-add');
    if (add) {
      await add.tap();
      return;
    }
    const es = await page.$('empty-state');
    if (!es) throw new Error('周期页既无 .rc-add 也无 empty-state');
    const btns = await es.$$('.es__action');
    if (!btns.length) throw new Error('空态缺少新建周期动作按钮');
    await btns[0].tap();
  }

  /** 切主页顶部自定义 Tab（0 统计 / 1 记账 / 2 日价），真实 tap + 轮询 current。 */
  async function ensureTab(page, i) {
    let d = await page.data();
    if (d.current === i) return;
    const tabs = await page.$$('.tabs__item');
    await tabs[i].tap();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await sleep(300);
      d = await page.data();
      if (d.current === i) return;
    }
    throw new Error('切换 Tab ' + i + ' 超时');
  }

  /** 在时间线里按备注找到测试账单 id。 */
  async function findBillIdByNote(page, note) {
    const panel = await page.$('#accountingPanel');
    const d = await panel.data();
    const groups = d.timeline || [];
    for (const g of groups) {
      for (const r of g.bills || []) {
        if (r.note === note) return r.id;
      }
    }
    return null;
  }

  /** 进日价详情页删除指定物品（daily-value-only 整单删除），删除后自动返回。 */
  async function deleteDvItemById(id) {
    await mp.callWxMethod('navigateTo', { url: '/pages/daily-value-detail/detail?id=' + id });
    await sleep(1300);
    const detail = await mp.currentPage();
    if (!detail.path || detail.path.indexOf('daily-value-detail') < 0) {
      throw new Error('未进入日价详情页，实际：' + detail.path);
    }
    await mp.mockWxMethod('showModal', { confirm: true, cancel: false });
    await detail.callMethod('onDelete');
    await sleep(1400); // 删除成功后页面自身 navigateBack
    await mp.restoreWxMethod('showModal');
  }

  // ---------------- T01 主页 ----------------
  await ctx.test('T01 主页：标题 / 三 Tab / 记账 FAB / 面板渲染', async () => {
    const page = await ctx.home();
    await ctx.waitFor(page, '.header__title');
    const title = await (await page.$('.header__title')).text();
    ctx.eq(title.trim(), '随时随地大小记', '主页标题');

    const tabs = await page.$$('.tabs__item');
    ctx.eq(tabs.length, 3, '顶部 Tab 数量');

    // 主页默认记账 Tab（current=1），FAB 应可见
    await ctx.waitFor(page, '.fab-wrap');

    const panel = await page.$('#accountingPanel');
    ctx.truthy(panel, '记账面板组件 #accountingPanel 存在');
    const wxml = await panel.wxml();
    ctx.ok(wxml && wxml.length > 200, '记账面板已渲染内容');

    await ctx.shot('e2e_main');
  });

  // ---------------- T02 设置 ----------------
  await ctx.test('T02 设置：版本号一致 + 每日预算提示', async () => {
    const page = await ctx.goto('/pages/settings/settings', '.row__val');
    const d = await page.data();
    ctx.eq(d.version, APP_VERSION, '设置页版本号');
    ctx.truthy(d.budgetHint && d.budgetHint.indexOf('¥') >= 0, '每日预算提示存在');
    await ctx.shot('e2e_settings');
  });

  // ---------------- T03 分类管理 ----------------
  await ctx.test('T03 分类：系统核心 5 类只读 + 自定义分类可归档', async () => {
    const page = await ctx.goto('/pages/category-manage/category-manage', '.cm-add');
    const d = await page.data();
    ctx.eq(d.system.length, 5, '系统核心分类数量');
    ctx.ok(d.custom.length >= 7, '预置/自定义分类数量');
    const sysNames = d.system.map((c) => c.name).join('');
    ['餐饮', '交通', '购物', '娱乐', '生活'].forEach((n) =>
      ctx.includes(sysNames, n, '系统分类含「' + n + '」'));

    // 系统分类行没有归档按钮；自定义分类每行恰好一个归档按钮
    const archiveBtns = await page.$$('.cm-row__archive');
    ctx.eq(archiveBtns.length, d.custom.length, '归档按钮数 = 自定义分类数');

    await ctx.shot('e2e_category_manage');
  });

  // ---------------- T04 周期新建：每周·周日 ----------------
  await ctx.test('T04 周期新建：每周·周日 ¥28 餐饮，下次=下一个周日', async () => {
    const page = await ctx.goto('/pages/recurring/recurring', '.rc-page');
    await cleanupTestRules(page);
    await sleep(400);

    await openRecurringEditor(page);
    await sleep(500);
    ctx.eq((await page.data()).editorShow, true, '新建编辑器打开');

    // 周期：每周
    await ctx.tap(page, '.re-freq__item[data-f="weekly"]');
    await sleep(300);
    // 星期：周日（data-v=0）。这是 P0 口径：周日必须保持 day=0
    await ctx.tap(page, '.re-chip[data-v="0"]');
    await sleep(200);
    // 金额
    await (await page.$('.re-amount__input')).input('28');
    // 备注（作为 E2E 测试规则标识）
    await (await page.$('.re-field__input')).input(TEST_NOTE);
    await sleep(300);

    // 确定性关键：开始日期固定为「严格未来的周日」、时间固定 00:00。
    await page.callMethod('onStartDate', { detail: { value: FUTURE_SUNDAY.key } });
    await page.callMethod('onTime', { detail: { value: '00:00' } });
    await sleep(300);

    const ed = await page.data();
    ctx.eq(ed.frequency, 'weekly', '频率 weekly');
    ctx.eq(ed.weekDay, 0, '星期 day=0（周日）');
    ctx.eq(ed.startDate, FUTURE_SUNDAY.key, '开始日期=严格未来的周日');
    ctx.eq(ed.time, '00:00', '时间=00:00（未来日期无到期，不弹补记）');
    ctx.eq(ed.canSave, true, '填完后可保存');

    await ctx.tap(page, '.re-save');
    await sleep(2200);

    const rule = await findTestRule(page);
    ctx.truthy(rule, '测试规则已创建');
    ctx.eq(rule.freqText, '每周·周日', '频率文案为「每周·周日」');
    ctx.eq(rule.amountText, '28.00', '金额显示 28.00');
    ctx.eq(rule.categoryName, '餐饮', '支出默认分类餐饮');
    ctx.eq(rule.enabled, true, '新建默认启用');
    ctx.eq(rule.nextText, FUTURE_SUNDAY.short, '下次日期=确定的未来周日（与运行日无关）');

    await ctx.shot('e2e_recurring_weekly_sunday');
  });

  // ---------------- T05 停用 / 重启用 ----------------
  await ctx.test('T05 停用 / 重启用：停用显示「已停用」，重启用重算下次', async () => {
    const page = await ctx.goto('/pages/recurring/recurring', '.rc-page');
    let rule = await findTestRule(page);
    ctx.truthy(rule, '停用前规则存在');

    await page.callMethod('onToggle', {
      currentTarget: { dataset: { id: rule.id } },
      detail: { value: false },
    });
    await sleep(900);
    rule = await findTestRule(page);
    ctx.eq(rule.enabled, false, '停用后 enabled=false');
    ctx.eq(rule.nextText, '', '停用后不显示「下次」');
    await ctx.shot('e2e_recurring_disabled');

    await page.callMethod('onToggle', {
      currentTarget: { dataset: { id: rule.id } },
      detail: { value: true },
    });
    await sleep(2400); // 启用会跑生成器再 load
    rule = await findTestRule(page);
    ctx.eq(rule.enabled, true, '重启用后 enabled=true');
    ctx.eq(rule.nextText, FUTURE_SUNDAY.short, '重启用后显示下次日期（确定的未来周日）');
    await ctx.shot('e2e_recurring_enabled');
  });

  // ---------------- T06 编辑 + 删除（恢复数据） ----------------
  await ctx.test('T06 编辑改金额 + 删除规则后恢复', async () => {
    const page = await ctx.goto('/pages/recurring/recurring', '.rc-page');
    let rule = await findTestRule(page);
    ctx.truthy(rule, '编辑前规则存在');

    // 编辑：回填后改金额 38
    await page.callMethod('onEdit', { currentTarget: { dataset: { id: rule.id } } });
    await sleep(700);
    const ed = await page.data();
    ctx.eq(ed.editorShow, true, '编辑编辑器打开');
    ctx.eq(ed.editingId, rule.id, '编辑模式回填正确 id');
    await page.callMethod('onAmount', { detail: { value: '38' } });
    await sleep(300);
    await ctx.tap(page, '.re-save');
    await sleep(2200);

    rule = await findTestRule(page);
    ctx.eq(rule.amountText, '38.00', '编辑后金额变为 38.00');
    await ctx.shot('e2e_recurring_edit');

    // 删除（弹窗自动确认）
    await mp.mockWxMethod('showModal', { confirm: true, cancel: false });
    await page.callMethod('onDelete', { currentTarget: { dataset: { id: rule.id } } });
    await sleep(1000);
    await mp.restoreWxMethod('showModal');

    const d = await page.data();
    ctx.ok(!d.rules.some((r) => r.note === TEST_NOTE), '测试规则已删除，数据恢复');
    await ctx.shot('e2e_recurring_empty');
  });

  // ---------------- T07 预算设置（保存测试预算，T08 结束恢复） ----------------
  // 记录进入预算设置页时的原始状态，供 T08 恢复。
  let originalBudget = { enabled: false, amount: '' };
  await ctx.test('T07 预算设置：表单联动 + 保存 ¥66/天', async () => {
    const page = await ctx.goto('/pages/budget-settings/budget-settings', '.bs2-save');
    let d = await page.data();
    originalBudget = { enabled: !!d.enabled, amount: d.amountText || '' };

    // 确保启用并填金额
    if (!d.enabled) await page.callMethod('onToggleEnabled');
    await page.callMethod('onAmount', { detail: { value: '66' } });
    await sleep(200);
    d = await page.data();
    ctx.eq(d.enabled, true, '测试预算启用');
    ctx.eq(d.canSave, true, '金额 ¥66 可保存');

    // 关闭开关时应无需金额也能保存（验证联动）
    await page.callMethod('onToggleEnabled');
    await sleep(150);
    d = await page.data();
    ctx.eq(d.enabled, false, '切到关闭');
    ctx.eq(d.canSave, true, '关闭预算时无需金额也可保存');
    // 重新启用并填回 66 后正式保存
    await page.callMethod('onToggleEnabled');
    await page.callMethod('onAmount', { detail: { value: '66' } });
    await sleep(150);
    ctx.eq((await page.data()).canSave, true, '重新启用 + 66 可保存');

    await page.callMethod('onSave');
    await sleep(1700); // toast + 自动 navigateBack
    const cur = await mp.currentPage();
    ctx.ok(cur.path.indexOf('pages/main') >= 0, '保存后返回主页，实际：' + cur.path);
  });

  // ---------------- T08 预算 Hero（结束恢复原预算） ----------------
  await ctx.test('T08 预算 Hero：预算模式 + 今日/本周/本月分段，随后恢复原预算', async () => {
    const page = await ctx.home();
    await ensureTab(page, 1);
    await sleep(400);

    const panel = await page.$('#accountingPanel');
    await panel.callMethod('onModeBudget');
    await sleep(800);

    let ad = await panel.data();
    ctx.eq(ad.heroMode, 'budget', '切到预算模式');
    ctx.eq(ad.hasAnyRule, true, '已存在预算规则');
    ctx.eq(ad.bd.hasBudget, true, '今日有预算');
    ctx.eq(ad.bdTotalText, '¥66.00', '今日预算显示 ¥66.00');

    // 本周
    await panel.callMethod('onBudgetKind', { currentTarget: { dataset: { k: 'week' } } });
    await sleep(500);
    ad = await panel.data();
    ctx.eq(ad.budgetKind, 'week', '切到本周');
    ctx.eq(ad.bd.hasBudget, true, '本周含预算日');

    // 本月
    await panel.callMethod('onBudgetKind', { currentTarget: { dataset: { k: 'month' } } });
    await sleep(500);
    ad = await panel.data();
    ctx.eq(ad.budgetKind, 'month', '切到本月');
    ctx.eq(ad.bd.hasBudget, true, '本月含预算日');

    // 回到今日
    await panel.callMethod('onBudgetKind', { currentTarget: { dataset: { k: 'today' } } });
    await sleep(500);
    // 注：预算 Hero 是常驻主页 main 上的状态，automator+Skyline 对常驻首页会「帧冻结」
    // （截图停在本会话首张主页帧），故此处以 DOM 断言为准；真实视觉留档走 G13 冷启动独立截图。

    // ---- 恢复原始预算状态（避免污染用户数据）----
    const bpage = await ctx.goto('/pages/budget-settings/budget-settings', '.bs2-save');
    if (originalBudget.enabled && originalBudget.amount) {
      // 原本有预算：恢复原金额、保持启用
      await bpage.callMethod('onAmount', { detail: { value: originalBudget.amount } });
      await sleep(150);
      const bd0 = await bpage.data();
      if (!bd0.enabled) await bpage.callMethod('onToggleEnabled');
      await bpage.callMethod('onSave');
    } else {
      // 原本无预算：关闭并保存
      const bd0 = await bpage.data();
      if (bd0.enabled) await bpage.callMethod('onToggleEnabled');
      await sleep(150);
      await bpage.callMethod('onSave');
    }
    await sleep(1700);
    const cur = await mp.currentPage();
    ctx.ok(cur.path.indexOf('pages/main') >= 0, '恢复预算后返回主页');
  });

  // ---------------- T09 搜索（input focus：仅 DOM 断言，不截图） ----------------
  await ctx.test('T09 搜索：初始空态 + 无结果空态', async () => {
    const page = await ctx.goto('/pages/search/search', '.s-results');
    let d = await page.data();
    ctx.eq(d.kw, '', '初始无关键词');
    ctx.eq(d.groups.length, 0, '初始无结果');
    ctx.ok((await page.$$('empty-state')).length >= 1, '初始引导空态渲染');

    // 输入一个确定不存在的关键词
    await page.callMethod('onInput', { detail: { value: 'ZZ_NO_MATCH_QX_999' } });
    await sleep(500);
    d = await page.data();
    ctx.eq(d.kw, 'ZZ_NO_MATCH_QX_999', '关键词已更新');
    ctx.eq(d.groups.length, 0, '无匹配结果');
    ctx.ok((await page.$$('empty-state')).length >= 1, '无结果空态渲染');

    // 清空恢复
    await page.callMethod('onClear');
    await sleep(200);
    d = await page.data();
    ctx.eq(d.kw, '', '清空后关键词为空');
  });

  // ---------------- T10 快速记账新增 ----------------
  await ctx.test('T10 快速记账新增：FAB → 金额/备注 → 保存进时间线', async () => {
    const page = await ctx.home();
    await ensureTab(page, 1);
    await sleep(300);

    // 幂等：若上轮残留同备注账单，先删（交给 T11 的删除逻辑统一处理）
    const stale = await findBillIdByNote(page, TEST_BILL_NOTE);
    if (stale) {
      await page.callMethod('onTapBill', { detail: { id: stale } });
      await sleep(700);
      const f0 = await page.$('#billForm');
      await mp.mockWxMethod('showModal', { confirm: true, cancel: false });
      await f0.callMethod('onDelete');
      await sleep(1000);
      await mp.restoreWxMethod('showModal');
      await sleep(400);
    }

    await ctx.tap(page, '.fab-wrap');
    await sleep(700);
    ctx.eq((await page.data()).sheetShow, true, '记账 Sheet 打开');
    ctx.eq((await page.data()).sheetTitle, '记一笔', '新增标题为记一笔');

    const form = await page.$('#billForm');
    let fd = await form.data();
    ctx.eq(fd.editingId, null, '新增模式 editingId 为空');
    await form.callMethod('onAmount', { detail: { value: '12.34' } });
    await form.callMethod('onNote', { detail: { value: TEST_BILL_NOTE } });
    await sleep(250);
    fd = await form.data();
    ctx.eq(fd.canSubmit, true, '填金额后可提交');
    ctx.eq(fd.amountText, '12.34', '金额回填 12.34');

    await form.callMethod('onSubmit');
    await sleep(1100);
    ctx.eq((await page.data()).sheetShow, false, '保存后 Sheet 关闭');

    const id = await findBillIdByNote(page, TEST_BILL_NOTE);
    ctx.truthy(id, '新账单已进入时间线');
    // 常驻主页结果帧会帧冻结，不截图，以时间线 DOM 断言为准（视觉留档走 G13 冷启动）。
  });

  // ---------------- T11 快速记账编辑 + 删除 ----------------
  await ctx.test('T11 快速记账编辑：回填 → 改金额 → 删除清理', async () => {
    const page = await ctx.home();
    await ensureTab(page, 1);
    await sleep(300);

    const id = await findBillIdByNote(page, TEST_BILL_NOTE);
    ctx.truthy(id, '待编辑账单存在');

    // 打开编辑（等价点账单行触发的 tapbill → main.onTapBill）
    await page.callMethod('onTapBill', { detail: { id } });
    await sleep(800);
    ctx.eq((await page.data()).sheetShow, true, '编辑 Sheet 打开');
    ctx.eq((await page.data()).sheetTitle, '账单详情', '编辑标题为账单详情');
    let form = await page.$('#billForm');
    ctx.eq((await form.data()).editingId, id, '编辑模式回填正确 id');
    ctx.eq((await form.data()).amountText, '12.34', '回填原金额 12.34');

    // 改金额 56.78 保存
    await form.callMethod('onAmount', { detail: { value: '56.78' } });
    await sleep(200);
    await form.callMethod('onSubmit');
    await sleep(1000);
    ctx.eq((await page.data()).sheetShow, false, '编辑保存后 Sheet 关闭');

    // 重新打开验证金额已更新
    await page.callMethod('onTapBill', { detail: { id } });
    await sleep(800);
    form = await page.$('#billForm');
    ctx.eq((await form.data()).amountText, '56.78', '编辑后金额更新为 56.78');
    ctx.eq((await form.data()).note, TEST_BILL_NOTE, '备注保留');

    // 删除清理（弹窗自动确认）
    await mp.mockWxMethod('showModal', { confirm: true, cancel: false });
    await form.callMethod('onDelete');
    await sleep(1100);
    await mp.restoreWxMethod('showModal');
    ctx.eq((await page.data()).sheetShow, false, '删除后 Sheet 关闭');
    await sleep(400);

    const left = await findBillIdByNote(page, TEST_BILL_NOTE);
    ctx.ok(!left, '测试账单已删除，数据恢复');
  });

  // ---------------- T12 日价新增 + 删除 ----------------
  await ctx.test('T12 日价新增：切日价 Tab → 建日价物品 → 进列表 → 详情删除', async () => {
    let page = await ctx.home();
    await ensureTab(page, 2);
    await sleep(800);

    // 幂等：清理上轮残留同名物品
    let panel = await page.$('#dailyValuePanel');
    let d0 = await panel.data();
    const stale = (d0.items || []).find((it) => it.name === DV_TITLE);
    if (stale) {
      await deleteDvItemById(stale.id);
      await sleep(700);
      page = await ctx.home();
      await ensureTab(page, 2);
      await sleep(600);
    }

    // FAB（日价 Tab）打开添加日价物品
    await ctx.tap(page, '.fab-wrap');
    await sleep(700);
    ctx.eq((await page.data()).dvSheetShow, true, '日价 Sheet 打开');

    const dv = await page.$('#dvForm');
    let vd = await dv.data();
    ctx.eq(vd.editingId, null, '日价新增模式 editingId 为空');
    await dv.callMethod('onTitle', { detail: { value: DV_TITLE } });
    await dv.callMethod('onAmount', { detail: { value: '88.88' } });
    await sleep(250);
    vd = await dv.data();
    ctx.eq(vd.canSubmit, true, '名称 + 金额后可提交');
    ctx.eq(vd.title, DV_TITLE, '名称回填');

    await dv.callMethod('onSubmit');
    await sleep(1100);
    ctx.eq((await page.data()).dvSheetShow, false, '日价保存后 Sheet 关闭');

    panel = await page.$('#dailyValuePanel');
    const after = await panel.data();
    const created = (after.items || []).find((it) => it.name === DV_TITLE);
    ctx.truthy(created, '日价列表含新物品');
    ctx.truthy(created.dailyText && created.dailyText.indexOf('¥') >= 0, '日价行已计算每日成本');
    // 常驻主页（日价 Tab）结果帧会帧冻结，不截图，以 items DOM 断言为准（视觉留档走 G13 冷启动）。

    // 清理：进详情删除（daily-value-only 整单删除），删除后自动返回
    await deleteDvItemById(created.id);
    await sleep(700);
    page = await ctx.home();
    await ensureTab(page, 2);
    await sleep(500);
    panel = await page.$('#dailyValuePanel');
    const left = await panel.data();
    ctx.ok(!(left.items || []).some((it) => it.name === DV_TITLE), '测试日价物品已删除，数据恢复');
  });
};
