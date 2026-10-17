# HANDOFF — DailyValue Mini v0.7.0（Experience & Reliability）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**0.7.0**
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + packages 两处）、`README.md`）
- 上一版本基线：v0.6.1（HEAD `a181569`）
- 本版定位：1.0 前的整体**体验 / 性能 / 稳定性收口**。**不新增任何业务模块，不改动核心数据合同**（Bill V3 / Recurring Store V1 / Budget V1 冻结）。

---

## 1. 本版目标

到 v0.6.1，Mini 的核心功能建设期已结束（记账、搜索、微信/支付宝导入、Android 迁移、月度/年度统计、日价、预算、分类、周期、备份恢复）。v0.7.0 不再堆功能，而是把已有能力收成「像完成品」：

1. 统一视觉语言（Design Token / 统一 Header / 统一 Bottom Sheet / 系统图标去 Emoji）；
2. 快速记账与周期页的真机健壮性、信息层级；
3. 数据规模上来后的性能（分类批量解析、1k/5k/10k 大账本 Gate）；
4. 统一空态、只读数据健康体检、备份恢复健康门；
5. E2E 黄金路径从 7 条扩到 12 条，并修掉两个 P0（E2E 周日陷阱、Android 周期迁移 fail-closed）。

---

## 2. P0 前置修复（提交 `2e12d92`）

### P0-1｜E2E「周日陷阱」确定性化

旧「每周日」用例 `startDate=今天 / time=09:00`，预期函数把「下一个周日」定义为不含今天。周日 09:00 前跑会期待 7 天后（实际规则认为是今天 09:00 未到），09:00 后又可能触发补记弹窗——**每到周日随机失败**。

修复：`startDate` 改为严格未来的下一个周日（`nextFutureWeekday(0)`），`time=00:00`，无论星期几、几点运行都只有一个确定的未来 occurrence，且无补记弹窗。自动化测试不再依赖执行当天的星期与时刻。

### P0-2｜Android 周期迁移改为 fail-closed

旧 Adapter 遇到损坏规则会偷偷改语义：`frequency="foobar"` 被兜底成 `daily`，非法 day 被 sanitize 自动修正。

修复：外部迁移数据不确定就**跳过而非改写**——unsupported frequency、weekly day 非 0–6、monthly/yearly day 非 1–31、yearly month 有值但非 1–12 一律跳过，计入 `skippedRecurringRules` 脱敏诊断；yearly month 缺失属合法（回退 startDate 月）。不把损坏的「每年」偷偷修成「每天」。

---

## 3. G1–G12 落实

### G1 统一 Design Token（`ffce6c6`）

- 扩展 `app.wxss` 语义 Token：`--glass-page/card/sheet/input`、`--button-primary/danger/disabled`、`--divider`、`--text-title/body/caption`、`--space-page/card` 等。
- **硬约束（Skyline 实测）**：所有 CSS 变量值必须**单行**，多行变量值 Skyline 不渲染。
- 原则：相同东西看起来必须相同；不做大范围 CSS 框架重写。

### G2 统一 page-header 组件（`ffce6c6`）

- 新增 `components/page-header/`，统一负责 statusBar、headerHeight、返回按钮、标题、微信胶囊避让。
- 全二级页（设置、分类管理、周期记账、预算设置、数据与隐私、备份恢复、日价详情、数据导入、搜索）替换各自维护的 Header CSS，根除历史上 `padding-top + height` 冲突。
- **方案 B 页面级注册**：在各页 usingComponents 注册；在全局 app.json 注册会编译失败黑屏。

### G3 全量 Bottom Sheet 收敛（`8603471`）

- 主页「分类统计明细」原本自实现 `cat-mask / cat-sheet`，迁回公共 `components/bottom-sheet/`。
- 记账、日价、分类编辑、周期编辑、预算日详情、统计分类详情共用同一 Sheet；遮罩、动画、圆角、安全区、毛玻璃不透明度只改一处。

### G4 系统操作图标去 Emoji（`f05b0f6`）

- 新增 `components/dv-icon/`，12 个线性图标。设置、搜索、返回、删除、更多、编辑、Chevron 等**系统操作**禁用 Emoji，统一 dv-icon。
- **分类图标仍允许 Emoji**（🍚 餐饮、🚗 交通是用户内容，两个概念明确分开）。

### G5 快速记账 Sheet 真机健壮性（`fa5024f`）

- 金额输入高度固定、支出/收入轻量 Segmented、分类最近使用、日价开关、不透明度收口。
- 金额压力值 `¥9.99 / ¥999.99 / ¥12,345.67 / ¥999,999.99` 不裁切、不换行；长商户 / 长备注省略正常。

### G6 周期卡信息层级（`c415d18`）

