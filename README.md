# 随时随地大小记（jizhang-mini）

微信原生小程序实现的本地记账应用，App 内品牌名「随时随地大小记」。**无后端、无网络请求、无需登录，账单数据仅保存在本机微信用户目录。**

- 技术栈：微信原生小程序（WXML + WXSS + JavaScript），不引入 uni-app / Taro / Vue / React
- 渲染：Skyline + glass-easel（关闭时自动回退 WebView）
- 数据：`wx.env.USER_DATA_PATH` 本地文件 + Bill V3（兼容 V1/V2，整数分金额）
- 适用工具：微信开发者工具 Stable 2.02 及以上
- 当前版本：1.1.0（Bill Explorer & Analytics）。
- 版本历史与各版变更见 [CHANGELOG.md](CHANGELOG.md)。

## 测试

```bash
npm test     # 纯逻辑单测
npm run e2e  # miniprogram-automator 跑微信开发者工具 GUI 端到端回归
npm run perf # 1k/5k/10k 大账本性能 Gate
```

- `npm test` 运行 `tests/run-all.js` 中注册的全部测试套件（设备、数据层、统计、日价、预算、分类、周期、备份 / 迁移、灾难恢复、导入、主题等），任一失败即以非零退出码结束（跨平台，不依赖 shell）。最新套件与用例数量以命令实际输出为准，不在此硬编码。
- `npm run e2e`（`tests/e2e/`）自动拉起 / 复用微信开发者工具，验证页面渲染、data 绑定与增改停用删交互闭环；数学口径仍归 Node 单测。运行前需开启开发者工具「服务端口」，详见 `docs/E2E_TESTING.md`。
- `npm run perf`（`tests/perf/large-ledger.perf.js`）用虚构账单验证冷启动、当月 Timeline、统计、搜索、预算日历在 1k/5k/10k 规模下无崩溃、近线性、分类快照只读一次盘。

App 版本号以 `utils/version.js` 为单一事实源，需与 `package.json` / `package-lock.json` 的 `version` 保持一致。

## 已实现功能

