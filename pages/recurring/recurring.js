// pages/recurring/recurring.js
// 周期记账：规则列表（频率 / 金额 / 分类 / 下次 / 启用开关）+ 编辑器 Sheet。
// 小程序无后台常驻：每次打开小程序时自动补齐已到期的周期账单（见 app.js）。
const device = require('../../utils/device');
const store = require('../../data/index');
const money = require('../../data/money');
const core = store.recurring.core;

const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const FREQUENCY_OPTIONS = [
  { id: 'daily', label: '每天' },
  { id: 'weekly', label: '每周' },
  { id: 'monthly', label: '每月' },
  { id: 'yearly', label: '每年' },
];
const WEEK_OPTIONS = [0, 1, 2, 3, 4, 5, 6].map((v) => ({ v, label: WEEK_NAMES[v].slice(1) }));

/** 规则的频率描述 */
function frequencyText(rule) {
  switch (rule.frequency) {
    case 'daily':
      return rule.interval > 1 ? '每 ' + rule.interval + ' 天' : '每天';
    case 'weekly':
      return (
        (rule.interval > 1 ? '每 ' + rule.interval + ' 周·' : '每周·') +
        WEEK_NAMES[core.resolveWeeklyDay(rule)]
      );
    case 'monthly':
      return rule.interval > 1
        ? '每 ' + rule.interval + ' 月·' + rule.day + ' 日'
        : '每月 ' + rule.day + ' 日';
    case 'yearly':
      return (
        (rule.interval > 1 ? '每 ' + rule.interval + ' 年 ' : '每年 ') +
        rule.month +
        ' 月 ' +
        rule.day +
        ' 日'
      );
  }
  return '';
}

