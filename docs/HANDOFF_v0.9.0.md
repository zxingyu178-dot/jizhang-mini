# HANDOFF — 随时随地大小记 v0.9.0（Theme & Appearance 主题系统上线）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**0.9.0**
- 品牌名：**随时随地大小记**
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + packages 两处）、`README.md`）
- 上一版本基线：v0.8.1（HEAD `db5a471`）
- 本版定位：**Theme & Appearance，主题系统正式上线，不新增任何业务功能、不升级核心数据合同**（Bill V3 / Recurring Store V1 / Budget V1 / Backup V3 全部继续冻结）。首版只做 **跟随系统 / 深色 / 浅色** 三主题，不做配色变体、OLED、自定义强调色。

---

## 1. 本版目标

用户审 v0.8.1 通过后指出：核心页面仍有大量深色硬编码（main.wxss=33、statistics-panel.wxss=26、accounting-panel.wxss=24、recurring.wxss=24、daily-value-detail.wxss=17、category-manage.wxss=11），本版真正要解决的是这些，而不是只加一个切换按钮。交付要点：

1. **Theme Manager**：新建 `utils/theme.js`，统一 mode / effective 解析、持久化、订阅通知、`bindPage`。
2. **双主题 Token**：`app.wxss` 拆为 `page` 深色 fallback + `.theme-dark` / `.theme-light`，补全语义 token；深色保持紫黑毛玻璃 Golden Reference 不改坏。
3. **浅色非纯白**：浅灰紫白玻璃（`#F3F4FA` 底 + 半透明白卡 + 紫色主色），业务绿 / 红不反转。
4. **图标主题化**：`dv-icon` 加 tone 语义 + dark/light 双调色板。
5. **Canvas / 图表 / 日历主题化**：日价曲线、统计、预算日历随主题重绘。
6. **外观页 + 设置入口**：`pages/appearance`，点击即时生效，无保存按钮。
7. **状态栏同步 + 避免冷启动黑闪**；page-header 双击返回锁、main 接 viewport。
8. **theme-audit + backup-validator 主题校验**，接入 `release:check`。

---

## 2. 改动一：Theme Manager（新 `utils/theme.js`）

- **模型**：
  - `themeMode = 'dark' | 'light' | 'system'`（用户选择）；
  - `effectiveTheme = 'dark' | 'light'`（实际生效，system 时跟随系统）。
- **导出**：`VALID_MODES=['dark','light','system']`、`DEFAULT_MODE='dark'`、`normalizeMode`（非法→dark）、`getSystemTheme`（`wx.getAppBaseInfo().theme` → `getSystemInfoSync` 兜底 → dark）、`init`（幂等）、`subscribe`（返回 off）、`getThemeMode/getEffectiveTheme/getThemeClass`、`setThemeMode`、`bindPage`、`_resetForTest`。
- **fail-safe**：settings.theme 出现非法值（blue/123/null）一律归一为 dark，不崩。
- **系统主题监听**：`app.json` 已配 `"darkmode": true` 与 `"themeLocation": "theme.json"`，`wx.onThemeChange` 才触发；**仅 system 模式跟随**，手动 dark/light 不被系统改变。
- **轻依赖**：只 `require` 极轻的 `data/fs`（无 require、仅 wx API）+ `data/paths`，不依赖数据层 init，因此可在 `app.onLaunch` 最前初始化。

### 2.1 本轮修复的真实产品 bug：`setThemeMode` 漏发通知

- **现象**：T18 从「浅色」切到「跟随系统」，且模拟器系统恰好是浅色时，选中对勾仍停在「浅色」、页面 `data.themeMode` 读到 light。
- **根因**：旧 `setThemeMode` 仅在 `_effective !== prevEffective` 时才 `emit()`。light → system 且系统为浅色时 effective 不变（仍 light）→ 不 emit → UI 不更新（内部 `_mode` 与持久化已是 system）。
- **修复**：记录 `prevMode`，emit 条件改为 `if (_effective !== prevEffective || next !== prevMode) emit()`——**mode 变化也必须通知**。修复后主题单测 28 项仍全绿。

---

## 3. 改动二：双主题 Token（重写 `app.wxss`）

