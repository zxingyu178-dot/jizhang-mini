# HANDOFF — 随时随地大小记 v0.8.0（Release Hardening & RC）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**0.8.0**
- 品牌名：**随时随地大小记**（v0.8.0 由旧名「每日的价值」全量统一，App 内所有可见标题、隐私说明、诊断、文档口径一致）
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + packages 两处））
- 上一版本基线：v0.7.0（HEAD `9957bdf`）
- 本版定位：发布前**最后一个大阶段**。**不新增任何业务功能，不改动核心数据合同**（Bill V3 / Recurring Store V1 / Budget V1 / Backup V3 全部冻结），只解决「异常数据、升级、恢复、正式发布是否可靠」。

---

## 1. 本版目标

v0.7.0 解决了「正常使用是否完整」。v0.8.0 解决「**发生异常时，会不会安全**」。针对用户代码审查发现的两个数据安全 P0，做发布前加固：

- **P0-A 恢复健康检查发生太晚**：旧 `restoreBackup` 先 `addBills`，内部 `createBill` 自动把非法值「修好」（type 非 income→expense、缺 id→生成、occurredAt 缺/0→now、categoryId 缺→c-other、ledgerImpact 非法→normal），最后才跑健康检查，原始损坏被掩盖、部分损坏备份被静默改义后成功恢复。
- **P0-B 损坏月份文件可能被空文件覆盖**：旧 `readMonthFile` 经 `readJSON` fallback，文件不存在与 JSON 解析失败都回落空结构；损坏月被读成空月，再记一笔就 `writeMonthFile` 覆盖掉可抢救的整月数据。

据此完成 G1–G10（6 项 P0、4 项 P1/P2），G11 收口。

---

## 2. G1–G6 六个 P0

### G1 Strict Month Read（`be1fd09`）

- `data/fs.js` 新增 `fileError` / `readJSONStrict`：三态 `FILE_MISSING / FILE_READ_FAILED / FILE_CORRUPT`，**绝不静默回落**。
- `data/ledger.js` 新增 `SUPPORTED_MONTH_VERSIONS=[1,2,3]`、`monthError`、`validateMonthShape`、`readMonthFileStrict`：
  - 文件不存在 → 返回空月份（可创建）；
  - JSON 损坏 / shape 错误 / version 不支持 → **抛错**。
- 所有写路径改 strict：`addBill` / `addBills`（先全目标月预检）/ `deleteBill` / `updateBill`、两个 schema 迁移、importer commit；Generator 经 ledger.addBill 写，损坏月 addBill 抛错被单规则 try/catch 隔离。
- 新增 `tests/strict-read.test.js`（18 断言）。修复一个时间脆弱测试（异步 generator 给已到期 coffee 规则补记导致「重复导入 expected=4 actual=5」，把 fixture 游标锚定 2099 年）。

### G2 Raw Backup Validator（`c33b37a`）

- 新增 `data/backup-validator.js`：**恢复前只读语义校验、不改非法值、一次收集全部错误**。
  - `validateEnvelope / validateBills / validateCategories / validateSettings / validateRecurringRules / validateCrossReferences`；
  - 复用 `health.analyzeHealth`（把备份账单按业务月份分组、非法 occurredAt 归入 `____` 组，构造内存 rawMonthFiles 喂 analyzeHealth）；
  - 补 envelope / categories 整体结构、settings 结构（含 budget 形态、weekStartsOn、预算规则重复 id）、recurringRules 结构（重复 id + 规则分类交叉引用）。
- `restoreBackup` 接入落盘前校验：**写安全点之前拒绝，非法值不写安全点、不动现有数据**。
- 收紧 health occurredAt 口径（须 finite 且 >0，0 / 负数均报 `bill-occurred-at-invalid`）。
- 新增 `tests/backup-validator.test.js`（57 断言）。

### G3 Backup Migration Pipeline（`8a978a1`）

- 新增 `data/backup-migration.js`：显式、可测试的版本迁移。
  - 明确区分「**补缺省**」（V1 缺 title→''、缺 ledgerImpact→normal；V2 缺 recurringRules→[]、bill 空 recurringRuleId 删除）与「**修非法值**」（损坏 type/ledgerImpact/dailyValue/非空 ruleId 原样保留交 validator，不擅自修）。
- `restoreBackup(input)` 内部 `migrateBackupToV3 → validateBackupRaw`，用 canonical V3 恢复。
- 新增 `tests/backup-migration.test.js`（20 断言）。为未来 V4/V5 预留清晰管线，不再依赖隐式 createBill fallback。

