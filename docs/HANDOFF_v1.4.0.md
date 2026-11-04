# HANDOFF — 随时随地大小记 v1.4.0（Final Stabilization）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**1.4.0**
- AppID：`wxcdcf83d9191065d9`（以 `project.config.json` 为唯一权威；`project.private.config.json` 基础库 3.17.4）
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json` 两处、`README.md`、`CHANGELOG.md`）
- 本版定位：**最终稳定性收口**。不新增业务功能、不升级数据合同（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1）、不引入第三方依赖、不改渲染器（Skyline + glass-easel 原样）。
- 运行模式：**均衡**（客户已选定，见 `docs/V1.4.0_RUN_MODE.md`，后续不再询问）
- 完成状态：**READY_FOR_DEVICE_ACCEPTANCE**（自动化全绿；开发者工具模拟器圆环已目视确认；真机 iPhone / Android 待用户按 `10_DEVICE_ACCEPTANCE.md` 逐项签字，助手不代签）

> 本文件在 Gate 6 收口阶段补写：`npm run release:check` 的「5.5 发布文档」按 `APP_VERSION` 动态要求 `docs/HANDOFF_v<当前版本>.md` 存在，v1.4.0 收口前缺失，故按 v1.3.6 同结构补写。内容全部取自本版既有六份审计/回归/性能文档，未新增未经证据支持的结论。

---

## 0. 结论速览

- **两条主修**
  1. **统计圆环在 Skyline 下不可见（P0）**：根因是 SVG 里的 `hsl()` 颜色让 Skyline 把对应 `<circle>` 整条丢弃。修复为 SVG 属性用色一律 `#RRGGBB` + 轨道透明度走 `stroke-opacity` + 根节点补 `width/height/preserveAspectRatio`。对外颜色合同不变（`getCategoryColor()` 仍返回 hsl），图例 / 面板 / `contrast:audit` 口径一行未动。
  2. **弹层内容超高时既不滚也不裁、底部按钮不可达（UI-01，P1）**：Skyline 不支持 `overflow: scroll`，改 `scroll-view` + JS 高度预算（`utils/sheet-scroll.js`）。装得下 = 内容高（观感与改造前逐像素一致），装不下 = 可用空间（保存 / 确认按钮可滚到）；量不到视口高度则退回不干预，**绝不把面板压成 0 高**。
- **P1 数据安全**：记账 / 日价 / 周期三处保存入口原先没有防连点锁，连点两次 = 写两条脏数据；现四处保存入口（含预算设置）统一走 `utils/submit-guard.js`。
- **QA-01**：回滚 / 修复前先隔离转存不可解析分片（`data/quarantine.js`），避免「修坏了连证据一起丢」。
- **自动化结果**：`npm test` **44/44 套件全绿**；`npm run e2e` **27/27 通过**；`theme:audit` 通过（0 FAIL / 3 项 WARN）；`contrast:audit` 通过（dark worst 3.145 / light worst 3.249，均 ≥3:1）；`release:check` 0 FAIL（补齐本文件后）。
- **冻结项零改动**：数据合同、金额 / 日价 / 预算 / 周期算法、CSV 导入、备份格式、主题系统、统计算法、Bottom Sheet 动画机制均未改；不新增依赖、不新增业务功能、未降级渲染器。

---

## 1. 本版提交链（Gate 1–5）

| SHA | 内容 |
| --- | --- |
| `fd9627d` | Gate1-2：修复 Skyline 下圆环不显示，并收口移动端兼容 |
| `29cd7d9` | Gate3：四处保存入口统一防连点锁，修周期间隔钳制时机与完成按钮热区 |
| `40921f7` | Gate3：搜索页与预算设置页订阅 viewport 恢复，修安卓键盘收起后高度不回落（C7/P2-01） |
| `2331093` | Gate4-5：回滚前隔离转存不可解析分片，性能与稳定性收口 |

- 基线：`c7cf85d`（v1.3.6）
- 收口提交（版本号 1.4.0 + 验收文档 + 本文件）SHA 以 `git log -1` 为准（避免自引用不一致）。

