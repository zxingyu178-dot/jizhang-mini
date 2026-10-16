// components/daily-value-form/daily-value-form.js
// 日价物品表单（新增 / 编辑，Bottom Sheet）：名称 / 金额 / 分类 / 起算日期 / 备注。
// 新增保存为：type=expense、ledgerImpact='daily-value-only'、dailyValue.enabled=true
//   → 只进入「日价」，绝不进入记账时间线 / 月度·年度统计 / 普通搜索；
// 编辑复用同一表单，patch 可编辑字段，保持 id / ledgerImpact 不变。
// 父组件打开 Sheet 前调用 reset()（新增）或 edit(id)（编辑）。
const store = require('../../data/index');
const money = require('../../data/money');
const util = require('../../utils/util');

const EXPENSE_CATS = [
  'c-food', 'c-transport', 'c-shopping', 'c-fun', 'c-life',
  'c-drink', 'c-bill', 'c-medical', 'c-housing', 'c-travel', 'c-other',
];

function expenseCats() {
  const all = store.getCategories();
  return EXPENSE_CATS.map((id) => all.find((c) => c.id === id)).filter(Boolean);
}

/** 'yyyy-MM-dd' 本地零点时间戳（日价物品账单落在起算日所在月份分片） */
function startOfLocalDay(dateStr) {
  const p = String(dateStr).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0).getTime();
}

Component({
  data: {
    editingId: null,
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
    /** 编辑模式：回显已有日价物品 */
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
      this.setData({
        editingId: bill.id,
        title: bill.title || '',
        amountText: money.formatCents(Math.abs(bill.amountCents)),
        categoryId: bill.categoryId,
        categoryList: expenseCats(),
        startDate,
        note: bill.note || '',
        canSubmit: bill.amountCents !== 0,
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
      const hasTitle = this.data.title.trim().length > 0;
      const hasAmount = money.parseAmountToCents(this.data.amountText) !== 0;
      this.setData({ canSubmit: hasTitle && hasAmount });
    },
    onSubmit() {
      const title = this.data.title.trim();
      const cents = Math.abs(money.parseAmountToCents(this.data.amountText));
      if (!title || !cents) return;
      const startDate = this.data.startDate;
      const payload = {
        title,
        type: 'expense',
        amountCents: cents,
        categoryId: this.data.categoryId,
        occurredAt: startOfLocalDay(startDate),
        note: this.data.note.trim(),
        dailyValue: { enabled: true, mode: 'elapsed', startDate },
      };
      if (this.data.editingId) {
        // 编辑：保持 ledgerImpact 不变（daily-value-only / normal 都不被改写）
        store.updateBill(this.data.editingId, payload);
        this.triggerEvent('saved', { id: this.data.editingId });
      } else {
        // 新增：仅日价作用域，不进账本 / 统计
        const bill = store.addBill(Object.assign({ ledgerImpact: 'daily-value-only' }, payload, { source: 'manual' }));
        this.triggerEvent('saved', { id: bill.id });
      }
    },
  },
});
