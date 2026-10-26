# HANDOFF — 随时随地大小记 v1.2.0（Category Visual System）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**1.2.0**
- 品牌名：**随时随地大小记**
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + packages 两处）、`README.md`）
- 上一版本基线：v1.1.1（HEAD `f49d959`）
- 本版定位：**把分类从纯 Emoji 升级为统一专业的本地 SVG 图标系统（49 个图标，id 与 Android 对齐），严格保证历史数据无损；不升级数据合同、不新增业务功能。**
- 后续路线：本版完成后停止，等用户审 main；之后再讨论 v1.3.0 Appearance V2，不自行进下一版。

---

## 1. 本版背景

用户审 v1.1.1（HEAD f49d959）确认 Bill Explorer 收口通过、不做 v1.1.2。当前 Mini 分类仍是纯 Emoji 结构，是产品里最明显的「早期工具感」。本版对照 Android daily-value-v2 已成熟的 49 个本地图标体系，在不破坏任何历史数据的前提下完成分类视觉升级，并顺手收掉搜索页前台补账后的快照陈旧问题。

---

## 2. Gate 0：搜索页前台补账快照刷新

- 旧问题：用户停在 Bill Explorer 时小程序进后台，周期账单到期后回前台，`App.onShow → runRecurringCatchup()` 补了新账，但 `refreshTimeSensitiveViews()` 只刷新 main 与 daily-value-detail，搜索页仍拿后台前的 `_billsSnapshot`，要重新进入或编辑一笔才更新。
- 修复：
  - `pages/search/search.js` 新增 `refreshAfterExternalDataChange()`，内部依次调用已有的 `refreshSnapshot()`（重读 `store.rangeBills()` + `getCategoryResolver()`）再 `applyFilters()`，保持当前筛选、不重建页面、不丢关键词。
  - `app.js` 的 `refreshTimeSensitiveViews()` 新增第三个分支：当前路由为 `pages/search/search` 且存在该方法时调用；该函数在 `onShow` 的 `runRecurringCatchup().finally()` 中触发。

---

## 3. Gate 1：本地 SVG 图标注册表（`data/category-icons.js`）

- 提供 49 个统一线性 / 圆角风格（24×24、stroke）图标，结构为 `ICONS`（id → {label, glyph, body}）、`BUILTIN_ICONS`（数组）、`builtinIconById(id)`、`isBuiltinId(id)`。
- 49 个图标 id 与 Android DailyValue 严格一致（dining、coffee、drink … insurance、other），无网络 / CDN 依赖；node 验证 count=49、unique=49、无重复。
- 追加并导出 `pickCategoryVisual(cat)`：统一输出 `{iconType,iconValue,emoji}`，空对象 / 非法输入回退 emoji 📦，供各数据层组装展示对象复用。

---

## 4. Gate 2：分类数据模型扩展与无损视觉迁移（`data/categories.js`）

- 新分类对象：`{id,name,emoji,iconType:'builtin'|'emoji',iconValue,builtin,sort,archived}`；emoji 始终保留作旧数据兼容与渲染失败兜底。
- 两个映射常量：`DEFAULT_ICON_BY_CAT`（12 个默认分类 id → builtin 图标 id）、`DEFAULT_EMOJI_BY_CAT`（12 个 id → 系统初始 emoji）。
- **无损视觉迁移核心在 `normalizeCategory(c)`**：
  - 显式合法 builtin 校验后保留；显式 emoji 保留；
  - 旧数据无有效 iconType 时，默认分类若 emoji 仍等于系统默认 emoji（用户没改过）→ 升级 builtin；用户改过 emoji、或非默认自定义分类 → 保持 emoji 模式；
  - 非法 / 未知 builtin 不保留，安全回退 emoji。
- mutation 全部走 `readCategoriesStrict()`（文件不存在→默认分类，存在但损坏 / 非数组→抛错 fail-closed），写入用 `fs.writeJSONAtomic`；`addCategory` / `updateCategory` 支持 iconType/iconValue，`updateCategory` 兼容旧 emoji-only patch。
- `resolveIconInput(input)` 统一解析图标输入（显式字段优先、兼容直接传 emoji、都没有默认 builtin/other）。

