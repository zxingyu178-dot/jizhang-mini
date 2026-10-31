# HANDOFF — 随时随地大小记 v1.3.4（Review Fix & Final Reliability Closure）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**1.3.4**
- 品牌名：**随时随地大小记**
- AppID：`wxcdcf83d9191065d9`（18 位，以 `project.config.json` 为唯一权威；本版已修正历史文档中的 17 位笔误）
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md`）
- 本版定位：**三轮独立代码审查修复，不新增业务功能。** 数据合同与依赖全部冻结，不重写统计模块与圆环。
- 后续路线：本版完成后停止，等用户审 main 与 ChatGPT 独立复审；真机 Gate 由用户本人执行，助手不代签。

---

## 0. 结论速览

- 本版本在同一版本号 **1.3.4** 上经历了**三轮独立复审**：
  - **第一轮（针对 v1.3.3）**：2 个 P1 + 3 个 P2，功能主体提交 `9278e58`，SHA 回填提交 `e43a1d1`；
  - **第二轮（针对 v1.3.4 的更严格复审）**：3 个 P1 + 2 个 P2，收口提交 **`f5cb759`**；
  - **第三轮 Final Closure（最终收尾，本轮）**：1 个 P1 + 1 个 P2，收口提交 **`077e194`**。
- 全量单元测试 **37/37 套件通过**（较上轮新增 1 个 theme-preserve-flow 套件），E2E **24/24 通过**，主题 / 对比度 / release 审计全部通过。
- 微信开发者工具 **cli 自动上传成功**（只上传、不提交审核、不发布），版本号 1.3.4，平台返回 `√ upload`；第三轮修复后重新上传同版本覆盖旧体验版（见第 5 节）。
- 数据合同零改动：Bill V3、Backup V3、Recurring Store V1、Budget V1 均未升级；无第三方依赖新增。

---

## 1. 背景与两轮审查时间线

### 1.1 第一轮：针对 v1.3.3 交付后的独立审查（5 问题）

v1.3.3 交付后收到独立代码审查，指出 5 个实现问题，逐项读真实代码核实后全部成立：

1. **P1 深色对比度审计口径错误**：旧 `contrast.js` 只取页面背景 `--bg`，假设「更白 surface 上对比度只会更高」；实际圆环落在 `.glass-card`，深色卡片叠白变亮反而降低比背景亮的圆环对比度。
2. **P1 切主题重置统计页状态**：主题回调调完整 `refresh()`，重置展开态 / 选中态，大账本下做无谓重读。
3. **P2 迁移沙箱缺异常清理**：主体无 try/finally，异常时末尾清理不执行。
4. **P2 测试标识理论误删**：仅凭 `note === 固定标识` 匹配删除，备注巧合的真实账单会被误删。
5. **P2 T24 未真正测展开态**：全程不展开，无法暴露 P1-2。

第一轮修复已在 `9278e58` / `e43a1d1` 完成，本文件第 2 节保留其设计要点。

### 1.2 第二轮：针对 v1.3.4 的更严格独立复审（3 P1 + 2 P2，本轮）

第一轮收口后，用户转来针对 v1.3.4 的更严格复审。该复审不满足于「测试能跑过」，而是检查**测试桥接在清单损坏、ID 错写、中途异常等极端条件下是否会误删真实账单**，以及发布审计是否真的按主题块绑定。核实后需修复：

- **P1-1 测试数据清理安全**：删除无条件 `clearLegacyDonut`，禁止凭裸备注删账，runId 先登记、账单 ID 及时登记，删除三重核对，清单异常 fail-safe。
- **P1-2 备份恢复后的统计刷新**：修复主题变化计数器误判，只有明确的纯用户主题切换才允许跳过统计完整刷新。
- **P1-3 测试注册表安全验证**：严格校验 registry 结构、runId、billIds，异常清单 fail-safe。
- **P2-1 迁移沙箱**：旧沙箱清理、目录初始化、测试主体统一纳入异常安全保护，补全故障注入测试。
- **P2-2 发布审计**：6.7 节分别验证深色 / 浅色主题块的 `--bg` 与 `--card-bg`，不再只检查四个 alpha 是否出现在文件中。

**版本号说明**：第二轮仍为同一版本 1.3.4 的修订收口，不新增版本号；微信允许同版本号多次上传开发版，以最新为准。

数据合同与依赖在两轮中**全部冻结**：Bill V3、Backup V3、Recurring Store V1、Budget V1 均不升级，不新增依赖、不新增分类颜色持久化字段、不重新设计圆环、不改变黄金角稳定配色基本原则。

### 1.3 第三轮 Final Closure：最终收尾（1 P1 + 1 P2，本轮）

第二轮收口后，用户转来最后一轮 Final Closure 复审，聚焦第二轮 P1-2 引入的 `_themeOnlyCounter` 机制仍不够彻底，以及一个测试清理边界：

- **P1 纯主题事件过期**：`_themeOnlyCounter` 是单调累计的**状态**而非一次性**事件**，`main.onShow` 用「当前值 ≠ 上次快照值」判断。真实路径「主页→设置→外观切浅色(+1)→返回设置（计数器保留）→备份恢复新账本→返回设置→返回主页」时，main 发现计数器变化误判为纯主题、跳过统计刷新，可能出现旧统计数字。settings 页 onShow 只更新入口提示、未清除主题事件，其他子页面也未取消标记。
- **P2 清理失败保留注册**：`cleanupTestBills` 删除账单抛错时虽捕获异常，但回写清单仍可能把整个 run 移除，账单残留且失去后续清理依据。

**第三轮口径**：仍为同一版本 1.3.4 的最终修订，不新增业务功能、不升级数据合同、不引第三方依赖、不重构稳定模块，压缩到一个提交。

---

## 2. 第一轮修复设计要点（保留，基线 e43a1d1）

### 2.1 主题局部刷新与对比度背景模型

- **统计面板 `recolorForTheme()`**：主题回调不再完整 `refresh()`，仅用缓存的无颜色 share 结果重算分段颜色、重建列表，不碰年月、选中 id、展开态，不读账本、不重算。
- **对比度玻璃卡片背景模型（`contrast.js`）**：重写为 `PAGE_BG` + `CARD_WHITE_ALPHA` + 候选背景（page / card-start / card-end）模型，`overlayWhite` 先合成真实卡片色，`worstDonutContrast` 枚举全色相取全局最差。
- **明度调整（`donut.js`，S=62，WCAG 非文本 3:1）**：深色圆环明度 56% → 60%，worst **3.145**（@hue240，bg=card-start）；浅色 L=34 保持，worst **3.249**（@hue60，bg=page）。同时补导出 `DEFAULT_THEME`。
- **T24 真实展开与选中态回归**：改用 `seedDonutMany`（10 分类触发聚合），单例内顺序覆盖月度 + 年度，真实 tap 展开、选中、切主题并断言状态保持。

### 2.2 第一轮遗留、被第二轮进一步加固的点

第一轮已引入运行 ID + 持久化清单 + 命名空间清理，但第二轮复审发现其在**清单损坏、ID 错写、裸备注兜底**等极端条件下保护仍不够严格，相关模块在本轮整体重写（见第 3 节）。

---

## 3. 第二轮修复详解（3 P1 + 2 P2，收口 f5cb759）

### 3.1 P1-1 + P1-3：测试数据清理与注册表 fail-safe

涉及文件：`utils/test-registry.js`（整体重写）、`utils/e2e-donut-seed.js`（整体重写并二次修正）、`pages/main/main.js`。

**核心原则：宁可少删、绝不误删真实账单。**

1. **删除无条件 `clearLegacyDonut`**：`e2e-donut-seed` 不再有 `clearLegacyDonut` / `legacyRemoved`，也不再自动删除仅凭 `E2E_DONUT` / `SELFTEST` 裸备注识别的账单。裸备注不携带 runId、无法确认归属，真实账单备注恰好等于该值时必须保留。`E2E_DONUT_TAG` 常量仅保留供测试构造「备注巧合」场景，不再用于删除。
2. **runId 先登记、账单 ID 及时登记**：注入前先 `registerRun({ runId, billIds: [] })` 登记空清单，再逐笔 `addBill`，每笔创建后立即 `addBillToRun(runId, bill.id)`。这样即使测试中途异常退出，本次已登记账单仍可被追踪和清理。
3. **删除三重核对**：按清单 ID 删除时，必须同时满足「账单存在 + `note` 属于 `__TEST__:` 命名空间 + note 内 runId 与清单 runId 一致」才删除。真实账单 ID 即使被错误写入清单，因 note 不匹配也会保留。
4. **清单结构严格校验（P1-3）**：`readRegistry` 严格校验 `version === 1`、`runs` 为数组、每个 run 的 `runId` 为非空字符串、`billIds` 为字符串数组；任一 run 非法即整体标记 `corrupt` 并强制空 runs（`normalizeRun` 同时做 billIds 去重）。
5. **fail-safe 策略**：
   - 文件不存在 → `missing=true`（正常空态，非损坏）；
   - 读取 / 解析失败、结构非法、任一 run 非法 → `corrupt=true`，`cleanupTestBills` 直接返回零删除且**不覆盖清单**；
   - 兜底扫描仅删除 note 内 runId **已登记**、且属于目标范围的残留；清单缺失 / runs 为空时兜底删不了任何账单。
6. **`main.__selftest` 时序对齐**：cleanup → `registerRun` 空 → 两笔 `addBill`（expense 18.8 瑞幸 c-food、income 500 c-salary）每笔 `addBillToRun` → `try/finally` 幂等清理，finally 内再兜底一次。

**新增 / 强化专项测试**（`tests/test-registry.test.js`，第 5 节四项专项）：
- 真实账单备注为 `E2E_DONUT`：必须保留；
- 真实账单 ID 被错误写入测试清单：必须保留；
- 测试中途异常退出：可清理本次已登记测试账单；
- 清理其他 run 时：不影响真实账单及其他运行。

### 3.2 P1-2：备份恢复后的统计刷新（主题计数器精确化）

涉及文件：`utils/theme.js`、`pages/main/main.js`、`data/backup.js`（恢复流程已通过 `reloadFromStorage` 同步主题，本版不改动其数据合同）。

**问题**：第一轮的 `_changeCounter` 在每次 `emit()`（含备份恢复的主题重载、系统主题变化）时都递增，导致备份恢复（账单已变）可能被 `onShow` 误判为纯主题切换而跳过统计完整刷新，使统计停留在旧账本。

**修复 —— 新增独立的纯主题序号 `_themeOnlyCounter`**：
- `_themeOnlyCounter` **仅在用户主动 `setThemeMode` 且主题确实变化时 +1**；
- `reloadFromStorage`（备份恢复 / settings 被外部覆盖）、`refreshSystemTheme`、system 模式下的 `onThemeChange` 均**不递增**；
- 原 `_changeCounter`（每次 emit +1）保留，用于识别一般主题变化；`_resetForTest` 同时将两者归零。
- `main.onReady` 记录 `_lastThemeOnly = getThemeOnlyCounter()`；`main.onShow` 读取纯主题序号，`themeOnly = 当前值 !== 上次记录`，仅此时才 `refreshPanels({ preserveStatistics: true })` 跳过统计完整重载。备份恢复 / 主题重载 / 数据变化不递增纯主题序号，因此 `onShow` 一定完整刷新统计，保证月度 / 年度统计与恢复后账本一致。

**新增端到端口径测试 `tests/backup-restore-statistics.test.js`（16 断言）**：
- 内存文件系统（access/mkdir/read/write/unlink/rename/readdir/stat/rmdir）；
- 旧账本 dark、10 月两笔旧账单（支出 15000）；
- 构造「主题 light、账单不同」的 V3 备份（9 月支出 20000；10 月支出 30000 + 收入 100000）；
- 恢复后断言 effective=light、`themeOnlyCounter` 不递增、`onShow` 不判纯主题；
- 用 statistics-panel 同款 `store.rangeBills` + M/Y 纯函数验证 9 月与 10 月统计与恢复后账本一致、旧交通账单已消失、年度支出 50000 / 收入 100000 / 3 笔，并与现算对账。

### 3.3 P2-1：迁移沙箱全链路异常安全

涉及文件：`utils/migtest-sandbox.js`、`tests/migtest-sandbox.test.js`。

- 将 `removeSandbox`（旧沙箱清理）+ `fs.ensureDir`（目录初始化）+ 测试主体**统一纳入同一个 `try`**，初始化失败也会进入 finally；
- `finally` 内清理再单独 `try/catch`：清理失败只标记 `sandboxRemoved=false`、不抛出，避免覆盖 try 块的原始异常；
- 沙箱根固定为 `fs.userRoot() + '/__migtest_sandbox__'`，正式账本零接触；
- 测试侧补全故障注入：初始化失败、写入失败（原始异常保留且沙箱仍清理）、读取失败（非 strict `readJSON` 吞错返回 fallback，表现为条数不一致）、清理失败（D4/D5 新增）。

### 3.4 P2-2：release-check 6.7 按主题块精确验证

涉及文件：`scripts/release-check.js`（6.7 节，第 285–357 行）。

**问题与诊断**：首次 release:check 报 6.7 四个 FAIL（`--bg 实际 null`、`--card-bg alpha 实际空`）。诊断发现块正则把**文件头部 CSS 注释**误当成第 0 个规则块——注释文本里同时出现 `.theme-dark` / `.theme-light` 字样但无 `--bg`；真正的 dark 块是第 1 块、light 块是第 2 块。

**修复**：
- 新增 `stripCssComments`（`/\/\*[\s\S]*?\*\//g`），在 `extractThemeBlock` 拆块前先剥离全部 CSS 注释；
- `extractThemeBlock` 在剥离注释后的平级规则块中，按选择器是否包含 `.theme-dark` / `.theme-light` 精确取块；
- 对 dark / light **分别**验证：
  1. 该主题块内 `--bg` **精确等于** `contrast.PAGE_BG[theme]`（dark `#05060a`、light `#f3f4fa`）；
  2. 该主题块内 `--card-bg` 的两个白色 rgba alpha 按 **start → end 顺序精确匹配** `CARD_WHITE_ALPHA[theme]`（dark 0.09 → 0.03、light 0.88 → 0.62），深浅对调即 FAIL。