### G4 Storage Integrity Scan（`ba1076f`）

- 新增 `data/storage-integrity.js`：对 manifest / categories / settings / recurring 及全部月份分片做**原始读取**（exists → readText → JSON.parse → shape），给五态：
  - `MISSING / CORRUPT / INVALID_SHAPE / UNSUPPORTED_VERSION / VALID`。
- 只读、不创建目录（月份直接 `fs.listDir` 不 ensure）。`MISSING` 不算 blocking（首装允许）；`ok = 无 CORRUPT / INVALID_SHAPE / UNSUPPORTED_VERSION`。
- 顶层 shape：manifest 须对象 + schemaVersion∈{1,2,3}；categories 须数组 + 元素对象有 id；settings 须对象（budget 若存在须对象 + rules 数组）；recurring 须对象 + version=1 + rules 数组。月份复用 ledger.validateMonthShape 并映射错误码。
- 新增 `tests/storage-integrity.test.js`（24 断言）。

### G5 重复 ID 检测（`567a4d3`）

- 落盘前 validator（G2）已覆盖 category / budget / recurring 重复 id；G5 补齐运行时 `health.analyzeHealth`：
  - catIds 建立时检测 `category-duplicate-id`；
  - ruleIds 建立时检测 `recurring-rule-duplicate-id`；
  - 新增 budgetRuleIds 检测 `budget-rule-duplicate-id`（bill 重复 id 已有）。
- 分类同名可按业务规则决定 error / warning，但 **ID 绝对不能重复**。
- 新增 `tests/duplicate-id.test.js`（5 断言）。

### G6 数据损坏安全模式（`e293ebc`）

- 新增 `data/protection.js`：
  - `buildDiagnostic`：完整性 scan + 尝试 runHealthScan，ID 经 shortId 脱敏；
  - `buildRawExport`：全部关键文件「**原始文本**」（含损坏文本），不做语义改写；
  - `listMonthNames`。
- `app.js`：`onLaunch` 在 `store.init()` 之前先 `scanStorage`——损坏则置 `this.protection / globalData.protection`、**return 不 init**；初始化抛错也进保护模式（initError）；`onShow` 开头保护模式直接 return。
- `main.js / wxml / wxss`：保护模式 `safe-mode`（CSS 圆形警示「!」+ 标题「本地账本文件异常」+ 异常项列表 + 三按钮：**导出原始数据 / 创建诊断 / 从备份恢复**）；正常 UI 用 `<block wx:if="{{!protection}}">` 包裹。
- 修复布局 Bug（`.safe-mode__desc` 无宽度约束溢出，加 `width:100% + box-sizing + word-break`）。
- 新增 `tests/protection.test.js`（10 断言）；截图归档 `docs/screenshots/v0.8.0/protection_safe_mode_simulator.png`（带 `_simulator` 后缀）。
- **核心原则：宁可暂时不能记账，也不能为了继续运行把旧数据覆盖掉；不白屏、不自动清空、不自动修复。**

---

## 3. G7–G10

### G7 灾难演练 + 升级矩阵（`d1097a9`）

- 新增 `tests/disaster-recovery.test.js`（56 断言，在 run-all 注册，现 18 套件）。
- **Part 1 灾难演练（fail-closed + 原账本零污染）**：自建内存文件系统（含 access/mkdir/read/write/unlink/readdir + 快照深拷贝），先建「已知良好账本」，逐场景注入损坏：
  - 非法 type / ledgerImpact、非数 amount、occurredAt=0、缺失 id、重复 bill id、重复 category id、重复周期规则 id、非法周期规则 startDate、重复预算规则 id、非法预算规则 effectiveFrom、周期规则引用未知分类——
  - 每个断言 `restoreBackup` **抛错** 且操作前后文件系统快照**逐字节一致**；另测损坏月份 addBill 抛 `MONTH_CORRUPT` 且原始损坏文本不被覆盖。
- **Part 2 升级矩阵**：Fresh Install（空目录 init→schema=3 / 默认分类设置 / 健康通过）；Bill V1 分片（无 title/ledgerImpact）init→version=3、补 title='' / ledgerImpact=normal、金额/type/occurredAt 不变；Bill V2（含 title/dailyValue）→V3 字段保留；Bill V3 保持；Backup V1/V2/V3 正常备份 restore 均成功且健康通过。
- 踩坑：首跑 `wx is not defined`（顶部 require 早于 setWx），修复为先 buildWx().setWx() 给默认 wx 再 require 模块。

