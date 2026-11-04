// components/bill-form/bill-form.js
// 记账表单（新增 / 编辑）：收支切换、金额、日期、计算日价、分类、商户、备注。
// 分类第一屏只展示「最近使用」5 个 + 「更多」，点更多展开完整分类。
// 父组件打开 Bottom Sheet 前调用 reset()（新增）或 edit(id)（编辑）。
const store = require('../../data/index');
const money = require('../../data/money');
const util = require('../../utils/util');
const keyboard = require('../../utils/keyboard');
const submitGuard = require('../../utils/submit-guard');

const RECENT_LIMIT = 5;

/**
 * 可选分类：全部未归档分类（getActiveCategories）。
 * 编辑历史账单时，若其引用的分类已归档，把该归档分类一并纳入显示（仍显示原分类）。
 */
function catsFor(type, includeId) {
  const active = store.getActiveCategories();
  if (includeId && !active.find((c) => c.id === includeId)) {
    const ref = store.getCategory(includeId); // getCategory 能解析归档分类
    if (ref && ref.id === includeId) return active.concat([ref]);
  }
  return active;
}

/** 某类型默认分类：支出优先 c-food，收入优先 c-salary；若已归档则取第一个 active */
function defaultCategoryId(type) {
  const active = store.getActiveCategories();
  const prefer = type === 'income' ? 'c-salary' : 'c-food';
  if (active.find((c) => c.id === prefer)) return prefer;
  return active.length ? active[0].id : 'c-other';
}

/**
 * 最近使用分类：按已有账单中该类型分类出现频率降序，取前 RECENT_LIMIT；
 * 确保当前选中分类在最近列表中。返回的分类对象来自完整列表。
 */
function recentCatsFor(type, selectedId) {
  const all = catsFor(type, selectedId);
  const freq = {};
  let bills = [];
  try {
    bills = store.rangeBills();
  } catch (e) {
    bills = [];
  }
  bills.forEach((b) => {
    if (b.type !== type) return;
    freq[b.categoryId] = (freq[b.categoryId] || 0) + 1;
  });
  const ranked = all
    .map((c) => ({ c, f: freq[c.id] || 0 }))
    .sort((a, b) => b.f - a.f || a.c.sort - b.c.sort)
    .map((x) => x.c);
  let recent = ranked.slice(0, RECENT_LIMIT);
  if (selectedId && !recent.find((c) => c.id === selectedId)) {
    const sel = all.find((c) => c.id === selectedId);
    if (sel) recent = recent.slice(0, RECENT_LIMIT - 1).concat(sel);
  }
  return recent;
}