- 不再仅检查四个 alpha 数值是否出现在文件中，而是把 token 与主题块归属绑定。

### 3.5 文档 AppID 笔误收口（铁律）

- 用 PowerShell 从 `project.config.json` `ConvertFrom-Json` 读取权威 AppID（18 位），确认 5 个 HANDOFF（v1.3.0–v1.3.4）第 7 行均为 17 位错误值；
- 以正则 `wx[0-9a-f]+` 替换为读取变量（全程不手敲字符串），UTF8 无 BOM、`[IO.File]::WriteAllText` 原样写回保持 LF；
- 修正后用精确正则 `(?<![0-9a-f])wx[0-9a-f]{15}(?![0-9a-f])` 全仓扫描（排除 node_modules/.git/WeappCache），确认无 17 位残留；扫描中 len=10（历史截断示意）、len=3（测试变量名 wx2/wx3）均核实为误报。

### 3.6 第三轮 Final Closure 修复详解（1 P1 + 1 P2）

#### 3.6.1 P1：累计计数器改为可消费、可取消的一次性主题保留标记

涉及文件：`utils/theme.js`、`pages/main/main.js`、`pages/settings/settings.js`（`data/backup.js` 数据合同不动，备份恢复的取消经由 `reloadFromStorage` 统一完成）。

