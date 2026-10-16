# HANDOFF — DailyValue Mini v0.5.1（Budget Correctness & Interaction Closure）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**0.5.1**
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + packages 两处）、`README.md`）
- 上一版本基线：v0.5.0（HEAD `4074fd1`）
- 功能提交：见文末 Git 状态

---

## 1. 本版目标

v0.5.0 架构方向（预算规则历史、Bill + Rules 动态派生、总预算 / 截至今日预算）经用户直接审 main 后确认「架构通过、预算 UI / 功能主体通过」，但**预算计算正确性暂不完全通过**。本版不做新功能、不做预算花样，只把预算系统从「能用」修到「口径可信」：

- 修复「预算启用之前 / 停用期间的支出被拿来算超支」的 P0 口径问题；
- 修复「关闭预算当天显示超支」；
- 统一预算正负颜色（盈余绿 / 超支红，与业务收支色解耦）；
- 修复「剩余预算超出后偷偷去负号」；
- 修复「历史月份下节奏摘要仍是今天」。

Bill V2 继续冻结，预算仍是纯分析维度，不改任何账单字段、不改现有月支出 / 收入 / 结余 / 分类排行 / 年度统计。

---

## 2. P0 口径：两层语义（consumesBudget / countsAgainstBudget）

重写 `data/budget/core.js`，把「属于预算型支出」与「真正参与预算比较」拆成两层：

- `consumesBudget(bill)`（保留）：业务上是否属于预算型支出 = `type === 'expense' && ledgerImpact !== 'daily-value-only'`（即 normal + expense）。不看当日规则。
- `countsAgainstBudget(bill, state, dateStr)`（新增）：`consumesBudget` **且** 当日预算规则 `rules.isEnabledOn(state, date)` 为 true。即这笔支出在当日规则下才真正参与预算盈亏比较。

核心规则：

> **某笔支出只有在「这一天预算已启用」的情况下，才参与预算节奏计算。**

因此：

- 预算中途开始（例：今天 10-16 首次设 ¥30/天、生效日 10-16，而 10/01~15 已花 ¥700）：10/01~15 的支出仍进账本、进本月支出，但**不参与**本月预算盈亏；
- 预算关闭期间的消费，不拿去与预算比较。

---

## 3. P0 防御：当前周期只统计截至今天

`computePeriodBudget` 新增评估截止逻辑：

- `evalEnd = addDays(start, accruedDays)`：
  - 当前周期（today / week / month）：`accruedDays` 为截至今天（含今天），actualExpense 只累计 `[start, evalEnd)` 内的支出；
  - 过去周期（lastweek / lastmonth）：`accruedDays = dayCount`，统计完整周期；
  - 未来周期：`accruedDays = 0`。
- 即使用户经旧数据 / 异常导入 / 测试夹具获得未来日期账单，也不提前消耗今天的预算。

新增 `countEnabledDays(state, start, days)`：评估范围内（前 accruedDays 天）预算启用的天数。

`hasBudget` 语义修正：从 v0.5.0 的「periodBudget > 0」改为「**评估范围内存在 enabled 日**（accruedEnabledDays > 0）」。这决定某个周期是显示数据还是「未启用预算」。

---

## 4. P0：无预算日 / 周期明确显示（不再误报超支）

区分三种状态，避免把「¥0 预算」当超支：

1. **没有任何预算规则**（`getBudgetState().rules.length === 0`）：全局空态，引导「设置预算」；
2. **有规则历史，但当前周期没有 enabled 日**（`hasBudget === false`）：当前周期显示
   - 今日：「今日未启用预算」
   - 本周：「本周暂无预算」
   - 本月：「本月暂无预算」
   - 「该时段未启用预算，支出不参与预算比较」+ [调整预算]；
   - **不显示**「预算 ¥0 / 盈余 ¥0」，也不显示「超支」；
3. 有预算：正常显示数据。

`components/accounting-panel`：用 `hasAnyRule`（rules.length > 0）取代旧的 hasAnyBudget；新增 `periodNoBudget`、`periodNoBudgetText`；wxml 三态（全局空态 / 周期无预算 `hb-nobudget` / 正常），并新增 `hb-nobudget` 样式。

日详情同步：点击无预算日显示「当日未启用预算」+ 实际支出，不显示预算 / 超支；未来日（`dateStr > today`）`onTapDay` 直接 return，不弹 Sheet。

---

## 5. P0：预算颜色统一（独立语义 token）

问题：全局约定「支出绿 / 收入红」，v0.5.0 统计节奏摘要与日详情借用 `money-income / money-expense` 并写反，导致「盈余红、超支绿」，与日历格子（盈余绿 / 超支红）同页自相矛盾。

修复（`app.wxss` page{}）：新增预算自己的语义 token，与业务收支色解耦：

