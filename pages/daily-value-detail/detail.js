// pages/daily-value-detail/detail.js
// 日价详情（二级页）：Hero 主数字为「当前日价 ¥xx/天」，含已用天数 / 原价 / 起算日，
// 下方为下降曲线、里程碑摘要、使用时间节点、日价目标节点。
// 语义（对齐 Android，并按用户要求实现删除 / 移出）：
//   - daily-value-only：「删除」→ deleteBill 整单删除（它本来只属于日价）；
//   - normal+dailyValue：「移出日价」→ updateBill(id,{dailyValue:null})，普通账单保留；
//   - 「编辑」复用 daily-value-form（不改变 ledgerImpact）。
const store = require('../../data/index');
const dv = require('../../data/daily-value/index');
const money = require('../../data/money');
const device = require('../../utils/device');

function fullDateText(s) {
  const p = String(s || '').split('-').map(Number);
  if (p.length < 3) return '';
  return p[0] + '年' + p[1] + '月' + p[2] + '日';
}

Page({
  data: {
    id: '',
    ok: false,
    name: '',
    emoji: '📦',
    heroValue: '¥0.00/天',
    heroSizeClass: 'detail-hero__value--lg',
    elapsed: 0,
    originText: '¥0.00',
    startText: '',
    ledgerImpact: 'normal',
    // 里程碑摘要
    summaryAchieved: '',
    summaryNext: '',
    // 使用时间节点
    usageItems: [],
    // 日价目标节点
    priceItems: [],
    // 设备 / 安全区
    statusBarHeight: 20,
    navBarHeight: 44,
    safeBottom: 0,
    // 编辑 sheet
    sheetShow: false,
    sheetTitle: '编辑日价物品',
  },
  onLoad(options) {
    this.id = options.id || '';
    const info = device.measure();
    this.setData({
      id: this.id,
      statusBarHeight: info.statusBarHeight,
      navBarHeight: info.navBarHeight,
      safeBottom: info.safeBottom,
    });
  },
  onShow() {
    this.loadDetail();
  },
  loadDetail() {
    const today = dv.localDateKey();
    const detail = store.getDailyValueDetail(this.id, today);
    if (!detail || !detail.ok) {
      this.setData({ ok: false, name: detail ? detail.name : '' });
      return;
    }

    const usage = dv.computeUsageMilestones(detail.startDate, today);
    const price = dv.computeDailyPriceMilestones(detail.amountCents, detail.elapsed);
    const summary = dv.buildMilestoneSummary(detail, price);

    const heroValue = '¥' + money.formatCents(Math.round(detail.currentCents)) + '/天';
    this.setData({
      ok: true,
      name: detail.name,
      emoji: detail.emoji || '📦',
      heroValue,
      heroSizeClass: this.sizeClass(heroValue),
      elapsed: detail.elapsed,
      originText: '¥' + money.formatCents(detail.amountCents),
      startText: fullDateText(detail.startDate),
      ledgerImpact: detail.ledgerImpact,
      summaryAchieved: summary ? summary.achievedText : '',
      summaryNext: summary ? summary.nextText : '',
      usageItems: usage.map((u) => ({
        target: u.target,
        achieved: u.achieved,
        remaining: u.remaining,
        statusText: u.achieved ? '已达成' : '还有 ' + u.remaining + ' 天',
      })),
      priceItems: price.map((m) => ({
        targetYuan: m.targetYuan,
        requiredDays: m.requiredDays,
        achieved: m.achieved,
        remainingDays: m.remainingDays,
        statusText: m.achieved ? '第 ' + m.requiredDays + ' 天已达成' : '第 ' + m.requiredDays + ' 天，还需 ' + m.remainingDays + ' 天',
      })),
    });
  },
  sizeClass(text) {
    const len = String(text).length;
    if (len <= 10) return 'detail-hero__value--lg';
    if (len <= 13) return 'detail-hero__value--md';
    return 'detail-hero__value--sm';
  },
  onBack() {
    wx.navigateBack({ delta: 1 });
  },
  /** 编辑：打开日价表单（daily-value-only / normal 复用，不改变 ledgerImpact） */
  onEdit() {
    const form = this.selectComponent('#dvEditForm');
    if (form) form.edit(this.id);
    this.setData({ sheetShow: true });
  },
  onSheetClose() {
    this.setData({ sheetShow: false });
  },
  onDvSaved() {
    this.setData({ sheetShow: false });
    this.loadDetail();
    const curve = this.selectComponent('#detailCurve');
    if (curve) curve.refresh();
  },
  /** normal+dailyValue：移出日价（普通账单保留） */
  onRemove() {
    wx.showModal({
      title: '移出日价',
      content: '该物品将不再出现在日价中，账单本身仍保留在账本里。确定移出吗？',
      confirmText: '移出',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          store.updateBill(this.id, { dailyValue: null });
          wx.navigateBack({ delta: 1 });
        }
      },
    });
  },
  /** daily-value-only：删除整个物品（整单删除） */
  onDelete() {
    wx.showModal({
      title: '删除日价物品',
      content: '删除后不可恢复，确定删除该物品吗？',
      confirmText: '删除',
      confirmColor: '#ff4d4d',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          store.deleteBill(this.id);
          wx.navigateBack({ delta: 1 });
        }
      },
    });
  },
  noop() {},
});