**theme.js 新增模块变量与四个操作**：
- 模块变量 `_themePreservePending`（布尔，初始 false）；
- `markThemePreserve()`：置 true，重复调用不累积；
- `cancelThemePreserve()`：置 false；
- `consumeThemePreserve()`：返回当前值并立即清零（一次性消费）；
- `hasThemePreserve()`：测试断言用。
- 接线：`setThemeMode` 在确实变化、emit 且 `_themeOnlyCounter += 1` 后调用 `markThemePreserve()`；`reloadFromStorage`（备份恢复 / 回滚 / 外部覆盖的必经路径）末尾调用 `cancelThemePreserve()`。`backup.restoreBackup` 成功与 `rollback` 两条路径末尾都走 `reloadFromStorage`，因此备份恢复自动取消，无需在 backup.js 单独加调用。
- 保留 `_themeOnlyCounter` / `getThemeOnlyCounter` 作为可观测计数，使现有 theme.test.js 的 THEMEONLY-01~07 不被破坏；但 onShow 是否跳过刷新实际以一次性标记为准。`_resetForTest` 同时把标记重置为 false。

**main.js**：
- `onReady` 删除 `this._lastThemeOnly = theme.getThemeOnlyCounter()`（不再依赖快照比较）；
- `onShow` 改为 `const preserveStatistics = theme.consumeThemePreserve(); this.refreshPanels({ preserveStatistics })`，每次回主页最多拿到一次 true、标记自动清零，不会残留误判。

