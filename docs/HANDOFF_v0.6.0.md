# HANDOFF — DailyValue Mini v0.6.0（Categories & Recurring）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**0.6.0**
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + packages 两处）、`README.md`）
- 上一版本基线：v0.5.1（HEAD `883383b`）
- 功能提交：见文末 Git 状态

---

## 1. 本版目标

v0.5.1 经用户直接审 main 后「代码验收通过、不做 0.5.2」。本版按用户七个 Gate 一次完成「分类管理 + 周期记账 + Android 自定义分类 / 周期规则迁移」，并升级 Bill V3、Backup V3、补预算空态：

- Gate A：分类系统重构（软归档 + 完整 CRUD，`bill-form` 去硬编码）；
- Gate B：周期规则数据模型 `data/recurring/`；
- Gate C：Bill V3（新增 `recurringRuleId`）+ 周期生成器 + 生命周期触发；
- Gate D：周期记账列表页 + 编辑器 Sheet；
- Gate E：分类被周期规则引用时禁止归档；
- Gate F：Android `.dvbackup` 自定义分类迁移（不再全部变「其他」）；
- Gate G：Android `.dvbackup` 周期规则迁移；
- Backup V3（新增 `recurringRules`，兼容 V1/V2）；
- 预算空态（未设预算时不显示全灰日历）。

核心设计原则不变：**项目保存上下文（Bill 与规则）、分类 / 周期 / 日价 / 预算都从 Bill + 规则动态派生，不新增预算字段到每笔 Bill**；周期账单只在打开 / 回到小程序时补齐，不承诺后台准点。

---

## 2. Gate A：分类系统重构（软归档）

重写 `data/categories.js`，分类对象最终形态：

```js
{ id, name, emoji, builtin, sort, archived }
```

默认 12 类（首写均带 `archived:false`）：

- 核心 5 类 `builtin=true`：餐饮 `c-food`、交通 `c-transport`、购物 `c-shopping`、娱乐 `c-fun`、生活 `c-life`；
- 预置 7 类 `builtin=false`：饮料 `c-drink`、话费 `c-bill`、工资 `c-salary`、医疗 `c-medical`、住房 `c-housing`、旅行 `c-travel`、其他 `c-other`。

完整 API：

- `normalizeCategory`（旧数据缺 archived → false）、`getCategories`（全部含归档）、`getActiveCategories`（过滤 archived）、`getCategory`（含归档，找不到才回退 c-other）；
- `findDuplicateName(name,excludeId)`（含归档）、`validateName`（trim 后 1–8 字，`NAME_MAX=8`）；
- `addCategory({name,emoji,id})`（invalid-name / duplicate / duplicate-id 校验，sort 取 max+1，emoji 缺省 📦）；
- `updateCategory(id,{name,emoji})`（核心 builtin 禁止改名）；
- `archiveCategory(id)`（核心 builtin 禁止；**内部延迟 require recurring 调 countRulesByCategory 做 Gate E 检查**，返回 `reason:'in-use'` + `recurringCount`；recurring 未建时容错跳过）；
- `restoreCategory(id)`。

所有写操作返回 `{ok,reason,category?}`。

### 为什么软归档而非物理删除

> 用户删除某分类后，若物理删除分类对象，历史账单会因 `categoryId` 找不到而全部变「其他」。
> 软归档后：新记账看不到该分类、历史账单仍正常解析原分类名 / 图标。

分类管理页 `pages/category-manage`（四件套）：系统分类（只读）/ 我的分类（点行=编辑、右侧归档）/ + 添加分类（虚线大按钮）/ 已归档（右侧恢复，仅有归档时出现）。编辑器用 bottom-sheet：图标（emoji maxlength=4）+ 名称（maxlength=8），canSave = 名称 trim 1–8 字；归档弹 confirm，in-use 弹「"X"正在被 N 条周期规则使用，请先修改这些周期规则的分类」。

`components/bill-form` 去硬编码（删除 EXPENSE_CATS / INCOME_CATS）：`catsFor(type,includeId)` 取 active 分类，编辑历史账单引用归档分类时用 `getCategory` 把该归档分类 concat（判断 ref.id===includeId 才加，避免 c-other 重复）；`defaultCategoryId(type)`：支出→c-food、收入→c-salary，默认已归档则取第一个 active。

设置页新增「记账」分组（分类管理、周期记账，无 emoji）。

---

## 3. Gate B：周期规则数据模型

