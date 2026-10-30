# HANDOFF — 随时随地大小记 v1.3.4（Review Fix & Final Reliability Closure）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**1.3.4**
- 品牌名：**随时随地大小记**
- AppID：`wxcdcf83d191065d9`
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + `packages[""]` 两处）、`README.md`、`CHANGELOG.md`）
- 上一版本基线：v1.3.3（HEAD `06c6fe1`，功能主体 `2a49402`）
- 本版定位：**独立代码审查修复，不新增业务功能。** 针对 v1.3.3 交付后的独立审查所指出的 2 个 P1、3 个 P2 实现问题逐项核实并收口，数据合同与依赖全部冻结。
- 后续路线：本版完成后停止，等用户审 main；真机 Gate 由用户本人执行，助手不代签。

---

## 1. 背景与版本号说明

v1.3.3 交付后收到独立代码审查，指出 5 个实现问题，逐项读真实代码核实后全部成立、无误报：

1. **P1 深色对比度审计口径错误**：`contrast.js` 旧 `THEME_BG` 只取页面背景 `--bg`（dark `#05060a`），旧注释假设「更白 surface 上对比度只会更高」；实际月度 / 年度圆环都落在 `.glass-card`，深色 `--card-bg` 是白色半透明渐变（0.09→0.03），深色圆环本身比背景亮，卡片叠白变亮反而降低对比度。
2. **P1 切主题重置统计页状态**：主题回调调完整 `refresh()`，走 `loadMonth`/`loadYear` 重新读取账本、重算，并重置 `shareSelectedId`/`shareExpanded`（及年度对应字段），用户展开态、选中态丢失，大账本下做无谓重读。
3. **P2 迁移沙箱缺异常清理**：`migtest-sandbox` 主体无 try/finally，异常时末尾 `removeSandbox` 不执行，与「无论成败都删沙箱」承诺不符。
4. **P2 测试标识理论误删**：`clearDonut` 与 `cleanupSelftestBills` 都用 `note === 固定标识` 精确匹配后删除，用户若恰有备注 `E2E_DONUT`/`__SELFTEST__` 的真实账单会被误删。
5. **P2 T24 未真正测展开态**：全程未调 `onToggleShareExpand`，检查的 `fullShareList` 在收起态本就无条件构建，且 `refresh` 会把 `shareExpanded` 重置 false，故 T24 无法暴露 P1-2。

**版本号偏离说明**：审查暂定名 v1.3.3.1，但 `release-check` 强制 `^\d+\.\d+\.\d+$`、npm semver 不接受四段纯数字，现有工具链会 FAIL。为零工具链改动，本版采用三段式 **1.3.4**（v1.3.3 的修订版）。

数据合同与依赖在本版**全部冻结**：Bill V3、Backup V3、Recurring Store V1、Budget V1 均不升级，不新增依赖、不新增分类颜色持久化字段、不重新设计圆环、不改变黄金角稳定配色基本原则。

---

## 2. P1 修复：主题局部刷新与 onShow 收口

### 2.1 统计面板局部颜色刷新（`components/statistics-panel/statistics-panel.js`）

- 主题回调由 `this.refresh()` 改为新增的 **`recolorForTheme()`**。
- `loadMonth`/`loadYear` 把 `computeCategoryShare` 的原始（无颜色）结果缓存到 `this._monthShare`/`this._yearShare`。
- `recolorForTheme` 仅用缓存 share 重新 `resolveSegmentColors` 并重建 `shareSegments`/`shareList`/`fullShareList`（及年度对应字段），**不碰年月、选中 id、展开态，不读账本、不重算**。

### 2.2 onShow 冲突修复（`utils/theme.js` + `pages/main/main.js`）

- 修复中发现并收口一个真实缺陷：`main.onShow` 在 `_ready` 为真时无条件 `refreshPanels()`，从外观页切主题返回时，statistics-panel 的完整重载会再次冲掉 `recolorForTheme` 已保留的展开 / 选中态。
- `theme.js` 新增模块状态 `_changeCounter`，每次 `emit()` 递增；新增 `getChangeCounter()`，`_resetForTest` 归零。
- `main.onShow` 读取当前序号，`themeOnly = 当前序号 !== 上次记录`，据此调 `refreshPanels({ preserveStatistics: themeOnly })`；`preserveStatistics=true` 时跳过统计面板完整 refresh，accounting / dailyValue 面板照常刷新。
- 数据变化事件（`onBillSaved`/`onDvSaved`/`onBillDeleted`）不传选项，默认完整 refresh，行为不变。

