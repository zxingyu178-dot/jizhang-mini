# DEV LOG — 随时随地大小记（jizhang-mini）

- 当前版本：**1.4.6**

---

# v1.4.6 收口轮（2026-11-11）

- 分支：`main`（直接提交）
- 基线：`origin/main` = `ea98fcb`（v1.4.5 提交，工作区干净）
- 版本：**1.4.6**
- 本轮定位：**两块一起交付** —— B-2 图表结论行第二批（用户可见新功能）+ v1.4.5 遗留 6 项技术欠账清理（详见 `docs/HANDOFF_v1.4.6.md`、`CHANGELOG.md`）

## 1. B-2 图表结论行（看不快 → 看一眼就读出结论）

新增 `data/statistics/insight.js`（7 个纯函数，不 `require('wx')`、不读存储，Node 可单测）。4 张图标题下各一行结论，空数据整行不渲染。

**三条口径红线（改这块前必读）**：
1. 月末预测 = 已花 ÷ 已过天数 × **当月总天数**（⛔ 不许用 30 天，2 月会虚高 7%）；
2. 环比**比同期不比整月**（⛔ 拿半月比整月会假报「少 50%」），上月天数不足时 `clampPeriodDay` 封顶；
3. 12 个月「月均」= 全年 ÷ **有支出月数**（与 Hero `yAvg` 同口径，⛔ 不许改 ÷12，否则同屏两个月均）。

**精度**：结论行金额一律整数元 + 千分位（`¥1,234`），⛔ 不用 `formatAxisAmount`（那会变 `1.2万`）；坐标轴缩略仍走原函数 —— **明细不给精度让步**。

**图上零参考线**：P2 原本想在累计图画「按当前速度月末将达 ¥X」虚线，改为**结论行文字**表达。理由：v1.4.4 刚为消除「假水平线误导」把折线截断到截止日，再画一条无数据支撑的水平线是往回走。

## 2. 同期环比上界面（Hero「本月支出」右侧）

- WXML 把 `hero__label` 包进 `.hero__head`（`flex` + `align-items:baseline` + `space-between`），右侧放 `.hero__mom`。
- **⛔ 没动 Hero 既有样式**：`.hero__label` / `.hero__big` / `.hero__foot` / `.hero__third` 声明一行未改 —— `stats-hero-layout.test.js` 47 条契约全绿。
- **颜色**：统一中性 `--text-axis`。本项目 `--expense` 是绿、`--income` 是红（既有设计不改），按「支出变多 = 警告」染红会撞全项目语义，按「支出 = 绿」染色又会把「花更多」染成好事 —— 两个方向都错，故中性。判据：**宁可中性，也不引入错误语义**。
- **不显示**：本月 0 支出（首日「少 100%」是凭空结论）、两边都 0（`buildMoMCompare` 返回 `null`）→ 整行不渲染，Hero 像素级不变。
- 本月 / 上月两侧累计用**同一个** `sumExpenseThroughDay`，口径与 `computeMonthOverview` 的「支出」一致（`ledgerImpact !== 'daily-value-only'` 且非收入）。

## 3. 技术欠账 6 项（v1.4.5 遗留，随本版一起发）

更新日志补 14 版 / 47 条（1.2.0~1.4.5，1.3.3 无用户可感知变化跳过）；`libVersion` `latest` → **3.17.4**（本地实际调试版本）；外观页 `ACCENT_ORDER` 改 `Object.keys(theme.ACCENTS)` 单一来源；`.gitignore` 加 `reports/`；10 个历史 ZIP（约 86.2 MiB）归档 `artifacts/releases/` + `MANIFEST.md`（**内容零改动**）；删 4 个空 pip 残留目录。

## 4. 回归

`npm test` **53/53**；`insight.test.js` **387 断言**（含 20 条环比接线契约）；`release:check` **FAIL 0 / WARN 0**（v1.4.5 的 `libVersion=latest` 警告消除）；结论行 / 环比颜色实测深色 **7.21~7.78:1**、浅色 **5.53~5.76:1**（三处候选背景，均 ≥4.5:1）；`theme:audit` / `contrast:audit` / `perf` 实测输出见本轮回传。真机未测。

---

# v1.4.5 收口轮（2026-11-10）

- 分支：`main`（直接提交）
- 基线：`origin/main` = `faece15`（工作区干净，无遗留未推送提交）
- 版本：**1.4.5**
- 改动面：**45 个文件**（40 代码 / 配置 + 5 文档；`git diff --stat` 43 个已跟踪文件 + 2 个新增未跟踪文档）
- 本轮定位：主题配色扩展（详见 `docs/HANDOFF_v1.4.5.md`、`CHANGELOG.md`）

