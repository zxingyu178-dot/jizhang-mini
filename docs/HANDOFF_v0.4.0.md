# HANDOFF — DailyValue Mini v0.4.0（Daily Value Core）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**0.4.0**
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + packages 两处）、`README.md`）
- 上一版本基线：v0.3.2（HEAD `434327fc`）
- 本次提交：v0.4.0（Commit `aa06882`，已 push，见文末 Git 状态）

---

## 1. 本版目标

第一次实现"每日的价值"产品核心：一笔消费不仅记录"花了多少钱"，还能给出"截至今天，它每天值多少钱"。

两种语义：

| 入口 | ledgerImpact | 进入记账/统计 | 进入日价 |
| --- | --- | --- | --- |
| 普通账单，开启「计算日价」 | `normal` | 是 | 是 |
| 日价页 FAB 直接新增物品 | `daily-value-only` | **否** | 是 |

**日价永远从 Bill 派生**，没有第二套数据库；当前日价不持久化，每天动态重算。

---

## 2. Gate 完成情况

### Gate A — Bill V2 数据合同（P0）
- `data/ledger.js` SCHEMA_VERSION=2；Bill 新增 `title`、`ledgerImpact`（`normal` / `daily-value-only`）、`dailyValue`（optional：`{enabled, mode:'elapsed', startDate}`）。
- 新增 `normalizeDailyValue()`（仅 `enabled===true` 且 `startDate` 为合法 `yyyy-MM-dd` 才返回对象，否则 null）、`normalizeLedgerImpact()`、`listAccountingMonths(nowTs)`、`applyDailyValuePatch()`。
- `data/manifest.js` SCHEMA_VERSION=2，含 billV2 迁移项；新增 `data/migration-schema.js`（schema 迁移：空账本直接 done；否则快照 + 不可变字段留档 → 逐月升级 → 校验 version/title/ledgerImpact/dailyValue/不可变字段/条数 → 成功置 2；失败 restoreMonths + failed + 抛错）。
- **Ledger 边界修复**：
  - `monthSummary().count` 只数 normal 账单（此前 daily-value-only 会被计入 count，导致"支出 0 但本月有账"）。
  - `monthGrouped()` 只放 normal 账单。
  - 新增 `listAccountingMonths()`：只返回"至少一笔 normal 账单"的月份 + 当前月；空月份文件不再成为导航节点。
  - 搜索（`pages/search`）只搜 normal，且把 `title` 纳入匹配字段。
- V1 → V2 无损迁移：不改变 id / amountCents / occurredAt，可重复执行、失败可回滚。

### Gate B — 日价计算核心（纯函数）
- 新增 `data/daily-value/`：`core.js`、`list.js`、`detail.js`、`curve.js`、`milestones.js`、`index.js`，全部纯函数，整数分，日价为派生浮点分。
- 口径（与 Android 权威源码一致）：
  - 日期编号 `dayNumber = Date.UTC(y, m-1, d) / 86400000`（纯日历日，不受时区/夏令时影响）。
  - `elapsedDays = max(1, dayNumber(today) - dayNumber(start))`（购买当天=1、昨天=1、相差 100 个日历日=100）。
  - `dailyValueCents = amountCents / elapsedDays`（派生值，不持久化）。
  - 每日总花费 = 所有 `dailyValue.enabled` 账单当前日价之和（normal 与 daily-value-only 都参与）。

### Gate C — 日价主页
- 重写 `components/daily-value-panel`：Hero「每日总花费」+「N 件物品」为第一视觉中心；列表透明 + 细分割，按当前日价降序；点击进详情。
- 全局 FAB 扩展为三态：统计无 FAB、记账 FAB=记一笔、日价 FAB=添加日价物品（同一个 FAB，无第二个）。

### Gate D — 日价新增
- 新增 `components/daily-value-form`（名称/金额/分类/起算日期/备注），保存为 `ledgerImpact:'daily-value-only'`、`occurredAt=起算日零点`，并明确提示"该物品只进入「日价」，不会计入账单支出和统计"。
- `components/bill-form` 增加「计算日价」玻璃开关（仅支出可开），开启后以账单日期为起算日、`ledgerImpact` 始终 normal；编辑时开关状态正确回显，关闭开关显式 `dailyValue=null` 且不删账单。

