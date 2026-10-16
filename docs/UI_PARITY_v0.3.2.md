# UI Parity 对照报告 · DailyValue Mini v0.3.2

> 目标：把「记账」主页的信息骨架对齐 Android DailyValue（Golden Reference：`daily-value-v2` 的 `src/pages/accounting/AccountingPage.vue`）。
> 本版只做展示 / 交互层重构，**不新增业务功能、不改 importer、不重构统计 Panel**。
>
> 评级口径：**PASS** = 已实现并在开发者工具模拟器（WebView + Skyline 双渲染）核对；**PARTIAL** = 已实现但存在明确取舍 / 需真机确认；**NOT DONE** = 未做。
> 以下截图均为开发者工具模拟器（iPhone 12/13，390px），非真机；真机状态见 `docs/DEVICE_GATE_v0.3.2.md`。

---

## 一、§62 规定的逐项视觉对照（必须逐项回答）

| # | 对照项 | 评级 | 实测说明 |
|---|---|---|---|
| 1 | Android Hero 结构是否还原 | **PASS** | Hero 卡内含 `head`（月份 + 箭头）→「本月支出」→ 主金额 → 收入/结余 →「左右滑动切换月份」，层级与 Android `accounting__card` 一致。截图 `accounting_hero.png`。 |
| 2 | 月份是否进入 Hero | **PASS** | 旧的卡片外 `‹ 2026年10月 ›` 行已删除；月份 `2026年10月` 位于 Hero 左上（`.hero__month`，28rpx/600）。 |
| 3 | 箭头是否进入 Hero | **PASS** | 左/右箭头在 Hero 右上同一行（`.hero__arrows`），为 58rpx 圆形玻璃按钮；当前月右箭头以 `opacity:0.3` 置灰（不隐藏）。 |
| 4 | Hero 主金额是否居中 | **PASS** | 「本月支出」与主金额 `¥87.40` 均水平居中；主金额为页内最大字号（lg 64rpx / md 54rpx / sm 44rpx 自适应），`nowrap` + 等宽数字。 |
| 5 | 收入/结余是否在 Hero 内 | **PASS** | Hero 底部分栏 `.hero__sub`：左「收入 ¥88.88」、右「结余 ¥1.48」，`justify-content:space-between`、单行 `nowrap`。9 月负结余 `¥-162.00` 单行不换行。 |
| 6 | 滑动提示是否在 Hero 内 | **PASS** | 「左右滑动切换月份」位于 Hero 最下方居中，21rpx、透明度 0.48，仅在 Hero 内出现。 |
| 7 | 账单是否取消按日 Card | **PASS** | 旧的「一天一张 glass-card」已删除；改为连续时间线（`.tl-day` 日期段 + 透明 `.tl-item` 行），仅用 1rpx 低透明分割线，账单行无独立玻璃背景。 |
| 8 | 日期 Header 是否加入星期/今天/昨天 | **PASS** | 左侧 `10月15日 四 昨天`：月日 + 单字星期（日/一…六）；「今天」「昨天」为紫色小 pill，非今天/昨天不显示。右侧为当日汇总。已核对 10/15 周四、09/20 周日、09/15 周二。 |
| 9 | FAB 是否改成大圆角方形 | **PASS** | 由 104rpx 圆形改为 116rpx × 116rpx、`border-radius:30rpx` 的大圆角方形玻璃，紫渐变 + 边缘高光 + 柔和紫光（非纯紫实心），非霓虹球。截图 `accounting_fab.png`。 |
| 10 | Search/Settings 是否去 Emoji | **PASS** | 顶部 `🔍` / `⚙️` 已替换为自研本地线性图标组件 `<dv-icon>`（SVG data-URI，24×24、fill none、统一 stroke）：放大镜 + 齿轮；单色、线性、尺寸可控。分类行 emoji（🍚🚗📦 等）本版按计划保留。 |

---

## 二、§86 完成标准的其余关键项