- **主 Shell**：自定义 Header（标题 / 搜索 / 设置），顶部「统计 / 记账 / 日价」三段，Swiper 左右滑动切换，默认记账。
- **记账 Panel**：月份切换（上一月 / 下一月）、本月支出 / 收入 / 结余、按天分组账单列表、玻璃 FAB 新增。
- **记账表单（Glass Sheet）**：半透明玻璃面板（模糊 + 顶部高光）、内容少时按自然高度出现；字段顺序为收支切换 → 金额（确定高度/行高，不裁切）→ 日期 → 计算日价 → 分类（最近使用 5 个 + 更多，换行网格）→ 商户 → 备注；支持编辑与两阶段删除。新增用当前时分；编辑改日期时保留原账单时分。
- **跨月编辑**：修改账单日期跨月时，自动从旧月份分片移除并写入新分片，Bill id 不变，失败按分片快照回滚。
- **搜索页**：按商户 / 备注 / 分类全局匹配，结果按日期分组，点击可编辑。
- **设置页（精简）**：主页仅保留数据导入、备份与恢复（合并为二级页，`.dvmini.json`）、版本、数据与隐私；导入说明与最近导入移入数据导入页，无装饰 emoji。进入设置页时才在后台预加载 importer 分包，首页启动不背 980KB 解析库。
- **账单导入**：微信 / 支付宝（XLSX+CSV，含 GBK）、Android DailyValue（CSV + `.dvbackup`）、Mini 完整恢复；三级去重、预览确认、原子化写入、失败脱敏诊断（不含姓名/商户/账号/交易号）。
- 旧 `jm_records`（wx.Storage）首次启动无损迁移：迁移前快照、失败完整回滚、重复启动不产生重复记录，迁移后保留一个版本。
- **日价（每日价值）**：一笔消费可开启「计算日价」，同时进账本 / 统计 / 日价；日价页也可独立新增「仅日价物品」，只进日价、绝不进记账 / 统计 / 普通搜索。当前日价（`金额/已用天数`，购买当天起算、最少 1 天、纯日历日差）不持久化、每天重算。
- **日价详情 / 曲线 / 里程碑**：日价列表按当前日价降序；详情页以「当前日价」为主，含原生 Canvas 2D 下降曲线（短周期逐日、长周期采样、触摸 tooltip）与里程碑（使用 7/30/100/365… 天、日价 ¥100/50/20/10… 目标），仅陈述数学事实、不做「回本」评价。
- **跨日自动刷新**：App 回到前台刷新当日时间敏感视图（日价与预算），并调度到下一个本地午夜的定时器（每次重算，避免 DST 漂移）；进入后台清除；从预算设置等内部页面返回主页立即刷新。
- **预算节奏（Budget Rhythm）**：记账 Hero 顶部「支出 / 预算」轻切换（不新增横滑手势）。预算模式提供今日 / 本周 / 本月三段，严格区分「总预算」「截至今日预算」「已花」「当前盈余 / 超支」「剩余预算」，避免用整月预算减半月支出制造虚假盈余。预算消耗口径固定为 `ledgerImpact === normal && type === expense`（收入不增加、仅日价物品不消耗），预算只是新增分析维度，不改变月支出 / 收入 / 结余 / 分类排行 / 年度统计。
- **预算规则历史**：预算存于 `settings.json` 的 `budget.rules`（非单一 dailyBudget），每条规则含 `dailyCents / effectiveFrom / enabled`。某一天适用「effectiveFrom ≤ 当天且最近一条」规则；改 ¥30→¥40 只新增规则、不重算历史；关闭预算新增 `enabled:false` 规则、不删历史。生效日期可选过去、不允许未来。预算设置页（`pages/budget-settings`）可设启用开关、每日金额、生效日期。
- **预算日历地图**：统计月度页在月度 Hero 后展示当月预算日历（周一为周起点），绿=盈余、红=超支、灰=无预算或未来、紫色描边=今天，绿/红各两档深浅；点击某一天弹出只读 Bottom Sheet（预算 / 实际 / 盈余或超支、当天分类与账单）。日历下方给出本周截至今日、本月截至今日、上周、上月的节奏摘要。规则中途变更时，历史日历按各规则生效日自动分段计算。
- **Budget Core（纯函数）**：`data/budget/`（rules / period / core / calendar / index）全部为纯函数，金额整数分，周期边界（周一为周起点、月天数 28/29/30/31）、未来日不进累计预算、已结束周期累计预算=总预算，均由单元测试覆盖。预算规则随 `settings` 已包含在 Backup V2 中，备份格式无需升级。
- **分类管理**：`pages/category-manage` 分系统分类（核心 5 类 `builtin` 只读、不可改名 / 归档）、我的分类（可新增 / 编辑 / 归档）、已归档（可恢复）。分类对象为 `{id,name,emoji,builtin,sort,archived}`，删除采用软归档（`archived=true`）而非物理删除：新记账看不到、历史账单仍正常解析原分类名 / 图标，不会因分类被删而变「其他」。名称 1–8 字、重名拒绝（含归档）。记账表单 `bill-form` 从数据层取 active 分类（不再硬编码），编辑历史账单引用归档分类时仍显示原分类。
- **周期记账（Recurring）**：`pages/recurring` 提供规则列表（开关、下次到期）与编辑器。频率每天 / 每周 / 每周 N / 每月 / 每年，支持每 N 与间隔；月末规则自动钳制（每月 31 日遇 2 月→28/29、4 月→30，不滚到下月；每年 2-29 平年→2-28）。小程序无后台常驻，在 App `onLaunch` / `onShow`（打开或回到前台）时自动补齐到期账单，生成器有并发锁、确定性 Bill id（`recur-{ruleId}-{date}-{time}`，多次运行幂等）、catch-up 单规则上限 365、删除已生成账单不复活（游标 `lastGeneratedDate`）、编辑规则只影响未来（`scheduleEffectiveAt`）、删除规则保留历史账单、停用不生成、重新启用不补停用期间。保存过去开始的规则前提示将补记笔数。周期账单 `source='recurring'`、`ledgerImpact='normal'`，支出进统计 / 预算，收入进月度收入。
- **Android 分类与周期迁移**：`.dvbackup` 除日价外，自定义分类按确定性 id（`dvcat-`）迁入（先按名称复用、否则新建，重复导入不重复），账单分类跟随映射、不再全部变「其他」；`recurringRules` 转换为 Mini 规则（金额元→分、频率 / 间隔 / 日期 / 游标保留，`dvrule-` id），导入后不从头补账。
- **Android 日价迁移**：`.dvbackup` 完整迁移 `title / ledgerImpact / dailyValue`（含 normal+dailyValue、仅日价物品），已存在账单按源 id 合并补日价、不重复；CSV 无日价字段，仅迁普通账单（对无 id 账单做保守匹配，唯一才补、多条需确认）。
- **Mini 备份 V3**：完整保存 `title / ledgerImpact / dailyValue / recurringRules`，恢复兼容 V1 + V2 + V3（旧备份缺 `recurringRules` 按空处理）。

