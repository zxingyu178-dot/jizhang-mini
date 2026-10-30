# HANDOFF — 随时随地大小记 v1.3.2（Interaction Reliability & Visual Polish）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**1.3.2**
- 品牌名：**随时随地大小记**
- AppID：`wxcdcf83d191065d9`
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + `packages[""]` 两处）、`README.md`、`CHANGELOG.md`）
- 上一版本基线：v1.3.1（HEAD `ef5be31`）
- 本版定位：**交互可靠性与视觉语义收口，不增加无关业务功能。** 核心四件事：测试代码不污染正式账本、圆环触摸区分点击与滑动、颜色只由稳定 categoryId 决定、Top7+其他展开状态不再误导用户。
- 后续路线：本版完成后停止，等用户审 main 并由 ChatGPT 审查；真机 Gate 由用户本人执行，助手不代签。

---

## 1. 背景与目标

v1.3.1 已让分类占比圆环可触摸，但存在四类可靠性问题：测试注入 / 清理方法直接内联在正式业务代码且无环境守卫；`onTouchStart` 手指刚触碰即选中，滑动统计页会误触发；颜色最终受分类排序影响（c-shopping、c-life 旧哈希基础索引都为 2，排名变化会互相换色）；展开全部分类后图例颜色与圆环不再一一对应。本版逐项收口，不升级数据合同、不新增业务功能、不把分类颜色持久化。

数据合同在本版**全部冻结**：Bill V3、Backup V3、Recurring Store V1、Budget V1 均不升级；不新增分类颜色持久化字段。

---

## 2. Gate 0：测试代码与数据安全

### 2.1 环境识别（新增 `utils/env.js`，独立单测）

- **`getEnvVersion()`**：读 `wx.getAccountInfoSync().miniProgram.envVersion`，仅认 develop/trial/release；异常 / 缺失 / 未知值 **fail-closed 回退 release**。
- **`isTestEnv()`**：仅 develop/trial 返回 true，release 为 false。

### 2.2 测试桥接模块（新增 `utils/e2e-donut-seed.js`，与业务逻辑解耦）

- 三个函数 `seedDonut()`（5 分类）/ `seedDonutMany()`（10 分类）/ `clearDonut()`，固定标识 `E2E_DONUT_TAG='E2E_DONUT'`。
- 注入前先清残留，实现异常退出自愈；清理按备注**精确全等匹配**、不做宽泛匹配，避免误删真实账单；返回创建记录与清理记录。

### 2.3 页面入口（`pages/main/main.js`）

- `__e2eSeedDonut` / `__e2eSeedDonutMany` / `__e2eClearDonut` 三个薄委托，**先 `env.isTestEnv()` 守卫，release 下抛错、不执行任何注入 / 清理**，通过后才 require 桥接模块。
- 正常记账、导入、删除、备份恢复逻辑未改动。

### 2.4 工程妥协（需用户知悉）

- 实证：被 `project.config.json` packOptions.ignore 的文件无法在本地模拟器 require（folder 与 file 两种类型均验证），微信原生工具无「本地可用且发布排除」的低复杂度官方机制。
- 故桥接模块参与编译、物理进发布包（约 3KB），但 release 下入口 fail-closed、模块为不可达死代码、无敏感信息；比项目现有 `__selftest` / `__migtest`（内联、无守卫）更安全。若用户坚持测试代码零进包，当前无低复杂度官方机制，需进一步讨论。

---

## 3. Gate 1：圆环触摸手势重构

`components/category-donut/category-donut.js` 改为完整手势状态机，WXML 根 view 绑定 touchstart/move/end/cancel：

- **触摸开始**：只记录初始 clientX/Y、时间、touch.identifier、候选态并预取 rect（带 seq 守卫），**不做任何选中**。
- **触摸移动**：累计最大位移，超 10px（`MOVE_TOLERANCE_PX`）标记滑动；**全程不调用 `preventDefault`、不阻止页面滚动**。
- **触摸结束**：仅当同一手指（按 identifier 匹配）、最大位移未超阈值、时长 ≤600ms、最终坐标命中有效分段时，才复用 `localToViewBox()` + `hitSegment()` 选中。
- **触摸取消**：`touchcancel` 仅清状态，不残留选中。
- 中心孔 `hitSegment` 返回 -1 不误选；中心按钮 `bindtap` 执行已选分类钻取，与 touch 不冲突；快速连点、切年月状态正确。

---

## 4. Gate 2：颜色映射漂移彻底解决

`data/statistics/donut.js` 改为**黄金角确定性 HSL**，移除旧 8 色板与 usedSet 撞色借用：

- 色相 `H = (hashId(id) × 137.50776405003785°) mod 360`，**只由稳定 categoryId 决定**，不随其他分类出现 / 排名 / 金额变化。
- 饱和度固定 62%；明度随主题微调（深色 56%、浅色 45%），两主题色相身份一致、仅明度变化。
- 新方案 c-shopping（H=9）与 c-life（H=207）天然分离，旧 hash%8 都为 2 的撞色自然消除。
- 撞色靠图标 / 描边等其他视觉属性区分（最小色相间距 c-salary/c-medical 仅 4°，各有图标 💰/💊），**绝不动态改色**。
- 聚合「其他」固定中性色 `#8D94A8`（两主题不变、不占色相）。
- 不新增分类颜色持久化字段，不修改 Backup V3。

### 对比度说明（已知限制）

- 浅色主题 worst 对比度约 2.35（未达非文本 3:1），但已优于现有 v1.3.1 发布版 worst 1.72；为数据色块且有图标辅助，是否最终接受以真机视觉与用户验收为准。深色主题对比度 ≥4.00。

