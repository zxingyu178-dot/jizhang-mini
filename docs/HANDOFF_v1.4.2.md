# HANDOFF — 随时随地大小记 v1.4.2（Recovery Integrity & Import Match Safety）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：`feature/v1.4.2-recovery-integrity` → 合并回 `main`
- Version：**1.4.2**
- AppID：`wxcdcf83d9191065d9`
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md`）
- 开发基线：v1.4.1 / `7f87a41bbc09ac18633acd83fec0a776d206cfef`
- 本版定位：**恢复完整性与导入匹配安全收尾**，不新增业务功能、不升级数据合同、不引入第三方依赖。
- 完成状态：**READY_FOR_DEVICE_ACCEPTANCE**（自动化全绿；真机 iPhone / Android 未测试，由用户按 `docs/10_DEVICE_ACCEPTANCE.md` 执行）

---

## 0. 结论速览

| 维度 | 结果 |
| --- | --- |
| 删除失败检测 | `fs.removeStrict` + `ledger.removeMonthFileStrict`；只删除目标月份之外的分片，目标月份原子覆盖 |
| 安全点校验 | envelope / bills / categories / settings / recurringRules / 重复 ID / 语义全部通过才回滚 |
| 恢复后对账 | 数量 + ID 集合 + 关键字段 + 重复 ID，严格回读比对 |
| 回滚失败 | `rollbackCompleted=false` + `rollbackError.code`，安全点保留，不谎报成功 |
| 导入索引 | CSV 键改为 `JSON.stringify([...])`，消除 `cat|x + memo` 与 `cat + x|memo` 碰撞 |
| 恢复失败提示 | 未修改 / 已恢复 / 恢复未完成 / 无法确认 四级提示；回滚失败阻止再次提交 |
| E2E 临时文件 | 固定目录、自动文件名、basename、扩展名白名单、解析后清理 |
| 单元测试 | **49/49** 套件通过 |
| E2E | **31/31** 通过 |
| 30k 导入预览 | **111.6 ms**（基线 1,618.2 ms，14.5×） |
| 真机 | **未测试** |

---

## 1. 分 Gate 交付

### Gate 0 — 基线
- HEAD `7f87a41`，与 `origin/main` 一致；版本 1.4.1；数据合同未变。
- 新建分支 `feature/v1.4.2-recovery-integrity`。

### Gate 1 — 恢复完整性（P0）
- `data/fs.js`：`removeStrict()`。
- `data/ledger.js`：`removeMonthFileStrict()`、`readAllBillsStrict()`。
- `data/backup.js`：精确替换账本、删除确认、安全点完整校验、账单集合对账、元数据核对、回滚失败明确报告。
- `tests/quarantine-rollback.test.js`：Q8/Q9 调整 + R13/R13b/R14–R18/R18b/R19–R22，共 **170 项**。
- 报告：`docs/V1.4.2_DATA_SAFETY_REPORT.md`
- 提交：`b98241a` + `dcda386`

### Gate 2 — 导入索引可靠性（P1）
- `packages/importer/core/dedupe.js`：CSV 匹配键改为 JSON 数组编码。
- `tests/dedupe-index.test.js`：碰撞 / 引号 / 反斜杠固定用例 + 随机差分，共 **54 项**。
- 报告：`docs/V1.4.2_IMPORT_MATCH_REPORT.md`
- 提交：`bf7a6ab`

### Gate 3 — 恢复失败交互与临时文件（P1/P2）
- `preview.js` / `preview.wxml` / `preview.wxss`：四级提示、错误码、回滚失败阻止再次提交、禁用态按钮。
- `import.js`：E2E 临时文件固定目录 + 自动文件名 + basename + 扩展名白名单 + 清理。
- `tests/recovery-ui-guard.test.js` **28 项**；`tests/import-e2e-safety.test.js` 扩充到 **48 项**。
- 提交：`beab202`

### Gate 4 — 专项回归
- `npm test` **49/49**。
- `npm run e2e` **31/31**（T28/T29/T30/T31 均通过）。
- 性能重测 3 轮 × 5 次中位：5k **31.8 ms**、15k **70.4 ms**、30k **111.6 ms**。

### Gate 5 — 收口
- 版本 1.4.2；CHANGELOG / README / HANDOFF / FINAL_AUDIT / 10_DEVICE_ACCEPTANCE。
- `release:check`、`theme:audit`、`contrast:audit` 通过。
- 验收 ZIP：`DailyValueMini_v1.4.2_Review.zip`（含真机清单、完整 Git 状态与测试日志）。

---

## 2. 修改文件

### 源码
- `data/fs.js`、`data/ledger.js`、`data/backup.js`
- `packages/importer/core/dedupe.js`
- `packages/importer/pages/preview/preview.{js,wxml,wxss}`
- `packages/importer/pages/import/import.js`

### 测试
- `tests/quarantine-rollback.test.js`（170）
- `tests/dedupe-index.test.js`（54）
- `tests/import-e2e-safety.test.js`（48）
- `tests/recovery-ui-guard.test.js`（28，新增）
- `tests/run-all.js`

### 文档
- `docs/V1.4.2_DATA_SAFETY_REPORT.md`
- `docs/V1.4.2_IMPORT_MATCH_REPORT.md`
- `docs/V1.4.2_FINAL_AUDIT.md`
- `docs/HANDOFF_v1.4.2.md`
- `docs/10_DEVICE_ACCEPTANCE.md`（版本更新到 1.4.2）

### 明确未改
- 数据合同、金额 / 统计 / 预算 / 周期算法、账本分片格式、主题、Bottom Sheet、渲染器、第三方依赖。

---

## 3. 测试与审计

```
npm test                    49/49 套件通过
npm run e2e                 31/31 通过
quarantine-rollback         170 passed
dedupe-index                54 passed
import-e2e-safety           48 passed
recovery-ui-guard           28 passed
```

性能（3 轮 × 5 次中位，Node v24 + 内存 FS，日志见 `logs/v1.4.2/perf-run*.json`）：

| 账本 | 耗时 |
| --- | --- |
| 5,000 | 31.8 ms |
| 15,000 | 70.4 ms |
| 30,000 | **111.6 ms** |

审计：`theme:audit` 0 FAIL（3 项既有 WARN）；`contrast:audit` dark 3.145 / light 3.249；`release:check` 0 FAIL / 1 WARN（`libVersion=latest`）。

---

## 4. 真机验收（未测试）

按 `docs/10_DEVICE_ACCEPTANCE.md` 执行：iPhone / Android 首页、圆环、主题、键盘、Bottom Sheet、搜索、导入、备份恢复、数据安全专项。

> 破坏性故障注入只在 Node 隔离测试执行；不要求在真实用户数据上制造损坏。

---

## 5. 已知限制

1. 回滚仍不是数据库级原子操作；本版保证「删除可确认、写入前校验安全点、写后精确对账、失败明确报告」。
2. 320 / 360 / 430 模拟器机型本次未重新截图；390px 为真实 Skyline 实测，其余由 CSS 契约与宽度估算覆盖。
3. XLSX 未做 GUI 文件选择 E2E，由 `tests/importer.test.js` 覆盖。
4. `project.config.json` 仍为 `libVersion=latest`；当前实测基础库 3.17.4，未未经确认固定。
5. 微信上传 / 审核 / 发布未执行，等待代码审查批准。

---

## 6. Git

| 阶段 | 提交 |
| --- | --- |
| Gate 0 + 1 | `b98241a7c3622c825b7dfea959032fe718d02917` |
| Gate 1 收尾 | `dcda386bb2abc458a02d987f235b7ca214f0d5e7` |
| Gate 2 | `bf7a6ab92c2b48d58e4787ec4f1531501febedc8` |
| Gate 3 | `beab2025f1e8e36acb225fb177f583ddf113e142` |
| Gate 5 | 以 `git log -1 --format=%H` / 交付包 `git/commits.txt` 为准 |

远端：合并后 `origin/main` 与最终 HEAD 一致。
