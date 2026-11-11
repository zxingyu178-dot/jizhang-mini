# 更新日志（CHANGELOG）

本文件记录「随时随地大小记」（jizhang-mini）各版本的显著变更。
版本号遵循语义化版本（SemVer）；测试数量等易变信息不在此维护，以命令实际输出与对应 `docs/HANDOFF_*.md` 为准。

## [1.4.7] — 2026-11-11

记账输入链路（日常用得最多的一条路）专项体检与修复。先写探针实测，再按实测结论改；**不升级数据合同**（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1）、不引入依赖、不改统计口径、不动分类图标与图表几何。

### 体检方法（新增 `tests/e2e/input-flow-probe.js`）
只测「效率与可感知性」，不重复已有的「输入正确性」（`real-tap.js` A1~F1 已覆盖金额/备注/落库）。7 项测量：首屏保存按钮可见性、表单内容溢出量、展开分类后按钮位置与收起入口、日期行快捷入口、保存后的反馈、跨月保存的可感知性、连续记账的分类继承。视口 390×844（safeBottom 34）。

**实测结果（修复前）**：
| 项 | 实测 |
|---|---|
| 首屏保存按钮 | 可见，但内容高 598.4 / 可视 599 —— **余量 0.6px，加任何一行就溢出** |
| 展开 12 个分类 | 内容 657.1，保存按钮底边 **被推到视口外 9.7px**，「更多」消失且**无任何收起入口** |
| 日期行 | 只有 picker 一行，**没有「昨天 / 前天」快捷**（`chipsCount=0`） |
| 保存当月账单 | Sheet 关闭，**toast 为空**，用户拿不到「记上了」的确认 |
| 保存上月账单 | Hero 仍停在 11 月、列表查不到那笔 10 月的账、**toast 为空** —— 看着像没记上 |
| 重开表单 | 金额/商户/备注清空，分类回到默认（连续记账每次重选） |

### 修复
- **保存回执（P1）**：`bill-form` 的 `saved` 事件补 `ym` / `amountCents` / `dateStr`，主页面按场景回显 —— 当月「已记 ¥12.80」，跨月「已记入 10 月」。
- **跨月自动落位（P1）**：记账面板正看的月份 ≠ 账单所属月份时，保存后直接 `loadData(目标月)` 并停在那里（`refreshPanels({ accYm })` 一次到位，不先刷当前月再跳，避免中间帧闪动）。原来这笔账悄悄存进别的月份，当前列表一行不变 —— 用户会以为记账失败。
- **展开分类后保存按钮被裁（P1，根因在弹层）**：`bottom-sheet` 的面板高度**只在打开那一刻量一次**，slot 内容之后变高（5 个分类 → 12 个）不会重算，多出来的两行把按钮挤出面板。新增 `bottom-sheet.refit()`（幂等，未展示时不动），`bill-form` 在展开/收起后 `triggerEvent('resize')`，主页面 `onBillFormResize` 转调。修后展开 12 个分类**按钮底边溢出 0px**。
- **分类可收起**：展开态在「分类」标题右侧出现「收起」，一键回 5 个（收起后保存按钮立即回到首屏）。
- **日期快捷（P2）**：「昨天」「前天」两个 chip 内嵌在日期行里，**不新增行高**；改成过去日期后自动收成「今天」一个退回入口。补记昨天的账从「开 picker → 滚轮 → 确定」变成一次点击。
- **连续记账延续分类（P2）**：记住本次会话上一次保存用过的**支出**分类（只存内存、不落盘、不进数据合同）；分类被归档 / 删除则自动回退默认，不会留下指向已删除分类的空选。
- **表单纵向瘦身（P2）**：内容高 598.4 → **542.9**（省 55.5px）。两处来源 ——
  - 「计算日价」由两行卡片（66px）压成定高单行（42px）：低频附加项不再占据主流程第三位；
  - 分类格 padding 14→8rpx、图标间距 6→4rpx、名称 22→21rpx；表单行 padding 24→22rpx（行高仍 40px+、触控达标）。
  - 收益：小屏（667）需滚动的距离从 98.4px 降到 **42.9px**。

### 未做（有依据，非遗漏）
- **小屏首屏仍看不到保存按钮**：667 高设备可用内容区约 500px，表单 542.9 仍超出。继续压缩会牺牲触控尺寸与可读性，且底部裁切本身就是「可滚」提示 —— 不做。真机 iPhone SE / 8 未实测。
- **分类改 6 列以让展开态与收起态等高**：能让 12 个分类只占 2 行，但视觉变更明显（图标与字号都要缩），未取得客户确认前不动。
- **键盘遮挡**：模拟器不弹真键盘，`wx.onKeyboardHeightChange` 探针收到空数组，**遮挡未覆盖**，留待真机验收。

### 测试
- `tests/input-interaction.test.js` 105 → **138 断言**：新增 18 条静态接线契约（saved 带月份/金额、refit 复用同一套预算且未展示不动作、resize 接线、三个日期 chip 的条件渲染、收起入口、分类沿用判定）+ 15 条动态行为（日期快捷三天回退与非法入参、展开/收起各自通知重算、saved.detail 三字段、分类沿用与失效回退）。
- `npm test` **53/53 套件通过**；`npm run release:check` **FAIL 0 / WARN 0**。
- GUI 实测：`tests/e2e/input-flow-probe.js`（7 项测量）+ `tests/e2e/input-form-shots.js`（深色/浅色/编辑态/昨日态 6 帧 + 账本笔数前后一致 8→8，零残留）。

## [1.4.6] — 2026-11-11

Data Insight（图表结论行 + 同期环比），并清掉 v1.4.5 遗留的 6 项技术欠账。不升级数据合同（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1）、不引入第三方依赖、不改渲染器、**不改任何统计口径**。

### 新增（图表结论行，B-2 第二批）
- **4 张统计图标题下各加一行文字结论**：分类占比「餐饮 占 42%，是最大开销」、每日花费「日均 ¥20 · 最高 11/08 ¥127」、累计消费「已花 ¥1,234 · 按当前速度月末约 ¥3,800」、12 个月「月均 ¥1,234 · 最高 3 月 ¥5,999」。空数据**整行不渲染**，图表走既有空态。
- **月末预测（仅当月）**：`已花 ÷ 已过天数 × 当月总天数`，2 月 28 / 29 天、31 天月都算准；历史月只报日均（已完整，预测无意义）。⛔ **图上不画任何预测参考线**（改为文字表达，避免 v1.4.4 刚消除的「假水平线误导」复活）。
- **同期环比上界面**：统计页月度 Hero「本月支出」右侧显示「比上月同期多 12% / 少 8%」。**比同期不比整月**（本月 1~今天 vs 上月 1~同一天，上月不足该天数时按上月最后一天封顶）；上月同期无支出显示「上月同期无支出」，两边都为 0 则整行不出现；年度模式不显示。
- **新增 `data/statistics/insight.js`**（8 个纯函数，不 `require('wx')`、不读存储，可在 Node 单测）：金额格式见下方 P2-3（≥¥1 整数元 + 千分位，0<金额<¥1 给 2 位小数）、长度自保见 P2-4（折行为主、40 字宽兜底且不切数字）、非法入参返回 `''` 不产出 `NaN / undefined / Infinity`。
- **口径一致性**：每日结论「日均」与 Hero「日均支出」同分母（当月 = 截至今天，历史月 = 整月天数）；12 个月「月均」与 Hero「月均支出」同口径（全年 ÷ **有支出月数**，不固定 ÷12，避免同屏两个不同月均）。
- **颜色决策**：环比涨跌**统一中性色** `--text-axis`。本项目 `--expense` 是绿、`--income` 是红（与常见记账 app 相反），按「支出变多 = 警告」染红会与全项目语义撞车，按「支出 = 绿」染色又会把「花更多」染成好事 —— 两个方向都错，故宁可用中性。

### 修补（P2 边界 5 处，同版内不升版）

客户验收后一次性修掉 5 处「用户会当场指着问」的体验边界。**只改文案分支与渲染方式**：`forecastCumulative` 公式本体、统计口径、数据合同、v1.4.4 图表几何、Hero 既有样式**全部零改动**。

- **P2-1 月初预测不再被放大**：公式没错（已花 ÷ 已过 × 月长），但月初样本太小——1 号记一笔 ¥3,000 房租会推出「月末约 ¥90,000」（30 倍噪音）。当月已过天数 **≤3 天**时改出「已花 ¥3,000 · 本月才刚开始」，≥4 天恢复预测。**只加在 `buildCumulativeInsight` 的文案分支**，`forecastCumulative` 一行未改（单测仍直接验公式）。
- **P2-2 单分类不再说「是最大开销」**：只有一个非零分类时「最大」没有比较对象（`餐饮 占 100%，是最大开销`）→ 改为「本月支出全部在餐饮」；分类数 ≥2 时两档句式不变。
- **P2-3 小额不再渲染成 ¥0**：`formatInsightYuan` 改两档——≥¥1 整数元 + 千分位（`¥1,234`）；`0 < 金额 < ¥1` 保留 **2 位小数**（`¥0.30` / `¥0.01`）；0 仍是 `¥0`。修掉「仅 11/05 有支出 ¥0」这种自相矛盾的句子。
- **P2-4 大额时结论行折行、不切数字**：原 `MAX_UNITS=22` 截断 + CSS `nowrap/ellipsis` 会把 `¥1,234,567 · 按当前速度月末约 ¥3,827,000` 切成 `…¥3,827…`。改为：**容器 `flex-wrap` + 逐段 `nowrap`**（wxml 按空格切段渲染，段是原子的），渲染层只能在段间换行，金额物理上不可能被切开；纯函数兜底上限放宽到 40 字宽，且**截断点绝不落在数字中间**。
- **P2-5 更新日志去工程味**：1.4.5 的「对比度 3.52:1，已加深到 5.70:1」→「浅色下当文字用的主色太淡、看着费力，已经整体加深到清楚可读」；1.3.4 的「按运行 ID 精确删除」→「按批次精确清理」。全文不再出现 `x:1` 比值与「运行 ID」。（1.1.0「原子写入」属历史条目，本轮未动。）
- 顺手把 P2 里用户可感知的 3 条（月初不夸大、小额显示小数、大额折行）合并成更新日志 1.4.6 的 1 条用户视角说明。

