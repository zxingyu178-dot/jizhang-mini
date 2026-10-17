// tests/e2e/golden-path.js
// 黄金路径 GUI 回归（模拟器，automator）。
//
// 覆盖（数据 + 关键 UI 绑定 + 自动截图）：
//   T01 主页：标题 / 三 Tab / 记账 FAB / 面板已渲染
//   T02 设置：版本号与 utils/version.js 一致、每日预算提示
//   T03 分类：系统核心 5 类只读、自定义分类行带归档按钮
//   T04 周期新建：每周·周日 ¥28（P0 覆盖 Android 周日 day=0 的等价 UI）、下次=下一个周日
//   T05 停用：显示「已停用」、不显示下次
//   T06 重启用：重新计算下次日期
//   T07 编辑只影响未来（改金额）+ 删除规则并恢复数据
//
// 用测试规则备注 TEST_NOTE 标识，用例幂等：开头清理、结尾删除，不污染用户数据。
'use strict';

const path = require('path');
const { APP_VERSION } = require(path.join(__dirname, '..', '..', 'utils', 'version.js'));

const TEST_NOTE = 'E2E回归';

/**
 * 计算「严格未来的下一个星期 weekday」（weekday: 0=周日；不含今天）。
 * 返回 { key: 'yyyy-MM-dd', short: 'M月D日' }。
 * 关键：E2E 用它把规则 startDate 固定为「未来的目标星期」、time 固定 00:00，
 * 这样无论测试在星期几、几点运行，startDate 都在未来、没有任何到期记录，
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

  // ---------------- T01 主页 ----------------
  await ctx.test('T01 主页：标题 / 三 Tab / 记账 FAB / 面板渲染', async () => {
    const page = await ctx.home();
    await ctx.waitFor(page, '.header__title');
    const title = await (await page.$('.header__title')).text();
    ctx.eq(title.trim(), '每日的价值', '主页标题');

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
    const page = await ctx.goto('/pages/recurring/recurring', '.rc-add');
    await cleanupTestRules(page);

    await ctx.tap(page, '.rc-add');
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
    // 原生 picker 不便自动化，直接派发 picker change 事件。
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

  // ---------------- T05 停用 ----------------
  await ctx.test('T05 停用：显示「已停用」、不再显示下次', async () => {
    const page = await ctx.goto('/pages/recurring/recurring', '.rc-add');
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
  });

  // ---------------- T06 重启用 ----------------
  await ctx.test('T06 重启用：重新计算并显示下次日期', async () => {
    const page = await ctx.goto('/pages/recurring/recurring', '.rc-add');
    let rule = await findTestRule(page);
    ctx.truthy(rule, '重启用前规则存在');

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

  // ---------------- T07 编辑 + 删除（恢复数据） ----------------
  await ctx.test('T07 编辑改金额 + 删除规则后恢复', async () => {
    const page = await ctx.goto('/pages/recurring/recurring', '.rc-add');
    let rule = await findTestRule(page);
    ctx.truthy(rule, '编辑前规则存在');

    // 编辑：回填后改金额 38
    await page.callMethod('onEdit', { currentTarget: { dataset: { id: rule.id } } });
    await sleep(700);
    const ed = await page.data();
    ctx.eq(ed.editorShow, true, '编辑编辑器打开');
    ctx.eq(ed.editingId, rule.id, '编辑模式回填正确 id');
    await (await page.$('.re-amount__input')).input('38');
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
};