- `data/paths.js` 加 `FILE.recurring = ROOT + '/recurring.json'`。
- 新建 `data/recurring/` 四件套：

### core.js（纯日期 / 周期逻辑，移植 Android generator.ts）

- 常量：`MAX_CATCHUP_PER_RULE=365`、`RECURRING_BILL_PREFIX='recur'`、`FREQUENCIES=[daily,weekly,monthly,yearly]`、`HHMM_RE`；
- 日期函数：`parseDate / toDateStr / dayNumber`（UTC Date.UTC，仅索引用）、`localDateKey`（本地）、`addCalendarDays`（本地日历，DST 安全）、`daysInMonth / isLeapYear / clampDay`；
- weekly：`startDateWeekday / resolveWeeklyDay`（非法 day 回退 startDate weekday）；
- `sanitizeRecurringRule`：interval 钳 1–999、enabled 非 boolean → false、weekly day 0–6、monthly/yearly day 1–31、yearly month 1–12、time 非法 → 00:00；
- `occurrenceDate`（daily/weekly/monthly/yearly 本地日历；monthly 用 totalMonths 推导 y/m；weekly 用 delta=(wd-startDow+7)%7）；
- `occurrenceTimestamp / recurringBillId`（`recur-{ruleId}-{date}-{time}`）、`startIndexFor`（日历量推导，避免线性扫）、`computeNextOccurrence`。

### store.js（规则 CRUD + 持久化，不依赖 ledger 避免循环）

- `STORE_VERSION=1`、`EMPTY={version:1,rules:[]}`；
- `readStore/writeStore/normalizeRule`（补全字段并调 core.sanitize，保留游标 / 时间戳）；
- `getRules/getRule/addRule`（**新建规则默认 enabled=true，显式 false 才停用**）、`updateRule/removeRule`、`countRulesByCategory`（含停用规则，保守计数）、`replaceAllRules`（迁移用）。

### 周期规则最终字段（整数分）

```js
{ id, enabled, type:'expense'|'income', amountCents, categoryId, note,
  frequency:'daily'|'weekly'|'monthly'|'yearly', interval, day, month?,
  startDate:'yyyy-MM-dd', time:'HH:mm',
  scheduleEffectiveAt?, lastGeneratedDate?, nextOccurrence?, createdAt, updatedAt? }
```

持久化 `recurring.json` = `{version:1,rules:[]}`。

---

## 4. Gate C：Bill V3 + 周期生成器 + 生命周期

### Bill V3（相对 V2 仅新增可选 `recurringRuleId`）

- `ledger.js`：`SCHEMA_VERSION 2→3`，createBill 末尾透传 `recurringRuleId`（有才挂）；
- `manifest.js`：`SCHEMA_VERSION 2→3`，migrations 加 `billV3:{status:'pending'}`；
- 新建 `data/migration-schema-v3.js`：`upgradeBillV3`（幂等，清理空 recurringRuleId）、`runSchemaMigration`（快照 + 不可变字段留档 id/type/amountCents/occurredAt/title/ledgerImpact/dailyValue，逐月份升级、显式设 `mf.version=3`、校验版本 / 不可变字段 / 条数，成功才 setSchemaVersion(3)；失败 restoreMonths 回滚 + 标 failed）。

**关键踩坑（逐级迁移）**：`writeMonthFile` 原硬编码 `version: SCHEMA_VERSION`，导致 V2 迁移输出分片直接变成 version=3。修复：`writeMonthFile` 改为 `const version = data.version || SCHEMA_VERSION`，V2 迁移显式设 `mf.version=2`、V3 迁移显式设 3，实现 V1→V2→V3 逐级迁移。

`data/index.js`：init 在 V2 迁移后加 V3 迁移；导出 migrationSchemaV3 与 recurring。

### 生成器（generator.js，移植 Android）

- `generateDueBillsForRule`：disabled noop；base=lastGeneratedDate 否则 startDate；循环 365：
  - occDate < base 跳过；
  - **occDate <= lastGeneratedDate 一律视为已处理（删除账单不复活）**；
  - occMs > now → nextOccurrence，break；
  - **occMs <= scheduleEffectiveAt 不回填但推进游标（编辑只影响未来）**；
  - 确定性 id 查库无则 ledger.addBill（source='recurring'、recurringRuleId、ledgerImpact='normal'、title=''、note）；
  - 更新游标，computeNextOccurrence 兜底；
