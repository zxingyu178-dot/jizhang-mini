# HANDOFF — 随时随地大小记 v0.9.1（Theme Real-device Closure & Release Candidate）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**0.9.1**
- 品牌名：**随时随地大小记**
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + packages 两处）、`README.md`）
- 上一版本基线：v0.9.0（HEAD `97d2c8b`）
- 本版定位：**真机主题收口与发布候选，不新增任何业务功能、不升级核心数据合同**（Bill V3 / Recurring Store V1 / Budget V1 / Backup V3 全部继续冻结）。

---

## 1. 本版目标

用户审 v0.9.0（HEAD 97d2c8b）通过后，继续往恢复链路和设置数据里查，发现两个 1.0 前必须收口的真实问题，并给出 Native Chrome Guard 真机风险项：

1. **P0：恢复备份后磁盘 settings.theme 已变，但 Theme Manager 内存不同步**——需要 `theme.reloadFromStorage()`，恢复 / 回滚后立即调用，不依赖重启。
2. **本地非法 theme 仅内存 fallback、磁盘不 canonicalize**——可能导致自己 buildBackup 写入非法 theme 后又被自己的 validator 拒绝；需在完整性扫描通过后由 `settings.ensureSettings()` 把非法值规范为 dark 并落盘。
3. **Native Chrome Guard**：系统主题变化时，手动模式内容不跟随，但原生 Chrome 可能被系统重置，需重守原生窗口。
4. **theme-audit 增加 theme-sensitive JS 白名单 WARN**；新增 THEME-16~20 等单测。

---

## 2. 改动一：Theme Manager 增强（`utils/theme.js`）

### 2.1 新增 `reloadFromStorage()`

- **流程**：`fs.readJSON(paths.FILE.settings, null)`（catch→null）→ `next = normalizeMode(raw && raw.theme)` → 记录 `prevMode/prevEffective` → 赋值 `_mode/_effective` → `if (_effective !== prevEffective || next !== prevMode) emit()`。
- **语义**：用于「恢复了一个浅色备份，当前 App 立即变浅色，无需重启」；不重新注册系统主题监听，也不依赖 init 是否完成。

### 2.2 Native Chrome Guard 机制

- 新增模块级 `_chromeListeners`、`onChromeNeed(cb)`（返回 off）、`emitChrome()`（回调入参为当前 `_effective`，try/catch）。
- 修改 `wx.onThemeChange` 回调：
  - **system 模式**：内容跟随系统（effective 变化才 emit，与旧逻辑一致）；
  - **手动 dark/light 模式**：内容不跟随，但调用 `emitChrome()`，让 app 重新 `syncChrome` 守住可能被系统重置的原生窗口。
- `_resetForTest` 同步清空 `_chromeListeners`。
- 导出新增 `onChromeNeed`、`reloadFromStorage`。

---

## 3. 改动二：Settings 主题规范化（`data/settings.js`）

- 新增 `VALID_THEMES=['dark','light','system']`、`DEFAULT_THEME='dark'`、`canonicalizeTheme(t)`（非法→dark）。
- **`ensureSettings()`**：existing 存在时合并（`Object.assign(DEFAULT_SETTINGS, existing)`），若 `canonicalizeTheme(merged.theme) !== existing.theme` 则写回磁盘（`merged.theme=canon`）；文件不存在才写默认。
- **`getSettings()`**：合并后强制 `merged.theme = canonicalizeTheme(...)`，只读保证返回合法。
- **`updateSettings()`**：合并后 theme 一并规范化再写。
- **关键设计（fail-closed）**：启动前 Theme Manager 与 Storage Integrity 均只读，**不提前写文件**；只有完整性扫描通过后 `store.init` 内的 `ensureSettings` 才落盘修正。由此 Theme Manager / Settings / Backup / Backup Validator 四者口径一致，杜绝「自己生成的备份（含非法 theme）又被自己拒绝恢复」。

---

## 4. 改动三：恢复链路接入（`data/backup.js`）

- 顶部 `require('../utils/theme')`（theme 只依赖 `data/fs` + `data/paths`，无循环依赖）。
- **`restoreBackup`**：健康终检通过、return 前新增第 7 步 `theme.reloadFromStorage()`。
- **`rollback`**：写完回滚的 categories / settings / recurring 后也调用 `theme.reloadFromStorage()`；提前返回分支（`if (!saved || !saved.data) return`）不 reload。

---

## 5. 改动四：app.js 注册 Chrome Guard（`app.js`）

- `initTheme` 中在已有 `theme.subscribe`（内容变化 → 更新 globalData + syncChrome）之后，新增 `theme.onChromeNeed((eff) => this.syncChrome(eff))`。
- 内容主题不变，只重新守住原生窗口颜色。

---

## 6. 改动五：theme-audit JS 白名单 WARN（`scripts/theme-audit.js`）

