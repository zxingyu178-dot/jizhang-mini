// pages/category-manage/category-manage.js
// 分类管理：系统分类（只读）/ 我的分类（可编辑、归档）/ 添加分类 / 已归档（可恢复）。
// v1.2.0：编辑器图标从单一 Emoji 升级为「图标库（49 个本地 SVG）| Emoji」两个 Tab；
// 名称 1-8 字、不可重名；系统核心 5 类可改图标但名称不可改、不可归档。
const device = require('../../utils/device');
const viewport = require('../../utils/viewport');
const theme = require('../../utils/theme');
const store = require('../../data/index');
const categoryIcons = require('../../data/category-icons');

const NAME_MAX = 8;

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    themeClass: 'theme-dark',
    system: [],
    custom: [],
    archived: [],
    // 内置图标库（49 个，网格用）
    iconList: [],
    // 编辑器 Sheet
    editorShow: false,
    editingId: null, // null=新增，否则编辑
    editorTitle: '添加分类',
    editorTab: 'builtin', // builtin | emoji
    iconType: 'builtin', // 当前编辑选中的图标类型
    iconValue: '', // builtin → 图标 id；emoji → emoji 字符
    emoji: '', // 兜底 emoji（与 iconValue 同步）
    name: '',
    canSave: false,
  },
  onLoad() {
    const info = device.get();
    this.setData({
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      headerHeight: info.headerHeight,
      iconList: categoryIcons.BUILTIN_ICONS.map((i) => ({
        id: i.id, label: i.label, glyph: i.glyph,
      })),
    });
    this.load();
    // 主题绑定：根容器 themeClass 实时跟随，不重启、不丢状态。
    this._offTheme = theme.bindPage(this);
    // 键盘收起/窗口恢复后，重新设置布局高度（v0.8.1 防白条/上移）
    this._offRecover = viewport.onRecover((vinfo) => {
      this.setData({
        windowHeight: vinfo.windowHeight,
        statusBarHeight: vinfo.statusBarHeight,
        headerHeight: vinfo.headerHeight,
      });
    });
  },
  onUnload() {
    if (this._offTheme) { this._offTheme(); this._offTheme = null; }
    if (this._offRecover) this._offRecover();
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

  /** 打开编辑器（新增）；默认选中 builtin/other，名称待填 */
  onAdd() {
    const def = categoryIcons.builtinIconById('other');
    this.setData({
      editorShow: true,
      editingId: null,
      editorTitle: '添加分类',
      editorTab: 'builtin',
      iconType: 'builtin',
      iconValue: 'other',
      emoji: def.glyph,
      name: '',
      canSave: false,
    });
  },

  /** 打开编辑器（编辑）；恢复当前图标类型与选中态 */
  onEdit(e) {
    const id = e.currentTarget.dataset.id;
    const cat = store.getCategories().find((c) => c.id === id);
    if (!cat) return;
    const iconType = cat.iconType || 'emoji';
    const iconValue = cat.iconValue || cat.emoji || '';
    this.setData({
      editorShow: true,
      editingId: id,
      editorTitle: '编辑分类',
      editorTab: iconType === 'builtin' ? 'builtin' : 'emoji',
      iconType,
      iconValue,
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
  // 切换「图标库 / Emoji」Tab
  onEditorTab(e) {
    this.setData({ editorTab: e.currentTarget.dataset.tab });
  },
  // 从图标库点选一个内置图标（选中高亮由 wxml 根据 iconType/iconValue 判定）
  onPickBuiltin(e) {
    const id = e.currentTarget.dataset.id;
    if (!categoryIcons.isBuiltinId(id)) return;
    this.setData({
      iconType: 'builtin',
      iconValue: id,
      emoji: categoryIcons.builtinIconById(id).glyph,
    }, this.recheck);
  },
  // Emoji 自定义输入：转为 emoji 模式
  onEmoji(e) {
    const v = e.detail.value;
    this.setData({ iconType: 'emoji', iconValue: v, emoji: v }, this.recheck);
  },
  onName(e) {
    this.setData({ name: e.detail.value }, this.recheck);
  },
  recheck() {
    const n = this.data.name.trim();
    const hasIcon = this.data.iconType === 'builtin'
      ? categoryIcons.isBuiltinId(this.data.iconValue)
      : !!String(this.data.iconValue || '').trim();
    this.setData({ canSave: !!n && n.length <= NAME_MAX && hasIcon });
  },
  onSaveEditor() {
    const name = this.data.name.trim();
    if (!name || name.length > NAME_MAX) return;
    const patch = {
      name,
      iconType: this.data.iconType,
      iconValue: this.data.iconValue,
    };

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