- `generateDueBills`：先 sanitize 全部并持久化被纠正字段，只对 enabled 逐规则，诊断 console.warn，返回 `{totalGenerated,diagnosedRules,diagnostics}`；
- `runRecurringGenerator`：模块级 `runningPromise` 并发锁 + `rerunRequested` do/while drain。

### 生命周期（不维护第二套 Timer）

- `app.js`：`runRecurringCatchup()`（store 已 init 才调 runRecurringGenerator，异常容错）；onLaunch 在 init 后调用（冷启动补账），onShow 改为 `runRecurringCatchup().then(()=>refreshTimeSensitiveViews())` + scheduleMidnight（回前台补账）。生成器 executor 内同步执行，返回时账单已落账；main.js onShow 已 `if(this._ready) refreshPanels()`。

---

## 5. Gate D：周期记账列表页 + 编辑器

新建 `pages/recurring`（四件套）：

- 列表卡片：频率描述 `frequencyText`、金额（收入用绿色）、emoji + 分类 + note、下次 nextOccurrence、`switch`（`catch:change="onToggle"` + `catchtap="noop"` 阻止冒泡到卡片 onEdit）；空态提示；「+ 新建周期」；
- 编辑器 bottom-sheet：支出 / 收入 segmented、金额（digit）、频率 4 选、间隔（每 N）、周期日期（weekly 7 星期 chips / monthly 31 日 chips / yearly 12 月 + 31 日 chips，横向 scroll-view）、开始日期 picker（**允许未来**）、时间 picker、分类 chips（横向）、备注；
- 保存：新增 startDate 在过去且到期数 >0 时，`countDue` 计算并 wx.showModal「将补记 N 笔」确认后才 createRule + runRecurringGenerator；编辑时 editRule 带 `scheduleEffectiveAt=Date.now()` 只影响未来；onDelete 删规则（已生成 Bill 保留）。

---

## 6. Gate E：分类被周期引用时禁止归档

- `archiveCategory` 内部延迟 require `recurring/index` 调 `countRulesByCategory`；若该分类（含停用规则，保守计数）被引用，返回 `{ok:false,reason:'in-use',recurringCount}`；
- category-manage 收到 in-use 弹「"X"正在被 N 条周期规则使用，请先修改这些周期规则的分类」；
- 软归档保证历史账单不受影响（getCategory 含归档，可正常解析）。

---

## 7. Gate F/G：Android 自定义分类 + 周期规则迁移

### adapter（`packages/importer/adapters/dailyvalue.js`）

- `STANDARD_IDS`（12 系统 id）、`BACKUP_FREQUENCIES`；`safeIdPart`；`miniCategoryId` = `dvcat-{id}`、`miniRuleId` = `dvrule-{id}`；
- `mapBackupCategories`：系统 id 原样映射；自定义分类产出确定性 Mini id（dvcat-），收集到 `toCreate`（name 截断 8 字、emoji 缺省 📦），返回 `{idMap,toCreate}`；
- `resolveCategoryRef`：经 idMap，找不到系统 id 用自身，否则 c-other；
- `mapRecurringRules`：金额 amount(元) → amountCents（yuanToCents），规则 id 用 dvrule-，保留 month / scheduleEffectiveAt / lastGeneratedDate / nextOccurrence / createdAt / updatedAt，amountCents>0 且 startDate 有才收；
- `parseBackup` 返回 **`{bills,categories:toCreate,recurringRules}`**；bills 分类经 resolveCategoryRef；source='recurring' 账单 recurringRuleId 映射为 dvrule-；校验 format 必须为 daily-value-backup。CSV 路径保持不变。

### detector（`core/detector.js`）

- doParse 加 `extraCategories / extraRecurringRules` 与内部 `consumeBackup(parsed)`（解包 bills/categories/recurringRules）；3 处 parseBackup 改为 consumeBackup；通用 session 加 extraCategories / extraRecurringRules（非 dailyvalue 来源为空数组）。

### commit（`core/commit.js`）

- `ensureExtraCategories`：同 id 已存在跳过、findDuplicateName 同名复用、否则 addCategory 用确定性 id；把 id 映射 remap 应用到内存 bills 的 categoryId；
- `ensureExtraRules`：categoryId 应用 remap，同 id 已存在跳过，否则 recurringStore.addRule；
- `commitImport` 在快照后、toMerge 前调这两个函数；分类 / 规则写入不影响账单 count。
- `toLedgerBill` 补透传 `recurringRuleId`（Bill V3）。

---

## 8. Backup V3 + 预算空态

