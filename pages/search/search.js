// pages/search/search.js
// 全局搜索：按商户 / 备注 / 分类名匹配，结果按日期分组。
const store = require('../../data/index');
const money = require('../../data/money');
const device = require('../../utils/device');

function fmtDayLabel(ts) {
  const d = new Date(ts);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    kw: '',
    groups: [],
    sheetShow: false,
  },
  onLoad() {
    const info = device.get();
    this.setData({
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      headerHeight: info.headerHeight,
    });
  },
  onInput(e) {
    const kw = e.detail.value.trim();
    this.setData({ kw });
    this.doSearch(kw);
  },
  onClear() {
    this.setData({ kw: '', groups: [] });
  },
  onBack() {
    wx.navigateBack({ delta: 1 });
  },
  doSearch(kw) {
    if (!kw) {
      this.setData({ groups: [] });
      return;
    }
    const key = kw.toLowerCase();
    const matched = store.rangeBills().filter((b) => {
      // 普通「搜索账单」只搜普通账单；日价专属物品只在日价模块展示。
      if (b.ledgerImpact === 'daily-value-only') return false;
      const cat = store.getCategory(b.categoryId);
      // 日价物品名（title）也纳入普通账单搜索范围
      const fields = [b.merchant || '', b.note || '', b.title || '', cat ? cat.name : '', cat ? cat.id : ''];
      return fields.some((f) => f.toLowerCase().indexOf(key) >= 0);
    });

    // 按日期分组（降序）
    const map = new Map();
    matched
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .forEach((b) => {
        const label = fmtDayLabel(b.occurredAt);
        const cat = store.getCategory(b.categoryId);
        const isExp = b.type === 'expense';
        const item = {
          id: b.id,
          emoji: cat.emoji,
          name: b.merchant || cat.name,
          note: b.note,
          amountText: (isExp ? '-' : '+') + money.formatCents(b.amountCents),
          isExpense: isExp,
        };
        if (!map.has(label)) map.set(label, { label, records: [] });
        map.get(label).records.push(item);
      });

    this.setData({ groups: Array.from(map.values()) });
  },
  onTapBill(e) {
    const id = e.currentTarget.dataset.id;
    const form = this.selectComponent('#billForm');
    if (form) form.edit(id);
    this.setData({ sheetShow: true });
  },
  onSheetClose() {
    this.setData({ sheetShow: false });
  },
  onBillSaved() {
    this.setData({ sheetShow: false });
    this.doSearch(this.data.kw);
  },
});