---

## 3. P1 修复：对比度玻璃卡片背景模型

### 3.1 背景模型重写（`data/statistics/contrast.js`）

- 重写为 `PAGE_BG` + `CARD_WHITE_ALPHA` + `candidateBackgrounds`（page / card-start / card-end 三候选）模型：`overlayWhite` 先把半透明白叠加到页面背景合成真实卡片色，`worstDonutContrast` 枚举全色相在全部候选背景上取全局最差并返回 `minBg`。
- 修复中发现并修掉一个真实缺陷：`donut.js` 内部定义 `DEFAULT_THEME` 但未导出，导致 `donut.DEFAULT_THEME` 为 undefined、unknown 主题回退时 `candidateBackgrounds` 取到 undefined 报错；已在导出列表补 `DEFAULT_THEME`。

### 3.2 明度调整（`data/statistics/donut.js`，S=62，WCAG 非文本 3:1）

- 深色圆环明度 56% → **60%**。旧 L=56 在最亮卡片端 worst=2.578（不达标）；L=60 实测 worst=**3.145**（@hue240，bg=card-start）。
- 浅色明度 34% 保持，worst=**3.249**（@hue60，bg=page）。
- 关键不对称：深色圆环比背景亮，最不利背景是最亮卡片端；浅色圆环比背景暗，最不利背景反而是最暗页面背景。

### 3.3 背景同步防护（`scripts/release-check.js` 6.7 节）

- 新增静态比对：`contrast.js` 的页面背景 / 卡片 alpha 与 `app.wxss` 的 `--bg` / `--card-bg` 不一致即 FAIL，防止样式改动后审计常量未同步。
- 实现中修正一处 bug：先取完整 rgba 字符串再用数字正则会从左侧命中第一个数字 255 而非末尾 alpha；改为带捕获组的全局正则在 exec 循环中取第 4 参数 parseFloat，6.7 六项全 PASS。

---

## 4. P2 修复：沙箱清理与测试标识

### 4.1 迁移沙箱 try/finally（`utils/migtest-sandbox.js`）

- 开头 `removeSandbox` + `ensureDir` 后，主体整体包进 try，清理移到 finally；finally 内清理再单独 try/catch，清理失败只标记 `sandboxRemoved=false`、不抛出，避免覆盖 try 块原始异常。
- 测试侧新增故障注入：写入失败（原始异常保留且沙箱仍清理）、读回失败（非 strict `readJSON` 吞读错返回 fallback，表现为条数不一致）、主体 + 清理同时失败（最终抛原始异常、清理异常不向上冒）。
- 测试范围澄清：`__migtest` 验证旧数据转换 + 沙箱写入 + 分片读回，未执行完整 `migration.runMigration()`（完整迁移事务由 Node 单测覆盖），不能当作完整真机迁移集成测试。

### 4.2 测试运行 ID 精确清理（新增 `utils/test-registry.js`）

- 每次测试生成独立运行 ID（`__TEST__:<runId>`），并持久化到专用清单文件 `__test_registry__.json`。
- `cleanupTestBills` 先按清单 `billIds` 精确 `deleteBill`，再 `rangeBills` 兜底只删 `isTestNote` 残留，最后回写清单。
- 重写 `e2e-donut-seed`（账单 note 改为命名空间前缀，旧裸标识 `E2E_DONUT` 仅作受控 legacy 清理）与 `main`（删除 `SELFTEST_TAG`，自检与清理全部委托 test-registry）。
- **legacy 安全收口**：`clearDonut` 用调用前的 `registryExists()` 快照决定是否清旧裸标识——全新 / 真实账本（无清单文件）不凭普通备注删除，只有测试框架运行过的环境（清单存在）才清旧残留。不改 Bill V3 数据结构。

---

## 5. P2 修复：T24 真实展开与选中态回归（`tests/e2e/golden-path.js`）