- 重构 `listFiles(dir, extSet)` 支持传入扩展名集合；原 wxss/wxml 调用改为 `listFiles(dir, SCAN_EXT)`。
- **新增 JS 检查**：
  - `JS_WHITELIST = {app.js, utils/theme.js, components/icon/icon.js, components/daily-value-curve/daily-value-curve.js}`；
  - `JS_SCAN_DIRS = ['utils','components','pages','packages']`；`JS_EXT={.js}`；
  - 仅检测白色：`JS_WHITE_HEX=/#(?:fff|ffffff)\b/gi`、`JS_WHITE_RGB=/rgba?\(\s*255\s*,\s*255\s*,\s*255[^)]*\)/gi`；
  - 非白名单 JS 命中白色则 `[WARN]`（计数 totalJsWarnings，**不 FAIL、不影响退出码**）。
- 不扩大到扫描所有颜色，避免业务红绿 / Canvas 调色板误报。
- 实跑首次发现唯一 WARN：`components/empty-state/empty-state.js` 未使用的残留属性 `iconColor`（默认 `rgba(255,255,255,0.40)`；wxml 中 dv-icon 已用 `tone="faint"`，Grep 全项目 iconColor 仅此一处）。**已删除该未使用属性**，重跑后 0 FAIL / 0 JS WARN / 退出 0。

---

## 7. 数据合同冻结声明

v0.9.1 **未升级 / 未改动**任何核心数据合同，全部继续冻结：

- **Bill V3**：分片 `bills/YYYY-MM.json = {ym,version:3,bills:[...]}`，整数分金额。
- **Recurring Store V1**：`recurring.json = {version:1,rules:[...]}`。
- **Budget V1**：`settings.budget = {version:1,weekStartsOn,rules:[...]}`。
- **Backup V3**：`daily-value-mini-backup` SCHEMA=3，SUPPORTED=[1,2,3]（经显式迁移管线升级）。
- 本版只修复恢复链路与 settings 中 theme 的口径，**不引入 Backup V4**。

---

## 8. 测试结果

### 8.1 纯逻辑单测：`npm test`

**1106 项全绿、21/21、退出码 0**（v0.9.0 1085 → +21）。`tests/theme.test.js` 由 28 项增至 49 项：

| 套件 | v0.9.0 | v0.9.1 | 结果 |
| --- | --- | --- | --- |
| device.test.js | 6 | 6 | PASS |
| data.test.js | 100 | 100 | PASS |
| accounting.test.js | 45 | 45 | PASS |
| statistics.test.js | 65 | 65 | PASS |
| daily-value.test.js | 97 | 97 | PASS |
| budget.test.js | 133 | 133 | PASS |
| categories.test.js | 60 | 60 | PASS |
| recurring.test.js | 107 | 107 | PASS |
| settings.test.js | 15 | 15 | PASS |
| health.test.js | 61 | 61 | PASS |
| storage-integrity.test.js | 24 | 24 | PASS |
| duplicate-id.test.js | 5 | 5 | PASS |
| protection.test.js | 10 | 10 | PASS |
| id-repair.test.js | 19 | 19 | PASS |
| keyboard-viewport.test.js | 15 | 15 | PASS |
| strict-read.test.js | 18 | 18 | PASS |
| backup-validator.test.js | 57 | 57 | PASS |
| backup-migration.test.js | 20 | 20 | PASS |
| disaster-recovery.test.js | 56 | 56 | PASS |
| importer.test.js | 144 | 144 | PASS |
| **theme.test.js** | **28** | **49（+21）** | PASS |
| **合计** | **1085 / 21 套件** | **1106 / 21 套件** | **全绿** |

新增用例：

- **THEME-16**：当前 dark → 恢复 theme=light 备份 → mode/effective 立即 light，订阅页面收到更新；
- **THEME-17**：恢复 theme=system 备份 → mode 立即 system（系统深色 effective dark）；
- **THEME-18**：当前 light → 恢复 dark 备份 → 订阅页面立即 dark；
- **THEME-19**：磁盘 settings.theme='blue' → `ensureSettings()` 后 canonical dark 且磁盘已修正，getSettings 返回 dark；
- **THEME-20**：canonical 后 buildBackup 可被自身 `validateBackupRaw` 接受（不报 theme 非法）；
- **THEME-RELOAD-01**：reloadFromStorage 重读磁盘并通知；
- **CHROME-GUARD-01**：手动模式系统变化触发一次 guard、回传当前 effective、内容不变；
- **CHROME-GUARD-02**：system 模式内容跟随、不触发 chrome guard。

> 另：`freshInit` 中增加 `themeCbs.length=0`，避免系统主题回调在多次 init 后累积（保证 chrome guard 触发计数为 1）。

### 8.2 GUI 端到端：`npm run e2e`

**T01–T18 全绿 18/18，退出码 0**，截图均带 `_simulator` 后缀（`docs/screenshots/e2e/`）。v0.9.1 未改页面接线，E2E 基线沿用 v0.9.0 的 T13–T18 主题 Golden Path。

### 8.3 性能：`npm run perf`

1k/5k/10k 全绿、近线性（10k 全量加载 12ms，10k/1k = **12.0x**，阈值 ≤40x）：