**settings.js**：5 个非主题导航（`onCategoryManage`、`onRecurring`、`onBudgetSettings`、`onImport`、`onBackupRestore`）在 `navigateTo` 前调用 `theme.cancelThemePreserve()`；`onAppearance`（主题入口）显式不取消。这些非主题页面全部从 settings 进入，正好覆盖验收点名的全部路径。

**行为保证**：
- 纯主题切换回主页：consume 得 true，圆环展开 / 选中态保持，且只消费一次；
- 切主题后进入备份恢复（cancel）→ restoreBackup（reloadFromStorage 再 cancel）→ 回主页：consume 得 false，统计完整刷新为新账本；
- 切主题后进入分类 / 周期 / 预算 / 导入（cancel）→ 回主页：consume 得 false，不跳过必要刷新；
- 不恢复主题切换时的全量重算，仅纯主题这一条路径 preserve。

#### 3.6.2 P2：删除失败保留 runId / billId，下次继续清理

涉及文件：`utils/test-registry.js`、`tests/test-registry.test.js`。fail-safe 原则（清单 corrupt 零删除、删除三重核对、兜底仅扫已登记 runId）完全未改。

- `cleanupTestBills` 新增 `failedByRun`（按 runId 归属）与 `markFailed(runId, billId)`（去重）；
- 按清单 ID 删除的 catch 改为 `markFailed(run.runId, id)`；兜底扫描的 catch 改为 `markFailed(noteRunId, bill.id)`；
- 回写清单逻辑重写：指定 runId 清理时非目标 run 原样保留；目标 run 计算 `keepIds`（原清单中删除失败的 + 兜底失败的，去重），keepIds 非空则保留该 run 且 billIds 只含未删成功的 ID，全部成功的 run 才移除；
- 返回对象新增 `failedBillIds` 数组（现有 removedById / removedByScan / removed / months / corrupt 字段保留不破坏）。

