# HANDOFF — 随时随地大小记 v1.4.6（Data Insight：图表结论行 + 同期环比）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：`main`（直接提交）
- Version：**1.4.6**
- AppID：`wxcdcf83d9191065d9`
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json` 两处、`README.md`、`CHANGELOG.md`）
- 开发基线：`origin/main` = `ea98fcb`（即本版前一提交，v1.4.5）
- 本版定位：**两块一起交付** ——
  1. **技术欠账清理 6 项**（v1.4.5 收尾遗留，随本版一起发）；
  2. **B-2 图表结论行第二批**（用户可见的新功能：4 张图标题下加一句话结论 + Hero「本月支出」右侧同期环比）。
- 不升级数据合同（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1）、不加依赖、不改渲染器、不改任何统计口径。
- 完成状态：**READY_FOR_UPLOAD**（自动化全绿；真机 iPhone / Android 未测试，由客户按 `docs/10_DEVICE_ACCEPTANCE.md` 执行）

---

## 0. 结论速览

| 维度 | 结果 |
| --- | --- |
| 新增模块 | `data/statistics/insight.js`（13.8KB，7 个纯函数，可在 Node 单测，不 require `wx`） |
| 图表结论行 | 4 张（分类占比 / 每日花费 / 累计消费 / 12 个月）各一行，空数据**整行不渲染** |
| 月末预测 | 仅当月：已花 ÷ 已过天数 × **当月总天数**（2 月 28 / 29 天、31 天月都算准） |
| 同期环比 | Hero「本月支出」右侧；**比同期不比整月**；本月 0 支出 / 上月同期无支出有专门文案；两边都 0 整行不出现 |
| 语义色 | 涨跌**统一中性色**（本项目 `--expense` 是绿、`--income` 是红，染哪个都传错语义）—— 见 §2.4 |
| 口径一致性 | 日均 = Hero `mDailyAvg`；年度月均 = Hero `yAvg`（全年 ÷ 有支出月数）；同屏不出现两个「月均」 |
| 精度 | 结论行金额 ≥¥1 走整数元 + 千分位（`¥1,234`），**0 < 金额 < ¥1 给 2 位小数**（`¥0.30`，v1.4.6 P2-3 起）；坐标轴缩略仍走 `formatAxisAmount` |
| 图上参考线 | **0 条**（⛔ 明令禁止：v1.4.4 刚为消除「假水平线误导」把折线截断到截止日） |
| 对比度（结论行 / 环比） | `--text-axis` 实测 **深色 7.21~7.78:1、浅色 5.53~5.76:1**（页面 / 卡片渐变两端三处候选背景），均 ≥4.5:1 |
| 单元测试 | **53/53 套件通过**；`insight.test.js` **623 断言**（含 20 条 Hero 环比接线契约 + 236 条 P2 修补契约） |
| P2 修补（同版内） | **5 条**：月初预测不再放大、单分类文案、小额 2 位小数、大额折行不切数字、更新日志去工程味 —— 见 §11 |
| 应用内更新日志 | 补 **14 个版本 / 47 条**（1.2.0~1.4.5，1.3.3 因无用户可感知变化跳过）+ 1.4.6 的 P2 小结 1 条 |
| 基础库版本 | `project.config.json` 的 `libVersion` 由 `latest` **固定为 3.17.4** |
| release:check | **FAIL 0 / WARN 0**（v1.4.5 的 `libVersion=latest` 警告已消除） |
| 真机 | **未测试**（本轮无数据链路改动，纯展示层） |

---

## 1. 块一：技术欠账清理（6 项，无用户可见行为变化）

| # | 事项 | 改动 | 依据 / 验证 |
| --- | --- | --- | --- |
| 1 | 应用内更新日志停在 1.1.0 | `pages/release-notes/release-notes.js` 的 `RELEASES` 补 1.2.0~1.4.5 共 **14 个版本 / 47 条**（用户视角文案，不写函数名）；1.3.3 无用户可感知变化，跳过不编 | 逐版本对照 `CHANGELOG.md` 写；`grep -c "version: '"` = 16（含 1.1.0 / 1.0.0）；新增条目实测 47 条 |
| 2 | 上传产物污染工作区 | `.gitignore` 加 `reports/` | `git status --short` 不再出现 `reports/upload-info-*.json` |
| 3 | 基础库版本随线上漂移 | `project.config.json`：`libVersion` `latest` → **3.17.4** | 取本机微信开发者工具**本地实际调试版本**（不是猜的最新版）；`release:check` 由 WARN 转 PASS |
| 4 | 主题色顺序两处维护 | `pages/appearance/appearance.js`：`ACCENT_ORDER` 写死数组 → `Object.keys(theme.ACCENTS)`（单一来源） | 实测 `Object.keys(ACCENTS)` 仍是 `['indigo','teal','amber','rose']`，**色卡顺序与改造前完全一致**；将来加第 5 套色自动跟上 |
| 5 | 4 个空 pip 残留目录 | 删除（工作区清理，未进版本库） | `git status` 无变化（本来未被跟踪） |
| 6 | 10 个历史交付包（约 86.2 MiB）散在仓库根目录 | 移入 `artifacts/releases/` + 新建 `MANIFEST.md`（逐包字节数 / 大小 / 修改时间 / 用途） | **内容零改动**（未解压、未重打包、未重命名）；`artifacts/` 已被 `.gitignore` 与 `packOptions.ignore` 双重排除，既不进版本库也不进小程序包 |

> 块一**不改任何业务代码路径**，纯「工程卫生」。唯一要留意的是块一 ③：库版本固定后，若客户真机是更老的微信版本，行为以 3.17.4 为准（本项目 `renderer: skyline`，`release-check` 会校验渲染器）。

---

## 2. 块二：B-2 图表结论行（本版新功能）

### 2.1 一句话定位

v1.4.4 解决「图表看不清」，本版解决「图表看不快」——**把已经算好的数组压成一句话**，用户不用看柱子高度，读一行字就知道结论。

### 2.2 新增 `data/statistics/insight.js`（7 个纯函数）

| 函数 | 作用 | 关键规则 |
| --- | --- | --- |
| `formatInsightYuan(cents)` | 结论行专用金额格式 | 整数元 + 千分位（`¥1,234`）；0 / 负数 / 非法 → `¥0`；⛔ 不用 `formatAxisAmount`（那会变 `1.2万`） |
| `buildCategoryInsight(list)` | 分类占比结论 | 占比 ≥30% → `餐饮 占 42%，是最大开销`；<30% → `餐饮 占比最高，27%`；分类名超 8 字截断补 `…` |
| `buildDailyInsight(list, denomDays, month)` | 每日趋势结论 | `日均 ¥20 · 最高 11/08 ¥127`；仅一天有支出 → `仅 11/08 有支出 ¥127`；**日均分母与 Hero 同口径** |
| `buildCumulativeInsight({totalCents, elapsedDays, spanDays, isCurrentMonth})` | 累计趋势结论 | 当月 `已花 ¥1,234 · 按当前速度月末约 ¥3,800`；历史月 `已花 ¥1,234 · 日均 ¥41`（已完整，不预测） |
| `forecastCumulative(total, elapsed, span)` | 月末预测 | 已花 ÷ 已过 × **当月总天数**；除零 / 非法返回已花金额，**永不 NaN / Infinity** |
| `buildMonthlyInsight(list)` | 12 个月结论 | `月均 ¥1,234 · 最高 3 月 ¥5,999`；月均分母 = **有支出月数**（与 Hero `yAvg` 同口径） |
| `buildMoMCompare(cur, last)` + `clampPeriodDay(d, lastDays)` | 同期环比 + 上月同期日封顶 | 比同期不比整月；上月同期 0 → `上月同期无支出`；两边都 0 → `text: null`；差异 <1% 至少报 1% |

还有两个不变量（`insight.test.js` 硬断言）：
- **长度自保**（P2-4 起改口径）：原先按 22 字宽把文案截断补 `…` + CSS `nowrap/ellipsis`，会把大额文案切成 `…月末约 ¥3,827…`。现在**允许折行**：只保留 40 字宽的宽松兜底截断，且**截断点绝不落在数字中间**；渲染层由 wxml 逐段 `nowrap`（`.chart__insight__seg`）+ 容器 `flex-wrap` 保证「只能在段间换行」。详见 §11 P2-4。
- **非法入参不崩**：`null` / 非数组 / 非数字 / 负数一律返回 `''` 或安全默认值，全量扫描断言输出里没有 `NaN / undefined / Infinity / null`。

### 2.3 四张图的实际文案（实测样例）

| 图 | 实测文案 |
| --- | --- |
| 分类占比 | `餐饮 占 42%，是最大开销` |
| 每日花费趋势 | `日均 ¥20 · 最高 11/08 ¥127` |
| 累计消费趋势（当月） | `已花 ¥242 · 按当前速度月末约 ¥750` |
| 累计消费趋势（历史月） | `已花 ¥486 · 日均 ¥16` |
| 12 个月支出趋势 | `月均 ¥1,234 · 最高 3 月 ¥5,999` |
| Hero 同期环比 | `比上月同期多 12%` / `比上月同期少 8%` / `与上月同期持平` / `上月同期无支出` |

### 2.4 同期环比上界面：位置、颜色、为什么

- **位置**：统计页**月度** Hero「本月支出」那一行的**右侧**（`.hero__head` 用 `display:flex; align-items:baseline; justify-content:space-between` 把 label 与环比左右分布）。年度 Hero **不带**（年度没有「上月同期」这个概念）。
- **⛔ 没动 Hero 既有样式**：`.hero__label`（24rpx / `--text-secondary`）、`.hero__big`、`.hero__foot`、`.hero__third` 的声明**一行未改**（`stats-hero-layout.test.js` 47 条契约全绿，另加 20 条新接线断言）。
- **颜色决策（重点）**：本项目 `--expense` 是**绿** `#3ddc8f`、`--income` 是**红** `#ff6b6b`（既有设计，本轮 ⛔ 不改）。所以：
  - 想「支出变多 = 警示」→ 得用红 `--income`，但全项目「收入才是红」，撞车；
  - 想「支出 = 绿」→ 那「花得更多」被染成好事，语义更错。
  - **两个方向都会传出错误语义，故统一取中性 `--text-axis`**（与刻度同档），涨跌只靠文字（`多 12%` / `少 8%`）表达。判据：**宁可中性，也不引入错误语义**。
