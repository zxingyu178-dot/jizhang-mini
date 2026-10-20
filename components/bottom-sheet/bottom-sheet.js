// components/bottom-sheet/bottom-sheet.js
// 通用底部弹出面板：遮罩 + 滑入动画 + safe-area。
// 始终挂载（关闭时隐藏且不响应事件），保证 slot 内子组件状态稳定。
const keyboard = require('../../utils/keyboard');

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
      // 使任何进行中的 close 失效（快速开关时不被旧回调关闭）
      this._closeSeq = (this._closeSeq || 0) + 1;
      this.setData({ closed: false });
      setTimeout(() => {
        if (this.data.show) this.setData({ visible: true });
      }, 20);
    },
    close() {
      // 关闭序号：等待期间若重新打开，本次关闭作废
      const seq = (this._closeSeq || 0) + 1;
      this._closeSeq = seq;
      // 先收起键盘（等待 complete/兜底），再播放关闭动画，
      // 避免「先关 Sheet 后收键盘」导致真机 viewport 错位、白条。
      keyboard.hideKeyboard().then(() => {
        if (this._closeSeq !== seq || this.data.show) return;
        this.setData({ visible: false });
        setTimeout(() => {
          if (this._closeSeq !== seq || this.data.show) return;
          this.setData({ closed: true });
          this.triggerEvent('closed');
        }, 300);
      });
    },
    onMaskTap() {
      this.triggerEvent('close');
    },
    noop() {},
  },
});