### 清理（v1.4.5 遗留 6 项技术欠账）
- **应用内更新日志补齐**：`release-notes` 的 `RELEASES` 原来停在 1.1.0，补 1.2.0~1.4.5 共 **14 个版本 / 47 条**用户视角文案（1.3.3 无用户可感知变化，跳过不编）。
- **基础库版本固定**：`project.config.json` 的 `libVersion` 由 `latest` 固定为 **3.17.4**（取本地实际调试版本），`release:check` 首次 **WARN 0**。
- **主题色顺序单一来源**：外观页 `ACCENT_ORDER` 由写死数组改为 `Object.keys(theme.ACCENTS)`，顺序实测与改造前完全一致，将来加第 5 套色不会漏改错位。
- **`reports/` 进 `.gitignore`**：上传 / 审计产物不再污染工作区。
- **历史交付包归档**：仓库根目录 10 个 ZIP（约 86.2 MiB）移入 `artifacts/releases/` 并附 `MANIFEST.md`（逐包字节数 / 修改时间 / 用途），**内容零改动**；`artifacts/` 既不进版本库也不进小程序包。
- 删除 4 个空 pip 残留目录（未被跟踪，工作区清理）。

### 测试
- `npm test` **53/53 套件通过**；`tests/insight.test.js` **623 断言**（含 20 条 Hero 环比接线契约 + 236 条 P2 修补契约：月初不预测、单分类文案、小额 2 位小数、截断不切数字、折行分段接线）；`tests/stats-hero-layout.test.js` 47 条 Hero 布局契约全绿（**一条未改**，Hero 既有 4 个类样式零改动）。
- `npm run release:check` **FAIL 0 / WARN 0**；结论行 / 环比颜色 `--text-axis` 实测深色 **7.21~7.78:1**、浅色 **5.53~5.76:1**（三处候选背景），均 ≥4.5:1。
- 真机 iPhone / Android 未测试。

### 冻结项
- 统计口径、数据合同（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1）、`--expense` / `--income` 语义色、v1.4.4 图表几何（刻度 / 网格 / 柱高比例尺 / 截止日截断 / Y 轴留白 / X 标签抽稀）**全部零改动**；不新增依赖、不更换渲染器。

## [1.4.5] — 2026-11-10

Theme Accent（主题配色扩展）。**只换强调色、不动骨架**：新增 4 套主题色 × 深 / 浅共 8 组，同步修掉 3 个存量对比度 / 硬编码缺陷。不新增业务功能、不升级数据合同（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1）、不引入第三方依赖、不改渲染器。

### 新增（4 套主题色 × 深 / 浅）
- **外观页新增「主题色」四选一**：靛蓝（缺省）/ 青竹 / 琥珀 / 玫红，点击即时生效，无需保存按钮；只改主题 class，不 reLaunch、不重置数据、不丢页面状态。
- **存储**：新增 `settings.accent`（`indigo` / `teal` / `amber` / `rose`）。老用户无该字段 → 归一 `indigo`，**升级后颜色零变化**；非法值（`undefined` / `null` / `'blue'` / `123`）一律归一 `indigo`，不崩。
- **CSS**：`app.wxss` 新增 8 组 `.theme-x.accent-y` 覆盖块（必须双类组合，单写 `.accent-y` 会同时盖掉深色与浅色），每组覆盖 `--primary` / `--primary-deep` / `--primary-text` / `--on-primary` / `--button-primary-text` / `--glow-*` / `--hero-bg`。
- **接线**：14 个页面根容器挂 `accentClass`（与 `themeClass` 并列），`utils/theme.js` 新增 `ACCENTS` / `VALID_ACCENTS` / `getAccent` / `getAccentClass` / `getAccentPalette` / `setAccent`，`reloadFromStorage` 一并重读 accent（备份恢复后主题色立即生效）。

### 修复（3 个存量缺陷）
1. **浅色主题主色当文字偏淡**：`color: var(--primary)` 16 处实测 **3.52:1**（正文标准 4.5）→ 新增 `--primary-text` 专用文字色，浅色靛蓝改用 `#4b55cf` = **5.70:1**，8 组全部 ≥4.5:1。`--primary` 降级为只管图形 / 边框 / 填充（≥3:1 即可）。
2. **深色主题按钮白字偏淡**：白字压 `#7c86ff` = **3.13:1** → 新增 `--on-primary`，深色下压亮主色必须配深墨字（靛蓝 `#0b0d16` = **6.19:1**，青竹 / 琥珀 / 玫红同理），浅色下仍用白字。**绝不写死白色**。
3. **6 处 JS 硬编码主色，不跟主题走**：`components/category-icon/category-icon.js`、`components/icon/icon.js`、`components/daily-value-curve/daily-value-curve.js`（4 处折线色）、`data/statistics/cumulative.js` 的 `LINE_COLOR` → 改为运行时从 `theme.getAccentPalette().primary` 取（保留原靛蓝值仅作异常兜底，不抛错）。原「换主题后图标高亮 / 首页日价曲线 / 统计累计折线还是靛蓝」的半变色问题消失。

### 顺带
- `scripts/theme-audit.js` 品牌色白名单不再写死 4 个 hex，改为按主题读（否则加主题后必然误报）。
- 外观页色卡色值改为从 `utils/theme.js` 的 `ACCENTS[x].dark.primary` 取（单一来源，不再两处维护同一批 hex）；色卡选中勾仍统一深墨 `#0b0d16`（白勾压亮主色只有 2.0~2.2）。

### 背景染色（客户已确认保留）
- 只动 `--glow-*` 让背景光晕跟着主题色相走；`--bg` / `--card-bg` / `--surface` **未动**，玻璃层次不变。

### 测试
- `npm test` **52/52 套件通过**；`tests/theme.test.js` 扩到 **285 断言**（4 套 × 深 / 浅全组合对比度闸门、归一化 fail-safe、双类组合覆盖块完整性、页面接线）。
- `npm run theme:audit` FAIL 0；`npm run contrast:audit` 通过；`npm run release:check` FAIL 0 / WARN 1（`libVersion=latest` 既有）。
- 真机 iPhone / Android 未测试。

### 冻结项
- `--expense` / `--income` / `--budget-*` 语义色零改动；数据合同、统计口径零改动；不新增依赖、不更换渲染器；微信上传 / 审核 / 发布由交付岗执行。

## [1.4.4] — 2026-11-10

Chart Readability & Axis Polish（统计页图表可读性收尾）。不新增业务功能、不升级数据合同（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1）、不引入第三方依赖、不改渲染器与视觉体系。

### 坐标轴（从「没有轴」到「读得出数」）
- **补齐横纵坐标轴**：每日花费趋势 / 年度月份趋势加 Y 轴 3 档金额刻度（0 / ½顶档 / 顶档）+ 网格线；累计消费趋势加 Y 轴刻度 + X 轴日期。刻度文字**不画进 SVG**（`<image>` 走图片管线，SVG `<text>` 字体与基线在系统字体缩放下不可控），改为原生 `<text>` 绝对定位叠加，与网格线共用同一套 `computeGeometry / tickY / xAt` 数学。
- **顶档取整改为 nice number**（1/1.5/2/2.5/3/4/5/6/8/10 × 10ⁿ）：`max=127 元 → 顶档 ¥150 / 中档 75`，`max=5999 元 → ¥6000 / 3000`，不再出现 `63 / 301 / 1235` 这种要心算的刻度。
- **刻度对比度**：新增 `--text-axis`（深色 `rgba(255,255,255,0.62)` / 浅色 `rgba(32,35,52,0.70)`）。实测：深色 **7.23:1**、浅色 **5.74:1**；原 `--text-faint` 为深色 3.80:1 / 浅色 **2.41:1**（不达 AA）。全局 `--text-faint` / `--divider` 未动。

### 累计消费趋势
- **只画到「数据截止日」**：整月 30 个点全画会让 11/10 之后沿最后值平到月末，视觉上等于「10 号以后一分钱没花」。现按截止日裁剪 + 末端实心圆点标「数据到此为止」，横轴仍按整月跨度定位（右侧留空）。
- **X 轴日期标签按宽度自适应**：原固定「首/中/末」3 个，现按**实际绘图宽度**定档，375px 下 **5 个**（390/375/360 三档实测均 5 个，最小间距 64~69px ≫ 标签宽 29~31.9px，不重叠）；首末必在，**末标签 = 数据截止日**（不是月末），格式仍为 `M/DD`。当月视图受「折线只占左侧一段」限制为 3 个（物理放不下 4 个，见 HANDOFF §6）。

### 其它可读性
- **空态口径统一**：整月 / 整年 0 支出不画空图，统一文案「本月还没有支出」；`max=0` 时刻度只留底线 `0`（不再出现「¥0 在顶部、0 值线在底部」的自相矛盾画面）。
- **柱体发光去掉**：原 `box-shadow: 0 0 12rpx` 光晕在 13 根柱、柱距 4.5px 的图上把整片糊成紫雾（柱外 1px 与底色 Δ=18），肉眼数不清几根柱 → 改为 `box-shadow: none`，柱与网格线靠渐变本体区分。
- **12 个月标签全保真**：360/375/414/427 四档宽度下 12 个标签全部保留且互不重叠（契约测试钉死，不允许抽稀）。
- **每日花费趋势 Y 轴留白与累计图共用**：同列两张图左边界对齐（各算各的会差 7px）。

