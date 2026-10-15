# HANDOFF · DailyValue Mini v0.3.1

> 版本定位：**v0.3 统计正式版的验收 / 修复版**。暂停 v0.4 日价开发，不新增任何业务功能。
> 本版收口两个统计口径问题，并在真机验收前把模拟器侧发现的「柱图不显示 / 分类弹层定位异常」一并修复。

---

## 一、本版代码改动总览

### 1. 年度月均支出口径（P0，`data/statistics/year.js`）

- 旧逻辑：`monthlyAvg = round(expense / 12)`，固定除以 12，导致只有少数月份有支出时月均被严重低估。
- 新逻辑：
  - 累计支出时记录每个月的支出合计 `monthExpense[12]`；
  - 统计 `activeMonths`（支出 > 0 的月份数）；
  - `monthlyAvg = activeMonths ? round(expense / activeMonths) : 0`；
  - 返回值新增 `activeMonths` 字段。
- 分子仍是「有支出月份的总支出」（即全年支出），分母由固定 12 改为实际有支出的月份数；全年无支出为 0。

### 2. 分类支出 Top5 明细只显示支出（P0，`data/statistics/month.js` + `statistics-panel.js`）

- `month.js` 新增并导出纯函数 `listCategoryExpenseBills(bills, catId)`：
  - 过滤 `inLedger(b) && b.type === 'expense' && (b.categoryId || 'c-other') === catId`；
  - 按 `occurredAt` 倒序。
- 统计组件点击分类时复用该纯函数生成明细，收入账单（即便同分类）不再混入。

### 3. 模拟器侧修复：柱图不显示 + 分类弹层定位异常（关键）

排查中发现并修复了两个会影响真机体验的渲染问题：

- **柱图不显示根因**：旧柱布局为「`bar-zone` 中间层（flex:1, min-height:0）+ 柱绝对定位（`absolute; bottom:0; translateX`）+ 柱列 `height:100%`」，这套嵌套在 WebView/Skyline 下 flex 高度 / 定位解析异常，柱在 DOM 中存在但高度不可见。
  - 修复：删除 `bar-zone` 中间层；柱改为正常 flex 流（`width:60%`）；柱列改为 `flex column + justify-content:flex-end`，由容器 `align-items:stretch` 拉伸到高度，不依赖百分比高度和绝对定位。
- **分类明细弹层定位异常**：弹层原先写在 `statistics-panel` 组件内部，组件内 `position:fixed` 相对的是组件宿主（swiper-item）而非视口，且旧写法用了 `inset:0` + flex 对齐，导致弹层标题跑到顶部、与主标题重叠。
  - 修复：将弹层**上移到 `pages/main` 页面级**（页面内 fixed 相对视口）；组件点击分类时改为 `triggerEvent('categorydetail', {title, items})`；弹层采用与已验证的 `bottom-sheet` 相同的可靠模式（四方向 fixed 容器 + 内部 `absolute; bottom:0` 面板），内容区 scroll-view 明确高度，并在内容区底部留 safe-area。

### 4. 加载时序（`statistics-panel.js` + `pages/main/main.js`）

- 统计组件位于 swiper-item 中，未激活时布局未就绪；改为由 `main` 在该 item 首次激活时调用组件的 `activate()`（内部仅执行一次，延迟 220ms 等切换动画稳定后再取数），避免首次进入图表渲染异常。

---

## 二、测试结果

- 入口：工程根 `npm test`（`tests/run-all.js`，子进程依次执行）。
- 结果：**225 项全部通过，exit code = 0（4/4）**：
  - `device.test.js`：6 项
  - `data.test.js`：92 项
  - `statistics.test.js`：65 项（本版新增 10 项：月均口径、分类明细只含支出）
  - `importer.test.js`：62 项
- 新增统计断言要点：
  - 年度月均：2 个有支出月时 `monthlyAvg = expense/2`（原错误断言已修正）；部分月份有支出（1/2/3 月）时 activeMonths=3、月均=20.00；仅收入年 activeMonths=0、月均=0。
  - 分类明细：同分类混入收入与其他分类时，结果只含该分类支出（倒序），无收入。

> 注：上述 225 为代码修复后的最终实测结果。提交前会再跑一次确认。

---

## 三、模拟器验证（开发者工具，非真机）

- 因远程 / 向日葵会话中 Skyline 模拟器黑屏（GPU / 硬件加速问题，已知），模拟器视觉验证临时在 **WebView 渲染模式**下完成；验证后 `app.json` 已恢复为 `"renderer": "skyline"`。
- 已在 WebView 模拟器（iPhone 12/13, 390x844）确认：
  - 月度：Hero（支出/收入/结余）、每日趋势柱（14/15 日两根，高度不同）、分类 Top5、收支对比正常；
  - 年度：Hero（全年支出/收入/结余/记录数/月均）、最高/最低消费月、12 月趋势柱（9/10 月两根）正常；
  - 分类明细弹层：只含支出（瑞幸 18.00、海底捞 45.90），收入转账未混入；
  - 弹层定位正常（底部弹出、遮罩、关闭按钮不再跑左上角）。
- 模拟器截图（已保存 `docs/screenshots/`，均为 **WebView 模拟器**，非真机）：
  - `stats_month_simulator.png`
  - `stats_year_simulator.png`
  - `stats_category_detail_simulator.png`

### 窄屏 360 说明

- 模拟器 GUI 设备切换在当前远程会话反复操作未成功（菜单子项无法展开），故未单独产出 360px 模拟器截图。
- 已通过 CSS 静态分析确认 360px 安全：月度/年度分段为 flex 等宽自适应；Hero 大金额 72rpx 下年度数万金额仍在卡内宽内；两列收入/结余用 `min-width:0` 约束。
- **真机窄屏（360px Android）以真机验收为准**（见 `docs/DEVICE_GATE_v0.3.1.md` 第 13 项）。

---

## 四、真机 / 平台验收状态（如实记录）

| 平台 | 状态 |
|---|---|
| Node 纯函数 / 业务逻辑测试 | PASS（225/225） |
| 微信开发者工具 WebView 模拟器 | PASS（视觉与口径） |
| 微信开发者工具 Skyline 模拟器 | 未在远程会话验证（黑屏，GPU 问题） |
| **Android 真机**（含微信/支付宝真实账单） | **待用户真机验收**（助手不代签；见 DEVICE_GATE 14 项） |
| iOS 真机 | NOT TESTED（当前无 iPhone 真机） |
| iOS 模拟器安全区 | 前期已做检查，不作为真机 PASS |

> 真机验收结论与 4 张真机截图（`stats_month.png` / `stats_year.png` / `stats_category_detail.png` / `stats_narrow_screen.png`）由用户在 Android 真机完成后补充。

---

## 五、范围约束

- 本版不新增业务功能：日价、周期记账、预算、AI 分类、云同步、登录、OpenID、后端等均不做。
- 真实账单只在用户手机本地，不入库、不发文件、不发邮件。

---

## 六、交付元数据（提交后填写）

- Repository：`zxingyu178-dot/jizhang-mini`
- Branch：`main`
- Version：`0.3.1`
- Commit SHA：（待填）
- origin/main SHA：（待填）
- ahead = 0 / behind = 0 / working tree clean：（待填）