### Backup V3（`data/backup.js`）

- SCHEMA_VERSION 2→3，SUPPORTED=[1,2,3]，require recurringStore；
- buildBackup data 加 `recurringRules: recurringStore.getRules()`；
- restoreBackup 在分类 / 设置后 `recurringStore.replaceAllRules(Array.isArray(data.recurringRules)?data.recurringRules:[])`（V1/V2 无此字段→空）；rollback 同样写回。
- 预算规则仍存于 `settings.json`，随 buildBackup 本就保存，无需为此升级。

### 预算空态

- `statistics-panel`：`budgetEmpty` 标志；loadMonth 中 `hasBudgetRules = getBudgetState().rules.length>0`，无规则时 budgetCalendar=null、pace=[]；新增 `onBudgetSettings`；
- wxml 日历卡片前加空态卡片 `bcal-empty`（「预算分析 / 还没有设置预算 / 设置每日预算后，可以查看每天的盈余与超支 / 设置预算」），日历卡片保持 wx:if；wxss 加 `.bcal-empty` 样式。

---

## 9. 测试结果

`npm test`（`tests/run-all.js`，独立子进程，跨平台，10 套件）：

| 套件 | 数量 | 结果 |
| --- | --- | --- |
| device.test.js | 6 | PASS |
| data.test.js | **100**（v0.5.1 为 92，新增 V1/V2 恢复兼容 8） | PASS |
| accounting.test.js | 45 | PASS |
| statistics.test.js | 65 | PASS |
| daily-value.test.js | 97 | PASS |
| budget.test.js | 133 | PASS |
| **categories.test.js** | **45**（新增） | **PASS** |
| **recurring.test.js** | **62**（新增） | **PASS** |
| settings.test.js | 15 | PASS |
| importer.test.js | **96**（v0.5.1 为 74，Gate F/G 新增 22） | PASS |
| **合计** | **664** | **全绿，退出码 0（10/10）** |

未删除任何现有测试（v0.5.1 的 527 项全保留，新增 137）。

### categories.test.js（45）覆盖

默认 12 分类 / 核心内置不可归档改名、预置非内置、自定义新增 / 重名 / 空名 / 超长 / 确定性 id / 编辑 / 缺省 emoji、软归档（getCategories 含归档、getActiveCategories 不含、历史账单 getCategory 解析归档名 + 图标）、恢复、被周期引用禁止归档（in-use + recurringCount=1）。

### recurring.test.js（62）覆盖

纯日期函数（daily/weekly/monthly/每 2 周/每 3 月/31 号月末钳制/yearly 2-29 平年→28 闰年→29/daysInMonth/isLeapYear/确定性 id）、生成器 catch-up 16 与幂等（重复运行 / 连续 onShow 不新增、游标）、删除不复活、编辑只影响未来（历史 1000 / 新 2000）、删除规则保留历史、停用不生成 / 重启用不补停用期间、收入周期进月度收入 / 周期支出进月度支出、catch-up 365 上限（diagnosedRules=1）、Backup V3 往返（同 id + 金额 / 频率 / 分类）。

### importer Gate F/G（22）覆盖

Android 自定义分类导入（dvcat-cat-coffee / dvcat-cat-pet，名称 + emoji）、账单分类跟随映射（不再变 c-other）、周期规则迁移（金额元→分、频率 / 分类 / 游标保留、引用自定义分类、停用规则 false）、历史周期账单 recurringRuleId 映射（dvrule-）、重复导入分类 / 规则 / 账单均不重复。

---

## 10. 模拟器验证（已执行）

环境：微信开发者工具 Stable 2.02.2608080，miniprogram-automator 0.12.1，Skyline 模拟器（宽 390）。

验证：分类管理页（系统 / 我的 / 添加 / 归档 / 恢复）、周期记账列表（频率 / 金额 / 下次 / 开关）与编辑器（频率 / 间隔 / 日期 chips / 分类 / 时间）、预算空态（新用户无预算时显示空态而非全灰日历）、记账表单分类来自数据层。

### 已知模拟器限制 / 注意

- **Canvas 日价曲线在 Skyline 模拟器仍不渲染**（v0.4.0 遗留，工具限制），只能真机验收。
- automator 0.12.1：`mp.reLaunch` 损坏实例（禁用，改 navigateTo/navigateBack）；跨独立 connect 组件 data 重置，多步操作须同一连接，连接间 sleep 8s；同连接写过多易超时，拆脚本规避。

