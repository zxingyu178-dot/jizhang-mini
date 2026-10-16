# HANDOFF — DailyValue Mini v0.4.1（Interaction & Visual Polish）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**0.4.1**
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + packages 两处）、`README.md`）
- 上一版本基线：v0.4.0（HEAD `90e74a2`）
- 功能提交：**`5c0e4dc`**（40 files changed，+944 / −292），见文末 Git 状态

---

## 1. 本版目标

v0.4.0 已完成日价核心架构，本版不做预算，**聚焦交互与视觉收口**：修复两个 P0 数据 / 表单问题，把"记一笔"从实心蓝黑 Sheet 改为真正的半透明 Glass Sheet，修金额输入裁切，重排字段，设置页彻底减法，并完成 v0.4.0 遗留真机 Gate 的准备。

预算明确留到 **v0.5.0**，本版未触碰。

---

## 2. 两个 P0 修复

### P0-A：日价详情编辑 normal 账单时，startDate 不再污染原交易 occurredAt

- 问题：日价详情点「编辑」打开 `daily-value-form`，保存时统一写 `occurredAt = startOfLocalDay(startDate)`。对 `normal + dailyValue` 账单，用户改日价起算日期（如把 10-10 18:32 买电脑的起算日改成 9-1），会把**账单本身的交易时间也移到起算日零点**，导致月份支出错位、原交易时间丢失、排序 / 去重指纹改变。
- 修复：新增**纯函数模块 `data/daily-value/form.js`**（数学逻辑不写进组件，可在 Node 直接测试）：
  - `startOfLocalDay(dateStr)`：`yyyy-MM-dd` 本地零点。
  - `buildEditPatch(input)`：
    - `daily-value-only`：`occurredAt = startOfLocalDay(startDate)`（起算日即物品日，可跨月）；
    - `normal`：`occurredAt = input.originalOccurredAt`（**原交易时间绝对保持，仅改 `dailyValue.startDate`**）。
- 重写 `components/daily-value-form/daily-value-form.js`：`edit()` 记录 `editingLedgerImpact` / `editingOccurredAt`；编辑分支保存走 `buildEditPatch`；wxml 按作用域区分说明（normal 显示"修改起算日只影响日价计算，原交易时间保持不变"）。

### P0-B：表单 title / canSubmit 不一致（按钮亮但提交静默失败）

- 问题：编辑普通账单时 `title = bill.title || ''`，而普通记账多用商户 / 分类、title 常为空；`canSubmit` 只看 `amountCents !== 0`，于是"名称空 + 金额有值"时按钮亮，点击后 `onSubmit` 因 title 空静默 return。
- 修复（`form.js`）：
  - `resolveEditTitle(bill, category)`：`bill.title → bill.merchant → category.name → '日价物品'`；
  - `computeFormCanSubmit(title, amountCents)`：`String(title).trim()` 非空 **且** `amountCents !== 0`。
- 组件 `edit()` 用上述函数回填名称与按钮态，**按钮显示状态与 onSubmit 条件完全一致**。

---

## 3. "记一笔"重做真正 Glass Sheet

- 重写 `components/bottom-sheet/bottom-sheet.wxss`：
  - 遮罩 `rgba(0,0,0,.55)` → **`rgba(0,0,0,.34)`**；
  - 面板删除实心 `#161e33 → #10182b`，改为**半透明双层渐变**（顶部轻紫光 `rgba(124,134,255,.12)` + 深色 `rgba(26,30,54,.78) → rgba(14,18,36,.82)`）+ 顶部边缘高光 `rgba(255,255,255,.16)`；
  - 打开 Sheet 后后面主页仍清晰可见（alpha 约 .78~.82）。
- **自然高度**：`bs-body` 改 `flex:0 1 auto + overflow-y:auto`，内容少按内容高度出现；`max-height:88%` 保留，仅字段展开 / 键盘时变高。
- **金额输入裁切**：金额区 `height:132rpx`、input `height:100rpx / line-height:100rpx`、字号 72→68rpx、`align-items:center`；`bill-form` 与 `daily-value-form` 同步。
- **关于 backdrop-filter blur**：为求稳定，当前 wxss **暂未启用 `backdrop-filter`**，以半透明渐变做视觉等价；是否在真机验证稳定后加回 blur（18~24px / saturate 130~150%），列入真机 Gate 待确认（见 §7）。

