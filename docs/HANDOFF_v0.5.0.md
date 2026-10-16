# HANDOFF — DailyValue Mini v0.5.0（Budget Rhythm：预算节奏系统 + UI Closure）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**0.5.0**
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + packages 两处）、`README.md`）
- 上一版本基线：v0.4.1（HEAD `481a1ee`）
- 功能提交：见文末 Git 状态

---

## 1. 本版目标

v0.4.0 已交付日价核心、v0.4.1 完成交互收口，本版一次做完整可体验的**预算节奏系统**，并顺手完成全项目 Header 盒模型、Bottom Sheet 不透明度、日期不允许未来等 UI Closure。

核心设计原则（与日价一致）：

- **预算是新增分析维度，不是新账单字段**。Bill V2 继续冻结，预算全部由「Bill + 预算规则历史」动态派生，不新增 `budgetImpact / budgetAmount / budgetConsumed`。
- **预算规则存历史，不存单一 dailyBudget**。改每日金额只新增规则，绝不重算历史月份。
- **严格区分「总预算」与「截至今日预算」**，杜绝拿整月预算减半月支出造成的虚假盈余。
- 预算**不改变**现有月支出 / 收入 / 结余 / 分类排行 / 年度统计。

---

## 2. 预算规则模型（存 settings.json）

新建 `data/budget/rules.js`，预算存于 `settings.budget`：

```json
{
  "version": 1,
  "weekStartsOn": 1,
  "rules": [
    { "id": "xxx", "enabled": true, "dailyCents": 3000, "effectiveFrom": "2026-10-01", "createdAt": 1792129106606 }
  ]
}
```

- 纯函数与 IO 分离：`normalizeState / resolveRuleForDate / isEnabledOn / dailyCentsOn / applyRule` 为纯函数；`getBudgetState / saveBudgetRule` 负责读写。
- 某天适用规则：`effectiveFrom <= 当天` 且**日期最近**一条。
- 规则中途变更（如 10/01~15 为 ¥30、10/16 起为 ¥40）：本月日历 / 周期自动按各规则生效日分段求和。
- 修改预算是新增规则，**同一天**重新修改则替换当天规则（保留原 id / createdAt）。
- 关闭预算 = 新增 `{ enabled:false, effectiveFrom }`，不删历史，之前的月份仍按原规则。
- 金额整数分，`weekStartsOn=1`（周一为周起点）。

**Backup V2 无需升级**：`buildBackup()` 本就保存 `settings`，预算规则随 settings 备份恢复；已加专项往返测试。

---

## 3. Budget Core（纯函数 data/budget/）

| 文件 | 职责 |
| --- | --- |
| `rules.js` | 规则历史模型（normalize / resolve / apply + IO） |
| `period.js` | 周期纯函数：`buildPeriod(kind)`（today/week/month/lastweek/lastmonth）、周一/月首、`accruedDayCount`（未来 0 / 过去 dayCount / 当前含今天） |
| `core.js` | `consumesBudget`（仅 `normal && expense`）、`sumDailyBudget`（按规则分段）、`computePeriodBudget`、`computeByKind` |
| `calendar.js` | `buildMonthCalendar`（周一开头网格、今天 / 无预算 / 未来 / 盈余 / 超支 + 两档 level）、`buildDayDetail` |
| `index.js` | `buildPaceSummary` + 统一 re-export |

周期口径复用 `data/daily-value/core` 的 `dayNumber`（UTC 日编号），与日价完全一致，不受时区 / 夏令时影响。

关键公式（用户锁定，未自行发明）：

- `periodBudget`：周期内每日预算之和（规则中途变更自动分段）；
- `accruedBudget`：仅 `accruedDays` 天（截至今天）的预算之和；
- `actualExpense`：周期内 `normal + expense` 之和（收入不消耗、仅日价物品不消耗）；
- `paceDelta = accruedBudget - actualExpense`（>0 盈余，<0 超支）；
- `remainingBudget = periodBudget - actualExpense`；
- 已结束周期 `accruedDays = dayCount`，故 `accruedBudget = periodBudget`。

已接入 `data/index.js`：导出 `getBudgetState / saveBudgetRule / computeBudgetByKind / buildBudgetCalendar / buildBudgetDayDetail / buildBudgetPaceSummary`，并暴露子模块 `budget`。