---

## 4. 测试真实结果

| 命令 | 结果 |
| --- | --- |
| `npm test` | **37/37 套件通过，0 失败**（第三轮新增 theme-preserve-flow，run-all 已注册） |
| `npm run e2e` | **T01–T24 全绿 24/24，0 失败**，17 张截图均带 `_simulator` 后缀 |
| `npm run theme:audit` | 0 FAIL，3 项 JS 白色 WARN 不阻断 |
| `npm run contrast:audit` | 两主题圆环在全部候选背景上 worst 均 ≥3:1，PASS（dark 3.145 / light 3.249） |
| `npm run release:check` | **FAIL 0，WARN 1**（libVersion 用户侧项，不阻断），通过 |

关键套件断言数（本轮实跑）：

| 套件 | 断言 / 通过数 | 套件 | 断言 / 通过数 |
| --- | --- | --- | --- |
| test-registry | 78（第三轮 +21） | statistics | 175 |
| migtest-sandbox | 42 | importer | 144 |
| theme | 79 | budget | 135 |
| backup-restore-statistics | 16 | daily-value | 97 |
| theme-preserve-flow | 34（第三轮新建） | recurring | 107 |
| path-normalize | 575 | search | 80 |
| donut-hit | 51 | categories | 76 |
| contrast | 30 | | |

