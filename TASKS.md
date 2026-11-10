# TASKS — v1.4.3 收口轮 · 任务清单

- 版本：**1.4.3**
- 记录时间：2026-11-10
- 分支：`fix/stats-hero-narrow-class`（基线 `origin/main` = `6fa12b9`）
- 状态图例：`已完成` / `未执行`（未执行必须写原因）

---

## 〇、v1.4.3 总览

| 状态 | 数量 |
| --- | --- |
| 已完成 | 9 |
| 未执行 | 4 |

## 〇-1、本轮任务与状态

| # | 任务 | 状态 | 结果 / 备注 |
| --- | --- | --- | --- |
| N-1 | 新增 `docs/HANDOFF_v1.4.3.md`（门禁强制项，`release-check.js` 按 `APP_VERSION` 动态检查） | 已完成 | 新建；建完后 `release:check` FAIL 由 1 → **0** |
| N-2 | 更新 `CHANGELOG.md`（顶部加 1.4.3 条目） | 已完成 | 按现有格式写 |
| N-3 | 更新 `README.md` 版本行功能描述（原括号内容还是 1.4.2 口径） | 已完成 | 改为 真实点击测试 / 表单可用性 / 窄屏适配 |
| N-4 | 更新 `DEV_LOG.md`（本轮 4 件事 + 验证结果） | 已完成 | v1.4.2 各节原文未改，仅在其前新增一节 |
| N-5 | 更新 `TASKS.md` 状态 | 已完成 | 本节 |
| N-6 | `docs/10_DEVICE_ACCEPTANCE.md` 版本改 1.4.3 + 补「键盘弹起是否遮挡输入框」 | 已完成 | 模拟器测不出，只能真机 |
| N-7 | `reports/final-audit.md`、`reports/data-safety.md` 版本与测试数字同步 | 已完成 | |
| N-8 | 采真实日志到 `reports/logs/`（12 条命令 + E2E + real-tap） | 已完成 | 全部成功，结果见 `reports/logs/` |
| N-9 | 合并 `fix/stats-hero-narrow-class` → `main`、推送、核对 SHA、重打验收 ZIP | 已完成 | 实际 SHA 与推送输出见 `git/commits.txt` |

## 〇-2、本轮未执行（必须写明原因）

| # | 任务 | 状态 | 原因 / 由谁做 |
| --- | --- | --- | --- |
| Y-1 | **微信真机验收**（iPhone + Android） | **未执行** | 必须真机，自动化替代不了。由**客户**按 `docs/10_DEVICE_ACCEPTANCE.md` 逐项勾选 |
| Y-2 | **键盘弹起是否遮挡输入框** | **未执行** | 模拟器不弹真键盘（real-tap 键盘探针高度事件为空），只能真机看 |
| Y-3 | **发布上线**（上传 / 提审 / 发布） | **未执行** | 等真机验收结论。材料见 `docs/09_WECHAT_UPLOAD.md` |
| Y-4 | 固定 `libVersion` + 后台按体验版/线上版设最低基础库 | **未执行** | 客户已定不动；`release:check` 保留 1 条 WARN 并解释，不关检查隐藏 |

## 〇-3、本轮不做（明确排除，避免误以为漏做）

- 不改业务代码（`data/` / `packages/` / 组件逻辑 / `utils/` 均未动）
- 不改数据合同、不加依赖、不换渲染器
- 不动 `project.config.json` 的 `libVersion`
- 不改、不删、不移任何历史 ZIP 与历史报告（`docs/V1.4.2_*.md`、`docs/HANDOFF_v1.4.2.md`、`docs/HANDOFF_v1.4.1.md`、`logs/v1.4.2/`）
- 不改 `.gitignore`（`reports/logs/` 不进版本库是已知情况，日志随 ZIP 交付）

---

# 以下为 v1.4.2 最终稳定化任务清单（历史原文，未改）

- 版本（本节）：**1.4.2**（本轮冻结，不升版本）
- 记录时间：2026-11-10
- 分支：`fix/v1.4.2-final-stabilization`（基线 `5c33d6d`，HEAD `959f21e`）
- 状态图例：`已完成` / `未执行`（未执行必须写原因）

---

## 一、总览

| 状态 | 数量 |
| --- | --- |
| 已完成 | 19 |
| 未执行 | 6 |

---

## 二、Gate 0 — 基线确认

| # | 任务 | 状态 | 备注 |
| --- | --- | --- | --- |
| 0-1 | 确认基线提交 `5c33d6d` = 原 `main` HEAD = 合并前 `origin/main` | 已完成 | 三者一致，git 实测 |
| 0-2 | 切出分支 `fix/v1.4.2-final-stabilization` | 已完成 | |
| 0-3 | 版本号确认冻结为 1.4.2（本轮不升版本） | 已完成 | |
| 0-4 | 登记工作区 8 个未跟踪历史 ZIP（不删、不改、不移） | 已完成 | 见 `git/status.txt` |

---

## 三、Gate 1 — 恢复链路加固（P0）

| # | 任务 | 状态 | 结果 |
| --- | --- | --- | --- |
| 1-1 | `data/fs.js` 新增严格删除能力（删不掉不静默） | 已完成 | +47 |
| 1-2 | `data/backup.js` 区分 `createdAt` 缺失（老备份正常）与非法值（真问题） | 已完成 | +69 |
| 1-3 | `data/recurring/store.js` 周期规则恢复只规范化一次 | 已完成 | +131 |
| 1-4 | `data/recurring/store.js` 临时安全点清理失败留可查诊断 | 已完成 | 同上 |
| 1-5 | `packages/importer/core/commit.js` 原始安全点与临时安全点隔离 | 已完成 | +38 |

**阶段测试（开发自验）**：`npm test` **50/50 套件通过，0 失败**。

