// components/bottom-sheet/bottom-sheet.js
// 通用底部弹出面板：遮罩 + 滑入动画 + safe-area。
// 始终挂载（关闭时隐藏且不响应事件），保证 slot 内子组件状态稳定。
Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
  },
  data: {
    visible: false,
    closed: true,
  },
  observers: {
    show(val) {
      if (val) this.open();
      else this.close();
    },
  },
  methods: {
    open() {
      this.setData({ closed: false });
      setTimeout(() => {
        this.setData({ visible: true });
      }, 20);
    },
    close() {
      this.setData({ visible: false });
      setTimeout(() => {
        if (!this.data.show) {
          this.setData({ closed: true });
          this.triggerEvent('closed');
        }
      }, 300);
    },
    onMaskTap() {
      this.triggerEvent('close');
    },
    noop() {},
  },
});