## 1. 4 套主题色 × 深 / 浅

只换强调色、不动骨架：`app.wxss` 新增 8 组 `.theme-x.accent-y` 覆盖块，每组只覆盖 `--primary` / `--primary-deep` / `--primary-text` / `--on-primary` / `--button-primary-text` / `--glow-*` / `--hero-bg`。

**必须双类组合**：单写 `.accent-teal` 会同时盖掉深色与浅色的变量（后出现者胜，与 mode 无关），结果深色模式拿到浅色配色 → 8 组全部显式写出，`theme.test.js` 逐组断言 6 个变量齐全。

**新增存储**：`settings.accent`，缺省 `indigo`；老用户无该字段 → 归一 `indigo`，**升级后颜色零变化**。`setAccent` 与 `setThemeMode` 同一写盘口径（先 `writeJSONAtomic` 成功才更新内存，失败返回 `{ok:false}` 不假成功）。

**接线**：14 个页面根容器 `class="{{themeClass}} {{accentClass}}"`。

## 2. 三个存量缺陷（顺带修掉）

1. **浅色主色当文字偏淡** 3.52:1 → 新增 `--primary-text`，浅色靛蓝 `#4b55cf` = **5.70:1**，8 组全部 ≥4.5。`--primary` 降级为只管图形 / 边框（≥3:1）。门禁：`theme.test.js` 扫全项目 `.wxss`，出现 `color: var(--primary)` 直接 FAIL。
2. **深色按钮白字偏淡** 3.13:1 → 新增 `--on-primary`，深色下压亮主色配深墨字（靛蓝 = **6.19:1**），浅色仍白字。契约测试断言深色 4 组 `--on-primary` **不许是 `#ffffff`**。
3. **6 处 JS 硬编码主色** → 全部改为运行时取 `theme.getAccentPalette()`（原靛蓝值只留异常兜底）：`category-icon.js`、`icon.js`、`daily-value-curve.js`（4 处）、`data/statistics/cumulative.js` 的 `LINE_COLOR`（改由组件经 `opts.lineColor` 传入）。原「换主题后图标高亮 / 日价曲线 / 累计折线还是靛蓝」的半变色问题消失。

**连带**：`scripts/theme-audit.js` 品牌色白名单改为按主题读（否则加主题必误报）；外观页色卡 4 个 hex 改为从 `ACCENTS[x].dark.primary` 取（单一来源，改造前后渲染色值实测完全一致）。

## 3. 背景染色（客户已确认保留）

`--glow-*` 跟色相走；**`--bg` / `--card-bg` / `--surface` 未动**，玻璃层次不变（`release-check` 会静态比对 `PAGE_BG` / `CARD_WHITE_ALPHA` 常量）。

## 4. 回归

`npm test` 52/52；`theme.test.js` **285 断言**；`theme:audit` 违规 0；`contrast:audit` 3.145 / 3.249；`release:check` FAIL 0 / WARN 1（`libVersion=latest` 既有）；`npm run perf` 1k 2ms / 5k 6ms / 10k 13ms，10k÷1k = **6.5x**；`artifacts/theme-preview/contrast-check.js` 36 项 FAIL 0。

---

# v1.4.4 收口轮（2026-11-10）

- 分支：`main`（直接提交）
- 基线：`origin/main` = `a504873`（本地已有一提交 `35f3c5d` 此前未推送，随本轮一起推）
- 版本：**1.4.4**
- 改动面：**8 个文件，274 增 36 删**（`git diff --stat` 实测）
- 本轮定位：图表可读性收尾（详见 `docs/HANDOFF_v1.4.4.md`、`CHANGELOG.md`）

## 1. 累计折线 X 轴日期标签：3 个 → 按宽度自适应 5 个

**为什么**：原来只有「首/中/末」3 个日期（`11/01 11/05 11/10`），中段涨在哪天读不出来。

**怎么改**：`axis.pickDateLabels` 改为**按像素**定档 —— 累计折线只画到截止日，横轴仍按整月跨度定位，按点数算会高估可用空间（10 号时 11 个点只占整月左侧 1/3）→ 必然叠字。可画长度 = `plotW × (n-1)/(span-1)`；选完点位再做一次像素校验，抖动导致贴太近就降一档。组件必须传 `spanDays`，否则退化成按点数定档。

