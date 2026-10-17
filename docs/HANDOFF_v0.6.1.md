# HANDOFF — DailyValue Mini v0.6.1（Recurring & Migration Closure）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**0.6.1**
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + packages 两处）、`README.md`）
- 上一版本基线：v0.6.0（HEAD `882d6f7`）
- 本版定位：不新增业务模块，收口周期记账与 Android 迁移正确性；冻结预算，不开 v0.7.0。

---

## 1. 本版目标

v0.6.0 主体架构成立，但用户审 main 发现一个确定的 P0 迁移错误（Android「每周日」被错导成「每周一」）与若干周期可靠性 / 交互问题。本版按用户 12 项清单逐项收口，另在交付过程中修复两个真实缺陷：

- **额外修复 A（严重）**：v0.6.0 遗留的生成器并发锁会永久不释放（onLaunch 后所有 onShow / 编辑 / 导入触发的补账被吞）；
- **额外修复 B（阻断，模拟器阶段发现）**：Skyline 渲染模式下周期编辑器的横向选择 chips（星期 / 日期 / 月份 / 分类）高度塌陷为 0，导致无法选择周几 / 几号 / 分类。

---

## 2. 用户清单 12 项落实

### 1）P0｜Android「每周日」迁移错误（day=0 被改成周一）

- 旧 `packages/importer/adapters/dailyvalue.js` 对 day 一律 `Math.max(1, round(r.day))`，把 Android `weekly day=0`（周日）错误改成 1（周一）。
- 修复：按 frequency 分域规范化，不再统一 `Math.max(1,…)`：
  - weekly：day 仅允许 **0–6**（0=周日，与 Android、JS `getDay()` 一致）；
  - monthly / yearly：day 仅允许 1–31；
  - daily：忽略 day。
- 原始值交给 `recurring.core.sanitizeRecurringRule` 统一兜底，Importer 新增「每周日 / 周六 / 每 2 周」迁移测试，664→743 测试中已覆盖此回归。

### 2）编辑规则后立即刷新「下次执行」

- 旧编辑 `editRule` 写 `scheduleEffectiveAt` 后直接关 Sheet，nextOccurrence 要等下次 onShow 才纠正。
- 修复：`pages/recurring/recurring.js` 保存后立即 `await runRecurringGenerator()` 再重新 `load()`，列表即时显示真实下次日期；已有 `scheduleEffectiveAt` 保证不会错误回填历史。

### 3）停用规则不再显示「下次 xx」

- 数据层保留 `nextOccurrence` 游标（便于恢复）；列表渲染层 `enabled=false` 时显示「已停用」，不再显示「下次」。
- 重新启用并运行 Generator 后恢复真实下次日期。WXSS 新增 `.rc-card__next--off`（弱化样式）。

### 4）超过 365 条的补记提示不再说假话

- 旧 `countDue()` 最多数到 366，弹窗却承诺「将补记 366 笔」，而 Generator 单轮最多只生成 365。
- 修复：`countDueForRule` 返回 `{count, truncated}`：
  - `due ≤ 365`：「保存后将补记 N 笔账单」；
  - `due > 365`：明确「历史到期记录超过 365 笔，本次最多补记 365 笔，剩余将在后续打开小程序时继续补齐」，不假装给出精确总数。

### 5）Generator 异常隔离，不拖垮主界面

- 旧 `app.js`：`runRecurringCatchup().then(refreshTimeSensitiveViews)`，Generator 一旦 reject，预算 / 日价 / 主界面刷新链整体不执行，并可能产生未处理 rejection。
- 修复：`onShow` 改为 `.catch(console.error).finally(refreshTimeSensitiveViews)`；`onLaunch` 同样 catch。周期是附加能力，出错只记诊断，App 继续工作。
- 生成器内部对**单条规则**异常隔离（`corruptRules` / `failedRules`），整体异常 resolve 带 `fatalError` 但**永不 reject**。

### 6）分类归档改为 fail-closed

- 旧 `data/categories.js` 的 `archiveCategory` 用一个大 try/catch 吞掉 recurring 引用检查的所有异常，recurring.json 损坏 / IO 失败时会继续归档，可能归档仍被规则引用的分类。
- 修复：删除大 catch，直接调用 `countRulesByCategory()`；检查失败时返回 `{ok:false, reason:'recurring-check-failed'}`，UI 提示「暂时无法确认该分类是否被周期规则使用，请稍后再试」。宁可不归档，也不破坏引用关系。

