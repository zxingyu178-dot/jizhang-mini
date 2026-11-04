// pages/budget-settings/budget-settings.js
// 预算设置（极简）：启用预算、每日预算金额、生效日期。
// 修改预算只「新增 / 替换规则」，不覆盖历史；生效日期默认今天，允许过去、不允许未来。
const device = require('../../utils/device');
const store = require('../../data/index');
const money = require('../../data/money');
const util = require('../../utils/util');
const theme = require('../../utils/theme');
const keyboard = require('../../utils/keyboard');
const viewport = require('../../utils/viewport');
const submitGuard = require('../../utils/submit-guard');

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
    this.setData(Object.assign(this.layoutPatch(info), {
      todayStr: today,
      effectiveDate: today,
      enabled: cur ? cur.enabled : false,
      amountText: cur && cur.dailyCents ? money.formatCents(cur.dailyCents) : '',
    }));
    // 键盘收起 / 窗口恢复后重算可用高度（复用 utils/viewport，不新增键盘监听）
    this.bindViewportRecover();
    this.recheck();
  },
  onUnload() {
    this.unbindViewportRecover();
    if (this._offTheme) { this._offTheme(); this._offTheme = null; }
  },
  onToggleEnabled() {
    this.setData({ enabled: !this.data.enabled });
    this.recheck();
  },
  /**
   * 页面可用高度补丁：按传入的窗口信息重算。
   * onLoad 与 viewport 恢复共用同一套算法，避免「键盘收起后只更新一半尺寸」。
   */
  layoutPatch(info) {
    return {
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      headerHeight: info.headerHeight,
    };
  },
  /** 订阅 viewport 恢复：重复调用先退订旧的，绝不叠加两条（页面被反复 push 也不泄漏） */
  bindViewportRecover() {
    if (typeof this._offRecover === 'function') this._offRecover();
    this._offRecover = viewport.onRecover((vinfo) => {
      this.setData(this.layoutPatch(vinfo));
    });
  },
  /** 退订与订阅成对；置 null 后重复退订无副作用 */
  unbindViewportRecover() {
    if (typeof this._offRecover === 'function') this._offRecover();
    this._offRecover = null;
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
    const cents = money.parseAmountToCents(this.data.amountText);
    if (this.data.enabled && !cents) return;
    const effectiveFrom = this.data.effectiveDate;
    if (effectiveFrom > this.data.todayStr) return; // 提交层：不允许未来
    // 防连点（v1.4.0：与记账 / 日价 / 周期共用 utils/submit-guard.js）
    const guard = this._guard();
    if (!guard.begin()) return;
    // 先收键盘再保存。
    this.setData({ amountFocused: false });
    keyboard.hideKeyboard().then(() => {
      try {
        store.saveBudgetRule({
          enabled: this.data.enabled,
          dailyCents: this.data.enabled ? cents : 0,
          effectiveFrom,
        });
      } catch (err) {
        // 失败必须复位（P2-02）：否则本页保存按钮永久失效
        guard.end();
        console.error('保存预算失败', err);
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        return;
      }
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
    });
  },
  /** 保存防连点锁（页面级，懒创建）：详见 utils/submit-guard.js */
  _guard() {
    if (!this._submitGuard) this._submitGuard = submitGuard.createSubmitGuard();
    return this._submitGuard;
  },
});