---

## 5. Gate 3：Top 7 + 其他重新整理

`statistics-panel.js` 新增共享方法 `buildExpandedShareRows(share)`，月度 `loadMonth` 与年度 `loadYear` 复用同一方法（不复制两套）：

- **默认态**：圆环 Top7+其他（8 段），图例相同 8 项，颜色一一对应。
- **展开态（聚合时）**：前 7 真实分类保持圆环原色（kind='top'）→ 明确「其他」分组头（kind='group'，总额、分类数量、📦）→ 被聚合子分类（kind='child'，颜色统一中性色、标注「属于「其他」」、保留真实 id 支持独立钻取）。
- 10 分类展开为 7 top + 1 group + 3 child = 11 行。
- 钻取：group 头（aggregate=true）走展开，child 行（aggregate=false）走真实 navigateTo。
- 月度、年度同数据处理与视觉规范。

---

## 6. Gate 4：自动化测试补齐

### 6.1 单测

- 新增 **`tests/env.test.js`（12 项）**，注册进 run-all（套件 30→31）。
- `donut-hit.test.js`（51 项）增加 c-shopping/c-life 排序反转回归、未知 / 缺省主题回退 dark。

### 6.2 E2E 真实触摸

- 实证：当前 Skyline + automator 0.12.1 下 `Element.touchstart/touchmove/touchend` 不送达组件，改用可真实送达的 **`Element.dispatchEvent({eventName,eventData})`**，结合 `offset()` + `size()` 计算圆环坐标。
- T20/T21 月度 / 年度真实触摸；新增 T22/T23 超 8 分类「其他」展开与子分类钻取。
- 关键工程纪律：`mockWxMethod` 的函数经 toString 在小程序逻辑层重建，**禁止引用 Node 闭包自由变量**（会 ReferenceError 使 mock 失效），计数与 URL 写 `globalThis` 再 `evaluate` 读回。

---

## 7. Gate 5：小问题收口

- 修正 `resolveTrackColor()` 回退分支旧拼写 `TRACK_COLOR.dark` → 正确 `TRACK_COLORS.dark`。
- 未知主题值安全回退 dark（`effectiveThemeKey` / `shareThemeKey` / `getCategoryColor` 均有兜底）。
- 选中残留：observers 'segments,size' + clearSelection + cancelGesture 处理。
- 中心旧数据：observer 触发 resetDisplay 回到外部总额。
- 组件销毁：detached 取消主题订阅 `_offTheme` 并 cancelGesture。
- 快速切换异步污染：onTouchEnd / rect 回调带 seq 守卫，过期结果丢弃。
- 修正 OSS 评估报告中把真机滚动 / 手势「不冲突」写成已验证事实的措辞，明确标注为代码层面结论、真机待验收。

---

## 8. 测试真实结果

| 命令 | 结果 |
| --- | --- |
| `npm test` | **31/31 套件通过，0 失败** |
| `npm run e2e` | **T01–T23 全绿 23/23，0 失败**，截图均带 `_simulator` 后缀 |
| `npm run theme:audit` | 0 FAIL，3 项 JS WARN 不阻断 |
| `npm run release:check` | FAIL 0，WARN 1（libVersion 仍 latest，用户侧项） |
| 50k 大压测 | 未运行：本版未改动账本读取与统计计算路径，按任务书不重复耗时压测 |

- 全部改动文件 `node --check` 退出码 0。
- 包体：主包约 608.6 KB，importer 分包约 1361.4 KB，均在限制内。

---

## 9. 真机验收（待用户执行，助手不代签）

- **Agent simulator（automator + Skyline）：PASS** —— 单测、E2E、主题审计、release:check 逻辑项均通过。
- **User physical device：NOT TESTED（待用户）**

待验收项：圆环点击准确率、小扇区点击、上下滑动不误选、页面滚动流畅、月度 / 年度交互、聚合分类展开、深浅主题、5k/15k/30k 账本体验。记录真实设备、微信 / 基础库版本与截图，不把 Node 耗时当真机耗时。

---

## 10. 数据合同冻结声明

v1.3.2 **未升级 / 未改动**任何核心数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1；不新增分类颜色持久化字段，不加入新业务功能。

---

## 11. 已知限制与未完成项

- 真机圆环交互与大账本 Gate 由用户本人完成，结果未测；助手不代签。
- 浅色主题 worst 对比度约 2.35，已优于发布版，最终以真机验收为准。
- 测试桥接模块物理进发布包（release 不可达死代码），安全论证见 2.4，需用户确认是否接受。
- libVersion 仍为 `latest`，体验版验证前保持，属 release:check 唯一 WARN。
- 「点击不阻断滚动」需真机最终确认。

---

## 12. Git 状态

- 基线 `ef5be31`（v1.3.1）。核心改动：donut.js、category-donut（js/wxml）、statistics-panel（js/wxml/wxss）、新增 utils/env.js + utils/e2e-donut-seed.js + tests/env.test.js、main.js 守卫、donut-hit/statistics/run-all/golden-path 测试、OSS 文档措辞、版本文件、README、CHANGELOG 与本 HANDOFF。
- 临时探针（_probe_stack/_probe_many/_probe_t20/_probe_child）与遗留 FAIL 截图已删除，不提交。
- 中文消息用 `git commit -F <file>`，推送走显式代理 `http://127.0.0.1:33210`。
- 最终结果：HEAD == origin/main，ahead=0 / behind=0（核对 `git rev-list --left-right --count origin/main...HEAD`）。
- 最终 Commit SHA：__COMMIT_SHA__（提交后回填）。
