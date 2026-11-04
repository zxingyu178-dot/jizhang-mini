# Daily Value Mini v1.3.6 规格（Keyboard & Input Reliability）

> 依据：`v1.3.6 开发任务书`（Gate 0 → Gate 6）。
> 基线：`main` = `697c25203c3891040dd2d33eb2cd82b160b32b30`（v1.3.5），工作区干净（仅有历史验收 ZIP 未跟踪）。
> 目标：iPhone 微信小程序中，金额输入后可通过页面内「完成」主动收起数字键盘；所有输入控件行为统一、可预期；不增加业务功能、不改数据层。

## 1. 范围与冻结

允许修改：输入控件 WXML / WXSS / 对应 JS 输入交互、`utils/keyboard.js`（仅新增辅助方法）、`utils/viewport.js`（仅新增只读状态）、`components/page-header` 返回逻辑、测试与文档、版本号。

冻结不改：Bill V3 / Backup V3 数据结构、金额 / 日价 / 预算 / 周期计算与生成规则、CSV 导入、备份格式、主题 token、统计与搜索算法、Bottom Sheet 关闭动画与序号机制、第三方依赖。

明确禁止：只加 `confirm-type` 猜修复；把 digit/number 改成 text；重写 `utils/keyboard.js` 或 Bottom Sheet；在 blur 中无条件收键盘；完成按钮触发保存或关闭 Sheet；完成时清空输入；多套键盘高度监听；伪造真机结果。

## 2. Gate 0：输入控件完整清单

项目共 13 个 `<input>`，无 `<textarea>`，`packages/importer`、设置、外观、备份页无输入框。

| # | 文件 | 用途 | type | input | focus | blur | confirm | 当前 confirm-type | Sheet | 问题 | 级别 | 本次处理 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | components/bill-form/bill-form.wxml:11 | 金额 | digit | 有 | `autoFocus`（恒 false） | 无 | 无 | 无 | 是 | 数字键盘无主动完成；失焦不同步最终值 | P0 | 加完成按钮 + amountFocused + blur 同步 |
| 2 | components/bill-form/bill-form.wxml:64 | 商户 | text（默认） | 有 | 无 | 无 | 无 | 无 | 是 | 系统完成键未接线 | P1 | confirm-type=done + bindconfirm |
| 3 | components/bill-form/bill-form.wxml:70 | 备注 | text（默认） | 有 | 无 | 无 | 无 | 无 | 是 | 同上 | P1 | 同上 |
| 4 | components/daily-value-form/daily-value-form.wxml:5 | 名称 | text（默认） | 有 | `autoFocus`（恒 false） | 无 | 无 | 无 | 是 | 系统完成键未接线 | P1 | confirm-type=done + bindconfirm |
| 5 | components/daily-value-form/daily-value-form.wxml:19 | 金额 | digit | 有 | 无 | 无 | 无 | 无 | 是 | P0 主修复 | P0 | 完成按钮 + amountFocused + blur 同步 |
| 6 | components/daily-value-form/daily-value-form.wxml:56 | 备注 | text（默认） | 有 | 无 | 无 | 无 | 无 | 是 | 系统完成键未接线 | P1 | confirm-type=done + bindconfirm |
| 7 | pages/recurring/recurring.wxml:67 | 周期金额 | digit | 有 | 无 | 无 | 无 | 无 | 是 | P0 主修复 | P0 | 完成按钮 + amountFocused + blur 同步 |
| 8 | pages/recurring/recurring.wxml:79 | 周期间隔 | number | 有 | 无 | 无 | 无 | 无 | 是 | 数字键盘无完成；失焦不同步 | P1 | 独立 intervalFocused + 完成按钮 + blur 同步 |
| 9 | pages/recurring/recurring.wxml:140 | 周期备注 | text | 有 | 无 | 无 | 无 | 无 | 是 | 系统完成键未接线 | P1 | confirm-type=done + bindconfirm |
| 10 | pages/budget-settings/budget-settings.wxml:23 | 每日预算 | digit | 有 | 无 | 无 | 无 | 无 | 否 | 保存前键盘未收；可能重复保存 | P0 | 完成按钮 + amountFocused + 保存前收键盘 + `_saving` |
| 11 | pages/search/search.wxml:10 | 搜索词 | text（默认） | 有 | 无 | 无 | 无 | search | 否 | 有 confirm-type 无 bindconfirm | P1 | 补 bindconfirm，清 debounce + 立即筛选 + 收键盘 |
| 12 | pages/category-manage/category-manage.wxml:87 | Emoji | text | 有 | 无 | 无 | 无 | 无 | 是 | 系统完成键未接线 | P1 | confirm-type=done + bindconfirm |
| 13 | pages/category-manage/category-manage.wxml:98 | 分类名称 | text | 有 | 无 | 无 | 无 | 无 | 是 | 系统完成键未接线 | P1 | confirm-type=done + bindconfirm |

不需修改：`components/bottom-sheet`（已有序号 + hideKeyboard + 300ms 关闭动画，仅回归）、`utils/viewport` 监听机制（仅新增只读查询）、`app.wxss` 三档输入高度 token、导入/设置/外观/备份页。

