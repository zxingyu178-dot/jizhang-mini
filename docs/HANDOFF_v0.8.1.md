# HANDOFF — 随时随地大小记 v0.8.1（真机 UI / 兼容性 Hotfix）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**0.8.1**
- 品牌名：**随时随地大小记**
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + packages 两处）、`README.md`）
- 上一版本基线：v0.8.0 + 真机缺 id 修复（HEAD `a2fe981`）
- 本版定位：**真机 UI / 兼容性 Hotfix，不新增任何业务功能、不改动核心数据合同**（Bill V3 / Recurring Store V1 / Budget V1 / Backup V3 全部继续冻结）。只针对用户真机截图暴露的三个问题，从**公共组件**层修复，不写逐页硬编码。

---

## 1. 本版目标

用户在 Android 真机使用 v0.8.0 时，经截图反馈三个问题。v0.8.1 逐一收口：

1. **Bottom Sheet 透明度穿字**：记一笔 / 新建周期等 Sheet 弹出后，后景正文（本月支出 ¥761.86、时间线、空态文字）仍能清楚辨认。
2. **分类管理「键盘白条」**：在分类编辑输入框聚焦、键盘弹起后，先关 Sheet / 直接返回，页面停留在键盘上推位置——Header 被顶进状态栏、页面整体上移、底部露出大块系统白色。
3. **保护模式真机回归**：配合 `a2fe981` 的历史缺 id 修复，验证真机不再进保护模式（修复本身在 `a2fe981`，本版回归）。

---

## 2. 改动一：透明度收口（公共层，不逐页调）

- **根因**：公共组件 `components/bottom-sheet` 的遮罩仅 `rgba(0,0,0,0.34)`，`--glass-sheet` 主体仅 `rgba(26,30,54,0.90)/rgba(14,18,36,0.92)`；Skyline 真机无可靠 `backdrop-filter` 时，8%~10% 的底层内容足以让文字穿出。
- **修复**（改一处，所有 Sheet 共用）：
  - `app.wxss` 的 `--glass-sheet` 主体提高到 **rgba(26,30,54,0.97) / rgba(14,18,36,0.98)**；顶部紫色 Tint（`rgba(124,134,255,0.16)`，240rpx 淡出）**保留**，单行声明（符合 Skyline 组件 token 单行铁律）。
  - `components/bottom-sheet/bottom-sheet.wxss` 的 `.bs-mask` 0.34 → **0.42**。
- **边界**：主页 Hero、普通玻璃卡（`--glass-card`）**未动**；只改 Overlay / Bottom Sheet 层。目标：能感受到后景仍是紫黑氛围，但正文绝对不可辨认。

---

## 3. 改动二：公共键盘生命周期（新 `utils/keyboard.js`）

- **根因**：旧 `bottom-sheet.close()` 仅 `visible=false` 再 `closed=true`，完全不处理键盘；`page-header` 返回直接 `navigateBack`。「先关 Sheet / 后收键盘」时原生 viewport 错位。
- **新增 `utils/keyboard.js`**：`hideKeyboard(fallbackMs=120)` 返回 Promise。
  - 调 `wx.hideKeyboard`（带 `complete / success / fail`）；
  - 另有 **120ms 超时兜底**；API 缺失、抛错、complete 不触发都 resolve，**绝不因键盘回调异常让 Sheet 永远关不上、页面永远退不出**。
- **重写 `components/bottom-sheet/bottom-sheet.js`**：
  - `close()` 用实例 `_closeSeq` 竞态序号保护：**先 `await keyboard.hideKeyboard()`，再 `visible=false`，300ms 后 `closed=true` + `triggerEvent('closed')`**；
  - `open()` 也递增序号，使进行中的旧 close 失效（快速开关不被旧回调关掉）。
- **`components/page-header/page-header.js`**：`onBack()` 先 `hideKeyboard()`，再 `navigateBack`（栈深 1 时 `reLaunch` 回主页）。

---

## 4. 改动三：Android viewport 恢复保险 + 背景兜底

- **新增 `utils/viewport.js`**（第二层保险，主修仍在键盘生命周期）：
  - `start()` 全局幂等（`app.js` onLaunch 开头调用）：监听 `wx.onKeyboardHeightChange`（键盘高度「从有到无」）与 `wx.onWindowResize`；
  - 触发后 60ms 执行 `device.reset()` + `device.get()` 重测 windowHeight / safeArea，经 `onRecover(cb)` 通知订阅页面重新 setData 布局尺寸；单页回调异常不影响其它页。
