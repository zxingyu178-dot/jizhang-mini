// pages/recurring/recurring.js
// 周期记账：规则列表（频率 / 金额 / 分类 / 下次 / 启用开关）+ 编辑器 Sheet。
// 小程序无后台常驻：每次打开小程序时自动补齐已到期的周期账单（见 app.js）。
const device = require('../../utils/device');
const viewport = require('../../utils/viewport');
const theme = require('../../utils/theme');
const keyboard = require('../../utils/keyboard');
const submitGuard = require('../../utils/submit-guard');
const store = require('../../data/index');
const money = require('../../data/money');
const { pickCategoryVisual } = require('../../data/category-icons');
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
    case 'yearly': {
      // Android 规则 month 可选：缺失时语义为 startDate 所在月（core 已同口径 fallback），
      // 列表文案不能直接 rule.month + '月'，否则显示「每年 undefined 月 16 日」。
      const sc = core.parseDate(rule.startDate);
      const m = Number.isInteger(rule.month)
        ? rule.month
        : Number.isFinite(sc.m)
          ? sc.m
          : 1;
      return (
        (rule.interval > 1 ? '每 ' + rule.interval + ' 年 ' : '每年 ') +
        m +
        ' 月 ' +
        rule.day +
        ' 日'
      );
    }
  }
  return '';
}