---

## 5. Gate 3：category-icon 组件（`components/category-icon/`）

- 四件套：合法 builtin 用 `builtinIconById` 取 body，拼统一 SVG 外壳（stroke-width 1.8、linecap/linejoin round，颜色按 tone / 主题）编码 base64 data-URI，用 `<image>` 渲染；emoji 模式用独立 `<text>` 渲染，规避 Skyline 中 emoji 与文字合并变方块。
- 无 iconType / 非法 / 未知图标统一回退 emoji（emoji 或 iconValue 或 📦，不允许空白）。
- attached 时订阅主题变化重染，observers 监听全部属性；支持 framed（浅底圆角）与 size / tone / color 属性。

---

## 6. Gate 4：分类管理图标编辑器重做（`pages/category-manage/`）

- 列表三处（系统 / 我的 / 已归档）行图标全换 category-icon。
- 编辑 Sheet 改为两个 Tab：**图标库**（7 列网格、scroll-view，当前选中高亮）与 **Emoji**（输入框 + 预览）；名称字段保留。
- 系统核心 5 类允许改图标但不可改名 / 归档；预置与自定义分类允许名称 + 图标编辑和归档；onSaveEditor 传 `{name,iconType,iconValue}`。

---

## 7. Gate 5：全部分类展示点切换到 category-icon

- 统一 helper `pickCategoryVisual` 接入 7 个数据层纯函数：`data/accounting.js`（billDisplay）、`data/search/group.js`、`data/statistics/month.js`、`data/statistics/year.js`、`data/daily-value/list.js`、`data/daily-value/detail.js`、`data/budget/calendar.js`。
- 全部正式分类展示点（记账分类网格、主页时间线、Bill Explorer 结果与分类筛选、统计排行、预算日详情、周期列表 / 编辑器、日价列表 / 详情、分类管理）统一切换，无一半 SVG 一半 emoji 的长期状态。
- 10 个页面 / 组件 json 注册 category-icon；页面 js 透传 iconType/iconValue；wxss 适配新容器（flex 居中、保留原布局 margin）。
- import.wxml 的 `item.icon` 经核实是来源卡片标识（微信 / 支付宝 / DailyValue），非分类，保留不动。

---

## 8. Gate 6：Backup V3 不升级 + Raw Validator 扩展（`data/backup-validator.js`）

- Backup V3 的 categories 本就保存完整分类对象、迁移为深拷贝，新增 iconType/iconValue 无需 Backup V4。
- 在 `validateCategoriesStructure` 内新增视觉字段校验，**全部为 warning、不升级 error、不拒绝恢复**：
  - iconType 非 builtin/emoji → `category-icon-type-invalid`；
  - iconValue 非字符串 / 缺失 → `category-icon-value-missing` / `-invalid`；
  - builtin 但 iconValue 不在本地 49 内 → `category-builtin-icon-unknown`（渲染时 emoji 兜底）。
- 恢复闭环：落盘后 `getCategories()` 对读取分类 map `normalizeCategory`，未知 builtin 被安全回退，不会保留悬空图标。

---

## 9. Gate 7：Android `.dvbackup` 视觉接入 + 历史分类筛选

- `packages/importer/adapters/dailyvalue.js` 新增 `mapAndroidVisual(c)`：
  - Android builtin 且 Mini 支持 → 复用本地 SVG；emoji 模式原样保留；不支持的 builtin / 无字段 → 退回其 emoji。
- `mapBackupCategories` 自定义分类待建对象带上视觉字段；标准 12 类只做 id 映射、不进 toCreate，**不覆盖用户本地已设图标**。
- `packages/importer/core/commit.js` 的 `addCategory` 写入补上 iconType/iconValue。
- Bill Explorer 分类 Sheet 改为显示 active + 已归档分类（`getCategories()`，active 在前、归档在后），归档项弱化（opacity）并标注「已归档」；新记账表单仍只显示 active。

