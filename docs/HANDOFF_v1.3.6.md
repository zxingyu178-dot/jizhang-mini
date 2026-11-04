# HANDOFF — 随时随地大小记 v1.3.6（Keyboard & Input Reliability）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**1.3.6**
- AppID：`wxcdcf83d9191065d9`（以 `project.config.json` 为唯一权威）
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md`）
- 本版定位：**输入交互可靠性**。不新增业务功能、不升级数据合同、不引入第三方依赖。
- 完成状态：**READY_FOR_REVIEW**（自动化通过；模拟器浅色截图已复核；真机 iPhone / Android 待用户执行，助手不代签）

---

## 0. 结论速览

- 核心痛点已修复：记账 / 日价 / 周期 / 预算四个金额输入框（`type="digit"`）新增页面内独立「完成」按钮，点击后先释放 focus，再调用 `utils/keyboard.js` 统一收键盘，不再依赖系统数字键盘的完成键。
- 完成按钮只做一件事——收键盘：不同步保存、不关闭 Bottom Sheet、不触发提交；金额文本与 `canSubmit` 原样保留，再次点击金额可重新聚焦。
- 文本类输入（商户 / 备注 / 日价名称 / 周期备注 / 分类名称 / Emoji）统一 `confirm-type="done"` + `bindconfirm`；搜索使用 `confirm-type="search"` + `bindconfirm`，确认后清 debounce、立即筛选并收键盘。
- `bindblur` 只同步值与焦点状态，**不再主动收键盘**，金额 → 商户 → 备注可以自然连续填写。
- 删除账单 / 删除周期 / 周期补记确认：先收键盘再弹 `wx.showModal`；Header 返回在键盘打开时第一次只收键盘，第二次才返回。
- 公共能力：`utils/keyboard.js` 新增 `releaseInputFocus()`；`utils/viewport.js` 新增只读 `isKeyboardOpen()`（复用既有 `lastKeyboardHeight`，**未新增第二套键盘高度监听**）。
- 自动化结果：`npm test` **39/39 套件通过**（新增 `input-interaction.test.js` 97 项）；`npm run e2e` **27/27 通过**（新增 T26 / T27）；`theme:audit`、`contrast:audit` 通过；`release:check` 在补齐本文件后复跑通过。
- 冻结项零改动：Bill V3 / Backup V3 / Recurring Store V1 / Budget V1 数据合同、金额 / 日价 / 预算 / 周期算法、CSV 导入、备份格式、主题系统、统计算法、Bottom Sheet 动画机制均未修改。

---

## 1. 输入点清单（13 个）

| # | 页面 / 组件 | 字段 | type | 收键盘方式 |
| --- | --- | --- | --- | --- |
| 1 | bill-form | 金额 | digit | 页面内「完成」`onAmountDone` |
| 2 | bill-form | 商户 | text | `confirm-type=done` + `onMerchantConfirm` |
| 3 | bill-form | 备注 | text | `confirm-type=done` + `onNoteConfirm` |
| 4 | daily-value-form | 名称 | text | `confirm-type=done` + `onTitleConfirm` |
| 5 | daily-value-form | 金额 | digit | 页面内「完成」`onAmountDone` |
| 6 | daily-value-form | 备注 | text | `confirm-type=done` + `onNoteConfirm` |
| 7 | recurring | 金额 | digit | 页面内「完成」`onAmountDone` |
| 8 | recurring | 间隔 | number | 页面内「完成」`onIntervalDone` |
| 9 | recurring | 备注 | text | `confirm-type=done` + `onNoteConfirm` |
| 10 | budget-settings | 金额 | digit | 页面内「完成」`onAmountDone` |
| 11 | search | 搜索词 | text | `confirm-type=search` + `onSearchConfirm` |
| 12 | category-manage | Emoji | text | `confirm-type=done` + `onEmojiConfirm` |
| 13 | category-manage | 名称 | text | `confirm-type=done` + `onNameConfirm` |

- 全项目 `<input>` 共 13 个，`<textarea>` 为 0；导入 / 设置 / 外观 / 备份页无输入框。
- 金额与间隔保持原 `digit` / `number`，未改成 `text`；未给 digit 加 `confirm-type` 猜测修复。

---

## 2. 修改文件

### 公共机制
- `utils/keyboard.js`：新增并导出 `releaseInputFocus(component, focusKey, fallbackMs)`；`hideKeyboard` 实现与导出保持不变。
- `utils/viewport.js`：新增 `isKeyboardOpen()`，读取既有 `lastKeyboardHeight`；未新增监听。

### 业务接线
- `components/bill-form/bill-form.{wxml,js,wxss}`：金额 focus/blur/done + 完成按钮；商户 / 备注 confirm；删除账单前收键盘。
- `components/daily-value-form/daily-value-form.{wxml,js,wxss}`：名称 / 金额 / 备注同上；日价业务逻辑未改。
- `pages/recurring/recurring.{wxml,js,wxss}`：金额与间隔独立焦点 + 各自完成按钮；备注 confirm；删除规则 / 补记确认前收键盘。
- `pages/budget-settings/budget-settings.{wxml,js,wxss}`：金额完成按钮；保存前收键盘；`_saving` 防重复。
- `pages/search/search.{wxml,js}`：`onSearchConfirm` 清 debounce、立即筛选、收键盘。
- `pages/category-manage/category-manage.{wxml,js}`：Emoji / 名称 done confirm。
- `components/page-header/page-header.js`：键盘打开时第一次返回只收键盘，第二次才 `navigateBack` / `reLaunch`；保留 `_backing`。

### 测试与文档
- 新增 `tests/input-interaction.test.js`（97 项）。
- 扩展 `tests/keyboard-viewport.test.js`（25 项）。
- `tests/run-all.js` 纳入新套件。
- `tests/e2e/golden-path.js` 新增 T26 / T27。
- 新增 `docs/V1.3.6_INPUT_AUDIT.md`、`docs/spec/v1.3.6/{spec.md,tasks.md}`、本文件。
- `utils/version.js`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md`：版本 1.3.6。