---

## 2. 改了什么（源码清单）

| 文件 | 改动 | 依据 |
| --- | --- | --- |
| `data/statistics/donut.js` | 新增 `hslToHex()` / `parseSvgColor()` / `svgColor()`；`buildDonutArcs()` 加 ratio 钳制与 `svgColor` 字段；`buildDonutSVG()` 输出 hex + `stroke-opacity` + 根节点宽高 | `docs/V1.4.0_AUDIT.md` §三 A–M 对照实验 |
| `components/category-donut/category-donut.js` / `.wxml` | `<image>` 补 `bindload` / `binderror`；新增 `imgStatus` / `imgErr` 态与 `diagSnapshot()` / `diagLog()`（仅 develop 输出，不含 Base64 全文与任何账单内容） | 同上 §4.2 |
| `components/bottom-sheet/bottom-sheet.js` / `.wxml` / `.wxss` | 内容区改 `scroll-view`，高度由 `utils/sheet-scroll.js` 预算后内联 | `docs/V1.4.0_UI_AUDIT.md` UI-01 |
| `utils/sheet-scroll.js`（新增） | 纯计算 + 视口读取，不 setData，便于单测覆盖五档屏幕 | 同上 |
| `utils/submit-guard.js`（新增） | 提交防连点锁（单一实现，四处入口共用） | `docs/V1.4.0_INPUT_AUDIT.md` A9 |
| `components/bill-form/bill-form.js`、`components/daily-value-form/daily-value-form.js`、`pages/recurring/recurring.js` | 接入防连点锁；周期间隔改为失焦 / 提交时钳制；完成按钮热区放大 | 同上 A9 + 间隔钳制 |
| `pages/recurring/recurring.wxml` / `.wxss` | 间隔输入「完成」按钮与热区、编辑器左右内边距 | 同上 |
| `pages/search/search.js` / `.wxss` | 订阅 viewport 恢复（C7/P2-01）；输入框 `box-sizing` / 行高收口 | `docs/V1.4.0_UI_AUDIT.md` §2 第 5 页 |
| `pages/budget-settings/budget-settings.js` | 订阅 viewport 恢复（C7/P2-01） | `docs/V1.4.0_INPUT_AUDIT.md` C7 |
| `pages/category-manage/category-manage.wxss` | 底部安全区（UI-03） | `docs/V1.4.0_UI_AUDIT.md` §3 |
| `components/statistics-panel/statistics-panel.wxss` | 窄屏金额 / 占比列禁止收缩 | 同上 §2 第 2 页 |
| `data/quarantine.js`（新增）、`data/backup.js` / `data/fs.js` / `data/paths.js` | 回滚前隔离转存不可解析分片（QA-01），清理带 try/finally 与失败标记 | `docs/V1.4.0_FUNCTIONAL_REGRESSION.md` 数据安全 8 项 |

**没有改的**：渲染器与组件框架配置、数据合同版本、主题调色板、统计算法、`getCategoryColor()` 返回值格式、Bottom Sheet 动画机制。

---

## 3. 怎么验（复现命令，逐条可跑）

```bash
# 1) 单元测试（44 套件）
node tests/run-all.js           # 期望：全部测试套件通过（44/44）

# 2) E2E（需微信开发者工具 CLI，占用 9420 端口）
npm run e2e                     # 期望：27/27 通过，0 失败

# 3) 静态审计
npm run theme:audit             # 期望：违规(FAIL) 0 处
npm run contrast:audit          # 期望：dark worst 3.145 / light worst 3.249，均 PASS
npm run release:check           # 期望：FAIL 0
```

**注意事项（实测踩过的）**

- `npm run e2e` 会清空并重写 `docs/screenshots/e2e/`，跑完请 `git checkout -- docs/screenshots/e2e` 还原基线，否则 git 里会出现 15 个截图变更 + 4 个非本脚本产出的截图被删除。
- E2E 依赖 IDE 冷启动，偶发 `timeout waiting for automator response` / 端口 9420 起不来；复跑通常即过（本次首跑 23/27，复跑全绿，见 `docs/V1.4.0_FUNCTIONAL_REGRESSION.md` §六）。
- 圆环需要账本里有支出才画得出来：诊断 / 截图脚本走项目内测试桥 `__e2eSeedDonut`（仅 develop 可达）。

