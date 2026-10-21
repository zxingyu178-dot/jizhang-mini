# HANDOFF — 随时随地大小记 v1.0.0（Final Release Closure）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**1.0.0**
- 品牌名：**随时随地大小记**
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + packages 两处）、`README.md`）
- 上一版本基线：v0.9.1（HEAD `8d46e01`）
- 本版定位：**正式发布收口，不是新功能版本。核心产品功能自 v0.7 起冻结，本版只做发布可靠性修复与发布资料收口，不升级任何核心数据合同。**

---

## 1. 本版目标

用户审 v0.9.1（HEAD 8d46e01）通过后，确认核心产品开发结束，直接进入 1.0.0 Release Closure。继续往代码里查，发现两个 1.0 前必须收掉的代码风险，以及发布资料漂移：

1. **P1：主题保存失败时 UI「假成功」**——`setThemeMode()` 先改内存后写盘，写失败时界面已变但磁盘仍旧，重启后「变回去」。需改为「先写盘成功，再更新内存并通知」。
2. **P1：system 模式缺少前台重新校准**——后台期间系统切换、微信未及时下发 `onThemeChange`，回前台可能停留在旧 effective。需 `refreshSystemTheme()` 并在 `app.onShow` 调用。
3. **发布资料漂移**：README / E2E_TESTING 中硬编码的旧测试数量与版本历史。需新增 CHANGELOG、README 收口、release:check 增强。

---

## 2. 改动一：主题持久化成功后才生效（`utils/theme.js` + `pages/appearance`）

### 2.1 `setThemeMode()` 改造

- **新顺序**：
  1. `next = normalizeMode(mode)`；
  2. **先写磁盘**：读现有 settings（保留 currency/budget），`settings.theme = next`，`fs.writeJSON(...)`；
  3. 写盘抛错 → **内存保持旧主题、不 emit**，返回 `Object.assign({ ok:false }, snapshot())`；
  4. 写成功 → 才更新 `_mode/_effective`，`if (mode/effective 变化) emit()`，返回 `Object.assign({ ok:true }, snapshot())`。
- **返回值**：在原快照字段（mode/effective/themeMode/effectiveTheme/themeClass）基础上增加 `ok` 布尔字段。

### 2.2 外观页失败提示

- `pages/appearance/appearance.js` 的 `onSelect`：`const r = theme.setThemeMode(value)`；`if (!r || !r.ok) wx.showToast({ title:'主题保存失败，请稍后重试', icon:'none' })`。
- 杜绝「选了浅色、重启又变回去」。

---

## 3. 改动二：system 模式前台校准（`utils/theme.js` + `app.js`）

### 3.1 新增 `refreshSystemTheme()`

- `mode !== 'system'`：直接返回当前快照（手动主题不跟随系统）；
- `mode === 'system'`：重新 `getSystemTheme()`，若 `sys !== _effective` 则更新 `_effective` 并 `emit()`；
- 补偿「后台期间系统切换、微信未及时下发 onThemeChange」，与实时 `onThemeChange`、冷启动 `init` 三条路径闭环。

### 3.2 `app.onShow` 接入

- `onShow` 在保护模式检查之后、周期补账之前：
  - `const rs = theme.refreshSystemTheme()`；
  - 更新 `globalData.themeMode/effectiveTheme`；
  - **无条件** `this.syncChrome(rs.effectiveTheme)`（无论是否变化都重守原生窗口，防后台被系统重置，含手动模式）。

---

## 4. 改动三：发布检查增强（`scripts/release-check.js`）

- **第 1 节 Release Manifest**：增加 `package-lock.json` 两处版本（顶层 `version` + `packages[""].version`）与 APP_VERSION 一致性检查。
- **第 2 节**：`project.config.json` 的 `libVersion` 若为 `latest`（或缺失）→ **WARN**（提醒最终体验版验证后固定为实际验证版本，不代猜版本号）；已固定则 PASS。
- **新增第 5.5 节发布文档**：检查 `docs/HANDOFF_v1.0.0.md`、`RELEASE_CHECKLIST_v1.0.0.md`、`DEVICE_GATE_v1.0.0.md`、`PRIVACY_SETUP_v0.8.0.md` 是否存在，缺失即 FAIL。

---

## 5. 改动四：发布资料收口

- **新增 `CHANGELOG.md`**：整理 1.0.0 → 0.1.0 各版本显著变更（Added/Changed/Fixed）；测试数量等易变信息不在此维护。
- **`README.md` 收口**：删除前半部分累积的逐版本长描述与测试章节里硬编码的「套件数 / 用例数」；只保留产品简介、核心功能、技术架构、数据与隐私、运行方式、测试命令、当前版本；版本历史统一指向 CHANGELOG。
- **`docs/E2E_TESTING.md`**：更新过时的「833 项 / 11 套件 / T01–T12」，单测数量改为不硬编码，黄金路径补 T13–T18。

---

## 6. 数据合同冻结声明

v1.0.0 **未升级 / 未改动**任何核心数据合同，全部继续冻结：

- **Bill V3**：分片 `bills/YYYY-MM.json = {ym,version:3,bills:[...]}`，整数分金额。
- **Recurring Store V1**：`recurring.json = {version:1,rules:[...]}`。
- **Budget V1**：`settings.budget = {version:1,weekStartsOn,rules:[...]}`。
- **Backup V3**：`daily-value-mini-backup` SCHEMA=3，SUPPORTED=[1,2,3]（经显式迁移管线升级）。
- 本版不引入 Backup V4，不新增任何业务字段。

