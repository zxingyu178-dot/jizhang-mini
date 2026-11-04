// pages/budget-settings/budget-settings.js
// 预算设置（极简）：启用预算、每日预算金额、生效日期。
// 修改预算只「新增 / 替换规则」，不覆盖历史；生效日期默认今天，允许过去、不允许未来。
const device = require('../../utils/device');
const store = require('../../data/index');
const money = require('../../data/money');
const util = require('../../utils/util');
const theme = require('../../utils/theme');
const keyboard = require('../../utils/keyboard');

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    themeClass: 'theme-dark',
    enabled: true,
    amountText: '',
    effectiveDate: '',
    todayStr: '',
    canSave: false,
    amountFocused: false,
  },
  onLoad() {
    const info = device.get();
    const today = util.formatDate(new Date());
    // 主题绑定：根容器 themeClass 实时跟随，不重启、不丢状态。
    this._offTheme = theme.bindPage(this);
    // 回显今天适用的规则（如有）
    const state = store.getBudgetState();
    const cur = store.budget.resolveRuleForDate(state, today);
    this.setData({
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      headerHeight: info.headerHeight,
      todayStr: today,
      effectiveDate: today,
      enabled: cur ? cur.enabled : false,
      amountText: cur && cur.dailyCents ? money.formatCents(cur.dailyCents) : '',
    });
    this.recheck();
  },
  onUnload() {
    if (this._offTheme) { this._offTheme(); this._offTheme = null; }
  },
  onToggleEnabled() {
    this.setData({ enabled: !this.data.enabled });
    this.recheck();
  },
  /** 金额规范化：限制两位小数（输入 / 失焦共用） */
  applyAmount(v) {
    let val = typeof v === 'string' ? v : '';
    const dot = val.indexOf('.');
    if (dot >= 0 && val.length - dot > 3) val = val.slice(0, dot + 3);
    this.setData({ amountText: val });
    this.recheck();
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
  onDate(e) {
    this.setData({ effectiveDate: e.detail.value });
    this.recheck();
  },
  recheck() {
    const cents = money.parseAmountToCents(this.data.amountText);
    // 启用需金额 > 0；关闭不要求金额
    const canSave = this.data.enabled ? cents > 0 : true;
    this.setData({ canSave });
  },
  onSave() {
    if (this._saving) return;
    const cents = money.parseAmountToCents(this.data.amountText);
    if (this.data.enabled && !cents) return;
    const effectiveFrom = this.data.effectiveDate;
    if (effectiveFrom > this.data.todayStr) return; // 提交层：不允许未来
    // 先收键盘再保存；_saving 防连点导致重复保存 / 提前返回。
    this._saving = true;
    this.setData({ amountFocused: false });
    keyboard.hideKeyboard().then(() => {
      store.saveBudgetRule({
        enabled: this.data.enabled,
        dailyCents: this.data.enabled ? cents : 0,
        effectiveFrom,
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
    });
  },
});