- `--budget-surplus: #38c896`（盈余）、`--budget-over: #ef606b`（超支），及 `--budget-surplus-soft` / `--budget-over-soft`；
- 全局类 `.budget-surplus` / `.budget-over`。

统一用于：主页 Hero 盈亏、统计节奏摘要、日详情 delta、日历图例。`accounting-panel` 的 `.hb-pace--surplus / --over` 由硬编码改为 `var(--budget-surplus) / var(--budget-over)`。日历格子的两档半透明色（与 token 同值）保留。**禁止再借用 money-income / money-expense 表达预算语义。**

---

## 6. P1：剩余预算负值文案

问题：v0.5.0 用 `Math.abs` 统一格式化，超支后「剩余 ¥40」把意思反过来。

修复：`computePeriodBudget` 返回 `remainingState`：

- `remainingBudget >= 0` → `'remaining'`：本周剩余 / 本月剩余 ¥xx；
- `remainingBudget < 0` → `'exceeded'`：超出本周总预算 / 超出本月总预算 ¥xx（取绝对值，用 `--budget-over` 红色）。

文案变化直接表达正负，不显示「剩余 -¥xx」。

---

## 7. P1：历史月份预算摘要上下文对齐

问题：统计切到历史月（如 9 月）后日历变为该月，但节奏摘要仍调 `buildBudgetPaceSummary(today)`，显示今天所在月的「本周 / 本月截至今日」。

修复：新增 `data/budget/index.js` → `buildMonthPaceContext(bills, state, year, month, todayStr)`：

- **当前月**（ym === today 月）：`isCurrent:true`，4 项——本周截至今日 / 本月截至今日 / 上周 / 上月（截至今日口径）；
- **历史月**：以该月最后一天为基准日（`accruedDays = dayCount`，完整周期），2 项——本月最终 / 上月最终，不再出现「截至今日 / 本周」；
- **未来月**：`isFuture:true`，2 个空项（月份导航本就不允许越过当前月，仅防御）。

`data/index.js` 暴露 `buildBudgetMonthPace(year, month, today)`；statistics 月度 `loadMonth` 改用该接口。

---

## 8. 日详情：无预算 / 未来日 + 日历图例

- `data/budget/calendar.js` 的 `buildDayDetail` 签名加 `todayStr`（第 5 参数，默认真实今天），返回加 `isFuture`；
- `statistics-panel.onTapDay`：`dateStr > today` 直接 return；payload 加 `hasBudget`；
- `pages/main`：dayDetail 加 `hasBudget` 并透传；wxml 无预算日显示 `dayd__notice`「当日未启用预算」+ 实际支出，有预算日显示预算 / 实际 / 盈余超支；新增 `dayd__notice` 样式；
- 统计日历底部新增一行轻量图例（`blegend`）：盈余 / 超支 / 无预算 / 今天（4 个 CSS dot），首次使用即可看懂。

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
| **budget.test.js** | **133**（v0.5.0 为 102，新增 31） | **PASS** |
| settings.test.js | 15 | PASS |
| importer.test.js | 74 | PASS |
| **合计** | **527** | **全绿，退出码 0（8/8）** |

未删除任何现有测试（v0.5.0 的 496 项全保留）。新增 F 段共 31 个断言，覆盖 14 个此前漏掉的场景：

- `BUDGET-CUTOVER-01`：预算 10-16 开始，10/01~15 支出不计入预算实际支出；
- `BUDGET-CUTOVER-02`：10-16 当天支出开始计入；
- `BUDGET-DISABLE-01`：10-16 起停用，16 日以后支出不计入预算比较；
- `BUDGET-DISABLE-02`：关闭预算后当天不显示「超支」；
- `BUDGET-FUTURE-01 / 02`：未来账单不消耗当前周 / 本月截至今日预算；
- `BUDGET-REMAIN-01 / 02`：remaining > 0 显示剩余；< 0 显示超出总预算；
- `BUDGET-COLOR-01 / 02`：盈余使用绿色语义、超支使用红色语义；
- `BUDGET-HISTORY-01 / 02`：历史月份摘要基于该月，不显示当前月「截至今日」；
- `BUDGET-DAY-01 / 02`：无预算日不标记超支、未来日不产生盈亏。

---

## 10. 模拟器验证（已执行）

环境：微信开发者工具 Stable 2.02.2608080，miniprogram-automator 0.12.1，Skyline 模拟器（宽 390）。

**Cutover 数据集**（TODAY=2026-10-16；2026-10 仅两笔：10-10 ¥700 启用前、10-16 ¥22.60；预算 10-16 起 ¥30/天）：