- 旧 T24 用 `seedDonut`（5 分类）、全程不展开、不选中；新 T24 改用 `seedDonutMany`（10 分类触发聚合，含子分类与中性色），单个用例内顺序覆盖月度 + 年度两段。
- 真实 tap `.share-toggle` 展开（断言 `shareExpanded=true`、`fullShareList` 行数）→ 真实 tap 圆环第一段中点选中（断言 `shareSelectedId`）→ 切 light → 断言展开 / 选中态仍保持、行数不变、前七项色相身份与明度、子分类中性色、圆环与图例一致 → 切回 dark 断言状态与颜色恢复。年度段同理。

### 编译缓存问题（环境侧，非代码缺陷）

- 首轮 E2E 出现首页不渲染（`pageStack=0`，IDE 窗口最小化、自动重编译未恢复）。最终通过 cli `quit` 关闭全部 IDE → 清空 `WeappCompileCache` 下 hash 子目录（保留父目录、未动 `WeappLocalData`）→ 重新 cli auto 冷启动解决，`pageStack=1`。

---

## 6. 测试真实结果

| 命令 | 结果 |
| --- | --- |
| `npm test` | **35/35 套件通过，0 失败** |
| `npm run e2e` | **T01–T24 全绿 24/24，0 失败**（T24 36.6s 通过），截图均带 `_simulator` 后缀 |
| `npm run theme:audit` | 0 FAIL，3 项 JS WARN 不阻断 |
| `npm run contrast:audit` | 两主题 worst 均 ≥3:1，PASS（dark 3.145 / light 3.249） |
| `npm run release:check` | FAIL 0，WARN 1（libVersion 仍 latest，用户侧项） |
| 5k/15k/30k 大账本 | 未运行：本版按审查意见先收口主题与对比度，真机大账本体验待修复验收后集中测试 |

- 全部改动文件 `node --check` 退出码 0。
- 新增 / 扩展单测：新增 `test-registry`（44）；`contrast` 重写（30）、`migtest-sandbox`（36）、`lazy-compute`（52，含局部刷新第 7 节）、`theme`（71，含变更序号）。

---

## 7. 真机验收（待用户执行，助手不代签）

- **Agent simulator（automator + Skyline）：PASS** —— 单测、E2E、主题 / 对比度审计、release:check 逻辑项均通过。
- **User physical device：NOT TESTED（待用户）**

待验收项：多指触摸、页面滚动、月度 / 年度圆环、深浅主题切换、**展开 / 选中态切主题保持**、5k/15k/30k 账本体验。记录真实设备、微信 / 基础库版本与截图，不把 Node 耗时当真机耗时。

---

## 8. 数据合同冻结声明

v1.3.4 **未升级 / 未改动**任何核心数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1；不新增依赖、不新增分类颜色持久化字段、不加入新业务功能、不重写统计模块。

---

## 9. 已知限制与未完成项

- 真机圆环交互与大账本 Gate 由用户本人完成，结果未测；助手不代签。
- 深色 L=60 在最亮卡片端余量 0.145 偏紧（L=61 余量 0.299 更宽），最终可结合真机观感复核；当前按审查建议采用 L=60。
- 测试桥接模块（含新增 test-registry）物理进发布包，release 下有 fail-closed 守卫不可达，需用户确认是否接受。
- libVersion 仍为 `latest`，体验版验证前保持，属 release:check 唯一 WARN，由用户固定、助手不代猜。

---

## 10. Git 状态

- 基线 `06c6fe1`（v1.3.3）。核心改动：statistics-panel 局部刷新、theme 变更序号、main onShow / refreshPanels、contrast 背景模型、donut 明度与 DEFAULT_THEME 导出、release-check 6.7、migtest-sandbox try/finally、新增 test-registry、e2e-donut-seed 重写、T24 重写、新增 / 重写测试与 run-all 注册、版本文件、README、CHANGELOG 与本 HANDOFF。
- 临时探查脚本（`temp/card-contrast-probe.js`、`temp/probe-stack.js` 等）不进仓库、不提交。
- 中文消息用 `git commit -F <file>`，推送走显式代理 `http://127.0.0.1:33210`。
- 最终结果：HEAD == origin/main，ahead=0 / behind=0（核对 `git rev-list --left-right --count origin/main...HEAD`）。
- 本版本功能主体提交 SHA：`__待提交后回填__`（若 SHA 回填另做仅文档提交，不改动任何代码）。