**实测**：390/375/360 三档宽度完整月均 **5 个标签**，最小间距 64~69px ≫ 标签宽 29~31.9px，不重叠；末标签 = 数据截止日。当月 10 号 → 3 个（可用宽 82px、标签 31.9px，4 个最少 128px，物理放不下，已在 HANDOFF §6 列明可选解法）。

## 2. 「0 值柱子加基线」核实后放弃

四个入口（`bill-form` 的 `canSubmit`、导入 `validator` 的 `amountCents <= 0`、三个适配器 `if (!amountCents)`、旧数据迁移）全部堵死 0 元；每日趋势按天全量铺点，没花钱的日子柱高 0 就是正确表达，加 2rpx 基线会让「没花钱」显示成「花了一点钱」→ 制造误导，不做。依据见 HANDOFF §1.2。

## 3. 回归

`npm test` 52/52；`chart-axis.test.js` 994 断言；`npm run perf` 10k÷1k = 10.5x；`contrast:audit` 3.145 / 3.249；`release:check` FAIL 0 / WARN 1（`libVersion=latest` 既有）。

---

# v1.4.3 收口轮（2026-11-10）

- 分支：`fix/stats-hero-narrow-class`
- 基线：`origin/main` = `6fa12b9`
- 版本：**1.4.3**
- 改动面：**12 个文件，1133 增 50 删**（`git diff --stat 6fa12b9..HEAD` 实测）
- 本轮 4 个提交：`f3005cf`（新增 real-tap 回归）、`e23ac53`（表单可用性）、`fd601af`（窄屏适配）、`5325f4e`（版本升号）

## 1. 新增真实点击 E2E —— `tests/e2e/real-tap.js`（928 行，14 条）

**为什么**：原 E2E 31 项里，金额 / 备注都是直接调页面函数赋值、**绕过键盘**；全库真实键盘输入只有 2 次且都在周期页。「用户一个字一个字敲进去会不会出问题」这条链路没人测过。

**怎么验**：真实点按 29 次 + 真实键盘输入 23 次。

```bash
node tests/e2e/real-tap.js     # 需非沙箱环境
```

**结果**：**14/14 通过，0 失败**（`reports/logs/spec-real-tap.log`）。

> 日志里如实记了一条未覆盖：模拟器不弹真键盘（键盘探针收到的高度事件为空数组），**「键盘弹起是否遮挡输入框」模拟器测不出**，只能真机验 —— 已写进 `docs/10_DEVICE_ACCEPTANCE.md`。

## 2. 空金额点保存无提示（已修）

- 原来：静默 `return`，什么都不发生，用户以为按钮坏了。
- 现在：弹「请先填写金额」+ **1.2 秒节流**（连点 5 次只弹 1 条）；按钮灰态判断逻辑**未动**。
- 验证：`real-tap.js` A4。

## 3. 备注无长度上限（已修）

- 原来：备注 63 字**原样落库**，与周期页 40 字口径不一致。
- 现在：`bill-form.wxml` 加 `maxlength="40"` + `bill-form.js` 兜底截断，两层；含 **emoji 半字保护**。
- 验证：`real-tap.js` B2（63 字 → 40 字落库）、B3（特殊字符不破坏）。

## 4. 统计 Hero 窄屏适配（渲染层事实修正）

- 原来：用 `@media (max-width: 360px)`，但 **Skyline 的 media queries 只支持 DarkMode，宽度断点大概率不生效** —— 等于写了没生效。
- 现在：`utils/device.js` 启动读屏宽，`≤360px` 挂窄屏类名，窗口变化跟随更新；样式改「基础规则 + `--narrow` 覆盖」，覆盖规则必须在基础规则之后；原 `@media` 块删净，**全项目宽度断点 0 处**。
- **390px Skyline 实测**：

| 状态 | 三列宽度 | 中间列文本高 |
| --- | --- | --- |
| 正常 | 91.1 / 145.6 / 91.1（无 `narrow` 类） | 20 |
| 强制窄屏类 | 中间列 **150.6** | **17** |

- **契约测试**：`stats-hero-layout.test.js` 断言 27 → **47** 条。
- **变异测试**：改回 26rpx / 删类绑定 / 判定写死 `false` / 偷改 360 阈值 —— **四种破坏全部被抓**。

