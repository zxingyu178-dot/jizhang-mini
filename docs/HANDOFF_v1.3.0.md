# HANDOFF — 随时随地大小记 v1.3.0（Statistics Dashboard & Scale Lab）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**1.3.0**
- 品牌名：**随时随地大小记**
- AppID：`wxcdcf83d9191065d9`
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + `packages[""]` 两处）、`README.md`）
- 上一版本基线：v1.2.1（HEAD `82d5c30`）
- 本版定位：**统计仪表盘重构 + 真实规模压测。一半提升统计可读性 / 可定制性，一半建立真实风格大账本压测长期使用能力；不升级数据合同、不新增业务功能。**
- 后续路线：本版完成后停止，等用户审 main；真机 Gate 由用户本人执行，助手不代签。

---

## 1. 背景与目标

v1.2 已建立完整的分类 SVG 图标体系（49 个本地图标、Emoji 兼容、旧数据无损迁移），分类占比的视觉基础已经齐备。本版把原计划的 Appearance V2（主题强调色）推后，优先重做统计体验：让统计页从「一堆等重量玻璃卡堆叠、用户自己找重点」变为「关键结论 → 最大单笔 → 分类占比 → 趋势」的清晰报告层级；同时把「大量真实风格数据注入」正式做成工程能力，验证 3～10 年长期使用是否仍然可用。

数据合同在本版**全部冻结**：Bill V3、Backup V3、Recurring Store V1、Budget V1 均不升级。

---

## 2. Gate 0：分类视觉漏点收口 + 文档版本同步

### 2.1 两处字段透传（`components/statistics-panel/statistics-panel.js`）

v1.2 主页面与统计排行已使用 SVG，但两处组件层手动裁剪把 `iconType` / `iconValue` 丢掉，导致回退 Emoji：

1. **年度回顾「记录最多的分类」**：`loadYear` 组装 `yrTopCat` 时只保留 `categoryId / name / emoji / count`。现补回 `iconType` / `iconValue`，WXML 的 `<category-icon>` 不再回退 Emoji。
2. **预算日详情分类**：`onTapDay` 的 `categories.map` 同样补透传 `iconType` / `iconValue` / `emoji`。

未修改底层分类存储结构，未在分类数据中增加颜色字段。回归测试落在 `tests/budget.test.js`（buildDayDetail builtin/dining）与 `tests/statistics.test.js`。

### 2.2 文档版本同步（`README.md`、`scripts/release-check.js`）

- README 版本经两次变更（先 1.2.1，收口改 1.3.0）；「系统分类只读」旧描述改为：**核心系统分类不可改名、不可归档，但允许改图标。**
- 增强 `scripts/release-check.js` 第 1 节版本一致性，新增 README 检查（正则 `/当前版本：\s*(\d+\.\d+\.\d+)/`），找不到声明或与 `utils/version.js` 不一致均 FAIL。

---

## 3. Gate 1：统计数据读取范围优化（本阶段最重要底层任务）

### 3.1 自定义日期按月读取

`buildCustomRange()` 原先调用无参 `store.rangeBills()`（读取整个历史账本）。改为根据起止日期对应月份，只读取覆盖该范围的分片：

```js
const ymStart = crStart.slice(0, 7);
const ymEnd = crEnd.slice(0, 7);
store.rangeBills(ymStart, ymEnd);
```

- 例：2025-09-17 至 2026-02-08 只读 2025-09 至 2026-02；当前月 1 日至今天只读当前月。
- 开始日期晚于结束日期时提前 return，不读取任何账单。
- 自定义日期模块关闭时，不进入该数据读取路径。

### 3.2 预算读取范围优化（`data/index.js`）

新增辅助 `pad2`、`rangeBillsForDays(startStr, endStr)`、`prevYM(ym)`（处理跨年减一月），并引入 `data/budget/period`。五个预算包装方法全部按周期或所选月份限定：