---

## 4. 记一笔表单交互收口

- **字段顺序重排**（`bill-form.wxml`）：收支 → ¥金额 → 日期 → **计算日价** → 分类 → 商户 → 备注 → 删除 → 确认。"计算日价"上移（与金额、日期直接相关）。
- **收支切换轻量化**：Segmented Control 改轻玻璃底，选中仅轻色 tint + 文本色，未选无背景。
- **分类"最近使用 + 更多"**：`bill-form.js` 新增 `recentCatsFor(type, selectedId)`（从 `rangeBills` 统计该类型分类出现频率，降序取前 5，保证选中分类在内）；第一屏只显示 5 个最近 + 「更多」，点「更多」展开完整分类网格（`flex-wrap`，每行 4 个）；本版分类 emoji 保留。
- **确认按钮减重**：高度 92rpx，有效态半透明紫（.82）+ 轻高光，无效态透明 Surface + 文字弱化，不再厚重实心大板。
- **视觉统一**：`daily-value-form` 的金额行、分类网格、开关、提交按钮改用同一套 Token，记账与日价新增 Sheet 明显属于同一产品。

---

## 5. 设置页彻底减法

- 重写设置主页（`pages/settings/settings.wxml/.js`），仅保留：
  - **数据**：数据导入 ›、备份与恢复 ›
  - **关于**：版本（0.4.1）、数据与隐私 ›
- **备份与恢复合并**：新增 `pages/backup-restore/`（备份：创建 `.dvmini.json` 并发送「文件传输助手」；恢复：从微信文件选择 + 二次确认 + 覆盖提示；旧版本备份仍可恢复）。
- **新增「数据与隐私」页** `pages/data-privacy/`：数据保存在微信本地目录、不上传服务器、无需账号、不使用 OpenID、清理微信数据 / 删除小程序可能丢数据、建议定期备份。
- **导入说明与最近导入移出首页**：均迁入数据导入页（`packages/importer/pages/import`）；导入页底部新增「最近导入」列表（onShow 读历史，前 8 条）。
- **去 emoji / 统一图标**：设置主页无装饰 emoji，列表项为文字 + chevron；返回箭头、chevron 全部统一使用 `dv-icon`（新增 back / chevronRight 用法），不再混用字符。
- 两页均已在 `app.json` 注册：`pages/main`、`search`、`settings`、`backup-restore`、`data-privacy`、`daily-value-detail`。

---

## 6. 曲线触摸坐标修复（真机风险项）

- 问题：`onTouch` 中 `touch.x != null ? touch.x : touch.clientX`，若落到 `clientX` 是页面坐标，不是 Canvas 局部坐标，真机点曲线会偏移。
- 修复（`components/daily-value-curve/daily-value-curve.js`）：`initCanvas` 用 `.fields({node:true,size:true,rect:true})` 缓存 `_rect`；`onTouch` 优先 `clientX - rect.left` 转 Canvas 局部坐标，`touch.x` 兜底。
- 真机需验证：点最左→第 1 天、中间→中间日、最右→今天、tooltip 不出屏。

---

## 7. 测试结果

`npm test`（`tests/run-all.js`，独立子进程，跨平台）：

| 套件 | 数量 | 结果 |
| --- | --- | --- |
| device.test.js | 6 | PASS |
| data.test.js | 92 | PASS |
| accounting.test.js | 45 | PASS |
| statistics.test.js | 65 | PASS |
| daily-value.test.js | 97 | PASS |
| settings.test.js | 15 | PASS |
| importer.test.js | 74 | PASS |
| **合计** | **394** | **全绿，退出码 0（7/7）** |

v0.4.1 新增（未删除任何现有测试）：

- `daily-value.test.js` J 段（编辑 startDate 作用域）：DV-EDIT-NORMAL-01 / 02、DV-EDIT-ONLY-01；
- K 段（表单校验）：DV-FORM-VALID-01 / 02 / 03（共 15 项，套件 82→97）；
- 新建 `tests/settings.test.js`：SETTINGS-01~04（无导入说明 / 无最近导入 / 无 emoji / 备份恢复统一入口）+ 新页面注册断言（15 项）。

---

## 8. 模拟器验证（已执行）