## 5. 本轮验证结果（全部实跑）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | **51/51 套件通过** |
| GUI E2E | `npm run e2e` | **31/31 通过**（19 张截图） |
| 真实点击 | `node tests/e2e/real-tap.js` | **14/14 通过** |
| 专项（6 个） | 见 `reports/logs/` | 279 / 54 / 44 / 28 / 54 / 48，全部通过 |
| 主题审计 | `npm run theme:audit` | FAIL 0（3 项既有 WARN） |
| 对比度审计 | `npm run contrast:audit` | dark 3.145 / light 3.249（worst ≥ 3:1） |
| 性能 | `npm run perf` | 1k 2ms / 5k 7ms / 10k 13ms，比值 6.5x（期望 ≤40x） |
| 发布门禁 | `npm run release:check` | **FAIL 0 / WARN 1**（`libVersion=latest`） |

> 导入预览 30k 302ms 为**上一轮实测**，本轮未重跑。

## 6. 收口

版本 1.4.3；`CHANGELOG.md` / `README.md` / `DEV_LOG.md` / `TASKS.md` / `docs/10_DEVICE_ACCEPTANCE.md` / `reports/final-audit.md` / `reports/data-safety.md` 统一到 1.4.3；新增 `docs/HANDOFF_v1.4.3.md`（门禁强制项，`release-check.js` 按 `APP_VERSION` 动态检查）。真机验收**未执行**。

---

# 以下为 v1.4.2 阶段开发日志（历史原文，未改）

- 当前版本（本节）：**1.4.2**（本轮冻结，不升版本）
- 本文件记录 **v1.4.2 最终稳定化阶段**的开发日志，按 Gate 分节
- 记录时间：2026-11-10
- 分支：`fix/v1.4.2-final-stabilization`
- 基线：`5c33d6da8b9e72308abc640ad7810e75b29032dc`（原 `main` HEAD，也就是合并前的 `origin/main`）
- 当前 HEAD：`959f21ec29421f66f7a25a2187168ae469f80dd3`

> **看这份日志前先分清两件事**
>
> | | 阶段测试 | 最终测试 |
> | --- | --- | --- |
> | 谁跑 | 开发自验 | QA（Gate 4 回归 + 销项） |
> | 什么时候 | Gate 1 / Gate 2 开发过程中 | Gate 4 收尾 |
> | 作用 | 自己先确认改动没写崩 | 对外交付的**唯一依据** |
>
> 下文每节都标注了是哪一种。

---

## Gate 0 — 基线确认

**改了什么**
无代码改动。确认起点：

- 基线提交 `5c33d6d`，与原 `main`、合并前 `origin/main` 三者一致
- 版本号 1.4.2
- 从基线切出分支 `fix/v1.4.2-final-stabilization`

**怎么验的**

```bash
git rev-parse origin/main   # 5c33d6da8b9e72308abc640ad7810e75b29032dc
git rev-parse main          # 5c33d6da8b9e72308abc640ad7810e75b29032dc
git branch --show-current   # fix/v1.4.2-final-stabilization
```

**结果**
基线明确、分支干净、没有夹带未提交改动。

（补充说明：此时 `git status --short` 已有 8 条 `??` 未跟踪项，全部是仓库根目录的历史交付 ZIP，不是源码改动。详见 `git/status.txt`。）

---

## Gate 1 — 恢复链路加固（P0）

**改了什么**

| 文件 | 具体改动 |
| --- | --- |
| `data/fs.js`（+47） | 新增**严格删除**能力：删文件删不掉时不再静默返回成功，把失败暴露出来（`removeStrict`）。原因：删除失败被吞掉，就会出现"以为删了其实还在"，后续恢复/回滚全部建立在一个错的前提上 |
| `data/backup.js`（+69） | 恢复链路：`createdAt` **缺失**与**非法值**分开处理。缺失 = 老备份（Backup V1/V2）的正常情况 → 静默补齐；非法值 = 真问题 → 留可查诊断 |
| `data/recurring/store.js`（+131） | ① 周期规则恢复**只规范化一次**（原来反复规范化，同一条规则被补多次字段，结果可能不一致）；② 临时安全点清理失败留可查诊断 |
| `packages/importer/core/commit.js`（+38） | 导入提交/回滚：原始安全点与临时安全点**隔离**；回滚成功清理临时、失败则两者都保留 |

**为什么这么改**
这些都属于"用户看不见，但一旦出问题就伤数据"的地方。用户感知不到 ≠ 风险不存在，所以 P0。

**怎么验的 —— 阶段测试（开发自验）**

- `npm test`：**50/50 套件通过，0 失败**
- 新增/补充专项测试 4 个（见下），覆盖面见 Gate 2

**结果**
阶段测试全绿，提交 `d01b9d9`。