截图目录 `docs/screenshots/v0.6.0/`（均为开发者工具模拟器 Skyline，文件名统一带 `_simulator`，未冒充真机）：

| 文件 | 内容 |
| --- | --- |
| `main_accounting_simulator.png` | 记账 Tab：本月支出 ¥722.60，时间线（10/16 餐饮、10/10 餐饮） |
| `category_manage_simulator.png` | 分类管理：系统 5 类（只读）+ 我的 7 类（归档按钮） |
| `recurring_list_simulator.png` | 周期记账列表空态（rules=0） |
| `recurring_editor_simulator.png` | 新建周期 Sheet：类型 / 金额 / 频率 / 间隔 / 开始日期 / 时间 / 分类 |
| `budget_empty_simulator.png` | 预算空态：无预算规则时显示引导，不再是全灰日历 |
| `budget_calendar_simulator.png` | 预算日历：盈余 / 超支 / 无预算 / 今天，图例与节奏摘要 |

### 模拟器回归额外修复（node 测试盲区）

node 测试直连各模块，未经过 `data/index.js` 统一入口与 WXML 编译，故以下两处运行时问题在模拟器阶段才暴露并修复：

1. **`pages/recurring/recurring.wxml` 不完整三元表达式**（8 处，原行 57/58/70/87/95/103/107/129）：class 内 `{{cond?'active'}}` 缺少 else 分支，WXML 编译报 `incomplete condition expression` 致模拟器黑屏；已全部补全为 `?'active':''`。
2. **`data/index.js` 顶层未暴露 `getActiveCategories`**：`bill-form.js`、`recurring.js` 均通过 `store.getActiveCategories()` 调用，但统一入口只暴露了 `getCategories/getCategory`，打开"记一笔 / 新建周期"时报 `store.getActiveCategories is not a function`；已在顶层补 `getActiveCategories: categories.getActiveCategories`。

---

## 11. 真机 Gate（待用户执行，助手不代签）

状态如实标记：

- **Android physical device：NOT TESTED（待用户）**
- **iOS physical device：NOT TESTED（无真机）**
- 模拟器：PASS（分类 / 周期 / 空态 / 布局；Canvas 曲线除外）

建议真机验收：

1. **周期生成**：新建一条过去开始的规则（如本月 1 日起每天 ¥10），确认提示补记笔数、账单一次性补齐；杀掉重开不重复；手工删除其中一条后重开不复活；
2. **停用 / 重启用**：停用后不生成；重新启用后只从重启时刻起生成、不补停用期间；
3. **编辑只影响未来**：改金额 / 周期后，历史账单金额不变、新账单用新值；
4. **分类管理**：新增分类后记账表单立即出现；归档后新记账不可见、历史账单仍显示原名；被周期引用分类归档被阻止；
5. **Android 迁移**：导入含自定义分类与周期规则的 `.dvbackup`，自定义分类保留、账单不再变「其他」、规则与下次到期正确；
6. 延续项：日价 Canvas 曲线真机可见、触摸左 / 中 / 右定位正确（v0.4.0 遗留）；预算 Hero / 日历、Bottom Sheet 毛玻璃与正文不穿透；改预算立即刷新、历史规则不被新规则改变。

> 真机截图（无 `_simulator` 版本）待用户提供，未用模拟器冒充。
> 真实账单只在用户手机本地，不提交 GitHub、不发邮件、不发文件；脱敏诊断不含姓名 / 商户 / 商品 / 账号 / 交易号 / 金额明细 / 文件名。

---

## 12. 本版明确不做

v0.6.0 只做分类管理、周期记账与 Android 迁移。明确不做：分类预算、分类拖拽排序、周末特殊预算、复杂主题、云同步、提醒通知、订阅消息、AI 分类、多人账本、资产 / 银行卡账户、周期账单后台准点自动生成（小程序做不到可靠后台唤醒，只承诺打开小程序时自动补齐）。**预算 / 日价只陈述数学事实，不做"回本 / 物有所值 / 消费理性"评价。**

本版提交后停止，不自行进入 v0.6.1，等用户「代码更新了」之后直接审 main。

---

## 13. Git 状态

- 提交信息：`v0.6.0: Categories and recurring`
- 推送方式：经显式代理 `http://127.0.0.1:33210`，push 强制 HTTP/1.1
- 最终结果：HEAD == origin/main，ahead=0 / behind=0，working tree clean（SHA 见 push 后 git log / 交付说明）