---

## 四、Gate 2 — 专项测试补齐

| # | 任务 | 状态 | 新增 |
| --- | --- | --- | --- |
| 2-1 | `tests/quarantine-rollback.test.js` 隔离与回滚专项 | 已完成 | +280 |
| 2-2 | `tests/backup-restore-statistics.test.js` 备份恢复后统计一致性 | 已完成 | +178 |
| 2-3 | `tests/import-rollback-safety.test.js` 导入回滚安全补充 | 已完成 | +129 |
| 2-4 | `tests/recurring.test.js` 周期规则恢复补充 | 已完成 | +131 |
| 2-5 | `tests/perf/large-ledger.perf.js` 性能基准去掉写死日期 | 已完成 | +39 |

**阶段测试（开发自验）**：50/50 套件通过；大账本性能 1k 1ms / 5k 7ms / 10k 14ms，比值 14.0x（期望 ≤40x）。

---

## 五、Gate 4 — 回归与销项（最终测试 · QA 实跑）

| # | 任务 | 状态 | 结果 |
| --- | --- | --- | --- |
| 4-1 | 单元测试全套回归 | 已完成 | **50/50 套件通过，0 失败** |
| 4-2 | 专项 `quarantine-rollback` | 已完成 | **279 项通过** |
| 4-3 | 专项 `backup-restore-statistics` | 已完成 | **44 项通过** |
| 4-4 | 专项 `import-rollback-safety` | 已完成 | **54 项通过** |
| 4-5 | 专项 `recurring` | 已完成 | **145 项通过** |
| 4-6 | 专项 `recovery-ui-guard` / `dedupe-index` / `import-e2e-safety` | 已完成 | 全部通过 |
| 4-7 | E2E 全量 | 已完成 | **31/31 通过，0 失败**，19 张截图，产物 `artifacts/e2e/2026-11-10T01-15-53-115Z` |
| 4-8 | 审计 theme / contrast / release | 已完成 | 三项 **FAIL = 0，警告 = 0**（对比度 0 项失败） |
| 4-9 | 性能 · 导入预览 | 已完成 | 5k **104ms** / 15k **169ms** / 30k **302ms**（红线 1,500ms） |
| 4-10 | QA-01 性能基准写死日期整改 | 已完成 | 提交 `959f21e` |
| 4-11 | QA-03 `createdAt` 非法值留可查诊断 | 已完成 | 提交 `959f21e` |

---

## 六、Gate 3 — 交付文档整理（本轮）

| # | 任务 | 状态 | 产出 |
| --- | --- | --- | --- |
| 3-1 | 交接包 | 已完成 | `docs/HANDOFF_v1.4.2.md`（追加第二阶段，第一阶段原文未改） |
| 3-2 | 开发日志 | 已完成 | `DEV_LOG.md` |
| 3-3 | 任务清单 | 已完成 | `TASKS.md`（本文件） |
| 3-4 | 真机验收清单 | 已完成 | `docs/10_DEVICE_ACCEPTANCE.md` 第 6 节（追加） |
| 3-5 | 最终审计报告 | 已完成 | `reports/final-audit.md` |
| 3-6 | 数据安全报告 | 已完成 | `reports/data-safety.md` |
| 3-7 | 工作区原始记录 | 已完成 | `git/status.txt` |
| 3-8 | 提交原始记录 | 已完成 | `git/commits.txt` |
| 3-9 | 运行模式记录 | 已完成 | `docs/V1.4.0_RUN_MODE.md`（追加一段） |

**Gate 3 边界（本轮严格遵守）**：只写文档 —— 未改任何源码 / 测试 / 配置，未 commit、未 merge、未 push、未打 ZIP。

---

## 七、未执行项（必须写明原因）

| # | 任务 | 状态 | 原因 / 由谁做 |
| --- | --- | --- | --- |
| X-1 | **微信真机验收**（体验版 / 真机 iPhone + Android） | **未执行** | 必须在真实手机上做，自动化替代不了。由**客户**按 `docs/10_DEVICE_ACCEPTANCE.md` 第 6 节逐项勾选 |
| X-2 | **发布上线**（体验版上传 / 提审 / 发布） | **未执行** | 需先拿到真机验收结论 + 代码审查批准。提审材料见 `docs/09_WECHAT_UPLOAD.md` |
| X-3 | 固定 `libVersion` + 微信后台按体验版/线上版设最低基础库 | **未执行** | 本轮不动配置（Gate 3 只写文档）；且固定成哪个版本要等真机兼容性确认后再定，现在拍数字是赌。详见 `reports/final-audit.md` §5 |
| X-4 | 合并 `fix/v1.4.2-final-stabilization` → `main` | **未执行** | 下一棒动作，本次任务书明确不做 |
| X-5 | `git push` / 打 ZIP 交付包 / 打 tag | **未执行** | 同上，下一棒动作 |
| X-6 | 320 / 360 / 430 模拟器机型重新截图；XLSX 的 GUI 文件选择 E2E | **未执行** | 沿用第一阶段结论：390px 为真实实测，其余靠 CSS 契约与宽度估算覆盖；XLSX 由 `tests/importer.test.js` 覆盖 |

---

## 八、本轮不做（明确排除，避免误以为漏做）

- 不升版本号（1.4.2 冻结）
- 不改数据合同（Bill V3 / Backup V3 / Recurring Store V1 字段集合未变）
- 不新增第三方依赖
- 不动 `project.config.json` / `package.json` / `package-lock.json`
- 不改任何历史报告（`docs/V1.4.1_*`、`docs/V1.4.2_FINAL_AUDIT.md`、`docs/V1.4.2_DATA_SAFETY_REPORT.md` 等）
- 不删 / 不改 / 不移仓库根目录 8 个历史交付 ZIP