### 7）Android 年度周期 `month` 缺失回退

- Android `RecurringRule.month` 为 optional；yearly 且 month 缺失时正式语义是使用 startDate 所在月份（core 已正确处理）。
- 修复：列表 `frequencyText()` 年度月份改为 `rule.month ?? parseDate(rule.startDate).m`，不再出现「每年 undefined 月」。编辑器本就已正确回退。

### 8）规则输入严格校验

- `data/recurring/core.js` 新增 `isValidDateStr`（严格 `yyyy-MM-dd`）与 `validateRecurringRule`：
  - amountCents 必须 > 0；
  - startDate 必须是真实日期；
  - time 最终规范化为 `HH:mm`；
  - 频率 / 间隔 / day / month 分域校验。
- 损坏的 Backup / Android 规则不再生成 NaN 日期或异常账单：非法迁移记录跳过并进入**脱敏诊断**（`skippedRecurringRules`，不含姓名 / 商户 / 金额明细 / 文件名）。

### 9）Android 自定义 ID 碰撞防御

- 保留现有 `dvcat-…` / `dvrule-…` 格式（不改已普遍使用的映射，避免老用户重复导入时重复创建）。
- 新增 `makeSafeIdFactory` + `stableShortHash`：常规安全 ID 维持原方案；仅当检测到 sanitize 后碰撞（如 `abc@1` / `abc#1` 同被清理成 `abc1`）时追加稳定短 hash 消歧。

### 10）同名已归档分类导入处理

- Android 备份中为有效分类，而 Mini 已有同名 `archived` 分类时，直接复用并恢复为 active，避免导入后的周期规则引用一个「新记账里看不到」的归档分类。

### 11）恢复 / 导入周期规则后立即刷新

- 完整 Backup 恢复（`backup-restore.js`）与 Android `.dvbackup` 导入（`commit.js`）写入规则后，立即触发 Generator 重算 nextOccurrence；已到期的按现有安全策略（365 上限、确认提示）补齐，不必等用户把小程序切后台再回来。

### 12）真机 Gate

- 见第 8 节，交用户真机执行；助手不代签、不用模拟器冒充。

---

## 3. 额外修复 A：生成器并发锁永久不释放（严重）

v0.6.0 的 `runRecurringGenerator` 用 `new Promise(executor)` 实现锁，executor 同步执行并在 finally 置 `runningPromise=null`，但外层在 `new Promise` 赋值完成后又把已 fulfilled 的 Promise 写回，导致锁永久非 null——**onLaunch 首次补账之后，所有 onShow / 编辑保存 / 导入触发的补账全部被静默吞掉**。

重写为**微任务调度 + drain 合并锁**：

- `runningPromise = (async () => { await Promise.resolve(); do { generateDueBills(); } while (rerunRequested); })()`；
- `p.then` 中仅当 `runningPromise === p` 才置 null；
- 整体 try/catch 永不 reject，异常 resolve 带 `fatalError`；
- 副作用：生成器真正执行推迟到微任务，同步测试在 `commitImport` 后需 `await store.recurring.runRecurringGenerator()` 才读到 nextOccurrence；`generateDueBills` / `countDueForRule` 仍是同步纯函数（绕过锁，测试直接调）。

---

## 4. 额外修复 B：Skyline 周期编辑器 chips 高度塌陷（阻断）

模拟器 Skyline 回归时发现：周期编辑器的横向 `scroll-view`（`re-chips`，共 5 处——weekly 星期、monthly 日期、yearly 月份 + 日期、分类）在 Skyline 下高度塌陷为 0，周日～周六 / 1～31 / 12 个月 / 分类 chip 全部不渲染，**用户无法选择周几、几号、月份与分类**，等于无法创建每周 / 每月 / 每年规则。

根因：`recurring.wxss` 的 `.re-chips` 只设了 `width:100%` + `white-space:nowrap`，未给横向 scroll-view 明确高度（WebView 下可由内容撑开，Skyline 下不行）。

修复：

