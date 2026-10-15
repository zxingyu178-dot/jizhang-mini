# HANDOFF · DailyValue Mini v0.3.0 — 统计正式版

- 版本：0.3.0
- 日期：2026-10-15
- 仓库：https://github.com/zxingyu178-dot/jizhang-mini
- 分支：main

## 一、本版范围

让导入的历史数据真正「有价值」：统计 Panel V1（月度 + 年度一次性完成），并修复两个可见 UI 问题。

1. **统计纯函数层**（新增 `data/statistics/`）
   - `month.js`：`computeMonthOverview` / `computeDailyExpenseTrend` / `computeCategoryRanking` / `computeIncomeExpenseCompare`，另有 `inLedger`。
   - `year.js`：`computeYearOverview` / `computeMonthlyTrend` / `computeYearCategoryRanking` / `computeExpenseExtremes`。
   - 纯函数输入「账单数组」，**不直接依赖 store / 分类表**；分类名由 `resolveCategory` 注入，便于单测；仅统计 `ledgerImpact==='normal'`；金额整数分。
2. **统计页重写**（`components/statistics-panel`），全部图表用纯 WXSS（flex 柱高 % / 条形宽 %），**不引入 ECharts / 图表库**，保持主包轻量、Skyline 稳定、契合毛玻璃。
3. **两个 UI 修复**（`components/accounting-panel`）：FAB 不再遮挡最后账单金额；长备注 / 名单行省略，编辑里仍看完整。

## 二、月度统计

- 顶部「月度 / 年度」分段控件；月份可前后切换（下一月不超过当前月）。
- Hero：本月支出（大数字）+ 收入 / 结余。
- 每日花费趋势：当月**每天一根细柱**（正序），柱高相对月内最高日支出；横轴标签抽稀到约 6 个（首日必显），不重演 Android 标签叠字。
- 分类支出排行 Top 5：表情 + 名称 + 金额 + 占比（%）+ 相对最大类的条形；**点击分类弹出「当月该分类明细」底部弹层**（按时间倒序，日期 / 备注 / 金额）。
- 收入 / 支出对比：支出、收入两根相对条（相对较大者）。
- 无支出 / 无账月份：Hero 显示 ¥0.00，排行 / 对比显示空态，不报错。

## 三、年度统计

- 年份可前后切换（下一年不超过当前年）。
- Hero：全年支出（大数字）+ 收入 / 结余 + 记录笔数 / 月均支出。
- 最高 / 最低消费月：仅在「有支出的月份」中比较，空月不算最低；无支出时显示「—」。
- 12 个月支出趋势：12 根柱，标签隔月显示（1、3、5…共 6 个）。
- 全年分类 Top 5：点击弹出「全年该分类明细」。

## 四、UI 修复

- FAB 遮挡：记账滚动区底部内联 `padding-bottom = safeBottom + FAB 高度(104rpx 换算 px) + 24px`，而非只挪 FAB。验收要求：最后一条账单、收入金额、长金额都不被 FAB 压住。
- 长备注：`.bill-item__name` / `.bill-item__note` 单行省略，`.bill-item__main` 加 `min-width:0`；账单编辑表单（`bill-form` 的 input）仍显示完整内容。

## 五、测试

- 新增 `tests/statistics.test.js`（55 项，完全虚构账单），已接入 `tests/run-all.js`。
- `npm test` 一键入口（独立子进程依次跑 4 个套件，任一失败退出码非 0）：

```text
device.test.js      6 项  PASS
data.test.js       92 项  PASS
statistics.test.js 55 项  PASS
importer.test.js   62 项  PASS
合计               215 项 全绿（4/4）
```

覆盖：月度概览 / 每日趋势 31 点与标签抽稀 / 分类 Top5 金额与占比与条形 / 收支对比、年度概览与月均 / 12 月趋势 / 全年 Top / 最高最低月、`daily-value-only` 不进账、空账本与无 resolver 兜底。

## 六、验收状态（如实）

- 微信开发者工具模拟器（含 Skyline）：逻辑与单测 PASS。
- **Android 真机 Gate：待用户执行**——需在真机确认：月度/年度统计真实账单口径、切月/年、分类明细弹层、FAB 不遮挡最后账单、长备注省略。助手不代签。
- **iOS 真机：NOT TESTED**（当前无 iPhone 真机；模拟器已做安全区检查，不得把模拟器当真机 PASS）。
- 真实账单只在用户手机本地，不入库、不发邮件、不发文件。

## 七、本版不做

日价详情 / 曲线、周期记账、预算、自定义统计、AI 分类、云同步、微信登录、自动分类学习。下一阶段 v0.4.0 为日价模块。
