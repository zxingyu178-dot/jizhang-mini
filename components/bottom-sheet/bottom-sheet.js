// components/bottom-sheet/bottom-sheet.js
// 通用底部弹出面板：遮罩 + 滑入动画 + safe-area。
// 始终挂载（关闭时隐藏且不响应事件），保证 slot 内子组件状态稳定。
//
// v1.4.0（UI-01）：Skyline 不支持 overflow 滚动，内容超高时底部按钮不可达。
// 内容区改为 scroll-view + **确定 px 高度**（Skyline 的 scroll-view 给 auto / max-height 会塌成 0）：
//   1) 打开时（面板还在屏外）量内容高 / 拖拽条 / 标题 → utils/sheet-scroll 算预算；
//   2) 装得下 → 高度 = 内容高（观感与改造前逐像素一致，无滚动条、无底部留白）；
//   3) 装不下 → 高度 = 可用空间（可滚到底部按钮）；
//   4) 量不到 / 参数异常 → 退回「用可用空间撑起来」，绝不允许面板塌成 0 高。
// scroll-view 的节点类型恒定，不随内容切换（wx:if 切换会重建 slot 子组件、丢表单草稿）。
// 不新增键盘监听：键盘收起 / 窗口变化复用 viewport.onRecover 重算一次。
const keyboard = require('../../utils/keyboard');
const device = require('../../utils/device');
const viewport = require('../../utils/viewport');
const sheetScroll = require('../../utils/sheet-scroll');
const env = require('../../utils/env');