/** yyyy-MM-dd → M月D日（列表「下次」短日期）；非法返回空串 */
function fmtDateShort(dateStr) {
  if (!dateStr) return '';
  const c = core.parseDate(dateStr);
  if (![c.y, c.m, c.d].every(Number.isFinite)) return '';
  return c.m + '月' + c.d + '日';
}

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    themeClass: 'theme-dark',
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
    amountFocused: false,
    intervalFocused: false,
    cats: [],
    categoryId: '',
    note: '',
    frequency: 'monthly',
    interval: 1,
    // 间隔输入框的显示串（可为空；夹取结果回写到 interval，见 applyInterval）
    intervalText: '1',
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
    // 主题绑定：根容器 themeClass 实时跟随，不重启、不丢状态。
    this._offTheme = theme.bindPage(this);
    // 键盘收起/窗口恢复后重新设置布局高度（v0.8.1 防白条/上移）
    this._offRecover = viewport.onRecover((vinfo) => {
      this.setData({
        windowHeight: vinfo.windowHeight,
        statusBarHeight: vinfo.statusBarHeight,
        headerHeight: vinfo.headerHeight,
      });
    });
  },
  onUnload() {
    if (this._offTheme) { this._offTheme(); this._offTheme = null; }
    if (this._offRecover) this._offRecover();
  },
  onShow() {
    this.load();
  },

  load() {
    const resolveCategory = store.getCategoryResolver(); // 单次列表快照
    const rules = store.recurring.getRules().map((r) => {
      const cat = resolveCategory(r.categoryId);
      return Object.assign(
        {
          id: r.id,
          enabled: r.enabled,
          type: r.type,
          freqText: frequencyText(r),
          amountText: money.formatCents(r.amountCents),
          categoryName: cat.name,
          note: r.note,
          // 停用规则保留 nextOccurrence 游标便于恢复，但列表显示「已停用」，不写「下次」
          nextText: r.enabled ? fmtDateShort(r.nextOccurrence) : '',
        },
        pickCategoryVisual(cat)
      );
    });
    this.setData({ rules, empty: rules.length === 0 });
  },

  noop() {},

  /** 保存防连点锁（页面级，懒创建）：详见 utils/submit-guard.js */
  _guard() {
    if (!this._submitGuard) this._submitGuard = submitGuard.createSubmitGuard();
    return this._submitGuard;
  },

  /** 新建：重置编辑器 */
  onAdd() {
    // 重新进入编辑器 = 上一次保存流程已结束，解锁
    this._guard().end();
    const now = new Date();
    const cats = store.getActiveCategories();
    const categoryId = this.defaultCategoryId('expense', cats);
    this.setData({
      editorShow: true,
      editingId: null,
      type: 'expense',
      amountText: '',
      amountFocused: false,
      intervalFocused: false,
      cats,
      categoryId,
      note: '',
      frequency: 'monthly',
      interval: 1,
      intervalText: '1',
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
    // 重新进入编辑器 = 上一次保存流程已结束，解锁
    this._guard().end();
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
      amountFocused: false,
      intervalFocused: false,
      cats,
      categoryId: rule.categoryId,
      note: rule.note,
      frequency: rule.frequency,
      interval: rule.interval,
      intervalText: String(rule.interval),
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
    if (enabled) {
      // 重新启用：setRuleEnabled 已置 scheduleEffectiveAt=now（不补停用期间），
      // 等生成器重算真实 nextOccurrence 后再刷新，避免列表短暂显示旧日期。
      Promise.resolve(store.recurring.runRecurringGenerator())
        .catch((err) => console.error('启用后周期补齐失败', err))
        .then(() => this.load());
    } else {
      this.load();
    }
  },

  /** 删除规则（已生成 Bill 保留） */
  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    // 先结束输入并收起键盘，再弹原生确认框；取消时表单与规则保持不变。
    keyboard.hideKeyboard().then(() => {
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
  /** 金额规范化（输入 / 失焦共用） */
  applyAmount(v) {
    const val = typeof v === 'string' ? v : '';
    this.setData({ amountText: val, canSave: money.parseAmountToCents(val) > 0 });
  },
  onAmount(e) {
    this.applyAmount(e.detail.value);
  },
  onAmountFocus() {
    this.setData({ amountFocused: true });
  },
  onAmountBlur(e) {
    // 失焦只同步最终值，不主动收键盘。
    this.applyAmount(e.detail.value);
    this.setData({ amountFocused: false });
  },
  onAmountDone() {
    keyboard.releaseInputFocus(this, 'amountFocused');
  },
  onCategory(e) {
    this.setData({ categoryId: e.currentTarget.dataset.id });
  },
  onNote(e) {
    this.setData({ note: e.detail.value });
  },
  onNoteConfirm(e) {
    this.onNote(e);
    keyboard.hideKeyboard();
  },
  onFrequency(e) {
    this.setData({ frequency: e.currentTarget.dataset.f });
  },
  /**
   * 间隔夹取（1–999）：**只在失焦 / 完成 / 保存前调用**，输入过程中不夹取。
   * 同时把显示串回写成夹取后的结果，保证「看到的」=「要保存的」。
   */
  applyInterval(v) {
    let n = parseInt(v, 10);
    if (!Number.isFinite(n)) n = 1;
    n = Math.min(999, Math.max(1, n));
    const patch = {};
    if (this.data.interval !== n) patch.interval = n;
    if (this.data.intervalText !== String(n)) patch.intervalText = String(n);
    if (Object.keys(patch).length) this.setData(patch);
  },
  /**
   * 输入中：只过滤非数字，**不夹取、允许暂时为空**（v1.4.0 P2-04）。
   * 旧实现在每个按键上夹取，导致「删空→立刻被回写成 1→再输 5 变成 15」。
   * 取值语义与 parseInt 对齐：只认开头连续数字，后面出现任何字符即截断。
   */
  onInterval(e) {
    const raw = e && e.detail && e.detail.value != null ? String(e.detail.value) : '';
    const m = /^[0-9]*/.exec(raw);
    const digits = m ? m[0] : '';
    if (digits !== String(this.data.intervalText)) this.setData({ intervalText: digits });
  },
  onIntervalFocus() {
    this.setData({ intervalFocused: true });
  },
  onIntervalBlur(e) {
    // 失焦：这里才夹取回 1–999（只同步值，不主动收键盘）。
    const v = e && e.detail && e.detail.value != null ? e.detail.value : this.data.intervalText;
    this.applyInterval(v);
    this.setData({ intervalFocused: false });
  },
  onIntervalDone() {
    // 完成 = 结束输入：先夹取到合法值，再收键盘（键盘收起后不再有输入事件）
    this.applyInterval(this.data.intervalText);
    keyboard.releaseInputFocus(this, 'intervalFocused');
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
    // P2-04：保存前把间隔夹取到 1–999（输入过程中不夹取，避免删空被回写成 1 后变 15）
    this.applyInterval(this.data.intervalText);
    const d = this.data;
    const amountCents = Math.abs(money.parseAmountToCents(d.amountText));
    if (!amountCents || !d.categoryId || !d.startDate) return;
    // 防连点：上一次保存/补记确认还在进行，直接丢弃本次点击
    const guard = this._guard();
    if (!guard.begin()) return;
    const rule = this.buildRule();
    const now = new Date();

    const doSave = () => {
      try {
        if (d.editingId) {
          // 编辑：scheduleEffectiveAt=now，只影响之后 occurrence，不回填历史
          store.recurring.editRule(d.editingId, {
            ...rule,
            scheduleEffectiveAt: Date.now(),
          });
        } else {
          store.recurring.createRule(rule);
        }
      } catch (err) {
        // 失败必须解锁，否则本次会话再也保存不了（P2-02 同源问题）
        guard.end();
        console.error('保存周期规则失败', err);
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        return;
      }
      // 无论新建 / 编辑，保存后立即重算 nextOccurrence / 补齐到期账单，再刷新列表，
      // 不能等下一次 onShow（否则编辑后「下次」仍停留在旧值）。
      Promise.resolve(store.recurring.runRecurringGenerator())
        .catch((err) => console.error('保存后周期补齐失败', err))
        .then(() => {
          // 成功路径保持占用，直到 onAdd / onEdit / 关闭编辑器（见 utils/submit-guard.js）
          this.setData({ editorShow: false });
          this.load();
        });
    };

    if (!d.editingId && rule.startDate <= core.localDateKey(now)) {
      const due = store.recurring.countDueForRule(rule, now);
      if (due.count > 0) {
        const content = due.truncated
          ? '历史到期记录超过 365 笔。为避免一次生成过多数据，本次最多补记 365 笔，剩余记录将在后续打开小程序时继续补齐。'
          : '从 ' + rule.startDate + ' 起共有 ' +
            due.count + ' 笔到期记录，保存后将补记 ' + due.count + ' 笔账单。';
        // 先结束输入并收起键盘，再弹补记确认；取消后编辑器保持打开、键盘保持收起。
        keyboard.hideKeyboard().then(() => {
          wx.showModal({
            title: '补记周期账单',
            content,
            confirmText: '补记',
            cancelText: '取消',
            success: (res) => {
              if (res.confirm) doSave();
              // 取消：不保存，必须解锁，否则用户再也点不了保存
              else guard.end();
            },
          });
        });
        return;
      }
    }
    doSave();
  },

  onEditorClose() {
    // 关闭编辑器 = 本次保存流程结束，解锁
    this._guard().end();
    this.setData({ editorShow: false });
  },
});