- 从「后台管理表格」改为「金额为主、分类·频率次之、下次执行弱化、开关右上」：`¥28.00 / 餐饮 · 每周日 / 下次 10月18日`。
- `.rc-add` 改为 `wx:if="{{!empty}}"`，空列表时新建入口由 empty-state 的 action 承担。

### G7 分类解析单次渲染快照（`6ac152a`）

- 旧 `store.getCategory(id)` 每次都读 `categories.json`；主页 Timeline 逐条解析，300 条账单读盘数百次。
- 新增 `getCategoryMap()` / `getCategoryResolver()`，每次页面 refresh **只读一次**分类文件，再整批解析。Accounting / Statistics / Recurring / DailyValue 统一使用。
- 不做全局永久缓存（避免改名/归档后缓存失效），只做单次渲染快照，最安全。

### G8 大账本性能 Gate（`aa68faa`）

- 新增 `tests/perf/large-ledger.perf.js`（`npm run perf`），自动生成 1,000 / 5,000 / 10,000 笔虚构账单，验证冷启动、当月 Timeline、年度统计、预算日历、搜索、日价列表与分类读盘次数。
- 实测（本机）：

| 规模 | 全量加载 | 当月 Timeline | 年度统计 | 全量搜索 | 预算日历 | categories.json 读取 |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 2ms | 1ms | 3ms | 2ms | 5ms | 1 次 |
| 5,000 | 6ms | 0ms | 5ms | 7ms | 8ms | 1 次 |
| 10,000 | 8ms | 36ms | 13ms | 18ms | 19ms | 1 次 |

- 10k/1k 全量加载比 4.0x（阈值 ≤40x），近线性；无崩溃、口径正确。未预先引入虚拟列表。

### G9 统一 empty-state 组件（`ec37fc4`）

- 新增 `components/empty-state/`（最多图标 + 标题 + 一句说明 + 可选操作按钮），迁移 7 处引导空态：周期记账、日价面板、搜索、记账面板、统计面板、日价详情、预算日历/预算 Hero。
- 预算空态（无任何预算规则时）不再显示整月全灰日历，改为「还没有设置预算 / 设置每日预算后，可以查看每天的盈余与超支 / 设置预算 >」。
- **修复 Skyline 宿主宽度 Bug**：Skyline 下自定义组件宿主节点 shrink-to-fit，组件根 `width:100%` 打不破「宿主宽度=最长文字自然宽度」循环；最终在每个引用处的外部 wxss 给 empty-state 宿主显式 `display:block;width:100%;box-sizing:border-box`。

### G10 data/health.js 只读数据健康体检（`bf07954`）

- 新增 `data/health.js`：`analyzeHealth(d)` 纯函数返回 `{ok,errors,warnings,summary}`，issue=`{level,code,scope,ref,detail}`。
  - **error（结构损坏）**：月份分片损坏/shape/version、bill 缺 id/重复 id/type/amount/occurredAt/ledgerImpact 非法、日价 startDate 非法、周期账单缺 ruleId、周期规则各字段非法、预算规则非法；
  - **warning（放行）**：ym 与分片不匹配、金额非正、分类缺失/未知（归档分类在全量集合中不误报）、周期账单孤儿 rule（删除规则后历史保留属正常）、预算 enabled 非法、manifest schema 提示。
- `collectHealthData` 用 `fs.readText` 读月份分片原文再 JSON.parse（`readJSON` 解析失败静默 fallback 会漏检损坏）；周期取原始 rules（normalize 会掩盖损坏）。
- `logHealth / formatHealthReport` 脱敏：shortId 前 8 位 + …，不输出金额 / 备注 / 商户。
- 默认只读，不自动修复用户数据；先用于测试、开发诊断、备份恢复后校验。

### G11 备份恢复接入健康校验（`efe94ae`）

- `restoreBackup(backup, options)` 第 6 步加**健康终检**：有 error 抛「恢复数据健康校验未通过：<codes>」→ catch 调 `rollback(safety)` 回滚安全点；warning 放行，返回值扩为 `{restored,months,warningCount,warnings}`。
- 新增 `options.skipHealth`：仅「导入失败后用安全点救命回滚」时使用（回滚不能被健康门阻断）。
- 恢复后 warningCount>0 弹 modal 说明「检测到 N 项历史引用提示（如已删除的分类或周期规则），不影响正常使用」；真正结构损坏才回滚（归档分类、已删规则的历史引用属 warning）。

### G12 E2E 黄金路径扩到 T01–T12（`10de90d`）

