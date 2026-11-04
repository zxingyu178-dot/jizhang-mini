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
const keyboard = require('../../utils/keyboard');
const submitGuard = require('../../utils/submit-guard');

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
    todayStr: '', // 起算日期 picker 上限（今天），不允许未来
    note: '',
    canSubmit: false,
    amountFocused: false,
  },
  lifetimes: {
    attached() {
      this.reset();
    },
  },
  methods: {
    /** 保存防连点锁（实例级，懒创建）：详见 utils/submit-guard.js */
    _guard() {
      if (!this._submitGuard) this._submitGuard = submitGuard.createSubmitGuard();
      return this._submitGuard;
    },
    /** 新增模式 */
    reset() {
      // 重新进入表单 = 上一次提交流程已结束，解锁
      this._guard().end();
      this.setData({
        editingId: null,
        editingLedgerImpact: 'normal',
        editingOccurredAt: null,
        title: '',
        amountText: '',
        categoryId: 'c-shopping',
        categoryList: expenseCats(),
        startDate: util.formatDate(new Date()),
        todayStr: util.formatDate(new Date()),
        note: '',
        canSubmit: false,
        amountFocused: false,
      });
    },
    /** 编辑模式：回显已有日价物品，并记录作用域与原交易时间 */
    edit(id) {
      // 重新进入表单 = 上一次提交流程已结束，解锁
      this._guard().end();
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
        todayStr: util.formatDate(new Date()),
        note: bill.note || '',
        canSubmit: dvForm.computeFormCanSubmit(title, Math.abs(bill.amountCents)),
        amountFocused: false,
      });
    },
    onTitle(e) {
      this.setData({ title: e.detail.value });
      this.recheck();
    },
    onTitleConfirm(e) {
      this.onTitle(e);
      keyboard.hideKeyboard();
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
      // 失焦只同步最终值，不主动收键盘（允许自然切换到名称 / 备注）。
      this.applyAmount(e.detail.value);
      this.setData({ amountFocused: false });
    },
    onAmountDone() {
      // 完成后只释放焦点 / 收键盘：不清金额、不保存、不关闭 Sheet。
      keyboard.releaseInputFocus(this, 'amountFocused');
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
    onNoteConfirm(e) {
      this.onNote(e);
      keyboard.hideKeyboard();
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
      // 防连点：上一次还在写 / Sheet 还在关闭动画中，直接丢弃本次点击
      const guard = this._guard();
      if (!guard.begin()) return;
      // 提交层兜底：起算日期不允许未来（UI picker 已限制，此处双保险），夹取到今天。
      const todayStr = this.data.todayStr || util.formatDate(new Date());
      let startDate = this.data.startDate;
      if (startDate > todayStr) startDate = todayStr;
      if (this.data.editingId) {
        try {
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
        } catch (err) {
          // 失败必须解锁，否则本次会话再也保存不了（P2-02 同源问题）
          guard.end();
          console.error('保存日价物品失败', err);
          wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        }
      } else {
        // 新增：仅日价作用域，不进账本 / 统计
        const occurredAt = dvForm.startOfLocalDay(startDate);
        let bill = null;
        try {
          bill = store.addBill({
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
        } catch (err) {
          guard.end();
          console.error('保存日价物品失败', err);
          wx.showToast({ title: '保存失败，请重试', icon: 'none' });
          return;
        }
        // 成功路径保持占用：父页关 Sheet 的这段时间里按钮仍可被点（见 utils/submit-guard.js）
        this.triggerEvent('saved', { id: bill.id });
      }
    },
  },
});