- `recurring.wxml`：5 处 `scroll-view` 统一加 `enable-flex`；
- `recurring.wxss`：
  - `.re-chips` 加 `height:72rpx; display:flex; flex-direction:row; align-items:center; flex-wrap:nowrap;`；
  - `.re-chip` 加 `flex:0 0 auto`（横向不收缩）。

模拟器实测：星期「日一二三四五六」、日期 1–31、月份、分类（餐饮 / 交通 / 购物 / 娱乐 / 生活）chips 均正常显示、可点选。

---

## 5. 数据语义（沿用，未改动）

- 规则字段（整数分）：`{id, enabled, type, amountCents, categoryId, note, frequency, interval, day, month?, startDate:'yyyy-MM-dd', time:'HH:mm', scheduleEffectiveAt?, lastGeneratedDate?, nextOccurrence?, createdAt, updatedAt?}`；`recurring.json = {version:1,rules:[]}`。
- 确定性 Bill id：`recur-{ruleId}-{date}-{time}`；`source='recurring'`、`recurringRuleId`、`ledgerImpact='normal'`；Bill V3 SCHEMA=3；Backup V3 SUPPORTED=[1,2,3]，data 含 `bills,categories,settings,recurringRules`。
- MAX_CATCHUP_PER_RULE=365；`occ<=lastGeneratedDate` 不复活；`occMs<=scheduleEffectiveAt` 不回填；停用不生成、重启用置 `scheduleEffectiveAt=now` 不补停用期间；月末钳制、年 2/29 非闰年→2/28；weekly day 0=周日。
- 分类 `{id,name,emoji,builtin,sort,archived}`；核心 5 类 builtin 不可归档；软归档，历史账单继续解析原分类。

---

## 6. 测试结果

`npm test`（`tests/run-all.js`，独立子进程，跨平台，10 套件），最终结果 **743 项全绿、10/10、退出码 0**：

| 套件 | v0.6.0 | v0.6.1 | 结果 |
| --- | --- | --- | --- |
| device.test.js | 6 | 6 | PASS |
| data.test.js | 100 | 100 | PASS |
| accounting.test.js | 45 | 45 | PASS |
| statistics.test.js | 65 | 65 | PASS |
| daily-value.test.js | 97 | 97 | PASS |
| budget.test.js | 133 | 133 | PASS |
| categories.test.js | 45 | **49**（+4 fail-closed） | PASS |
| recurring.test.js | 62 | **107**（+45） | PASS |
| settings.test.js | 15 | 15 | PASS |
| importer.test.js | 96 | **126**（+30） | PASS |
| **合计** | **664** | **743** | **全绿，10/10** |

新增覆盖重点（v0.6.0 漏掉的真实边界）：

- Android 每周日 day=0 仍为周日、周六、每 2 周迁移；
- 每周 / 每月 / 每年 / 每 N 周 / 每 N 月；31 号月末钳制；2/29 非闰年→2/28；
- 确定性 Bill id、重复 generator / 连续 onShow 不重复、历史 catch-up 365 上限；
- 手工删除生成 Bill 后不复活；编辑只影响未来；删除规则保留历史；停用不生成、重启用不补停用期间；
- 收入周期生成 income、支出周期进预算；daily-value-only 不受影响；
- 规则损坏 / 非法金额 / 非法日期被隔离跳过并脱敏诊断；
- 分类归档 fail-closed（引用检查抛错时禁止归档）；
- Android 自定义 ID 碰撞 hash、同名归档分类恢复、重复导入不重复；
- Backup V3 往返、V1/V2 旧备份仍能恢复；导入 / 恢复后 nextOccurrence 重算。

---

## 7. 模拟器验证（已执行）

环境：微信开发者工具 Stable 2.02.2608080，Skyline 模拟器（iPhone 12/13，390×844）。

> 本轮先解决了 GUI 会话隔离问题：此前用命令行拉起的 IDE 窗口落在另一个显示层，可跨层只读抓图（PrintWindow）但无法点击；本轮在可操作主屏双击桌面「微信开发者工具」图标启动，IDE 完整落在可操作侧，导航与点击均正常。

实测通过（均为真机操作前的模拟器冒烟，非真机结论）：