### G8 release:check（`77c75b3`）

- 新增 `scripts/release-check.js`（`npm run release:check`，用真实 node fs），一条命令检查 7 项：
  1. 版本一致性（APP_VERSION 合法 x.y.z 且 == package.json）；
  2. 配置文件（app.json / project.config.json / sitemap.json 合法，renderer=skyline，AppID 正则 wx+16hex）；
  3. 页面与分包（pages 与 subpackages 页面 .js/.wxml 必需，.json/.wxss 缺失仅 WARN）；
  4. 数据合同冻结（ledger/backup/recurring-store/manifest 版本常量）；
  5. Health fixtures（含 dailyvalue-backup-custom.json）；
  6. 包体估算（按 packages/importer 前缀分主包/分包，阈值 主包 2MB / 单分包 2MB / 总包 20MB，接近给 WARN）；
  7. 默认 spawn 跑 npm test（`--no-tests` 可跳过）。
- 首跑发现 ledger 未导出 `SUPPORTED_MONTH_VERSIONS`（补导出后全绿）。

### G9 隐私发布（`4046cf3`）

- App 内文案精确化（`pages/data-privacy/data-privacy.wxml`）：
  - 「是否上传服务器」改为「**本应用不会将账单数据上传至开发者服务器，也没有自建服务器**」；
  - 新增「文件选择与分享」（由微信客户端系统能力完成、不经过开发者服务器）；
  - 新增「剪贴板」（主动点击复制脱敏诊断、**不主动读取剪贴板**）。
- 经核对官方《小程序用户隐私保护指引内容介绍》「隐私接口↔处理的信息」表，确认映射：
  - **MessageFile（收集你选中的文件）= wx.chooseMessageFile**；
  - **Clipboard（读取你的剪切板）= wx.setClipboardData / getClipboardData（本应用只写不读）**；
  - **wx.shareFileMessage 不属「收集」表（用户主动分享，无需勾选信息类型）**。
- 新增平台后台配置清单 `docs/PRIVACY_SETUP_v0.8.0.md`（后台路径、2 项勾选与可直接粘贴的用途文案、联系方式、不勾选项、生效条件：开发版配置即可用 / 线上需重新提审）。**该清单由用户在微信公众平台后台照配，助手不代操作。**

### G10 临时备份清理 + 品牌冻结（`9f30404`）

- 临时备份清理（`pages/backup-restore/backup-restore.js`）：新增 `EXPORT_DIR=USER_DATA_PATH/exports`、`EXPORT_KEEP=3`、`pruneExports()`（列 exports/ 下 .dvmini.json、按文件名日期戳倒序、slice(3) 之后 unlink，约保留最近 3 个本地缓存；分享到微信的副本不受影响）；onExport 改写到 exports/（先 mkdir）。文件名前缀仍为 daily-value-mini-backup-（兼容，未改）。
- 品牌统一为「随时随地大小记」：app.js globalData.appName、app.json navigationBarTitleText、app.wxss 注释、package.json description、main.wxml header__title（5 字→6 字）、diagnosis.js 诊断标题、golden-path T01 断言、README.md、docs/E2E_TESTING.md。
- **保留不改（历史文档快照，如实记录当时品牌）**：docs/HANDOFF_v0.4.0.md、GLASS_UI_REPORT.md、DEVICE_GATE_v0.2.1.md、DEVICE_GATE_v0.3.2.md。

---

## 4. 数据合同冻结声明

v0.8.0 **未改动**以下合同，全部冻结：

- **Bill V3**：分片 `bills/YYYY-MM.json = {ym,version:3,bills:[...]}`；不可变字段 `id/type/amountCents(整数分)/occurredAt/ledgerImpact/dailyValue`，`source`、`recurringRuleId` 沿用。Strict Read 向下兼容读取月份版本 1/2/3。
- **Recurring Store V1**：`recurring.json = {version:1,rules:[...]}`；确定性 Bill id `recur-{ruleId}-{date}-{time}`；MAX_CATCHUP_PER_RULE=365；删除不复活、编辑只影响未来、停用不补。
- **Budget V1**：`settings.budget = {version:1,weekStartsOn,rules:[...]}`。
- **Backup V3**：`daily-value-mini-backup` SCHEMA=3，SUPPORTED=[1,2,3]（经显式迁移管线升级），data 含 `bills,categories,settings,recurringRules`。

