# DailyValue Mini v0.2.0 测试报告

- 版本：v0.2.0（M0–M4 + M5 验收）
- 测试时间：2026-10-15
- 仓库：`zxingyu178-dot/jizhang-mini`（分支 `main`）
- 测试方式：纯 Node 内存 mock 单元测试 + 微信开发者工具模拟器真机渲染验证（miniprogram-automator）
- 测试数据：`tests/fixtures/` 内全部为**完全虚构**的账单，无任何真实姓名 / 账号 / 流水号

---

## 一、结论速览

| 层级 | 范围 | 结果 |
| --- | --- | --- |
| Node 单元测试 · 双端适配 | device.js（6 个尺寸/安全区用例） | ✅ PASS 6/6 |
| Node 单元测试 · 本地数据层 | data/（迁移/CRUD/备份恢复/金额） | ✅ PASS 43/43 |
| Node 单元测试 · 导入引擎 | importer（7 场景 / 28 断言） | ✅ PASS 28/28 |
| 开发者工具模拟器 · iPhone 12/13（390×844，Skyline） | 主页 / 记账表单 / 设置 / 导入入口 / 预览 / 结果 | ✅ PASS |
| 开发者工具模拟器 · 完整导入 UI 闭环 | 选文件→解析→预览→确认→写入→月份展示 | ✅ PASS |
| iOS 真机 | 物理 iPhone / iPad | ⚠️ NOT TESTED |
| Android 真机 | 物理 Android 设备 | ⚠️ NOT TESTED |
| 微信 / 支付宝真实导出账单 | 用户真实账单文件 | ⚠️ NOT TESTED（仅有虚构 fixture） |
| GBK 编码真机解码 | iOS JSC / Android V8 的 TextDecoder | ⚠️ NOT TESTED（Node 层已用真 GBK 字节验证 PASS） |

> 单元测试合计 **77 项断言全部通过**。模拟器渲染与导入闭环在 iPhone 12/13 机型、Skyline 渲染模式下通过。
> 按交付纪律，**模拟器通过不等于真机通过，fixture 通过不等于真实账单通过**；未验证项在下文如实标注。

---

## 二、单元测试明细

运行方式（工程根目录，Node v24.18.1）：

```bash
node tests/device.test.js
node tests/data.test.js
node tests/importer.test.js
```

### 2.1 双端适配（device.test.js）— 6/6

| 用例 | 输入 | 结果 |
| --- | --- | --- |
| iPhone SE（Home 键） | 375×667，无底部安全区 | PASS |
| iPhone 12（刘海） | 390×844，状态栏 + Home Indicator | PASS |
| iPhone 14 Pro Max（灵动岛） | 430×932 | PASS |
| Android 标准 | 360×800，无底部安全区 | PASS |
| 无 safeArea 设备 | windowInfo 无 safeArea，回退状态栏 | PASS |
| 测量只计算一次 | 缓存机制 | PASS |

覆盖：`statusBarHeight`、`safeArea`、`safeAreaInsets`、`windowHeight`，以及顶部 Header / 自定义 Tabs / 底部 FAB 的安全区换算；无机型硬编码。

### 2.2 本地数据层（data.test.js）— 43/43

| 场景 | 覆盖点 |
| --- | --- |
| 旧 `jm_records` 无损迁移 | 备份原始数组 → 转 Bill V1 → 按月分片 → 条数/收入/支出校验 → 迁移标记 |
| 全新账本 CRUD | 增删改查、月份汇总、按天分组、整数分金额 |
| 完整备份与恢复 | `DailyValueMiniBackupV1` 导出、安全点、恢复回滚 |
| 金额工具边界 | 元↔分换算、千分位、浮点误差规避 |

### 2.3 导入引擎（importer.test.js）— 28/28

通过内存文件系统 mock wx（含异步 `readFile`），跑完整 `detector.parseFile → 校验 → 去重 → commit → 账本`，并二次导入验证去重。

| 夹具（全部虚构） | 关键断言 | 结果 |
| --- | --- | --- |
| `wechat-current.xlsx` | ready=4 / needconfirm=1（退款）；支出 ¥54.10、收入 ¥88.88；重复导入全部 existing | PASS |
| `wechat-legacy.csv` | 表头位置变化（非固定行号）仍识别，ready=2 | PASS |
| `alipay-current.xlsx` | ready=4 / needconfirm=1（交易关闭）；分类映射（餐饮/交通/购物/其他） | PASS |
| `alipay-gbk.csv` | **真 GBK 字节**，ready=2；医疗、住房中文正确解码 | PASS |
| `dailyvalue.csv` | Android CSV，ready=3，仅日价（ledgerImpact=daily-value-only）跳过 | PASS |
| `dailyvalue-backup.json` | `.dvbackup`，ready=2；仅日价跳过；原 id 二次导入 existing | PASS |
| `mini-backup.json` | 完整恢复 isRestore=true，3 笔覆盖为 1 笔 | PASS |

