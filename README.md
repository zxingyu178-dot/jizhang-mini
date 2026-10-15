# 每日的价值（jizhang-mini）

微信原生小程序实现的本地记账应用，App 内品牌名「每日的价值」，小程序后台名「随时随地大小记」。**无后端、无网络请求、无需登录，账单数据仅保存在本机微信用户目录。**

- 技术栈：微信原生小程序（WXML + WXSS + JavaScript），不引入 uni-app / Taro / Vue / React
- 渲染：Skyline + glass-easel（关闭时自动回退 WebView）
- 数据：`wx.env.USER_DATA_PATH` 本地文件 + Bill V1 + 整数分金额
- 适用工具：微信开发者工具 Stable 2.02 及以上
- 当前版本：0.2.0（第一版真正产品底座）

## 已实现功能

- **主 Shell**：自定义 Header（标题 / 搜索 / 设置），顶部「统计 / 记账 / 日价」三段，Swiper 左右滑动切换，默认记账。
- **记账 Panel**：月份切换（上一月 / 下一月）、本月支出 / 收入 / 结余、按天分组账单列表、玻璃 FAB 新增。
- **记账表单**：支出 / 收入切换、金额大输入（两位小数）、分类横向滚动、日期、商户、备注；支持编辑与两阶段删除。
- **搜索页**：按商户 / 备注 / 分类全局匹配，结果按日期分组，点击可编辑。
- **设置页**：数据导入入口、备份 / 恢复（`.dvmini.json`）、最近导入、关于。
- 旧 `jm_records`（wx.Storage）首次启动无损迁移，迁移后保留一个版本。

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