1. **主页**：编译渲染 v0.6.1，本月支出 ¥722.60、时间线正常，Console 仅 Skyline 双渲染提示，无业务错误；
2. **分类管理**：系统 5 类（无归档按钮）、我的 7 类（各有归档）、+ 添加分类；
3. **周期编辑器**：chips 修复后，星期 / 日期 / 分类横向选择正常显示；
4. **每周日规则（P0 直观验证）**：新建「每周 · 周日 ¥28 · 餐饮」，保存后列表显示「每周·周日 ¥28.00 餐饮 下次 10月18日」（2026-10-17 周六，下一次周日为 10/18，正确）；
5. **停用 / 重启用**：停用后开关变灰、显示「已停用」（不再显示「下次」）；重新启用后恢复「下次 10月18日」；
6. 删除规则弹确认「删除后不再自动生成；已生成的账单全部保留」，删除后列表回空态，测试规则已清理。

截图目录 `docs/screenshots/v0.6.1/`（均为开发者工具模拟器 Skyline，文件名统一带 `_simulator`，未冒充真机）：

| 文件 | 内容 |
| --- | --- |
| `main_accounting_simulator.png` | 记账 Tab：本月支出 ¥722.60、时间线 |
| `category_manage_simulator.png` | 分类管理：系统 5 类只读 + 我的 7 类归档按钮 |
| `recurring_editor_simulator.png` | 新建周期：每周 + 星期 chips + 分类 chips（chips 修复后） |
| `recurring_weekly_sunday_simulator.png` | 每周·周日 ¥28.00 餐饮，下次 10月18日（P0 直观验证） |
| `recurring_disabled_simulator.png` | 停用后显示「已停用」，不再显示下次 |

### 已知模拟器限制

- **Canvas 日价曲线在 Skyline 模拟器仍不渲染**（v0.4.0 遗留，工具限制），只能真机验收；
- Console 中 `net::ERR_CONNECTION_RESET` / `reportRealtimeAction:fail` 为微信基础库 / 环境网络提示，与业务逻辑无关。

---

## 8. 真机 Gate（待用户执行，助手不代签）

状态如实标记：

- **Android physical device：NOT TESTED（待用户）**
- **iOS physical device：NOT TESTED（无真机）**
- 模拟器：PASS（分类 / 周期 chips / 每周日 / 停用 / 重启用 / 删除；Canvas 曲线除外）

请在真实微信 Android 上验证并提供以下 7 张截图（无 `_simulator` 后缀，建议放 `docs/screenshots/v0.6.1/`）：

1. `category_create_android.png`：新增分类 → 记账表单立即出现；
2. `category_archive_android.png`：归档 → 新记账不可见、历史账单保留原名；
3. `recurring_weekly_sunday_android.png`：每周日规则（Android 迁移或新建）显示周日、下次正确；
4. `recurring_catchup_android.png`：过去开始的规则打开即补齐，重开不重复，删除自动账单后不复活；
5. `recurring_disabled_android.png`：停用显示「已停用」；重启用不补停用期间；
6. `recurring_edit_android.png`：编辑只影响未来（历史不变、新值生效）；
7. `daily_value_curve_android.png`：**日价 Canvas 曲线真机可见、触摸定位正确**（v0.4.0 起欠账）。

并顺带确认：Android `.dvbackup` 自定义分类与周期规则迁移正确；Bottom Sheet 毛玻璃正文不穿透；预算 Hero / 日历正常。

> 真实账单只在用户手机本地，不提交 GitHub、不发邮件、不发文件；脱敏诊断不含姓名 / 商户 / 商品 / 账号 / 交易号 / 金额明细 / 文件名。

---

## 9. 本版明确不做

v0.6.1 只做周期与迁移正确性收口，不做新业务模块。明确不做：分类预算、分类拖拽排序、周末特殊预算、复杂主题、云同步、提醒通知、订阅消息、AI 分类、多人账本、资产 / 银行卡账户、周期账单后台准点自动生成（只承诺打开小程序时自动补齐）。

本版提交后停止，不自行进入 v0.7.0，等用户「代码更新了」之后直接审 main。

---

## 10. Git 状态

- 提交信息：`v0.6.1: Recurring and migration closure`
- 推送方式：经显式代理 `http://127.0.0.1:33210`，push 强制 HTTP/1.1
- 最终结果：HEAD == origin/main，ahead=0 / behind=0，working tree clean（SHA 见 push 后 git log / 交付说明）