### 不做（核实后放弃）
- **0 值柱子加 2rpx 基线**：核实四个入口（`bill-form` 的 `canSubmit`、导入 `validator` 的 `amountCents <= 0`、三个导入适配器的 `if (!amountCents)`、旧数据迁移）后确认**正常业务不存在 0 元支出**；而每日趋势按天全量铺点，没花钱的日子柱高 0 正是正确表达，加基线会让「没花钱」显示成「花了一点钱」→ 制造误导，不做。

### 测试
- `npm test` **52/52 套件通过**；`tests/chart-axis.test.js` 单文件断言 **960 → 994 条**（含 1 068 组「宽度 × 字号 × 跨度 × 天数」不重叠扫描 + 组件接线测试）。
- `npm run perf` 1k 2ms / 5k 9ms / 10k 21ms，10k÷1k = **10.5x**（≤40x）。
- `contrast:audit` dark worst 3.145 / light worst 3.249（≥3:1）；`theme:audit` 违规 0；`release:check` **FAIL 0 / WARN 1**（`libVersion=latest`，客户已定不动）。
- 真机 iPhone / Android 未测试。

### 冻结项
- 数据合同、统计口径零改动；不新增依赖、不更换渲染器、不改全局文字层级色；微信上传 / 审核 / 发布由交付岗执行。

## [1.4.3] — 2026-11-10

Real Tap E2E & Form Usability & Narrow-Screen Fit（真实点击测试 + 记账表单可用性 + 统计 Hero 窄屏适配）。不新增业务功能、不升级数据合同（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1）、不引入第三方依赖、不改渲染器与视觉体系。

### 测试真实性：补上「真实用户操作」缺口
- **新增 `tests/e2e/real-tap.js`（928 行，14 条用例）**：原 E2E 虽 31 项，但金额 / 备注都是直接调页面函数赋值、**绕过键盘**，全库真实键盘输入只有 2 次且都在周期页。新套件改用**真实点按 29 次 + 真实键盘输入 23 次**，覆盖：
  - 金额逐字输入 `1→12→123→1234→1234.→1234.5→1234.56`，落库 123456 分；
  - 金额边界：`.` / `0` / `00` / `1.999`（截成 1.99）/ `999999999` / 留空，均不写脏数据；
  - 备注：中文 + 字母数字、63 字超长截断到 40、emoji / 空格 / 尖括号 / 全角标点 / 换行不被破坏；
  - 分类查找：点「更多」6 格 → 12 格、逐个点选 `categoryId` 正确切换、选中态唯一、几何实测底部分类不被裁掉；
  - 收支切换：切收入时「计算日价」开关消失、切回恢复；支出 / 收入各存一单，`type` 与 Hero 汇总分别正确；
  - 真实点保存进时间线且不重复写；金额输入聚焦后输入框与保存按钮仍在可视区。
- 跑法：`node tests/e2e/real-tap.js`（需非沙箱环境）。本轮实测 **14/14 通过**。

### 记账表单可用性
- **空金额点保存有提示**：原来静默 `return`，用户以为按钮坏了。现弹「请先填写金额」+ **1.2 秒节流**（连点 5 次只弹 1 条）；按钮灰态判断逻辑未动。
- **备注 40 字上限**：原来 63 字原样落库，与周期页口径不一致。现 `bill-form.wxml` 加 `maxlength="40"` + `bill-form.js` 代码兜底截断两层，含 **emoji 半字保护**（不切半个代理对）。

### 统计 Hero 窄屏适配（渲染层事实修正）
- **`@media` 宽度断点在 Skyline 下不生效**：全项目唯一一处宽度断点 `@media (max-width: 360px)` 在 Skyline 渲染下大概率不生效（官方文档：Skyline 的 media queries 只支持 DarkMode），等于写在库里没生效。改为**启动时读屏宽、≤360px 挂窄屏类名**，窗口变化时跟随已有监听更新；原 `@media` 块删净，**全项目宽度断点清零**。
- **390px 实测证据**：正常态类名无 `narrow`、三列宽 91.1 / 145.6 / 91.1；强制挂类后中间列变 **150.6**、文本高 **20 → 17** —— 证明类切换在 Skyline 下真的生效。
- **契约测试加强**：`tests/stats-hero-layout.test.js` 断言 3 → **47** 条，新增「宽度媒体查询必须为零」「窄屏规则必须写在基础规则之后」等硬约束；并做**变异测试**（改回 26rpx / 删类绑定 / 判定写死 false / 偷改阈值）**四种破坏全部被抓**。

### 测试
- `npm test` **51/51 套件通过**。
- `npm run e2e` **31/31 通过**（含 T31 统计 Hero 长日期 + 长金额三列单行完整）。
- `node tests/e2e/real-tap.js` **14/14 通过**。
- 专项：`quarantine-rollback` 279 项、`import-rollback-safety` 54 项、`dedupe-index` 54 项、`import-e2e-safety` 48 项、`backup-restore-statistics` 44 项、`recovery-ui-guard` 28 项，全部通过。
- 大账本性能 1k 2ms / 5k 7ms / 10k 13ms，10k÷1k = **6.5x**（期望 ≤40x）。
- `theme:audit` FAIL 0（3 项既有 WARN）；`contrast:audit` worst ≥ 3:1（dark 3.145 / light 3.249）；`release:check` **FAIL 0 / WARN 1**（`libVersion=latest`，客户已定不动）。
- 真机 iPhone / Android 未测试，见 `docs/10_DEVICE_ACCEPTANCE.md`（本轮新增必查：**键盘弹起是否遮挡输入框** —— 模拟器测不出）。

### 冻结项
- 数据合同与业务规则零改动；不新增依赖、不更换渲染器；`project.config.json` 的 `libVersion` 不动；微信上传 / 审核 / 发布未执行。

## [1.4.2] — 2026-11-09

Recovery Integrity & Import Match Safety（恢复完整性与导入匹配安全）。不新增业务功能、不升级数据合同（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1）、不引入第三方依赖、不改渲染器与视觉体系。

### 数据恢复完整性
- **删除失败不再被忽略（P0）**：新增 `fs.removeStrict()`，unlink 失败 / 删除后文件仍存在 / 无法确认删除一律 `FILE_DELETE_FAILED`；新增 `ledger.removeMonthFileStrict()`。恢复 / 回滚改为「只删除目标月份之外的分片 + 目标月份原子覆盖」，从结构上消除「旧账单未删 + 新账单叠加」。
- **安全点完整校验（P0）**：回滚删除任何文件之前校验 envelope、`bills` 数组、账单对象与 ID、重复 ID、`categories`、`settings`、`recurringRules` 与语义校验；不合格抛 `ROLLBACK_SAFETY_INVALID`，JSON 损坏抛 `ROLLBACK_SAFETY_UNAVAILABLE`，均保留现场与安全点。
- **恢复 / 回滚后精确对账（P0）**：严格回读全部月份，比较数量、ID 集合、关键字段签名与重复 ID；不一致抛 `RESTORE_INTEGRITY_FAILED` / `ROLLBACK_INTEGRITY_FAILED`，并记录 missing / extra / mismatched / duplicate 计数。
- **元数据核对**：恢复 / 回滚后校验分类、设置、周期规则的结构与条数。
- **回滚失败明确报告（P1）**：回滚写入失败时 `rollbackCompleted=false`，附 `rollbackError.code`，安全点保留，不再谎报成功。
- **恢复失败提示分级（P1）**：预览页按 `mutationStarted / rollbackAttempted / rollbackCompleted` 显示「原账本未修改 / 已恢复到操作前状态 / 恢复未完成 / 无法确认」，回滚失败展示错误码并阻止再次提交。

### 导入匹配安全
- **CSV 索引组合键碰撞修复（P1）**：`categoryId` / `note` 可能包含 `|`，原拼接键会让 `cat|x + memo` 与 `cat + x|memo` 误判为同一笔。改为 `JSON.stringify([...])` 无歧义编码，新增碰撞、引号、反斜杠与随机差分测试。
- **E2E 临时文件路径加固（P2）**：只取 basename、固定 `USER_DATA_PATH/__e2e_import__/`、自动生成文件名、扩展名白名单，解析后清理；杜绝 `../` 路径穿越。

### Final Stabilization（发布前最后一轮）
- **导入回滚不再覆盖原始安全点（P1）**：普通导入失败时，内部救命回滚使用独立临时安全点 `legacy/import-rollback-safety-<batchId>.json`；原始安全点保持导入前状态。回滚成功清理临时安全点，回滚失败两套安全点都保留。
- **对账字段补全（P2）**：`billSignature` 增加 `source / importBatchId / createdAt / updatedAt`。
- **元数据精确核对（P2）**：分类、设置、周期规则改为严格读取 + 规范化后内容比对；周期文件损坏即使预期 0 条也会被发现。
- **严格删除 ENOENT 边界（P2）**：ENOENT 后再次确认文件不存在，文件仍在则 `FILE_DELETE_FAILED`。
- **疑似重复按钮计数（P2）**：按钮显示 `ready + (includeSuspect ? suspect : 0)`，勾选后数字同步变化。
- 测试：`npm test` **50/50**；E2E **31/31**（新增疑似重复计数断言）；`quarantine-rollback` 190 项、`import-rollback-safety` 22 项。

### 测试
- `npm test` **50/50 套件通过**（新增 `recovery-ui-guard`、`import-rollback-safety`；`quarantine-rollback` 190 项，`dedupe-index` 54 项，`import-e2e-safety` 48 项）。
- `npm run e2e` **31/31 通过**。
- 性能（3 轮 × 5 次中位）：30,000 笔 + 3,000 行预览 **111.6 ms**（基线 1,618.2 ms，14.5×）；15,000 档 70.4 ms；5,000 档 31.8 ms。
- `theme:audit` / `contrast:audit` / `release:check` 通过。
- 真机 iPhone / Android 未测试，见 `docs/10_DEVICE_ACCEPTANCE.md`。

### 冻结项
- 数据合同与业务规则零改动；不新增依赖、不更换渲染器；微信上传 / 审核 / 发布未执行。

## [1.4.1] — 2026-11-09