- 在 v0.6.1 的 7 条上扩到 12 条，全部真实 WXML/Skyline 接线断言：
  - T01 主页、T02 设置（版本号一致）、T03 分类；
  - T04 周期新建「每周·周日 ¥28」（确定性未来周日）、T05 停用+重启用、T06 编辑改金额+删除；
  - **T07 预算设置**（表单联动 + 保存，结束恢复原预算）、**T08 预算 Hero**（今日/本周/本月分段 DOM 断言）、**T09 搜索**（初始 + 无结果空态）；
  - **T10 快速记账新增**、**T11 编辑改金额后删除**（幂等清理）、**T12 日价新增 + 详情删除**。
- 固定测试标识：`E2E回归` / `E2E账单回归` / `E2E日价回归物品`，用例幂等（开头清残留、结尾删除）。
- 数学算法仍归 Node 单测，E2E 只验证「接线」（页面渲染、data 绑定、交互闭环）。

---

## 4. 数据合同冻结声明

v0.7.0 **未改动**以下合同，全部冻结：

- **Bill V3**：分片 `bills/YYYY-MM.json = {ym,version:3,bills:[...]}`；不可变字段 `id/type/amountCents(整数分)/occurredAt/ledgerImpact/dailyValue`，`source`、`recurringRuleId` 沿用。
- **Recurring Store V1**：`recurring.json = {version:1,rules:[...]}`；确定性 Bill id `recur-{ruleId}-{date}-{time}`；MAX_CATCHUP_PER_RULE=365；删除不复活、编辑只影响未来、停用不补。
- **Budget V1**：`settings.budget = {version:1,weekStartsOn,rules:[...]}`。
- **Backup V3**：`daily-value-mini-backup` SCHEMA=3，SUPPORTED=[1,2,3]，data 含 `bills,categories,settings,recurringRules`。

---

## 5. 测试结果

### 5.1 纯逻辑单测：`npm test`（`tests/run-all.js`，独立子进程跨平台）

**833 项全绿、11/11、退出码 0**：

| 套件 | v0.6.1 | v0.7.0 | 结果 |
| --- | --- | --- | --- |
| device.test.js | 6 | 6 | PASS |
| data.test.js | 100 | 100 | PASS |
| accounting.test.js | 45 | 45 | PASS |
| statistics.test.js | 65 | 65 | PASS |
| daily-value.test.js | 97 | 97 | PASS |
| budget.test.js | 133 | 133 | PASS |
| categories.test.js | 49 | **60**（+11 分类快照） | PASS |
| recurring.test.js | 107 | 107 | PASS |
| settings.test.js | 15 | 15 | PASS |
| **health.test.js** | — | **61（新增套件）** | PASS |
| importer.test.js | 126 | **144**（+18 fail-closed 迁移） | PASS |
| **合计** | **743 / 10 套件** | **833 / 11 套件** | **全绿** |

### 5.2 GUI 端到端：`npm run e2e`（miniprogram-automator + 微信开发者工具）

**T01–T12 全绿 12/12，退出码 0**，自动归档 8 张真实子页截图（`docs/screenshots/e2e/`）。

### 5.3 性能：`npm run perf`

1k/5k/10k 全绿，近线性，分类快照在 520 条当月账单下只读 `categories.json` 1 次（见 G8）。

---

## 6. 模拟器验证（已执行）

环境：微信开发者工具 Stable 2.02.2608080，Skyline 模拟器（390×844）。本轮 GUI 验证走 miniprogram-automator WebSocket（不依赖屏幕可见 / 向日葵虚拟会话），选择器与 data 字段以页面源码为准。

### 关键方法论：常驻主页「截图帧冻结」

实测 automator + Skyline：**常驻主页 main 在同一会话内，多次切 tab / setData 后，`mp.screenshot` 会永久停在本会话第一张主页帧**（DOM/data 已正确变化，断言全绿，但画面不更新）；而 `navigateTo` 打开的二级子页每次都是新页面，截图始终新鲜。

对策（已固化进 `docs/E2E_TESTING.md` 与 shared skill）：

- 主页三态（记账 / 统计 / 日价）与预算 Hero：**每个目标场景独立重启一次 IDE**（`cli quit` + 重新 `cli auto`），全新连接后只做一次切 tab 即截图，保证新鲜；
- 二级子页：同一会话顺序 `navigateTo` 即可；
- 接线正确性一律以 DOM/data 断言为准，GUI 截图仅作视觉留档。

### 截图目录（均为模拟器 Skyline，文件名统一带 `_simulator`，未冒充真机）

`docs/screenshots/v0.7.0/`（本轮冷启动重拍的主页真实态）：

| 文件 | 内容 |
| --- | --- |
| `home_accounting_simulator.png` | 记账 Tab：支出/预算分段、本月支出、时间线 |
| `home_budget_hero_simulator.png` | 预算 Hero：今日预算 ¥30、盈余绿色语义、已花 |
| `home_statistics_budget_calendar_simulator.png` | 统计 Tab：预算日历（盈余绿/超支红/无预算灰/今天）+ 图例 + 本周/本月节奏 |
| `home_daily_value_simulator.png` | 日价 Tab：每日总花费、物品列表与每日成本 |
| `empty_state_daily_value_simulator.png` | 日价空态（本轮新补） |
| `daily_value_detail_simulator.png` | 日价详情：Header、日价、里程碑、使用时间（**曲线区空白，见下**） |