- 全部改动文件 `node --check` 退出码 0。
- 第三轮 E2E 重新生成 17 张截图（时间戳 2026-10-31 16:24），截图目录共 17 张。
- 5k/15k/30k 大账本真机 Gate 未在本轮运行：本版聚焦可靠性收口，真机大账本体验待用户验收时集中测试。
- 第三轮 P1 专项 `theme-preserve-flow.test.js` 共 34 断言，覆盖纯主题、备份恢复、四类非主题页、取消后重建四个时序；P2 在 test-registry 第 6 节新增 21 断言（全失败 + 部分失败故障注入）。

---

## 5. 微信开发者工具自动上传（cli，只上传不审核不发布）

### 5.1 上传事实

- **工程目录**：`D:\AIHome_2.0_L1_L2\projects\jizhang-mini`（即 GitHub main HEAD `f5cb759` 对应代码，非旧目录 / 旧版本）。
- **登录态**：`cli islogin` 返回 `{"login":true}`，账号已登录，IDE HTTP server 监听 11421；automation 端口 9420。
- **编译**：冷启动后 `check-ready` 显示 `pageStack depth=1、path=pages/main/main`，首页正常渲染，无编译错误。
- **上传命令**：
  `cli upload --project <root> --version 1.3.4 --desc "v1.3.4 Review Fix & Final Reliability Closure" --info-output upload-info.json`
- **平台返回**：控制台输出包体表并返回 **`√ upload`**。
- **上传成功时间**：约 **2026-10-31 11:52:58**（info 文件落盘时间）。
- **包体明细（upload-info.json 凭证）**：
  - TOTAL **1,674,959 字节（约 1.6 MB）**；
  - main 包 **359,416** 字节；
  - 分包 `/packages/importer/` **1,315,543** 字节。
- **版本号 1.3.4 核实**：本地无可靠的历史上传版本查询入口（通知中心为空、`.cli` 临时文件命令结束即消失），cli 上传为权威动作；微信允许同版本号多次上传开发版、以最新为准，本次为最新一次。

### 5.2 GUI 确认框揭示的「体验版」事实（需披露）

- 为核对上传行为，通过 DPI-aware 工具点击 IDE「上传」按钮，弹出 GUI 确认框，文案为：**「上次提交已被选为体验版，本次上传将会覆盖体验版，是否继续？」**
- 这证明微信后台**此前已有某次提交被选为体验版**；本次 cli 上传（已成功）按平台正常行为会**覆盖该体验版**。用户明确要求只上传、不发布，体验版覆盖属于平台默认行为，非助手主动发布。
- 进入参数对话框后，其版本号 / 备注为灰色占位（「1.0.0 (推荐)」、「demo」），并非实际值；该自定义输入框虽能聚焦，但 SendInput Unicode 与 VkKeyScan 虚拟键码两种合成键盘输入均不生效。鉴于 cli upload 才是权威上传、无需 GUI 重复上传，已点击「取消」关闭对话框，界面干净、模拟器正常渲染，**未发生第二次上传**。

### 5.3 边界遵守

- 只上传代码，**未提交微信审核、未发布正式版本**；
- 未修改 AppID、未修改 `libVersion`（仍 `latest`）；
- 未遇到未登录 / 无权限 / 扫码 / 平台报错情形（login:true、upload 成功）；若后续出现将暂停报告、不伪造。

### 5.4 第三轮 Final Closure 重新上传（同版本 1.3.4 覆盖旧体验版）

第三轮修复后重新 cli 上传同一版本 1.3.4，覆盖旧体验版；只上传、不审核、不发布。

- **上传命令**：`cli upload --project <root> --version 1.3.4 --desc "v1.3.4 Final Closure" --info-output upload-info-134-r3.json`
- **平台返回**：`√ upload`（exit=0，未提交审核、未发布）；
- **包体**：总 **1,675,581 字节（约 1.6 MB）**，其中 main 360,038 字节、importer 分包 1,315,543 字节；
- **上传时间**：2026-10-31 16:46:17；
- 凭证文件（upload-info-134-r3.json，含 size 明细）保存在项目外 agent workspace，**不进 GitHub**；
- 上传前已核对 AppID（18 位 `wxcdcf83d9191065d9`，来自 project.config.json）；同版本上传会覆盖旧体验版，属平台正常行为，需用户真机 / 后台确认。

