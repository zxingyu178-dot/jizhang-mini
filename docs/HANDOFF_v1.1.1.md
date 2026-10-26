# HANDOFF — 随时随地大小记 v1.1.1（Explorer Correctness & Performance Closure）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**1.1.1**
- 品牌名：**随时随地大小记**
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + packages 两处）、`README.md`）
- 上一版本基线：v1.1.0（HEAD `038963b`）
- 本版定位：**小而必要的收口版，不新增任何业务功能。修复 Bill Explorer 三个真实的日期边界 / 分组 / 文案问题，并消除真机输入卡顿隐患；不升级任何核心数据合同。**
- 后续路线：本版完成后再进入 v1.2.0 Category Visual System，不直接跳到 v1.2 之外的版本。

---

## 1. 本版背景

用户审 v1.1.0（HEAD 038963b）确认主体成功、不推翻：统计 → 账单搜索 → 账单编辑三区域已连通，Gate 0 的 `writeJSONAtomic()` 实现正确并冻结。但继续往恢复链路与设置数据之外的 Bill Explorer 查，发现 3 个应在 1.0 前修掉的真实问题，以及测试 / 交付文档漂移。本版只做收口，不做新功能。

---

## 2. 修复一：跨年同一天被搜索合并（P0，`data/search/group.js`）

### 问题

- 旧 `dayLabel(ts)` 只生成「N月D日」（如 `10月1日`），`groupSearchResults` 直接用该 label 字符串做 Map key，WXML 也用 `wx:key="label"`。
- 于是 2025-10-01 与 2026-10-01 得到完全相同的 key，「全部时间」搜索时两年账单被塞进同一日期组，UI Key 也冲突。

### 修复

- 新增 `data/date.js` 的 `dateKeyOf(ts)` → `'YYYY-MM-DD'` 稳定 key；分组结构改为 `{ dateKey, label, records: [...] }`。
- WXML 改为 `wx:key="dateKey"`。
- 显示 label 区分年份（`dayLabelOf(ts, refYear)`）：基准年（默认当前年）同年省略年份（`10月1日`），历史年显示年份（`2025年10月1日`），避免跨年搜索出现两个肉眼完全相同的「10月1日」。
- `groupSearchResults(bills, resolver, refYear?)` 第三参数可选，默认当前年，便于测试固定。

---

## 3. 修复二：结束边界少最后 999ms（P0，`data/date.js`）

### 问题

- 旧 `monthRange` / `yearRange` / 自定义日期结束时间用 `new Date(...,23,59,59)` = 23:59:59.**000**，而非 23:59:59.**999**。
- 时间戳为 23:59:59.500 的账单（导入账单可能带秒 / 毫秒）会被月搜索、年搜索、自定义日期搜索、自定义日期统计错误排除。

### 修复

- 统一共享 `startOfLocalDay` / `endOfLocalDay`：
  - `startOfLocalDay` = 当日 00:00:00.000；
  - `endOfLocalDay` = **下一天 00:00:00.000 − 1ms**（不手写 23:59:59.999），月末、闰年由 Date 自动进位。
- `monthRange` = 当月首日 start ~ 当月末日 end；`yearRange` = 1/1 start ~ 12/31 end。
- Bill Explorer、自定义日期搜索（`pages/search`）、自定义日期统计（`components/statistics-panel`）、统计钻取全部复用同一套函数。
- `data/search/range.js` 改为从 `data/date.js` 复用并保持对外导出，避免改动 require 路径。

---

## 4. 修复三：时间 Chip 跨年误判（P1，`data/date.js` + `pages/search`）

### 问题

- 旧 `refreshLabels()` 判「全年」只看开始=1/1、结束=12/31，未确认开始年份 == 结束年份，2025-01-01~2026-12-31 会被错误显示成「2025年」。
- 「整月」只看开始日=1、结束日=月末，未确认同年同月，2025-01-01~2026-01-31 会被标成「2025年1月」。账单过滤本身正确，错的是 Chip 显示语义。

### 修复

- 新增纯函数 `describeRange(dateFrom, dateTo)` 返回 `{ kind, label }`：
  - 全年：`sameYear` + 1/1 + 12/31；
  - 整月：`sameYear && sameMonth` + 首日 + 当月最后一天；
  - 否则一律 `custom`（「自定义」），不冒充单年 / 单月。
- `pages/search` 的 `refreshLabels` 直接复用该函数，口径与单测一致。

---

## 5. 性能：页面会话快照 + 输入 debounce（`pages/search`）

### 问题

- 旧实现每次输入一个字符都触发 `onInput → applyFilters → store.searchBills() → ledger.rangeBills()` 重新读取全部月份 JSON + categories.json，输入「星巴克」触发 3 次完整账本加载，5k/10k 真机可能掉帧。

### 修复（按用户要求，不上全局索引 / 倒排 / SQLite / 永久缓存）

- **页面会话快照**：进入搜索页 `refreshSnapshot()` 一次读取 `store.rangeBills()` 与 `store.getCategoryResolver()`，后续输入只对内存数组跑 `search.searchBills()`。
- 账单保存 / 删除后 `onBillSaved` 重新 `refreshSnapshot()` 再筛选；分类在搜索页不会修改，解析器一起刷新。
- **关键词 debounce 120ms**（100~150ms 区间）；Chip 点击、清除、时间 / 分类选择仍立即刷新（先清 Timer）。
- `onUnload` 清除 Timer，避免页面卸载后 setData。