- **页面接入**：分类页与周期页 `onLoad` 注册 `viewport.onRecover`（重设 windowHeight / statusBarHeight / headerHeight），`onUnload` 调返回的取消函数。
- **背景兜底（CSS，最坏露黑不露白）**：7 个二级页根容器统一加 `background: var(--bg)`——
  - 分类 `.cm-page`、周期 `.rc-page`、设置 `.settings-page`、预算 `.bs2-page`、备份 `.br-page`、隐私 `.dp-page`、搜索 `.search-page`（日价详情 `.dpage` 已有深色，未改）。
  - 该兜底**不替代**键盘/viewport 主修，仅防某一帧 viewport 抖动露出系统白底。

---

## 5. 改动四：E2E launcher 一键可复跑（Start-Process）

- **问题**：`npm run e2e` 本机 node 直 spawn `cli.bat` 有两种失败：
  - 托管 node（v24）：IDE 子进程写 `User Data\<hash>\Default\.cli` 反复 **EPERM**，automation 端口起不来；
  - 沙箱 node（v22）：能拉起，但隐藏 / 无独立窗口时模拟器**不渲染首页**，`pageStack` 长期为 0，waitForReady 超时。
- **修复**：`tests/e2e/launcher.js` 在 Windows 上改经 `powershell.exe Start-Process -WindowStyle Minimized` 让 `cli.bat` 在独立、最小化窗口启动（等价人工运行 cli auto），IDE 才完整编译并渲染首页；非 Windows 保持原 spawn。
- 超时放宽：`LAUNCH_TIMEOUT` 120s → **180s**、`READY_TIMEOUT` 90s → **120s**（冷启动 + 首页渲染留足时间）。
- 修复后**一键完整跑通**（harness 自启动 → 首页就绪 → 12 用例 → 截图归档），退出码 0。

---

## 6. 数据合同冻结声明

v0.8.1 **未改动**任何数据合同，全部继续冻结：

- **Bill V3**：分片 `bills/YYYY-MM.json = {ym,version:3,bills:[...]}`；不可变字段 `id/type/amountCents(整数分)/occurredAt/ledgerImpact/dailyValue`。
- **Recurring Store V1**：`recurring.json = {version:1,rules:[...]}`；确定性 Bill id `recur-{ruleId}-{date}-{time}`。
- **Budget V1**：`settings.budget = {version:1,weekStartsOn,rules:[...]}`。
- **Backup V3**：`daily-value-mini-backup` SCHEMA=3，SUPPORTED=[1,2,3]（经显式迁移管线升级）。

---

## 7. 测试结果

### 7.1 纯逻辑单测：`npm test`

**1057 项全绿、20/20、退出码 0**。本版新增 `tests/keyboard-viewport.test.js`（15 项）并在 `run-all.js` 注册：

| 套件 | v0.8.0 | v0.8.1 | 结果 |
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
| **keyboard-viewport.test.js** | — | **15（新增）** | PASS |
| strict-read.test.js | 18 | 18 | PASS |
| backup-validator.test.js | 57 | 57 | PASS |
| backup-migration.test.js | 20 | 20 | PASS |
| disaster-recovery.test.js | 56 | 56 | PASS |
| importer.test.js | 144 | 144 | PASS |
| **合计** | **1042 / 19 套件** | **1057 / 20 套件** | **全绿** |

### 7.2 GUI 端到端：`npm run e2e`

**T01–T12 全绿 12/12，退出码 0**，自动归档 8 张真实子页截图（`docs/screenshots/e2e/`，均带 `_simulator` 后缀）。

### 7.3 发布检查：`npm run release:check`

**FAIL：0，WARN：0**（版本 0.8.1，7 项检查全过，真实退出码 0；注意经 PowerShell 管道会让退出码显示假 1，须直接重定向到文件再读 `$LASTEXITCODE`）。

### 7.4 性能：`npm run perf`

1k/5k/10k 全绿、近线性（10k/1k 全量加载比 4.5x，阈值 ≤40x）；分类快照在 520 条当月账单下只读 `categories.json` 1 次。实测：

| 规模 | 全量加载 | 当月 Timeline | 年度统计 | 预算日历 | 全量搜索 | 日价列表 |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 2ms | 1ms | 2ms | — | 1ms | — |
| 5,000 | 6ms | 0ms | 5ms | — | 6ms | — |
| 10,000 | 9ms | 3ms | 12ms | 14ms | 12ms | 0ms |