| 方法 | 读取范围 |
| --- | --- |
| `buildBudgetCalendar` | 只读取所选月份 |
| `buildBudgetDayDetail` | 只读取所选日期所属月份 |
| `buildBudgetPaceSummary` | 当前月只读计算周期涉及月份，跨月周覆盖相邻两月 |
| `buildBudgetMonthPace` | 历史月只读所选月份 + 计算上月结果所需的前一月 |
| `computeBudgetByKind` | 按周期起止转月份范围限定 |

预算公式、规则历史、生效日期与未来日期语义保持不变；优先复用已加载的月度账单快照。

### 3.3 读取范围测试

新建 `tests/read-range.test.js`（17 项），mock FS 在 `readFileSync` 用正则 `/\/bills\/(\d{4}-\d{2})\.json$/` 按分片记录读取，覆盖跨月 / 跨年、预算周、模块关闭不读取等场景。全量单测口径完全不变，快速 perf 无回归。

---

## 4. Gate 2：统计摘要与分类占比核心

### 4.1 月度统计摘要（`data/statistics/month.js`）

新增纯函数，全部从当月普通账单现算、不新增存储：

- **`findTopExpenseDay`**：按每天普通支出**合计**（非最大单笔）确定最高消费日，稳定排序，无支出返回 `null`；不统计 daily-value-only。
- **`computeDailyAverageExpense`**：当前月分母为「截至今天（含）已过日历天数」，历史完整月分母为该月实际日历天数（**不除以有消费的天数**），无除零。
- **`findLargestExpense`**：金额最大的 normal 支出，同额取 occurredAt 最早，返回原始账单 ID；排除收入与 daily-value-only。
- 所有计算保持整数分，格式化只发生在展示层。

### 4.2 分类占比纯函数

新增 **`computeCategoryShare()`**，复用现有 `computeCategoryRanking()` 聚合，不另建分类统计。输出含分类 ID / 名称、金额分值、笔数、占比、图标字段、展示颜色、聚合标记及被聚合分类 ID。

- 弧长按**真实整数分金额**（`cents / total`）计算，不使用四舍五入后的百分比。
- 百分比显示一位小数（`percentText`，如 `40.9`）。
- ≤8 类全部显示；>8 类显示 Top 7 + 「其他」，圆环最多 8 段。
- 「其他」是纯展示层聚合项，内部 id 为 `__aggregate_other__`，不与真实 `c-other` 冲突，不写入 `categories.json`。
- 颜色按 `categoryId` 稳定映射到固定 8 色调色板（`DONUT_PALETTE`），同一分类跨月尽量保持同色；颜色不写入 Category 持久化字段。

### 4.3 分类环形图组件（`components/category-donut/`）

采用本地动态 SVG → Base64 data-URI → `<image>` 的已验证方案，**不引入 ECharts、不使用 Canvas**：

- 圆环中心展示总支出（WXML 覆盖在 SVG 中央），下方分类列表为普通 WXML。
- 空账本、零支出、单一分类、多分类均正确；深浅主题均可辨；不依赖网络。
- 点击真实分类 → 复用 Bill Explorer 钻取（保留月份 / 年份及支出筛选）；点击聚合「其他」→ 展开被聚合分类列表，不引入多分类 OR 搜索。
- 年度环形图使用完整年度分类列表，而非仅 Top 5。
- 纯几何计算在 `data/statistics/donut.js`（RADIUS 40、STROKE 12、viewBox 100×100），Base64 工具抽至 `utils/b64.js`。

---

## 5. Gate 3：统计模块定制 + Lazy Compute

### 5.1 配置合同（`data/statistics/config.js`、`data/settings.js`）

新增配置写入 `settings.statistics = { version: 1, modules: [...] }`。集中管理 `VALID_MODULES`、`DEFAULT_MODULES`、`normalizeConfig`、`isEnabled`、`withModules`。