环境：微信开发者工具 Stable 2.02.2608080，miniprogram-automator 0.12.1，Skyline 模拟器。

- 记一笔空 Sheet：半透明、自然高度、字段新顺序、最近 5 分类 + 更多、确认无效态透明；
- 金额：`759.86` / `12345.67` / `999999.99` 均完整显示不裁切，最大金额下按钮转紫可提交；
- 记一笔开启「计算日价」：开关 ON，保存后账本 + 统计 + 日价三处都有；
- 日价列表：Hero「每日总花费 ¥151.82/天 · 4 件」，透明列表 + 细分割，按当前日价降序；
- 日价新增 Sheet：名称 / 金额 / 分类 / 起算日期 / 备注、作用域说明、与记账 Sheet 视觉统一；
- 设置主页（精简无 emoji）、备份与恢复页、数据与隐私页、数据导入页（含最近导入）导航均正常、无异常。

**P0 实操复核（关键）**：对 normal 账单 AirPods Pro（原 occurredAt = `1788969600000` = 2026-09-10 本地零点），在日价详情把起算日改到 2026-07-01 后保存：
- 账单 `occurredAt` **仍为 1788969600000（9月10日，未移动）**；9 月支出仍 ¥918.90（AirPods ¥899 未丢）；7 月不在月份导航、AirPods 不在 7 月；
- 仅 `dailyValue.startDate` 更新为 2026-07-01、日价重算（¥24.97 → ¥8.40，已用 36 → 107 天）。
- 复核完成后已把该测试数据恢复回 2026-09-10。

### 已知模拟器限制
- **Canvas 曲线在 Skyline 模拟器下不渲染**（控制台提示需到真机调试），故截图中曲线区域为空白，属工具限制非代码问题；曲线只能真机验收。

截图目录：`docs/screenshots/v0.4.1/`（quick_entry_glass / quick_entry_amount / quick_entry_daily_value / daily_value_add_glass / settings_main / settings_backup_restore / settings_data_privacy，另 daily_value_detail_simulator 详情参考，共 8 张）。**以上均为开发者工具模拟器截图，不是真机。**

---

## 9. 真机 Gate（待用户执行，助手不代签）

状态如实标记：

- **Android physical device：NOT TESTED（待用户）**
- **iOS physical device：NOT TESTED（无真机）**
- 模拟器：PASS（功能 / 布局，Canvas 曲线除外）

Android 真机需至少完成：
1. 普通账单 ¥100 开「计算日价」→ 记账、统计、日价三处都有；
2. 日价页直接新增 ¥100 物品 → 只进日价、统计不增 100；
3. 改起算日期 → 日价立即变化；
4. 日价详情 → Hero 正确、**Canvas 曲线真机可见**、里程碑正常；
5. 改金额 → Hero / 曲线 / 里程碑同时刷新；
6. normal 账单移出日价 → 普通账单仍存在；
7. daily-value-only 删除 → 整个物品消失；
8. 曲线触摸：左 / 中 / 右定位正确、tooltip 不出屏；
9. 验证 Glass Sheet 半透明视觉，确认是否需启用 backdrop-filter blur；
10. Android `.dvbackup` 导入 → 原有日价正确出现，再次导入不重复。

> 真机截图（`daily_value_curve_android.png`、`daily_value_detail_android.png`）待用户提供，未用模拟器冒充。
> 真实账单只在用户手机本地，不提交 GitHub、不发邮件、不发文件；脱敏诊断不含姓名 / 商户 / 商品 / 账号 / 交易号 / 金额明细 / 文件名。

---

## 10. 本版明确不做

预算（留 v0.5.0）、周期记账、AI、云同步、登录 / OpenID、银行导入、Merchant Rule、自定义统计模块、完整 SVG 分类图标系统、社交分享、排行榜、资产残值、寿命预测、"回本"评价。分类 emoji 本版保留。

---

## 11. Git 状态（已 push）

- 功能 Commit SHA：**5c0e4dce50e91eaedb4627d73e1042cb5b7c14b2**
- 提交信息：`v0.4.1: interaction and visual polish`（文档回填另见后续 commit）
- 推送方式：经显式代理 `http://127.0.0.1:33210`
- 结果：HEAD == origin/main，**ahead=0 / behind=0，working tree clean**