---

## 8. 真机 Gate（待用户执行，助手不代签）

状态如实分开标记：

- **Agent simulator（automator + Skyline）：PASS** —— 单测 1057、E2E 12、性能 1k/5k/10k、release:check 0 FAIL/0 WARN；透明度、键盘生命周期、viewport 恢复、背景兜底均通过；**Canvas 曲线除外**。
- **User physical device（Android）：NOT TESTED（待用户）**
- **User physical device（iOS）：NOT TESTED（无真机）**

请在真实微信 Android 上重点验证并回传截图（无 `_simulator` 后缀，建议放 `docs/screenshots/v0.8.1/`）：

1. **保护模式回归（最高优先级）**：`a2fe981` + 本版后，**能正常进主页、不再进保护模式**；397 条历史账单数量不减少，金额 / 日期 / 分类 / 收支不变。
2. **`daily_value_curve_android.png`（v0.4.0 起欠账）**：日价详情**下降曲线真机可见、触摸定位正确**。真机正常则**关闭 Gate**；真机也空白才开 P0 Canvas Fix。
3. `glass_sheet_android.png`：记一笔 / 周期 / 分类 / 日价 Sheet 后景**正文不可辨认**，只留紫黑氛围。
4. `category_manage_android.png`：①新增分类→点名称输入框→键盘弹起→**不关键盘直接关 Sheet**；②键盘弹起→**直接点左上返回**。均无白条、Header 不位移。
5. `recurring_android.png`：周期 Sheet 同样做键盘关闭顺序测试，chips 不错位、停用 / 重启用 / 编辑正确。
6. `quick_entry_android.png`：快速记账键盘弹起 / 安全区 / 360px 窄屏，`¥999,999.99` 等大金额不裁切不换行。
7. `large_ledger_android.png`：5,000+ 账单下主页滚动 / 切月 / 统计 / 搜索无明显冻结与崩溃。

> 真实账单只在用户手机本地，不提交 GitHub、不发邮件；脱敏诊断不含姓名 / 商户 / 商品 / 账号 / 交易号 / 金额明细 / 文件名。

---

## 9. 本版明确不做 / 下一步

- v0.8.1 只做真机 UI / 兼容性修复，不做：账户 / 银行卡 / 资产 / 多人账本 / 云同步 / AI / 新导入源 / 提醒 / 新配色。
- **下一步：v0.9.0 Theme & Appearance（主题系统正式上线）**：
  - 只做 **跟随系统 / 深色 / 浅色** 三主题；现有用户 `theme=dark` 保持不变；
  - 建 `utils/theme`（themeMode / effectiveTheme、监听系统主题变化），Design Token 升级为 `.theme-dark / .theme-light`，组件只引用 `var(--*)`、不感知主题；
  - 浅色为浅灰紫 / 白色毛玻璃（非纯白），主色仍紫、支出绿 / 收入红、预算盈余绿 / 超支红。
- 路线：**v0.8.1（本版）→ v0.9.0 主题 → v0.9.1 主题真机 Bug → 1.0.0**。

---

## 10. Git 状态

- v0.8.1 改动（基线 `a2fe981` 之后）：
  - 透明度：`app.wxss`、`components/bottom-sheet/bottom-sheet.wxss`；
  - 键盘：`utils/keyboard.js`（新）、`components/bottom-sheet/bottom-sheet.js`、`components/page-header/page-header.js`；
  - viewport + 背景：`utils/viewport.js`（新）、`app.js`、`pages/category-manage`、`pages/recurring`、其余 5 个二级页 wxss；
  - 测试 / 版本：`tests/keyboard-viewport.test.js`（新）、`tests/run-all.js`、`tests/e2e/config.js`、`tests/e2e/launcher.js`、`utils/version.js`、`package.json`、`package-lock.json`、`README.md`、8 张 E2E 截图与本 HANDOFF。
- 提交方式：中文消息用 `git commit -F <file>`（PowerShell 直接传中文 -m 会被破坏）。
- 推送方式：优先显式代理 `http://127.0.0.1:33210`（HTTP/1.1），失败再直连。
- 最终结果：HEAD == origin/main，ahead=0 / behind=0（核对 `git rev-list --left-right --count origin/main...HEAD`）。
