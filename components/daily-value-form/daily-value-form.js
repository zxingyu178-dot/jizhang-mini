// components/daily-value-form/daily-value-form.js
// 日价物品表单（新增 / 编辑，Bottom Sheet）：名称 / 金额 / 分类 / 起算日期 / 备注。
// 新增保存为：type=expense、ledgerImpact='daily-value-only'、dailyValue.enabled=true
//   → 只进入「日价」，绝不进入记账时间线 / 月度·年度统计 / 普通搜索；
// 编辑复用同一表单：
//   - daily-value-only：账单时间(occurredAt)跟随起算日，可跨月；
//   - normal + dailyValue：只改 dailyValue.startDate，原交易时间(occurredAt)绝对保持不变。
// 表单纯函数集中在 data/daily-value/form.js（与测试共用）。
// 父组件打开 Sheet 前调用 reset()（新增）或 edit(id)（编辑）。
const store = require('../../data/index');
const money = require('../../data/money');
const util = require('../../utils/util');
const dvForm = require('../../data/daily-value/form');

const EXPENSE_CATS = [
  'c-food', 'c-transport', 'c-shopping', 'c-fun', 'c-life',
  'c-drink', 'c-bill', 'c-medical', 'c-housing', 'c-travel', 'c-other',
];

function expenseCats() {
  const all = store.getCategories();
  return EXPENSE_CATS.map((id) => all.find((c) => c.id === id)).filter(Boolean);
}

Component({
  data: {
    editingId: null,
    editingLedgerImpact: 'normal',
    editingOccurredAt: null,
    title: '',
    amountText: '',
    categoryId: 'c-shopping',
    categoryList: [],
    startDate: '',
    note: '',
    canSubmit: false,
    autoFocus: false,
  },
  lifetimes: {
    attached() {
      this.reset();
    },
  },
  methods: {
    /** 新增模式 */
    reset() {
      this.setData({
        editingId: null,
        editingLedgerImpact: 'normal',
        editingOccurredAt: null,
        title: '',
        amountText: '',
        categoryId: 'c-shopping',
        categoryList: expenseCats(),
        startDate: util.formatDate(new Date()),
        note: '',
        canSubmit: false,
        autoFocus: false,
      });
    },
    /** 编辑模式：回显已有日价物品，并记录作用域与原交易时间 */
    edit(id) {
      const bill = store.getBill(id);
      if (!bill) {
        this.reset();
        return;
      }
      const startDate =
        bill.dailyValue && bill.dailyValue.startDate
          ? bill.dailyValue.startDate
          : util.formatDate(new Date(bill.occurredAt));
      const title = dvForm.resolveEditTitle(bill, store.getCategory(bill.categoryId));
      const amountText = money.formatCents(Math.abs(bill.amountCents));
      this.setData({
        editingId: bill.id,
        editingLedgerImpact: bill.ledgerImpact === 'daily-value-only' ? 'daily-value-only' : 'normal',
        editingOccurredAt: bill.occurredAt,
        title,
        amountText,
        categoryId: bill.categoryId,
        categoryList: expenseCats(),
        startDate,
        note: bill.note || '',
        canSubmit: dvForm.computeFormCanSubmit(title, Math.abs(bill.amountCents)),
        autoFocus: false,
      });
    },
    onTitle(e) {
      this.setData({ title: e.detail.value });
      this.recheck();
    },
    onAmount(e) {
      let v = e.detail.value;
      const dot = v.indexOf('.');
      if (dot >= 0 && v.length - dot > 3) v = v.slice(0, dot + 3);
      this.setData({ amountText: v });
      this.recheck();
    },
    onCategory(e) {
      this.setData({ categoryId: e.currentTarget.dataset.id });
    },
    onDate(e) {
      this.setData({ startDate: e.detail.value });
    },
    onNote(e) {
      this.setData({ note: e.detail.value });
    },
    recheck() {
      this.setData({
        canSubmit: dvForm.computeFormCanSubmit(this.data.title, money.parseAmountToCents(this.data.amountText)),
      });
    },
    onSubmit() {
      const title = this.data.title.trim();
      const cents = Math.abs(money.parseAmountToCents(this.data.amountText));
      if (!dvForm.computeFormCanSubmit(title, cents)) {
        this.setData({ canSubmit: false });
        return;
      }
      const startDate = this.data.startDate;
      if (this.data.editingId) {
        const patch = dvForm.buildEditPatch({
          title,
          amountCents: cents,
          categoryId: this.data.categoryId,
          note: this.data.note.trim(),
          startDate,
          ledgerImpact: this.data.editingLedgerImpact,
          originalOccurredAt: this.data.editingOccurredAt,
        });
        store.updateBill(this.data.editingId, patch);
        this.triggerEvent('saved', { id: this.data.editingId });
      } else {
        // 新增：仅日价作用域，不进账本 / 统计
        const occurredAt = dvForm.startOfLocalDay(startDate);
        const bill = store.addBill({
          title,
          type: 'expense',
          amountCents: cents,
          categoryId: this.data.categoryId,
          occurredAt,
          note: this.data.note.trim(),
          source: 'manual',
          ledgerImpact: 'daily-value-only',
          dailyValue: { enabled: true, mode: 'elapsed', startDate },
        });
        this.triggerEvent('saved', { id: bill.id });
      }
    },
  },
});