---

## 4. 主页 Hero「支出 / 预算」模式

改造 `components/accounting-panel`：

- Hero 顶部新增极轻的「支出 / 预算」分段切换；**不新增横滑手势**（横滑仍只用于切月份，且加 `heroMode === 'expense'` 条件，预算模式下横滑不触发）。
- 支出模式完全保留现状（月份 + 箭头 + 本月支出 + 收入 / 结余）。
- 预算模式提供「今日 / 本周 / 本月」分段，视觉优先级：**预算总额 > 盈余 / 超支 > 已花 / 截至今日预算 / 剩余**。
  - 今日：今日预算、已花、盈余 / 超支；
  - 本周：本周预算、当前盈余 / 超支、已花、截至今日预算、本周剩余；
  - 本月：本月预算、当前盈余 / 超支、已花、截至今日预算、本月剩余。
- 未设置预算时显示空态：「还没有设置每日预算 / 设置一个每天可以花多少钱的目标 / [设置预算]」，点击进入预算设置页，不出现空白。
- 颜色：盈余 `#38c896`、超支 `#ef606b`，深色背景下不过亮；沿用现有 Hero Glass，未新增独立卡片。

---

## 5. 预算设置页 + 设置入口

新建 `pages/budget-settings/` 四件套（已注册 `app.json`）：

- 启用预算开关、每日预算金额（¥ / type=digit）、生效日期 picker（默认今天、**允许选过去、不允许选未来**）。
- 保存走 `saveBudgetRule`（新增 / 同天替换，不覆盖历史）。
- 底部说明：「修改预算只影响生效日期之后，之前的预算记录不会改变。生效日期可选过去，不能选未来。」
- 设置主页新增独立「预算」分组（在「数据」前），右侧显示 `¥30/天` 或 `未设置`；`onShow` 刷新提示。

---

## 6. 统计预算日历地图 + 日详情

改造 `components/statistics-panel`：

- 月度 Hero 后、「每日花费趋势」前新增当月预算日历：
  - 周一开头（表头 一 二 三 四 五 六 日），7 列；
  - 绿 = 当天盈余、红 = 超支、灰 = 无预算 / 未来、**紫色描边 = 今天**；
  - 绿 / 红各两档深浅（盈余较多 / 较少、轻微超支 / 明显超支），不做彩虹 Heatmap。
- 点击某天弹出**页面级 Bottom Sheet**（在 `pages/main` 用 `<bottom-sheet>` 承载，组件内 fixed 会相对 swiper-item 错位）：日期标题、预算、实际支出、盈余 / 超支、当天分类汇总、当天账单（只读），含空态。
- 日历下方新增节奏摘要：本周截至今日、本月截至今日、上周、上月（无预算显示「—」，正绿负红），文案明确「截至今日」。

---

## 7. UI Closure（本版顺带修复）

### 7.1 全项目自定义 Header 盒模型统一（根因修复）

- 根因：`utils/device.js` 的 `headerHeight = statusBarHeight + navBarHeight`（**已含状态栏**），而各二级页 inline 同时写 `padding-top: statusBarHeight` + `height: headerHeight`，默认 content-box 导致实际总高 = headerHeight + statusBar（多出一个状态栏），底部覆盖 scroll 顶部内容、标题视觉偏下（"数据隐私标题压卡片"根因）。
- 修复：统一给 header 类加 `box-sizing: border-box`（总高 = headerHeight，内容区 = navBar，胶囊垂直居中）。涉及 5 个文件：`pages/settings`（.set-header）、`pages/backup-restore`（.br-header）、`pages/data-privacy`（.dp-header）、`pages/search`（.s-header）、`packages/importer/pages/import`（.imp-header）。`pages/main`（.header）、`pages/daily-value-detail`（.dpage-header）本就是 border-box。

### 7.2 Bottom Sheet 提高不透明度

- `components/bottom-sheet/bottom-sheet.wxss` 面板主渐变 alpha 由 .78/.82 提到 **.90/.92**（真机背景正文不可辨认、不穿透），顶部紫光渐变由 `rgba(124,134,255,.12)/200rpx` 增强为 **.16/240rpx**（紫色氛围仍可感知）；保持半透明，**未回退到蓝黑实心板**。mask 保持 .34。
- 记账 Sheet 与日价新增 Sheet 本来就包在 `pages/main` 同一个 `<bottom-sheet>` 内，Token 天然共用。