## 目录结构

```text
jizhang-mini/
├── app.js                 # 入口，onLaunch 初始化数据层
├── app.json               # 路由、窗口、Skyline 配置
├── app.wxss               # 玻璃设计 token 与通用玻璃类
├── pages/
│   ├── main/              # 主 Shell：Header + Tabs + Swiper + FAB
│   ├── search/            # 全局搜索
│   ├── settings/          # 设置（数据导入 / 备份与恢复 / 预算 / 分类与周期 / 版本 / 数据与隐私）
│   ├── budget-settings/   # 预算设置（启用开关 / 每日金额 / 生效日期）
│   ├── category-manage/   # 分类管理（系统 / 我的 / 已归档）
│   ├── recurring/         # 周期记账规则列表与编辑器
│   ├── backup-restore/    # 备份与恢复
│   └── data-privacy/      # 数据与隐私
├── components/
│   ├── accounting-panel/  # 记账 Panel（含支出 / 预算 Hero 模式）
│   ├── statistics-panel/  # 统计 Panel（含预算日历地图与空态）
│   ├── daily-value-panel/ # 日价 Panel
│   ├── daily-value-form/  # 日价物品表单（新增 / 编辑）
│   ├── daily-value-curve/ # 日价 Canvas 2D 曲线
│   ├── bottom-sheet/      # 通用底部弹出面板
│   └── bill-form/         # 记账表单（新增 / 编辑，数据层取分类）
├── data/                  # 正式本地数据层（ledger / categories / money / backup / migration / dailyValue / budget / recurring 等）
│   ├── daily-value/       # 日价纯函数（core / list / detail / curve / milestones / form）
│   ├── budget/            # 预算纯函数（rules / period / core / calendar / index）
│   └── recurring/         # 周期纯函数与存储（core / store / generator / index）
├── utils/                 # device（设备/安全区）、util（通用）
├── packages/importer/     # 导入引擎（分包，含 SheetJS）
└── tests/                 # 单元 / 数据层测试
```

## 数据说明

- 存储根：`wx.env.USER_DATA_PATH`，结构为 `manifest.json`、`bills/YYYY-MM.json`、`categories.json`、`settings.json`、`recurring.json`、`import-history.json`、`legacy/`。
- 金额核心使用整数分 `amountCents`（¥25.50 = 2550），统计全程整数，显示时再换算，避免浮点误差。
- Bill V3：`id, type, amountCents, categoryId, occurredAt, title, merchant, note, source, sourceTxnId, importBatchId, createdAt, updatedAt, ledgerImpact, dailyValue?, recurringRuleId?`。`ledgerImpact` 取 `normal`（进账本 / 统计）或 `daily-value-only`（仅日价）；`dailyValue` 为 `{ enabled, mode:'elapsed', startDate }`；`recurringRuleId` 仅周期账单挂载。Bill V1→V2→V3 逐级无损升级（V3 仅补 `recurringRuleId`），不改变 id / type / amountCents / occurredAt / ledgerImpact / dailyValue，迁移按月份快照、失败回滚。日价、预算、周期均从 Bill 与规则动态派生，不新增预算字段到每笔 Bill。
- 分类存于 `categories.json`：`{id,name,emoji,builtin,sort,archived}`；删除为软归档，历史账单引用不丢失。
- 周期规则存于 `recurring.json`：`{version:1,rules:[{id,enabled,type,amountCents,categoryId,note,frequency,interval,day,month?,startDate,time,scheduleEffectiveAt?,lastGeneratedDate?,nextOccurrence?}]}`。
- 预算规则存于 `settings.json` 的 `budget`：`{ version:1, weekStartsOn:1, rules:[{ id, enabled, dailyCents, effectiveFrom, createdAt }] }`。
- 备份 Backup V3（`daily-value-mini-backup`）：`data` 含 `bills / categories / settings / recurringRules`，预算规则随 `settings` 一并保存；恢复兼容 V1/V2/V3。

## 快速开始

1. 打开微信开发者工具，扫码登录。
2. 「导入项目」选择本文件夹，AppID 已绑定真实小程序（`wxcdcf83d9191065d9`）。
3. 工具自动编译，模拟器中点右下角「+」即可记账。
4. Skyline 调试：详情 → 本地设置 → 开启 Skyline 渲染调试。

## 参考资源

- 小程序指南：https://developers.weixin.qq.com/miniprogram/dev/framework/
- Skyline：https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/skyline/
- 开发者工具自动化：https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/