## 3. 统一键盘机制

### 3.1 复用与扩展

- 保留 `utils/keyboard.hideKeyboard(fallbackMs)` 原实现与 120ms 兜底，不改调用契约。
- 新增 `utils/keyboard.releaseInputFocus(component, focusKey, fallbackMs)`：先把组件内独立 focus 标记置 `false`（`setData` 回调后），再调用 `hideKeyboard`。所有金额/间隔「完成」统一走该方法。
- `utils/viewport.js` 新增只读 `isKeyboardOpen()`：返回既有 `lastKeyboardHeight > 0`，不新增监听、不新增第二套状态。

### 3.2 输入类型分工

| 类型 | 完成方式 | 事件职责 |
|---|---|---|
| digit / number | 页面内独立「完成」按钮（始终可见） | 完成 = 释放焦点 + 收键盘；不保存、不关 Sheet、不清值 |
| text | `confirm-type="done"` + `bindconfirm` | confirm = 同步最新值 + 收键盘；不提交表单 |
| search | `confirm-type="search"` + `bindconfirm` | 清 debounce + 同步关键词 + 立即筛选 + 收键盘 |
| textarea | 项目不存在 | 记录为无 |

`bindblur` 只同步值与焦点标记，绝不调用 hideKeyboard；`bindinput` 仍是值同步主路径。

### 3.3 焦点键（独立、默认 false）

- bill-form：`amountFocused`
- daily-value-form：`amountFocused`
- recurring：`amountFocused`、`intervalFocused`
- budget-settings：`amountFocused`

同一页面多个数字输入互不共享状态；`focus="{{amountFocused}}"` / `focus="{{intervalFocused}}"` 替代恒 false 的 `autoFocus`。

### 3.4 「完成」按钮视觉契约

- 位于金额/间隔输入行最右侧，`flex-shrink: 0`，不挤压输入。
- 高度 88rpx（约 44px 触控），`min-width: 96rpx`，`box-sizing: border-box`，字号 24rpx。
- 仅使用主题变量：`--glass-input`、`--glass-input-border`、`--text-secondary`、`--selected-bg`、`--text-primary`，深浅主题自动适配。
- `hover-class` + `hover-stay-time="60"` 提供点击反馈；不使用新配色、不使用大按钮。
- 始终可见，不随焦点显示/隐藏。

## 4. 文件级修改

### 4.1 components/bill-form

- wxml：金额加 `focus="{{amountFocused}}"`、`bindfocus="onAmountFocus"`、`bindblur="onAmountBlur"`，行尾加 `catchtap="onAmountDone"` 的 `.bf-amount__done`；商户/备注加 `type="text"`、`confirm-type="done"`、`bindconfirm`。
- js：删 `autoFocus`，加 `amountFocused:false`；`reset/edit` 置 false；抽出 `applyAmount(v)`（保留两位小数限制与 `canSubmit`）；`onAmount` / `onAmountBlur` 复用；`onAmountFocus`、`onAmountDone`（`releaseInputFocus`）；`onMerchantConfirm` / `onNoteConfirm` 同步值 + `hideKeyboard`；`onDelete` 先 `hideKeyboard().then(showModal)`，取消不清表单。
- wxss：新增 `.bf-amount__done` / `--hover`。

### 4.2 components/daily-value-form

- wxml：金额同上；名称/备注加 `confirm-type="done"` + `bindconfirm`；移除恒 false 的 `focus="{{autoFocus}}"`。
- js：删 `autoFocus`，加 `amountFocused`；`reset/edit` 置 false；抽 `applyAmount(v)`；`onTitleConfirm` / `onNoteConfirm` 同步值（名称需 `recheck()`）后收键盘。
- wxss：新增 `.df-amount__done` / `--hover`。
- 冻结：`daily-value-only` 作用域、`ledgerImpact`、起算日期、`buildEditPatch`、原交易时间。

### 4.3 pages/recurring

- wxml：金额 + `amountFocused`/focus/blur/完成；间隔 + `intervalFocused`/focus/blur/完成（放在单位文字后）；备注 `confirm-type="done"` + `bindconfirm`。
- js：加两个焦点键（`onAdd/onEdit` 置 false）；`onAmountBlur` / `onIntervalBlur` 用现有夹取逻辑同步；`onAmountDone` / `onIntervalDone` 各管各键；`onNoteConfirm` 同步 + 收键盘；`onDelete` 先收键盘再 `showModal`；`onSave` 仅在触发「补记周期账单」确认框前先收键盘，取消后编辑器保持打开、键盘保持收起；生成/补记/编辑生效时间规则冻结。
- wxss：新增 `.re-amount__done`、`.re-interval__done` 及 hover。

### 4.4 pages/budget-settings

- wxml：金额加焦点三事件 + `.bs2-amount__done`（放在「/ 天」后）。
- js：加 `amountFocused`；`onAmountFocus/Blur/Done`；`onSave` 先校验，再置 `_saving = true`、`amountFocused=false`，`hideKeyboard().then()` 内执行原 `saveBudgetRule → showToast → setTimeout(navigateBack,500)`；`_saving` 防重复。
- wxss：新增 `.bs2-amount__done` / hover。