---

## 7. 测试结果

### 7.1 纯逻辑单测：`npm test`

**1122 项全绿、21/21、退出码 0**（v0.9.1 1106 → +16）。`tests/theme.test.js` 由 49 项增至 65 项：

| 套件 | v0.9.1 | v1.0.0 | 结果 |
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
| **theme.test.js** | **49** | **65（+16）** | PASS |
| **合计** | **1106 / 21 套件** | **1122 / 21 套件** | **全绿** |

新增用例：

- **THEME-PERSIST-01**：写成功才切换，返回 ok=true，磁盘与内存均 light；
- **THEME-PERSIST-02**：写盘抛错返回 ok=false，mode/effective 保持 dark，磁盘仍 dark；
- **THEME-PERSIST-03**：写盘失败不 emit 假状态（订阅回调 0 次）；
- **THEME-RESUME-01**：system 模式后台 Dark→Light（事件丢失），`refreshSystemTheme` 后 effective 变 light、订阅页收到一次更新；
- **THEME-RESUME-02**：手动 dark 模式系统变化，`refreshSystemTheme` 后 effective 仍 dark、不 emit。

### 7.2 GUI 端到端：`npm run e2e`

**T01–T18 全绿 18/18，退出码 0**，截图均带 `_simulator` 后缀（`docs/screenshots/e2e/`）。本版未改页面接线，E2E 基线沿用。

### 7.3 性能：`npm run perf`

1k/5k/10k 全绿、近线性（阈值 ≤40x）。

### 7.4 发布检查：`npm run release:check`

**FAIL：0，WARN：1**（唯一 WARN：`libVersion` 仍为 `latest`，待最终体验版验证后固定——这是发布前的预期提醒，不是代码缺陷）。

---

## 8. 发布前 Gate（待用户执行，助手不代签）

状态如实分开标记：

- **Agent simulator（automator + Skyline）：PASS** —— 单测 1122、E2E 18、性能、release:check 逻辑项均通过；**Canvas 真机表现、升级 / 恢复演练、原生窗口真机表现除外**。
- **User physical device（Android）：NOT TESTED（待用户）**
- **User physical device（iOS）：NOT TESTED（无真机）**

发布前必须在真实微信 Android 上完成（详见 `docs/DEVICE_GATE_v1.0.0.md` 与 `RELEASE_CHECKLIST_v1.0.0.md`）：

1. **真机主题矩阵**：App 深/浅 × 系统 深/浅 四组合 + system 跟随，重点状态栏、胶囊、页面切换、返回动画、冷启动。
2. **日价 Canvas 曲线（v0.4.0 起欠账）**：深 / 浅均可见、触摸左中右正确、tooltip 不偏；真机正常则正式关闭，仍空白须在发布前修。
3. **升级测试**：用真实本地数据（含历史缺 ID 场景）从 0.8.1 / 0.9.0 / 0.9.1 升级，账单 / 分类 / 日价 / 预算 / 周期 / 主题全部保留。
4. **完整 Backup 灾难演练**：完整备份 → 改数据 → 恢复，账单 / 分类 / 预算 / 周期 / 日价 / 主题同时回来且页面立即变 light、无需重启。
5. **隐私后台配置**：在微信公众平台完成 MessageFile / Clipboard 配置（`docs/PRIVACY_SETUP_v0.8.0.md`），体验版验证选择文件 / 分享备份 / 复制诊断。
6. **固定基础库**：最终体验版验证后，将 `project.config.json` 的 `libVersion` 从 `latest` 改为实际验证版本。

> 真实账单只在用户手机本地，不提交 GitHub、不发邮件；脱敏诊断不含姓名 / 商户 / 商品 / 账号 / 交易号 / 金额明细 / 文件名。

---

## 9. 发布动作（用户本人）

完成上述 Gate 后，按 `docs/RELEASE_CHECKLIST_v1.0.0.md`：

1. 版本冻结（1.0.0）；
2. 微信开发者工具上传体验版、固定基础库；
3. 隐私保护指引后台配置；
4. 审核文案与功能页面配置；
5. 升级测试与正式包截图；
6. 发布说明（以 CHANGELOG 1.0.0 为准）；
7. 提交审核 → 发布。

发布后如再开发，进入 1.1.0；1.0 阶段不再塞入资产 / 银行卡 / AI / 云同步 / 新主题等任何新功能。

---

## 10. Git 状态

- v1.0.0 改动（基线 `8d46e01` 之后）：
  - `utils/theme.js`（setThemeMode 写盘优先 + ok 字段、refreshSystemTheme、导出）；
  - `app.js`（onShow 前台校准 + syncChrome）；
  - `pages/appearance/appearance.js`（失败 toast）；
  - `scripts/release-check.js`（package-lock 版本、libVersion WARN、发布文档节）；
  - `CHANGELOG.md`（新增）、`README.md`（收口）、`docs/E2E_TESTING.md`（更新）；
  - `tests/theme.test.js`（PERSIST/RESUME 16 项）；
  - 版本与文档：`utils/version.js`、`package.json`、`package-lock.json`、本 HANDOFF、RELEASE_CHECKLIST、DEVICE_GATE。
- 提交方式：中文消息用 `git commit -F <file>`。
- 推送方式：mini 优先显式代理 `http://127.0.0.1:33210`（HTTP/1.1），连接重置则直连（清空 proxy）。
- 最终结果：HEAD == origin/main，ahead=0 / behind=0（核对 `git rev-list --left-right --count origin/main...HEAD`）。
