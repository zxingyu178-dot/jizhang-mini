# HANDOFF · DailyValue Mini v0.3.2

> 版本定位：**Android Main UI Parity**。把「记账」主页信息骨架对齐 Android DailyValue（Golden Reference：`daily-value-v2` 的 `src/pages/accounting/AccountingPage.vue`）。
> 本版只做展示 / 交互层重构：① Hero 卡成为唯一月份区域；② 账单改为连续时间线；③ FAB 改大圆角方形玻璃；④ 顶部搜索/设置去 Emoji 换本地线性图标。
> **不新增业务功能、不改 `packages/importer`、不重构统计 Panel。**

---

## 一、本版改动总览

### 1. 共享 Glass Token（`app.wxss`）
- 新增通用 token：`--glass-card-bg` / `--glass-soft-bg` / `--glass-border` / `--glass-highlight` / `--glass-shadow` / `--glass-glow`。
- 新增 Hero 专用：`--hero-bg`（135° 紫渐变透明深色玻璃）、`--hero-border`、`--hero-shadow`、`--hero-arrow-bg`、`--hero-arrow-active`。
- 新增 FAB 专用：`--fab-bg`（150° 紫渐变低 alpha）、`--fab-border`、`--fab-shadow`（柔和紫光）。
- 紫色只存在于渐变 / 局部 Glow / 边缘高光，底层为透明深色玻璃，不做紫色实体卡。

### 2. 顶部去 Emoji + 自研图标组件（`components/icon/`，新建）
- 新建 `dv-icon` 组件（icon.js / .json / .wxml / .wxss）：纯 SVG data-URI（base64），24×24 viewBox、fill none、统一 stroke；ICONS 字典含 `search`（放大镜）、`settings`（heroicons cog-6tooth）、`chevronLeft`、`chevronRight`；properties `name/size/color`。
- Header 搜索 `🔍`、设置 `⚙️` 替换为 `<dv-icon>`，单色、线性、尺寸可控。
- 一级导航非选中 `rgba(255,255,255,.42)`、选中 `#f2f3ff`，保留紫色短线 indicator，无整块紫色底。
- 分类行 emoji（🍚🚗🎮🛍）按计划保留；分类 SVG 图标体系是后续任务。

### 3. 记账 Hero 重构（`components/accounting-panel/`）
- 删除卡片外的 `‹ 月份 ›` 独立行；Hero 成为唯一月份区域：左上月份、右上两枚玻璃箭头（当前月箭头置灰不隐藏）、居中超大主金额（三档字号）、底部收入/结余两端对齐、「左右滑动切换月份」提示。
- 主金额 `lg(≤8字)64rpx / md(≤11字)54rpx / sm 44rpx`，全部 `nowrap` + 等宽数字；Hero 内金额一律白色三档，列表金额才用绿/红语义色。
- 切月动画为内容 fade + 轻微纵向位移（约 180ms），不整页飞。

### 4. 账单连续时间线（`components/accounting-panel/`）
- 取消「一天一张 day-card」，改为连续时间线：日期段 `.tl-day`（左侧月日 + 单字星期 + 今天/昨天 pill，右侧当日汇总，下方 1rpx 低透明分割线）+ 透明 `.tl-item` 行。
- 日汇总纯函数化：仅支出只显示支出、仅收入只显示收入、两者都有才显示两项，不显示 0 元一侧。
- Bill Row 三栏：图标方块（76rpx/22rpx 圆角）+ 主标题（merchant 或分类名）+ 备注（单行省略）+ 右侧金额（支出 `-x.xx`、收入 `+x.xx`，列表不带 ¥）。

### 5. FAB 大圆角方形玻璃（`pages/main/main.wxss`）
- 由 104rpx 圆形改为 116rpx × 116rpx、`border-radius:30rpx`；紫渐变 + 边缘高光 + 柔和紫光，非纯紫实心、非霓虹球。
- 保留 `safeBottom` 安全区与列表底部 padding（`safeBottom + FAB高度 + 24px`），最后一条账单不被遮挡。

### 6. 纯函数层 + 测试（`data/accounting.js` 新建，`tests/accounting.test.js` 新建）
- 导出 `WEEK / pad2 / dateKeyOf / todayKey / yesterdayKey / currentYM / dayMeta / sumDay / daySummaryKind / buildMonthList / canShift / shiftMonth / billDisplay / buildTimeline`。
- `tests/accounting.test.js` 45 项断言，覆盖 ACCOUNTING-01~10（仅支出/仅收入/两者日汇总、今天/昨天、跨月、未来月禁入、收入 `+`/支出 `-`、按 occurredAt 倒序）；固定基准 `TODAY=2026-10-16`。
- 注册进 `tests/run-all.js`，`npm test` 一键执行。

---

## 二、两个关键技术修复（本版实际排查后确定）

### 1. Hero 横滑误切一级 Tab（核心手势）
- 外层主 Shell 用一级 `swiper` 切换 统计/记账/日价；Hero 放进内层 `scroll-view` 时，横滑会被一级 swiper 抢占（setData 异步禁用 `disable-touch` 来不及、scroll-view 内 `catchtouchmove` 也拦不住外层原生 swiper）。
- **最终方案**：把 Hero 移出 scroll-view 固定在时间线之上，使其成为一级 `swiper-item` 的直接子层，Hero 上用**视图层 `catchtouchmove`** 直接拦截横滑，不冒泡给一级 swiper；切月由 JS 按 `dx/dy` 判定（水平 >56px 且 `|dx|>|dy|*1.25`），箭头始终可用。时间线区独立 scroll-view 垂直滚动，该区域横滑仍正常切 Tab。
- **可见取舍（指导书 §27 允许）**：Hero 常驻顶部、不随列表滚动；从 Hero 卡片区域纵滑不带动列表，从时间线区域纵滑正常。换取「横滑绝不误切 Tab」在 WebView + Skyline 双模式都稳定。详见 `docs/UI_PARITY_v0.3.2.md` 第三节。

