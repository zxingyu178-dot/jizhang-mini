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

console.log('\nui-layout tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
console.log('ALL UI LAYOUT TESTS PASSED');