Data Safety & Import Reliability（数据安全与导入可靠性）。不新增业务功能、不升级数据合同（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1）、不引入第三方依赖、不改渲染器与紫黑毛玻璃视觉体系。

### 数据安全
- **隔离失败即中止（fail-closed）**：`data/quarantine.js` 由「失败降级」改为结构化结果 `safeToProceed`。目录创建失败、任一文件复制失败、回读字节不一致、`meta.json` 写入失败任一发生，调用方（恢复 / 回滚）立即中止，**不再删除任何原始损坏分片**。
- **原始字节逐字节校验**：每个隔离文件写入后立即回读，用 `sameBytes()` 逐字节比较，不允许只比文件大小；`meta.json` 增加 `complete` / `verified`。
- **恢复状态机**：恢复顺序改为「校验 → 删前隔离 → 安全点 → 修改」。隔离未完成抛 `QUARANTINE_INCOMPLETE`（不写安全点、不删除、不回滚）；安全点失败抛 `SAFETY_POINT_FAILED`（现有账本完全不变）；中途失败按安全点回滚，错误对象带 `mutationStarted / rollbackAttempted / rollbackCompleted`。
- **回滚 fail-closed**：安全点不可读抛 `ROLLBACK_SAFETY_UNAVAILABLE`；回滚前隔离未完成抛 `ROLLBACK_QUARANTINE_INCOMPLETE`，不删除安全点、不谎报成功。导入失败后的救命回滚同样不再静默吞异常。

### 导入性能
- **去重索引**：疑似重复按 `type + amountCents + 5 分钟时间桶` 建多级 Map，只检查当前桶与前后各一桶；CSV 日价补全按 `type/amount/category/note/分钟` 建索引。索引只缩小候选集，最终仍执行原精确判断，`suspect` 不自动删除 / 合并，`zero/one/many` 语义不变。
- **结果**：3,000 行导入预览 + 30,000 笔账本，中位耗时 **1,618 ms → 96.7 ms**（16.7×）；5,000 档 8.0×、15,000 档 6.7×。新旧算法在 17 类固定场景 + 30 组固定种子随机差分 + 极端分布下结果完全一致。

### 导入流程
- 新增 develop-only 文本注入入口 `__e2eImportText`（`env.isDevEnv()` 同步前置守卫、无 UI 暴露、不注册 app.json、解析后删除临时文件），用于自动化「预览 → 取消 → 确认 → 重复导入 → 回读」。
- E2E 新增 T28（完整导入）、T29（跨来源疑似重复需确认）、T30（非法内容 / 压缩包不写账本）。
- **E2E 截图非破坏化**：每轮写入 `artifacts/e2e/<runId>/`，不再清空或覆盖 `docs/screenshots/e2e/` 历史基线；`artifacts/` 已加入 `.gitignore`。

### UI 与 SVG
- 其他 SVG 组件（category-icon / icon / cumulative-trend）逐项审计：深 / 浅主题、颜色格式、根节点、data-URI、Skyline 实际显示均正常；不盲目替换 rgba，圆环 `hslToHex` 修复保持。
- 统计 Hero 三列：中间列弹性提升到 1.6（≤360px 1.7）、数值 `nowrap`、窄屏字号 22rpx，保证「日期 + 长金额」单行完整展示、不溢出、不截断。

### 测试
- `npm test` **48/48 套件通过**（新增 `dedupe-index`、`import-e2e-safety`、`svg-compat`、`stats-hero-layout`）。
- `npm run e2e` **31/31 通过**（新增 T28–T31）；`cumulative-view` 6/6 通过。
- `npm run theme:audit`、`npm run contrast:audit`、`npm run release:check` 通过。
- 真机 iPhone / Android 验收由用户按 `docs/10_DEVICE_ACCEPTANCE.md` 执行，未测项明确标注。

### 冻结项
- 数据合同与业务规则零改动：Bill V3、Backup V3、Recurring Store V1、Budget V1；账单 ID、金额精度、日期格式、分类引用、历史结构均未改；不新增依赖、不更换渲染器。

## [1.4.0] — 2026-11-04

Final Stabilization（最终稳定性收口）。不新增业务功能、不升级数据合同（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1）、不引入第三方依赖、不改渲染器（Skyline + glass-easel 原样）。两条主修：**统计圆环在 Skyline 下不显示**（P0）与**弹层内容超高时滚不动**（P1）。

### 修复
- **统计圆环在 Skyline 下不可见（P0，主修）**：根因是 SVG 里的 `hsl()` 颜色会让 Skyline 把对应的 `<circle>` 整条丢弃。对照实验 A–M 每步只改一个变量，同一份 SVG 只把颜色从 hex 换成 `hsl()`，画面由「完整彩色圆环」变成「全空白」；而 `imgStatus` 仍是 `load`、无报错，所以现场表现为「控制台干净、画面只剩灰环」。修复：SVG 属性用色一律走 `#RRGGBB`（`data/statistics/donut.js` 新增 `hslToHex()` / `parseSvgColor()` / `svgColor()`），轨道透明度拆成 `stroke-opacity`，根节点补 `width` / `height` / `preserveAspectRatio`。对外颜色合同不变（`getCategoryColor()` 仍返回 `hsl()`），图例、面板与对比度审计口径一行未动。
- **圆环脏数据防护**：`buildDonutArcs()` 对 ratio 加 `Number.isFinite` + `> 0` + `Math.min(1)` 钳制，`rest` 与 offset 全部防非有限值 —— 一条 NaN 弧线会让整个圆环消失且现场极难定位。
- **弹层内容超高时既不滚也不裁、底部按钮不可达（UI-01，P1，主修）**：Skyline WXSS 不支持 `overflow: scroll`，原 `view` + `overflow-y: auto` 在内容超高时整块溢出面板。修复：内容区改 `scroll-view` + JS 高度预算（新增 `utils/sheet-scroll.js`），装得下时高度 = 内容高（观感与改造前逐像素一致），装不下时 = 可用空间（保存 / 确认按钮可滚到）；量不到视口高度时退回「不做高度干预」的既有行为，**绝不把面板压成 0 高**。
- **四处保存入口统一防连点锁（P1）**：记账、日价、周期三处保存原先没有防连点锁，连点两次 = 写两条脏数据。新增 `utils/submit-guard.js`，四处保存入口（含预算设置）统一走同一把锁。
- **周期间隔逐键钳制时机（P2）**：改为失焦 / 提交时钳制，输入过程中不再边打边夹数字。
- **「完成」按钮热区（P2）**：金额输入的页面内「完成」按钮热区放大，避免点不中。
- **安卓键盘收起后页面高度不回落（C7/P2）**：搜索页与预算设置页补订阅 viewport 恢复，与其他页面口径一致。
- **分类管理底部安全区（UI-03/P2）**：列表滚到底留白 4.2px → 38.2px，不再贴住 Home 指示条。

### 数据安全
- **回滚前隔离转存不可解析分片（QA-01）**：存储完整性检查命中不可解析分片时，先在回滚 / 修复前把原始内容隔离转存，再执行修复，避免「修坏了连证据一起丢」。转存与清理均带 try/finally 与失败标记。

### 性能
- 与 v1.3.6 逐项交错对照（同机 3 轮交错取样，规避先后顺序造成的系统性偏差）：**无退化**，所有差异落在本机抖动带内，且两版在测得的关键路径上代码几乎完全相同。
- 圆环 SVG 只换了颜色字面量与根节点属性，未增加分段数、未引入逐帧计算；弹层高度预算每次打开只算一次纯算术，不监听滚动。

### 测试
- 新增测试套件：`donut-render`（圆环 SVG 合同与脏数据钳制）、`sheet-scroll`（五档屏幕高度预算）、`submit-guard`（防连点锁）、`gate4-gap`（Gate4 回归补齐）、`quarantine-rollback`（隔离转存）；`ui-layout` / `keyboard-viewport` / `statistics` 扩充。`npm test` 44/44 套件全绿。
- E2E 27/27 通过，含 T20–T24 圆环真实触摸与钻取 / 「其他」聚合 / 切主题状态保持，T25 布局，T26 金额「完成」，T27 搜索 confirm。
- `theme:audit`、`contrast:audit`（dark worst 3.145 / light worst 3.249，均 ≥ 3:1，与修复前数值一致）、`release:check` 0 FAIL。
- 模拟器截图：圆环修复前后对照、深 / 浅主题、主要页面与弹层；**真机 iPhone / Android 验收由用户按交付包 `10_DEVICE_ACCEPTANCE.md` 执行**，未测项在交付文档中明确标注。

### 冻结项
- 数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1 均不升级；金额 / 日价 / 预算 / 周期计算与生成规则、CSV 导入、备份格式、主题系统、统计算法、Bottom Sheet 动画机制均未改动；不新增依赖，不新增业务功能。
- 渲染器保持 `skyline` + `glass-easel`，基础库 3.17.4，未做降级回退。

## [1.3.6] — 2026-11-04

Keyboard & Input Reliability（输入交互可靠性）。不新增业务功能、不升级数据合同（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1）、不引入第三方依赖，只统一所有输入框的收键盘方式，解决 iPhone 微信小程序「金额输完后数字键盘无法主动收起」的痛点。