同目录另有 G1–G9 留档：统一 Header（`header_*`）、玻璃 Sheet（`bill_form_*` / `daily_value_form_glass` / `category_detail_sheet`）、FAB dv-icon（`fab_plus_icon*`）、快速记账大金额（`quick_entry_large_amount`）、周期卡层级（`recurring_cards_hierarchy`）、周期/预算空态（`empty_state_recurring` / `empty_state_budget_*`）。

`docs/screenshots/e2e/`（8 张）：主页、设置、分类管理、周期每周日、停用、重启用、编辑、空态。

### 已知模拟器限制（必须真机确认）

- **日价「日价下降曲线」Canvas 区域在 Skyline 模拟器为空白**（v0.4.0 起遗留，本轮模拟器仍复现）：Header、当前日价、里程碑、使用时间均正常，仅 Canvas 2D 曲线未绘制。可能是 Skyline 模拟器的 Canvas 支持差异，也可能是真机问题，**不能在模拟器下结论，必须真机验收**。
- Console 中 `net::ERR_CONNECTION_RESET` / `reportRealtimeAction:fail` / crashpad `TransactNamedPipe` / punycode 弃用为基础库 / 环境网络无害告警，与业务无关。

---

## 7. 真机 Gate（待用户执行，助手不代签）

状态如实分开标记：

- **Agent simulator（automator + Skyline）：PASS** —— 单测 833、E2E 12、性能 1k/5k/10k；统一 Header/Sheet/图标、快速记账、周期卡层级、空态、预算 Hero/日历、日价列表均通过；**Canvas 曲线除外**。
- **User physical device（Android）：NOT TESTED（待用户）**
- **User physical device（iOS）：NOT TESTED（无真机）**

请在真实微信 Android 上重点验证并回传截图（无 `_simulator` 后缀，建议放 `docs/screenshots/v0.7.0/`）：

1. **`daily_value_curve_android.png`（最高优先级，v0.4.0 起欠账）**：进入日价详情，**日价下降曲线真机可见、触摸定位正确**。模拟器此区空白，真机结果决定是否需要单独修 Canvas。
2. `quick_entry_android.png`：快速记账 Sheet 在键盘弹起 / 安全区 / 360px 窄屏下不遮挡、不裁切；`¥999,999.99` 等大金额完整。
3. `glass_sheet_android.png`：各 Bottom Sheet 毛玻璃正文不穿透、不出现背景文字重影。
4. `category_manage_android.png`：新增 / 改名 / 归档 / 恢复；归档后新记账不可见、历史账单保留原名。
5. `recurring_android.png`：周期 chips 不错位、停用显示「已停用」、编辑只影响未来、打开即补账且重开不重复。
6. `budget_android.png`：预算 Hero / 日历 / 图例颜色正确（盈余绿、超支红）。
7. `large_ledger_android.png`：导入 5,000+ 账单后主页滚动 / 切月 / 统计 / 搜索无明显冻结与崩溃。

> 真实账单只在用户手机本地，不提交 GitHub、不发邮件、不发文件；脱敏诊断不含姓名 / 商户 / 商品 / 账号 / 交易号 / 金额明细 / 文件名。

---

## 8. 本版明确不做

v0.7.0 只做体验 / 性能 / 稳定性收口，不做：账户体系、银行卡、资产管理、多人账本、云同步、AI、分类预算、收入预测、后台通知 / 提醒（只承诺「打开小程序时自动补齐」周期账单）、新导入源；不做大数据库改造。

本版交付后进入 v0.8.x 发布准备（隐私说明、微信审核、版本升级 / 迁移演练、最终真机兼容），不再无限堆新功能。

---

## 9. Git 状态

- v0.7.0 提交（基线 `a181569` 之后）：`2e12d92`（P0）、`ffce6c6`（G1/G2）、`8603471`（G3）、`f05b0f6`（G4）、`90897f6`（G1–G4 截图）、`fa5024f`（G5）、`c415d18`（G6）、`6ac152a`（G7）、`aa68faa`（G8）、`ec37fc4`（G9）、`bf07954`（G10）、`efe94ae`（G11）、`10de90d`（G12）、`6345544`（G13）与本提交（G14）。
- 推送方式：经显式代理 `http://127.0.0.1:33210`，push 强制 HTTP/1.1。
- 最终结果：HEAD == origin/main，ahead=0 / behind=0，working tree clean（SHA 见 push 后交付说明）。