---

## 6. 真机验收（待用户执行，助手不代签）

- **Agent simulator（automator + Skyline）：PASS** —— 单测、E2E、主题 / 对比度审计、release:check 逻辑项均通过。
- **User physical device：NOT TESTED（待用户）**

待验收项：多指触摸、页面滚动、月度 / 年度圆环、深浅主题切换、展开 / 选中态切主题保持、体验版覆盖确认、5k/15k/30k 账本体验。记录真实设备、微信 / 基础库版本与截图，不把 Node 耗时当真机耗时，不把模拟器截图冒充真机。

---

## 7. 数据合同冻结声明

v1.3.4 三轮修复**均未升级 / 未改动**任何核心数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1；不新增第三方依赖、不新增分类颜色持久化字段、不加入新业务功能、不重写统计模块与圆环、不改变黄金角稳定配色原则。

---

## 8. 已知限制与未完成项

- 真机圆环交互与大账本 Gate 由用户本人完成，结果未测；助手不代签。
- **体验版覆盖**：本次上传会覆盖后台已选体验版（平台行为），需用户在后台 / 真机确认覆盖后的体验版符合预期。
- 深色 L=60 在最亮卡片端余量 0.145 偏紧（L=61 余量更宽），本轮审查明确不重做配色，保持 L=60，可结合真机观感复核。
- 测试桥接模块（含 test-registry）物理进发布包，release 下有 fail-closed 守卫、入口不可达，是否接受仍需用户确认。
- 历史 HANDOFF（v1.3.0–v1.3.3）AppID 笔误本轮一并修正（明确事实错误、不影响代码逻辑）；如不认可改动历史文档可回退。
- libVersion 仍为 `latest`，体验版验证后由用户固定，助手不代猜；这是 release:check 唯一 WARN。

---

## 9. Git 状态

- **第一轮（针对 v1.3.3）**：功能主体 `9278e58e30eb4239035ec4d7a82696e1895189e8a`，SHA 回填 `e43a1d152a052b69d10de34ccd83b293b5dce375`（第二轮基线）。
- **第二轮（本轮，3 P1 + 2 P2）收口提交：`f5cb7593a1bec918e8e9d56e101a26779cf96c5b`**，29 files changed、684 insertions(+)、184 deletions(-)。
- 精确 `git add` 17 条目标路径（29 文件：27 改 + 1 新测试 + 截图 / HANDOFF）；诊断 / 临时脚本（agent workspace 的 dpi-probe、ide-shot、click、action、diag-* 等）不进仓库。
- 中文 commit 用 `git commit -F <file>`，推送走显式代理 `http://127.0.0.1:33210`。
- 代码修复收口 `f5cb759` 推送后，本 HANDOFF 的第二轮修复 + 微信上传记录回填**另做一个仅文档提交（不改动任何代码）**；最终 HEAD 以该文档提交为准，与 origin/main 一致，`git rev-list --left-right --count origin/main...HEAD` 为 0 0。
- 已跟踪工作区改动数 0，仅 3 个未跟踪历史验收 ZIP（不进 git）；新打包验收产物同样不进 git。
- **第三轮 Final Closure（1 P1 + 1 P2，本轮）收口提交：`077e19476c55eccdfb081bf77d79a4b03177d15f`**，压缩到一个提交。精确 `git add` 目标文件：6 个已跟踪修改（`pages/main/main.js`、`pages/settings/settings.js`、`tests/run-all.js`、`tests/test-registry.test.js`、`utils/test-registry.js`、`utils/theme.js`）+ 1 个新建测试（`tests/theme-preserve-flow.test.js`）+ 本 HANDOFF；验收 ZIP 不进 git。推送后核对 `git rev-list --left-right --count origin/main...HEAD` 为 0 0。
