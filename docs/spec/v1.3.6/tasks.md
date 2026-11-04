# v1.3.6 执行任务清单

> 规格：[spec.md](./spec.md)。按 Gate 顺序连续执行，不逐文件等待确认。
> 冻结：数据层、金额/日价/预算/周期算法、导入、备份格式、主题、Bottom Sheet 动画、viewpad 监听机制。

## Gate 0 — 输入审计

- [x] T0.1 生成 `docs/V1.3.6_INPUT_AUDIT.md`：13 个输入清单、事件接线现状、问题/级别、计划修改与不改文件。
- [x] T0.2 复核无 `<textarea>`、导入/设置/外观/备份页无输入框。

## Gate 1 — 公共机制

- [x] T1.1 `utils/keyboard.js` 新增 `releaseInputFocus(component, focusKey, fallbackMs)`，`hideKeyboard` 实现与导出保持不变。
- [x] T1.2 `utils/viewport.js` 新增只读 `isKeyboardOpen()`，复用既有 `lastKeyboardHeight`，不新增监听。
- [x] T1.3 扩展 `tests/keyboard-viewport.test.js` 覆盖两个新增能力，保留全部原用例。

## Gate 2 — 业务页面接线

- [x] T2.1 bill-form：金额 focus/blur/done + 商户/备注 done confirm；`applyAmount` 复用两位小数与 canSubmit；删除前收键盘。
- [x] T2.2 daily-value-form：金额 focus/blur/done + 名称/备注 done confirm；不改日价作用域/起算日/buildEditPatch。
- [x] T2.3 recurring：金额与间隔独立焦点 + 各自完成按钮 + 备注 done confirm；删除与补记确认前收键盘。
- [x] T2.4 budget-settings：金额完成按钮 + 保存前收键盘 + `_saving` 防重复。
- [x] T2.5 search：`bindconfirm` 清 debounce、立即筛选、收键盘。
- [x] T2.6 category-manage：Emoji/名称 done confirm，不保存不关 Sheet。
- [x] T2.7 五个 WXSS 新增完成按钮样式（88rpx 触控 / 主题变量 / hover 反馈），不挤压金额。

## Gate 3 — 关闭、弹窗、返回、视口

- [x] T3.1 page-header：键盘打开时第一次返回只收键盘，第二次才返回；无键盘保持原逻辑；保留 `_backing`。
- [x] T3.2 回归 Bottom Sheet 快速开关 / 遮罩连点（不改代码，仅测）。
- [x] T3.3 删除账单、删除周期、周期补记确认均先收键盘；取消保留表单。
- [x] T3.4 确认未新增键盘高度监听，viewport 恢复路径复用。

## Gate 4 — 自动化

- [x] T4.1 新增 `tests/input-interaction.test.js`（动态行为 + 静态接线契约）。
- [x] T4.2 加入 `tests/run-all.js`。
- [x] T4.3 E2E 新增 T26（金额完成→继续填写→保存→回读→清理）与 T27（搜索 confirm）。
- [x] T4.4 执行 `npm test`、`npm run e2e`、`npm run release:check`、`npm run theme:audit`、`npm run contrast:audit`，原样记录结果。

## Gate 5 — 验收

- [ ] T5.1 检查模拟器截图：完成按钮深浅主题、窄屏 320/390 不挤压金额。（部分完成：浅色模拟器截图已复核并通过；深色与 320 窄屏沿用 v1.3.5 布局结论 + 主题/对比度审计，未重新截图）
- [x] T5.2 真机 iPhone / Android 清单交用户执行；未测项标注「未测试」，不冒充通过。

## Gate 6 — 版本与交付

- [x] T6.1 `utils/version.js`、`package.json` → `1.3.6`；`CHANGELOG.md` 增加 1.3.6 条目。
- [x] T6.2 生成 `docs/HANDOFF_v1.3.6.md`（改动、测试原始结果、SHA、真机未测说明）。
- [x] T6.3 生成轻量验收 ZIP：HANDOFF、INPUT_AUDIT、DEV_LOG/TASKS/TEST_REPORT/GIT_STATUS、CHANGELOG、本次核心源码/测试、必要模拟器截图。
- [x] T6.4 检查 diff / status / 数据层未改 / 无重复键盘工具 / 无遗漏输入框 / 无失焦丢值 / 无重复保存。
- [x] T6.5 提交并推送 `origin main`，记录完整 SHA，确认本地与远程一致。