---

## Gate 2 — 专项测试补齐

**改了什么**

本轮**只加测试、不改业务逻辑**，把 Gate 1 的改动逐条钉上用例：

| 测试文件 | 新增 | 覆盖什么 |
| --- | --- | --- |
| `tests/quarantine-rollback.test.js` | +280 | 隔离与回滚：安全点隔离、回滚完成/未完成的判定、失败时不谎报成功 |
| `tests/backup-restore-statistics.test.js` | +178 | 备份恢复后**统计数字**是否还与恢复前一致（数量、ID 集合、关键字段、重复 ID） |
| `tests/import-rollback-safety.test.js` | +129 | 导入回滚安全：失败后账本未被写坏 |
| `tests/recurring.test.js` | +131 | 周期规则恢复：只规范化一次、缺失字段补齐、非法值诊断 |
| `tests/perf/large-ledger.perf.js` | +39 | 性能基准**去掉写死日期**——原基准写死了日期，跨天跑会因数据落在不同月份而误报 |

**怎么验的 —— 阶段测试（开发自验）**

| 项 | 结果 |
| --- | --- |
| 单元测试全套 | **50/50 套件通过，0 失败** |
| 大账本性能 | 1k 全量 **1ms** / 5k **7ms** / 10k **14ms**；1k→10k 比值 **14.0x**（期望 ≤40x，说明没出现超线性退化） |

**结果**
专项测试全部就位，提交 `d01b9d9` 之后由 QA 接手做最终测试。

---

## Gate 4 — 回归与销项（最终测试 · QA 实跑）

**改了什么**
代码层面只有一处小整改，来自 QA 提的两个问题：

| 编号 | QA 提的问题 | 整改内容 | 提交 |
| --- | --- | --- | --- |
| QA-01 | 性能基准里写死了日期，跨天跑结果会漂 | 去掉写死日期，改为运行时生成 | `959f21e` |
| QA-03 | `createdAt` 非法时诊断信息看不清，没法查 | 非法值保留**可查的诊断**（字段名 + 错误码），缺失值仍静默补齐 | `959f21e` |

**怎么验的 —— 最终测试（QA 实跑，对外以此为准）**

| 项 | 结果 |
| --- | --- |
| 单元测试全套 | **50/50 套件通过，0 失败** |
| 专项 · `quarantine-rollback` | **279 项通过** |
| 专项 · `backup-restore-statistics` | **44 项通过** |
| 专项 · `import-rollback-safety` | **54 项通过** |
| 专项 · `recurring` | **145 项通过** |
| 专项 · `recovery-ui-guard` / `dedupe-index` / `import-e2e-safety` | 全部通过 |
| E2E | **31/31 通过，0 失败**，19 张截图，产物在 `artifacts/e2e/2026-11-10T01-15-53-115Z` |
| 审计 theme / contrast / release | 三项 **FAIL = 0，警告 = 0**（对比度 0 项失败） |
| 性能 · 导入预览 | 5,000 笔 **104ms** / 15,000 笔 **169ms** / 30,000 笔 **302ms**（红线 1,500ms） |

**结果**
QA 销项通过，无遗留 FAIL。提交 `959f21e`。

> **一个要说明的数字**：上一阶段（第一阶段开发）记录的 30k 导入预览是 **111.6ms**，本阶段最终测试是 **302ms**。
> 不是回退 —— 是不同轮次、不同机器负载下的实测值，两者都远低于 1,500ms 红线。
> **对外口径以最终测试 302ms 为准。**

---

## Gate 3 — 交付文档整理（本次）

**改了什么**
**没有改任何源码 / 测试 / 配置。** 本 Gate 只产出文档：

| 文档 | 性质 |
| --- | --- |
| `docs/HANDOFF_v1.4.2.md` | 追加第二阶段交接（第一阶段原文一字未改） |
| `DEV_LOG.md` | 新建（本文件） |
| `TASKS.md` | 新建 |
| `docs/10_DEVICE_ACCEPTANCE.md` | 追加第 6 节「v1.4.2 真机验收清单」（原有内容未动） |
| `reports/final-audit.md` | 新建 |
| `reports/data-safety.md` | 新建 |
| `git/status.txt` | 新建（`git status --short` 原文 + 说明） |
| `git/commits.txt` | 新建（提交 / 分支 / SHA 原文） |
| `docs/V1.4.0_RUN_MODE.md` | 追加一段运行模式记录（历史段落未动） |

