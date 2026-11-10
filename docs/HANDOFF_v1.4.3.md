# HANDOFF — 随时随地大小记 v1.4.3（Real Tap E2E & Form Usability & Narrow-Screen Fit）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：`fix/stats-hero-narrow-class` → 合并回 `main`
- Version：**1.4.3**
- AppID：`wxcdcf83d9191065d9`
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md`）
- 开发基线：`origin/main` = `6fa12b9`
- 本版定位：**测试真实性补齐（真实点击）+ 记账表单可用性修复 + 统计 Hero 窄屏适配**。不新增业务功能、不动数据合同、不加第三方依赖。
- 完成状态：**READY_FOR_DEVICE_ACCEPTANCE**（自动化全绿；真机 iPhone / Android 未测试，由用户按 `docs/10_DEVICE_ACCEPTANCE.md` 执行）

---

## 0. 结论速览

| 维度 | 结果 |
| --- | --- |
| 真实点击 E2E | 新增 `tests/e2e/real-tap.js`，**14/14 通过**（真实点按 29 次 + 真实键盘输入 23 次） |
| 空金额点保存 | 原来静默 `return`（用户以为坏了），现弹「请先填写金额」+ 1.2 秒节流 |
| 备注长度上限 | 原来 63 字原样落库，现 WXML `maxlength="40"` + 代码兜底截断（含 emoji 半字保护） |
| 窄屏适配 | 全项目宽度断点由 `@media (max-width:360px)` 改为**启动时读屏宽挂类名**（Skyline 下 @media 宽度断点不生效） |
| 宽度断点清零 | 全项目 `@media (max-width: ...)` 宽度断点 **0 处**（契约测试钉死） |
| 单元测试 | **51/51** 套件通过 |
| E2E（GUI 回归） | **31/31** 通过（含 T31 统计 Hero 长日期 + 长金额三列单行完整） |
| `stats-hero-layout.test.js` | 单文件断言由 27 条增至 **47 条** |
| 性能（大账本） | 1k 全量 2ms / 5k 7ms / 10k 13ms，10k/1k = **6.5x**（期望 ≤40x） |
| release:check | **FAIL = 0** / WARN = 1（`libVersion=latest`，客户已定不动） |
| 真机 | **未测试** |

---

## 1. 本轮 4 件事（为什么改、改成什么样）

### 1.1 补上「真实用户操作」这个测试缺口 —— `tests/e2e/real-tap.js`（新增 928 行）

**问题**：原 E2E 虽然 31 项，但金额、备注这类**输入**都是直接调用页面函数赋值，**绕过了键盘**。全库真实键盘输入只有 2 次，且都在周期页。也就是说「用户真的一个一个字敲进去，会不会出问题」这条链路，之前**没被测过**。

**做法**：新增独立套件，全部走真实点按 + 真实 `input` 事件，覆盖六个面：

| 面 | 覆盖内容 |
| --- | --- |
| A 金额输入 | 逐字输入 `1→12→123→1234→1234.→1234.5→1234.56`，落库 123456 分 |
| A 金额边界 | `.` / `0` / `00` / `1.999`（截成 1.99）/ `999999999` / 留空，均不写脏数据 |
| B 备注 | 中文 + 字母数字；63 字超长截断到 40；emoji / 空格 / 尖括号 / 全角标点 / 换行不被破坏 |
| C 分类查找 | 点「更多」6 格 → 12 格；逐个点选切换 `categoryId`、选中态唯一；几何实测底部分类不被裁掉、可滚到 |
| D 收支切换 | 切收入时「计算日价」开关消失、切回恢复；支出 / 收入各存一单，`type` 正确、Hero 汇总分别累加 |
| E / F | 真实点保存进时间线且不重复写；金额输入聚焦后输入框与保存按钮仍在可视区 |

**跑法**：`node tests/e2e/real-tap.js`（**需要非沙箱环境**，与 `npm run e2e` 同）

**实测**：`reports/logs/spec-real-tap.log` —— **14/14 通过，0 失败**。

> ⚠️ 该套件日志里如实记录了一条**未覆盖**：模拟器不会弹真键盘（键盘探针收到的高度事件为空数组），**「键盘弹起是否遮挡输入框」这一项模拟器测不出来**，只能真机验。已作为必查项写入 `docs/10_DEVICE_ACCEPTANCE.md`。

### 1.2 空金额点保存无任何提示（已修）

**问题**：金额没填就点保存，代码里是**静默 `return`** —— 什么都不发生。用户会以为「按钮坏了 / 小程序卡了」。

**改法**：
- 弹「请先填写金额」提示（`wx.showToast`），用户知道差什么；
- 加 **1.2 秒节流**：连点 5 次只弹 1 条，不刷屏；
- **按钮灰态判断逻辑没动**（原来怎么灰现在还怎么灰），只补提示这一层。

**验证**：`real-tap.js` 的 A4 —— 空金额点保存：弹提示、连点 5 次只提示 1 次、不写数据、Sheet 不关。

### 1.3 账单备注没有长度上限（已修）

**问题**：备注能输 63 字并**原样落库**，与周期页「40 字上限」的口径不一致（同一个 App 两套规矩）。

**改法（两层）**：
1. `components/bill-form/bill-form.wxml` 加 `maxlength="40"`（前端拦一道）；
2. `bill-form.js` 再做**代码兜底截断**（防粘贴 / 防其它入口绕过），含 **emoji 半字保护**——不把 emoji 的代理对切成半个乱码。

**验证**：`real-tap.js` 的 B2（63 字 → 截到 40 后落库）、B3（特殊字符不被破坏）。

### 1.4 窄屏适配：`@media` 宽度断点在 Skyline 下不生效（已修）

**问题**：全项目唯一一处宽度断点 `@media (max-width: 360px)` 用在统计 Hero 上。但 **Skyline 渲染下 media queries 只支持 DarkMode，宽度断点大概率不生效** —— 也就是说这段窄屏规则**写在那里等于没写**，窄屏机型上 Hero 三列会挤。

**改法**：
- 去掉 `@media` 宽度断点，改为**启动时读屏宽**（`utils/device.js`），`≤360px` 给根节点挂窄屏类名，窗口变化时跟随已有监听更新；
- 样式改为「基础规则 + `.xxx--narrow` 覆盖规则」，覆盖规则**必须写在基础规则之后**（顺序错就被吃掉，契约测试钉死）；
- 原 `@media` 块**删净**，全项目宽度断点 **0 处**。

**关键证据（390px 下 Skyline 实测）**：

| 状态 | 三列宽度 | 中间列文本高 |
| --- | --- | --- |
| 390px 正常 | 类名无 `narrow`，三列 91.1 / 145.6 / 91.1 | 20 |
| 强制挂窄屏类 | 中间列 → **150.6** | **20 → 17** |

→ 类切换在 Skyline 下**真的生效**，这正是原来 `@media` 做不到的。

**契约测试**：`tests/stats-hero-layout.test.js` 由 3 条钉到 **47 条**断言，其中新增「宽度媒体查询必须为零」「窄屏规则必须写在基础规则之后」等硬约束。

**变异测试（证明这些断言不是摆设）**：故意做 4 种破坏，**全部被抓**：
1. 把 150.6 改回 26rpx；
2. 删掉类名绑定；
3. 把宽度判定写死 `false`；
4. 偷改 360 阈值。

---

## 2. 修改文件（12 个，git 实测）

命令：`git diff --stat 6fa12b9..HEAD` → `12 files changed, 1133 insertions(+), 50 deletions(-)`

**业务代码 6 个**

| 文件 | 改了什么 |
| --- | --- |
| `utils/device.js` | +19 读屏宽、判定窄屏、随窗口变化更新 |
| `components/statistics-panel/statistics-panel.js` | +19 窄屏类名挂载逻辑 |
| `components/statistics-panel/statistics-panel.wxml` | 根节点绑定窄屏类 |
| `components/statistics-panel/statistics-panel.wxss` | +20 窄屏覆盖规则；宽度 `@media` 删净 |
| `components/bill-form/bill-form.js` | +38 空金额提示 + 节流；备注兜底截断（含 emoji 半字保护） |
| `components/bill-form/bill-form.wxml` | 备注 `maxlength="40"` |

**测试 2 个**

| 文件 | 改了什么 |
| --- | --- |
| `tests/e2e/real-tap.js` | **新增 928 行**，14 条真实点击用例 |
| `tests/stats-hero-layout.test.js` | +143，断言 27 → 47 条（含宽度断点为零、规则顺序、变异防护） |

**版本与文档 4 个**

`utils/version.js`、`package.json`、`package-lock.json`、`README.md`（版本号 1.4.2 → 1.4.3 四处同步）

**明确未改**：
- 数据合同（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1）字段集合与版本号；
- 金额 / 统计 / 预算 / 周期算法；账本分片格式；渲染器；第三方依赖（`devDependencies` 仍只有 `miniprogram-automator`）；
- `project.config.json`（`libVersion` 保持 `latest`，客户已定不动，见 §6）。

---

## 3. 测试与审计（全部本轮实跑，日志在 `reports/logs/`）

| 项 | 命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| 单元测试全套 | `npm test` | **51/51 套件通过，0 失败** | `reports/logs/unit.log` |
| GUI E2E 回归 | `npm run e2e` | **31/31 通过，0 失败**（19 张截图） | `reports/logs/e2e.log` |
| 真实点击专项 | `node tests/e2e/real-tap.js` | **14/14 通过，0 失败** | `reports/logs/spec-real-tap.log` |
| 恢复兼容 / 回滚 | `node tests/quarantine-rollback.test.js` | **279 项通过** | `reports/logs/spec-quarantine-rollback.log` |
| 导入回滚安全 | `node tests/import-rollback-safety.test.js` | **54 项通过** | `reports/logs/spec-import-rollback.log` |
| 备份恢复统计 | `node tests/backup-restore-statistics.test.js` | **44 项通过** | `reports/logs/spec-backup-restore.log` |
| 恢复失败交互 | `node tests/recovery-ui-guard.test.js` | **28 项通过** | `reports/logs/spec-recovery-ui.log` |
| 导入匹配索引 | `node tests/dedupe-index.test.js` | **54 项通过** | `reports/logs/spec-dedupe.log` |
| 导入 E2E 安全 | `node tests/import-e2e-safety.test.js` | **48 项通过** | `reports/logs/spec-import-e2e.log` |
| 主题审计 | `npm run theme:audit` | FAIL **0** 处；3 项既有 WARN（不阻断） | `reports/logs/audit-theme.log` |
| 对比度审计 | `npm run contrast:audit` | 两主题 worst ≥ 3:1（dark 3.145 / light 3.249） | `reports/logs/audit-contrast.log` |
| 大账本性能 | `npm run perf` | 1k 2ms / 5k 7ms / 10k 13ms，10k÷1k = 6.5x（期望 ≤40x） | `reports/logs/perf.log` |
| 发布门禁 | `npm run release:check` | **FAIL = 0** / WARN = 1 | `reports/logs/audit-release.log` |

E2E 产物目录：`artifacts/e2e/2026-11-10T03-36-08-666Z`（19 张截图）；real-tap 产物目录：`artifacts/e2e/real-tap/2026-11-10T03-34-26-648Z`（2 张）。

> 导入预览大文件性能（5k 104ms / 15k 169ms / 30k 302ms，红线 1500ms）为**上一轮实测**，本轮**未重跑**；本轮 `npm run perf` 只覆盖大账本 1k/5k/10k 全量与各页面耗时。

---

## 4. 数据合同与依赖（结论：都没变）

| 合同 | 版本 | 本轮结论 |
| --- | --- | --- |
| Bill（账单） | V3 | 字段集合未变（`data/` 本轮不在 diff 清单内） |
| Backup（备份） | V3（恢复兼容 V1 / V2 / V3） | 字段集合未变 |
| Recurring Store（周期规则存储） | V1 | 字段集合未变 |
| Budget（预算） | V1 | 字段集合未变 |

**依赖**：未新增任何第三方依赖。

**依据**：`git diff --name-only 6fa12b9..HEAD` 的 12 个文件里**没有 `data/`、没有 `packages/`**（见 §2）。

---

## 5. 真机验收（未执行）

按 `docs/10_DEVICE_ACCEPTANCE.md` 执行。本轮新增两条必查：

1. **键盘弹起是否遮挡输入框**（模拟器测不出来，只能真机看 —— real-tap 日志已注明键盘探针未覆盖）；
2. **窄屏机型（≤360px）统计 Hero 三列是否不挤**（本版改的就是这段，模拟器几何实测过，真机需确认视觉）。

其余同 v1.4.2：首页、圆环、主题、Bottom Sheet、搜索、导入、备份恢复、数据安全专项。

> 破坏性故障注入只在 Node 隔离测试执行；**不要求在真实用户数据上制造损坏**。

---

## 6. 已知限制 / 遗留（如实列）

| # | 项 | 状态 | 原因 / 下一步 |
| --- | --- | --- | --- |
| 1 | 微信**真机验收** | **未执行** | 需客户在真机按 `docs/10_DEVICE_ACCEPTANCE.md` 逐项勾选 |
| 2 | **发布上线**（上传 / 提审 / 发布） | **未执行** | 等真机验收结论；材料见 `docs/09_WECHAT_UPLOAD.md` |
| 3 | 键盘遮挡输入框 | **自动化未覆盖** | 模拟器不弹真键盘（探针高度事件为空），只能真机验，见 §5 |
| 4 | `libVersion=latest` | **保持不动**（release:check 有 1 条 WARN） | 客户已定不动；不靠关检查隐藏。官方现行做法是后台按体验版/线上版分别设最低基础库，待真机兼容确认后再定 |
| 5 | 320 / 430 窄屏与超宽屏截图 | 未重截 | 390px 为真实 Skyline 实测，其余由 CSS 契约 + 宽度估算覆盖 |
| 6 | XLSX 的 GUI 文件选择 E2E | 未覆盖 | 由 `tests/importer.test.js` 覆盖 |
| 7 | 导入预览 30k 性能 | 沿用上轮 302ms | 本轮未重跑，见 §3 注 |

---

## 7. Git

| 阶段 | 提交 |
| --- | --- |
| 真实点击测试 | `f3005cf` test(e2e): 新增 real-tap 真实点击回归 |
| 表单可用性 | `e23ac53` fix(v1.4.3): 空金额点保存有提示 + 备注 40 字上限 |
| 窄屏适配 | `fd601af` fix(v1.4.3): 统计 Hero 窄屏差异化改为 JS 判定挂类 |
| 版本升号 | `5325f4e` chore(release): 版本号 1.4.2 -> 1.4.3 |

基线：`origin/main` = `6fa12b9`。相对基线的改动面：**12 个文件，1133 增 50 删**。

合并与推送的实际结果（含 merge commit SHA、`HEAD` 与 `origin/main` 是否一致）以交付包内 `git/commits.txt`、`git/status.txt` 的**实时输出**为准，不在本文写死。

---

## 8. 工作区与历史交付包（别误报成脏工作区）

`git status --short` 中的 `??` 项全部是仓库根目录的**历史交付 ZIP**（v1.3.2 ~ v1.4.2），本轮**没删、没改、没移**。

`reports/logs/*.log` 因 `.gitignore` 的 `logs/` 规则**不进入版本库**——这是已知情况，**未改 `.gitignore`**；日志实体在工作区，随验收 ZIP 交付。

---

## 9. 下一步（给接棒的人）

1. **客户**：真机按 `docs/10_DEVICE_ACCEPTANCE.md` 逐项勾选，重点先验 §5 那两条（键盘遮挡、窄屏 Hero）。
2. **真机全绿后**：开发者工具上传 → 提审 → 发布（材料见 `docs/09_WECHAT_UPLOAD.md`）。
3. **同时决定**：是否固定 `libVersion` + 微信后台按体验版/线上版设最低基础库。

---

## 10. 相关文档索引

| 文档 | 内容 |
| --- | --- |
| `docs/HANDOFF_v1.4.3.md` | 本文件 |
| `CHANGELOG.md` | 版本更新（1.4.3 条目在最上） |
| `DEV_LOG.md` | 开发日志（本轮 4 件事 + 验证结果） |
| `TASKS.md` | 任务清单与状态 |
| `docs/10_DEVICE_ACCEPTANCE.md` | 真机验收清单（含本轮新增两条） |
| `reports/final-audit.md` | 最终审计报告 |
| `reports/data-safety.md` | 数据安全报告 |
| `reports/logs/` | 本轮全部真实测试与审计日志 |
| `git/status.txt`、`git/commits.txt` | 工作区与提交的原始记录 |
