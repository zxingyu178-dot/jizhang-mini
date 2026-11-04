/**
 * utils/sheet-scroll.js — Bottom Sheet 内容区高度预算（v1.4.0 UI-01）
 *
 * 背景：Skyline WXSS 不支持 `overflow: scroll`，弹层内容超高时既不滚也不裁，
 * 内容整块溢出面板、底部按钮（保存 / 确认记一笔）不可达。纵向滚动只能用
 * `scroll-view`，而 Skyline 的 `scroll-view` 必须有**确定高度**：
 * 给 `flex: 0 1 auto` / 只给 `max-height` 都会塌成 0（只剩拖拽条 + 标题）。
 *
 * 所以内容区高度必须由 JS 算出来，以内联 `height: Npx` 交给 `scroll-view`。
 * 本模块只做纯计算 + 视口读取，不做任何 setData：便于单测覆盖五档屏幕预算。
 *
 * 计算口径（与 bottom-sheet.wxss 的 `.bs-panel { max-height: 88% }` 一致）：
 *   可用空间 avail = floor(viewportH × 0.88 − chromeH)
 *     chromeH = 拖拽条 + 标题 + 底部安全区（这些不参与滚动）
 *   contentH ≤ avail → height = ceil(contentH)      → 不滚、不留白（与改造前逐像素一致）
 *   contentH >  avail → height = avail              → 滚动区吃满可用空间，底部按钮可滚到
 *
 * 失败一律返回 `{ ok: false, reason }`，由调用方退回「不做高度干预」的既有行为：
 * 宁可维持现状，也绝不允许把面板压成 0 高。
 */
'use strict';

/** 面板最大高度占视口比例，必须与 bottom-sheet.wxss 的 `.bs-panel { max-height }` 保持一致 */
const DEFAULT_MAX_RATIO = 0.88;

/** 最小可滚动内容区高度（px）：低于这个值滚动区没有意义，只做降级标记 */
const MIN_BODY_H = 120;

/** 视口高度读不到时的兜底（与 utils/device.js 的兜底口径一致） */
const FALLBACK_VIEWPORT_H = 667;

function isPositive(v) {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

function isNonNegative(v) {
  return typeof v === 'number' && isFinite(v) && v >= 0;
}

function normalizeRatio(v) {
  return isPositive(v) && v <= 1 ? v : DEFAULT_MAX_RATIO;
}

/**
 * 可用内容区高度（px，整数，向下取整保证面板不越过 max-height）。
 * @param {{viewportH:number, chromeH:number, maxRatio?:number}} input
 * @returns {number} ≥ 0；0 表示没有可用空间（视口/参数异常）
 */
function availableBodyHeight(input) {
  const opts = input || {};
  if (!isPositive(opts.viewportH)) return 0;
  const chromeH = isNonNegative(opts.chromeH) ? opts.chromeH : 0;
  const maxRatio = normalizeRatio(opts.maxRatio);
  const avail = Math.floor(opts.viewportH * maxRatio - chromeH);
  return avail > 0 ? avail : 0;
}

/**
 * 算内容区（scroll-view）高度。
 * @param {{contentH:number, chromeH:number, viewportH:number, maxRatio?:number, minH?:number}} input
 * @returns {{
 *   ok:boolean, reason?:string, height:number, scrollable:boolean, overflow:boolean,
 *   degraded:boolean, avail:number, contentH:number, chromeH:number, viewportH:number
 * }}
 *   height 恒为整数 px；ok=false 时 height=0，调用方必须走降级（不改高度）。
 */
function computeSheetScrollHeight(input) {
  const opts = input || {};
  const contentH = opts.contentH;
  const viewportH = opts.viewportH;
  const chromeH = isNonNegative(opts.chromeH) ? opts.chromeH : 0;
  const minH = isPositive(opts.minH) ? opts.minH : MIN_BODY_H;
  const maxRatio = normalizeRatio(opts.maxRatio);

  const fail = (reason) => ({
    ok: false,
    reason: reason,
    height: 0,
    scrollable: false,
    overflow: false,
    degraded: false,
    avail: 0,
    contentH: isPositive(contentH) ? contentH : 0,
    chromeH: chromeH,
    viewportH: isPositive(viewportH) ? viewportH : 0,
    minH: minH,
  });

  // 量失败（0 / NaN / 未渲染）一律不猜
  if (!isPositive(contentH)) return fail('invalid-content');
  if (!isPositive(viewportH)) return fail('invalid-viewport');
  if (chromeH > viewportH) return fail('invalid-chrome');

  const avail = availableBodyHeight({ viewportH: viewportH, chromeH: chromeH, maxRatio: maxRatio });
  if (avail <= 0) return fail('no-space');

  const overflow = contentH > avail;
  // 内容装得下：高度就是内容高（向上取整，绝不裁掉最后半像素）
  // 内容装不下：吃满可用空间
  const height = overflow ? avail : Math.min(Math.ceil(contentH), avail);

  return {
    ok: true,
    height: height,
    scrollable: overflow,
    overflow: overflow,
    // avail 比最小可用高度还小：空间实在不够，照实标记，调用方可打诊断
    degraded: overflow && avail < minH,
    avail: avail,
    contentH: contentH,
    chromeH: chromeH,
    viewportH: viewportH,
    minH: minH,
  };
}

/**
 * 读当前视口高度（px）。只读，不新增任何监听：
 * 优先 wx.getWindowInfo（键盘/窗口变化后是当前值），退化到 getSystemInfoSync。
 * @param {object} [wxApi] 便于单测注入
 * @returns {number} > 0 有效；0 表示读不到
 */
function readViewportHeight(wxApi) {
  const api = wxApi || (typeof wx !== 'undefined' ? wx : null);
  try {
    if (api && typeof api.getWindowInfo === 'function') {
      const info = api.getWindowInfo() || {};
      if (isPositive(info.windowHeight)) return info.windowHeight;
    }
  } catch (e) {
    /* 退化到下一个来源 */
  }
  try {
    if (api && typeof api.getSystemInfoSync === 'function') {
      const info = api.getSystemInfoSync() || {};
      if (isPositive(info.windowHeight)) return info.windowHeight;
    }
  } catch (e) {
    /* 读不到就走兜底 */
  }
  return 0;
}

module.exports = {
  DEFAULT_MAX_RATIO,
  MIN_BODY_H,
  FALLBACK_VIEWPORT_H,
  availableBodyHeight,
  computeSheetScrollHeight,
  readViewportHeight,
};