---

## 6. Perf Gate 改用正式 Search Core（`tests/perf/large-ledger.perf.js`）

- 旧脚本虽有全量搜索「咖啡」，但跑的是旧式 `rangeBills().filter(...)`，未调用正式上线的 `searchBills`，也未模拟连续键入，无法证明真机输入体验。
- 改造：
  - 第 6 项改为正式 `s.searchBills({ keyword:'咖啡', type:'expense', categoryId:'c-food', dateFrom, dateTo })`，并与手写过滤核对口径一致；
  - 新增连续键入「咖 / 咖啡 / 咖啡店」：验证每次返回数组、不崩、子串单调（`r1 ≥ r2 ≥ r3`）、无「咖啡店」时正确返回 0。
- 不设苛刻毫秒指标，重点不崩、数量正确、不超线性。旧的宽松上限检查保留。

---

## 7. 文档与发布检查收口

- 新增本 HANDOFF；`release-check.js` 第 5.5 节改为**按当前 APP_VERSION 动态检查** `docs/HANDOFF_v<APP_VERSION>.md` 是否存在，不再硬编码只检查 v1.0.0；发布流程 / 隐私文档（RELEASE_CHECKLIST、DEVICE_GATE、PRIVACY_SETUP）继续检查。
- `README.md` 的搜索页描述更新为真实能力（关键词 / 金额 / 收支 / 时间 / 分类 / 统计钻取 / 最近账单 / 编辑保持筛选）。
- `libVersion` 仍为 `latest`：用户未上传体验版验证前继续保持 latest、不瞎填；只有真实体验版验证后才固定并消除 WARN。

---

## 8. 数据合同冻结声明

v1.1.1 **未升级 / 未改动**任何核心数据合同，全部继续冻结：

- **Bill V3**：分片 `bills/YYYY-MM.json = {ym,version:3,bills:[...]}`，整数分金额。
- **Recurring Store V1**：`recurring.json = {version:1,rules:[...]}`。
- **Budget V1**：`settings.budget = {version:1,weekStartsOn,rules:[...]}`。
- **Backup V3**：`daily-value-mini-backup` SCHEMA=3，SUPPORTED=[1,2,3]。
- 本版不引入 Backup V4，不新增任何业务字段。

---

## 9. 测试结果

### 9.1 纯逻辑单测：`npm test`

**1297 项全绿、24/24 套件、退出码 0**（v1.1.0 1278 → +19，全部来自 `tests/search.test.js` 61 → 80）。

新增 / 更新用例：

- 跨年同日分组：两个独立分组、dateKey 不同、当前年 / 历史年 label 正确、记录归属正确；
- 999ms 边界：23:59:59.500 月 / 年范围均包含、恰好 23:59:59.999 含端点、超出 1ms 不包含；
- `describeRange`：全年 / 整月正确判定，跨年「全年」、跨月「整月」陷阱均回落「自定义」，无范围返回 none；
- 同时把旧的 dateTo 断言从有缺陷的 23:59:59.000 更新为正确的 23:59:59.999。

### 9.2 GUI 端到端：`npm run e2e`

**T01–T18 全绿 18/18，退出码 0**，截图均带 `_simulator` 后缀。

### 9.3 性能：`npm run perf`

1k/5k/10k 全绿、近线性（10k/1k 全量加载比值 ≤40x）；正式搜索与连续键入均通过，10k 连续键入与正式搜索耗时在宽松上限内。

### 9.4 发布检查：`npm run release:check`

**FAIL：0，WARN：1**（唯一 WARN：`libVersion` 仍为 `latest`，待最终体验版验证后固定——预期提醒，非代码缺陷）。

---

## 10. 发布前 Gate（待用户执行，助手不代签）

- **Agent simulator（automator + Skyline）：PASS** —— 单测 1297、E2E 18、性能、release:check 逻辑项均通过；**Canvas 真机表现、升级 / 恢复演练、原生窗口真机表现除外**。
- **User physical device（Android）：NOT TESTED（待用户）**

仍需在真实微信 Android 上完成（详见 `docs/DEVICE_GATE_v1.0.0.md`）：真机主题矩阵、日价 Canvas 曲线（v0.4.0 起欠账）、升级测试、完整 Backup 灾难演练、隐私后台配置（MessageFile / Clipboard）、体验版验证后固定基础库。

---

## 11. Git 状态

- v1.1.1 改动（基线 `038963b` 之后）：
  - 新增 `data/date.js`；`data/search/group.js`、`data/search/range.js`、`data/search/index.js`；
  - `pages/search/search.js`、`search.wxml`；`components/statistics-panel/statistics-panel.js`；
  - `tests/search.test.js`、`tests/perf/large-ledger.perf.js`、`scripts/release-check.js`、`README.md`；
  - 版本与文档：`utils/version.js`、`package.json`、`package-lock.json`、`CHANGELOG.md`、本 HANDOFF。
- 中文消息用 `git commit -F <file>`；推送走显式代理 `http://127.0.0.1:33210`。
- 最终结果：HEAD == origin/main，ahead=0 / behind=0（核对 `git rev-list --left-right --count origin/main...HEAD`）。