- 月度 6 模块：`category-share`、`daily-expense-trend`、`cumulative-trend`、`budget-analysis`、`income-expense-compare`、`custom-range`。
- 年度 2 模块：`year-monthly-trend`、`year-review`。
- 默认开启 6 项；`cumulative-trend` 与 `custom-range` 默认关闭。
- **Hero 与月度最大单笔始终保留**；年度分类占比为固定模块始终计算。
- 规范化口径：旧设置无字段用默认；未知 ID 丢弃、重复去重、非字符串丢弃；合法空数组表示关闭全部可选模块（不擅自重置）；配置损坏不影响账单 / 备份恢复。
- `settings.js` 新增统一 `canonicalize(raw)`，ensure / get / update 全部走它；通过现有 `updateSettings()` 原子写入，传完整规范化 statistics 对象，不破坏其他设置。Backup V3 本就保存整个 settings，无需升级。

### 5.2 模块管理 UI

统计页「管理」入口打开页面级 Bottom Sheet（位于 scroll-view 外，避免 Swiper 内 fixed 定位异常），含模块名称、启用开关、恢复默认；关闭弹层立即生效。本版**不做拖拽排序**。

### 5.3 真正的 Lazy Compute

不是仅隐藏 WXML。模块关闭时对应函数不调用且清空展示数据：趋势 / 占比 / 预算（日历 + 节奏）/ 收支对比 / 自定义范围 / 年度月趋势 / 年度回顾均按需执行，避免显示上次旧结果。自定义日期首次开启：当前月默认 1 日～今天、历史月默认 1 日～月末，手动选择后保留、切月不覆盖。

测试：`tests/stat-config.test.js`（25 项）、`tests/lazy-compute.test.js`（36 项，证明全关函数 0 调用、全开调用、字段清空、Hero / 最大单笔始终计算）。

---

## 6. Gate 4：统计界面重排 + Gate G / H

### 6.1 界面重排（`statistics-panel.wxml/wxss`）

- 月度默认顺序：月份导航 → Hero（总支出 / 收入 / 结余 + 记录数 / 最高消费日 / 日均）→ 最大单笔 → 分类占比 → 每日花费趋势 → 预算分析 → 收支对比；自定义日期默认隐藏。
- 预算大日历不再强占第一屏；根结构以 `view.sta-wrap` 包 scroll-view。
- 继续沿用紫黑毛玻璃设计，深浅主题适配，关键数字突出但不再每张卡片同等强度。保留所有分类详情、编辑账单与搜索钻取能力，不改写记账 / 日价 / 导入等无关模块。
- 引入 `data.scrollInto` 与 `scroll-into-view` 绑定作为通用定位能力（automator 在 Skyline 下合成 touch / scrollHeight 不可靠，scroll-into-view 实测可真实滚动）。

### 6.2 Gate G：累计消费趋势（默认关闭）

新增 `components/cumulative-trend/` 与 `data/statistics/cumulative.js`。`computeCumulativeTrend` 逐日滚动累计 normal 支出（收入与 daily-value-only 不参与），结果单调不减、末日累计 = 总支出；动态 SVG 面积 + 折线（主色 `#7c86ff`），回答「钱花得有多快」。

### 6.3 Gate H：年度统一

年度「分类 Top5」横向进度条整体替换为同款「全年分类占比」，复用 category-donut 与 `computeCategoryShare`（该函数只依赖 bills + resolver，可直接用于全年）；真实分类行钻取 Bill Explorer、聚合项展开完整列表；年度回顾与 12 个月趋势保留。

### 6.4 餐饮图标重设计（视觉质量收口）

`dining` 图标 id 不变，原 Lucide 刀叉在小尺寸深色背景下辨识度低（叉部像 ψ、刀像 q），重设计为「碗 + 蒸汽」（碗口横线 + 下半圆碗身 + 两道蒸汽）。所有引用自动更新，数据合同不变，c-food 兜底 emoji 🍚 保留。