- **不显示的场景**：`momText` 为空 → 那个 `<text>` 根本不渲染，Hero 与改造前像素级一致。

### 2.5 三条口径红线（⛔ 后续改这块前先读）

1. **月末预测** = `已花 ÷ 已过天数 × 当月总天数`。⛔ 不许用 30 天估算（2 月会虚高 7%，31 天月会虚低 3%）。
2. **环比比同期不比整月**。⛔ 拿本月 1-10 号去比上月整月，月中会假报「比上月少 50%」。上月只有 28/30 天而本月已过 31 天时，用 `clampPeriodDay` 封顶到上月最后一天。
3. **12 个月「月均」= 全年 ÷ 有支出月数**（与 Hero `yAvg` 同口径）。⛔ 不许改成 ÷12 —— 那会让同屏出现两个不同的「月均」，等于把 bug 做进界面。

### 2.6 对比度（本轮实测）

用 `data/statistics/contrast` 的 WCAG 口径，在**三处候选背景**（页面底 / 玻璃卡渐变两端）上算 `--text-axis` 与其混色后的对比度：

| 主题 | page | card-start | card-end | 结论 |
| --- | --- | --- | --- | --- |
| 深色 | 7.78 | **7.21** | 7.70 | 全部 ≥4.5:1 |
| 浅色 | **5.53** | 5.76 | 5.69 | 全部 ≥4.5:1 |