### 7.3 日期不允许未来（UI + 提交双保险）

- 微信 date picker 用 `start/end`（不是 max）：`bill-form`、`daily-value-form` 的 picker 加 `end="{{todayStr}}"`，data 加 `todayStr`（reset / edit 用 `util.formatDate(new Date())` 赋值）。
- 提交层兜底：`onSubmit` 对 `dateStr > todayStr` 夹取为 today（bill-form 同时夹取 occurredAt 与 dailyValue.startDate；daily-value-form 夹取 startDate 后再交给 `buildEditPatch / addBill`）。

---

## 8. 生命周期

- `app.js` 把 `refreshVisibleDailyValue` 改名 **`refreshTimeSensitiveViews`**（onShow / onMidnight 两处调用同步），预算与日价共用同一刷新入口，**不新建第二套午夜 Timer**；午夜仍按 `msUntilNextLocalMidnight` 动态重算（避免 DST 漂移）。
- `pages/main/main.js` 加安全 `onShow`：`onReady` 置 `_ready=true`，之后每次 onShow 调 `refreshPanels()`；从预算设置页返回主页 Hero / 统计立即刷新，无需重启小程序。

---

## 9. 测试结果

`npm test`（`tests/run-all.js`，独立子进程，跨平台）：

| 套件 | 数量 | 结果 |
| --- | --- | --- |
| device.test.js | 6 | PASS |
| data.test.js | 92 | PASS |
| accounting.test.js | 45 | PASS |
| statistics.test.js | 65 | PASS |
| daily-value.test.js | 97 | PASS |
| **budget.test.js（新增）** | **102** | **PASS** |
| settings.test.js | 15 | PASS |
| importer.test.js | 74 | PASS |
| **合计** | **496** | **全绿，退出码 0（8/8）** |

新增 `tests/budget.test.js` 共 102 项，**未删除任何现有测试**（旧 394 项全保留），覆盖：

- A 规则模型：normalize、规则解析（effectiveFrom 最近）、同天替换、新增重排、关闭不删历史、再开启；
- B 周期与月天数：周一为周起点、月天数 28/29/30/31、`accruedDayCount`（未来 / 过去 / 当前）；
- C 核心公式：每日预算整数分、今日 / 本周 / 本月 / 上周 / 上月、规则中途变更分段、禁用再开启、未来日不进累计、已结束周期累计=总预算、仅 `normal+expense` 消耗（收入不消耗、仅日价不消耗）、正盈余 / 负超支；
- D 日历地图：周一开头布局、leading 空位、今天 / 无预算 / 未来、两档盈余 / 超支、`buildDayDetail` 分类汇总；
- E 备份恢复：设置预算 → 备份 → 清空 → 恢复，规则完整往返；旧 V1 备份仍可恢复且 budget 为空。

---

## 10. 模拟器验证（已执行）

环境：微信开发者工具 Stable 2.02.2608080，miniprogram-automator 0.12.1，Skyline 模拟器（宽 390）。

验证数据集（TODAY=2026-10-16，预算 ¥30/天，effectiveFrom 2026-10-01）：

- 10-13 餐饮 ¥18、10-14 购物 ¥45、10-15 餐饮 ¥20、10-16 餐饮 ¥100（今天），本月支出合计 ¥183。

逐项核对（截图与数值一致）：

| 视图 | 数值 | 预期 |
| --- | --- | --- |
| 今日 | 预算 ¥30.00 / 已花 ¥100.00 / 超支 ¥70.00 | 30−100=−70 ✓ |
| 本周（10/12~18） | 总 ¥210 / 截至今日 ¥150 / 已花 ¥183 / 超支 ¥33 / 剩余 ¥27 | 150−183=−33，210−183=27 ✓ |
| 本月（10/01~11/01） | 总 ¥930 / 截至今日 ¥480 / 已花 ¥183 / 盈余 ¥297 / 剩余 ¥747 | 30×31=930，30×16=480，480−183=297 ✓ |
| 日历 | 13 绿 / 14 红 / 15 绿 / 16 红 + 紫描边、17~31 灰 | 颜色与 delta 一致 ✓ |
| 节奏摘要 | 本周截至今日 −¥33 / 本月截至今日 +¥297 | ✓ |
| 日详情（10-14） | 预算 ¥30 / 实际 ¥45 / 超支 −¥15 / 分类 购物 ¥45 / 当天账单 | ✓ |