### 修复
- **数字键盘可主动收起**：记账 / 日价 / 周期 / 预算四个金额输入框在输入行内新增独立「完成」按钮（`type="digit"` 保持不变），点击后先释放 focus 再由 `utils/keyboard.js` 统一收键盘，不依赖系统键盘的「完成」键。
- **完成不丢值、不误操作**：完成按钮只收键盘，不同步保存、不关闭 Bottom Sheet、不触发提交；金额与 `canSubmit` 状态原样保留，再次点击金额可重新聚焦。
- **文本输入走系统确认键**：商户 / 备注 / 日价名称 / 周期备注 / 分类名称与 Emoji 使用 `confirm-type="done"` + `bindconfirm`；搜索使用 `confirm-type="search"` + `bindconfirm`，确认后清掉防抖定时器、立即筛选并收键盘。
- **失焦不再主动收键盘**：`bindblur` 只同步值与焦点状态，允许金额 → 商户 → 备注自然连续填写。
- **弹窗前先收键盘**：删除账单、删除周期规则、周期补记确认统一先 `hideKeyboard()` 再 `wx.showModal`；取消后表单保持打开。
- **Header 返回分层**：键盘打开时第一次返回只收键盘，第二次才 `navigateBack` / `reLaunch`；无键盘时保持原行为与 `_backing` 防连点。
- **公共能力**：`utils/keyboard.js` 新增 `releaseInputFocus(component, focusKey, fallbackMs)`；`utils/viewport.js` 新增只读 `isKeyboardOpen()`，复用既有 `lastKeyboardHeight`，未新增第二套键盘高度监听。

### 测试
- 新增 `tests/input-interaction.test.js`：静态接线契约（13 个输入、无 textarea、金额未改成 text、完成按钮 / confirm 接线）+ 动态行为（完成保留值、失焦不收键盘、金额与间隔独立焦点、删除弹窗顺序、搜索 confirm），纳入 `npm test`（39 套件）。
- 扩展 `tests/keyboard-viewport.test.js`：`releaseInputFocus` 顺序与兜底、连续完成、`isKeyboardOpen` 状态切换。
- E2E 新增 T26（金额完成 → 继续填商户/备注 → 保存 → 回读 → 清理）与 T27（搜索 confirm 立即筛选），E2E 27/27 通过。
- `release:check`、`theme:audit`、`contrast:audit` 通过。
- 模拟器深浅主题 / 窄屏截图复核；真机 iPhone / Android 验收由用户执行，未测试项明确标注。

### 冻结项
- 数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1 均不升级；金额 / 日价 / 预算 / 周期计算与生成规则、CSV 导入、备份格式、主题系统、统计算法、Bottom Sheet 动画机制均未改动；不新增依赖。

## [1.3.5] — 2026-11-03

Mobile UI Compatibility（移动端布局兼容与视觉收口）。不新增业务功能、不升级数据合同（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1）、不引入第三方依赖，只解决不同手机宽度、系统字体与原生输入控件造成的 Header、输入框与弹层布局问题。

### 修复
- **主 Header 响应式收口**：品牌标题单行省略、搜索胶囊明确最小宽度、搜索图标与文案禁止收缩、设置按钮固定尺寸；按「屏幕宽度 − 微信胶囊占位（menuPad）」计算 `headerCompact`，320 / 360 窄屏自动切换紧凑字号与间距，375 / 390 / 414 保持原视觉。渲染后再用尺寸查询兜底，防止系统字体放大把标题或「搜索账单」换成两行。
- **二级页 Header 胶囊避让**：`page-header` 与主 Header 同口径计算 menuPad 并注入 `padding-right`，搜索页输入框、标题不再伸到微信右上角胶囊下方。
- **搜索页输入框**：显式 `box-sizing: border-box` + 72rpx 高度 / 行高，输入文字垂直居中；窄屏占位文案自动缩短为「搜商户/备注/分类/金额」，不再被输入框裁成半句。
- **输入框三类规格统一**：普通输入（商户 / 备注 / 名称）60rpx 高 + 同值行高；紧凑输入（周期间隔 / Emoji）64rpx；大金额（记账 / 日价 / 周期）100rpx，均显式 `box-sizing` 与 `min-width: 0`，避免原生 input baseline 差异导致文字偏移或裁切。预算金额保留 80rpx / 52rpx 原设计。
- **分类网格与分类管理**：日价分类名与记账分类名统一单行省略，分类格子不再被 8 字名称撑高；分类编辑器增加与记账 / 日价一致的左右内边距，Emoji 输入框不再贴屏幕边缘。
- **周期编辑器**：金额 / 间隔 / 备注三类输入统一高度与行高，编辑器补左右内边距，日期 / 时间行不再贴边。
- **导入 / 预览 / 结果 / 备份**：长文件名单行省略、统计数字与金额禁止收缩、窄屏双按钮单行省略；结果页与导入 / 备份底部补 `env(safe-area-inset-bottom)`。
- **统计页**：月份标题单行省略、月份箭头 / 占比 / 金额列禁止收缩，避免窄屏横向挤压。

### 测试
- 新增 `tests/ui-layout.test.js`（76 项静态布局契约），纳入 `npm test`（38 套件）。
- E2E 新增 T25：在真实模拟器断言主标题与「搜索账单」单行、设置按钮不进入胶囊、搜索胶囊保留最小宽度、搜索页输入框不压胶囊；E2E 25/25 通过。
- 320 / 360 / 375 / 414 四档宽度模拟器截图与 DOM 尺寸记录；深浅主题、输入框、弹层、分类网格、导入长文件名均在窄屏复核。

### 冻结项
- 数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1 均不升级；不新增依赖、不新增业务功能、不改变紫黑毛玻璃视觉主题。

## [1.3.4] — 2026-10-30

Review Fix & Final Reliability Closure（独立代码审查修复与最终可靠性收口）。针对 v1.3.3 交付后的独立审查所指出的 2 个 P1、3 个 P2 实现问题逐项核实并修复，不新增业务功能、不升级数据合同（Bill/Backup V3 等）、不引入第三方依赖、不重写统计模块。审查暂定名 v1.3.3.1，因现有工具链强制三段式语义化版本（npm semver 不接受四段纯数字），定名 1.3.4。

### 修复
- **切主题不再重置统计页状态（P1）**：`statistics-panel` 主题回调原先调用完整 `refresh()`，经 `loadMonth`/`loadYear` 重新读取账本、重算并重置 `shareExpanded`/`shareSelectedId`（年度对应字段）。现改为新增的 `recolorForTheme()`：`loadMonth`/`loadYear` 把 `computeCategoryShare` 的原始（无颜色）结果缓存到 `_monthShare`/`_yearShare`，切主题时仅用缓存重新解析圆环、列表与展开行颜色，当前年月、选中分类、展开态与其他统计数据原样保留，不读账本、不重算。
- **主题切换返回的 onShow 冲突（P1 收口）**：`pages/main` 的 `onShow` 原先无条件 `refreshPanels()`，从外观页返回时统计面板的完整重载会再次冲掉 `recolorForTheme` 已保留的状态。现 `theme.js` 新增单调递增的主题变更序号（`getChangeCounter`），`onShow` 识别本次回前台是否仅由主题变化引起：是则跳过统计面板完整重载（颜色已由订阅刷新），其他面板与非主题返回路径行为不变。
- **对比度按真实玻璃卡片背景建模（P1）**：`contrast.js` 旧口径只取页面背景 `--bg`，并假设「更白 surface 上对比度只会更高」；实际圆环落在 `.glass-card`，深色 `--card-bg` 为白色半透明渐变（0.09→0.03），深色圆环本身比背景亮，卡片叠白变亮反而降低对比度。重写为页面 + 卡片起 / 止端三候选背景模型，枚举全色相在全部候选背景上取全局最差。深色圆环明度 56% → 60%（S=62），最不利卡片端 worst 由 2.578 升至 3.145；浅色明度 34% 保持（worst 3.249，最不利背景为页面）。
- **迁移沙箱异常清理保障（P2）**：`migtest-sandbox` 主体原先无 try/finally，异常时末尾清理不执行、与「无论成败都删沙箱」承诺不符。现主体整体包进 try、清理移到 finally，且 finally 内清理再单独 try/catch，清理失败只标记 `sandboxRemoved=false`、不覆盖 try 块原始异常。
- **测试数据清理改运行 ID 精确删除（P2）**：新增共享模块 `utils/test-registry.js`，每次测试生成独立运行 ID（`__TEST__:<runId>`）并持久化到专用清单文件；清理优先按清单中的账单 ID 精确删除，再以命名空间前缀兜底扫描。重写 `e2e-donut-seed` 与 `main` 的自检 / 清理，旧裸标识（`E2E_DONUT`/`__SELFTEST__`）仅在测试框架运行过的环境（清单存在）作受控 legacy 清理，全新 / 真实账本不再凭普通备注删除，避免误删用户真实账单。

### 测试
- E2E T24 重写为真正覆盖展开与选中态：改用 10 分类（触发聚合，含子分类与中性色），月度 + 年度均真实展开、真实选中圆环分段后再切主题，断言展开 / 选中状态保持、前七项颜色与色相身份、子分类中性色、圆环与图例一致；旧 T24 全程未展开、无法暴露状态问题。
- 新增 `tests/test-registry.test.js`（44 项），`contrast.test.js` 重写为 30 项，`migtest-sandbox.test.js` 新增故障注入（现 36 项），`lazy-compute.test.js` 新增局部刷新专项（现 52 项），`theme.test.js` 新增变更序号专项（现 71 项）。

### Final Closure（第三轮收尾，1 P1 + 1 P2）
- **纯主题事件改为一次性可消费 / 可取消标记（P1）**：第二轮用于判断的 `_themeOnlyCounter` 是单调累计的状态而非事件，「切主题→再进备份恢复 / 分类 / 周期 / 预算 / 导入等非主题操作→返回主页」时可能被误判为纯主题而跳过统计刷新。`theme.js` 新增 `_themePreservePending` 与 `markThemePreserve` / `cancelThemePreserve` / `consumeThemePreserve` / `hasThemePreserve`：主动切主题才 mark，进入任一非主题页（settings 导航）与 `reloadFromStorage`（备份恢复 / 回滚必经）均 cancel，`main.onShow` 改为 consume（取值即清零）。纯主题回主页圆环展开 / 选中态保持且只消费一次，非主题操作后统计完整刷新，不恢复全量重算。
- **删除失败保留注册（P2）**：`cleanupTestBills` 删除账单抛错时，按 runId 记录失败 billId，回写清单时保留该 run 与未删成功的 ID，等下次清理；返回值新增 `failedBillIds`。fail-safe（清单 corrupt 零删除、三重核对、兜底仅扫已登记 runId）不变，并补 deleteBill 故障注入测试。

