# HANDOFF — 随时随地大小记 v1.2.1（Category Visual Correctness）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：main
- Version：**1.2.1**
- 品牌名：**随时随地大小记**
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json`（顶部 + packages 两处））
- 上一版本基线：v1.2.0（HEAD `37fc178`）
- 本版定位：**分类视觉正确性收口，修复 v1.2.0 两个真实分类回归并补回归测试；不新增业务功能、不升级数据合同。**
- 后续路线：本版完成后停止，等用户审 main；之后再进入 v1.3.0 Statistics Dashboard & Scale Lab，不自行进下一版。

---

## 1. 本版背景

用户审 v1.2.0（HEAD 37fc178）确认分类视觉系统主体通过，但发现两个分类回归：① Domain 层名称校验因判断条件写错而失效；② 系统核心 5 类「只改图标」的链路实际走不通，与 HANDOFF 声明矛盾。本版只修这两件事并加回归测试，不碰其它功能，随后即进入统计大版本，不在 1.2.x 继续磨。

---

## 2. 修复一：Domain 层名称校验失效（`data/categories.js`）

- 旧问题：`updateCategory()` 内名称处理写的是
  ```js
  const v = validateName(patch.name);
  if (!v) return { ok: false, reason: 'invalid-name' };
  ```
  但 `validateName()` 无论成功失败都返回对象（失败 `{ok:false}`、成功 `{ok:true,name}`），故 `!v` 恒为 false：绕过 UI 传入非法名称时不会 fail-closed，且后续 `cat.name = v.name` 可能把 `undefined` 写入。
- 修复：改为判断 `if (!v.ok)`；同文件 `addCategory()` 本就正确使用 `if (!v.ok)`，口径统一。

---

## 3. 修复二：系统核心 5 类无法改图标

旧实现三处叠加导致走不通，逐一修复：

1. **列表入口缺失**：`category-manage.wxml` 系统分类行没有 `bindtap="onEdit"`。已为系统行补上 `cm-row__main`（`data-id` + `bindtap="onEdit"`），用户可点进编辑器；系统行不显示归档按钮。
2. **编辑器名称禁用**：`category-manage.js` 新增 `editingBuiltin` 标记（`onEdit` 取 `cat.builtin`、`onAdd` 置 false）；wxml 名称字段对核心分类 `disabled` 并提示「系统分类名称不可修改，仅可更换图标」，`recheck()` 对核心分类只校验图标。
3. **底层放行图标、禁止改名**：`updateCategory()` 名称块对 `cat.builtin` 不再整体拒绝，改为：
   - 仅当传入名称 `validateName` 通过且与原名称（trim 后）相同（「名称保持原值」）时放行，继续后续图标更新；
   - 传入不同名称或非法名称（真正改名）→ 返回 `{ok:false, reason:'builtin'}`。
   - 非 builtin 分类保持原名称校验（`invalid-name` / `duplicate`）逻辑不变。

这样前端保存路径（原名称 + 新图标）可成功，绕过 UI 的改名仍被拒绝。

---

## 4. 回归测试（`tests/categories.test.js` 新增 G 组）

新增「G. v1.2.1 分类视觉正确性」共 16 项断言：

- G1 非核心分类空白名称 fail-closed（`invalid-name`），原名称保留、未写入 undefined；
- G2 非核心分类超长名称 fail-closed，原名称保留；
- G3 核心分类只改图标（不传 name）成功，名称不变、图标更新；
- G4 核心分类「原名称 + 新图标」成功，名称保持原值、图标切换；
- G5 核心分类「不同名称 + 图标」被拒（`builtin`），名称与图标均不变。

---

## 5. 数据合同冻结声明

v1.2.1 **未升级 / 未改动**任何核心数据合同，全部继续冻结：

- **Bill V3**：分片 `bills/YYYY-MM.json = {ym,version:3,bills:[...]}`，整数分金额。
- **Recurring Store V1**：`recurring.json = {version:1,rules:[...]}`。
- **Budget V1**：`settings.budget = {version:1,weekStartsOn,rules:[...]}`。
- **Backup V3**：`daily-value-mini-backup` SCHEMA=3，不引入 Backup V4。
- 本版不加入分类颜色、拖拽排序、分类预算、图片 / 远程图标、AI 分类、AutoBill、账户、云同步等任何新业务功能。

---

## 6. 测试结果

### 6.1 纯逻辑单测：`npm test`

**全绿、25/25 套件、退出码 0**；`categories.test.js` 由 60 项增至 76 项（G 组 +16），总项数 1349 → 1365。

### 6.2 GUI 端到端：`npm run e2e`

**T01–T18 全绿 18/18，退出码 0**，截图均带 `_simulator` 后缀。

### 6.3 性能：`npm run perf`

1k/5k/10k 全绿、近线性（10k 正式搜索 27ms、连续键入 72ms）。

### 6.4 主题审计：`npm run theme:audit`

PASS，0 违规（仅 1 项已知 category-icon JS 白色 WARN，不阻断）。

### 6.5 发布检查：`npm run release:check`

**FAIL：0，WARN：1**（唯一 WARN：`libVersion` 仍为 `latest`，待最终体验版验证后固定——预期提醒，非代码缺陷）。

---

## 7. 发布前 Gate（待用户执行，助手不代签）

- **Agent simulator（automator + Skyline）：PASS** —— 单测、E2E、性能、主题审计、release:check 逻辑项均通过；Canvas 真机表现、分类图标真机视觉、升级 / 恢复演练除外。
- **User physical device（Android）：NOT TESTED（待用户）**

仍需在真实微信 Android 上完成（详见 `docs/DEVICE_GATE_v1.0.0.md`）：分类图标深 / 浅色真机视觉、核心分类改图标真机交互、真机主题矩阵、日价 Canvas 曲线、升级测试、完整 Backup 灾难演练、隐私后台配置（MessageFile / Clipboard）、体验版验证后固定基础库。

---

## 8. Git 状态

- v1.2.1 改动（基线 `37fc178` 之后）：
  - 修改 `data/categories.js`、`pages/category-manage/category-manage.js`、`.wxml`、`.wxss`；
  - 测试 `tests/categories.test.js`；
  - 版本与文档：`utils/version.js`、`package.json`、`package-lock.json`、`CHANGELOG.md`、本 HANDOFF。
- 中文消息用 `git commit -F <file>`；推送走显式代理 `http://127.0.0.1:33210`。
- 最终结果：HEAD == origin/main，ahead=0 / behind=0（核对 `git rev-list --left-right --count origin/main...HEAD`）。