Component({
  data: {
    editingId: null,
    editingHours: null,
    editingMinutes: null,
    type: 'expense',
    amountText: '',
    categoryId: 'c-food',
    recentList: [],
    allList: [],
    showAllCats: false,
    dateStr: '',
    todayStr: '', // 日期 picker 上限（今天），不允许未来
    merchant: '',
    note: '',
    // 计算日价开关（默认关；仅支出账单可开）
    dailyValueEnabled: false,
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
    /** 新增模式：重置为默认（今天/支出） */
    reset() {
      // 重新进入表单 = 上一笔的提交流程已结束，解锁（见 utils/submit-guard.js）
      this._guard().end();
      const dateStr = util.formatDate(new Date());
      const defaultId = defaultCategoryId('expense');
      this.setData({
        editingId: null,
        editingHours: null,
        editingMinutes: null,
        type: 'expense',
        amountText: '',
        categoryId: defaultId,
        recentList: recentCatsFor('expense', defaultId),
        allList: catsFor('expense'),
        showAllCats: false,
        dateStr,
        todayStr: dateStr,
        merchant: '',
        note: '',
        dailyValueEnabled: false,
        canSubmit: false,
        amountFocused: false,
      });
    },
    /** 编辑模式：填充已有账单 */
    edit(id) {
      // 重新进入表单 = 上一笔的提交流程已结束，解锁
      this._guard().end();
      const bill = store.getBill(id);
      if (!bill) {
        this.reset();
        return;
      }
      const d = new Date(bill.occurredAt);
      const dateStr = util.formatDate(d);
      this.setData({
        editingId: bill.id,
        // 记录原始时分：改日期时与新日期合并，不被改成编辑时间
        editingHours: d.getHours(),
        editingMinutes: d.getMinutes(),
        type: bill.type,
        amountText: money.formatCents(Math.abs(bill.amountCents)),
        categoryId: bill.categoryId,
        recentList: recentCatsFor(bill.type, bill.categoryId),
        allList: catsFor(bill.type, bill.categoryId),
        showAllCats: false,
        dateStr,
        todayStr: util.formatDate(new Date()),
        merchant: bill.merchant || '',
        note: bill.note || '',
        dailyValueEnabled: Boolean(bill.dailyValue && bill.dailyValue.enabled),
        canSubmit: bill.amountCents !== 0,
        amountFocused: false,
      });
    },
    onType(e) {
      const type = e.currentTarget.dataset.type;
      if (type === this.data.type) return;
      const list = catsFor(type);
      let categoryId = this.data.categoryId;
      if (!list.find((c) => c.id === categoryId)) {
        categoryId = defaultCategoryId(type);
      }
      // 日价只对支出物品有意义：切到收入时关闭开关
      const dailyValueEnabled = type === 'income' ? false : this.data.dailyValueEnabled;
      this.setData({
        type,
        categoryId,
        recentList: recentCatsFor(type, categoryId),
        allList: list,
        showAllCats: false,
        dailyValueEnabled,
      });
    },
    onCategory(e) {
      this.setData({ categoryId: e.currentTarget.dataset.id });
    },
    /** 展开完整分类区 */
    onShowAllCats() {
      this.setData({ showAllCats: true });
    },
    /** 金额规范化：限制两位小数并同步 canSubmit（输入 / 失焦共用） */
    applyAmount(v) {
      let val = typeof v === 'string' ? v : '';
      const dot = val.indexOf('.');
      if (dot >= 0 && val.length - dot > 3) val = val.slice(0, dot + 3);
      this.setData({ amountText: val, canSubmit: money.parseAmountToCents(val) !== 0 });
    },
    onAmount(e) {
      this.applyAmount(e.detail.value);
    },
    onAmountFocus() {
      this.setData({ amountFocused: true });
    },
    onAmountBlur(e) {
      // 失焦只同步最终值，不主动收键盘（允许自然切换到商户 / 备注）。
      this.applyAmount(e.detail.value);
      this.setData({ amountFocused: false });
    },
    onAmountDone() {
      // 完成后只释放焦点 / 收键盘：不清金额、不保存、不关闭 Sheet。
      keyboard.releaseInputFocus(this, 'amountFocused');
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
    onMerchantConfirm(e) {
      this.onMerchant(e);
      keyboard.hideKeyboard();
    },
    onNoteConfirm(e) {
      this.onNote(e);
      keyboard.hideKeyboard();
    },
    /** 切换「计算日价」开关（仅支出账单可交互） */
    onToggleDaily() {
      if (this.data.type === 'income') return;
      this.setData({ dailyValueEnabled: !this.data.dailyValueEnabled });
    },
    onDelete() {
      const id = this.data.editingId;
      if (!id) return;
      // 先结束输入并收起键盘，再弹原生确认框；取消时表单内容保持不变。
      keyboard.hideKeyboard().then(() => {
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
      });
    },
    onSubmit() {
      if (!this.data.canSubmit) return;
      const cents = Math.abs(money.parseAmountToCents(this.data.amountText));
      if (!cents) return;
      // 防连点：上一笔还在写 / Sheet 还在关闭动画中，直接丢弃本次点击
      const guard = this._guard();
      if (!guard.begin()) return;
      const isEditing = !!this.data.editingId;
      // 提交层兜底：日期不允许未来（UI picker 已限制，此处双保险），夹取到今天。
      const todayStr = this.data.todayStr || util.formatDate(new Date());
      let dateStr = this.data.dateStr;
      if (dateStr > todayStr) dateStr = todayStr;
      const payload = {
        type: this.data.type,
        amountCents: cents,
        categoryId: this.data.categoryId,
        // 编辑时合并原始时分；新增时用当前时分
        occurredAt: util.dateWithTime(
          dateStr,
          isEditing ? this.data.editingHours : null,
          isEditing ? this.data.editingMinutes : null
        ),
        merchant: this.data.merchant.trim(),
        note: this.data.note.trim(),
      };
      // 计算日价：开启则以账单日期为起算日（ledgerImpact 始终 normal）；
      // 编辑关闭开关时显式传 null 删除 dailyValue（移出日价），普通账单不删。
      if (payload.type === 'expense' && this.data.dailyValueEnabled) {
        payload.dailyValue = { enabled: true, mode: 'elapsed', startDate: dateStr };
      } else if (isEditing) {
        payload.dailyValue = null;
      }
      if (this.data.editingId) {
        try {
          store.updateBill(this.data.editingId, payload);
          this.triggerEvent('saved', { id: this.data.editingId });
        } catch (err) {
          // 失败必须解锁，否则本次会话再也保存不了（P2-02 同源问题）
          guard.end();
          console.error('保存账单失败', err);
          wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        }
      } else {
        let bill = null;
        try {
          bill = store.addBill(payload);
        } catch (err) {
          guard.end();
          console.error('保存账单失败', err);
          wx.showToast({ title: '保存失败，请重试', icon: 'none' });
          return;
        }
        // 成功路径保持占用：父页关 Sheet 的这段时间里按钮仍可被点（见 utils/submit-guard.js）
        this.triggerEvent('saved', { id: bill.id });
      }
    },
  },
});