---

## 5. 测试结果

### 5.1 纯逻辑单测：`npm test`（`tests/run-all.js`，独立子进程跨平台）

**1023 项全绿、18/18、退出码 0**：

| 套件 | v0.7.0 | v0.8.0 | 结果 |
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
| **storage-integrity.test.js** | — | **24（新增）** | PASS |
| **duplicate-id.test.js** | — | **5（新增）** | PASS |
| **protection.test.js** | — | **10（新增）** | PASS |
| **strict-read.test.js** | — | **18（新增）** | PASS |
| **backup-validator.test.js** | — | **57（新增）** | PASS |
| **backup-migration.test.js** | — | **20（新增）** | PASS |
| **disaster-recovery.test.js** | — | **56（新增）** | PASS |
| importer.test.js | 144 | 144 | PASS |
| **合计** | **833 / 11 套件** | **1023 / 18 套件** | **全绿** |

### 5.2 GUI 端到端：`npm run e2e`（miniprogram-automator + 微信开发者工具）

**T01–T12 全绿 12/12，退出码 0**，自动归档 8 张真实子页截图（`docs/screenshots/e2e/`）。本轮并把截图机制改为「测试中 base64 存内存、disconnect 后落盘项目归档」，规避后台 node 文件沙箱无法写系统 Temp 的 EPERM。

### 5.3 发布检查：`npm run release:check`

**FAIL：0，WARN：0**（版本 0.8.0，7 项检查全过）。

### 5.4 性能：`npm run perf`

1k/5k/10k 全绿、近线性（10k/1k 全量加载比 14.0x，阈值 ≤40x）；分类快照在 520 条当月账单下只读 `categories.json` 1 次。实测：

| 规模 | 全量加载 | 当月 Timeline | 年度统计 | 预算日历 | 全量搜索 | 日价列表 |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 1ms | 1ms | 2ms | 4ms | 3ms | 1ms |
| 5,000 | 6ms | 0ms | 7ms | 11ms | 11ms | 0ms |
| 10,000 | 14ms | 3ms | 13ms | 13ms | 14ms | 1ms |

---

## 6. 包体估算（release:check 实测）

| 范围 | 大小 | 限制 |
| --- | --- | --- |
| 主包（含主包源码） | 402.7 KB | 2 MB |
| importer 分包（xlsx.js ≈952KB / cp936.js ≈347KB 均在分包） | 1359.4 KB | 2 MB |
| 总包 | 1762.1 KB（148 文件） | 20 MB |

最大依赖仍在 importer 分包，未拖慢首页主包；当前无必要优化。

---

## 7. 模拟器验证（已执行）

环境：微信开发者工具 Stable 2.02.2608080，Skyline 模拟器（390×844）。本轮 GUI 验证走 miniprogram-automator WebSocket（不依赖屏幕可见 / 向日葵虚拟会话），选择器与 data 字段以页面源码为准。

### 关键截图（均带 `_simulator` 后缀，未冒充真机）

- `docs/screenshots/v0.8.0/protection_safe_mode_simulator.png`：数据损坏保护模式（警示 + 异常项 + 三按钮）。
- `docs/screenshots/e2e/`（8 张，本轮重拍）：主页（品牌标题「随时随地大小记」）、设置（版本 0.8.0）、分类管理、周期每周日（¥28 / 餐饮·每周·周日 / 下次 10月25日）、停用（显示「已停用」）、重启用、编辑、空态。

### 本轮自动化关键经验（已回填 shared skill）

- 后台 node（Local File sandbox）能写**项目目录**（D 盘 projects/jizhang-mini 及 docs），**不能写**系统 Temp / `D:\AIHome...\temp`（EPERM 含 mkdir/open）；
- 后台 node 无法 spawn cli.bat 拉起 GUI；拉起 GUI 用前台 PowerShell `Start-Process` 独立进程，无空格路径不要手动加引号（会双重引号导致项目不加载）；
- 截图 base64 存内存、disconnect 后落盘项目目录；
- 触发 onLaunch 保护检测须完整冷启动（cli quit + 强杀 + 清 WeappCompileCache + cli auto，约 110s），Ctrl+B 软重载不走完整 onLaunch；写损坏文件须先于编译。

---

## 8. 真机 Gate（待用户执行，助手不代签）

状态如实分开标记：

