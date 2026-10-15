# DailyValue Mini v0.2.0 导入引擎报告

- 版本：v0.2.0
- 模块：`packages/importer/`（独立分包，约 1704 行自研代码 + SheetJS 库）
- 定位：纯本地统一账单导入引擎，不登录、不上传任何账单文件

---

## 一、架构

```
packages/importer/
  core/
    detector.js     读文件 → 识别来源 → 调度 adapter → 校验 → 去重 → 会话
    normalizer.js   时间解析、金额转整数分、构造 Bill、fingerprint
    validator.js    单条/整批校验，非法标 skipped
    dedupe.js       existing / duplicate / suspect 分类
    commit.js       原子化写入 + 失败回滚
  adapters/
    wechat.js       微信账单（XLSX + CSV）
    alipay.js       支付宝账单（XLSX + CSV）
    dailyvalue.js   Android DailyValue（CSV + .dvbackup）
    dvmini.js       Mini 自身完整备份（.dvmini.json）
  encoding/
    csv.js          纯 JS CSV（引号/转义/字段内逗号换行/CRLF/BOM）
    gbk.js          UTF-8 严格校验 + GB18030 解码
  excel/
    xlsx.js         SheetJS CE（只读，929.6 KB）
    reader.js       ArrayBuffer → 第一张表二维数组
  pages/
    import/         三来源入口 + 导出方法说明
    preview/        解析结果预览 + 疑似重复开关 + 确认
    result/         导入结果
```

## 二、统一流程（与规划第二十六节一致）

```
从微信文件中选择（wx.chooseMessageFile）
  → 大小保护（≤15MB）/ ZIP 提示
  → 识别格式（扩展名 + 内容表头关键字）
  → 对应 adapter 解析为 NormalizedBill
  → validator 校验（非法 → skipped）
  → dedupe 分类（existing / duplicate / suspect）
  → 预览（计数 + 时间范围 + 前 20 条样例）
  → 用户确认（可选择是否包含疑似重复）
  → commit 原子化写入
  → result 结果页
```

绝不在选择文件后直接写账本。

---

## 三、各来源适配

### 3.1 微信支付账单（wechat，P0）

- 支持 XLSX（当前主格式）与历史 CSV。
- **按表头关键字组合识别，不写死行号**：扫描前 40 行寻找「交易时间 / 交易类型 / 交易对方 / 商品 / 收/支 / 金额 / 支付方式 / 当前状态 / 交易单号 / 商户单号 / 备注」。
- 收支：`支出→expense`、`收入→income`、`不计收支→跳过`（不进入正式账本）。
- 金额：`¥25.80` / `￥25.80` / `25.80` / 千分位，统一转整数分。
- 商户取「交易对方」；备注优先「商品」，若有备注则「商品 · 备注」。
- 去重键：`wechat:<交易单号>`。
- 状态保守：当前状态出现「退款 / 撤销 / 关闭 / 失败」且现金流关系无法 100% 确定时，标记 `needconfirm`，不擅自推理。
- 分类：微信无同级消费分类，第一版只做**确定性关键字**（如「滴滴/地铁→交通」「医院→医疗」），其余归「其他」，不做 AI 分类。

### 3.2 支付宝账单（alipay）

- 支持「用于个人对账」Excel 与 CSV。
- 同样按表头识别（「交易分类 / 收/付款方式 / 对方账号」等），兼容说明头长度变化。
- 分类直接映射「交易分类」：餐饮美食→餐饮、交通出行→交通、数码电器/服饰装扮/日用百货→购物、住房物业→住房、文化休闲→娱乐、医疗健康→医疗、教育培训/金融保险等→其他。
- 编码：CSV 走 UTF-8 BOM → 严格 UTF-8 → GB18030 的自动识别（见第五节）。
- 状态保守：「交易关闭 / 失败」等标 `needconfirm`。

### 3.3 Android DailyValue（dailyvalue）

- 依据 `zxingyu178-dot/daily-value-v2` 最新 `main` 真实源码（`types.ts` / `category-defs.ts` / `csv.ts` / `backup.ts`）编写，未凭旧字段猜测。
- CSV 表头：`日期,时间,类型,金额,分类,备注,来源,账本影响`；金额为纯数字元；分类名映射到 Mini 分类 id（沿用 12 分类，无「教育」）。
- `.dvbackup`（`DailyValueBackupV1`）：第一阶段迁移 Bills 与可映射 Categories；**不迁移**周期记账规则、Widget、通知设置、壁纸。
- `ledgerImpact = daily-value-only`（仅日价）的账单**跳过**，不进 Mini 账本。
- 原 Android `bill.id` 作为 `sourceTxnId`，保证重复导入不重复。