---

## 7. Gate 5：Realistic Scale Lab

### 7.1 Realistic Ledger Generator（`scripts/generate-realistic-ledger.js`）

固定 seed（默认 `20261029`）可复现，支持 `--profile / --count / --years / --seed / --anchor / --out / --out-dir`。

| 场景 | 账单量 | 时间跨度 |
| --- | --- | --- |
| Typical | 5,000 | 3 年 |
| Heavy | 20,000 | 5 年 |
| Stress | 50,000 | 10 年 |

数据分布模拟真实用户而非均匀随机：每月工资、周期房租 / 话费 / 会员、高频餐饮 / 饮料、工作日交通、中频购物 / 娱乐、低频旅游 / 医疗、双 11 与年末购物峰值、少量退款 / 红包收入；来源混合 manual / import / recurring；分类含系统 SVG、自定义 Emoji、归档分类；预算多阶段变更（启用→调整→关闭→重启）；含普通日价与仅日价物品。边界覆盖闰年 2-29、月末 31 日、跨年、23:59:59.999、周日周期。全部为虚构数据。

输出标准 Backup V3 备份（复用现有备份格式与 Raw Validator，不造私有恢复格式）与 expected 摘要；`exportedAt` 固定为 anchor 当天中午，保证字节级可复现。生成文件放 `tests/generated/`（`.gitignore` 已加规则，`git check-ignore` 生效），不提交大 JSON。

### 7.2 真实规模性能 Gate（`tests/perf/realistic-ledger.perf.js`、`npm run perf:realistic`）

用带分片读计数的内存 FS，先真实 `restoreBackup` 落盘，再跑真实用户路径并计时：全量读取、当月 Timeline、月度统计全套、年度统计、分类占比、预算日历 / 日详情 / 节奏、自定义按月读取、Bill Explorer 真实搜索与连续键入、日价列表。

调试中修正关键问题：搜索口径与 `matchKeyword` 完全对齐为 **6 字段**（merchant / title / note / 分类名 / 分类 id / 金额文本），生成器 expected 同步复刻；正确性错误或读取范围错误均导致非零退出。快速 `npm run perf` 保留，不把重型压测加入日常单测。

---

## 8. Gate 6：测试与真机验收

### 8.1 自动测试真实结果（均退出码 0）

| 命令 | 结果 |
| --- | --- |
| `npm test` | **29/29 套件通过，合计 2100 项断言 / 检查，0 失败**；statistics 173 项、path-normalize 575 项 |
| `npm run e2e` | **T01–T19 全绿 19/19，0 失败**，截图均带 `_simulator` 后缀 |
| `npm run perf` | 1k/5k/10k 全绿、近线性（10k 全量 15ms / 年 26ms / 搜索 24ms，10k 比 1k = 3.8x） |
| `npm run perf:realistic` | 5k/20k/50k 全绿、一致性闭合、读取范围正确（Stress/Typical 全量 7.9x ≤ 30x） |
| `npm run theme:audit` | 0 违规 FAIL，3 项主题感知 JS WARN 不阻断 |
| `npm run release:check` | FAIL 0，WARN 1（唯一 WARN：libVersion 仍 latest，待体验版验证后固定） |

### 8.2 T12 回归（本版收口时修复）

收口首跑全量 E2E 出现 18/19、T12 日价用例失败并伴随 `RangeError: Invalid array length`。定位根因：组件未激活时 `data.ym` 仍为空串，`refresh()` 缺少兜底直接 `loadMonth('')`，解析出 NaN 年月，导致 `findTopExpenseDay` 内 `new Array(NaN)` 抛错；该错误在 `refreshPanels` 中断统计面板刷新，其后日价面板 refresh 不执行。

