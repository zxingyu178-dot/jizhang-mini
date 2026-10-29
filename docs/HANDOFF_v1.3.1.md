# HANDOFF — 随时随地大小记 v1.3.1（Interactive Statistics & OSS Review）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**1.3.1**
- 品牌名：**随时随地大小记**
- AppID：`wxcdcf83d191065d9`
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + `packages[""]` 两处）、`README.md`、`CHANGELOG.md`）
- 上一版本基线：v1.3.0（HEAD `a1621f0`）
- 本版定位：**统计图表交互收口 + 开源方案评估。让 v1.3.0 的静态分类占比圆环变成可真实触摸交互；不升级数据合同、不新增业务功能、不把分类颜色持久化。**
- 后续路线：本版完成后停止，等用户审 main；真机 Gate 由用户本人执行，助手不代签。

---

## 1. 背景与目标

v1.3.0 已交付分类占比环形图（动态 SVG → Base64 data-URI → `<image>`），但圆环只是静态图片：无法识别用户点了哪个分段，中心也不会随选择变化。本版把它升级为可真实触摸交互的图表，并按用户要求先做开源图表方案评估（允许取其精华、去其糟粕，不把零依赖当铁律，也不盲目引入整个图表库）。

数据合同在本版**全部冻结**：Bill V3、Backup V3、Recurring Store V1、Budget V1 均不升级；不新增分类颜色持久化字段。

---

## 2. Gate 0：开源图表方案评估（先评估、不立即编码）

新增 `docs/OSS_CHART_EVALUATION_v1.3.1.md`，通过官方文档与仓库事实核实候选，并制作不依赖 wx 的命中检测数学 POC（14 项断言全过）。

| 候选 | 许可证 | 渲染方式 | 关键事实 | 结论 |
| --- | --- | --- | --- | --- |
| ecomfe/echarts-for-weixin | BSD-3-Clause | Canvas | `ec-canvas` 约 1006KB，单页面逼近主包 2MB；官方未明确 Skyline；维护趋缓、Open Issues 多 | 不采用 |
| AntV F2 / f-wx | MIT | FEngine / Canvas | 需配置 JSX Transform（babel），原生 JS 无构建链；f-wx 周下载量低、依赖方 0 | 不采用 |
| uCharts | Apache-2.0 | Canvas 2d | 约 93KB 最轻，但主要面向 uni-app，原生微信需自行改造，Skyline 下 Canvas 待真机验证 | 不采用 |
| **自研动态 SVG + 命中检测** | 本项目 | 动态 SVG / `<image>` | 无 Canvas 生命周期问题、无新增依赖、离线、截图稳定、深浅主题可控 | **采用** |

**选型结论**：三个开源候选全部基于 Canvas，会重新引入本项目刻意规避的 Canvas 生命周期 / Skyline 同层 / 真机不确定点（日价 Canvas 真机 Gate 仍待验收），且存在包体或构建链侵入。最终保留并增强自研 SVG，吸收开源图表在分段选中、中心切换、图例高亮、点击钻取上的交互设计。本版**不新增第三方依赖**，故暂不需要 OSS_ATTRIBUTION.md。

---

## 3. Gate 1：圆环真实点击

### 3.1 数据层几何与命中检测（`data/statistics/donut.js`，不依赖 wx 的纯计算）

- 几何常量：RADIUS 40、STROKE 12、CENTER 50、INNER_R 34、OUTER_R 46，viewBox `0 0 100 100`，从 12 点顺时针（rotate(-90)）绘制。
- **`localToViewBox(localX, localY, rectW, rectH)`**：把相对容器的 px 坐标映射到 viewBox 0..100。
- **`hitSegment(segments, vx, vy)`**：先按距离 `dist ∈ [34,46]` 判定是否落在环带（中心孔 / 圆环外部返回 -1）；再用 `atan2(dx, -dy)` 计算从 12 点顺时针角度（负角 +2π 归一化），`frac = θ/2π` 后按各段 ratio 累计区间定位分类。
- 命中检测使用的角度、方向、起始位置与 SVG 实际绘制顺序完全一致；点击中心孔、外部或无效区域不误选。

### 3.2 组件触摸与选中（`components/category-donut/`）