### 3.4 Mini 完整备份（dvmini）

- 识别 `format = daily-value-mini-backup`（`DailyValueMiniBackupV1`，后缀 `.dvmini.json`）。
- 作为**完整恢复**（整库替换），跳过去重，走独立的 `commitRestore`，复用数据层 `restoreBackup`（含安全点 + 回滚）。
- 与普通账单导入严格区分。

---

## 四、去重策略（与规划第二十八至三十节一致）

1. **精确重复（最高优先级）**：`source + sourceTxnId`，如 `wechat:420000...`，同一流水号永远只导入一次；命中账本标 `existing`，命中同文件标 `duplicate`，均自动跳过。
2. **无流水号**：用稳定 fingerprint（类型 | 整数分 | 年月日时分 | 商户 | 备注），同文件导入第二次不重复。
3. **跨来源疑似重复（suspect）**：金额相同 + 时间 ±5 分钟内 + 商户接近 + 来源不同，**只标记、不自动删除**。预览页默认不导入，提供「同时导入 N 笔疑似重复」开关，由用户决定。

---

## 五、编码与解析

- **CSV**：自研纯 JS parser，支持引号包裹、双引号转义、字段内逗号/换行、CRLF、UTF-8 BOM。
- **GBK/GB18030**：`encoding/gbk.js` 顺序为 UTF-8 BOM → 严格 UTF-8 校验（任何非法字节判失败）→ `TextDecoder('gb18030')`。
  - 已用**真实 GBK 字节**夹具（`alipay-gbk.csv`，首字节 `d6 a7`）在 Node 层验证中文正确解码。
  - 若运行时不支持 GB18030，给出明确中文提示（另存为 UTF-8 后再导入），不崩溃。
  - **已知待办**：SheetJS 内置 `cptable(936)` 纯 JS 码表可作为不依赖 TextDecoder 的备用解码路径，**当前尚未接线**；真机若发现某端 TextDecoder 不支持 GBK，再接。
- **XLSX**：仅用 `FileSystemManager.readFile` 拿 `ArrayBuffer` 后 `XLSX.read(buffer, {type:'array'})`，读取第一张工作表转二维数组；**禁止** Node 风格 `XLSX.readFile`；不使用 Node `Buffer` / `fs`。

---

## 六、原子化与安全

- 写入前建立快照安全点（`data/backup.buildBackup`）。
- 内存中按月份分组，逐月「读取 → 合并 → 写回」。
- 写完后重新全量统计条数，与应导入数量比对，不一致即抛错。
- 任一步失败：用快照 `restoreBackup` 完整恢复，**原账本保持不变**，不会出现「导到一半留半截」。
- 成功后：长期保存规范化 Bill、导入批次（`importBatchId`）、去重 key、`import-history.json`；**不长期保存**原始 Excel/CSV、付款账号、银行卡、完整流水文件。

## 七、保护阈值

- 单文件 ≤ 15MB；单次 ≤ 30000 行，超过给出「按较短时间范围重新导出」提示。
- 加密 ZIP：第一阶段**不解密**，选择 `.zip` 时提示先用微信提供的密码解压、再把 Excel/CSV 发到文件传输助手。

## 八、入口与 iOS 一致性

- 入口页三卡片：DailyValue 数据 / 微信账单 / 支付宝账单，各带「查看导出方法」与 iPhone 提示。
- 统一文案「**从微信文件中选择**」（不写「从手机文件选择」，对 iOS 不准确）。
- iOS 路径统一引导：账单经邮件/文件 App 解压后 → 分享到微信「文件传输助手」→ 回本页选择，与 Android 逻辑一致，不依赖 iOS Files Picker。

---

## 九、验证状态

- 单元测试：`tests/importer.test.js` 28 断言全过（含微信 XLSX/CSV、支付宝 XLSX/GBK、DV CSV/backup、Mini 恢复、去重、金额、分类）。夹具全虚构。
- 模拟器（iPhone 12/13, Skyline）：完整 UI 闭环通过（入口 → 预览 → 确认 → 结果 → 主页按天展示）。
- 未验证：真实账单文件、真机（尤其 iOS JSC）的 GBK TextDecoder、真机超大文件内存、`chooseMessageFile` 真机交互。详见 `TEST_REPORT.md`。