---

## 4. 圆环修复的证据索引

| 内容 | 文件 |
| --- | --- |
| A–M 对照实验表（每步只改一个变量、截图 sha1 指纹） | `docs/V1.4.0_AUDIT.md` §三 |
| 根因判定（hex ✅ / hsl ❌，其它属性逐字相同） | 同上 §3.1 |
| 修复前（只有灰环） | `docs/screenshots/v1.4.0_gate0_donut_before_simulator.png` |
| 修复后（月度 / 选中 / 年度 / 浅色） | `docs/screenshots/v1.4.0_after_donut_*_simulator.png` |
| 发布前复检 | `docs/screenshots/v1.4.0_release_donut_simulator.png` |
| 像素级复核（环带 top 颜色与 `svgColor()` 逐一相同） | `docs/V1.4.0_AUDIT.md` §5.2 |

---

## 5. 未验证 / 已知限制（照实）

1. **真机（iOS / Android）未验证**：本版门槛是「开发者工具 Skyline 模拟器里圆环真实可见」。真机 SVG 光栅化实现可能不同，请按交付包 `10_DEVICE_ACCEPTANCE.md` 逐项签。
2. **`hsl()` 丢元素的确切边界未穷举**：只证明本工程实际产出的 `hsl(H, 62%, L%)` 会丢；输出已全 hex，不影响本工程。
3. **其它三处 `<image>` + base64 SVG 组件**（`category-icon` / `cumulative-trend` / `icon`）仍可能往 SVG 写 `rgba()`：当前工具版本实测正常，属**潜在风险**，建议下轮统一过一遍颜色输出（见 `docs/V1.4.0_AUDIT.md` §七）。
4. **`theme:audit` 3 项 WARN**（JS 里白色硬编码）：既有实现，不阻断发布，已登记。
5. **`project.config.json` 的 `libVersion` 仍为 `latest`**：`release:check` 以 WARN 形式提示；本机实测基础库为 3.17.4（`project.private.config.json`），正式发布前如需固定版本号需由项目负责人在工具里确认。

---

## 6. 支线待办（发现但本版不动）

| 是什么 | 在哪 | 不做的后果 |
| --- | --- | --- |
| 三处其它 base64 SVG 组件的颜色输出统一 | `components/category-icon/`、`cumulative-trend/`、`icon/` | 换工具版本 / 真机可能整块不渲染 |
| `tests/e2e/run.js` 的 `publishShots()` 会清空整个 `docs/screenshots/e2e/` | `tests/e2e/run.js:38-47` | 每次跑 e2e 都要手动还原基线 |
| E2E launcher 无自动重试 | `tests/e2e/launcher.js:128-142` | 偶发整轮失败需人工复跑 |
| 导入页 UI 预览流程无端到端用例 | `pages/import/` | 该流程只靠代码审查 + 单测覆盖 |

---

## 7. 交接要点（给下一位 / 给客户的技术方）

- **版本号只改一处事实源**：`utils/version.js` 改完必须同步 `package.json`、`package-lock.json`（两处：根 `version` 与 `packages[""].version`）、`README.md` 第 9 行、`CHANGELOG.md`；`npm run release:check` 会静态比对，漏一处直接 FAIL。
- **发布文档是硬门槛**：`release:check` 5.5 节按当前 `APP_VERSION` 要求 `docs/HANDOFF_v<版本>.md` 存在，升级版本号必须同时补该文件。
- **改 SVG 颜色一律用 hex**：Skyline 下 `hsl()` 会让元素整条消失且无任何报错，`imgStatus` 仍是 `load`——排查时不要相信「加载成功」。
- **弹层内滚动只能走 `scroll-view` 且必须给确定高度**：给 `flex: auto` 或只给 `max-height` 会塌成 0。
