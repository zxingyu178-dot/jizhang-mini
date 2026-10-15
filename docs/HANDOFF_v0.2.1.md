# DailyValue Mini v0.2.1 修复交付说明

- **Repository**：https://github.com/zxingyu178-dot/jizhang-mini
- **Branch**：`main`
- **Version**：`0.2.1`（统一事实源 `utils/version.js`）
- **上一版**：v0.2.0（提交 `d5a3957`）
- **代码真源**：GitHub `main`（本版不另打源码 zip）

> 本版是 v0.2.0 产品底座之后的**稳定性修复版**，范围严格限定为你下发的 3 个 P0、3 个 P1 与 1 个真机 Gate；未新增 v0.2.0 之外的产品功能。

---

## 一、P0 修复

### P0-1 跨月编辑 `updateBill()`
- 现在先在**全分片**定位账单，得到 `oldYm` 与原账单；合并 patch 后计算 `newYm`。
- **同月**：原位更新；**跨月**：从旧分片删除、写入新分片。
- 账单 **id 始终不变**（不是删旧建新）；刷新 `updatedAt`。
- 引入 `snapshotMonths/restoreMonths`：写入用 try/catch，任一步失败用快照回滚后抛错，保证不产生半迁移。
- 校验：全局该 id 恰 1 条、跨月后旧月 0 条、新月 1 条。
- 新增测试：10→9、9→10、同月原位、跨月注入失败回滚。

### P0-2 legacy `jm_records` 迁移原子性与幂等
- 迁移前对涉及月份建立安全快照，备份原始数组到 `legacyRecordsBackup`。
- 所有转换、写入、重读校验（条数 + 收入/支出总额）成功后才写 `status=done`。
- 任何写入/校验失败：`restoreMonths` 回滚到迁移前状态，并写 `status=failed`。
- 幂等：迁移账单使用确定性 id `mig-<oldId>`；重跑前先剥离历史失败残留，故**连续重启 / 再次迁移不产生重复**。
- 新增测试：人为注入失败 → 账本 0 污染 → 重新执行成功且无重复；连续 init 幂等。

### P0-3 版本统一 0.2.1 + `npm test` 一键入口
- 新增 `utils/version.js`，`APP_VERSION='0.2.1'` 为唯一事实源；`manifest`、`backup`、`app.js`、设置页、`package.json`、`package-lock.json`、README 全部引用/同步。
- 新增 `tests/run-all.js`：`npm test` 一条命令依次跑 `device` + `data` + `importer`，任一失败退出码非 0，全过退出 0（跨平台，不依赖 shell `&&`）。

## 二、P1 修复

### P1-1 编辑账单保留原始时分
- 新增纯函数 `dateWithTime(dateStr, hours, minutes)`。
- 新建账单：用当前时分。编辑已有账单：用户只改日期时，**合并新年月日与原始时分**，不再被改成编辑发生的时间。

### P1-2 importer 分包按需加载
- 移除首页对约 980KB importer 分包的预下载；`preloadRule` 触发页改为「设置」页，进入「设置/数据导入」时才预下载。
- 经核查官方文档：微信**小程序**分包预下载目前只支持 `preloadRule` 配置、不支持运行时 API（`wx.preDownloadSubpackage` 属小游戏），故此为唯一正确方案。

### P1-3 导入失败脱敏诊断
- 新增 `packages/importer/core/diagnosis.js`：记录来源、文件类型、编码、表头是否找到、数据行/准备导入/疑似重复/已存在/需确认/跳过计数，以及无法解析的行（行号、列名、列序号、原因）。
- 各 adapter（微信/支付宝/dailyvalue）与 detector 全程接线；失败弹窗、预览页提供「复制脱敏诊断」。
- 诊断**不含**姓名、商户、商品、账号、交易号、金额、文件名。

## 三、测试结果（已实际执行）

命令：工程根目录 `npm test`

| 套件 | 用例数 | 结果 |
| --- | --- | --- |
| device.test.js | 6 | PASS |
| data.test.js | 92 | PASS |
| importer.test.js | 47 | PASS |
| **合计** | **145** | **全绿，退出码 0** |

## 四、验收状态（如实记录）

| 项 | 状态 |
| --- | --- |
| Node 纯单测（含跨月/迁移/诊断） | **PASS（145 项）** |
| 开发者工具模拟器目视（页面正常、账单与统计正确） | **PASS（人工目视）** |
| Android 真机 Gate | **待你执行**：见 `docs/DEVICE_GATE_v0.2.1.md` |
| iOS 真机 | **NOT TESTED**（无真机） |
| 真实账单导入 | **待真机验证**（fixture 全绿，不代表真实账单） |
| miniprogram-automator 模拟器自动回归 | **已部署，本环境未完整跑通**（见下） |

### 关于 miniprogram-automator（已部署但受限）
- 已在 `devDependencies` 安装 `miniprogram-automator@0.12.1`，并提供 `tests/automator-smoke.js`（connect 后自动尝试 launch）。
- 本次会话中，自动化连接可建立、页面栈可见，但 `reLaunch/navigateTo` 报 `Uncaught [object Object]`、`currentPage()` 拿不到渲染上下文。
- 已用对照实验确认**与 Skyline 无关**（切 webview 现象相同），判定为该工具版本与自动化实例注入/窗口的环境兼容问题；**未计入** `npm test`，也不影响功能正确性。
- 建议后续在「单实例、正常带窗口」的 IDE 下再运行 `tests/automator-smoke.js`；自动化回归的稳定底座仍是 `npm test`。

## 五、待你完成（真机 Gate）

请按 `docs/DEVICE_GATE_v0.2.1.md` 在 Android 真机逐项验收：
手工记账、跨月编辑（双向+时分保留）、备份恢复、`chooseMessageFile`、至少一种真实账单导入、同一文件导入两次不重复。
异常时只发「复制脱敏诊断」文字即可。若支付宝 GBK CSV 真机失败，告知我，立即接线 `cptable(936)` 纯 JS 解码兜底。