### 冻结项
- 数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1，均不升级；不新增依赖、不新增分类颜色持久化字段、不重新设计圆环、不改变黄金角稳定配色基本原则。

## [1.3.3] — 2026-10-30

Reliability Closure & Theme Consistency（可靠性收口与主题一致性）。针对外部静态审查指出的 5 类遗留问题逐项修复，不新增业务功能，数据合同与依赖全部冻结。

### 安全
- **遗留入口加环境守卫**：`pages/main/main.js` 的 `__selftest` / `__migtest` 两个历史入口原先无任何环境守卫，现统一经 `utils/env.js` 的 `isDevEnv()`（仅 develop 为真，trial/release/未知 fail-closed）拦截，非开发环境直接抛错、不执行。
- **自测账本专用标识 + 幂等清理**：`__selftest` 写入的账单带固定标识 `SELFTEST_TAG`，`cleanupSelftestBills()` 按标识幂等清理，普通备注不再与真实账本混淆；入口整体 try/finally 隔离。
- **迁移测试独立沙箱**：新增 `utils/migtest-sandbox.js`，所有文件操作限制在 `USER_DATA_PATH/__migtest_sandbox__` 内，复用真实 `migration.legacyToBill` 与 3 条虚构旧数据，递归清理沙箱；正式 manifest / bills / storage 零接触，不再直接 `fs.remove` 真实月份文件。

### 修复
- **多指触摸严格隔离**：`category-donut` 原先在原始 identifier 找不到时回退 `list[0]` 取另一根手指坐标，违背「仅同一手指可点击」。现 `findGestureTouch` / `pickEndTouch` 严格 identifier 匹配、删除 `list[0]` 兜底（找不到返回 null）；touchstart 开头加 `_gActive` 守卫，第一根手指手势未结束时新手指一律忽略；其他手指先抬起不清理绑定手指的手势。
- **测试清理跨全部月份**：`utils/e2e-donut-seed.js` 的 `clearDonut` 原先只清当前月，跨月残留无法发现；改为无参 `rangeBills()` 跨全部月份精确清理。
- **统计面板订阅主题**：`statistics-panel` 原先未订阅主题，切主题后圆环明度更新而面板 `shareList` / `fullShareList`（年度同理）颜色停留旧值。现 attached 内 `theme.subscribe`（未激活不提前取数，保持「激活才加载」）、detached 取消订阅，切主题后列表与展开态颜色同步更新。

### 优化
- **浅色圆环对比度达标**：`donut.js` 浅色明度 45% → 34%，全色相相对浅色背景（`#f3f4fa`）WCAG 非文本对比度 worst≈3.249（≥3:1）；深色明度 56% 保持（worst≈3.074，已达标）。色相 / 饱和度不变，视觉身份保持。
- **运行时对比度自动检测**：新增 `data/statistics/contrast.js`（HSL→RGB、WCAG 相对亮度 / 对比度、全色相 worst 纯函数）与 `scripts/contrast-audit.js`，并接入 `release-check`（6.6），补足 `theme-audit` 只查硬编码、不查运行时 HSL 的缺口；新增 `npm run contrast:audit`。

### 测试
- 新增 `tests/donut-gesture.test.js`（22 项，多指隔离 / 严格匹配 / 点击命中）、`tests/contrast.test.js`（19 项）、`tests/migtest-sandbox.test.js`（19 项）；`env.test` 扩到 18 项，`lazy-compute.test.js` 追加主题订阅专项（现 44 项）。E2E 新增 T24（统计面板切主题，圆环与列表颜色同步、色相身份不变）。

### 冻结项
- 数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1，均不升级；不新增依赖、不新增分类颜色持久化字段。

## [1.3.2] — 2026-10-30

Interaction Reliability & Visual Polish（交互可靠性与视觉语义收口）。不增加无关业务功能，只做四件事：测试代码不污染正式账本、圆环触摸区分点击与滑动、颜色只由稳定 categoryId 决定、Top7+其他展开状态不再误导用户。数据合同继续冻结，不升级 Backup、不新增分类颜色持久化字段。

### 安全
- **测试注入 / 清理隔离出业务代码**：新增 `utils/env.js`（`getEnvVersion()` 读 `envVersion`，异常 / 缺失 / 未知值 fail-closed 回退 release；`isTestEnv()` 仅 develop/trial 为真）。测试桥接模块独立为 `utils/e2e-donut-seed.js`，`pages/main/main.js` 的三个测试入口先经 `isTestEnv()` 守卫，release 下抛错、不执行任何测试账单注入。
- **专用标识与精确清理**：测试数据固定标识 `E2E_DONUT`，注入前先清残留（异常退出可自愈），清理按备注精确全等匹配、不做宽泛匹配，避免误删真实账单；保留创建与清理记录。

### 优化
- **圆环完整手势识别**：`category-donut` 从 touchstart 立即选中改为 start/move/end/cancel 状态机。touchstart 只记录初始坐标 / 时间 / identifier / 候选态，不选中；touchmove 累计最大位移，超 10px 标记滑动，全程不调用 `preventDefault`、不阻止页面滚动；touchend 仅在同一手指、位移未超阈值、时长 ≤600ms、最终坐标命中有效分段时才选中；touchcancel 清理状态。点击中心孔不误选，点击中心按钮执行钻取，快速连点与切年月状态正确。
- **颜色彻底消除排序漂移**：`getCategoryColor()` 改为黄金角确定性 HSL，色相 `H = (hashId(id) × 137.508°) mod 360`，只由稳定 categoryId 决定，不随其他分类出现 / 排名 / 金额变化；饱和度固定 62%，明度随主题微调（深色 56%、浅色 45%），两主题色相身份一致。撞色靠图标 / 描边等其他视觉属性区分，不再动态改色。聚合「其他」固定中性色 `#8D94A8`。
- **Top7+其他展开重整**：默认圆环与图例同为 8 项、颜色一一对应；展开后前 7 分类保持原色，新增明确的「其他」分组头（总额、分类数量），被聚合子分类统一使用中性色并标注「属于「其他」」，子分类仍支持独立钻取；月度年度复用同一 `buildExpandedShareRows()`，不复制两套实现。

### 修复
- 修正 `resolveTrackColor()` 回退分支的 `TRACK_COLOR.dark` 拼写错误（正确为 `TRACK_COLORS.dark`）；未知主题值安全回退 dark。
- 选中状态、中心金额、组件销毁取消主题订阅、快速切换异步触摸回调（seq 守卫）等可靠性问题收口。

### 文档
- 修正 OSS 评估报告中把真机滚动 / 手势「不冲突」写成已验证事实的措辞，明确标注为代码层面结论、真机待验收。

### 测试
- 单测新增 `tests/env.test.js`（12 项），donut-hit 增加 c-shopping / c-life 排序反转回归与未知主题回退；E2E T20/T21 改用真实触摸事件（`dispatchEvent` + `offset()`/`size()` 计算坐标），新增 T22/T23 聚合「其他」展开与子分类钻取。

### 冻结项
- 数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1，均不升级；不新增分类颜色持久化字段。

## [1.3.1] — 2026-10-29

Interactive Statistics & OSS Review（统计图表交互与开源方案评估）。让 v1.3.0 的静态分类占比圆环变成可真实触摸交互，并先完成开源图表方案评估。不升级数据合同、不新增业务功能、不把分类颜色持久化。

### 新增
- **圆环分段真实点击**：`components/category-donut/` 从静态 `<image>` 升级为可触摸交互；点击彩色分段准确识别 categoryId，当前分段高亮（stroke-width 增大、其余分段降透明度），中心切换为分类名称 / 金额 / 占比，图例同步高亮；点击中心孔在已选中时执行钻取。
- **纯函数命中检测**：`data/statistics/donut.js` 新增 `localToViewBox()` 与 `hitSegment()`，先按内外半径判定环带（中心孔 / 圆环外部返回 -1），再以从 12 点顺时针角度按 ratio 累计区间定位；不依赖 wx，可确定性单测。
- **稳定颜色映射**：`hashId()` 对 categoryId 做确定性哈希，`getCategoryColor()` 使同一真实分类跨月 / 跨年颜色稳定，同图撞色时借用空闲色；`resolveSegmentColors()` 成为圆环与图例唯一颜色来源；聚合「其他」使用独立中性色 `AGGREGATE_COLOR`。
- **聚合「其他」交互**：点击聚合分段显示聚合金额、占比与包含分类数，可展开被聚合分类列表；不把 `__aggregate_other__` 当真实分类查询账单。

### 评估
- **开源图表方案评估**：新增 `docs/OSS_CHART_EVALUATION_v1.3.1.md`，核实 echarts-for-weixin（BSD-3-Clause）、AntV F2 / f-wx（MIT）、uCharts（Apache-2.0）等候选；三者均基于 Canvas，会重新引入 Canvas 生命周期与 Skyline 同层不确定点，且存在包体 / 构建链侵入，最终选型保留并增强自研动态 SVG，本版不新增第三方依赖。

### 测试
- 新增命中检测与颜色专项 `tests/donut-hit.test.js`（44 项），覆盖空 / 单 / 多分类、各方向角度、中心孔与外部、分段交界、小占比、聚合其他、颜色稳定与图例一致；E2E 新增 T20（月度）/ T21（年度）圆环交互用例并纳入默认 `npm run e2e`。

### 冻结项
- 数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1，均不升级；不新增分类颜色持久化字段。

## [1.3.0] — 2026-10-29

Statistics Dashboard & Scale Lab（统计仪表盘与真实规模压测）。一半提升统计可读性与可定制性，一半建立真实风格大账本压测长期使用能力。不升级数据合同、不新增业务功能。