### 2. 冷启动默认记账页空月竞态
- 现象：重编译后默认记账页显示空月，手动切一次 Tab 才正常。
- 根因：`main` onReady 调 `activatePanel(1)` 时 swiper-item 内组件可能尚未 ready，`selectComponent` 返回 null；原面板 attached 只算安全区不加载数据。
- 修复：`accounting-panel` 的 `lifetimes.attached()` 内算完 `listPadBottom` 后自调用 `activate()`（数据层在 App onLaunch 已同步 init，本面板无依赖布局尺寸的图表）；`activate` 内 `_loaded` guard 保证父页面再调不重复。统计面板维持原状（其柱图需等布局）。

---

## 三、测试结果

- 入口：工程根 `npm test`（`tests/run-all.js`，子进程依次执行）。
- 结果：**270 项全部通过，exit code = 0（5/5）**：
  - `device.test.js`：6 项
  - `data.test.js`：92 项
  - `accounting.test.js`：**45 项（本版新增）**
  - `statistics.test.js`：65 项
  - `importer.test.js`：62 项

---

## 四、模拟器验证（开发者工具，非真机）

在 **iPhone 12/13（390px）模拟器**上，**WebView 与 Skyline 两种渲染模式均验证**（本版 Skyline 模拟器未再出现早先的黑屏/GPU 问题）：

- Header 标题 + 搜索 pill（线性放大镜）+ 线性齿轮 + 微信胶囊，不重叠；
- 10 月 Hero：本月支出 ¥87.40、收入 ¥88.88、结余 ¥1.48；右箭头当前月禁用，左箭头切 9 月（支出 ¥162.00、收入 ¥0.00、结余 ¥-162.00 单行）；
- 时间线：10/15 四[昨天]、10/14 三、10/10 六（仅收入日「收入 ¥88.88」、转账 +88.88），星期核对正确；
- 手势：Hero 右滑→上月、左滑→下月、当前月左滑不进未来、Hero 横滑始终停留在记账、Hero 外横滑切 Tab、时间线区垂直拖动不切 Tab；箭头始终可用；
- FAB 大圆角方形完整，最后一条金额停在 FAB 上方；点 FAB 弹出「记一笔」Bottom Sheet（safe-area 正常）；
- 统计页无回归（月度与记账一致、每日趋势、Top5），日价页 Glass 空态正常。
- 渲染配置提交为 `"renderer": "skyline"`（`app.json` 与 `pages/main/main.json` 均已恢复）。

模拟器截图（`docs/screenshots/v0.3.2/`，**均为模拟器，非真机**）：
`accounting_hero.png`、`accounting_timeline.png`、`accounting_ios_simulator.png`、`accounting_prev_month.png`、`accounting_fab.png`、`accounting_income_day.png`。

---

## 五、真机 / 平台验收状态（如实记录）

| 平台 | 状态 |
|---|---|
| Node 纯函数 / 业务逻辑测试 | PASS（270/270） |
| 开发者工具 WebView 模拟器（390px） | PASS（布局 / 数据 / 手势 / 弹层） |
| 开发者工具 Skyline 模拟器（390px） | PASS（渲染与手势） |
| **Android 真机**（含手势 Gate、真实账单、1000+ 性能、360/412） | **待用户真机验收**（见 `docs/DEVICE_GATE_v0.3.2.md`，助手不代签） |
| iOS 真机 | **NOT TESTED**（当前无 iPhone 真机） |
| iOS 模拟器安全区 / 布局 | 已做 390px 检查，不作为真机 PASS |

真机还需重点确认：Skyline 真机下 SVG data-URI 图标是否渲染（模拟器正常，真机未验证；若异常需降级）、Hero 手势真机手感、毛玻璃透出、360/412 不溢出、1000+ 流畅度。

---

## 六、范围约束

- 本版不做：日价详情/曲线、周期记账、预算、AI Merchant Rule、云同步、登录、OpenID、后端、新导入来源、自动分类学习、分类 SVG 图标库、银行账单、Widget、长按删除、虚拟列表重构（见指导书 §80）。
- 不改 `packages/importer`；真实账单只在用户手机本地，不入库、不发文件、不发邮件。
- v0.3.2 完成后**停止，不自行进入 v0.4.0**，等待真机体验与 GitHub 源码审查。

---

## 七、交付元数据（提交后填写）

- Repository：`zxingyu178-dot/jizhang-mini`
- Branch：`main`
- Version：`0.3.2`
- 功能代码 Commit SHA：`04bbba816cf4367088f3b5cff86ed7e286916664`（message：`v0.3.2: align accounting UI with Android DailyValue`，已推送，origin/main 到达此提交）
- 文档 Commit SHA：本 HANDOFF / UI_PARITY / DEVICE_GATE 随后一次 docs 提交（不改动代码）
- ahead = 0 / behind = 0 / working tree clean：是（全部推送后核对）
- 测试：`npm test` 270 项全绿（5/5，exit=0）
- 渲染模式：`skyline`（`app.json` 与 `pages/main/main.json`）