| 对照项 | 评级 | 实测说明 |
|---|---|---|
| 月份导航进入 Hero（卡片外无独立月份行） | **PASS** | 见上 §1-2。 |
| Hero 结构与 Android 一致 | **PASS** | 见上 §1。 |
| 主金额居中 | **PASS** | 见上 §4。 |
| 收入/结余/提示进入 Hero | **PASS** | 见上 §5-6。 |
| Hero 箭头可用（强制 fallback） | **PASS** | 模拟器逐一点击：左箭头 10→9、右箭头 9→10；当前月右箭头置灰不进未来。 |
| Hero 横滑可切月 | **PASS（模拟器）** | WebView 与 Skyline 模拟器均实测：右滑（dx>0）切上月、左滑切下月；阈值 水平>56px 且 `|dx|>|dy|*1.25`。**真机待用户确认。** |
| Hero 横滑不误切一级 Tab | **PASS（模拟器）** | 采用视图层 `catchtouchmove` 拦截（见第三节），横滑始终停留在「记账」，不再被一级 swiper 抢到统计。**真机待用户确认。** |
| 一级 Swiper 正常（Hero 外横滑切 Tab） | **PASS（模拟器）** | 在时间线区域横滑，正常切到统计/日价；垂直拖动不切 Tab。 |
| 日账单不套 day-card | **PASS** | 连续时间线。 |
| 日期 Header 显示星期 | **PASS** | 单字星期。 |
| 今天/昨天标识完成 | **PASS** | 紫色 pill。 |
| 日汇总：仅支出 / 仅收入 / 两者都有 | **PASS** | 仅支出显示「支出 ¥41.50」；仅收入显示「收入 ¥88.88」（截图 `accounting_income_day.png`）；两者显示「支出… · 收入…」；不显示 0 元一侧（纯函数 ACCOUNTING-01~03 覆盖）。 |
| Bill Row 与 Android 信息结构一致 | **PASS** | 三栏：图标方块（76rpx/22rpx 圆角）+ 主标题/备注（单行省略）+ 右侧金额；金额支出 `-18.00`、收入 `+88.88`（列表不带 ¥）。 |
| FAB 不遮挡最后账单 | **PASS** | 滚动区底部 `padding = safeBottom + FAB高度 + 24px`，最后一条「转账 +88.88」完整停在 FAB 上方。截图 `accounting_fab.png`。 |
| 360px 不溢出 | **PARTIAL** | CSS 静态分析安全（flex 等宽、`min-width:0`、金额 `nowrap`、Hero 金额三档字号）；360/412 模拟器因远程会话设备子菜单无法展开未出图，**以 Android 真机为准**。 |
| 390px 不溢出 | **PASS（模拟器）** | iPhone 12/13 模拟器 Hero、时间线、FAB 均无溢出。 |
| 负结余不换行 | **PASS** | 9 月 `¥-162.00` 单行；`.hero__sub-val` nowrap。 |
| 大金额不换行 | **PASS** | 主金额 `lg/md/sm` 三档按字符长度自适应，全部 `nowrap` + `tabular-nums`（`expenseSizeClass` 纯函数）。 |
| 真实收入账单正常显示 | **PASS（模拟器）** | 10/10 转账 `+88.88` 红色 + 号；日期 Header 显示「收入 ¥88.88」。 |
| 真实微信/支付宝导入数据无回归 | **PASS（数据层）** | 本版不改 importer；模拟器现有导入数据（微信/支付宝样式）统计与口径一致。**真实账单复导入由用户真机验收。** |
| 月度/年度统计无回归 | **PASS（模拟器）** | 切到统计页：月度 ¥87.40/¥88.88/¥1.48 与记账一致、每日趋势柱、Top5 正常；日价页为 Glass 空态。 |
| 搜索/设置入口不回归 | **PASS** | Header 搜索 pill、设置按钮点击链路保留（`onSearch`/`onSettings`）。 |
| Bottom Sheet（新增/编辑） | **PASS（模拟器）** | FAB 弹出「记一笔」：支出/收入、金额、分类、日期 2026-10-16、商户/备注、确认；遮罩关闭正常。 |
| 1000+ 账单不卡（不引入虚拟列表） | **PARTIAL** | 时间线为普通渲染（未引入 recycle-view）；当前数据量模拟器滚动正常，**1000+ 流畅度以真机为准**。 |

---

## 三、关键工程决策：Hero 横滑与一级 Swiper 的手势隔离

Android 上 Hero 随页面整体滚动；小程序外层是负责「统计/记账/日价」的一级 `swiper`，若直接把 Hero 放进内层垂直 `scroll-view`，在 Hero 上横滑会被一级 swiper 抢占（实测误切到统计页）。

本版的可靠做法（已在 WebView + Skyline 双模式验证）：

- **Hero 固定在时间线 `scroll-view` 之外**（顶部常驻），使 Hero 成为一级 `swiper-item` 的直接子层；
- Hero 上使用 **`catchtouchmove`**，在**视图层**直接拦截横滑事件，不冒泡给一级 swiper（不依赖 `setData` 异步时序，也不嵌套第二个 swiper）；
- 切月由 JS 按 `dx/dy` 判定：水平位移 > 56px 且 `|dx| > |dy|*1.25` 才切月，箭头始终可用作 fallback；
- 时间线区域独立 `scroll-view` 垂直滚动，该区域横滑仍正常交给一级 swiper 切 Tab。

**与 Android 的唯一可见差异（明确取舍）**：Mini 的 Hero 不随账单列表滚动而滚走（常驻顶部）；从 Hero 卡片区域纵向滑动不会带动列表，从时间线区域纵向滑动正常。此为指导书 §27「若外层 Swiper 无法稳定阻断 Hero 手势，优先保证箭头一定工作、一级页面 Swipe 不坏」允许的降级，换取**横滑绝不误切 Tab**这一硬验收项在两种渲染模式下都稳定成立。视觉信息架构与一级交互语义与 Android 保持一致。

---

## 四、共享 Glass Token

`app.wxss` 新增并统一引用（Hero/FAB 已接入，其余卡片逐步复用）：

- 通用：`--glass-card-bg`、`--glass-soft-bg`、`--glass-border`、`--glass-highlight`、`--glass-shadow`、`--glass-glow`；
- Hero：`--hero-bg`（135° 紫渐变透明深色玻璃）、`--hero-border`、`--hero-shadow`、`--hero-arrow-bg`、`--hero-arrow-active`；
- FAB：`--fab-bg`（150° 紫渐变低 alpha）、`--fab-border`、`--fab-shadow`（柔和紫光）。

紫色只存在于渐变 / 局部 Glow / 边缘高光，底层为透明深色玻璃，未做紫色实体银行卡。

---

## 五、未完成 / 明确不做

- **Android 真机截图**（`accounting_android_360.png` / `accounting_android_390.png`）与全部真机手势 Gate 由用户在 Android 真机完成，助手不代签。
- **iOS 真机**：NOT TESTED（当前无 iPhone）；`accounting_ios_simulator.png` 仅为 iPhone 12/13 模拟器布局检查。
- 本版不做：日价详情/曲线、周期记账、预算、分类 SVG 图标体系（本版仅去顶部 emoji，分类 emoji 保留）、长按删除、新导入来源、AI 分类、云同步等（见指导书 §80）。