> 复算命令见 §5；结论行与环比同一档颜色（`--text-axis`），因此可用同一组数据。

### 2.7 测试

- `tests/insight.test.js`：**623 断言**（纯函数 12 组 + 20 条 Hero 环比接线契约 + 236 条 P2 修补契约）。
- `tests/stats-hero-layout.test.js`：**47 条 Hero 布局契约**全绿（一条未改）。
- `npm test`：**53/53 套件通过**。

---

## 3. 修改文件

| 分组 | 文件 | 改了什么 |
| --- | --- | --- |
| 结论行核心 | `data/statistics/insight.js`（**新增**，13.8KB） | 7 个纯函数 + 长度自保 + 无残次品保护 |
| Hero 环比上界面 | `components/statistics-panel/statistics-panel.{wxml,js,wxss}` | WXML 包 `.hero__head` + `.hero__mom`；JS 加 `momText/momDir` 与 `sumExpenseThroughDay`；WXSS 加 3 个新类（未改任何既有声明） |
| 测试 | `tests/insight.test.js`（新增接线段 + P2 修补段）、`tests/run-all.js`（注册新套件）、`tests/e2e/insight-probe.js`（GUI 实拍探针，新增） | 623 断言 / 53 套件 |
| 块一清理 | `.gitignore`、`pages/appearance/appearance.js`、`pages/release-notes/release-notes.js`、`project.config.json` | `reports/` 忽略；主题色顺序单一来源；更新日志补 14 版 47 条；`libVersion` 固定 3.17.4 |
| 版本 | `utils/version.js`、`package.json`、`package-lock.json`（**仅顶层 + `packages[""]` 两处**）、`README.md` | 升版 1.4.6 + README 功能描述（图表结论 / 同期环比） |
| 文档 | `CHANGELOG.md`、`DEV_LOG.md`、`docs/BACKLOG.md`、`docs/HANDOFF_v1.4.6.md`（新建） | 见 §4 |

