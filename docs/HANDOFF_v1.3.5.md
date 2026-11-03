# HANDOFF — 随时随地大小记 v1.3.5（Mobile UI Compatibility）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**1.3.5**
- 品牌名：**随时随地大小记**
- AppID：`wxcdcf83d9191065d9`（18 位，以 `project.config.json` 为唯一权威）
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md`）
- 本版定位：**移动端布局兼容与视觉收口**。不新增业务功能、不升级数据合同、不引入第三方依赖。
- 完成状态：**READY_FOR_REVIEW**（自动化 + 模拟器多尺寸视觉已通过；真机 Gate 待用户本人执行，助手不代签）

---

## 0. 结论速览

- 修复用户指出的**主界面搜索框错位**根因：不是字体问题，而是响应式约束不足 —— 搜索胶囊无最小宽度、文案可换行、设置按钮可被压缩、标题无单行保护，且布局未按「屏幕宽度 − 微信胶囊占位」的真实可用宽度决策。
- 建立**三类输入框垂直规格**（普通 60rpx / 紧凑 64rpx / 大金额 100rpx，均显式 `height` + 同值 `line-height` + `box-sizing: border-box`），统一记账、日价、周期、分类、预算、搜索的输入体验。
- 修复窄屏下的**内容溢出与挤压**：分类网格名称、导入长文件名、导入预览统计与按钮、分类管理行、统计页标题与占比列、备份页信息值。
- 关键产出：`npm test` **38/38 套件通过**（新增 `ui-layout.test.js` 76 项）；`npm run e2e` **25/25 通过**（新增 T25 移动端 Header 胶囊避让）。
- 320 / 360 / 375 / 390 / 414 五档宽度的模拟器截图与 DOM 实测尺寸留档于 `docs/screenshots/v1.3.5/`。
- 数据合同零改动：Bill V3、Backup V3、Recurring Store V1、Budget V1 均未升级；无第三方依赖新增；紫黑毛玻璃视觉主题不变。

---

## 1. 用户报告的问题与根因

用户指出：主界面「搜索账单」在部分手机上错位 / 文字换行，并列出三处 CSS 约束缺失，同时怀疑与 `device.js` 按微信胶囊动态计算 `menuPad` 有关。

核实结论（读真实代码 + 模拟器实测）：

1. `.header__search` 只有 `flex: 1 + max-width`，**没有 `min-width`**，窄屏可被压到极限；
2. `.header__search-text` **没有 `white-space: nowrap`**，被压后正常换行成两行，把 Header 顶破；
3. `.header__setting` 未禁止收缩；`.header__title` 未做单行省略保护；
4. 原判定逻辑只考虑屏幕总宽度，**没有把 `menuPad`（胶囊占位，px，不随 rpx 缩放）计入可用宽度**，窄屏时胶囊占比更大，实际可用宽度远小于屏幕宽度。

用户判断「不能只加一句 `white-space: nowrap` 就结束」成立：仅加单行约束，宽度不足时文字仍会溢出。

---

## 2. Gate 0：UI 问题清单（检查结果）

| 页面 | 检查内容 | 结论 |
| --- | --- | --- |
| 主界面 | 标题 / 搜索 / 设置是否同一行 | 窄屏换行、按钮可能被压缩（**已修**） |
| 搜索页 | 输入框宽度 / placeholder / 清除按钮 | `defaultContentBox` 未配 `border-box`，placeholder 窄屏被裁半句（**已修**） |
| 记账 | 金额 / 商户 / 备注对齐 | 普通输入无高度 / 行高（**已修**） |
| 日价 | 名称 / 金额 / 分类排列 | 普通输入同上；分类名无单行省略（**已修**） |
| 周期 | 金额 / 间隔 / 备注对齐 | 三套高度不一致且无行高；编辑器缺左右内边距（**已修**） |
| 分类 | 输入框 / 分类名是否溢出 | Emoji 输入无行高；编辑器缺左右内边距；分类行名称可被挤压（**已修**） |
| 预算 | 金额输入和单位是否挤压 | 原设计规范，仅补 `border-box` / `padding` / `flex-shrink`（**加固**） |
| 导入 | 文件名 / 表格 / 统计卡片 | 长文件名不省略、统计列可被压（**已修**） |
| 预览 / 结果 | 统计数字、样例、按钮、安全区 | 数字 / 金额可被压；结果页缺底部安全区（**已修**） |
| 备份 | 按钮 / 说明 / 安全区 | 信息值无省略；末段缺底部安全区（**加固**） |
| 统计 | 月份标题 / 箭头 / 占比列 | 标题无省略、箭头与占比列可被压（**已修**） |

---

## 3. 修改内容（按 Gate）

### Gate 1：统一移动端 Header

涉及文件：`pages/main/main.js`、`pages/main/main.wxml`、`pages/main/main.wxss`、`components/page-header/page-header.{js,wxml,wxss}`。

- **紧凑模式判定改为按真实可用宽度**（`computeHeaderCompact`）：`windowWidth − menuPad` 与「常规布局最小需求」比较；最小需求按 rpx 折算再加 `dv-icon` 固定 px（516rpx 折算 + 14px + 2px 余量）。不足则 `headerCompact = true`。
- **紧凑样式**（`.header--compact`）：标题 30rpx、搜索胶囊 140–200rpx、图标 12px、文案 22rpx、间距收紧。375 / 390 / 414 不进入紧凑，保持原视觉。
- **CSS 硬约束**：标题 `flex: 0 1 auto + min-width: 0 + nowrap + ellipsis`；搜索胶囊 `min-width: 160rpx + max-width: 300rpx + box-sizing: border-box + overflow: hidden`；图标与文案 `flex-shrink: 0`；文案 `nowrap`；设置按钮 `flex: 0 0 auto`。
- **系统字体放大兜底**（`checkHeaderOverflow`，`onReady`）：`wx.createSelectorQuery` 量标题与搜索文案实际高度，超过单行高度 1.7 倍即强制进入紧凑模式；查询失败静默（CSS 约束仍兜底）。
- **二级页 Header 胶囊避让**：`page-header` 与主 Header 同口径计算 menuPad，并在根节点注入 `padding-right`，搜索页输入框与各页标题不再伸到胶囊下方。

### Gate 2：输入框视觉规范统一

新增全局 token（`app.wxss`）：`--input-h-normal: 60rpx`、`--input-h-compact: 64rpx`、`--input-h-amount: 100rpx`。

| 类型 | 适用位置 | 统一属性 |
| --- | --- | --- |
| 普通输入 | 记账商户 / 备注、日价名称 / 备注、周期备注、分类名称、搜索框 | `height` + 同值 `line-height` + `padding: 0` + `box-sizing: border-box` + `min-width: 0` |
| 紧凑输入 | 周期间隔、分类 Emoji | 固定宽高 + 同值行高 + 居中 |
| 大金额输入 | 记账、日价、周期 | `--input-h-amount`（100rpx）+ 同值行高，保留大字号；预算金额保留原 80rpx / 52rpx |

未对全局 `input` 做粗暴重置；已正常的金额输入只补 `padding: 0` 与 `box-sizing`，视觉不变。

### Gate 3：小屏幕布局检查与溢出修复

- 分类网格：日价 `.df-cat__name` 与记账 `.bf-cat__name` 统一单行省略；`.df-cat` 补 `overflow: hidden`，8 字分类名不再撑高格子。
- 分类管理：`.cm-row__name` 单行省略、归档 / 恢复按钮 `flex-shrink: 0`；`.ce` 补左右内边距。
- 周期编辑器：`.re` 补左右内边距 / 盒模型；金额、间隔、备注三类输入统一规格。
- 导入页：长文件名单行省略、时间与笔数固定不收缩、来源卡片双按钮单行省略、底部补安全区。
- 导入预览：统计数字与样例金额固定不收缩；底部双按钮等分 + 单行省略。
- 导入结果：标题 / 说明可换行不溢出；底部补安全区。
- 备份与恢复：信息值省略；末段补安全区。
- 统计页：月份标题单行省略、月份箭头 / 占比列 / 金额列固定不收缩。
- 搜索页：输入容器与输入框显式盒模型 + 高度 + 行高；窄屏 placeholder 自动缩短。

---

## 4. 测试真实结果

| 命令 | 结果 |
| --- | --- |
| `npm test` | **38/38 套件通过，0 失败**（新增 `ui-layout.test.js`，run-all 已注册） |
| `npm run e2e` | **T01–T25 全绿 25/25，0 失败**（320px 与 390px 各跑一轮通过） |
| `npm run theme:audit` | 违规 FAIL 0，3 项 JS 白色 WARN（历史遗留，不阻断） |
| `npm run contrast:audit` | dark worst 3.145、light worst 3.249，均 ≥3:1，PASS |
| `node scripts/release-check.js --no-tests` | FAIL 0、WARN 1（libVersion 仍 latest，用户侧决策项） |

新增 / 变化的测试：

- `tests/ui-layout.test.js`（**新增，76 项**）：解析 `app.wxss`、各页面 / 组件 wxss 与 `app.json`，逐条断言布局契约（Header 单行与最小宽度、设置按钮不收缩、page-header 胶囊避让、三类输入框高度 / 行高 / 盒模型、分类名省略、导入与备份安全区等）。任何一条被回退都会立刻失败。
- `tests/e2e/golden-path.js` T25（**新增**）：真实模拟器内断言主标题与「搜索账单」保持单行、标题右边界不越过胶囊、设置按钮右边界不进入胶囊且宽度未被压缩、搜索胶囊保留最小宽度、搜索页输入框右边界不进入胶囊。

---

## 5. 多尺寸视觉与尺寸验证（模拟器）

机型映射（微信开发者工具内置机型）：

| 宽度 | 机型 | 备注 |
| --- | --- | --- |
| 320px | iPhone 5（320×568 @2x） | 最窄，触发紧凑 Header；另加「系统最大字号 26」一轮 |
| 360px | Nexus 5（Android） | Android 窄屏 |
| 375px | iPhone 6/7/8 | 基准 |
| 390px | iPhone 12/13 (Pro) | 项目历史默认机型，E2E 全量在此跑 |
| 414px | iPhone 6/7/8 Plus | 宽屏，确认不被拉伸异常 |

留档目录：`docs/screenshots/v1.3.5/`

```
docs/screenshots/v1.3.5/
├── 320/                    # 深色主界面、记账、日价、搜索、周期、分类、预算、导入、备份、统计 + 浅色 3 张 + 导入预览/结果
├── 320-font26/             # 320px + 系统最大字号（主界面 / 搜索 / 记账 / 日价 / 周期 / 分类 / 统计）
├── 360/main.png            # Android 窄屏主界面
├── 375/main.png            # 基准机型主界面
├── 390/main.png            # 默认机型主界面
├── 390/import-preview.png、390/import-result.png
├── 414/                    # 同 320 页面集合（宽屏回归）
├── e2e-320/                # 320px 下 E2E 全量截图（14 张）
├── e2e-390/                # 390px 下 E2E 全量截图（14 张，含 T25）
├── measurements-320.json   # DOM 实测尺寸（Header / 输入框 / 导入等）
├── measurements-414.json
└── measurements-320-font26.json
```

关键 DOM 实测（`measurements-*.json`）：

| 指标 | 320px | 414px |
| --- | --- | --- |
| 标题高度（单行判据） | 15px（紧凑，单行） | 24px（单行） |
| 「搜索账单」文案高度 | 9px（单行） | 13px（单行） |
| 设置按钮右边界 vs 胶囊左边界 | 222.1 ≤ 226 **PASS** | 316.1 ≤ 320 **PASS** |
| 搜索页输入框右边界 vs 胶囊左边界 | 222.1 ≤ 226 **PASS** | 316.1 ≤ 320 **PASS** |
| 搜索胶囊宽度 | 85.4px（≥140rpx 折算 59.7px） | 110.6px |
| 记账普通输入高度 | 25.6px（=60rpx 折算） | 33.2px（=60rpx 折算） |
| 记账大金额高度 | 42.7px（=100rpx 折算） | 55.2px（=100rpx 折算） |

系统字体最大（26）+ 320px：主界面、搜索页、记账表单均未出现换行或裁切（`320-font26/`）。

> 说明：上述截图均为**微信开发者工具模拟器**产物，统一 `_simulator` 语义命名，绝不冒充真机截图。

---

## 6. 真机验收（待用户执行，助手不代签）

- **Agent simulator：PASS** —— 单测、E2E、主题 / 对比度 / release 审计、五档宽度视觉与尺寸检查均通过。
- **User physical device：NOT TESTED（待用户）**

待验收项：

1. 真实手机安装体验版后，确认主界面「随时随地大小记 / 搜索账单 / 设置」排列正常、不与微信右上角胶囊重叠；
2. 系统字体设为「大 / 特大」后再看主界面与搜索页（本次已用模拟器最大字号 26 预检）；
3. iOS 微信与 Android 微信各看一遍输入框垂直居中（placeholder 与输入文字基线）；
4. 键盘打开 / 关闭时输入框与弹层是否稳定（本次仅在模拟器确认页面不错位）；
5. 深色 / 浅色主题下逐页确认对比度与视觉一致性；
6. 导入长文件名、分类 8 字名称、周期编辑器在真机上的观感。

---

## 7. 开发纪律遵守情况

| 项目 | 本阶段要求 | 实际 |
| --- | --- | --- |
| 账本数据结构 | 不修改 | 未修改（Bill V3 未动） |
| 统计算法 | 不修改 | 未修改 |
| 预算算法 | 不修改 | 未修改 |
| 日价算法 | 不修改 | 未修改 |
| 导入引擎 | 不修改 | 未修改（仅 wxss 布局） |
| 第三方依赖 | 不增加 | 未增加（`package.json` 依赖列表不变） |
| 视觉主题 | 保留紫黑毛玻璃 | 未改变配色 token，仅新增输入框规格 token |
| 业务功能 | 不增加 | 未增加 |
| 主要工作 | 响应式布局与输入框规范 | 全部改动集中在 wxml / wxss / 少量布局 JS |

其他纪律：

- 本轮**未在开发过程中反复上传测试版本**，按用户要求把上传集中到 v1.3.5 完成验收之后。
- 未删除任何历史 e2e 截图；E2E 覆盖范围扩大后，历史截图（`cumulative-trend`、`module-manage-*`、`year-share-view`）已恢复保留。
- 模拟器机型 / 字号修改通过微信开发者工具自身配置完成，验收后**已还原**为项目原有机型 iPhone 12/13 (Pro)、字号 16、跟随系统。

---

## 8. 已知限制与未完成项

- 真机视觉与键盘行为由用户本人验证，助手不代签。
- `project.config.json` 的 `libVersion` 仍为 `latest`（release-check 唯一 WARN），需在体验版验证后由用户固定为实际验证版本；助手不代猜。
- 320px + 系统最大字号的复核通过模拟器字号档位（26）完成；真机字体渲染（尤其 Android 各家 ROM）仍可能有细微差异，请在真机确认。
- 统计页 `.bcal`（预算日历）与圆环在本轮未改动逻辑；窄屏下未发现横向溢出，但未逐个单元格做像素级回归。

---

## 9. Git 状态

- 分支：`main`；本版功能主体收口提交见下节「提交记录」。
- 改动范围：wxml / wxss（主 Header、page-header、search、bill-form、daily-value-form、recurring、category-manage、budget-settings、backup-restore、statistics-panel、importer 三页）+ 布局 JS（`pages/main/main.js`、`pages/search/search.js`、`components/page-header/page-header.js`）+ 版本号四处同步 + 新增静态测试与 E2E T25 + 文档与截图。
- 验收 ZIP（`jizhang-mini_v1.3.2/3/4_acceptance.zip` 及本次新包）均为未跟踪文件，不进 git。
- 提交记录：待回填（本文件与代码在同一个提交中）。