- **结构**：`page`（布局公共值，兼作深色 fallback，漏接 themeClass 时回到深色而非无样式）+ `page, .theme-dark`（整套深色）+ `.theme-light`（整套浅色）。
- **补全语义 token**（组件只引用 `var(--*)`、不感知主题）：
  - 背景 / 文字：`--page-bg`、`--page-bg-soft`、`--text-primary`、`--text-secondary`、`--text-faint`、`--text-inverse`；
  - 表面：`--surface`、`--surface-strong`、`--surface-soft`、`--card-bg`、`--card-border`、`--card-shadow`、`--divider`；
  - 输入 / Sheet：`--glass-input`、`--glass-input-border`、`--glass-sheet`、`--sheet-mask`；
  - 图标：`--icon-primary`、`--icon-secondary`、`--icon-faint`；
  - 选中 / 悬停：`--selected-bg`、`--hover-bg`；
  - Hero / pill / 开关：`--hero-bg`、`--hero-border`、`--hero-shadow`、`--pill-bg`、`--pill-border`、`--switch-off-bg`；
  - 语义：`--danger`、`--danger-soft`、`--warning`、`--warning-soft`。
- **Skyline 铁律**：所有自定义属性值单行声明，多背景 gradient 逗号连同一行（组件引用多行声明的变量整块不渲染）。
- **深色 Golden Reference**：紫黑毛玻璃视觉保持，v0.9.0 未改坏；浅色 Sheet 同样保持 v0.8.1 的「不穿字」原则（高不透明浅灰白主体）。

---

## 4. 改动三：浅色主题（浅灰紫白玻璃，非纯白）

- **背景**：`#F3F4FA` / `#F5F5FB` 一带，配淡紫蓝柔光；
- **玻璃卡**：`rgba(255,255,255,0.7~0.85)`，边框 `rgba(80,90,130,0.10~0.15)`；
- **文字**：主 `#202334`、次 `rgba(32,35,52,0.62)`；
- **主色**：保持紫 `#6E78F5 / #7C86FF` 系；
- **Hero**：极浅紫蓝渐变 + 白色高光 + 淡紫边框 + 轻阴影，信息结构完全不动；
- **业务色不反转**：支出绿 / 收入红、预算盈余绿 / 超支红，仅在浅色下加深保证白底对比。

---

## 5. 改动四：dv-icon 主题化

- **问题**：旧图标把 color 字符串写进 SVG 再 Base64 data URI，CSS 变量无法进入 Base64 SVG；主题变浅后图标仍白。
- **新增 tone 属性**：`primary / secondary / faint / inverse / brand / danger`（默认 secondary）；`color` 显式色优先，空则按 effectiveTheme + tone 映射。
- **TONE_COLORS**：
  - dark：primary `rgba(255,255,255,.86)`、secondary `.62`、faint `.40`、inverse `#fff`、brand `#7c86ff`、danger `#ef606b`；
  - light：primary `rgba(25,28,40,.88)`、secondary `.58`、faint `.38`、inverse `#fff`、brand `#6e78f5`、danger `#dc4a55`。
- 组件 `attached` 时 `theme.init()` + `subscribe(refresh)`，主题变化即时重染色。

---

## 6. 改动五：Canvas / 图表 / 日历主题化

- **日价曲线** `components/daily-value-curve`：加 `PALETTES`（dark/light），`palette()` 按 `theme.getEffectiveTheme()` 取；`attached` 时 `theme.init()` + `subscribe` 重画。
  - dark：grid `rgba(255,255,255,.06)`、label `.4/.45`、line `#7c86ff`、area `rgba(124,134,255,.32)`；
  - light：grid `rgba(80,90,130,.12)`、label `rgba(32,35,52,.5)`、line `#6e78f5`、area `rgba(110,120,245,.22)`。
- **统计图表 / 预算日历**：白色文字、透明白 divider 全部迁 token，避免浅色背景上 `rgba(255,255,255,.4)` 消失；Canvas 不自动吃 CSS 变量，须显式传 theme。

---

## 7. 改动六：外观页 + 设置入口

- **新 `pages/appearance`**（`.js/.wxml/.wxss/.json`）：三选一卡片（system 跟随系统 / dark 深色 / light 浅色，含描述），行选择器 `.row[data-value="<value>"]`，`onSelect` 从 `dataset.value` 取值调 `theme.setThemeMode`；点击即时生效，**无保存按钮**。
- **设置页**：新增「外观」分组与入口（`onAppearance` → navigateTo appearance），`themeHint` 显示当前（深色 / 浅色 / 跟随系统），chevron 用 tone faint。

---

## 8. 改动七：状态栏同步 / 冷启动黑闪 / 小兼容