- `onTouchStart(e)`：从 `e.touches[0]`（兜底 `changedTouches[0]`）取 clientX/Y，用 `wx.createSelectorQuery().in(this).select('.cd').boundingClientRect` 取真实 rect，经 localToViewBox → hitSegment，命中才 `applySelection(idx)` 并 `triggerEvent('select', {index, segment})`，未命中不误选。
- 选中态：当前分段 stroke-width 增大到 15、opacity 1，其余分段 opacity 0.28；中心三行切换为分类金额（`money.formatCents`）、分类名、占比（聚合段显示「包含 N 个分类」）。
- `onTapCenter`：仅在已选中时 `triggerEvent('drill', {index, segment})`；中心 view 尺寸限制为 68%（对应内半径比例），环带点击不会落到中心 view 误触发，中心孔点击才命中。
- `clearSelection()` 供面板切年月 / 模式主动清除；observers 监听 segments / size 变化自动重置选中。

---

## 4. Gate 2：颜色与图例统一

### 4.1 唯一颜色来源（`donut.js`）

- 8 色 `DONUT_PALETTE`，另设独立中性色 `AGGREGATE_COLOR`（聚合「其他」专用，不占调色板索引）。
- **`hashId(str)`**：31 倍因子确定性 32 位哈希取绝对值；`getCategoryColor(categoryId)` 基础索引 = `hashId(id) % 8`，使**同一真实 categoryId 跨月 / 跨年颜色稳定**，排序变化不导致颜色随机；当前图内若撞色，按顺序借用最近空闲色保证同图不撞色。
- **`resolveSegmentColors(segments)`**：圆环与图例唯一颜色来源（聚合项直接给 AGGREGATE_COLOR），不再各维护一套颜色逻辑。颜色不写入 Category 持久化数据。

### 4.2 图例 UI（`statistics-panel.wxml/wxss`）

- 每个分类行最前加与圆环分段完全一致的颜色点 `.share-row__dot`，并保留 category-icon、名称、金额、百分比；选中行加克制的 `.share-row--active` 背景反馈。
- 不仅靠颜色传达信息：名称 / 金额 / 百分比始终可见，兼顾色觉差异与小屏阅读。
- Top 7 + 「其他」：默认图例只展示对应 8 段，「其他」显示聚合金额与占比；展开后显示被聚合分类明细（仍可单独钻取），并明确这些分类属于「其他」，不被误认为圆环独立分段。月度 / 年度同规则。

---

## 5. Gate 3：钻取流程闭环

抽取公共钻取 `drillMonthShare(segment)` / `drillYearShare(segment)`，复用现有 Bill Explorer 筛选，不另建查询逻辑：

- 真实分类：月度 → `/pages/search/search?month=<ym>&category=<id>&type=expense`；年度 → `?year=<year>&category=<id>&type=expense`。
- 聚合项（`aggregate` 或 id === `__aggregate_other__`）：仅展开被聚合分类列表，不把聚合 id 当真实分类查询。
- 圆环选中（select）只同步图例高亮、不跳转；中心点击（drill）才执行钻取，避免触摸分段时意外触发页面其他点击。
- 切月、切年、切月度 / 年度后选中状态与数据一致；圆环中心金额与 Hero 总支出一致。

---

## 6. Gate 4：自动化测试真实结果

### 6.1 纯函数测试

- 新增 **`tests/donut-hit.test.js`（44 项，0 失败）**，已注册进 `tests/run-all.js`（现 30 套件）；覆盖空 / 单 / 2 / 8 / 超 8 分类、各分段中点、12/3/6/9 方向、中心孔与外部、内外缘、首末段交界、小占比分段、聚合「其他」、非法 ratio 与无效坐标、localToViewBox、颜色跨月稳定、同图不撞色、图例色 = 圆环色。
- 命中检测为不依赖 wx 的纯函数，可确定性边界测试。
- 修正 `tests/statistics.test.js` 中基于旧索引着色的断言，改为按稳定 ID 颜色合同读取真实分类颜色。

### 6.2 E2E

- 新增 **T20（月度圆环）/ T21（年度圆环）** 并纳入默认 `npm run e2e`（`golden-path.js`），覆盖触摸选中、中心信息变化、图例同步、真实钻取参数、切月状态重置。
- 调试中确认 automator 0.12.1 两个事实：元素无 `boundingClientRect`，用 `offset()`（left/top）+ `size()`（width/height）组合；`mockWxMethod` 对象形式不支持回调，改用函数形式写 `globalThis` 再 `mp.evaluate` 读回。

