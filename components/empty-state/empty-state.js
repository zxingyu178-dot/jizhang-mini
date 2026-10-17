// components/empty-state/empty-state.js
// 统一空态：最多四个元素 —— 图标（可选）/ 标题 / 一句说明 / 动作按钮（可选）。
// 用于「整块 / 整页空数据」的引导；列表内的一行小提示不必套用本组件。
Component({
  options: {
    multipleSlots: false,
  },
  properties: {
    icon: { type: String, value: '' }, // dv-icon 名称，空则不显示图标
    title: { type: String, value: '' },
    desc: { type: String, value: '' },
    actionText: { type: String, value: '' }, // 空则不显示动作按钮
    iconSize: { type: Number, value: 34 },
    iconColor: { type: String, value: 'rgba(255,255,255,0.40)' },
    compact: { type: Boolean, value: false }, // 紧凑版：不显示圆底图标、更小内边距（用于卡片 / Hero 内）
    primary: { type: Boolean, value: false }, // 动作用主色实底（首次引导主 CTA），否则为淡紫描边
  },
  methods: {
    onAction() {
      this.triggerEvent('action', {}, { bubbles: false, composed: false });
    },
  },
});
