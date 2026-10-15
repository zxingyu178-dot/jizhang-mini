# DailyValue Mini v0.2.0 交接文档

> 第一版真正的产品底座：毛玻璃视觉 + 本地数据层 + 统一导入引擎 + 双端兼容。
> 纯本地、无服务器、不登录、不获取 OpenID、不上传任何账单。

---

## 一、交付信息

| 项 | 值 |
| --- | --- |
| Repository | https://github.com/zxingyu178-dot/jizhang-mini |
| Branch | `main` |
| Version | v0.2.0 |
| AppID | `wxcdcf83d9191065d9`（真实绑定；AppSecret 不入库） |
| 功能代码提交 SHA | `44bbd67330b34a61ce4a1b4850bd0aedd09be818` |
| 技术栈 | 微信原生小程序（WXML / WXSS / 原生 Page·Component），渲染 Skyline + glass-easel |
| 第三方库 | SheetJS CE（仅读取，置于 importer 分包），miniprogram-automator（仅 devDependencies） |

> 本交接文档（HANDOFF）本身为紧随功能提交之后的一个 `docs` 提交；最终 `origin/main` HEAD 以 GitHub 为准。
> 交付前已核对：`git status` 工作区干净、`ahead=0 / behind=0`、`HEAD == origin/main`。

## 二、文档索引

| 文档 | 内容 |
| --- | --- |
| `docs/TEST_REPORT.md` | 77 项单元测试 + 模拟器验证，含未验证项 |
| `docs/IMPORT_REPORT.md` | 导入引擎架构、四来源适配、去重、原子化、编码 |
| `docs/IOS_COMPAT_REPORT.md` | device.js 双端适配、安全区、真机待验清单 |
| `docs/GLASS_UI_REPORT.md` | 紫黑毛玻璃视觉、Shell、组件、截图清单 |
| `docs/screenshots/01–07.png` | iPhone 12/13 模拟器关键界面截图 |

---

## 三、本阶段完成的四大件

1. **毛玻璃视觉还原**：废弃 v0.1 的白底绿底 TabBar，重建 Android DailyValue 紫黑风格；顶部「统计/记账/日价」+ Swiper 三 Panel；玻璃 FAB、Bottom Sheet、搜索胶囊、空态。
2. **正式本地数据层**：`wx.env.USER_DATA_PATH` 按月份分片（`bills/YYYY-MM.json`）；Bill V1；金额一律整数分 `amountCents`；旧 `jm_records` 无损迁移（保留原数组一个版本）；完整备份/恢复（`DailyValueMiniBackupV1`）。
3. **统一导入引擎**：`packages/importer` 分包，支持微信（XLSX+CSV）、支付宝（XLSX+CSV+GBK）、Android DailyValue（CSV + .dvbackup）、Mini 完整恢复；统一解析→校验→三级去重→预览→确认→原子化写入；SheetJS 仅读 ArrayBuffer，分包 980KB 低于 2MB。
4. **双端兼容基础**：`utils/device.js` 统一测量（getWindowInfo + 胶囊 + safeArea），无机型硬编码；顶部 Header、FAB、Bottom Sheet、确认按钮均处理安全区。

## 四、里程碑提交链

```
d9855ec v0.1.0 冻结（绑定真实 AppID）
b26fad3 M1 双端适配 + Skyline PoC + 玻璃 Shell
2b04fe8 M2 正式本地数据层（Bill V1 / 整数分 / 月份分片）
2c2f40b M3 Main Shell 与 Glass UI
44bbd67 M4 统一导入引擎 + M5 测试与验收（本版本功能提交）
```

## 五、验收标准逐项核对（规划第四十五节）

| 标准 | 状态 | 证据 |
| --- | --- | --- |
| 紫黑毛玻璃视觉成型 | ✅ | GLASS_UI_REPORT + 截图 01–07 |
| 顶部统计/记账/日价导航 | ✅ | 顶部 Tabs + Swiper，默认记账 |
| 记账首页真实可用 | ✅ | 月份/汇总/按天分组/FAB/表单 |
| 旧 `jm_records` 无损迁移 | ✅（单测） | data.test.js 迁移用例 |
| 正式 Bill V1 | ✅ | data/ 模型 |
| 金额整数分 | ✅ | amountCents，全链路整数计算 |
| 月份分片文件存储 | ✅ | bills/YYYY-MM.json |
| Mini 完整备份/恢复 | ✅（单测） | buildBackup/restoreBackup |
| Android DailyValue CSV | ✅（fixture） | importer.test dailyvalue |
| Android `.dvbackup` 迁移账单 | ✅（fixture） | 仅日价跳过、原 id 去重 |
| 微信 XLSX | ✅（fixture） | wechat-current.xlsx |
| 微信旧 CSV | ✅（fixture） | 表头位置变化仍识别 |
| 支付宝当前 Excel | ✅（fixture） | alipay-current.xlsx |
| 支付宝 CSV/GBK | ✅（fixture，真 GBK 字节） | alipay-gbk.csv |
| 导入预览 | ✅ | 计数/范围/样例/疑似开关 |
| 精确重复自动识别 | ✅ | source+txnId / fingerprint |
| 疑似重复不擅自删除 | ✅ | 仅标记，默认不导，开关由用户决定 |
| 不计收支不进账本 | ✅ | 标 skipped |
| 导入失败不污染数据 | ✅（单测） | 快照 + 逐月写 + 条数校验 + 回滚 |
| iPhone Safe Area | ⚠️ 逻辑+模拟器通过，**真机未验** | device 6 用例 + iPhone 12 模拟器 |
| 文件传输助手导入路径 | ⚠️ 入口/文案/选择 API 已接，**真机交互未验** | chooseMessageFile |
| GitHub `main == origin/main` | ✅ | 见第一节交付信息 |

## 六、必须如实说明的未验证项

1. **iOS / Android 真机均未实测**：渲染证据仅 iPhone 12/13 模拟器；safe-area 计算有 6 个 Node 用例覆盖，但真机 Home Indicator / 灵动岛 / 键盘 / 长屏需扫码确认。
2. **微信/支付宝真实账单未验证**：解析器仅用完全虚构的 fixture（无真实姓名/账号/流水号）。真实账单字段版本差异需用真实导出文件走一次。
3. **GBK 真机解码未验证**：Node 层用真 GBK 字节通过；iOS JSC / Android V8 的 `TextDecoder('gb18030')` 需真机确认。SheetJS 内置 `cptable(936)` 纯 JS 备用解码路径**尚未接线**。
4. **XLSX 真机内存**：15MB / 30000 行阈值在 Node 层生效，真机超大文件内存压力未实测。
5. **WebView 渲染模式未逐页回归**：当前仅在 Skyline 验证。

建议：用户用自己的真实微信/支付宝账单 + 真机各一台，按 `TEST_REPORT.md` 第四节清单做一次真机/真实数据验收。

## 七、本阶段明确不做（维持）

云同步/后端、登录/OpenID、年统计/图表、日价详情/曲线、周期记账、预算、AutoBill、AI 分类、多账本、密码 ZIP 解压、OCR、银行账单、Worker 大规模优化。

## 八、建议的下一阶段（v0.3.0）方向（供规划）

- 真机验收收口（safe-area、键盘、GBK、chooseMessageFile）；若某端 GBK 不支持，接线 `cptable(936)` 纯 JS 解码。
- 统计 Panel 从空态升级为月度图表与分类占比。
- 日价 Panel 业务落地（与 Android daily-value 对齐）。
- 设置页展示最近导入记录（import-history 数据已具备）。
- 视真机表现决定是否需要 WebView 逐页回归。