---

## 10. Gate 8：健康检查增强 + 兼容测试（`data/health.js`）

- `analyzeHealth` 在分类遍历中新增 iconType/iconValue 校验，视觉元数据只给 warning、不升级为结构错误、未知图标可降级。
- 新增 `tests/category-visual.test.js` 并注册到 `tests/run-all.js`，覆盖：旧分类无字段升级、默认 emoji 自动升级 builtin、改过的 emoji 不被覆盖、builtin↔emoji 切换、Backup V3 roundtrip、旧备份无图标字段恢复、Android SVG/Emoji 导入、未知图标 fallback、归档历史显示、健康检查分级。

---

## 11. 数据合同冻结声明

v1.2.0 **未升级 / 未改动**任何核心数据合同，全部继续冻结：

- **Bill V3**：分片 `bills/YYYY-MM.json = {ym,version:3,bills:[...]}`，整数分金额，Bill 不增加分类快照字段。
- **Recurring Store V1**：`recurring.json = {version:1,rules:[...]}`。
- **Budget V1**：`settings.budget = {version:1,weekStartsOn,rules:[...]}`。
- **Backup V3**：`daily-value-mini-backup` SCHEMA=3，SUPPORTED=[1,2,3]，不引入 Backup V4。
- 本版不加入分类颜色、拖拽排序、分类预算、图片上传图标、远程图标、AI 自动分类、AutoBill、账户 / 资产、云同步等任何新业务功能。

---

## 12. 测试结果

### 12.1 纯逻辑单测：`npm test`

**1349 项全绿、25/25 套件、退出码 0**（v1.1.1 1297 → 本版新增 category-visual 套件 52 项；其余套件计数不变，1349 = 1297 + 52）。

### 12.2 GUI 端到端：`npm run e2e`

**T01–T18 全绿 18/18，退出码 0**，截图均带 `_simulator` 后缀。

### 12.3 性能：`npm run perf`

1k/5k/10k 全绿、近线性；正式搜索与连续键入均通过。

### 12.4 主题审计：`npm run theme:audit`

PASS，无新增 theme-sensitive 违规。

### 12.5 发布检查：`npm run release:check`

**FAIL：0，WARN：1**（唯一 WARN：`libVersion` 仍为 `latest`，待最终体验版验证后固定——预期提醒，非代码缺陷）。

---

## 13. 发布前 Gate（待用户执行，助手不代签）

- **Agent simulator（automator + Skyline）：PASS** —— 单测、E2E、性能、主题审计、release:check 逻辑项均通过；**Canvas 真机表现、分类图标真机视觉、升级 / 恢复演练、原生窗口真机表现除外**。
- **User physical device（Android）：NOT TESTED（待用户）**

仍需在真实微信 Android 上完成（详见 `docs/DEVICE_GATE_v1.0.0.md`）：分类图标深 / 浅色真机视觉（快速记账网格、主页时间线、Bill Explorer、统计排行、周期、分类管理选择器）、真机主题矩阵、日价 Canvas 曲线、升级测试、完整 Backup 灾难演练、隐私后台配置（MessageFile / Clipboard）、体验版验证后固定基础库。

---

## 14. Git 状态

- v1.2.0 改动（基线 `f49d959` 之后）：
  - 新增 `data/category-icons.js`、`components/category-icon/`（四件套）、`tests/category-visual.test.js`；
  - 重写 `data/categories.js`、`pages/category-manage/`；
  - 修改 `app.js`、`pages/search/`、7 个数据层纯函数、`data/backup-validator.js`、`data/health.js`、`packages/importer/adapters/dailyvalue.js`、`packages/importer/core/commit.js`、多个 json / wxss；
  - 版本与文档：`utils/version.js`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md`、本 HANDOFF。
- 中文消息用 `git commit -F <file>`；推送走显式代理 `http://127.0.0.1:33210`。
- 最终结果：HEAD == origin/main，ahead=0 / behind=0（核对 `git rev-list --left-right --count origin/main...HEAD`）。
