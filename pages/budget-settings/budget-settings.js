// pages/budget-settings/budget-settings.js
// 预算设置（极简）：启用预算、每日预算金额、生效日期。
// 修改预算只「新增 / 替换规则」，不覆盖历史；生效日期默认今天，允许过去、不允许未来。
const device = require('../../utils/device');
const store = require('../../data/index');
const money = require('../../data/money');
const util = require('../../utils/util');

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    enabled: true,
    amountText: '',
    effectiveDate: '',
    todayStr: '',
    canSave: false,
  },
  onLoad() {
    const info = device.get();
    const today = util.formatDate(new Date());
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
  onToggleEnabled() {
    this.setData({ enabled: !this.data.enabled });
    this.recheck();
  },
  onAmount(e) {
    let v = e.detail.value;
    const dot = v.indexOf('.');
    if (dot >= 0 && v.length - dot > 3) v = v.slice(0, dot + 3);
    this.setData({ amountText: v });
    this.recheck();
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
    const cents = money.parseAmountToCents(this.data.amountText);
    if (this.data.enabled && !cents) return;
    const effectiveFrom = this.data.effectiveDate;
    if (effectiveFrom > this.data.todayStr) return; // 提交层：不允许未来
    store.saveBudgetRule({
      enabled: this.data.enabled,
      dailyCents: this.data.enabled ? cents : 0,
      effectiveFrom,
    });
    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
  },
});