另验证：

- 预算设置页：启用开关 ON、¥30.00/天、生效日期 2026-10-01、说明文字、保存按钮、Header 正常；
- 记一笔 Sheet：金额 ¥759.86 完整不裁切，字段新顺序（收支 → 金额 → 日期 → 计算日价 → 分类 → 商户 → 备注），背景紫色氛围可感知、正文不可辨认；
- 数据与隐私页：Header「数据与隐私」不再压卡片，卡片顶部完整可见；
- 预算设置经 UI 保存后，settings.budget 完整落盘（重启工具后规则与账单仍在）；
- 空态：首次切到预算模式（未设置）显示引导，点击进入设置页。

### 已知模拟器限制

- **Canvas 日价曲线在 Skyline 模拟器下仍不渲染**（v0.4.0 遗留），属工具限制非代码问题，只能真机验收。
- automator 0.12.1 在同一连接内连续写操作偶发 `timeout waiting for automator response`（数据已实际落盘），已通过「每个截图独立连接 + 重连」规避；不影响真机使用。

截图目录 `docs/screenshots/v0.5.0/`（均为开发者工具模拟器，文件名统一带 `_simulator`，未冒充真机）：

- `budget_today_simulator.png`、`budget_week_simulator.png`、`budget_month_simulator.png`
- `budget_calendar_simulator.png`、`budget_day_detail_simulator.png`
- `budget_settings_simulator.png`
- `quick_entry_readability_simulator.png`、`data_privacy_header_fixed_simulator.png`

---

## 11. 真机 Gate（待用户执行，助手不代签）

状态如实标记：

- **Android physical device：NOT TESTED（待用户）**
- **iOS physical device：NOT TESTED（无真机）**
- 模拟器：PASS（预算功能 / 布局 / 数据；Canvas 曲线除外）

Android 真机需至少完成：

1. 数据隐私 / 备份恢复 / 设置 / 搜索 / 日价详情 / Import 二级页 Header 均不压卡片、内容不重叠；
2. 记一笔打开后背景正文不穿透、但毛玻璃 / 紫色氛围仍在；
3. 今日 / 本周 / 本月预算切换，Hero 在 360px 宽不换行、不溢出；
4. 预算日历 7 列不拥挤；2 月、31 天月份都正常；今天紫色描边正确；绿色 / 红色在深色背景中不过亮；
5. 点日历日详情数值正确；
6. 修改预算金额 / 生效日期后返回主页立即刷新；
7. 过去月份的预算历史不被新规则改变（如 10/01~15 ¥30、10/16 起 ¥40）；
8. 手工账单与日价日期均无法选择未来（picker 置灰 + 提交夹取）；
9. （延续 v0.4.1）日价 Canvas 曲线真机可见、触摸左 / 中 / 右定位正确、tooltip 不出屏。

> 真机截图（按用户清单：`budget_today / week / month / calendar / day_detail / settings`、`quick_entry_readability`、`data_privacy_header_fixed` 的无 `_simulator` 版本）待用户提供，未用模拟器冒充。
> 真实账单只在用户手机本地，不提交 GitHub、不发邮件、不发文件；脱敏诊断不含姓名 / 商户 / 商品 / 账号 / 交易号 / 金额明细 / 文件名。

---

## 12. 本版明确不做

v0.5.0 只做预算核心 + 主页预算模式 + 统计日历地图。明确不做：预算分类豁免、退款抵预算、周末特殊预算、预算日历 Heatmap 彩虹化、预算历史管理器复杂 UI、周期记账、AI、云同步、登录 / OpenID、银行导入、社交分享、排行榜、资产残值、寿命预测、"回本 / 物有所值"评价。**日价里程碑与预算只陈述数学事实，不做消费评价。**

下一阶段（v0.5.1）方向由用户决定，本版提交后不自行进入。

---

## 13. Git 状态

- 提交信息：`v0.5.0: Budget rhythm, calendar map and UI closure`
- 推送方式：经显式代理 `http://127.0.0.1:33210`
- 最终结果：HEAD == origin/main，ahead=0 / behind=0，working tree clean（SHA 见 push 后 git log / 交付说明）