> `package-lock.json` **只有 2 行变化**（顶层 `version` + `packages[""]` 的 `version`），`git diff package-lock.json` 逐行核过；第三方依赖未动。

---

## 4. 文档同步

| 文件 | 改了什么 |
| --- | --- |
| `CHANGELOG.md` | 新增 `[1.4.6] — 2026-11-11` 条目，两块分开写 |
| `DEV_LOG.md` | 新增「v1.4.6 收口轮」记录（含改动面、口径、回归实测） |
| `docs/BACKLOG.md` | B-2 状态：**待定 → 部分已做（1.4.6）**；已做项与未做项（P2 参考线改为结论行文字、P3 拆图不做）逐条注明 |
| `pages/release-notes/release-notes.js` | `RELEASES` 顶部加 1.4.6 一条（4 条用户视角文案） |
| `README.md` | 当前版本 + 「图表结论行」「同期环比」两条功能说明 |

---

## 5. 回归实测（本轮实跑，命令可复制）

| 命令 | 结果 |
| --- | --- |
| `npm test` | **53/53 套件通过** |
| `node tests/insight.test.js` | **623 passed / 0 failed** |
| `npm run release:check` | **FAIL 0 / WARN 0** |
| `npm run theme:audit` | 见回传实测输出 |
| `npm run contrast:audit` | 见回传实测输出 |
| `npm run perf` | 见回传实测输出 |

对比度复算（结论行 / 环比同一档 `--text-axis`）：

```bash
node -e "
const c=require('./data/statistics/contrast');
const mix=(fg,a,bg)=>fg.map((v,i)=>v*a+bg[i]*(1-a));
['dark','light'].forEach(t=>{
  const fg0 = t==='dark'?[255,255,255]:[32,35,52];
  const a = t==='dark'?0.62:0.70;
  c.candidateBackgrounds(t).forEach(b=>{
    console.log(t, b.label, c.contrastRatio(mix(fg0,a,b.rgb), b.rgb).toFixed(2));
  });
});
"
```

---

## 6. 向后兼容

| 场景 | 行为 |
| --- | --- |
| 老用户升级 | 纯展示层新增，**无存储字段新增、无迁移**；账本 / 设置 / 备份格式一行未变 |
| 当月无支出 | 4 条结论行全部不渲染，图表走既有空态（`本月还没有支出`），Hero 保持原样 |
| 上月无数据 | 环比显示 `上月同期无支出`（⛔ 不算 +∞%、也不算 100%） |
| 当月与上月同期都为 0 | 环比整行不出现（Hero 与改造前一致） |
| 本月还没花钱（首日） | 不显示环比（`少 100%` 是凭空结论，不是洞察） |
| 历史月份 | 累计图报「日均」不报「月末预测」（历史月已完整）；环比按整月同期比较 |
| 自定义长分类名 | 超 8 字截断补 `…`，不把整句挤爆 |
| 超大金额 | 整数元 + 千分位，20 位数字也不刷长小数（`insight.test.js` 全量扫描） |