| 视图 | 实测 | 预期 |
| --- | --- | --- |
| 今日 | 预算 ¥30 / 已花 ¥22.60 / 盈余 ¥7.40 | 30−22.60=+7.40 ✓ |
| 本周 | 总 ¥90 / 截至今日 ¥30 / 已花 ¥22.60 / 盈余 ¥7.40 / 本周剩余 ¥67.40 | 仅 10/16~18 有预算=90 ✓ |
| 本月 | 总 ¥480 / 截至今日 ¥30 / 已花 ¥22.60 / 盈余 ¥7.40 / 本月剩余 ¥457.40 | 10/16~31 16 天=480，¥700 排除 ✓ |

**停用场景**（10-16 规则改为 enabled=false）：今日显示「今日未启用预算 / 该时段未启用预算，支出不参与预算比较 / 调整预算」，**不显示**「预算 ¥0 超支 ¥22.60」。

**历史月（9 月）**：日历按 9-01 ¥30 规则着色——1~30 日多为绿色（无消费日全盈余），10 号 AirPods（¥899）红色明显超支，15 号午餐（¥1.99）仍盈余；下方「本月最终 -¥18.90（红）、上月最终 —」，无「截至今日」。

预算设置页：启用 ON、¥30.00/天、生效日期 2026-10-16、说明文字、保存按钮。

### 已知模拟器限制 / 注意

- **Canvas 日价曲线在 Skyline 模拟器仍不渲染**（v0.4.0 遗留，工具限制），只能真机验收。
- automator 0.12.1：
  - **`mp.reLaunch` 会触发 "Uncaught [object Object]" 并损坏实例**，已改用 `navigateTo / navigateBack` 触发 main onShow；
  - **跨独立 connect 组件运行时 data 会重置回初始值**，故「进入预算 + 切 kind + 截图」须在同一连接内完成，连接间 sleep 8s；
  - 同连接连续写过多会 `timeout waiting for automator response`（数据通常已落盘），已拆脚本规避。
- 记一笔 Sheet 在模拟器下，底层「¥722.60」数字轮廓仍隐约可见；真机渲染与模拟器不同，是否「正文不可辨认」以真机 Gate 为准（若真机能做到不穿透，该 Sheet 冻结，不继续提高不透明度）。

截图目录 `docs/screenshots/v0.5.1/`（均为开发者工具模拟器，文件名统一带 `_simulator`，未冒充真机）：

- `budget_today_simulator.png`、`budget_week_simulator.png`、`budget_month_simulator.png`
- `budget_calendar_simulator.png`、`budget_day_detail_simulator.png`
- `budget_nobudget_simulator.png`、`budget_history_month_simulator.png`
- `budget_settings_simulator.png`、`quick_entry_readability_simulator.png`

---

## 11. 真机 Gate（待用户执行，助手不代签）

状态如实标记：

- **Android physical device：NOT TESTED（待用户）**
- **iOS physical device：NOT TESTED（无真机）**
- 模拟器：PASS（预算口径 / 布局 / 数据；Canvas 曲线除外）

建议用两个真实操作快速验证口径：

1. 10/01~15 已有支出，预算 10-16 起 ¥30/天：
   - 今日只比较 16 日；
   - 本周只比较 16 日起预算生效的日期及这些日期的支出；
   - 本月 10/01~15 消费不参与预算盈亏；
2. 再设 10-20 起关闭预算，20 日之后的消费不显示预算超支。

延续项：今日 / 本周 / 本月切换，Hero 在 360px 不换行；日历 7 列、2 月 / 31 天月份正常；今天紫色描边；绿 / 红在深色背景不过亮；点日历日详情数值正确；改预算后立即刷新；过去月份历史不因新规则改变；记一笔 Sheet 背景正文不穿透、毛玻璃 / 紫色氛围仍在；（v0.4.0 遗留）日价 Canvas 曲线真机可见、触摸左 / 中 / 右定位正确、tooltip 不出屏。

> 真机截图（上述各图无 `_simulator` 版本）待用户提供，未用模拟器冒充。
> 真实账单只在用户手机本地，不提交 GitHub、不发邮件、不发文件；脱敏诊断不含姓名 / 商户 / 商品 / 账号 / 交易号 / 金额明细 / 文件名。

---

## 12. 本版明确不做

v0.5.1 只做预算口径修正与交互收口。明确不做：分类管理、周期记账、预算分类豁免、退款抵预算、周末特殊预算、周 / 月预算金额单独设置、预算历史管理器复杂 UI、预算日历 Heatmap 彩虹化、AI、云同步、登录 / OpenID、银行导入、社交分享、排行榜、资产残值、寿命预测、"回本 / 物有所值 / 消费理性"评价。**预算 / 日价只陈述数学事实，不做消费评价。**

本版提交后停止，不自行进入 v0.6.0，下一阶段方向由用户决定。

---

## 13. Git 状态

- 提交信息：`v0.5.1: Budget correctness and interaction closure`
- 推送方式：经显式代理 `http://127.0.0.1:33210`
- 最终结果：HEAD == origin/main，ahead=0 / behind=0，working tree clean（SHA 见 push 后 git log / 交付说明）