/** 从某 startDate 到当前，到期 occurrence 数量（新增规则补记提示用） */
function countDue(rule, now) {
  const normalized = store.recurring.store.normalizeRule(rule);
  const nowMs = now.getTime();
  let count = 0;
  for (let i = 0; i < core.MAX_CATCHUP_PER_RULE + 4; i++) {
    const d = core.occurrenceDate(normalized, i);
    if (d < normalized.startDate) continue;
    const ms = core.occurrenceTimestamp(d, normalized.time);
    if (ms > nowMs) break;
    count++;
    if (count > core.MAX_CATCHUP_PER_RULE) break;
  }
  return count;
}

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    rules: [],
    empty: false,
    // 编辑器
    editorShow: false,
    editingId: null,
    frequencyOptions: FREQUENCY_OPTIONS,
    weekOptions: WEEK_OPTIONS,
    monthOptions: Array.from({ length: 12 }, (_, i) => i + 1),
    dayOptions: Array.from({ length: 31 }, (_, i) => i + 1),
    type: 'expense',
    amountText: '',
    cats: [],
    categoryId: '',
    note: '',
    frequency: 'monthly',
    interval: 1,
    weekDay: 1,
    monthDay: 1,
    yearMonth: 1,
    yearDay: 1,
    startDate: '',
    time: '09:00',
    canSave: false,
  },

  onLoad() {
    const info = device.get();
    const now = new Date();
    this.setData({
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      headerHeight: info.headerHeight,
      weekDay: now.getDay(),
      monthDay: now.getDate(),
      yearMonth: now.getMonth() + 1,
      yearDay: now.getDate(),
      startDate: core.localDateKey(now),
    });
    this.load();
  },
  onShow() {
    this.load();
  },

  load() {
    const rules = store.recurring.getRules().map((r) => {
      const cat = store.getCategory(r.categoryId);
      return {
        id: r.id,
        enabled: r.enabled,
        type: r.type,
        freqText: frequencyText(r),
        amountText: money.formatCents(r.amountCents),
        emoji: cat.emoji,
        categoryName: cat.name,
        note: r.note,
        nextText: r.nextOccurrence || '',
      };
    });
    this.setData({ rules, empty: rules.length === 0 });
  },

  noop() {},

  onBack() {
    wx.navigateBack({ delta: 1 });
  },

  /** 新建：重置编辑器 */
  onAdd() {
    const now = new Date();
    const cats = store.getActiveCategories();
    const categoryId = this.defaultCategoryId('expense', cats);
    this.setData({
      editorShow: true,
      editingId: null,
      type: 'expense',
      amountText: '',
      cats,
      categoryId,
      note: '',
      frequency: 'monthly',
      interval: 1,
      weekDay: now.getDay(),
      monthDay: now.getDate(),
      yearMonth: now.getMonth() + 1,
      yearDay: now.getDate(),
      startDate: core.localDateKey(now),
      time: '09:00',
      canSave: false,
    });
  },

  /** 编辑：回填 */
  onEdit(e) {
    const id = e.currentTarget.dataset.id;
    const rule = store.recurring.getRule(id);
    if (!rule) return;
    const cats = store.getActiveCategories();
    if (!cats.find((c) => c.id === rule.categoryId)) {
      const ref = store.getCategory(rule.categoryId);
      if (ref && ref.id === rule.categoryId) cats.push(ref);
    }
    const sc = core.parseDate(rule.startDate);
    this.setData({
      editorShow: true,
      editingId: id,
      type: rule.type,
      amountText: money.formatCents(rule.amountCents),
      cats,
      categoryId: rule.categoryId,
      note: rule.note,
      frequency: rule.frequency,
      interval: rule.interval,
      weekDay: core.resolveWeeklyDay(rule),
      monthDay: rule.day,
      yearMonth: rule.month != null ? rule.month : sc.m,
      yearDay: rule.day,
      startDate: rule.startDate,
      time: rule.time,
      canSave: true,
    });
  },

  /** 启用开关 */
  onToggle(e) {
    const id = e.currentTarget.dataset.id;
    const enabled = e.detail.value;
    store.recurring.setRuleEnabled(id, enabled);
    if (enabled) store.recurring.runRecurringGenerator();
    this.load();
  },

  /** 删除规则（已生成 Bill 保留） */
  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除周期规则',
      content: '删除后不再自动生成；已生成的账单全部保留。确定删除吗？',
      confirmText: '删除',
      confirmColor: '#ef606b',
      success: (res) => {
        if (!res.confirm) return;
        store.recurring.deleteRule(id);
        this.setData({ editorShow: false });
        this.load();
      },
    });
  },

  /* ---- 编辑器输入 ---- */
  onType(e) {
    const type = e.currentTarget.dataset.type;
    const cats = store.getActiveCategories();
    let categoryId = this.data.categoryId;
    if (!cats.find((c) => c.id === categoryId)) categoryId = this.defaultCategoryId(type, cats);
    this.setData({ type, cats, categoryId });
  },
  onAmount(e) {
    const v = e.detail.value;
    this.setData({ amountText: v, canSave: money.parseAmountToCents(v) > 0 });
  },
  onCategory(e) {
    this.setData({ categoryId: e.currentTarget.dataset.id });
  },
  onNote(e) {
    this.setData({ note: e.detail.value });
  },
  onFrequency(e) {
    this.setData({ frequency: e.currentTarget.dataset.f });
  },
  onInterval(e) {
    let n = parseInt(e.detail.value, 10);
    if (!Number.isFinite(n)) n = 1;
    n = Math.min(999, Math.max(1, n));
    this.setData({ interval: n });
  },
  onWeekDay(e) {
    this.setData({ weekDay: Number(e.currentTarget.dataset.v) });
  },
  onMonthDay(e) {
    this.setData({ monthDay: Number(e.currentTarget.dataset.v) });
  },
  onYearMonth(e) {
    this.setData({ yearMonth: Number(e.currentTarget.dataset.v) });
  },
  onYearDay(e) {
    this.setData({ yearDay: Number(e.currentTarget.dataset.v) });
  },
  onStartDate(e) {
    this.setData({ startDate: e.detail.value });
  },
  onTime(e) {
    this.setData({ time: e.detail.value });
  },

  defaultCategoryId(type, cats) {
    const prefer = type === 'income' ? 'c-salary' : 'c-food';
    if (cats.find((c) => c.id === prefer)) return prefer;
    return cats.length ? cats[0].id : 'c-other';
  },

  /** 组装规则 */
  buildRule() {
    const d = this.data;
    const rule = {
      type: d.type,
      amountCents: Math.abs(money.parseAmountToCents(d.amountText)),
      categoryId: d.categoryId,
      note: d.note,
      frequency: d.frequency,
      interval: d.interval,
      startDate: d.startDate,
      time: d.time,
    };
    if (d.frequency === 'weekly') rule.day = d.weekDay;
    else if (d.frequency === 'monthly') rule.day = d.monthDay;
    else if (d.frequency === 'yearly') {
      rule.month = d.yearMonth;
      rule.day = d.yearDay;
    }
    return rule;
  },

  /** 保存（新增：startDate 在过去时先提示补记；编辑：只影响未来） */
  onSave() {
    const d = this.data;
    const amountCents = Math.abs(money.parseAmountToCents(d.amountText));
    if (!amountCents || !d.categoryId || !d.startDate) return;
    const rule = this.buildRule();
    const now = new Date();

    const doSave = () => {
      if (d.editingId) {
        store.recurring.editRule(d.editingId, {
          ...rule,
          scheduleEffectiveAt: Date.now(),
        });
      } else {
        store.recurring.createRule(rule);
        store.recurring.runRecurringGenerator();
      }
      this.setData({ editorShow: false });
      this.load();
    };

    if (!d.editingId && rule.startDate <= core.localDateKey(now)) {
      const n = countDue(rule, now);
      if (n > 0) {
        wx.showModal({
          title: '补记周期账单',
          content:
            '从 ' + rule.startDate + ' 起共有 ' + n + ' 笔到期记录，保存后将补记 ' + n + ' 笔账单。',
          confirmText: '补记',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) doSave();
          },
        });
        return;
      }
    }
    doSave();
  },

  onEditorClose() {
    this.setData({ editorShow: false });
  },
});