/** 单次几何测量的硬超时（ms）：量不回来就走降级，不许让面板停在未测量状态 */
const MEASURE_TIMEOUT = 120;
/** 打开动画的最小前置延时（ms）：与改造前 setTimeout(20) 的观感保持一致 */
const OPEN_DELAY = 20;

Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
  },
  data: {
    visible: false,
    closed: true,
    // 内容区（scroll-view）确定高度，px；0 = 还没量到（此时面板仍在屏外，用户看不见）
    bodyH: 0,
    // 内容超高才允许滚动：装得下时必须关掉，避免出现滚动条 / 回弹
    scrollable: false,
  },
  observers: {
    show(val) {
      if (val) this.open();
      else this.close();
    },
  },
  lifetimes: {
    attached() {
      // 键盘收起 / 窗口尺寸变化后重算一次高度（复用既有 viewport 恢复事件，不新增键盘监听）
      this._offRecover = viewport.onRecover(() => {
        if (this.data.show) this._fit();
      });
    },
    detached() {
      if (typeof this._offRecover === 'function') this._offRecover();
      this._offRecover = null;
    },
  },
  methods: {
    /**
     * 内容高度变化后重新预算并落位。
     *
     * 为什么必须有：面板高度只在打开那一刻按内容量一次。slot 里的表单若在打开后
     * 自己变高（例如记账表单展开「更多分类」：5 个 → 12 个，实测内容高 543 → 596），
     * scroll-view 还停在旧高度，多出来的内容被挤到面板外 —— 实测底部保存按钮的
     * 底边被推到视口外 5px，用户看不到也点不到。
     *
     * 幂等、可重复调用；面板未展示时直接返回（不要偷偷打开）。
     */
    refit() {
      if (!this.data.show) return Promise.resolve(false);
      return this._fit().then(() => true);
    },
    open() {
      // 使任何进行中的 close 失效（快速开关时不被旧回调关闭）
      this._closeSeq = (this._closeSeq || 0) + 1;
      // 先上屏（面板此时还是 translateY(100%)、完全在屏外），量完高度再播放滑入：
      // 高度落位发生在不可见阶段，用户看不到跳动，也不会打断已输入的表单。
      this.setData({ closed: false }, () => {
        this._fit().then(() => {
          if (!this.data.show) return;
          this.setData({ visible: true });
        });
      });
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

    /* ---------------- 内容区高度预算 ---------------- */

    /** 量内容高 + chrome（拖拽条 + 标题）；量不到返回 null（调用方走降级） */
    _measure() {
      return new Promise((resolve) => {
        let settled = false;
        const done = (v) => {
          if (settled) return;
          settled = true;
          resolve(v);
        };
        const timer = setTimeout(() => done(null), MEASURE_TIMEOUT);
        try {
          const q = this.createSelectorQuery();
          q.select('.bs-handle').boundingClientRect();
          q.select('.bs-title').boundingClientRect();
          q.select('.bs-body__inner').boundingClientRect();
          q.exec((res) => {
            clearTimeout(timer);
            if (!res || !res.length) return done(null);
            const handle = res[0];
            const title = res[1];
            const inner = res[2];
            const contentH = inner && inner.height > 0 ? inner.height : 0;
            const chromeH = ((handle && handle.height) || 0) + ((title && title.height) || 0);
            if (chromeH > 0) this._chromeH = chromeH;
            done({ contentH: contentH, chromeH: chromeH });
          });
        } catch (e) {
          clearTimeout(timer);
          this._diag('select-query-failed: ' + ((e && e.message) || e));
          done(null);
        }
      });
    },

    /** 按预算落位高度；返回 true 表示已拿到有效高度 */
    _apply(m) {
      if (!m || !(m.contentH > 0)) return false;
      const budget = sheetScroll.computeSheetScrollHeight({
        contentH: m.contentH,
        chromeH: m.chromeH + this._safeBottom(),
        viewportH: this._viewportH(),
      });
      if (!budget.ok) {
        this._diag('budget-rejected: ' + budget.reason);
        return false;
      }
      if (budget.degraded) this._diag('low-space avail=' + budget.avail + ' min=' + budget.minH);
      this._setHeight(budget.height, budget.scrollable);
      return true;
    },

    /** 降级：拿可用空间把面板撑起来（保证不塌），可滚动；宁可多滚也不压成 0 高 */
    _applyAvailable() {
      const avail = sheetScroll.availableBodyHeight({
        viewportH: this._viewportH(),
        chromeH: (this._chromeH || 0) + this._safeBottom(),
      });
      if (!(avail > 0)) {
        this._diag('no-available-space');
        return false;
      }
      this._diag('fallback-to-available height=' + avail);
      this._setHeight(avail, true);
      return true;
    },

    _setHeight(height, scrollable) {
      const patch = {};
      if (this.data.bodyH !== height) patch.bodyH = height;
      if (this.data.scrollable !== scrollable) patch.scrollable = scrollable;
      if (!Object.keys(patch).length) return;
      this.setData(patch);
    },

    /**
     * 量高度并落位。返回 Promise（open 等它再播放动画）。
     * 顺序：正常预算 → 量不到 → 先用可用空间撑起来 → 再量一次（能装下就收回内容高）。
     */
    _fit() {
      const t0 = Date.now();
      const wait = (r) => {
        const gap = OPEN_DELAY - (Date.now() - t0);
        if (gap <= 0) return Promise.resolve(r);
        return new Promise((resolve) => setTimeout(() => resolve(r), gap));
      };
      return this._measure()
        .then((m1) => {
          if (this._apply(m1)) return null;
          // 量不到内容高：先撑起来，落位后再量一次（此时 scroll-view 已有真实高度）
          this._applyAvailable();
          return this._measure().then((m2) => {
            this._apply(m2);
          });
        })
        .catch((e) => {
          this._diag('fit-failed: ' + ((e && e.message) || e));
          this._applyAvailable();
        })
        .then(wait);
    },

    _viewportH() {
      return sheetScroll.readViewportHeight() || device.get().windowHeight;
    },

    _safeBottom() {
      try {
        return device.get().safeBottom || 0;
      } catch (e) {
        return 0;
      }
    },

    /** 开发环境诊断（正式版静默） */
    _diag(msg) {
      let dev = false;
      try {
        dev = env.isDevEnv();
      } catch (e) {
        dev = false;
      }
      if (dev && typeof console !== 'undefined' && console.warn) {
        console.warn('[bottom-sheet] ' + msg);
      }
    },

    onMaskTap() {
      this.triggerEvent('close');
    },
    noop() {},
  },
});