### 新增
- **分类占比环形图**：新增 `components/category-donut/`，采用动态 SVG → Base64 data-URI → `<image>`，不引入 ECharts / Canvas；中心展示总支出，下方分类列表含彩色点 + category-icon + 名称 + 金额 + 百分比，深浅主题均可辨。
- **分类占比纯函数**：`computeCategoryShare()` 复用现有 `computeCategoryRanking()` 聚合，不另建分类统计；弧长按真实整数分金额计算，百分比显示一位小数；≤8 类全显示，>8 类聚合 Top7 + 「其他」（内部 id `__aggregate_other__`，纯展示层、不写入 categories）。
- **统计 Hero 重做**：在总支出 / 收入 / 结余基础上增加记录数、最高消费日（按全天支出合计）、日均支出（当前月按已过日历天数、历史月按当月实际天数，不除消费天数）；月度新增「最大单笔支出」独立卡，点击复用账单编辑入口。
- **统计模块定制**：新增 `data/statistics/config.js`，配置写入 `settings.statistics`（version 1）；统计页「管理」Bottom Sheet 可开关模块、恢复默认，本版不做拖拽；Hero 与最大单笔始终保留。
- **Lazy Compute**：关闭的模块不再计算且清空展示数据，而非仅隐藏 WXML；自定义日期、预算、趋势、收支对比等按需执行。
- **累计消费趋势**：新增 `components/cumulative-trend/`（动态 SVG 面积 + 折线），逐日累计普通支出，默认关闭，回答「钱花得有多快」。
- **年度统一**：年度「分类 Top5」升级为同款全年分类占比，复用 category-donut，保留年度钻取；年度回顾保留。

### 优化
- **统计读取范围收口**：自定义日期从无参 `rangeBills()`（读全历史）改为按覆盖月份 `rangeBills(ymStart, ymEnd)`；五个预算包装方法（日历 / 日详情 / 节奏等）全部按所选月份或周期限定，跨月周覆盖相邻两月；复用已加载月度快照，避免重复读取。
- **分类视觉漏点**：年度回顾「记录最多分类」与预算日详情分类补透传 iconType / iconValue，不再回退 Emoji。
- **餐饮图标重设计**：`dining` 图标 id 不变，由小尺寸辨识度低的刀叉改为「碗 + 蒸汽」，数据合同不变。

### 工程能力
- **Realistic Ledger Generator**：新增 `scripts/generate-realistic-ledger.js`，固定 seed 可复现，模拟工资 / 房租 / 周期 / 高频餐饮 / 工作日交通 / 季节旅游 / 双11 / 混合来源 / SVG+Emoji+自定义+归档分类 / 多阶段预算 / 日价，覆盖闰年 2-29、月末、跨年、23:59:59.999、周日周期；输出 Backup V3 标准备份与 expected 摘要。
- **真实规模性能 Gate**：新增 `npm run perf:realistic`，覆盖 Typical 5k / Heavy 20k / Stress 50k 真实用户路径与一致性对账、分片读取次数；生成文件放 `tests/generated/`（gitignore），不提交大 JSON；保留快速 `npm run perf`。

### 冻结项
- 数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1，均不升级。

## [1.2.1] — 2026-10-26

Category Visual Correctness（分类视觉正确性收口）。不新增业务功能、不升级数据合同，修复 v1.2.0 两个分类回归并补回归测试。

### 修复
- **Domain 层名称校验失效**：`updateCategory()` 误用 `if (!v)` 判断 `validateName()` 结果（该函数成功失败都返回对象，`!v` 恒为 false），导致绕过 UI 传入非法名称时不会 fail-closed，甚至可能把 `undefined` 写入名称。改为 `if (!v.ok)`，非法名称确定拒绝且原名称保留。
- **系统核心 5 类无法改图标**：与「核心分类可改图标、不可改名 / 归档」的设计矛盾。系统分类行补上点击入口，编辑器名称字段对核心分类禁用并提示；底层允许「名称保持原值 + 改图标」，传入不同名称（真正改名）仍拒绝。

### 测试
- 新增 G 组回归：空白 / 超长名称 fail-closed、核心分类只改图标成功且名称不变、原名称 + 改图标成功、核心分类改名被拒且图标不变。

### 冻结项
- 数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1。

## [1.2.0] — 2026-10-26

Category Visual System（分类视觉系统）。把分类从纯 Emoji 升级为统一专业的本地 SVG 图标系统，严格保证历史数据无损；不升级数据合同、不新增业务功能。

### 新增
- **本地 SVG 图标注册表**：`data/category-icons.js` 提供 49 个统一线性 / 圆角风格图标，图标 id 与 Android DailyValue 完全一致，无网络 / CDN 依赖。
- **category-icon 组件**：`components/category-icon/` 支持 builtin（本地 SVG data-URI，颜色走深浅主题 Token）与 emoji（独立文本渲染，规避 Skyline emoji 变方块）两种模式，非法 / 未知图标自动回退 emoji。
- **分类管理图标编辑器**：编辑 Sheet 改为「图标库（7 列网格）| Emoji」两个 Tab，系统核心 5 类允许改图标但不可改名 / 归档。
- **Bill Explorer 历史分类筛选**：分类 Sheet 显示 active + 已归档分类，归档项弱化并标注「已归档」；新记账表单仍只显示 active。

### 数据兼容
- 分类对象扩展可选 `iconType`（builtin / emoji）与 `iconValue`，emoji 始终保留作旧数据与渲染失败兜底。
- **无损视觉迁移**：旧分类无图标字段时，默认分类仍是系统默认 emoji 则升级 builtin；用户手动改过的 emoji 保持 emoji 模式，绝不强行改回系统 SVG。
- **Backup V3 不升级**：备份分类本就保存完整对象，视觉字段仅扩展校验；非法 iconType、未知 builtin 等只给 warning、不拒绝恢复，渲染层统一回退。
- **Android `.dvbackup` 视觉接入**：Mini 支持的 builtin 复用本地 SVG、emoji 原样保留、不支持的 builtin 退回其 emoji；标准 12 类只做 id 映射、不覆盖本地已设图标。

### 其他
- Gate 0：App 回前台周期补账后，若当前停在 Bill Explorer 则刷新会话快照并保持筛选，不再显示陈旧数据。
- 健康检查对 `iconType` / `iconValue` 只给 warning、不升级为结构错误。

### 冻结项
- 数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1。

## [1.1.1] — 2026-10-26

Explorer Correctness & Performance Closure（账单浏览正确性与性能收口）。不新增业务功能、不升级数据合同，修复 Bill Explorer 三个真实日期边界 / 分组 / 文案问题并消除真机输入卡顿隐患。

### 修复
- **跨年同日分组被合并**：旧分组用「N月D日」做 key，导致 2025-10-01 与 2026-10-01 在「全部时间」搜索被塞进同一组、WXML key 冲突。改为 `YYYY-MM-DD` 稳定 key（`dateKeyOf`），显示层当前年省略年份、历史年显示年份（`dayLabelOf`），WXML 改用 `wx:key="dateKey"`。
- **结束边界少最后 999ms**：旧月 / 年 / 自定义范围结束于 23:59:59.000，23:59:59.500 这类带毫秒导入账单被错误排除。统一 `startOfLocalDay` / `endOfLocalDay`（后者＝下一天 00:00 − 1ms），Bill Explorer、自定义日期搜索、自定义日期统计、统计钻取全部复用。
- **时间 Chip 跨年误判**：跨年范围不再被显示成单年、跨月范围不再被显示成单月。新增纯函数 `describeRange`，只有真正同年 / 同月才显示快捷标签，否则统一「自定义」。

### 性能
- **页面会话快照**：进入搜索页一次读取账单与分类解析器，后续输入只在内存筛选，不再每次键入重读全部月份 JSON；账单保存 / 删除后刷新快照。
- **输入 debounce 120ms**：Chip / 清除 / 时间 / 分类选择仍立即响应；离开页面清理 Timer。
- **Perf Gate 改用正式 Search Core**：正式调用 `searchBills` 并与手写过滤核对口径，新增连续键入（咖 / 咖啡 / 咖啡店）测试，验证不崩、子串单调、数量正确。

### 文档
- 新增 `docs/HANDOFF_v1.1.1.md`；`release:check` 发布文档检查改为按当前版本动态判定，不再硬编码 v1.0.0；README 同步 Bill Explorer 真实能力。

### 冻结项
- 数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1。

## [1.1.0] — 2026-10-21

Bill Explorer & Analytics（账单浏览与分析）。新增高级搜索、统计钻取、自定义日期统计、年度回顾、CSV 导出；内部前置完成存储可靠性加固。

### 新增
- **账单高级搜索（Bill Explorer）**：关键词（商户 / 名称 / 备注 / 分类 / 金额）、类型、分类、时间范围组合筛选；无筛选时显示最近账单；时间 / 分类筛选 Sheet；结果带来源 Badge（周期 / 导入），点击可编辑并保持筛选。
- **统计钻取**：月度 / 年度分类、年度 12 月柱可直接下钻到 Bill Explorer，预置对应时间、分类与收支条件。
- **自定义日期统计**：统计页任选起止日期查看收入 / 支出 / 结余 / 账单数，开始晚于结束时明确提示、不偷偷交换。
- **年度回顾增强**：最大单笔支出、记录最多分类、最常消费月份，均可点击查看对应账单。
- **账单 CSV 导出**：备份与恢复页可导出 UTF-8 BOM 的 .csv，Excel / WPS / Numbers 直接打开；CSV 仅用于查看分析，不用于完整恢复。
- **更新日志页**：设置「关于」新增「更新日志」入口，第一版不自动弹。

### 存储可靠性
- **原子写入**：新增 `writeJSONAtomic()`（写 .tmp → 读回校验 → 旧文件转 .bak → .tmp 转正 → 删 .bak，失败回滚），适配微信 `renameSync` 不覆盖已存在目标（错误码 1301005）；全部核心写路径（账本 / 设置 / 分类 / 周期 / 清单 / 导入历史 / 备份安全点等）切换原子写。
- **写入前严格读取**：所有会产生写入的路径（分类 / 设置 / 周期增改删等）改为 strict read，原文件损坏即失败，杜绝「读取失败 → 用默认值覆盖」。
- **残留识别**：完整性扫描识别 .tmp / .bak 残留，安全可清理的在启动时清理，正式文件缺失的不自动处理。