### 4.5 pages/search

- wxml：`bindconfirm="onSearchConfirm"`。
- js：require `utils/keyboard`；`onSearchConfirm(e)` 清 debounce → `setData({kw:e.detail.value})` → `applyFilters()` → `hideKeyboard()`；保留结果、清空按钮、日期/分类筛选与防抖不变。

### 4.6 pages/category-manage

- wxml：Emoji/名称加 `confirm-type="done"` + `bindconfirm`。
- js：require `utils/keyboard`；`onEmojiConfirm` / `onNameConfirm` 复用现有 `onEmoji` / `onName` 同步（含 `recheck`）后收键盘；不保存、不关 Sheet；重名检测与 1–8 字限制不变。

### 4.7 components/page-header（Gate 3.3）

- 复用 `utils/viewport.isKeyboardOpen()`：键盘打开时第一次返回只收键盘（`hideKeyboard`），第二次才执行原 `triggerEvent('back')` + `navigateBack/reLaunch`；保留 `_backing` 防连点；无键盘时行为与原来一致（先收键盘再返回）。
- 不改页面栈结构、不新增返回事件。

## 5. Gate 3 回归边界

- Bottom Sheet、`utils/viewport`、删除账单 / 删除周期 / 周期补记确认均只做「先收键盘再弹框/关闭」的接线，不改原机制。
- 所有取消操作保留原表单值；所有完成操作不触发保存、不关闭 Sheet。
- 键盘关闭后 Header、底部导航、安全区、Sheet 高度恢复依赖既有 `viewport.onRecover`，不新增监听。

## 6. Gate 4 测试与验证

### 6.1 新增 `tests/input-interaction.test.js`

- mock `global.wx`（`env.USER_DATA_PATH` + 可计数 `hideKeyboard`）、`global.Component` / `global.Page`、`getCurrentPages`，捕获组件/页面定义，构造可运行实例。
- 动态断言：完成事件释放焦点并调用键盘工具；金额不丢失；可重新聚焦；连续完成安全；blur 同步并保留两位小数；文本 confirm 不触发 `saved`；周期金额/间隔焦点独立；搜索 confirm 清 debounce 并立即筛选；空金额不生成账单。
- 静态契约：13 个输入的 confirm/focus/done 接线；digit/number 不得出现 `confirm-type`；WXML 不得残留恒 false `autoFocus`；完成按钮 WXSS 关键声明；Bottom Sheet 仍复用 `keyboard.hideKeyboard`。

### 6.2 扩展 `tests/keyboard-viewport.test.js`

- `hideKeyboard` 原有 5 项用例全部保留。
- 新增 `releaseInputFocus`：先置 focus=false 再收键盘、返回 Promise、连续调用安全、组件缺失仍收键盘。
- 新增 `viewport.isKeyboardOpen`：初始 false → 高度 >0 true → 归零 false；`_resetForTest` 复位。

### 6.3 E2E

- T26（`tests/e2e/golden-path.js`）：独立备注 `E2E完成按钮回归` 幂等清理 → FAB 开记账 Sheet → 输入 `128.50` → 点 `.bf-amount__done` → 断言 `amountFocused=false` 且金额保留 → 填写商户/备注、选分类 → 保存 → 重新打开核对金额 128.50 → 删除清理。明确标注这是模拟器结果，不代表 iOS 真机键盘验收。
- T27：搜索页输入关键词 → 触发 `onSearchConfirm` → 断言 debounce 清空、关键词保留、结果立即更新、清空按钮恢复最近账单。
- 全部纳入现有 `tests/e2e/golden-path.js`，由 `npm run e2e` 执行。

### 6.4 命令

```bash
npm test
npm run e2e
npm run release:check
npm run theme:audit
npm run contrast:audit
```

任一失败必须如实记录，不得伪造。E2E 若受开发者工具限制，记录原始错误。

## 7. Gate 5 真机与交付

- 模拟器截图仅命名 `*_simulator`；iPhone / Android 真机验收由用户执行，未执行项在交接中标记「未测试」，不得宣称通过。
- 版本号：`utils/version.js` 与 `package.json` 统一 `1.3.6`。
- 交付：`docs/V1.3.6_INPUT_AUDIT.md`、`docs/HANDOFF_v1.3.6.md`、`CHANGELOG.md` 条目、轻量验收 ZIP（仅本次源码/测试/文档/模拟器截图，不含真实账本与缓存）。
- Git：提交后推送 `origin main`，记录完整本地/远程 SHA；禁止 `reset --hard` / force push / 清理用户修改。

## 8. 验收标准

- 4 个金额输入、1 个间隔输入均可主动收键盘，值不丢，可再次聚焦。
- 文本输入 confirm 可收键盘且不保存；搜索 search 键立即筛选。
- 删除 / 周期补记 / 预算保存 / Header 返回不与键盘冲突；Bottom Sheet 与 viewport 无回归。
- `npm test` 全通过；E2E T26/T27 结果如实；release/theme/contrast 通过。
- 真机结果单独标注；未测试不写成通过。