### 明确未改
- 数据层 `data/**` 全部未改；`components/bottom-sheet/**` 未改；`app.wxss` 未改；主题系统、统计算法、导入 / 备份格式未改。

---

## 3. 测试原始结果

### 3.1 npm test（39/39 套件通过）

新增 / 相关套件：

```
keyboard/viewport: 25 passed, 0 failed
input-interaction tests: 97 passed, 0 failed
```

完整汇总：`全部测试套件通过（39/39）`。其余套件计数示例：data 100、accounting 45、statistics 175、donut-hit 51、donut-gesture 22、contrast 30、daily-value 97、budget 135、read-range 17、lazy-compute 52、categories 76、category-visual 52、path-normalize 575、recurring 107、search 80、settings 15、stat-config 25、health 61、storage-integrity 24、duplicate-id 5、protection 17、id-repair 19、strict-read 18、atomic-storage 38、csv-export 22、backup-validator 57、backup-migration 20、disaster-recovery 56、importer 144、theme 79、migtest-sandbox 42、test-registry 78、backup-restore-statistics 16、theme-preserve-flow 34、env 18、ui-layout 76。

### 3.2 npm run e2e（27/27 通过）

新增：
- **T26 金额完成**：FAB → 输入 23.45 → 聚焦 → 点「完成」→ 金额保留、焦点释放、Sheet 保持打开 → 继续填商户 / 备注 → 再次聚焦 / 失焦 → 保存 → 时间线回读金额 / 商户 / 备注 → 删除清理。
- **T27 搜索 confirm**：初始最近列表 → `onSearchConfirm` → 关键词保留、退出最近列表、无匹配结果 0 条。

```
[PASS] T01–T27（27 项）
E2E 全部通过
```

