# HANDOFF — 随时随地大小记 v1.4.1（Data Safety & Import Reliability）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**1.4.1**
- AppID：`wxcdcf83d9191065d9`（以 `project.config.json` 为唯一权威）
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md`）
- 开发基线：v1.4.0 / `5a51a8fa1964ecc42dffe1e7b6b129be2e60d0ca`
- 本版定位：**稳定性升级**，不新增业务功能、不升级数据合同、不引入第三方依赖。
- 完成状态：**READY_FOR_DEVICE_ACCEPTANCE**（自动化全绿；模拟器已实测；真机 iPhone / Android 待用户按 `docs/10_DEVICE_ACCEPTANCE.md` 执行，助手不代签）

---

## 0. 结论速览

| 维度 | 结果 |
| --- | --- |
| 数据安全 | 隔离任一环节失败即中止，原始损坏分片字节不变；恢复 / 回滚状态可追踪 |
| 导入性能 | 30,000 笔账本 + 3,000 行预览：**1,618 ms → 96.7 ms**（16.7×） |
| 去重一致性 | 17 类固定场景 + 30 组随机差分 + 极端分布，新旧算法结果完全一致 |
| 导入 E2E | T28 完整流程、T29 疑似重复、T30 非法文件；全量 **31/31** |
| SVG | 4 个组件逐项审计，无真实兼容问题；未盲目替换 rgba |
| 窄屏布局 | Hero 三列中间列弹性 1.6/1.7 + nowrap + 22rpx，320–430 宽度估算通过 |
| 单元测试 | **48/48** 套件通过（基线 44 + 新增 4） |
| 审计 | `theme:audit` 0 FAIL、`contrast:audit` 通过、`release:check` 通过（1 个既有 WARN） |
| 真机 | **未测试**，清单见 `docs/10_DEVICE_ACCEPTANCE.md` |

---

## 1. 分 Gate 交付

### Gate 0 — 基线确认
- HEAD 与任务书一致：`5a51a8fa1964ecc42dffe1e7b6b129be2e60d0ca`，与 `origin/main` 一致。
- 数据合同冻结：Bill V3、Backup V3、Recurring Store V1、Budget V1、整数分、按月分片。
- 性能基线重测（Node v24 + 内存 FS）：5k 221.9 ms / 15k 353.5 ms / 30k **1,618.2 ms**。
- 报告：`docs/V1.4.1_BASELINE.md`
- 提交：`249977111cba1c047f5856cb0745fe88fd5e5d20`

### Gate 1 — 数据安全（最高优先级）
- `data/quarantine.js`：结构化结果、逐字节回读校验、meta 失败不放行、fail-closed。
- `data/backup.js`：隔离前置；`QUARANTINE_INCOMPLETE` / `SAFETY_POINT_FAILED`；`mutationStarted / rollbackAttempted / rollbackCompleted`；rollback fail-closed。
- `packages/importer/core/commit.js`：导入回滚失败不再静默。
- 测试：`tests/quarantine-rollback.test.js` 重写为 Q1–Q12，**86 项通过**；相关回归 data 100、disaster 56、importer 144、backup-migration 20、backup-restore-statistics 16 全通过。
- 报告：`docs/V1.4.1_DATA_SAFETY_REPORT.md`

### Gate 2 — 导入去重性能
- `packages/importer/core/dedupe.js`：精确流水号 / fingerprint / 疑似重复时间桶 / CSV 分钟键四类索引；原精确判断与 zero/one/many 不变；无效时间戳安全回退。
- 测试：`tests/dedupe-index.test.js` **50 项通过**。
- 性能：30k 档 1,618.2 → **96.7 ms**；5k 8.0×、15k 6.7×。
- 报告：`docs/V1.4.1_IMPORT_PERFORMANCE.md`
- 提交：`f78b43629452d243c210845a907f6fbee3c9357b`

### Gate 3 — 导入完整流程
- `import.js` 新增 develop-only `__e2eImportText`（`env.isDevEnv()` 守卫、无 UI 暴露、解析后删临时文件）。
- E2E T28 / T29 / T30；`tests/import-e2e-safety.test.js` **34 项通过**。
- 截图管理：每轮 `artifacts/e2e/<runId>/`，不再清空 / 覆盖 `docs/screenshots/e2e/`；`artifacts/` 已 gitignore。
- 报告：`docs/V1.4.1_IMPORT_E2E_REPORT.md`
- 提交：`a3cbf345a285c236b382101e28728a0022376d3e`

### Gate 4 — UI 与 SVG
- `tests/svg-compat.test.js` **101 项**；`tests/stats-hero-layout.test.js` **25 项**；E2E T31。
- `cumulative-view` 独立 GUI 验证 **6/6**（真实 Skyline 渲染）。
- 报告：`docs/V1.4.1_UI_COMPATIBILITY.md`
- 提交：`45163fc8ad0ae134b5c0a6437c7fcd9b1d72b84f`

### Gate 5 — 收口
- 版本统一 `1.4.1`；文档、验收 ZIP、Git 推送。
- 最终审计：`docs/V1.4.1_FINAL_AUDIT.md`
- 真机清单：`docs/10_DEVICE_ACCEPTANCE.md`

---

## 2. 修改文件总览

### 源码
- `data/quarantine.js`：fail-closed、逐字节校验、结构化结果。
- `data/backup.js`：恢复顺序、安全点失败、回滚状态与错误。
- `packages/importer/core/commit.js`：导入回滚失败组合错误。
- `packages/importer/core/dedupe.js`：索引化去重。
- `packages/importer/pages/import/import.js`：develop-only 注入入口。
- `components/statistics-panel/statistics-panel.wxml`：Hero 加 `id="staHero"`（仅用于滚动截图）。
- `components/statistics-panel/statistics-panel.wxss`：Hero 三列弹性 / nowrap / 窄屏字号。

### 测试
- 新增：`tests/dedupe-index.test.js`、`tests/import-e2e-safety.test.js`、`tests/svg-compat.test.js`、`tests/stats-hero-layout.test.js`、`tests/perf/dedupe.perf.js`。
- 修改：`tests/quarantine-rollback.test.js`、`tests/e2e/{config,run,golden-path}.js`、`tests/run-all.js`。
- `.gitignore`：新增 `artifacts/`。

### 明确未改
- `data/ledger.js`、`data/settings.js`、`data/categories.js`、`data/recurring/**`、`data/budget/**`、`data/statistics/**`、导入 adapters / normalizer / validator、备份格式、主题系统、Bottom Sheet、渲染器。
- 账单 ID、金额精度、日期格式、分类引用、历史账单结构均未改。

---

## 3. 测试原始结果

### 3.1 `npm test`

```
全部测试套件通过（48/48）
```

新增套件计数：

```
dedupe-index.test.js       50 passed, 0 failed
import-e2e-safety.test.js  34 passed, 0 failed
svg-compat.test.js        101 passed, 0 failed
stats-hero-layout.test.js  25 passed, 0 failed
quarantine-rollback.test.js 86 passed, 0 failed
```

### 3.2 `npm run e2e`

```
T01–T31 全部 PASS
结果：31/31 通过，0 失败
```

新增：

- T28 导入：CSV→预览→取消→确认→重复识别→回读
- T29 导入：跨来源疑似重复只标记，需用户确认
- T30 导入：非法内容 / 压缩包明确报错且不写账本
- T31 统计 Hero：长日期 + 长金额三列单行完整（Skyline 实测）

### 3.3 独立 GUI

```
node tests/e2e/cumulative-view.js
PASS 累计趋势模块已启用
PASS 累计 points 有数据（actual=30)
PASS 累计 max > 0
PASS 存在 cumulative-trend 组件
PASS 组件 SVG data-URI 已生成
PASS 恢复默认后累计趋势关闭
GUI 检查汇总：6/6 通过
```

### 3.4 审计

- `theme:audit`：0 FAIL（3 项既有 JS 白色 WARN，不阻断）。
- `contrast:audit`：dark worst 3.145 / light worst 3.249，均 ≥3:1。
- `release:check`：PASS（版本一致性、数据合同、包体、单测、主题 / 对比度）；1 个既有 WARN：`project.config.json` `libVersion=latest`。

### 3.5 性能（Node v24 + 内存 FS，5 轮中位）

| 账本 | 改前 | 改后 | 提升 |
| --- | --- | --- | --- |
| 5,000 | 221.9 ms | 27.8 ms | 8.0× |
| 15,000 | 353.5 ms | 52.9 ms | 6.7× |
| 30,000 | 1,618.2 ms | 96.7 ms | 16.7× |

---

## 4. 数据合同与冻结项

| 模块 | 版本 | 本版 |
| --- | --- | --- |
| Bill 月份分片 | V3（兼容读 V1/V2） | 未改 |
| Backup | V3（兼容恢复 V1/V2） | 未改 |
| Recurring Store | V1 | 未改 |
| Budget | V1 | 未改 |
| 金额 | 整数分 | 未改 |
| 账本存储 | 按月分片 | 未改 |
| 主题 | Theme Manager | 未改 |
| 导入 | 原统一导入引擎 | 仅 dedupe 内部索引 |

---

## 5. 真机验收（未测试）

全部真机项**未测试**，请按 `docs/10_DEVICE_ACCEPTANCE.md` 执行并回填：

- iPhone：首页 / 圆环 / 深浅主题 / 键盘 / Bottom Sheet / 搜索 / 导入 / 备份恢复。
- Android：同上 + 键盘白条 / 高度回落 / 再次编辑。
- 数据安全专项：正常恢复、旧备份兼容、损坏分片隔离、隔离失败不清理、安全点保留、恢复后统计正确。

> 破坏性故障注入只允许在 Node 隔离测试环境执行；**不要求在真实用户数据上人为制造损坏**。

---

## 6. 已知限制（如实记录）

1. 回滚不是数据库级原子操作；本版保证「隔离失败即中止 + 安全点保留 + 明确报错」，不承诺任意中断点自动恢复。
2. 形状非法月份会让安全点构建失败，现转为明确 `SAFETY_POINT_FAILED` 并保留原始分片；`readMonthFile()` 历史读口径未改。
3. 320 / 360 / 430 窄屏本次未重新切换模拟器机型截图，采用 CSS 契约 + 宽度估算；390px 为真实 Skyline 实测。
4. XLSX 未做 GUI 文件选择 E2E，由 `tests/importer.test.js` 覆盖解析与导入。
5. `project.config.json` 仍为 `libVersion=latest`；当前实测基础库 3.17.4，未未经确认固定版本。

---

## 7. Git

| 阶段 | 提交 |
| --- | --- |
| Gate 0 + 1 | `249977111cba1c047f5856cb0745fe88fd5e5d20` |
| Gate 2 | `f78b43629452d243c210845a907f6fbee3c9357b` |
| Gate 3 | `a3cbf345a285c236b382101e28728a0022376d3e` |
| Gate 4 | `45163fc8ad0ae134b5c0a6437c7fcd9b1d72b84f` |
| Gate 5 发布提交 | `6694753fba84bbb27b4719630c5cab079d2d1919` |
| 文档回填提交 | `8ed151ec99c671e25c478210932bc08a7ff1b873` |

最终 HEAD / `origin/main`：`8ed151ec99c671e25c478210932bc08a7ff1b873`（两者一致）。
工作区：无未提交源码修改；仅历史与本轮验收 ZIP（`DailyValue_Mini_v1.4.0_Acceptance.zip`、`jizhang-mini_v1.3.2~1.3.6_acceptance.zip`、`DailyValueMini_v1.4.1_Review.zip`）为本地交付物，未跟踪。