## [1.0.0] — 2026-10-21

正式发布版（Final Release Closure）。核心产品功能自 v0.7 起冻结，本版只做发布收口与可靠性修复，不新增业务功能。

### 变更
- **主题持久化可靠性**：`setThemeMode()` 改为「先写 `settings.json` 成功，再更新内存并通知」；写盘失败时内存保持旧主题、不发假状态，外观页提示「主题保存失败，请稍后重试」。杜绝「选了浅色、重启又变回去」。
- **跟随系统前台校准**：新增 `theme.refreshSystemTheme()`，`app.onShow` 最前面调用，补偿小程序在后台期间系统切换外观、微信未及时下发 `onThemeChange` 的场景；回前台同时重新守住原生窗口颜色（状态栏 / 页面背景）。
- **发布检查增强（Release Manifest）**：`release:check` 增加 `package-lock.json` 三处版本一致性、`libVersion` 固定提醒（仍为 `latest` 时 WARN）、发布文档存在性检查。
- **文档收口**：新增 `CHANGELOG.md`、`docs/HANDOFF_v1.0.0.md`、`docs/RELEASE_CHECKLIST_v1.0.0.md`、`docs/DEVICE_GATE_v1.0.0.md`；`README.md` 去掉硬编码测试数量与版本历史，版本历史统一归本文件。

### 冻结项
- 数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1。
- 主题：跟随系统 / 深色 / 浅色；一级导航：统计 / 记账 / 日价。

## [0.9.1] — 2026-10-20

Theme Real-device Closure & Release Candidate（真机主题收口与发布候选）。

### 修复
- **P0 恢复备份后主题不同步**：新增 `theme.reloadFromStorage()`，`restoreBackup` 成功前、`rollback` 后均接入，恢复什么主题当前 App 立即切换，无需重启。
- **非法 theme 磁盘规范化**：`ensureSettings()` 在完整性扫描通过后把磁盘非法 theme（如 `blue`）规范为 dark 并落盘；Theme Manager / Settings / Backup / Validator 四者口径一致。启动前只读阶段不写文件（fail-closed）。
- **Native Chrome Guard**：系统主题变化时手动模式内容不跟随，但 `onChromeNeed` 触发 `app.syncChrome` 重守可能被系统重置的原生窗口。
- `theme:audit` 增加 theme-sensitive JS 白名单 WARN；删除 empty-state 未使用的白色残留属性。

## [0.9.0] — 2026-10-20

Theme & Appearance（主题系统正式上线）。首版仅三主题：跟随系统 / 深色 / 浅色。

### 新增
- `utils/theme.js` Theme Manager：mode/effective 解析、持久化、订阅通知、`bindPage`，非法 theme 归一 dark；只改 themeClass，不 reLaunch、不丢页面状态。
- `app.wxss` 拆为 `page` 深色 fallback + `.theme-dark` / `.theme-light`，补全语义 token；深色保持紫黑毛玻璃 Golden Reference。
- 浅色主题：浅灰紫白玻璃（非纯白），业务绿/红不反转仅加深。
- `dv-icon` 主题化（tone 语义 + dark/light 双调色板）。
- Canvas 曲线 / 统计图表 / 预算日历主题化。
- 新建 `pages/appearance` 外观页与设置入口；状态栏随主题同步。
- page-header 双击返回锁；main 接 viewport；`theme-audit` 与 `backup-validator` 主题校验。

## [0.8.1] — 2026-10-20

真机 UI / 兼容性 Hotfix。

### 修复
- 公共 Bottom Sheet 透明度收口（主体 0.97/0.98、遮罩 0.42，正文不可辨认）。
- 公共键盘生命周期（`utils/keyboard.js`，关 Sheet / 返回前先收键盘，含超时兜底）。
- Android viewport 恢复（`utils/viewport.js`，键盘归零 / resize 后 `device.reset()` 重测），解决分类管理「Header 被顶走、底部白条」。
- 二级页根容器背景兜底（`var(--bg)`，最坏露黑不露白）。

## [0.8.0] — 2026-10-20

Release Hardening & RC（发布硬化）。

### 变更
- 严格月份读取（损坏 / shape 错 / 版本不支持 fail-closed，禁止被空文件覆盖）。
- 恢复前 Raw Backup Validator（不再让 createBill 先偷偷修非法值）。
- 显式 Backup V1→V2→V3 迁移管线。
- 存储完整性扫描（missing/corrupt 五态）。
- 重复 ID 检测（Bill/Recurring/Category/BudgetRule）。
- 数据损坏安全模式（启动检测进保护模式，可导出原始数据 / 创建诊断 / 从备份恢复，绝不自动覆盖）。
- 灾难演练 + 升级矩阵；`npm run release:check` 一次性发布检查。
- 隐私文案精确化与平台隐私指引配置清单；临时备份导出到 `exports/` 自动清理；品牌统一为「随时随地大小记」。

## [0.6.1] — 2026-10-17

Recurring & Migration Closure（周期与迁移收口）。

### 修复
- P0 Android「每周日」迁移错误（weekly day=0 被错改成 1），按频率分域规范化。
- 编辑规则后立即刷新 nextOccurrence；停用显示「已停用」；>365 补记提示据实。
- 生成器异常隔离、并发锁修复；分类归档 fail-closed；规则严格校验。
- 恢复 / 导入周期规则后立即重算 nextOccurrence；修复 Skyline 周期编辑器 chips 高度塌陷。

## [0.6.0] — 2026-10-16

Categories & Recurring（分类管理 + 周期记账）。

### 新增
- 分类管理：软归档（不物理删除）、系统核心 5 类只读、我的分类 CRUD、重名校验。
- 周期规则：数据模型（recurring.json）、Bill V3（新增 recurringRuleId）、生成器（日/周/月/年 + 每 N、月末钳制、catch-up 上限 365、幂等、编辑只影响未来）。
- 分类被周期引用时禁止归档；Android 自定义分类 / 周期规则迁移；Backup V3。

## [0.5.1] — 2026-10-16

Budget Correctness & Interaction Closure（预算口径正确性）。

### 修复
- 预算口径：`countsAgainstBudget`（当日规则启用才参与）；当前周期截到今天；无预算明确显示。
- 预算颜色 token 统一（盈余绿 / 超支红）；剩余负值文案；历史月摘要；日详情无预算 / 未来日 + 图例。

## [0.5.0] — 2026-10-16

Budget Rhythm（预算节奏）。

### 新增
- 预算规则（settings.budget.rules，历史只增不改）。
- Budget Core 纯函数（rules/period/core/calendar）。
- Hero 支出 / 预算模式（今日 / 本周 / 本月）。
- 预算设置页；统计预算日历地图 + 日详情 Sheet。
- 日期不允许未来；Header 盒模型统一；生命周期 onShow 刷新。

## [0.4.1] — 2026-10-16

Interaction & Visual Polish（交互与视觉收口）。

### 修复
- 日价详情编辑不再污染原交易 occurredAt；表单 title/canSubmit 一致。
- 记一笔 Sheet 重做（半透明、自然高度、金额不裁切）；设置页减法；曲线触摸坐标修复。

## [0.4.0] — 2026-10-16

Daily Value Core（每日价值核心）。

### 新增
- 日价语义：normal+dailyValue（同时进账本 / 统计 / 日价）与 daily-value-only（仅日价）。
- 日价纯函数（购买当天起算、最少 1 天、日价 = 金额 / 已用天数，不持久化每天重算）。
- 日价主页 / 表单 / 详情；Canvas 2D 下降曲线；里程碑；跨日自动刷新。
- Bill V2；Android .dvbackup 完整迁移；Backup V2。

## [0.3.2] — 2026-10-15

Android Main UI Parity（记账主页对齐 Android）。

### 变更
- Hero 卡成为唯一月份区域（箭头、超大金额、横滑手势）。
- 账单改连续时间线；FAB 改圆角方形玻璃；自研 dv-icon 组件替代 Emoji。

## [0.3.1] — 2026-10-15

统计正式版验收修复。

### 修复
- 年度月均支出口径（按有支出月份数）；分类 Top5 只统计支出。
- 柱图显示根因；分类弹层定位；加载时序。

## [0.3.0] — 2026-10-15

统计正式版。

### 新增
- 统计纯函数（月度 / 年度：概览、趋势、分类排行、收支对比）。
- statistics-panel 月度 / 年度（纯 WXSS 图表，不引图表库）；FAB 遮挡修复。

## [0.2.2] — 2026-10-15

真实账单兼容（Real Statement Compatibility）。

### 修复
- 微信真实 XLSX 通用表头 + 金额别名；微信退款按官方收 / 支入账。
- 支付宝 GBK 纯 JS 兜底；结构摘要与缺失列诊断。

## [0.2.1] — 2026-10-15

### 修复
- 跨月编辑 updateBill（oldYm/newYm、id 不变、快照回滚）。
- legacy jm_records 迁移原子化与幂等；版本统一与 npm test 入口。
- 编辑账单保留原始时分；导入失败脱敏诊断。

## [0.2.0] — 2026-10-15

双端正式版。

### 新增
- 紫黑毛玻璃视觉（Tabs + Swiper、玻璃 FAB / Bottom Sheet）。
- 正式本地数据层（USER_DATA_PATH 月份分片、Bill V1、整数分、jm_records 无损迁移）。
- 统一导入引擎（微信 / 支付宝 XLSX+CSV（GBK）、Android DailyValue、Mini 恢复；三级去重、原子化写入）。
- iOS / Android 双端 safe-area；绑定真实 AppID。

## [0.1.0]

初始脚手架（v0.1.0 冻结）。