- **app.js**：`onLaunch` 最前 `initTheme()`（init 读 mode/effective、写 globalData、`syncChrome`、订阅）；`syncChrome` 按主题 `setNavigationBarColor` / `setBackgroundColor`（feature detect + try/catch），dark 前景白 / light 前景黑；**胶囊为平台控件，不自行绘制、不改其内部样式**。
- **冷启动黑闪**：主题初始化尽量提前，并尽早同步背景色；静态无法完全消除的一帧深色允许极短过渡，列入真机 Gate。
- **page-header 双击返回锁**：加 `_backing`，异步 hideKeyboard 期间快速双击只执行一次导航（避免一下退两级）。
- **main / daily-value-detail 接 viewport**：viewport 恢复时重算 windowHeight / headerHeight / safeBottom / swiperHeight 等（#154 viewport 机制此前只通知分类 / 周期）。

---

## 9. 改动八：theme-audit + backup-validator 校验

- **新 `scripts/theme-audit.js`**（`npm run theme:audit`）：扫描 `pages/components/packages` 下 `.wxss/.wxml` 的 hex 与 rgb/rgba，维护选择器上下文，维护白名单（品牌紫 / 业务绿红黄 / 纯黑投影 / 成功绿底；白色仅 knob/dot 允许）。实跑 8 白名单 / 0 违规 / 退出 0。
- **`scripts/release-check.js`**：插入「6.5 主题硬编码审计」，纳入发布检查。
- **`data/backup-validator.js`**：`validateSettingsStructure` 增加主题校验——缺失允许（旧备份默认 dark）、dark/light/system 合法、其它值 push error `backup-settings-theme-invalid`。不需要 Backup V4（settings 本就在 Backup V3 中）。

---

## 10. 数据合同冻结声明

v0.9.0 **未升级 / 未改动**任何核心数据合同，全部继续冻结；只扩展 `settings.theme` 语义：

- **Bill V3**：分片 `bills/YYYY-MM.json = {ym,version:3,bills:[...]}`，整数分金额。
- **Recurring Store V1**：`recurring.json = {version:1,rules:[...]}`；确定性 Bill id `recur-{ruleId}-{date}-{time}`。
- **Budget V1**：`settings.budget = {version:1,weekStartsOn,rules:[...]}`。
- **Backup V3**：`daily-value-mini-backup` SCHEMA=3，SUPPORTED=[1,2,3]（经显式迁移管线升级）。
- **settings.theme**：由占位 `'dark'` 正式扩展为 `'dark' | 'light' | 'system'`；现有用户 dark 保持、新装默认 dark。

---

## 11. 测试结果

### 11.1 纯逻辑单测：`npm test`

**1085 项全绿、21/21、退出码 0**。本版新增 `tests/theme.test.js`（28 项）并在 `run-all.js` 末尾注册（套件 20→21）：

| 套件 | v0.8.1 | v0.9.0 | 结果 |
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
| **theme.test.js** | — | **28（新增）** | PASS |
| **合计** | **1057 / 20 套件** | **1085 / 21 套件** | **全绿** |

`tests/theme.test.js` 用内存 wx（内存文件 Map + 可切换 sysTheme + onThemeChange 收集），覆盖 THEME-01～15（mode/effective 解析、非法→dark、system 跟随、手动不跟系统、持久化、备份往返、监听器取消、多页订阅）；mock global.Component 覆盖 ICON-THEME-01/02 与 HEADER-BACK-01（快速双击 onBack 只触发一次 navigateBack）。

### 11.2 GUI 端到端：`npm run e2e`

**T01–T18 全绿 18/18，退出码 0**，自动归档 15 张截图（`docs/screenshots/e2e/`，均带 `_simulator` 后缀）。新增主题 Golden Path：

- T13 打开外观（设置入口 → appearance 三选一，**幂等开头先确保深色**）；
- T14 深色→浅色即时生效；T15 浅色主页；T16 浅色设置页；T17 浅色记一笔 Sheet 不穿字；T18 跟随系统选择 + 持久化，结尾恢复深色。

> **E2E 关键经验（本轮坐实）**：cli auto 以 **Minimized 窗口启动时模拟器不渲染（pageStack=0）**；须用 **Normal 窗口**（`Start-Process cli.bat` 不设 -WindowStyle Minimized）+ 清 `WeappCompileCache` 全量编译，模拟器才正常渲染并连入。

### 11.3 性能：`npm run perf`

1k/5k/10k 全绿、近线性（10k/1k 全量加载比 **9.0x**，阈值 ≤40x）；分类快照在 520 条当月账单下只读 `categories.json` 1 次。实测：

| 规模 | 全量加载 | 当月 Timeline | 年度统计 | 预算日历 | 全量搜索 | 日价列表 |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 1ms | 2ms | 1ms | 4ms | 2ms | 0ms |
| 5,000 | 6ms | 1ms | 6ms | 6ms | 7ms | 0ms |
| 10,000 | 9ms | 4ms | 13ms | 13ms | 13ms | 0ms |

