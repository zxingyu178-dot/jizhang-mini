# DEV LOG — 随时随地大小记（jizhang-mini）

- 当前版本：**1.4.2**（本轮冻结，不升版本）
- 本文件记录 **v1.4.2 最终稳定化阶段**的开发日志，按 Gate 分节
- 记录时间：2026-11-10
- 分支：`fix/v1.4.2-final-stabilization`
- 基线：`5c33d6da8b9e72308abc640ad7810e75b29032dc`（原 `main` HEAD，也就是合并前的 `origin/main`）
- 当前 HEAD：`959f21ec29421f66f7a25a2187168ae469f80dd3`

> **看这份日志前先分清两件事**
>
> | | 阶段测试 | 最终测试 |
> | --- | --- | --- |
> | 谁跑 | 开发自验 | QA（Gate 4 回归 + 销项） |
> | 什么时候 | Gate 1 / Gate 2 开发过程中 | Gate 4 收尾 |
> | 作用 | 自己先确认改动没写崩 | 对外交付的**唯一依据** |
>
> 下文每节都标注了是哪一种。

---

## Gate 0 — 基线确认

**改了什么**
无代码改动。确认起点：

- 基线提交 `5c33d6d`，与原 `main`、合并前 `origin/main` 三者一致
- 版本号 1.4.2
- 从基线切出分支 `fix/v1.4.2-final-stabilization`

**怎么验的**

```bash
git rev-parse origin/main   # 5c33d6da8b9e72308abc640ad7810e75b29032dc
git rev-parse main          # 5c33d6da8b9e72308abc640ad7810e75b29032dc
git branch --show-current   # fix/v1.4.2-final-stabilization
```

**结果**
基线明确、分支干净、没有夹带未提交改动。

（补充说明：此时 `git status --short` 已有 8 条 `??` 未跟踪项，全部是仓库根目录的历史交付 ZIP，不是源码改动。详见 `git/status.txt`。）

---

## Gate 1 — 恢复链路加固（P0）

**改了什么**

| 文件 | 具体改动 |
| --- | --- |
| `data/fs.js`（+47） | 新增**严格删除**能力：删文件删不掉时不再静默返回成功，把失败暴露出来（`removeStrict`）。原因：删除失败被吞掉，就会出现"以为删了其实还在"，后续恢复/回滚全部建立在一个错的前提上 |
| `data/backup.js`（+69） | 恢复链路：`createdAt` **缺失**与**非法值**分开处理。缺失 = 老备份（Backup V1/V2）的正常情况 → 静默补齐；非法值 = 真问题 → 留可查诊断 |
| `data/recurring/store.js`（+131） | ① 周期规则恢复**只规范化一次**（原来反复规范化，同一条规则被补多次字段，结果可能不一致）；② 临时安全点清理失败留可查诊断 |
| `packages/importer/core/commit.js`（+38） | 导入提交/回滚：原始安全点与临时安全点**隔离**；回滚成功清理临时、失败则两者都保留 |

**为什么这么改**
这些都属于"用户看不见，但一旦出问题就伤数据"的地方。用户感知不到 ≠ 风险不存在，所以 P0。

**怎么验的 —— 阶段测试（开发自验）**

- `npm test`：**50/50 套件通过，0 失败**
- 新增/补充专项测试 4 个（见下），覆盖面见 Gate 2

**结果**
阶段测试全绿，提交 `d01b9d9`。

---

## Gate 2 — 专项测试补齐

**改了什么**

本轮**只加测试、不改业务逻辑**，把 Gate 1 的改动逐条钉上用例：

| 测试文件 | 新增 | 覆盖什么 |
| --- | --- | --- |
| `tests/quarantine-rollback.test.js` | +280 | 隔离与回滚：安全点隔离、回滚完成/未完成的判定、失败时不谎报成功 |
| `tests/backup-restore-statistics.test.js` | +178 | 备份恢复后**统计数字**是否还与恢复前一致（数量、ID 集合、关键字段、重复 ID） |
| `tests/import-rollback-safety.test.js` | +129 | 导入回滚安全：失败后账本未被写坏 |
| `tests/recurring.test.js` | +131 | 周期规则恢复：只规范化一次、缺失字段补齐、非法值诊断 |
| `tests/perf/large-ledger.perf.js` | +39 | 性能基准**去掉写死日期**——原基准写死了日期，跨天跑会因数据落在不同月份而误报 |

**怎么验的 —— 阶段测试（开发自验）**

| 项 | 结果 |
| --- | --- |
| 单元测试全套 | **50/50 套件通过，0 失败** |
| 大账本性能 | 1k 全量 **1ms** / 5k **7ms** / 10k **14ms**；1k→10k 比值 **14.0x**（期望 ≤40x，说明没出现超线性退化） |