---

## 7. 真机验收（未执行，建议 5 条）

1. 统计页（月度）：Hero「本月支出」右侧有一句「比上月同期多/少 X%」，**不与金额重叠、不换行**。
2. 切到年度：Hero 上**没有**环比（年度无「上月同期」）。
3. 四张图标题下各有一行灰字结论；点「管理」关掉某模块 → 该图连结论行一起消失。
4. 找一个月无支出的历史月份 → 图表显示空态文案，**没有任何结论行**、没有 `¥0`。
5. 小屏机（≤360px）：结论行仍是**一行**，不出现省略号 `…`；Hero 三列（记录 / 最高消费日 / 日均）位置没被挤动。

---

## 8. 已知限制 / 遗留（如实列）

1. **真机未测**：本机只有模拟器 + automator，无真机、无渲染像素比对。
2. **环比只有月度**：年度没有「上月同期」概念，不做年度环比（若要「同比」需另立需求）。
3. **结论行只覆盖 4 张图**：预算日历 / 收入支出对比 / 自定义日期统计**没有**结论行（需求只点了 4 张，其余登记为待定）。
4. **P2「按当前速度月末将达 ¥X」参考线未画**：改为**结论行文字**表达（⛔ 不在 SVG 里画参考线，理由见 §2.5）。若客户坚持要图上画线，需重新评估「假水平线误导」的风险（v1.4.4 刚因此把折线截断到截止日）。
5. **P3 拆图不做**：累计图仍同时回答「花了多少」和「花得快不快」，靠结论行文字化解；真拆图属结构性改动，需单独立项。
6. **`clampInsight` 是估宽兜底，不是主防线**（P2-4 起）：中文 1 字宽、数字 0.5 字宽的估算在系统大字体下仍有 ±1 字偏差 —— 现在**靠折行化解**（40 字宽才兜底截断，且不切数字），不再靠 `ellipsis` 裁字。

---

## 9. Git

| 项目 | 值 |
| --- | --- |
| 开发基线 | `origin/main` = `ea98fcb`（v1.4.5 提交） |
| 本版提交 | 见回传的 commit hash（信息首行：`feat(stats): 图表结论行与月末预测，并清理 v1.4.5 技术欠账，升版 1.4.6`） |
| 推送 | `git push origin main`；`HEAD` 与 `origin/main` 一致（两个 hash 见回传） |

---

## 10. 工作区说明（别误报成脏工作区）

- `artifacts/`（含本轮归档的 `artifacts/releases/` 10 个历史 ZIP）与 `reports/` 均已被 `.gitignore` 排除 —— **不进版本库**。
- `tests/e2e/insight-probe.js` 是 GUI 实拍探针，跑完会把截图落 `artifacts/e2e/insight/<时间戳>/`，同样不进版本库。

---

## 11. P2 修补（v1.4.6 同版内，5 条，**不升版**）

背景：QA 独立验收结论「**可交付，P0=0 / P1=0**，算法口径全部正确」，另外给 5 条 P2。客户判定这 5 条都是「用户会当场指着问」的问题，**本轮全修、不往下一版推**（推下一版等于再上传审核一次）。版本号因此保持 **1.4.6**。

### 11.1 逐条：问题 → 改法 → 改后 → 验收

