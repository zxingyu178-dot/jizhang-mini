# HANDOFF — 随时随地大小记 v1.3.3（Reliability Closure & Theme Consistency）

- Repository：https://github.com/zxingyu17-dot/jizhang-mini
- Branch：main
- Version：**1.3.3**
- 品牌名：**随时随地大小记**
- AppID：`wxcdcf83d191065d9`
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + `packages[""]` 两处）、`README.md`、`CHANGELOG.md`）
- 上一版本基线：v1.3.2（HEAD `b9fd200`）
- 本版定位：**可靠性收口与主题一致性，不新增业务功能。** 针对外部静态审查指出的 5 类遗留问题逐项修复，数据合同与依赖全部冻结。
- 后续路线：本版完成后停止，等用户审 main；真机 Gate 由用户本人执行，助手不代签。

---

## 1. 背景与目标

外部静态审查对 v1.3.2 指出 5 类问题，逐项读真实代码核实后全部成立、无误报：

1. **多指触摸兜底**：`category-donut` 在原始 identifier 找不到时 `return list[0]`，会拿另一根手指坐标，违背「仅同一手指才能点击」。
2. **遗留入口无守卫**：`main.js` 的 `__selftest`（写真实账本再删）、`__migtest`（直接 `fs.remove` 整个月份文件连带真实账单）均无环境守卫。
3. **清理不跨月**：`e2e-donut-seed.clearDonut` 只清当前月，跨月残留无法发现。
4. **面板未订阅主题**：`statistics-panel` 无 `theme.subscribe`，切主题后圆环明度更新而面板列表颜色停留旧值。
5. **对比度（已知项）**：浅色未达非文本 3:1，且 `theme-audit` 只查硬编码、不查运行时 HSL 对比度。

数据合同与依赖在本版**全部冻结**：Bill V3、Backup V3、Recurring Store V1、Budget V1 均不升级，不新增依赖、不新增分类颜色持久化字段。

---

## 2. Gate 0：测试入口守卫与账本安全

### 2.1 环境识别增强（`utils/env.js`）

- 新增 **`isDevEnv()`**：仅 `develop` 返回 true，trial/release/未知值 fail-closed 返回 false。原有 `getEnvVersion()` / `isTestEnv()` 保持。

### 2.2 迁移测试独立沙箱（新增 `utils/migtest-sandbox.js`）

- 所有文件操作限制在 `USER_DATA_PATH/__migtest_sandbox__`，复用真实 `migration.legacyToBill`，内置 3 条虚构旧数据；自写 `rmTree` 经 `statSync` / `rmdirSync` 递归清理。
- 正式 manifest / bills / storage **零接触**，不再直接 `fs.remove(billFile(...))` 真实月份文件。

### 2.3 页面入口守卫（`pages/main/main.js`）

- 新增 `SELFTEST_TAG` 与幂等 `cleanupSelftestBills`；`__selftest` / `__migtest` 加 `isDevEnv()` 守卫，非开发环境直接抛错；入口整体 try/finally 隔离。
- 三个圆环入口（`__e2e*`）保持 `isTestEnv()` 守卫不变。

### 2.4 清理跨月（`utils/e2e-donut-seed.js`）

- `clearDonut` 改为无参 `rangeBills()` 跨全部月份精确清理，跨月残留可被发现并清除。

---

## 3. Gate 1：手势多指隔离

`components/category-donut/category-donut.js` 四处修改：

- **onTouchStart**：开头加 `if (this._gActive) return;`，第一根手指手势未结束时新手指一律忽略；触摸点改 `firstTouch(changedTouches) || firstTouch(touches)`。
- **onTouchEnd**：把 `if (!touch) return` 移到 `_clearGestureState()` 之前，其他手指先抬起、绑定手指仍在时保持手势。
- **findGestureTouch / pickEndTouch**：严格 identifier 匹配，删除 `return list[0]` 兜底，找不到返回 null。

---

## 4. Gate 2：统计面板主题订阅

`components/statistics-panel/statistics-panel.js` 的 lifetimes 改造：

- **attached**：`this._offTheme = theme.subscribe(() => { if (this._activated) this.refresh(); })`，未激活不提前取数（保持「激活才加载」），首次 activate 用当前主题取色。
- **detached**：调用 `_offTheme()` 取消并置 null。
- 切主题后 `shareList` / `fullShareList`（年度同理）颜色与圆环同步更新。