### 11.4 发布检查：`npm run release:check`

**FAIL：0，WARN：0**（版本 0.9.0，8 项检查 + 6.5 主题审计全过；含包体估算：主包 437.5 KB / importer 1360.3 KB / 总 1797.9 KB（157 文件）。注意 PowerShell 管道会让退出码显示假 1，须直接重定向到文件再读 `$LASTEXITCODE`）。

---

## 12. 真机 Gate（待用户执行，助手不代签）

状态如实分开标记：

- **Agent simulator（automator + Skyline）：PASS** —— 单测 1085、E2E 18、性能 1k/5k/10k、release:check 0 FAIL/0 WARN；主题切换、图标染色、Canvas 调色板、外观页均通过；**Canvas 曲线真机表现除外**。
- **User physical device（Android）：NOT TESTED（待用户）**
- **User physical device（iOS）：NOT TESTED（无真机）**

请在真实微信 Android 上重点验证并回传截图（无 `_simulator` 后缀，建议放 `docs/screenshots/v0.9.0/`）：

1. `theme_dark_android.png`：深色与 v0.8.1 视觉**基本一致**（Golden Reference 未改坏）。
2. `theme_light_android.png`：浅色顶部状态栏图标清楚、微信胶囊对比足够、首页标题 / 搜索 / 设置图标可见；Hero 有玻璃感。
3. `quick_entry_light_android.png`：浅色记一笔 Sheet **不穿字**；输入键盘关闭后分类 / 周期**无白条**。
4. `budget_calendar_light_android.png`：预算日历绿 / 红仍清楚。
5. `daily_value_curve_light_android.png`：日价曲线浅色可辨（同时确认深色曲线真机可见——v0.4.0 起欠账）。
6. `theme_switch_android.png`：手动切主题**不丢当前页面状态**（统计月份 / 记账 Tab 不跳）；system 模式随系统改变。
7. `cold_launch_light_android.png`：浅色冷启动**无明显长时间黑闪**。

> 真实账单只在用户手机本地，不提交 GitHub、不发邮件；脱敏诊断不含姓名 / 商户 / 商品 / 账号 / 交易号 / 金额明细 / 文件名。

---

## 13. 本版明确不做 / 下一步

- v0.9.0 只做主题系统，不做：账户 / 银行卡 / 资产 / 多人账本 / 云同步 / AI / 新导入源 / 提醒 / 新配色 / 新主题变体（紫蓝红绿、OLED、自定义 Accent）。
- **下一步：v0.9.1 主题真机 Bug 修复（只修 Bug，绝不再加功能）**；之后 **1.0.0 发布**。
- **1.0 Gate**：Raw Backup 恢复 fail-closed、月份损坏绝不覆盖、健康扫描通过、单测全绿、E2E 全绿、Perf 全绿、Android Canvas PASS、Android 主要流程 PASS、隐私指引配置完成、体验版升级测试、备份恢复演练。
- 路线：**v0.9.0（本版）→ v0.9.1 主题真机 Bug → 1.0.0**。

---

## 14. Git 状态

- v0.9.0 改动（基线 `db5a471` 之后）：
  - 主题核心：`utils/theme.js`（新）、`app.js`、`app.json`、`theme.json`（新）、`app.wxss`（重写）；
  - 图标 / Canvas：`components/icon/icon.js`、`components/daily-value-curve/daily-value-curve.js`；
  - 外观页：`pages/appearance/*`（新）、`pages/settings/*`；
  - 页面 / 组件迁移：`pages/main/*`、各 panel、各二级页、importer 分包三页（wxml 根 themeClass + wxss 转 token + js bind/onUnload）；
  - 小兼容：`components/page-header/page-header.js`（_backing 锁）、main / daily-value-detail viewport；
  - 审计 / 校验：`scripts/theme-audit.js`（新）、`scripts/release-check.js`、`data/backup-validator.js`、`package.json`；
  - 测试 / 版本：`tests/theme.test.js`（新）、`tests/run-all.js`、`tests/e2e/golden-path.js`、`utils/version.js`、`package-lock.json`、`README.md`、E2E 截图与本 HANDOFF。
- 提交方式：中文消息用 `git commit -F <file>`（PowerShell 直接传中文 -m 会被破坏）。
- 推送方式：优先显式代理 `http://127.0.0.1:33210`（HTTP/1.1），失败再直连。
- 最终结果：HEAD == origin/main，ahead=0 / behind=0（核对 `git rev-list --left-right --count origin/main...HEAD`）。