| # | 问题（改前实测） | 改法（文件 · 位置） | 改后 | 验收 |
| --- | --- | --- | --- | --- |
| **P2-1** 月初预测夸大 | 1 号记 ¥3,000 房租 → `forecastCumulative(300000,1,30)=9000000` → 「已花 ¥3,000 · **按当前速度月末约 ¥90,000**」（30 倍噪音）。2 号 15 倍、3 号 10 倍 | `data/statistics/insight.js` · `buildCumulativeInsight` 当月分支：新增常量 `EARLY_MONTH_DAYS=3`，`elapsedDays` 为 **1~3** 时返回「本月才刚开始」，**不再调用预测**。⛔ `forecastCumulative` 公式本体**一行未改** | 「已花 ¥3,000 · 本月才刚开始」；`elapsedDays≥4` 恢复「按当前速度月末约 ¥X」；历史月仍走「日均」 | 单测 12 条（1/2/3 天不预测、4 天恢复、历史月不受影响、公式本体仍 `=9000000`）；截图 `p2-1-*` |
| **P2-2** 单分类说「是最大开销」 | 只有一个分类时「餐饮 占 100%，**是最大开销**」没有比较对象 | `buildCategoryInsight`：先统计**非零分类数**，`=1` 时改陈述句 | 「本月支出全部在餐饮」（单分类且 percent 缺失也走这条） | 单测 8 条（含「2 个分类 99%/1% 仍用最大开销」「0 值分类不算比较对象」）；截图 `p2-2-*` |
| **P2-3** 小额渲染成 ¥0 | `formatInsightYuan(30)` → `'¥0'`，于是出现「**仅 11/05 有支出 ¥0**」「已花 ¥0 · …」自相矛盾 | `formatInsightYuan` 分两档：`≥100 分` 整数元 + 千分位；`0<金额<100 分` → `(r/100).toFixed(2)` | `¥0.01` / `¥0.30` / `¥0.99`；100 分 → `¥1`（不带 `.00`）；0 → `¥0` | 单测 12 条（1/30/99/100/0 分 + 「≥¥1 不带小数、<¥1 必须 2 位」）；截图 `p2-3-*` |
| **P2-4** 大额把数字切断 | `MAX_UNITS=22` 估宽截断 + CSS `nowrap/ellipsis` → 「已花 ¥1,234,567 · 按当前速度月末约 **¥3,827…**」 | ① `insight.js`：`MAX_UNITS` 22→**40**、新增 `safeCutIndex`（截断点不落在数字串中间）与 `splitInsightSegments`；② `statistics-panel.wxss`：去掉 `nowrap/ellipsis`，改 `flex + flex-wrap`，新增 `.chart__insight__seg`（`flex:0 0 auto; white-space:nowrap`）；③ `.wxml`：4 条结论行由「一个 text 装整串」改为「container + 逐段 text」；④ `.js`：data 增 4 个 `*InsightSegs`，`withInsightSegs(patch)` 在两处 setData 前统一补齐 | 金额整段不拆。¥1,234,567 文案（279px）在 390px 模拟器一行放下且**无省略号**；¥12,345,678 压测**折 2 行**、4 个金额全部完整 | 单测 13.1~13.4（分段拼接可还原、每个金额完整落在同一段、截断不切断数字串 60 组滑窗、wxss/wxml/js 接线契约）；截图 `p2-4a-*` / `p2-4b-*` |
| **P2-5** 更新日志工程味 | 1.4.5「对比度 **3.52:1**，已加深到 **5.70:1**」；1.3.4「按**运行 ID** 精确删除」 | `pages/release-notes/release-notes.js` L22 / L99 改写成用户话术；全文再扫一遍确认无 `x:1` 比值、无「运行 ID」、无函数/变量/文件名 | 「浅色主题下当文字用的主色太淡、看着费力，已经整体加深到清楚可读，八种配色都够清楚」/「测试数据按批次精确清理，不会误删真实账单」 | 截图 `p2-5-light-release-notes.png`（页面实拍无 `3.52:1`）+ 探针断言（页面文本不含 `\d+:\d` 比值与「运行 ID」） |

> ⛔ 1.1.0 的「原子写入」属历史条目，**未动**。

### 11.2 P2-4 折行方案：为什么用「segments + flex-wrap」而不是 `keep-all / break-word`