**结果**
专项测试全部就位，提交 `d01b9d9` 之后由 QA 接手做最终测试。

---

## Gate 4 — 回归与销项（最终测试 · QA 实跑）

**改了什么**
代码层面只有一处小整改，来自 QA 提的两个问题：

| 编号 | QA 提的问题 | 整改内容 | 提交 |
| --- | --- | --- | --- |
| QA-01 | 性能基准里写死了日期，跨天跑结果会漂 | 去掉写死日期，改为运行时生成 | `959f21e` |
| QA-03 | `createdAt` 非法时诊断信息看不清，没法查 | 非法值保留**可查的诊断**（字段名 + 错误码），缺失值仍静默补齐 | `959f21e` |

**怎么验的 —— 最终测试（QA 实跑，对外以此为准）**

| 项 | 结果 |
| --- | --- |
| 单元测试全套 | **50/50 套件通过，0 失败** |
| 专项 · `quarantine-rollback` | **279 项通过** |
| 专项 · `backup-restore-statistics` | **44 项通过** |
| 专项 · `import-rollback-safety` | **54 项通过** |
| 专项 · `recurring` | **145 项通过** |
| 专项 · `recovery-ui-guard` / `dedupe-index` / `import-e2e-safety` | 全部通过 |
| E2E | **31/31 通过，0 失败**，19 张截图，产物在 `artifacts/e2e/2026-11-10T01-15-53-115Z` |
| 审计 theme / contrast / release | 三项 **FAIL = 0，警告 = 0**（对比度 0 项失败） |
| 性能 · 导入预览 | 5,000 笔 **104ms** / 15,000 笔 **169ms** / 30,000 笔 **302ms**（红线 1,500ms） |

**结果**
QA 销项通过，无遗留 FAIL。提交 `959f21e`。

> **一个要说明的数字**：上一阶段（第一阶段开发）记录的 30k 导入预览是 **111.6ms**，本阶段最终测试是 **302ms**。
> 不是回退 —— 是不同轮次、不同机器负载下的实测值，两者都远低于 1,500ms 红线。
> **对外口径以最终测试 302ms 为准。**

---

## Gate 3 — 交付文档整理（本次）

**改了什么**
**没有改任何源码 / 测试 / 配置。** 本 Gate 只产出文档：

| 文档 | 性质 |
| --- | --- |
| `docs/HANDOFF_v1.4.2.md` | 追加第二阶段交接（第一阶段原文一字未改） |
| `DEV_LOG.md` | 新建（本文件） |
| `TASKS.md` | 新建 |
| `docs/10_DEVICE_ACCEPTANCE.md` | 追加第 6 节「v1.4.2 真机验收清单」（原有内容未动） |
| `reports/final-audit.md` | 新建 |
| `reports/data-safety.md` | 新建 |
| `git/status.txt` | 新建（`git status --short` 原文 + 说明） |
| `git/commits.txt` | 新建（提交 / 分支 / SHA 原文） |
| `docs/V1.4.0_RUN_MODE.md` | 追加一段运行模式记录（历史段落未动） |

**怎么验的**
对照 `git diff --name-only 5c33d6d..HEAD` 逐个核改动文件；文档里出现的每个数字都能追溯到实际运行输出或 git 命令结果。

**结果**
文档齐活。**本 Gate 不提交、不合并、不推送、不打包** —— 这些是下一棒的事。

---

## 附：本阶段改动文件总览（9 个，git 实测）

```
data/backup.js                          |  69 ++++++--
data/fs.js                              |  47 ++++++
data/recurring/store.js                 | 131 ++++++++++++++-
packages/importer/core/commit.js        |  38 ++++-
tests/backup-restore-statistics.test.js | 178 ++++++++++++++++++++
tests/import-rollback-safety.test.js    | 129 ++++++++++++++-
tests/perf/large-ledger.perf.js         |  39 ++++-
tests/quarantine-rollback.test.js       | 280 ++++++++++++++++++++++++++++++++
tests/recurring.test.js                 | 131 +++++++++++++++
9 files changed, 1016 insertions(+), 26 deletions(-)
```

> 任务书正文写「改动文件 8 个」，同表末尾又写「共 9 个，按 git diff 为准」。
> **实际 git 输出是 9 个**，本日志以 git 为准。

**未改动**（已用 diff 确认输出为空）：`package.json`、`package-lock.json`、`project.config.json`。
**数据合同未变**：Bill **V3** / Backup **V3**（恢复兼容 V1、V2、V3）/ Recurring Store **V1**，字段集合均未变。
**依赖未新增**：`devDependencies` 仍只有 `miniprogram-automator`（仅测试用）。