- **Agent simulator（automator + Skyline）：PASS** —— 单测 1023、E2E 12、性能 1k/5k/10k、release:check 0 FAIL/0 WARN；Strict Read、Raw Backup Validator、迁移管线、完整性扫描、重复 ID、保护模式、隐私文案均通过；**Canvas 曲线除外**。
- **User physical device（Android）：NOT TESTED（待用户）**
- **User physical device（iOS）：NOT TESTED（无真机）**

请在真实微信 Android 上重点验证并回传截图（无 `_simulator` 后缀，建议放 `docs/screenshots/v0.8.0/`）：

1. **`daily_value_curve_android.png`（最高优先级，v0.4.0 起欠账）**：进入日价详情，**日价下降曲线真机可见、触摸定位正确**。模拟器 Skyline 此区空白，真机若正常则**关闭 Gate**、不碰曲线代码；真机也空白才开 P0 Canvas Fix（Skyline Canvas API 修正，或非 Canvas 简化下降趋势 fallback）。
2. `protection_safe_mode_android.png`：损坏数据时进入保护模式、三按钮可用（导出原始数据 / 创建诊断 / 从备份恢复）。
3. `quick_entry_android.png`：快速记账 Sheet 键盘弹起 / 安全区 / 360px 窄屏不遮挡不裁切；`¥999,999.99` 等大金额完整。
4. `glass_sheet_android.png`：各 Bottom Sheet 毛玻璃正文不穿透、无背景文字重影。
5. `category_manage_android.png`：新增 / 改名 / 归档 / 恢复；归档后新记账不可见、历史保留原名。
6. `recurring_android.png`：周期 chips 不错位、停用显示「已停用」、编辑只影响未来、打开即补账且重开不重复、周日规则正确。
7. `brand_title_android.png`：新品牌标题 6 字与搜索 pill / 设置图标 / 微信胶囊不重叠。
8. `large_ledger_android.png`：5,000+ 账单下主页滚动 / 切月 / 统计 / 搜索无明显冻结与崩溃。

> 真实账单只在用户手机本地，不提交 GitHub、不发邮件、不发文件；脱敏诊断不含姓名 / 商户 / 商品 / 账号 / 交易号 / 金额明细 / 文件名。

---

## 9. 待用户操作（助手不代做）

- **微信公众平台《用户隐私保护指引》后台配置**：照 `docs/PRIVACY_SETUP_v0.8.0.md` 配 2 项（MessageFile / Clipboard）。开发版 / 体验版配置即可用，线上需重新提审发布。
- **真机 Canvas 曲线与 Android 主流程验收**（见第 8 节，产物 `*_android.png`，不代签）。

---

## 10. 本版明确不做

v0.8.0 只做发布加固，不做：账户体系、银行卡、资产管理、多人账本、云同步、AI 分类预算、收入预测、更多图表、更多导入源、提醒系统、新主题系统；不做大数据库改造。

---

## 11. 如何进入 1.0

v0.8.0 完成后不再开 v0.9.0 新功能：

```
v0.8.0 Release Hardening
  → 体验版 / 真机验收（隐私配置、Canvas Gate、主流程）
  → 发现问题：v0.8.1 / v0.8.2 只修 Bug
  → 无 P0/P1
  → 1.0.0
```

**1.0 Gate**：Raw Backup 恢复 fail-closed、月份损坏绝不覆盖、健康扫描通过、1023+ 单测全绿、E2E 全绿、Perf 全绿、release:check 0 FAIL/0 WARN、Android Canvas PASS、Android 主流程 PASS、隐私指引配置完成、体验版升级测试完成、备份恢复演练完成。达到后冻结功能、直接发布 1.0。

---

## 12. Git 状态

- v0.8.0 提交（基线 `9957bdf` 之后）：`be1fd09`（G1）、`c33b37a`（G2）、`8a978a1`（G3）、`ba1076f`（G4）、`567a4d3`（G5）、`e293ebc`（G6）、`d1097a9`（G7）、`77c75b3`（G8）、`4046cf3`（G9）、`9f30404`（G10）与本提交（G11：版本 0.8.0 + E2E 截图机制改造 + 8 张截图 + 本 HANDOFF）。
- 推送方式：经显式代理 `http://127.0.0.1:33210`，push 强制 HTTP/1.1。
- 最终结果：HEAD == origin/main，ahead=0 / behind=0，working tree clean（SHA 见 push 后交付说明）。
