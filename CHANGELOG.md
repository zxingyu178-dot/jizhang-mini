# 更新日志（CHANGELOG）

本文件记录「随时随地大小记」（jizhang-mini）各版本的显著变更。
版本号遵循语义化版本（SemVer）；测试数量等易变信息不在此维护，以命令实际输出与对应 `docs/HANDOFF_*.md` 为准。

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