**怎么验的**
对照 `git diff --name-only 5c33d6d..HEAD` 逐个核改动文件；文档里出现的每个数字都能追溯到实际运行输出或 git 命令结果。

**结果**
文档齐活。**本 Gate 不提交、不合并、不推送、不打包** —— 这些是下一棒的事。

---

## 附：本阶段改动文件总览（9 个，git 实测）

```
data/backup.js                          |  69 ++++++--
data/fs.js                              |  47 ++++++
data/recurring/store.js                 | 131 ++++++++++++++-
packages/importer/core/commit.js        |  38 ++++-
tests/backup-restore-statistics.test.js | 178 ++++++++++++++++++++
tests/import-rollback-safety.test.js    | 129 ++++++++++++++-
tests/perf/large-ledger.perf.js         |  39 ++++-
tests/quarantine-rollback.test.js       | 280 ++++++++++++++++++++++++++++++++
tests/recurring.test.js                 | 131 +++++++++++++++
9 files changed, 1016 insertions(+), 26 deletions(-)
```

> 任务书正文写「改动文件 8 个」，同表末尾又写「共 9 个，按 git diff 为准」。
> **实际 git 输出是 9 个**，本日志以 git 为准。

**未改动**（已用 diff 确认输出为空）：`package.json`、`package-lock.json`、`project.config.json`。
**数据合同未变**：Bill **V3** / Backup **V3**（恢复兼容 V1、V2、V3）/ Recurring Store **V1**，字段集合均未变。
**依赖未新增**：`devDependencies` 仍只有 `miniprogram-automator`（仅测试用）。

---

# v1.5.3 柱状图 6 档明暗台阶（2026-11-11）

**目标**：把 1.5.1 没做成的柱体立体感补上，让统计页四张图是同一套材质。

**做法**：柱子从「31 个 view」改为「每张图 1 个 `<image>`」，图源是 `utils/bar-shading.js` 生成的 SVG（base64 成 data-URI）。档位 `3/5/7/65/13/7 %`，明暗在 JS 里用 `mixHex()` 算成实色 `#rrggbb` 再写进 SVG —— SVG 不支持 `rgba()`，`stroke-opacity` 又是「和卡片混」不是「和白色混」。

**为什么没用 Canvas（客户原定）**：`<canvas type="2d">` 放进统计页后 `createSelectorQuery` 回调不返回 node、`panel.$$('canvas')` 为 0、柱区截图全空（画布尺寸查得到，一个像素都画不出来）。同卡片里 SVG 路径一直正常。**已向客户说明，待确认**。

**怎么验的**：新增 `tests/e2e/bar-shading-shots.js` + `png-lite.js`（零依赖 PNG 编解码）+ `bar-analyze.js`，模拟器截四张图（年度/月度 × 深/浅）并逐像素采样：

| 阶段 | 柱高 | 档数 | 最小跳变 |
|---|---|---|---|
| 年度 深色 | 121px | 6 | 19.0 |
| 年度 浅色 | 121px | 6 | 10.3 |
| 月度 深色 | 102px | 6 | 19.0 |
| 月度 浅色 | 102px | 6 | 10.3 |

顺序全部「本色 → 顶光 → 受光 → 柱身 → 背光 → 接触暗」。截图与 `report.json` 在 `docs/screenshots/bar-shading/`。

**取证自身的三次误判（防复发）**
1. `offset()` × `devicePixelRatio` 换算裁剪区是错的：截图缩放 455/390≈1.167，不是 dpr 3 → 改按档位色自动定位。
2. 「接触暗」当锚点会被「月度/年度」分段按钮的抗锯齿边缘抢走（1px 混色恰好落进容差）→ 改逐列找最长连续色段。
3. Skyline 下截图滞后于 `setData`，且滞后不止一帧（组件自报 light 而像素仍是深色底；像素对了但画面还停在上一模式）→ 改「背景亮度 + 能否解析出柱区」双条件验收每一帧。

**结果**：`npm test` 53/53、`release:check` FAIL 0 / WARN 0、四阶段取证全过。提交 `0fdc8df`，已推送并上传开发版（main 446,660 字节，较 1.5.2 的 441,030 增加 5,630 字节，主要是新增的 `utils/bar-shading.js` 8,865 字节源码）。

**未做 / 待办**：真机全部未测；`app.wxss` 的 `--bar-cap/-lit/-shade/-foot` 四变量已无人消费（值被测试锁住当文档）；进程内三份 `mixHex` 未合并；柱顶要做 hover / 生长动画需改回元素方案。