### Gate E — 日价详情页
- 新增 `pages/daily-value-detail/detail`（已注册 `app.json`）：Hero 主数字为「当前日价 ¥xx/天」，含已用天数/原价/起算日。
- 语义：
  - `daily-value-only`「删除」→ `deleteBill` 整单删除。
  - `normal + dailyValue`「移出日价」→ `updateBill(id,{dailyValue:null})`，普通账单保留。
  - 「编辑」复用 daily-value-form，不改变 ledgerImpact。

### Gate F — 日价下降曲线
- 新增 `components/daily-value-curve`：**原生 Canvas 2D，未引入 ECharts**；折线 + 轻面积渐变 + 少量标签 + 触摸轻提示（日期/已用天数/日价，无十字线）。
- 曲线完全动态计算，不存每日快照；`CURVE_MAX_POINTS=100`，长周期采样但始终保留第 1 天、今天及 7/30/100/365/730… 关键节点。

### Gate G — 里程碑
- 使用时间节点：7 / 30 / 100 / 365 / 730 / 1095 / 1460 / 1825。
- 日价目标：100 / 50 / 100 等（¥100/50/20/10/5/1 每元），`requiredDays=ceil(amount/target)`。
- 里程碑摘要仅陈述数学事实（如"已使用 36 天，日价已降到 ¥50/天以内；下一站 ¥20/天，还需 9 天"），**不做"回本/物有所值"等评价**。

### Gate H — 跨日自动刷新
- `app.js`：`onShow` 刷新 + 调度下一次本地午夜 timer；`onHide` 清 timer；午夜到达重算日价并刷新 Hero/列表/详情。
- timer 每次重新计算"距下一次本地午夜"（非固定 24h），避免 DST 漂移。
- `refreshVisibleDailyValue()` 覆盖 main 页（走 refreshPanels）与详情页（loadDetail + 曲线 refresh），全程 try/catch。

### Gate I — Android .dvbackup 迁移
- `adapters/dailyvalue.js` 取消 daily-value-only 跳过，完整映射 title/ledgerImpact/dailyValue；CSV 继续仅迁移普通账单（CSV 无完整日价字段，设置页已注明完整日价用 .dvbackup）。
- `core/commit.js` 新增 `merge` 状态：精确命中 `sourceTxnId` 且本地缺日价/title 时，用 `updateBill` 补全而不新增条数；对 CSV 导入的历史账单做保守匹配（type/amountCents/categoryId/note/occurredAt 同一分钟），命中 0 新建、恰好 1 条补全、多条进需确认，不自动猜。

### Gate J — Mini 备份 V2
- `data/backup.js` SCHEMA_VERSION=2、兼容 V1/V2；V2 完整保存 title/ledgerImpact/dailyValue；V1 旧备份恢复时经 createBill 自动补全字段。

---

## 3. 本版修复的两个真实 P0（调试阶段定位）

1. **小程序模块系统不支持目录自动解析**：`require('./daily-value')` 在 Node 下解析到 index.js（测试全绿），但小程序（lazyCodeLoading=requiredComponents）报错 `module 'data/daily-value.js' is not defined`，导致三个 Panel 渲染成 `<default-component>`、页面白屏。已将 7 处目录 require 全部改为显式 `./daily-value/index`。
2. **导入账单缺少 id**：`core/commit.js` 此前把 `toLedgerBill()` 结果直接 concat 写盘、绕过 `createBill`，导致**所有导入账单缺 id/createdAt/updatedAt**（真实 JSON 无 id 键），无法编辑/跨月/迁移。已改为经 `ledger.createBill()`，并在 importer 测试新增 10 项断言。

---

## 4. 测试结果

`npm test`（`tests/run-all.js`，独立子进程，跨平台）：

| 套件 | 数量 | 结果 |
| --- | --- | --- |
| device.test.js | 6 | PASS |
| data.test.js | 92 | PASS |
| accounting.test.js | 45 | PASS |
| statistics.test.js | 65 | PASS |
| daily-value.test.js | 82 | PASS |
| importer.test.js | 74 | PASS |
| **合计** | **364** | **全绿，退出码 0** |