双层修复：① 新增 `monthDays()` 辅助，非法年月返回 NaN，`findTopExpenseDay` / `computeCumulativeTrend` 在非有限天数时安全返回空结果、`computeDailyAverageExpense` 安全返回 0；② `refresh()` 与 `activate()` 对齐加 `currentYM()` / 当前年兜底。补 11 项非法年月回归断言后，全量 E2E 恢复 19/19、异常数 0。

### 8.3 真机 Gate（待用户执行，助手不代签）

- **Agent simulator（automator + Skyline）：PASS** —— 单测、E2E、性能、主题审计、release:check 逻辑项均通过。
- **User physical device（Android）：NOT TESTED（待用户）**

真机三档备份已生成并通过 Raw Validator（0 error / 0 warning），通过正常「备份与恢复」注入（先备份个人账本、不做开发后门），验收清单见 `docs/DEVICE_GATE_v1.3.0.md`：

| 备份 | 跨度 | 构成 | 大小 | 总支出 / 总收入 |
| --- | --- | --- | --- | --- |
| realistic-5000 | 3 年 | 4988 普通 + 12 日价 | 2169.7 KB | 392965.65 / 315851.21 |
| realistic-15000 | 5 年 | 14984 普通 + 16 日价 | 6454 KB | 812873.08 / 520324.73 |
| realistic-30000 | 8 年 | 29972 普通 + 28 日价 | 12881.7 KB | 1450876.46 / 827788.49 |

三档最大单笔均 5622.84；建议真机 5k → 15k → 30k 逐级注入，记录冷启动、切月 / 年度、占比、模块开关、预算、搜索、编辑、导出、重启的真实等待与流畅度，不把 Node 耗时当作手机耗时。

---

## 9. 数据合同冻结声明

v1.3.0 **未升级 / 未改动**任何核心数据合同：

- **Bill V3**：分片 `bills/YYYY-MM.json = {ym, version:3, bills:[...]}`，整数分金额。
- **Backup V3**：`daily-value-mini-backup` SCHEMA=3，不引入 Backup V4。
- **Recurring Store V1**：`recurring.json = {version:1, rules:[...]}`。
- **Budget V1**：`settings.budget = {version:1, weekStartsOn, rules:[...]}`。

本版不加入主题强调色、壁纸、分类颜色持久化、拖拽排序、账户资产、云同步、AutoBill、AI 分析等任何新业务功能。

---

## 10. 已知限制与未完成项

- 真机 Scale Gate（5k/15k/30k 大账本、Canvas 曲线、主题矩阵、升级 / Backup 演练、固定 libVersion）由用户本人完成，结果未测。
- libVersion 仍为 `latest`，体验版验证前保持，不猜版本号；属 release:check 唯一 WARN。
- Bill Explorer 首次进入仍全量读取快照（内存筛选），30k/50k 是否需要分页 / 索引优化待真机数据，本版不提前预优化。
- 原子写在微信 FileSystemManager 的真实 rename / tmp 行为仍须后续真机 / 模拟器按实际基础库验证。
- dining 图标重设计为基于视觉质量的自主修复（id 与数据合同未变），用户审 main 时可确认或调整。

---

## 11. Git 状态

- v1.3.0 改动（基线 `82d5c30` 之后）含统计面板四件套、month / year、index、settings、category-icons、category-icon、release-check、README、CHANGELOG、.gitignore、版本文件，以及新增 category-donut / cumulative-trend 组件、donut / cumulative / config 模块、b64 / path-normalize 工具、真实账本生成器与 perf、read-range / lazy-compute / stat-config / path-normalize 测试、模块管理与累计 / 年度占比 GUI、DEVICE_GATE 与本 HANDOFF。
- 临时诊断脚本与失败截图已清理；`tests/generated/` 大文件被 gitignore 不提交。
- 中文消息用 `git commit -F <file>`，推送走显式代理 `http://127.0.0.1:33210`。
- 最终结果：HEAD == origin/main，ahead=0 / behind=0（核对 `git rev-list --left-right --count origin/main...HEAD`）。