---

## 5. Gate 3：颜色对比度收口与自动检测

### 5.1 浅色明度达标（`data/statistics/donut.js`）

- 饱和度 62% 不变；浅色明度 45% → **34%**，全色相相对浅色背景 `#f3f4fa` 的 WCAG 非文本对比度 **worst≈3.249（≥3:1，余量 0.25）**；深色明度 56% 保持（worst≈3.074，已达标）。
- 色相 / 饱和度不变，视觉身份保持；worst 均出现在 hue60（黄色）。

### 5.2 运行时对比度自动检测（新增）

- 纯函数模块 **`data/statistics/contrast.js`**：HSL→RGB、WCAG 相对亮度 / 对比度、全色相 `worstDonutContrast` / `auditDonutContrast`，不依赖 wx。
- 脚本 **`scripts/contrast-audit.js`**：输出两主题 worst 并断言 ≥3:1，新增 `npm run contrast:audit`；接入 `release-check`（6.6 节），补足 `theme-audit` 只查硬编码的缺口。

---

## 6. 测试真实结果

| 命令 | 结果 |
| --- | --- |
| `npm test` | **34/34 套件通过，0 失败** |
| `npm run e2e` | **T01–T24 全绿 24/24，0 失败**，截图均带 `_simulator` 后缀 |
| `npm run theme:audit` | 0 FAIL，3 项 JS WARN 不阻断 |
| `npm run contrast:audit` | 两主题 worst 均 ≥3:1，PASS |
| `npm run release:check` | FAIL 0，WARN 1（libVersion 仍 latest，用户侧项） |
| 50k 大压测 | 未运行：本版未改动账本读取与统计计算路径，按任务书不重复耗时压测 |

- 全部改动文件 `node --check` 退出码 0。
- 新增 / 扩展单测：`donut-gesture`（22）、`contrast`（19）、`migtest-sandbox`（19）、`env`（18）、`lazy-compute`（44，含主题订阅专项）；E2E 新增 T24。

---

## 7. 真机验收（待用户执行，助手不代签）

- **Agent simulator（automator + Skyline）：PASS** —— 单测、E2E、主题 / 对比度审计、release:check 逻辑项均通过。
- **User physical device：NOT TESTED（待用户）**

待验收项：圆环点击准确率、小扇区点击、上下滑动不误选、滚动流畅、月度 / 年度、聚合展开、深浅主题、**展开态切主题**、5k/15k/30k 账本体验。记录真实设备、微信 / 基础库版本与截图，不把 Node 耗时当真机耗时。

---

## 8. 数据合同冻结声明

v1.3.3 **未升级 / 未改动**任何核心数据合同：Bill V3、Backup V3、Recurring Store V1、Budget V1；不新增依赖、不新增分类颜色持久化字段、不加入新业务功能。

---

## 9. 已知限制与未完成项

- 真机圆环交互与大账本 Gate 由用户本人完成，结果未测；助手不代签。
- 浅色对比度本版以 L=34 实测达标（worst 3.249），仍以真机主观验收为准，最终是否接受由用户判定。
- 测试桥接模块物理进发布包（release 不可达死代码），安全论证见 v1.3.2 HANDOFF 2.4，需用户确认是否接受。
- libVersion 仍为 `latest`，体验版验证前保持，属 release:check 唯一 WARN。

---

## 10. Git 状态

- 基线 `b9fd200`（v1.3.2）。核心改动：env.js、新增 migtest-sandbox.js / contrast.js / contrast-audit.js、main.js 守卫、e2e-donut-seed 跨月、category-donut 多指隔离、statistics-panel 主题订阅、donut.js 明度、新增 donut-gesture / contrast / migtest-sandbox 测试、lazy-compute / env 扩展、run-all 注册、版本文件、README、CHANGELOG 与本 HANDOFF。
- 临时探查脚本（`temp/donut-contrast-probe.js`）不进仓库、不提交。
- 中文消息用 `git commit -F <file>`，推送走显式代理 `http://127.0.0.1:33210`。
- 最终结果：HEAD == origin/main，ahead=0 / behind=0（核对 `git rev-list --left-right --count origin/main...HEAD`）。
- 功能主体提交 SHA：`待回填`（提交后回填；若仅文档回填另做一个不改动代码的提交）。