覆盖的能力点（对应规划第三十八节）：来源识别、表头位置变化、XLSX、UTF-8 CSV、GBK CSV、金额 `¥ / ￥ / 纯数字 / 千分位`、收入、支出、不计收支、空商户、空备注、交易号去重、重复导入、疑似重复标记、退款/关闭状态保守处理、损坏文件、完整恢复。

---

## 三、开发者工具模拟器验证（iPhone 12/13，Skyline）

> 工具：微信开发者工具 Stable 2.02.2608080 + miniprogram-automator 0.12.1，自动化端口 9420。
> 机型：iPhone 12/13（390×844，含刘海与 Home Indicator）。

### 3.1 渲染与导航

- 分包 `packages/importer` 注册成功并被 `preloadRule` 预加载（控制台 `preloadSubpackages: importer / success`）。
- 分包体积 **980 KB**（其中 `xlsx.js` 929.6 KB），低于单个分包 2MB 上限。
- 从「设置 → 数据导入」可正常进入分包入口页；三个来源卡片渲染正常。
- 入口页 / 预览页 / 结果页均为自定义 Header，顶部避让微信胶囊按钮，无遮挡。

### 3.2 完整导入 UI 闭环（真实文件解析路径）

通过临时测试钩子把虚构微信 CSV 写入 `USER_DATA_PATH`，在模拟器内走真实生产代码：

1. 入口页解析 → 进入预览页；
2. 预览页显示来源、时间范围、计数、样例；
3. 确认 → 原子化写入 → 结果页「已把 2 条账单写入本地账本」；
4. 回记账主页切换到 9 月：
   - 本月支出 **¥162.00**（火锅 ¥156.00 + 地铁 ¥6.00）、收入 ¥0.00、结余 ¥-162.00；
   - 按天分组（9月20日 / 9月15日）；
   - 「测试地铁 / 地铁出行」经确定性关键字自动归类为「交通」，火锅无匹配归「其他」。
5. 另用含 1 笔疑似重复的样例验证：5 笔中 1 笔疑似重复默认不导入，结果页正确显示「已把 4 条账单写入」；开关打开后才会导入疑似项。

> 测试钩子在截图 / 验证完成后已从生产代码删除，`__verify` / `__shot` 关键字全仓库检索无残留。

### 3.3 已知非阻断提示

- 控制台 Skyline 提示：低于 2.29.2 基础库的客户端将回退 WebView 渲染，需保证页面两种渲染模式都可显示。当前样式使用半透明 Surface + 渐变 + 阴影实现，未使用高风险实时 blur hack，理论上 WebView 可降级显示，但**未在 WebView 模式下逐页回归（NOT TESTED）**。
- 自动化 `reLaunch` 偶发 `[worker] reportRealtimeAction:fail not support` 警告（来自分包预加载），不影响实际导航与功能；自动化脚本改为直接调用页面方法后稳定通过。

---

## 四、未完成 / 待真机验收项（如实标注）

1. **iOS / Android 真机均未实测**：当前渲染证据仅来自 iPhone 12/13 模拟器。safe-area 的**计算逻辑**已用 6 个 Node 用例覆盖 SE/刘海/灵动岛/Max/Android，但真机上的 Home Indicator、灵动岛、键盘、长屏表现仍需用户扫码在真机确认。
2. **真实微信 / 支付宝账单未验证**：解析器仅用虚构 fixture 验证。真实账单字段可能存在版本差异，需用户用自己导出的文件走一次。
3. **GBK 真机解码未验证**：`encoding/gbk.js` 优先用 `TextDecoder('gb18030')`，Node 层对真 GBK 字节解码 PASS；Android V8 与 iOS JSC 的 TextDecoder 能力需真机确认。SheetJS 内置 `cptable(936)` 可作为备用解码路径（尚未接线）。
4. **XLSX 在真机的内存表现**：30000 行 / 15MB 上限在 Node 层生效，真机超大文件的内存压力未实测。
5. **`chooseMessageFile` 文件选择**：自动化无法模拟微信文件选择面板，真机上「从微信文件中选择」的交互（含 iOS 文件传输助手路径）需人工走一遍。

---

## 五、复现实验步骤

- 单元测试：见第二节命令。
- 重新生成虚构夹具：`node tests/make_fixtures.js`（生成 7 个虚构文件到 `tests/fixtures/`）。
- 模拟器回归：微信开发者工具打开工程 → 编译 → 自动化端口 9420 后运行 `auto/check_import.js`（导航到导入入口）等脚本。