| 规模 | 全量加载 | 当月 Timeline | 年度统计 | 预算日历 | 全量搜索 | 日价列表 |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 1ms | 2ms | 2ms | — | 2ms | 0ms |
| 5,000 | 7ms | 1ms | 7ms | — | 8ms | 0ms |
| 10,000 | 12ms | 4ms | 16ms | 19ms | 18ms | 0ms |

### 8.4 发布检查：`npm run release:check`

**FAIL：0，WARN：0**（版本 0.9.1，8 项检查 + 6.5 主题审计全过；含包体估算：主包 441.3 KB / importer 1360.3 KB / 总 1801.6 KB（157 文件））。

---

## 9. 真机 Gate（待用户执行，助手不代签）

状态如实分开标记：

- **Agent simulator（automator + Skyline）：PASS** —— 单测 1106、E2E 18、性能 1k/5k/10k、release:check 0 FAIL/0 WARN；恢复主题同步、settings canonical、chrome guard 逻辑均通过；**Canvas 曲线真机表现除外**。
- **User physical device（Android）：NOT TESTED（待用户）**
- **User physical device（iOS）：NOT TESTED（无真机）**

请在真实微信 Android 上重点验证并回传截图（无 `_simulator` 后缀，建议放 `docs/screenshots/v0.9.1/`）：

1. **深色**：主页视觉与 v0.8.1 / v0.9.0 基本一致（Golden Reference 未改坏）。
2. **浅色**：主页 / Hero / 时间线 / FAB 可读，无白字白底；顶部状态栏图标清楚、胶囊对比足够。
3. **浅色快速记账 Sheet**：不穿字；输入键盘关闭后无白条。
4. **浅色分类管理**：键盘弹出 / 关闭顺序怎么操作都无白条、Header 不位移。
5. **浅色周期记账**：输入 / chips / 开关正常。
6. **浅色统计**：预算日历绿 / 红对比清楚。
7. **浅色日价列表**：正常。
8. **浅色日价详情 Canvas 曲线**：曲线正常、触摸左/中/右正确、浅色/深色都正确（**v0.4.0 起欠账，真机正常则正式关闭；仍空白则本版内修，不拖到 1.0**）。
9. **四种组合**：App 深/浅 × 系统 深/浅，重点看状态栏文字、页面切换、返回动画、胶囊周围、冷启动；确认手动主题不被系统覆盖、Chrome Guard 生效。
10. **跟随系统**：系统 Light↔Dark 实时切换。
11. **冷启动浅色**：无明显长时间黑闪。
12. **完整恢复演练**：100+ Bills、分类 / 预算 / 周期 / 日价、theme=light，恢复后账单 / 分类 / 预算 / 周期 / 日价 / theme 同时回来，且页面立即变 light、无需重启。
13. **数据保护回归**：损坏月份 / 损坏 Backup / 重复 ID / 非法周期规则 / 非法预算规则仍 fail-closed，且不回到启动前偷改 settings。

> 真实账单只在用户手机本地，不提交 GitHub、不发邮件；脱敏诊断不含姓名 / 商户 / 商品 / 账号 / 交易号 / 金额明细 / 文件名。

---

## 10. 本版明确不做 / 下一步

- v0.9.1 只做真机主题收口，不做：OLED 主题、紫/蓝/绿换色、字体大小、动态背景、账户、资产、银行卡、云同步、AI、提醒、新图表、新导入源。
- 完成 v0.9.1 且真机 Gate（含 Canvas）通过后，**不再做 0.9.2，直接进入 1.0.0 Release**。
- **1.0 只做**：版本冻结、微信体验版、隐私保护指引、审核文案、升级测试、正式包截图、发布说明；不再动产品结构。
- 路线：**v0.9.0 → v0.9.1（本版）→ 1.0.0 正式发布**。

---

## 11. Git 状态

- v0.9.1 改动（基线 `97d2c8b` 之后）：
  - `utils/theme.js`（reloadFromStorage、onChromeNeed/emitChrome、onThemeChange 手动模式 emitChrome、_resetForTest、导出）；
  - `data/settings.js`（VALID_THEMES/DEFAULT_THEME/canonicalizeTheme、ensureSettings 落盘、getSettings/updateSettings 规范化）；
  - `data/backup.js`（require theme、restoreBackup 第 7 步 reload、rollback 后 reload）；
  - `app.js`（initTheme 注册 onChromeNeed）；
  - `scripts/theme-audit.js`（listFiles extSet、JS 白名单 WARN、汇总输出）；
  - `components/empty-state/empty-state.js`（删除未使用 iconColor）；
  - `tests/theme.test.js`（THEME-16~20、RELOAD、CHROME-GUARD；freshInit 清 themeCbs）；
  - 版本与文档：`utils/version.js`、`package.json`、`package-lock.json`、`README.md`、本 HANDOFF。
- 提交方式：中文消息用 `git commit -F <file>`（PowerShell 直接传中文 -m 会被破坏）。
- 推送方式：mini 优先显式代理 `http://127.0.0.1:33210`（HTTP/1.1），失败再直连。
- 最终结果：HEAD == origin/main，ahead=0 / behind=0（核对 `git rev-list --left-right --count origin/main...HEAD`）。