说明：Skyline 下 automator 不暴露 `confirm-type` 属性，T27 只验证 confirm 行为；静态接线契约由 `tests/input-interaction.test.js` 覆盖。

### 3.3 release:check

首次执行因 `docs/HANDOFF_v1.3.6.md` 尚未生成报 1 个 FAIL；补齐本文件后复跑结果见第 6 节（版本一致性、数据合同冻结、包体、单测、主题 / 对比度全部 PASS；`libVersion=latest` 为既有 WARN）。

### 3.4 theme:audit

```
白名单直接色：13 处；违规(FAIL)：0 处；JS 白色提醒(WARN)：3 处。
主题审计通过：未发现非白名单硬编码颜色（存在 3 项 JS WARN，不阻断发布）。
```

3 项 WARN 为既有 `category-donut`、`category-icon`、`cumulative-trend` 的 JS 白色硬编码，本版未触碰。

### 3.5 contrast:audit

```
[PASS] dark（L=60）worst=3.145 @hue240 bg=card-start
[PASS] light（L=34）worst=3.249 @hue60 bg=page
对比度审计通过：两主题圆环在全部候选背景上 worst 均 ≥3:1。
```

---

## 4. 模拟器截图

目录 `docs/screenshots/v1.3.6/`：
- `bill_form_amount_done_light_simulator.png`：记账金额行右侧「完成」按钮，未挤压金额、未溢出屏幕。
- `search_confirm_light_simulator.png`：搜索 confirm 后空态。

命名均带 `_simulator`，**不代表真机**。深色主题与 320 窄屏本版未重新截图：完成按钮全部使用既有主题 token（`--glass-input` / `--glass-input-border` / `--text-secondary` / `--selected-bg` / `--text-primary`），已由 `theme:audit` / `contrast:audit` 与 v1.3.5 窄屏结论覆盖；此项在任务清单 T5.1 如实标记为部分完成。

---

## 5. 真机验收清单（用户执行，助手未测）

> 以下全部为 **未测试**，不得视为通过。

### iPhone（重点）
1. 记账：点金额唤起数字键盘 → 输入金额 → 点行内「完成」→ 键盘收起，金额不丢，Sheet 不关闭。
2. 点「完成」后直接点商户 / 备注，可正常聚焦并输入；商户 / 备注键盘「完成」可收起。
3. 再次点击金额可重新聚焦；失焦不自动收键盘、金额不丢。
4. 日价：名称 / 金额 / 备注同上。
5. 周期：金额与间隔各自「完成」，互不影响；备注键盘完成可用。
6. 预算设置：金额「完成」后保存，键盘先收起，只保存一次，不重复跳转。
7. 搜索：键盘「搜索」键立即出结果并收起键盘。
8. 分类管理：Emoji / 名称键盘完成后收起，菜单不关闭、不误保存。
9. 删除账单 / 删除周期 / 周期补记：先收键盘再弹确认框；取消后表单仍在。
10. 页面返回：键盘打开时第一次返回只收键盘，第二次才返回。

### Android
1. 同一套 1–10 项。
2. 数字键盘种类（九宫格 / 全键盘）下「完成」按钮均可收起键盘。
3. 返回键行为：键盘打开时按系统返回键应收键盘而非退出页面（如系统行为不同，请记录机型与系统版本）。

请将结果按「机型 / 系统版本 / 微信版本 / 通过项 / 失败项 / 截图」回填到发布验收记录；未执行项保持「未测试」。

---

## 6. 复验命令

```bash
npm test
npm run e2e
npm run release:check
npm run theme:audit
npm run contrast:audit
```

（本机 npm 统一入口：`D:\AIHome_2.0_L1_L2\environment\bin\npm.cmd`。）

---

## 7. Git

- 实现提交：`<见提交后回填>`
- 文档提交：`<见提交后回填>`
- 远端：`origin/main`，推送后本地与远程 SHA 一致（见回填）。