覆盖：V1→V2 无损迁移、title/dailyValue 持久化、daily-value-only 不进 monthSummary/monthGrouped/搜索、normal+dailyValue 正常进统计、日价列表选择与降序、elapsed（当天/昨天/100 日/DST）、总日价、两种表单、曲线（第1天/今天/单调/采样上限）、两类里程碑、.dvbackup 迁移与不重复、V2 备份与 V1 兼容等。

---

## 5. 模拟器验证（已执行）

环境：微信开发者工具 Stable 2.02.2608080，miniprogram-automator 0.12.1，机型 **iPhone 12/13（390×844，iOS 模拟器）**。干净 USER_DATA_PATH 冷启动：

- init：initialized=true、schemaVersion=2、schemaMigration done（空账本）、**无 console 错误**。
- 日价独立新增（UI 表单）：MacBook Pro ¥6088 / 起算 2025-10-26 → 日价 ¥17.15/天，sheet 正常关闭。
- Ledger 边界：daily-value-only 不进记账（10月 ¥0.00、isEmpty、timeline 0）、月份导航不含 2025-10。
- 普通账单开日价：新增 ¥100（当天 elapsed=1）→ 记账 10月 ¥100、日价 ¥100/天、统计含。
- 日价详情：Hero、里程碑摘要、使用时间、日价目标均正确。
- 移出日价（normal）：账单仍在、日价移除、记账/统计保留。
- 删除（daily-value-only）：整单消失。
- .dvbackup 导入（fixture 3 笔）：预览 ready=3；确认后 9月记账含午餐/AirPods/工资（支出 ¥918.90、收入 ¥6000），daily-value-only 的虚构笔记本只进日价（¥88.87/天）。

日价数值复核（计算器一致）：AirPods 899/36=24.97；iPhone 5999/288=20.83；MacBook 6088/355=17.15；咖啡机 1200/137=8.76；虚构笔记本 3999/45=88.87。

### 已知模拟器限制
- **Canvas 曲线在 Skyline 模拟器下不支持调试**：控制台明确提示"开发者工具暂未支持 Skyline 下的 canvas 组件调试，请先到真机上预览调试"。因此 `daily_value_curve.png` 中曲线区域为空白，**这是开发者工具限制，不是代码问题**；Canvas 2D 曲线必须在真机验证（已列入真机 Gate）。

截图目录：`docs/screenshots/v0.4.0/`（daily_value_list / add / normal_bill / detail / curve / milestones / android_import，共 7 张）。**以上截图均来自 iOS 模拟器（iPhone 12/13），不是真机**。

---

## 6. 真机 Gate（待用户执行，助手不代签）

以下状态如实标记：

- **Android physical device：NOT TESTED（待用户）**
- **iOS physical device：NOT TESTED（无真机）**
- iOS simulator：PASS（功能/布局，曲线除外）
- Android 真机需至少完成：
  1. 普通账单 ¥100 开「计算日价」→ 记账、统计、日价三处都有；
  2. 日价页直接新增 ¥100 物品 → 只进日价、统计不增；
  3. 改起算日期 → 日价立即变化；
  4. 日价详情 → Hero、**曲线（真机 Canvas）**、里程碑正常；
  5. 改金额 → Hero/曲线/里程碑同时刷新；
  6. normal 账单移出日价 → 普通账单仍在；
  7. daily-value-only 删除 → 整个物品消失；
  8. Android .dvbackup 导入 → 原有日价正确出现，再次导入不重复。

> 真实账单只在用户手机本地，不提交 GitHub、不发邮件、不发文件；脱敏诊断不含姓名/商户/商品/账号/交易号/金额明细/文件名。

---

## 7. 本版明确不做

周期记账、预算、AI、云同步、登录/OpenID、银行导入、Merchant Rule、自定义统计模块、完整 SVG 分类图标系统、社交分享、排行榜、资产残值、寿命预测、"回本"评价。分类 emoji 本版保留。

---

## 8. Git 状态（已 push）

- Commit SHA：**aa06882aafec898909b5b96c43ea4da6b7abf82b**
- origin/main SHA：**aa06882aafec898909b5b96c43ea4da6b7abf82b**
- 提交信息：`v0.4.0: Daily Value core, detail, curve and migration`
- 推送方式：经显式代理 `http://127.0.0.1:33210`
- 结果：HEAD == origin/main，**ahead=0 / behind=0，working tree clean**
