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
| 精度 | 结论行金额一律整数元 + 千分位（`¥1,234`），**明细不给精度让步**；坐标轴缩略仍走 `formatAxisAmount` |
| 图上参考线 | **0 条**（⛔ 明令禁止：v1.4.4 刚为消除「假水平线误导」把折线截断到截止日） |
| 对比度（结论行 / 环比） | `--text-axis` 实测 **深色 7.21~7.78:1、浅色 5.53~5.76:1**（页面 / 卡片渐变两端三处候选背景），均 ≥4.5:1 |
| 单元测试 | **53/53 套件通过**；`insight.test.js` **387 断言**（含 20 条 Hero 环比接线契约） |
| 应用内更新日志 | 补 **14 个版本 / 47 条**（1.2.0~1.4.5，1.3.3 因无用户可感知变化跳过） |
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
- **长度自保**：文案按 22 字宽估宽（中文 1、数字 0.5），超了截断补 `…`，保证手机窄屏单行不折行（CSS 再叠 `nowrap + ellipsis` 做第二道保险）。
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

- `tests/insight.test.js`：**387 断言**（纯函数 12 组 + 20 条 Hero 环比接线契约）。
- `tests/stats-hero-layout.test.js`：**47 条 Hero 布局契约**全绿（一条未改）。
- `npm test`：**53/53 套件通过**。

---

## 3. 修改文件

| 分组 | 文件 | 改了什么 |
| --- | --- | --- |
| 结论行核心 | `data/statistics/insight.js`（**新增**，13.8KB） | 7 个纯函数 + 长度自保 + 无残次品保护 |
| Hero 环比上界面 | `components/statistics-panel/statistics-panel.{wxml,js,wxss}` | WXML 包 `.hero__head` + `.hero__mom`；JS 加 `momText/momDir` 与 `sumExpenseThroughDay`；WXSS 加 3 个新类（未改任何既有声明） |
| 测试 | `tests/insight.test.js`（新增接线段）、`tests/run-all.js`（注册新套件）、`tests/e2e/insight-probe.js`（GUI 实拍探针，新增） | 387 断言 / 53 套件 |
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
| `node tests/insight.test.js` | **387 passed / 0 failed** |
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
6. **`clampInsight` 是估宽截断**：中文 1 字宽、数字 0.5 字宽的估算，极端字体缩放（系统大字体）下仍可能有 ±1 字偏差，CSS `ellipsis` 兜底。

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
