// pages/category-manage/category-manage.js
// 分类管理：系统分类（只读）/ 我的分类（可编辑、归档）/ 添加分类 / 已归档（可恢复）。
// 新增、编辑只需图标（Emoji）+ 名称（1-8 字、不可重名）。
const device = require('../../utils/device');
const store = require('../../data/index');

const NAME_MAX = 8;

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    system: [],
    custom: [],
    archived: [],
    // 编辑器 Sheet
    editorShow: false,
    editingId: null, // null=新增，否则编辑
    editorTitle: '添加分类',
    emoji: '',
    name: '',
    canSave: false,
  },
  onLoad() {
    const info = device.get();
    this.setData({
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      headerHeight: info.headerHeight,
    });
    this.load();
  },
  onShow() {
    this.load();
  },
  load() {
    const all = store.getCategories();
    this.setData({
      system: all.filter((c) => c.builtin),
      custom: all.filter((c) => !c.builtin && !c.archived),
      archived: all.filter((c) => c.archived),
    });
  },

  /** 打开编辑器（新增） */
  onAdd() {
    this.setData({
      editorShow: true,
      editingId: null,
      editorTitle: '添加分类',
      emoji: '',
      name: '',
      canSave: false,
    });
  },

  /** 打开编辑器（编辑） */
  onEdit(e) {
    const id = e.currentTarget.dataset.id;
    const cat = store.getCategories().find((c) => c.id === id);
    if (!cat) return;
    this.setData({
      editorShow: true,
      editingId: id,
      editorTitle: '编辑分类',
      emoji: cat.emoji || '',
      name: cat.name || '',
      canSave: true,
    });
  },

  /** 归档（软删除）；被周期引用时阻止（Gate E） */
  onArchive(e) {
    const id = e.currentTarget.dataset.id;
    const cat = store.getCategories().find((c) => c.id === id);
    if (!cat) return;
    wx.showModal({
      title: '归档分类',
      content:
        '归档后新记账不再显示「' + cat.name + '」，历史账单仍保留该分类。确定归档吗？',
      confirmText: '归档',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        const r = store.categories.archiveCategory(id);
        if (r.ok) {
          this.load();
          wx.showToast({ title: '已归档', icon: 'none' });
        } else if (r.reason === 'in-use') {
          wx.showModal({
            title: '无法归档',
            content:
              '「' +
              cat.name +
              '」正在被 ' +
              r.recurringCount +
              ' 条周期规则使用，请先修改这些周期规则的分类。',
            showCancel: false,
          });
        } else if (r.reason === 'recurring-check-failed') {
          wx.showModal({
            title: '暂时无法归档',
            content: '暂时无法确认该分类是否被周期规则使用，请稍后再试。',
            showCancel: false,
          });
        } else if (r.reason === 'builtin') {
          wx.showModal({ title: '无法归档', content: '系统分类不可归档。', showCancel: false });
        } else {
          wx.showModal({ title: '无法归档', content: '请稍后再试。', showCancel: false });
        }
      },
    });
  },

  /** 恢复已归档分类 */
  onRestore(e) {
    const id = e.currentTarget.dataset.id;
    const r = store.categories.restoreCategory(id);
    if (r.ok) {
      this.load();
      wx.showToast({ title: '已恢复', icon: 'none' });
    }
  },

  /* ---- 编辑器 Sheet ---- */
  onEmoji(e) {
    this.setData({ emoji: e.detail.value }, this.recheck);
  },
  onName(e) {
    this.setData({ name: e.detail.value }, this.recheck);
  },
  recheck() {
    const n = this.data.name.trim();
    this.setData({ canSave: !!n && n.length <= NAME_MAX });
  },
  onSaveEditor() {
    const name = this.data.name.trim();
    const emoji = this.data.emoji.trim();
    if (!name || name.length > NAME_MAX) return;
    const patch = { name };
    if (emoji) patch.emoji = emoji;

    const r = this.data.editingId
      ? store.categories.updateCategory(this.data.editingId, patch)
      : store.categories.addCategory(patch);

    if (r.ok) {
      this.setData({ editorShow: false });
      this.load();
      wx.showToast({ title: '已保存', icon: 'none' });
    } else if (r.reason === 'duplicate') {
      wx.showToast({ title: '已存在同名分类', icon: 'none' });
    } else if (r.reason === 'invalid-name') {
      wx.showToast({ title: '名称需 1-8 个字', icon: 'none' });
    } else {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },
  onEditorClose() {
    this.setData({ editorShow: false });
  },
});
