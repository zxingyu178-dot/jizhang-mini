# DailyValue Mini v0.2.2 修复交付说明 — Real Statement Compatibility

- **Repository**：https://github.com/zxingyu178-dot/jizhang-mini
- **Branch**：`main`
- **Version**：`0.2.2`（统一事实源 `utils/version.js`）
- **上一版**：v0.2.1（主包修复 `cfff128` 为当前 origin/main）
- **代码真源**：GitHub `main`（本版不另打源码 zip）

> 本版是**真实账单兼容修复版**，范围严格限定你下发的 3 个 P0、1 个虚构真实布局 fixture、2 个 P1；未新增产品功能。核心是让真实微信账单（表头在第 18 行、金额列名 `金额(元)`、含退款行）不再被解析成「0 笔」或大面积扔进「需确认」。

---

## 一、P0 修复

### P0-1 微信真实 XLSX：通用表头 + 金额别名
- 新建共享解析器 `packages/importer/core/header.js`（见 P1-2），列名不再精确匹配单一写法。
- 金额列至少兼容：`金额` / `金额(元)` / `金额（元）` / `交易金额` / `交易金额(元)`。
- 统一 `normalizeHeader()` 处理：去 BOM、全角→半角、小写、去所有空白（含不间断空格）、去结尾货币单位后缀（`(元)/(人民币)/(rmb)/(cny)`）。
- **不是**针对本次加 `if (金额(元))` 的临时补丁，而是通用表头机制。
- 真实结构回归已支持：前 17 行说明、**第 18 行才是表头**、金额列 `金额(元)`。

### P0-2 微信退款按官方「收/支」入账
正式规则：
- `收/支 = 支出` → `expense`
- `收/支 = 收入` → `income`
- `收/支 = 不计收支 / 中性` → `skip`

只要官方「收/支」已明确，**不再因为「已退款」改成 needconfirm**：
- `支出 ¥1.00 已退款(¥0.05)` → 正常 `expense 1.00`；
- `收入 ¥0.05 已退款¥0.05` → 正常 `income 0.05`；
- 由此与微信官方账单总额保持一致。
- 仅当「收/支」无法识别**且**交易状态又异常（退款/撤销/关闭/失败/未支付等），才进入 `needconfirm`。

### P0-3 支付宝 GBK 纯 JS 兜底
- 此前链路：UTF-8 → `TextDecoder('gb18030')` → 失败即报错（要求用户去电脑另存 UTF-8）。
- 现链路：UTF-8 → 系统 `TextDecoder('gb18030')` → 不支持/失败 → **纯 JS CP936 解码**，不再要求用户转码。
- 从 `xlsx.js` 内联 SheetJS 的 `cptable[936]` 提取 DEC 码表，生成 `packages/importer/encoding/cp936.js`（仅解码表，长度 65104，索引 `(b1<<8)|b2`）。
- 封装为项目自有 `decodeGbkFallback(bytes)`（`encoding/gbk.js`），业务代码不直接依赖 SheetJS 内部；`gbDecode` 已接线，单字节 ASCII、双字节查码表、非法字节用 `�`。
- 不使用 Node `Buffer`/`fs`（小程序运行时不存在）。

---

## 二、P1 修复

### P1-1 真实文件诊断更准确（结构摘要 + 关键列缺失）
- 诊断新增 `expenseRows / incomeRows / missingColumns`；中性复用 `nonFlowSkipped`。
- 表头已识别但关键列缺失时，**不再进入「0 笔正常结果」**，而是明确报：
  > 账单格式已识别，但「金额」列格式发生变化，请点「复制诊断」反馈。
- 诊断文本新增：
  - `缺失必需列：金额`
  - `结构摘要：支出 45 / 收入 21 / 中性 0`
- 结构摘要只含计数，**不含**姓名、商户、商品、金额明细、银行卡、交易号、文件名。

### P1-2 列名解析器共享
- 三个 adapter（微信 / 支付宝 / DailyValue）均改用 `core/header.js`：
  - `normalizeHeader()`、`findHeaderRow(rows, required, maxScan=60)`、`findColumn(headers, aliases)`、`missingColumns(...)`。
- 未来官方把「金额 → 金额(元)」或「交易订单号 → 订单号」，只需改别名组，不致整体失效。

---

## 三、虚构真实布局 Fixture

- 新增 `tests/fixtures/wechat-real-layout.xlsx`（**完全虚构**，由 `tests/make_fixtures.js` 生成）。
- 复现真实结构：1~17 行官方说明、第 18 行表头（`…金额(元)…`）。
- 内置场景：普通支出、普通收入、**部分退款原支出**、**退款收入**、转账。
- 口径：**数据行 66 = 支出 45 + 收入 21 + 中性 0**（与你对真实文件的预期口径一致）。
- 测试验证：
  - 表头 `index=17`（第 18 行）；金额(元) 识别；`missingColumns=[]`；
  - 66 笔全部 `ready`、`needconfirm=0`；退款两行（expense 1.00 / income 0.05）正常入账；
  - 支出合计 **481.00**（43×10 + 1 + 50）、收入合计 **480.05**（19×20 + 0.05 + 100）；
  - 同一文件导入两次：第二次全部 `existing`。
- **未**将你提供的真实微信账单提交仓库；真实账单只在你手机本地。

---

## 四、测试结果（已实际执行）

命令：工程根目录 `npm test`

| 套件 | 用例数 | 结果 |
| --- | --- | --- |
| device.test.js | 6 | PASS |
| data.test.js | 92 | PASS |
| importer.test.js | 62（原 47，+15） | PASS |
| **合计** | **160** | **全绿，退出码 0** |

---

## 五、验收状态（如实记录）

| 项 | 状态 |
| --- | --- |
| Node 纯单测（含真实布局/退款/GBK/缺失列） | **PASS（160 项）** |
| 微信真实布局 fixture（66/45/21/0） | **PASS（虚构）** |
| 支付宝 GBK fixture（系统解码 + 纯 JS fallback 单测） | **PASS（虚构）** |
| 你那份真实微信账单（66=45+21） | **未在本环境处理**：已用同结构虚构 fixture 覆盖逻辑，待你真机确认 |
| Android 真机（手工记账/跨月编辑/备份恢复/真实账单导入） | **待你执行**（沿用 `docs/DEVICE_GATE_v0.2.1.md`） |
| iOS 真机 | **NOT TESTED**（无真机） |

> 说明：fixture PASS ≠ 真实账单 PASS，模拟器 PASS ≠ 真机 PASS。真实账单导入仍需你在 Android 真机上跑一次；异常时只发「复制脱敏诊断」或「结构摘要」文字即可，无需提供账单文件。

---

## 六、新增/变更文件清单

- 新增 `packages/importer/core/header.js`
- 新增 `packages/importer/encoding/cp936.js`（自动生成）
- 新增 `tests/fixtures/wechat-real-layout.xlsx`
- 新增 `tests/extract_cp936.js`（一次性码表提取脚本，保留以便重新生成；不计入 `npm test`，已被 `packOptions.ignore` 排除出代码包）
- 修改 `packages/importer/adapters/wechat.js`、`alipay.js`、`dailyvalue.js`
- 修改 `packages/importer/encoding/gbk.js`、`core/diagnosis.js`、`core/detector.js`
- 修改 `tests/importer.test.js`、`tests/make_fixtures.js`
- 版本同步：`utils/version.js`、`package.json`、`package-lock.json`、`README.md`
