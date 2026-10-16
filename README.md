# 每日的价值（jizhang-mini）

微信原生小程序实现的本地记账应用，App 内品牌名「每日的价值」，小程序后台名「随时随地大小记」。**无后端、无网络请求、无需登录，账单数据仅保存在本机微信用户目录。**

- 技术栈：微信原生小程序（WXML + WXSS + JavaScript），不引入 uni-app / Taro / Vue / React
- 渲染：Skyline + glass-easel（关闭时自动回退 WebView）
- 数据：`wx.env.USER_DATA_PATH` 本地文件 + Bill V2（兼容 V1，整数分金额）
- 适用工具：微信开发者工具 Stable 2.02 及以上
- 当前版本：0.4.1（交互与视觉收口：日价详情编辑 normal 账单不再污染原交易时间；记一笔改为真正 Glass Sheet、自然高度、金额不裁切、字段重排、分类「最近使用 + 更多」、按钮减重；设置页减法（备份/恢复合并、导入说明与最近导入移入数据导入页、去 emoji、统一 dv-icon）、新增数据与隐私页；曲线触摸坐标改为 canvas 局部坐标）

## 测试

```bash
npm test
```

一条命令在独立子进程依次运行 `tests/device.test.js`、`data.test.js`、`accounting.test.js`、`statistics.test.js`、`daily-value.test.js`、`settings.test.js`、`importer.test.js`（当前 394 项），任一失败即以非零退出码结束（跨平台，不依赖 shell）。App 版本号以 `utils/version.js` 为单一事实源，需与 `package.json` 的 `version` 保持一致。

## 已实现功能

- **主 Shell**：自定义 Header（标题 / 搜索 / 设置），顶部「统计 / 记账 / 日价」三段，Swiper 左右滑动切换，默认记账。
- **记账 Panel**：月份切换（上一月 / 下一月）、本月支出 / 收入 / 结余、按天分组账单列表、玻璃 FAB 新增。
- **记账表单（Glass Sheet）**：半透明玻璃面板（模糊 + 顶部高光）、内容少时按自然高度出现；字段顺序为收支切换 → 金额（确定高度/行高，不裁切）→ 日期 → 计算日价 → 分类（最近使用 5 个 + 更多，换行网格）→ 商户 → 备注；支持编辑与两阶段删除。新增用当前时分；编辑改日期时保留原账单时分。
- **跨月编辑**：修改账单日期跨月时，自动从旧月份分片移除并写入新分片，Bill id 不变，失败按分片快照回滚。
- **搜索页**：按商户 / 备注 / 分类全局匹配，结果按日期分组，点击可编辑。
- **设置页（精简）**：主页仅保留数据导入、备份与恢复（合并为二级页，`.dvmini.json`）、版本、数据与隐私；导入说明与最近导入移入数据导入页，无装饰 emoji。进入设置页时才在后台预加载 importer 分包，首页启动不背 980KB 解析库。
- **账单导入**：微信 / 支付宝（XLSX+CSV，含 GBK）、Android DailyValue（CSV + `.dvbackup`）、Mini 完整恢复；三级去重、预览确认、原子化写入、失败脱敏诊断（不含姓名/商户/账号/交易号）。
- 旧 `jm_records`（wx.Storage）首次启动无损迁移：迁移前快照、失败完整回滚、重复启动不产生重复记录，迁移后保留一个版本。
- **每日的价值（日价）**：一笔消费可开启「计算日价」，同时进账本 / 统计 / 日价；日价页也可独立新增「仅日价物品」，只进日价、绝不进记账 / 统计 / 普通搜索。当前日价（`金额/已用天数`，购买当天起算、最少 1 天、纯日历日差）不持久化、每天重算。
- **日价详情 / 曲线 / 里程碑**：日价列表按当前日价降序；详情页以「当前日价」为主，含原生 Canvas 2D 下降曲线（短周期逐日、长周期采样、触摸 tooltip）与里程碑（使用 7/30/100/365… 天、日价 ¥100/50/20/10… 目标），仅陈述数学事实、不做「回本」评价。
- **跨日自动刷新**：App 回到前台刷新当日日价，并调度到下一个本地午夜的定时器（每次重算，避免 DST 漂移）；进入后台清除。
- **Android 日价迁移**：`.dvbackup` 完整迁移 `title / ledgerImpact / dailyValue`（含 normal+dailyValue、仅日价物品），已存在账单按源 id 合并补日价、不重复；CSV 无日价字段，仅迁普通账单（对无 id 账单做保守匹配，唯一才补、多条需确认）。
- **Mini 备份 V2**：完整保存 `title / ledgerImpact / dailyValue`，恢复兼容 V1 + V2。

## 目录结构

```text
jizhang-mini/
├── app.js                 # 入口，onLaunch 初始化数据层
├── app.json               # 路由、窗口、Skyline 配置
├── app.wxss               # 玻璃设计 token 与通用玻璃类
├── pages/
│   ├── main/              # 主 Shell：Header + Tabs + Swiper + FAB
│   ├── search/            # 全局搜索
│   └── settings/          # 设置（导入 / 备份 / 恢复 / 关于）
├── components/
│   ├── accounting-panel/  # 记账 Panel
│   ├── statistics-panel/  # 统计 Panel
│   ├── daily-value-panel/ # 日价 Panel（空态）
│   ├── bottom-sheet/      # 通用底部弹出面板
│   └── bill-form/         # 记账表单（新增 / 编辑）
├── data/                  # 正式本地数据层（ledger / money / backup / migration 等）
├── utils/                 # device（设备/安全区）、util（通用）
├── packages/importer/     # 导入引擎（分包，含 SheetJS）
└── tests/                 # 单元 / 数据层测试
```

## 数据说明

- 存储根：`wx.env.USER_DATA_PATH`，结构为 `manifest.json`、`bills/YYYY-MM.json`、`categories.json`、`settings.json`、`import-history.json`、`legacy/`。
- 金额核心使用整数分 `amountCents`（¥25.50 = 2550），统计全程整数，显示时再换算，避免浮点误差。
- Bill V1：`id, type, amountCents, categoryId, occurredAt, merchant, note, source, sourceTxnId, importBatchId, createdAt, updatedAt, ledgerImpact`。

## 快速开始

1. 打开微信开发者工具，扫码登录。
2. 「导入项目」选择本文件夹，AppID 已绑定真实小程序（`wxcdcf83d9191065d9`）。
3. 工具自动编译，模拟器中点右下角「+」即可记账。
4. Skyline 调试：详情 → 本地设置 → 开启 Skyline 渲染调试。

## 参考资源

- 小程序指南：https://developers.weixin.qq.com/miniprogram/dev/framework/
- Skyline：https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/skyline/
- 开发者工具自动化：https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/
