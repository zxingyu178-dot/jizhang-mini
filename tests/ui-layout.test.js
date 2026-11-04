// tests/ui-layout.test.js
// v1.3.5 Mobile UI Compatibility：静态布局回归。
// 只做「样式契约」检查，不依赖模拟器：确保后续改动不会重新引入
// 主 Header 换行、搜索框压扁、page-header 伸进胶囊、输入框高度漂移等回归。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function check(cond, msg) {
  if (cond) {
    pass++;
    return;
  }
  fail++;
  console.error('FAIL: ' + msg);
}

/** 去掉 CSS 注释后，把每个规则块拆成 selector → 声明文本。 */
function cssRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const map = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const decls = m[2];
    m[1].split(',').forEach((raw) => {
      const sel = raw.trim().replace(/\s+/g, ' ');
      if (!sel) return;
      map[sel] = map[sel] ? map[sel] + ';' + decls : decls;
    });
  }
  return map;
}

function decl(block, prop) {
  if (!block) return '';
  const re = new RegExp('(?:^|;)\\s*' + prop.replace(/[-]/g, '\\-') + '\\s*:\\s*([^;]+)');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

function has(block, prop, expected, label) {
  const actual = decl(block, prop);
  check(actual.indexOf(expected) >= 0, label + ' 需要 ' + prop + ':' + expected + '（实际「' + (actual || '空') + '」）');
}

/* ---------------- 1. 全局：content-box 默认值 + 三类输入规格 ---------------- */
const appJson = JSON.parse(read('app.json'));
check(appJson.rendererOptions && appJson.rendererOptions.skyline.defaultContentBox === true, 'app.json 应开启 Skyline defaultContentBox=true');
const appCss = cssRules(read('app.wxss'));
const pageRule = appCss['page'];
has(pageRule, '--input-h-normal', '60rpx', '全局普通输入高度');
has(pageRule, '--input-h-compact', '64rpx', '全局紧凑输入高度');
has(pageRule, '--input-h-amount', '100rpx', '全局大金额输入高度');
has(appCss['.glass-pill'], 'box-sizing', 'border-box', '玻璃胶囊');

/* ---------------- 2. 主 Header ---------------- */
const mainCss = cssRules(read('pages/main/main.wxss'));
has(mainCss['.header__bar'], 'box-sizing', 'border-box', '主 Header bar');
has(mainCss['.header__title'], 'white-space', 'nowrap', '品牌标题单行');
has(mainCss['.header__title'], 'text-overflow', 'ellipsis', '品牌标题省略');
has(mainCss['.header__actions'], 'min-width', '0', 'Header actions');
has(mainCss['.header__search'], 'min-width', '160rpx', '搜索胶囊最小宽度');
has(mainCss['.header__search'], 'box-sizing', 'border-box', '搜索胶囊盒模型');
has(mainCss['.header__search-text'], 'white-space', 'nowrap', '搜索文案单行');
has(mainCss['.header__search-text'], 'flex-shrink', '0', '搜索文案禁止收缩');
has(mainCss['.header__setting'], 'flex', '0 0 auto', '设置按钮禁止收缩');
has(mainCss['.header--compact .header__title'], 'font-size', '30rpx', '紧凑品牌标题');
has(mainCss['.header--compact .header__search'], 'max-width', '200rpx', '紧凑搜索胶囊宽度');

const mainJs = read('pages/main/main.js');
check(/scale \* 516 \+ 14 \+ 2/.test(mainJs), '紧凑 Header 应按真实可用宽度（516rpx + 固定图标）判定');
check(/headerCompact: computeHeaderCompact\(info, menuPad\)/.test(mainJs), 'onLoad / applyLayout 应写入 headerCompact');
check(/checkHeaderOverflow\(\)/.test(mainJs), 'onReady 应有渲染后溢出兜底检查');
check(/headerCompact\s*\?\s*'header--compact'/.test(read('pages/main/main.wxml')), '主 Header WXML 应绑定紧凑 class');
check(/menuPad/.test(read('pages/main/main.wxml')), '主 Header WXML 应使用 menuPad');

/* ---------------- 3. 二级页 page-header 胶囊避让 ---------------- */
const phJs = read('components/page-header/page-header.js');
const phWxml = read('components/page-header/page-header.wxml');
check(/info\.menu/.test(phJs) && /menuPad/.test(phJs), 'page-header 应计算 menuPad');
check(/padding-right:\{\{menuPad\}\}px/.test(phWxml), 'page-header 应注入右侧胶囊避让');

/* ---------------- 4. 搜索页 ---------------- */
const searchCss = cssRules(read('pages/search/search.wxss'));
has(searchCss['.s-input'], 'box-sizing', 'border-box', '搜索输入容器盒模型');
has(searchCss['.s-input'], 'height', '72rpx', '搜索输入容器高度');
has(searchCss['.s-input__field'], 'height', '72rpx', '搜索输入高度');
has(searchCss['.s-input__field'], 'line-height', '72rpx', '搜索输入行高');
has(searchCss['.s-input__clear'], 'flex-shrink', '0', '搜索清除按钮');
const searchJs = read('pages/search/search.js');
check(/搜索Placeholder 窄屏|searchPlaceholder/.test(searchJs), '搜索页应有窄屏 placeholder');
check(/info\.windowWidth - menuPad < 290/.test(searchJs), '搜索页 placeholder 应按真实可用宽度切换');

/* ---------------- 5. 记账表单 ---------------- */
const billCss = cssRules(read('components/bill-form/bill-form.wxss'));
has(billCss['.bf-amount__input'], 'height', 'var(--input-h-amount)', '记账大金额高度');
has(billCss['.bf-amount__input'], 'line-height', 'var(--input-h-amount)', '记账大金额行高');
has(billCss['.bf-row__input'], 'height', 'var(--input-h-normal)', '记账普通输入高度');
has(billCss['.bf-row__input'], 'line-height', 'var(--input-h-normal)', '记账普通输入行高');
has(billCss['.bf-row__input'], 'box-sizing', 'border-box', '记账普通输入盒模型');
has(billCss['.bf-row__label'], 'flex-shrink', '0', '记账行标签禁止收缩');
has(billCss['.bf-cat__name'], 'text-overflow', 'ellipsis', '记账分类名省略');

/* ---------------- 6. 日价表单 ---------------- */
const dvCss = cssRules(read('components/daily-value-form/daily-value-form.wxss'));
has(dvCss['.df-amount__input'], 'height', 'var(--input-h-amount)', '日价大金额高度');
has(dvCss['.df-row__input'], 'height', 'var(--input-h-normal)', '日价普通输入高度');
has(dvCss['.df-row__input'], 'line-height', 'var(--input-h-normal)', '日价普通输入行高');
has(dvCss['.df-cat__name'], 'white-space', 'nowrap', '日价分类名单行');
has(dvCss['.df-cat__name'], 'text-overflow', 'ellipsis', '日价分类名省略');
has(dvCss['.df-cat'], 'overflow', 'hidden', '日价分类格子裁切');

/* ---------------- 7. 周期编辑器 ---------------- */
const rcCss = cssRules(read('pages/recurring/recurring.wxss'));
has(rcCss['.re'], 'padding', '0 28rpx 28rpx', '周期编辑器内边距');
has(rcCss['.re-amount__input'], 'height', 'var(--input-h-amount)', '周期金额高度');
has(rcCss['.re-amount__input'], 'line-height', 'var(--input-h-amount)', '周期金额行高');
has(rcCss['.re-interval__input'], 'height', 'var(--input-h-compact)', '周期间隔高度');
has(rcCss['.re-interval__input'], 'line-height', 'var(--input-h-compact)', '周期间隔行高');
has(rcCss['.re-field__input'], 'height', 'var(--input-h-normal)', '周期备注高度');
has(rcCss['.re-field__input'], 'line-height', 'var(--input-h-normal)', '周期备注行高');

/* ---------------- 8. 分类管理 ---------------- */
const cmCss = cssRules(read('pages/category-manage/category-manage.wxss'));
has(cmCss['.ce'], 'padding', '0 28rpx 28rpx', '分类编辑器内边距');
has(cmCss['.ce__emoji-input'], 'height', 'var(--input-h-compact)', 'Emoji 输入高度');
has(cmCss['.ce__emoji-input'], 'line-height', 'var(--input-h-compact)', 'Emoji 输入行高');
has(cmCss['.ce__name'], 'height', 'var(--input-h-normal)', '分类名称输入高度');
has(cmCss['.ce__name'], 'line-height', 'var(--input-h-normal)', '分类名称输入行高');
has(cmCss['.cm-row__name'], 'text-overflow', 'ellipsis', '分类行名称省略');
has(cmCss['.cm-row__archive'], 'flex-shrink', '0', '归档按钮禁止收缩');

/* ---------------- 9. 预算 ---------------- */
const budgetCss = cssRules(read('pages/budget-settings/budget-settings.wxss'));
has(budgetCss['.bs2-amount__input'], 'box-sizing', 'border-box', '预算金额盒模型');
has(budgetCss['.bs2-amount__input'], 'line-height', '80rpx', '预算金额行高');
has(budgetCss['.bs2-amount__unit'], 'flex-shrink', '0', '预算单位禁止收缩');

/* ---------------- 10. 导入 / 预览 / 结果 ---------------- */
const importCss = cssRules(read('packages/importer/pages/import/import.wxss'));
has(importCss['.imp-hist__name'], 'text-overflow', 'ellipsis', '导入历史文件名省略');
has(importCss['.imp-hist__name'], 'white-space', 'nowrap', '导入历史文件名单行');
has(importCss['.imp-hist__meta'], 'flex-shrink', '0', '导入历史统计禁止收缩');
has(importCss['.btn'], 'white-space', 'nowrap', '导入来源按钮单行');
has(importCss['.imp-foot'], 'padding', 'env(safe-area-inset-bottom)', '导入页底部安全区');

const previewCss = cssRules(read('packages/importer/pages/preview/preview.wxss'));
has(previewCss['.pv-count-value'], 'flex-shrink', '0', '导入预览统计数字禁止收缩');
has(previewCss['.pv-sample-amount'], 'flex-shrink', '0', '导入预览样例金额禁止收缩');
has(previewCss['.pv-btn'], 'white-space', 'nowrap', '导入预览按钮单行');
has(previewCss['.pv-btn'], 'text-overflow', 'ellipsis', '导入预览按钮省略');

const resultCss = cssRules(read('packages/importer/pages/result/result.wxss'));
has(resultCss['.rs-page'], 'padding', 'env(safe-area-inset-bottom)', '导入结果页底部安全区');

/* ---------------- 11. 备份与恢复 ---------------- */
const brCss = cssRules(read('pages/backup-restore/backup-restore.wxss'));
has(brCss['.br-info__val'], 'text-overflow', 'ellipsis', '备份信息值省略');
has(brCss['.br-tip:last-child'], 'padding-bottom', 'env(safe-area-inset-bottom)', '备份页底部安全区');

/* ---------------- 12. 统计页 ---------------- */
const statCss = cssRules(read('components/statistics-panel/statistics-panel.wxss'));
has(statCss['.month-title__text'], 'white-space', 'nowrap', '统计月份标题单行');
has(statCss['.month-title__text'], 'text-overflow', 'ellipsis', '统计月份标题省略');
has(statCss['.share-row__percent'], 'flex-shrink', '0', '统计占比列禁止收缩');
has(statCss['.share-row__amount'], 'flex-shrink', '0', '统计金额列禁止收缩');

/* ============================================================
   13. 五档宽度预算校验（320 / 360 / 375 / 390 / 414）
   ============================================================
   思路：不依赖模拟器，把「一行内的固定宽度元素之和 + 最坏文本宽度」按 rpx→px
   换算到 5 个真实屏宽，逐档断言放得下。
     · rpx→px 系数 = 屏宽 / 750（小程序标准）
     · 文本宽度按偏大值估算：CJK/全角 1em、数字 0.6em、字母 0.62em、标点 0.34em
   这样任何一档超限都会在单测里暴露，而不是等真机截图才发现。 */
const WIDTHS = [320, 360, 375, 390, 414];
const px = (rpxVal, w) => (rpxVal * w) / 750;

function textEm(str) {
  let em = 0;
  for (const ch of String(str)) {
    if (/[\u3000-\u303f\u4e00-\u9fa5\uff00-\uffef]/.test(ch)) em += 1; // CJK / 全角
    else if (/[0-9]/.test(ch)) em += 0.6;
    else if (/[a-zA-Z]/.test(ch)) em += 0.62;
    else em += 0.34; // 空格 / 半角标点 / ¥ . , : ; ( ) % + -
  }
  return em;
}

/** 一个「行」的宽度预算：avail 可用宽度(rpx)；fixed 固定 rpx 之和；
 *  texts = [{t:'文本', f:字号rpx}] 或 [{px: 固定像素}] */
function needsPx(b, w) {
  const fixed = px(b.fixed || 0, w);
  const text = (b.texts || []).reduce((s, t) => {
    if (t.px != null) return s + t.px;
    return s + textEm(t.t) * px(t.f, w);
  }, 0);
  return fixed + text;
}

function checkRow(b) {
  WIDTHS.forEach((w) => {
    const avail = b.availPx != null ? b.availPx : b.avail === 'full' ? w : px(b.avail, w);
    const need = needsPx(b, w);
    check(
      need <= avail + 0.5,
      `[${w}px] ${b.name} 需要 ${need.toFixed(1)}px > 可用 ${avail.toFixed(1)}px` +
        (b.hint ? ` —— ${b.hint}` : '')
    );
  });
}

/* --- 13.1 主界面 Header：胶囊占位 102px（iOS 最坏）+ 固定部分必须放得下 --- */
// 紧凑档固定部分：左内边距 24 + actions 左间距 8 + 搜索最小宽 140 + 设置 56 + 设置左间距 4
// + 右内边距 24，加搜索图标固定 12px（dv-icon 走 px，不随 rpx 缩放）。
// 标题 flex:0 1 auto + min-width:0 + ellipsis 可压缩，故不计入固定部分。
const HEADER_MENU_PAD = 102;
WIDTHS.forEach((w) => {
  const compactFixed = px(24 + 8 + 140 + 56 + 4 + 24, w) + 12;
  const avail = w - HEADER_MENU_PAD;
  check(
    compactFixed <= avail,
    `[${w}px] 主 Header 紧凑档固定部分 ${compactFixed.toFixed(1)}px > 胶囊外可用 ${avail}px`
  );
});

/* --- 13.2 逐页行预算（每个数字都对应 wxss 里的一行真实布局） --- */
[
  {
    name: '统计·分类占比行（图标44+点26+百分比80+金额）',
    avail: 750 - 2 * 28,
    fixed: 14 + 12 + 44 + 12 + 12 + 80,
    texts: [{ t: '¥123,456.78', f: 26 }],
    hint: 'share-row__percent 80rpx 固定 + share-row__amount 禁收缩',
  },
  {
    name: '统计·最大单笔卡（图标56+金额）',
    avail: 750 - 2 * 28,
    fixed: 56 + 16 + 16 + 12,
    texts: [{ t: '¥123,456.78', f: 34 }],
  },
  {
    name: '统计·收支对比行（标签72+进度条最小+金额140）',
    avail: 750 - 2 * 28,
    fixed: 72 + 16 + 16,
    texts: [{ t: '¥123,456.78', f: 24 }],
    hint: 'cmp-val 已改 min-width + 不收缩，进度条让位',
  },
  {
    name: '记账·时间线行（图标76+两侧间距+金额）',
    avail: 750 - 2 * 28 - 2 * 8 - 2 * 2,
    fixed: 76 + 18 + 18,
    texts: [{ t: '¥123,456.78', f: 30 }],
  },
  {
    name: '记账·Hero 大金额 lg（8 字 64rpx）',
    avail: 750 - 2 * 28 - 2 * 32,
    fixed: 0,
    texts: [{ t: '¥12,345.6', f: 64 }],
    hint: 'accounting-panel .hero__expense--lg',
  },
  {
    name: '记账·Hero 大金额 md（11 字 54rpx）',
    avail: 750 - 2 * 28 - 2 * 32,
    fixed: 0,
    texts: [{ t: '¥123,456.78', f: 54 }],
  },
  {
    name: '记账·Hero 大金额 sm（14 字 44rpx）',
    avail: 750 - 2 * 28 - 2 * 32,
    fixed: 0,
    texts: [{ t: '¥1,234,567.89', f: 44 }],
  },
  {
    name: '预算·金额行（¥ + 输入 + /天 + 完成）',
    avail: 750 - 2 * 28 - 2 * 24,
    fixed: 40 + 10 + 10 + 96 + 12,
    texts: [{ t: ' / 天', f: 26 }],
    hint: '预算金额输入至少保留 200rpx 给 8 位数字',
  },
  {
    name: '导入·历史行（文件名 + 统计 meta）',
    avail: 750 - 2 * 28 - 2 * 24,
    fixed: 16,
    texts: [{ t: '1234 笔 · 5 处异常', f: 24 }],
  },
  {
    name: '导入预览·底部双按钮（各占一半）',
    avail: (750 - 2 * 28 - 20) / 2,
    fixed: 2 * 16,
    texts: [{ t: '确认导入 999 笔', f: 30 }],
  },
  {
    name: '周期·规则卡头（金额 + 开关）',
    avail: 750 - 2 * 28 - 2 * 26,
    fixed: 60,
    texts: [{ t: '+¥123,456.78', f: 48 }],
  },
  {
    name: '日价·列表行（图标76+右侧日价+箭头）',
    avail: 750 - 2 * 28 - 2 * 10,
    fixed: 76 + 18 + 18 + 6 + 34,
    texts: [{ t: '¥12,345.67', f: 30 }],
  },
  {
    name: '搜索·账单行（分类图标 + 金额）',
    avail: 750 - 2 * 28 - 2 * 24,
    fixed: 64 + 16 + 16,
    texts: [{ t: '¥123,456.78', f: 28 }],
  },
  {
    name: '分类管理·行（图标 + 名称 + 归档按钮）',
    avail: 750 - 2 * 28 - 2 * 24,
    fixed: 44 + 18 + 12 + 40,
    texts: [{ t: '归档', f: 24 }],
  },
  {
    name: '日价详情·Hero lg（8 字 72rpx）',
    avail: 750 - 2 * 28 - 2 * 32,
    fixed: 0,
    texts: [{ t: '¥12,345.6', f: 72 }],
  },
  {
    name: '日价详情·Hero md（11 字 60rpx）',
    avail: 750 - 2 * 28 - 2 * 32,
    fixed: 0,
    texts: [{ t: '¥123,456.78', f: 60 }],
  },
  {
    name: '日价详情·Hero sm（14 字 48rpx）',
    avail: 750 - 2 * 28 - 2 * 32,
    fixed: 0,
    texts: [{ t: '¥1,234,567.89', f: 48 }],
  },
  {
    name: '设置·行（标签 + 右侧提示 + 箭头）',
    avail: 750 - 2 * 28 - 2 * 24,
    fixed: 6 + 24,
    texts: [{ t: '已开启 ¥1,234.56/天', f: 26 }],
  },
].forEach(checkRow);

/* ============================================================
   14. 平台差异契约（Skyline）
   ============================================================ */
// 14.1 Bottom Sheet 面板：高度随内容自适应 + 上限 88% + 底部安全区。
// 说明（实测）：Skyline 不支持 overflow 滚动，内容区必须是 scroll-view 才能滚；
// 而 scroll-view 必须有**确定高度**（给 auto / 只给 max-height 会塌成 0，
// 面板只剩标题、内容整块溢出屏外，v1.4.0 已实测复现并回滚）。
// 因此契约是：scroll-view + JS 预算后内联 px 高度（utils/sheet-scroll.js）。
const bsCss = cssRules(read('components/bottom-sheet/bottom-sheet.wxss'));
has(bsCss['.bs-panel'], 'max-height', '88%', '弹层面板高度上限');
check(/padding-bottom\s*:\s*env\(safe-area-inset-bottom\)/.test(bsCss['.bs-panel'] || ''),
  '弹层面板需要 padding-bottom: env(safe-area-inset-bottom)');
has(bsCss['.bs-body'], 'min-height', '0', '弹层内容区可被 flex 压缩（否则面板会被撑破）');
const bsWxml = read('components/bottom-sheet/bottom-sheet.wxml');
check(/<scroll-view[^>]*scroll-y[^>]*style="height:\{\{bodyH\}\}px"/.test(bsWxml),
  '弹层内容区必须用 scroll-view 且带确定 px 高度（Skyline 下无确定高度会塌成 0，见 v1.4.0 UI 审计 UI-01）');
check(fs.existsSync(path.join(ROOT, 'utils/sheet-scroll.js')), '弹层高度预算模块 utils/sheet-scroll.js 必须存在');

// 14.2 底部安全区：内容可滚到底的页面必须在最后一个元素上留 safe-area。
// Skyline 下 scroll-view 的 padding 不生效（实测：补 padding-bottom:env(...) 后间距不变），
// 所以留白必须压到最后一个元素自己的 margin / height 上。
const cmAdd = cssRules(read('pages/category-manage/category-manage.wxss'))['.cm-add'];
check(/safe-area-inset-bottom/.test(cmAdd), '分类管理「添加分类」按钮需 safe-area 下边距（实测底边距屏底 6.9px）');
const dayCardLast = cssRules(read('pages/search/search.wxss'))['.day-card:last-child'];
check(/safe-area-inset-bottom/.test(dayCardLast), '搜索页最后一张日卡需 safe-area 下边距');
const rcFoot = cssRules(read('pages/recurring/recurring.wxss'))['.rc-foot'];
check(/safe-area-inset-bottom/.test(rcFoot), '周期记账列表底部留白需叠加 safe-area');
check(/class="rc-foot"/.test(read('pages/recurring/recurring.wxml')), '周期记账页应使用 .rc-foot 留白（不再写死 60rpx）');

// 14.3 金额列不得写死宽度把数字挤出去（统计收支对比行）
const cmpVal = cssRules(read('components/statistics-panel/statistics-panel.wxss'))['.cmp-val'];
has(cmpVal, 'min-width', '140rpx', '统计对比金额列最小宽度');
has(cmpVal, 'flex-shrink', '0', '统计对比金额列禁止收缩');
has(cmpVal, 'white-space', 'nowrap', '统计对比金额列单行');

console.log('\nui-layout tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL UI LAYOUT TESTS PASSED');