### 6.3 全量命令真实结果（均退出码 0）

| 命令 | 结果 |
| --- | --- |
| `npm test` | **30/30 套件通过，0 失败**；donut-hit 44 项 |
| `npm run e2e` | **T01–T21 全绿 21/21，0 失败**，截图均带 `_simulator` 后缀 |
| `npm run perf` | 1k/5k/10k 全绿、近线性（10k 全量 16ms / 年 28ms / 搜索 31ms，10k 比 1k = 8.0x） |
| `npm run perf:realistic` | 5k/20k/50k 全绿、一致性闭合、读取范围正确（Stress/Typical 全量 10.0x ≤ 30x） |
| `npm run theme:audit` | 0 违规 FAIL，3 项主题感知 JS WARN 不阻断 |
| `npm run release:check` | FAIL 0，WARN 1（唯一 WARN：libVersion 仍 latest，待体验版验证后固定） |

E2E 首跑曾出现与改动无关的间歇性 `timeout waiting for automator response`（失败用例每次随机、无断言错误，T20/T21 始终通过）；重启 IDE 自动化实例获得干净连接后，全量 21/21 通过。

---

## 7. Gate 5：真机验收（待用户执行，助手不代签）

- **Agent simulator（automator + Skyline）：PASS** —— 单测、E2E、性能、主题审计、release:check 逻辑项均通过。
- **User physical device（Android）：NOT TESTED（待用户）**

复用 v1.3.0 已生成的 5k / 15k / 30k 标准备份（不重复生成），经正常「备份与恢复」逐级注入（先备份个人账本），重点验收：

1. 圆环点击是否准确，小占比扇区能否选中正确分类；
2. 分类图例与颜色一一对应，月度 / 年度颜色稳定；
3. 聚合「其他」正确展开、被聚合分类可单独钻取；
4. 查看账单筛选参数正确；
5. 连续切月 / 切年无明显卡顿，深 / 浅色主题正常；
6. 页面滚动、Swiper、Bottom Sheet 不受影响。

记录真实设备、微信版本、基础库版本、等待时间与截图，不把 Node 端耗时当作真机耗时。

---

## 8. 数据合同冻结声明

v1.3.1 **未升级 / 未改动**任何核心数据合同：

- **Bill V3**：分片 `bills/YYYY-MM.json = {ym, version:3, bills:[...]}`，整数分金额。
- **Backup V3**：`daily-value-mini-backup` SCHEMA=3，不引入 Backup V4。
- **Recurring Store V1**：`recurring.json = {version:1, rules:[...]}`。
- **Budget V1**：`settings.budget = {version:1, weekStartsOn, rules:[...]}`。

不新增分类颜色持久化字段，不加入主题强调色、壁纸、拖拽、账户资产、云同步、AI 分析等新业务功能。

---

## 9. 已知限制与未完成项

- 真机圆环交互与大账本 Gate 由用户本人完成，结果未测；助手不代签。
- libVersion 仍为 `latest`，体验版验证前保持，不猜版本号；属 release:check 唯一 WARN。
- 「点击不阻断页面滚动」在 E2E 中未以独立用例直接断言（Skyline 合成滚动不可靠），圆环触摸绑定在根 view、未阻止默认滚动，需真机最终确认。
- 原子写在真实 FileSystemManager 的 rename / tmp 行为仍须后续真机 / 基础库验证。

---

## 10. Git 状态

- v1.3.1 改动（基线 `a1621f0` 之后）含 `donut.js` 重写、category-donut 四件套、statistics-panel（js/wxml/wxss）、`month.js` 导出、`main.js` 测试辅助、新增 `donut-hit.test.js` 与 run-all 注册、`statistics.test.js` 断言更新、golden-path T20/T21、OSS 评估文档、版本文件、README、CHANGELOG 与本 HANDOFF。
- 临时诊断 / probe 脚本（`_tmp-t20.js`、`_probe-stack.js`、`probe-donut.js`）已删除；`tests/generated/` 大文件被 gitignore 不提交。
- 中文消息用 `git commit -F <file>`，推送走显式代理 `http://127.0.0.1:33210`。
- 最终结果：HEAD == origin/main，ahead=0 / behind=0（核对 `git rev-list --left-right --count origin/main...HEAD`）。
