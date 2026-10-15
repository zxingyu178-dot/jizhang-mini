// components/bill-form/bill-form.js
// 记账表单（新增 / 编辑）：收支切换、金额、分类、日期、商户、备注。
// 父组件打开 Bottom Sheet 前调用 reset()（新增）或 edit(id)（编辑）。
const store = require('../../data/index');
const money = require('../../data/money');
const util = require('../../utils/util');

const EXPENSE_CATS = [
  'c-food', 'c-transport', 'c-shopping', 'c-fun', 'c-life',
  'c-drink', 'c-bill', 'c-medical', 'c-housing', 'c-travel', 'c-other',
];
const INCOME_CATS = ['c-salary', 'c-other'];

function catsFor(type) {
  const all = store.getCategories();
  const ids = type === 'income' ? INCOME_CATS : EXPENSE_CATS;
  return ids.map((id) => all.find((c) => c.id === id)).filter(Boolean);
}

Component({
  data: {
    editingId: null,
    editingHours: null,
    editingMinutes: null,
    type: 'expense',
    amountText: '',
    categoryId: 'c-food',
    categoryList: [],
    dateStr: '',
    merchant: '',
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
    /** 新增模式：重置为默认（今天/支出） */
    reset() {
      this.setData({
        editingId: null,
        editingHours: null,
        editingMinutes: null,
        type: 'expense',
        amountText: '',
        categoryId: 'c-food',
        categoryList: catsFor('expense'),
        dateStr: util.formatDate(new Date()),
        merchant: '',
        note: '',
        canSubmit: false,
        autoFocus: false,
      });
    },
    /** 编辑模式：填充已有账单 */
    edit(id) {
      const bill = store.getBill(id);
      if (!bill) {
        this.reset();
        return;
      }
      const d = new Date(bill.occurredAt);
      this.setData({
        editingId: bill.id,
        // 记录原始时分：改日期时与新日期合并，不被改成编辑时间
        editingHours: d.getHours(),
        editingMinutes: d.getMinutes(),
        type: bill.type,
        amountText: money.formatCents(Math.abs(bill.amountCents)),
        categoryId: bill.categoryId,
        categoryList: catsFor(bill.type),
        dateStr: util.formatDate(d),
        merchant: bill.merchant || '',
        note: bill.note || '',
        canSubmit: bill.amountCents !== 0,
        autoFocus: false,
      });
    },
    onType(e) {
      const type = e.currentTarget.dataset.type;
      if (type === this.data.type) return;
      // 切类型时，若当前分类不在新类型列表里，回到默认分类
      const list = catsFor(type);
      let categoryId = this.data.categoryId;
      if (!list.find((c) => c.id === categoryId)) {
        categoryId = type === 'income' ? 'c-salary' : 'c-food';
      }
      this.setData({ type, categoryList: list, categoryId });
    },
    onCategory(e) {
      this.setData({ categoryId: e.currentTarget.dataset.id });
    },
    onAmount(e) {
      let v = e.detail.value;
      // 限制小数位最多 2 位
      const dot = v.indexOf('.');
      if (dot >= 0 && v.length - dot > 3) v = v.slice(0, dot + 3);
      this.setData({ amountText: v, canSubmit: money.parseAmountToCents(v) !== 0 });
    },
    onDate(e) {
      this.setData({ dateStr: e.detail.value });
    },
    onMerchant(e) {
      this.setData({ merchant: e.detail.value });
    },
    onNote(e) {
      this.setData({ note: e.detail.value });
    },
    onDelete() {
      const id = this.data.editingId;
      if (!id) return;
      wx.showModal({
        title: '删除账单',
        content: '删除后不可恢复，确定删除这笔账单吗？',
        confirmText: '删除',
        confirmColor: '#ff4d4d',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            store.deleteBill(id);
            this.triggerEvent('deleted', { id });
          }
        },
      });
    },
    onSubmit() {
      if (!this.data.canSubmit) return;
      const cents = Math.abs(money.parseAmountToCents(this.data.amountText));
      if (!cents) return;
      const isEditing = !!this.data.editingId;
      const payload = {
        type: this.data.type,
        amountCents: cents,
        categoryId: this.data.categoryId,
        // 编辑时合并原始时分；新增时用当前时分
        occurredAt: util.dateWithTime(
          this.data.dateStr,
          isEditing ? this.data.editingHours : null,
          isEditing ? this.data.editingMinutes : null
        ),
        merchant: this.data.merchant.trim(),
        note: this.data.note.trim(),
      };
      if (this.data.editingId) {
        store.updateBill(this.data.editingId, payload);
        this.triggerEvent('saved', { id: this.data.editingId });
      } else {
        const bill = store.addBill(payload);
        this.triggerEvent('saved', { id: bill.id });
      }
    },
  },
});