- **`word-break: keep-all` + `overflow-wrap: break-word`（任务里建议的第一种）→ 不采用**：`break-word` 的定义就是「整词放不下时允许在任意位置断」，它在 Skyline 下没有任何机制保证不切数字；而单用 `keep-all` 又会让超长内容溢出容器（Skyline 对 `overflow` 裁剪支持与 WebView 不一致）。两个都不够硬。
- **实际采用：容器 `flex + flex-wrap`，段内 `white-space: nowrap`**。文案在 JS 里按空格切段（`splitInsightSegments`），每段一个 `<text class="chart__insight__seg">`，`flex: 0 0 auto; white-space: nowrap`。段是布局的**原子单位** → 渲染层只能在段与段之间换行，**金额物理上不可能被切开**，不依赖任何字体断行规则（换字体 / 换字号 / 换渲染器都不变）。
- **证明**（真机模拟器实拍）：`p2-4b-dark-wrap-stress.png` 里 `¥12,345,678`、`¥38,271,581`、`¥411,522`、`¥1,234,567` 四个金额各自完整落在同一行，无 `…`；元素实测高 **30px = 2 × 15px 行高**（automator 量的是真实节点尺寸，不是估算）。
- **行数口径说明（如实）**：390px 模拟器下 `¥1,234,567` 那句只有 279px < 332px 内容区，所以**实测 1 行**——原来的 `…` 是被 `MAX_UNITS=22` 的估宽截断砍掉的，不是物理溢出。折行能力由 12 位金额的压测场景证明（2 行）。窄屏（360px 内容区 306px、320px 内容区 272px）下同样不会切数字，走的是同一条 flex 换行路径。
- **已知小瑕疵**：折行时 `·` 会留在上一行行尾（见 `p2-4b` 第一行末）。比「金额被砍半截」好得多，保留不改。

### 11.3 GUI 实拍（automator + 真机模拟器，深 / 浅各一套）

探针：`artifacts/e2e/p2-probe.js`（`artifacts/` 已被 gitignore，**不进版本库**）。
安全约定：**只 setData 注入文案，不写账本分片、不改设置**，跑完 `loadMonth()` 复原；文案本身由 Node 侧调用同一批纯函数生成（`elapsedDays` / 金额由入参指定，其余全走生产代码）。

| 场景 | 文件 |
| --- | --- |
| P2-1 月初（`elapsedDays=1`）| `artifacts/e2e/p2/2026-11-11T01-57-50-329Z/p2-1-{dark,light}-month-start.png` |
| P2-2 单分类 | `…/p2-2-{dark,light}-single-category.png` |
| P2-3 小额 ¥0.30 | `…/p2-3-{dark,light}-small-amount.png` |
| P2-4 大额 ¥1,234,567 | `…/p2-4a-{dark,light}-big-1234567.png` |
| P2-4 折行压测（¥12,345,678） | `…/p2-4b-{dark,light}-wrap-stress.png` |
| P2-5 更新日志 | `…/p2-5-light-release-notes.png` |

实拍结论（automator 逐条断言，26 条 **0 失败**；每张截图前都断言过 `themeClass`）：月初 1 行 4 段、单分类 1 段、小额显示 `¥0.30`、大额 1 行无省略号且两个金额完整、压测 2 行（30px）无省略号；更新日志页无 `3.52:1`、无「运行 ID」。

### 11.4 本轮改动面（与 §3 的差异）

| 文件 | 改了什么 |
| --- | --- |
| `data/statistics/insight.js` | `formatInsightYuan` 两档口径、`buildCategoryInsight` 单分类分支、`buildCumulativeInsight` 月初分支、`MAX_UNITS` 22→40、新增 `safeCutIndex` / `splitInsightSegments`、导出 `clampInsight` 与 `EARLY_MONTH_DAYS`。**`forecastCumulative` 本体零改动** |
| `components/statistics-panel/statistics-panel.wxss` | `.chart__insight` 去 `nowrap/ellipsis` 改 flex 折行；新增 `.chart__insight__seg`。**未动图表几何 / Hero 四个类** |
| `components/statistics-panel/statistics-panel.wxml` | 4 条结论行改「container + 逐段 text」 |
| `components/statistics-panel/statistics-panel.js` | data 增 4 个 `*InsightSegs`；新增 `toInsightSegs` / `INSIGHT_SEG_KEYS` / `withInsightSegs`，两处 `setData` 前统一补齐。**统计口径与环比接线未动** |
| `pages/release-notes/release-notes.js` | 两条工程味文案改写 + 1.4.6 增 1 条 P2 用户视角说明 |
| `tests/insight.test.js` | 387 → **623 断言**（P2 段 236 条） |
| `CHANGELOG.md` / `docs/HANDOFF_v1.4.6.md` | 本版条目补「修补 5 处边界」+ 本节 |
