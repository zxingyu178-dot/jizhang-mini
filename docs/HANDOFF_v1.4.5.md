# HANDOFF — 随时随地大小记 v1.4.5（Theme Accent：主题配色扩展）

- Repository：https://github.com/zxingyu178-dot/jizhang-mini
- Branch：`main`（直接提交）
- Version：**1.4.5**
- AppID：`wxcdcf83d9191065d9`
- 版本单一事实源：`utils/version.js`（已同步 `package.json`、`package-lock.json` 两处、`README.md`、`CHANGELOG.md`）
- 开发基线：`origin/main` = `faece15`（即本版前一提交，工作区干净）
- 本版定位：**主题配色扩展**。新增靛蓝 / 青竹 / 琥珀 / 玫红 4 套主题色 × 深 / 浅 = 8 组，只覆盖强调色变量、不动深 / 浅骨架；同步修掉 3 个存量对比度 / 硬编码缺陷。不新增业务功能、不动数据合同、不加依赖、不改渲染器。
- 完成状态：**READY_FOR_UPLOAD**（自动化全绿；真机 iPhone / Android 未测试，由客户按 `docs/10_DEVICE_ACCEPTANCE.md` 执行）

---

## 0. 结论速览

| 维度 | 结果 |
| --- | --- |
| 主题色 | 4 套（靛蓝 / 青竹 / 琥珀 / 玫红）× 深 / 浅 = **8 组**，外观页四选一点击即生效，无需保存 |
| 缺省与兼容 | `settings.accent` 缺省 `indigo`；**老用户无该字段 → 归一 indigo，升级后颜色零变化**；非法值一律归一 indigo 不崩 |
| 主色当文字（缺陷 1） | 浅色靛蓝 **3.52 → 5.70**:1（新增 `--primary-text`），8 组全部 ≥4.5:1 |
| 深色按钮白字（缺陷 2） | 白字压 `#7c86ff` **3.13 → 6.19**:1（新增 `--on-primary` 深墨字），浅色仍用白字 |
| JS 硬编码主色（缺陷 3） | **6 处全部改为运行时取 `theme.getAccentPalette()`**，原靛蓝值只留作异常兜底 |
| 页面接线 | **14 个页面**根容器挂 `accentClass`（与 `themeClass` 并列） |
| 背景染色 | 只动 `--glow-*` 跟着色相走（**客户已确认保留**）；`--bg` / `--card-bg` / `--surface` 未动 |
| 单元测试 | **52/52 套件通过**（`theme.test.js` 单文件 **285 断言**） |
| theme:audit | 违规 **0** / 白名单 13 / JS 白色提醒 3（既有，不阻断） |
| contrast:audit | dark worst **3.145** / light worst **3.249**，均 ≥3:1 |
| release:check | **FAIL = 0** / WARN = 1（`libVersion=latest`，既有，客户已定不动） |
| 性能（大账本） | 1k 2ms / 5k 6ms / 10k 13ms，10k÷1k = **6.5x**（期望 ≤40x） |
| 真机 | **未测试**（本轮纯配色变量层，无数据链路改动） |

---

## 1. 本次主线：4 套主题色 × 深 / 浅

### 1.1 做法（为什么不是「换肤」）

**只换强调色，不换骨架**：`app.wxss` 已有的 60+ 语义变量一个不动，每套主题只覆盖 6 个强调色变量：

| 变量 | 用途 | 门槛 |
| --- | --- | --- |
| `--primary` | 主色，只用于图形 / 边框 / 填充 | ≥3:1（非文本） |
| `--primary-deep` | 按钮底 / 渐变深端 | ≥3:1 |
| `--primary-text` | **主色当文字用**（新增） | ≥4.5:1 |
| `--on-primary` | **压在主色上的字**（新增） | ≥4.5:1 |
| `--button-primary-text` | 按钮文字，指向 `--on-primary` | ≥4.5:1 |
| `--glow-*` / `--hero-bg` | 背景光晕 / Hero 底色 | 装饰，跟色相 |

### 1.2 三条由实测得出的硬规则（已写进代码注释 + 契约测试）

1. **按钮底按模式分**：深色主题用 `--primary`（亮）+ **深色字**；浅色主题用 `--primary-deep`（暗一档）+ **白字**。反着配必挂（实测亮主色配白字只有 2.10~2.17）。
2. **主色分两层用**：`--primary` 只负责图形 / 边框 / 填充；文字一律走 `--primary-text`。原因：主色在全项目**当文字用 16 处、当背景只有 2 处**，把文字门槛压到 3:1 会大面积不达 AA。`theme.test.js` 扫全项目 `.wxss`，出现 `color: var(--primary)` 直接 FAIL。
3. **`--on-primary` 不能写死白色**：青竹 / 琥珀 / 玫红这类亮主色在深色下必须配深墨字。契约测试对 4 套深色 `--on-primary` 断言「不许是 `#ffffff`」。

### 1.3 CSS 结构：必须双类组合

```css
.theme-dark.accent-teal  { --primary: #2ec4b6; --on-primary: #06231f; … }
.theme-light.accent-teal { --primary: #0f8f83; --on-primary: #ffffff; … }
```

⛔ **不能只写 `.accent-teal`**：单类会同时盖掉深色与浅色的变量（后出现的规则胜出，与 mode 无关），结果深色模式拿到浅色配色。8 组 = 4 accent × 2 theme 全部显式写出，`theme.test.js` ACCENT-09 逐组断言「每个 `.theme-x.accent-y` 块内 6 个变量齐全」。

### 1.4 8 组实测对比度（`artifacts/theme-preview/contrast-check.js`，36 项 FAIL 0）

| 主题 | 模式 | `--primary` | `--primary-deep` | `--primary-text` | `--on-primary` | 文字 on 卡片 | 图形 on 卡片 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 靛蓝 | 深 | `#7c86ff` | `#5b67f0` | `#7c86ff` | `#0b0d16` | **6.19** | 6.19 |
| 靛蓝 | 浅 | `#6e78f5` | `#5660e0` | `#4b55cf` | `#ffffff` | **5.70** | 3.52 |
| 青竹 | 深 | `#2ec4b6` | `#1f9e93` | `#2ec4b6` | `#06231f` | **8.94** | 8.94 |
| 青竹 | 浅 | `#0f8f83` | `#0b6f66` | `#0a6a61` | `#ffffff` | **6.15** | 3.78 |
| 琥珀 | 深 | `#f0a33e` | `#d4862a` | `#f0a33e` | `#2a1a05` | **9.24** | 9.24 |
| 琥珀 | 浅 | `#a8680a` | `#8a5408` | `#8a5408` | `#ffffff` | **5.95** | 4.29 |
| 玫红 | 深 | `#f0658f` | `#d44a75` | `#f0658f` | `#2b0a14` | **6.43** | 6.43 |
| 玫红 | 浅 | `#cf3a69` | `#ad2b53` | `#ad2b53` | `#ffffff` | **6.15** | 4.47 |

- 「文字 on 卡片」= `--primary-text` / `--on-primary` 压在玻璃卡上的最差值；「图形 on 卡片」= `--primary` 作为图形的最差值。
- 浅色 4 组的图形对比度（3.52 / 3.78 / 4.29 / 4.47）都 ≥3:1，但**不足 4.5:1** —— 这正是必须拆出 `--primary-text` 的原因，不能指望一个变量同时满足两种门槛。
- 语义色（`--expense` / `--income` / `--budget-surplus` / `--budget-over`）4 套共用、未参与主题化：深色 6.05~10.92、浅色 3.08~3.87，全部 ≥3:1。

### 1.5 存储与 fail-safe

- 新增 `settings.accent`，同时 `data/settings.js` 的 `DEFAULT_SETTINGS` 补 `accent: 'indigo'`、新增 `canonicalizeAccent`（与 `utils/theme.js` 的 `VALID_ACCENTS` 同一口径）。
- `setAccent` 与 `setThemeMode` **同一套写盘口径**：先 `writeJSONAtomic` 成功才更新内存并 emit；写失败返回 `{ok:false}`、内存保持旧值、**不假装成功**（页面提示重试）。
- `reloadFromStorage` 一并重读 accent（备份恢复后主题色立即生效），并取消主题保留标记。

---

## 2. 三个存量缺陷（本次顺带修掉，均已实测）

| # | 缺陷 | 改前 | 改后 |
| --- | --- | --- | --- |
| 1 | 浅色主题主色当文字偏淡 | `color: var(--primary)` 16 处，浅色靛蓝 on 卡片 = **3.52:1**（正文标准 4.5，不达 AA） | 新增 `--primary-text`，浅色靛蓝 `#4b55cf` = **5.70:1**；8 组全部 ≥4.5 |
| 2 | 深色主题按钮白字偏淡 | 白字 on `#7c86ff` = **3.13:1** | 新增 `--on-primary`（深色下深墨字），靛蓝深色 = **6.19:1**；浅色仍白字 |
| 3 | 6 处 JS 硬编码主色，不跟主题走 | 换主题后图标高亮 / 首页日价曲线 / 统计累计折线**还是靛蓝**（一半变色一半没变） | 全部改为运行时从 `theme.getAccentPalette()` 取，原靛蓝值只作异常兜底 |

**缺陷 3 的 6 处位置**：
- `components/category-icon/category-icon.js`（图标高亮）
- `components/icon/icon.js`（图标主色）
- `components/daily-value-curve/daily-value-curve.js`（4 处折线 / 面积 / 末端圆点色）
- `data/statistics/cumulative.js` 的 `LINE_COLOR`（改为由组件经 `opts.lineColor` 传入）

**连带清理**：
- `scripts/theme-audit.js` 的品牌色白名单原来写死 4 个 hex（`#7c86ff` / `#6e78f5` / `#5b67f0` / `#5660e0` 及对应 rgba），加主题后必然误报 → 改为按主题读。
- 外观页色卡色值原来在页面里又抄了一份 4 个 hex，与 `utils/theme.js` 两处维护同一批值 → 改为直接从 `ACCENTS[x].dark.primary` 取（**单一来源**）；改造前后实测渲染色值完全一致（`#7c86ff` / `#2ec4b6` / `#f0a33e` / `#f0658f`）。色卡选中勾仍统一深墨 `#0b0d16`（白勾压亮主色只有 2.0~2.2，不可用）。

---

## 3. 修改文件

**本轮改动 45 个文件**（40 个代码 / 配置 + 5 个文档），实测：`git diff --stat` 43 个已跟踪文件 `968 增 / 75 删`，另加 2 个新增文档（`docs/BACKLOG.md`、`docs/HANDOFF_v1.4.5.md`）。

| 分组 | 文件 | 改了什么 |
| --- | --- | --- |
| 主题核心 | `app.wxss`（+219）、`utils/theme.js`（+127）、`data/settings.js`（+16） | 新增 `--primary-text` / `--on-primary`；8 组 `.theme-x.accent-y` 覆盖块；`ACCENTS` / `getAccentPalette` / `setAccent` / `canonicalizeAccent` |
| 外观页 | `pages/appearance/appearance.{js,wxml,wxss}` | 主题色四选一（色卡 + 选中勾），色值改从 theme.js 单一来源取 |
| 14 个页面接线 | `pages/main`、`settings`、`search`、`budget-settings`、`category-manage`、`recurring`、`backup-restore`、`data-privacy`、`release-notes`、`daily-value-detail`、`appearance`、`packages/importer/pages/{import,preview,result}` 的 `.wxml`（部分含 `.wxss`） | 根容器 class 追加 `{{accentClass}}` |
| 硬编码清理 | `components/{category-icon,icon,daily-value-curve,cumulative-trend}`、`data/statistics/cumulative.js` | 6 处主色改为运行时取调色板 |
| 对比度修正 | `components/{accounting-panel,empty-state,statistics-panel,daily-value-panel,daily-value-curve}` 的 `.wxss` | `color: var(--primary)` → `var(--primary-text)`；按钮字走 `--on-primary` |
| 审计脚本 | `scripts/theme-audit.js` | 品牌色白名单改为按主题读 |
| 测试 | `tests/theme.test.js`（+310） | 285 断言：8 组覆盖块完整性、深色 `--on-primary` 不许白、门禁扫描 `color: var(--primary)`、归一化 fail-safe、页面接线 |
| 版本 / 文档 | `utils/version.js`、`package.json`、`package-lock.json`（**仅顶层 + `packages[""]` 两处**）、`README.md`、`CHANGELOG.md`、`DEV_LOG.md`、`docs/BACKLOG.md`、`docs/HANDOFF_v1.4.5.md`（新建） | 升版 1.4.5 + 文档同步 |

> `package-lock.json` 只有 2 行变化（顶层 `version` + `packages[""]` 的 `version`）；第三方包 `load-bmfont@1.4.2` **未动**（`git diff package-lock.json` 逐行核过）。

---

## 4. 测试与审计（本轮实跑）

| 命令 | 结果 |
| --- | --- |
| `npm test` | **52/52 套件通过** |
| `node tests/theme.test.js` | **285 passed / 0 failed** |
| `npm run theme:audit` | 违规 **0** / 白名单 13 / JS 白色提醒 3（既有，不阻断） |
| `npm run contrast:audit` | dark worst **3.145** @hue240 / light worst **3.249** @hue60，均 ≥3:1 |
| `npm run release:check` | **FAIL 0** / WARN 1（`libVersion=latest`，既有） |
| `npm run perf` | 1k 2ms / 5k 6ms / 10k 13ms；10k÷1k = **6.5x**（≤40x）；无崩溃 |
| `node artifacts/theme-preview/contrast-check.js` | **36 项全部 OK，FAIL 0** |

**截图证据目录**：`artifacts/theme-preview/`（`index.html` 4 套 × 深 / 浅样张，可直接打开对照）。

---

## 5. 向后兼容（本次最关键的约束）

| 场景 | 行为 |
| --- | --- |
| 老用户升级（`settings.json` 无 `accent` 字段） | `normalizeAccent(undefined)` → `indigo` → 与 v1.4.4 完全一致，**颜色零变化** |
| `settings.accent` 被写坏（`null` / `'blue'` / `123`） | 一律归一 `indigo`，**不崩**、不假成功 |
| `theme` 仍是 `dark` / `light` / `system` | 语义未变，不自动改 `system`、不重置用户选择 |
| 备份恢复（旧备份不含 `accent`） | 恢复后 accent 归一 `indigo`；新备份带上 `accent` 后恢复即生效 |
| 备份格式 | **Backup V3 未升级**（`settings.accent` 随 settings 一起存，属向后兼容的新增字段，不构成格式变更） |
| 数据合同 | Bill V3 / Backup V3 / Recurring Store V1 / Budget V1 —— 一行未改 |

---

## 6. 背景染色（客户已确认保留）

- `--glow-1` / `--glow-2` / `--glow-primary` 跟着主题色相走，背景光晕与主色一致。
- **`--bg` / `--card-bg` / `--surface` 未动**：页面底色（`#05060a` / `#f3f4fa`）与玻璃卡的透明度序列保持不变，`contrast:audit` 的 `PAGE_BG` / `CARD_WHITE_ALPHA` 常量与 `app.wxss` 仍一一对应（`release-check` 会静态比对，改错直接 FAIL）。
- 与 `docs/BACKLOG.md` 方案 A 的差异：原方案只打算保留靛蓝发光，实现时发现发光不跟色相会与主色打架 → `--glow-*` 一并跟色相，**客户已确认保留**。

---

## 7. 真机验收（未执行）

本轮是纯配色变量层，无数据链路改动。建议真机只看 4 条：

1. 设置 → 外观：`主题色` 四张色卡，**每张显示的是本身那个色**（靛蓝偏蓝紫、青竹偏青绿、琥珀偏橙、玫红偏粉红），不是深棕 / 墨绿这类暗色。
2. 四套主题色逐个点一遍（深 / 浅各看一次），看**全部**页面主色都跟着变：首页 FAB、选中项文字、首页日价曲线、统计页累计折线、分类图标高亮 —— 这 5 处原来有「一半变色一半没变」的缺陷，是本轮重点。
3. 深色主题下主按钮 / FAB 上的文字**看得清**（深墨字压亮主色）。
4. 杀掉小程序重进：主题色**记得住**（存 `settings.json`，不是内存）。

---

## 8. 已知限制 / 遗留（如实列）

1. **浅色主题「主色图形」对比度 3.52 / 3.78 / 4.29 / 4.47 不足 4.5**：这是设计上的取舍——`--primary` 只用于图形 / 边框（门槛 3:1，全部达标），文字一律走 `--primary-text`。若客户要求「图形也 ≥4.5」，会把浅色主色压得更暗，视觉上失去「亮主色」的识别度，需客户点头才动。
2. **语义色未参与主题化**：`--expense` / `--income` / `--budget-*` 4 套共用。原因：记账 app 的红绿语义必须稳定，不该随皮肤漂移；且 `--expense` 是绿、`--income` 是红（与 A 股习惯相反，与「支出=红」直觉也相反），这条已在 `docs/BACKLOG.md` B-1 登记，**属独立议题**，本轮不动。
3. **`libVersion: latest` 未固定**（既有 WARN）—— 上传体验版后需注意基础库版本随线上变化，最终验证版建议固定。
4. **真机未测**（本机无真机 / 开发者工具自动化不含渲染像素比对）。
5. **应用内「更新日志」页仍停在 1.1.0**（`pages/release-notes/release-notes.js` 的 `RELEASES`，既有问题，已登记 `docs/BACKLOG.md` B-3）：用户从设置进去看不到 1.2~1.4.5 的变更。本轮只给它挂 `accentClass`，**未补版本条目**（属独立支线，避免扩大改动面）。

---

## 9. Git

| 项目 | 值 |
| --- | --- |
| 开发基线 | `origin/main` = `faece15`（工作区干净，无遗留未推送提交） |
| 本版提交 | 见 `git log --oneline -1`（信息：`feat(theme): 新增 3 套主题配色并修复主色对比度缺陷，升版 1.4.5`） |
| 推送 | `git push origin main` 后 `HEAD == origin/main`（核对命令见本次回传） |

---

## 10. 工作区与历史交付包（别误报成脏工作区）

- 仓库根目录 `DailyValueMini_v1.4.*.zip`、`jizhang-mini_v1.3.*.zip` 是历史交付包（`.gitignore` 未覆盖，`git status` 里显示未跟踪）。**不是本轮产物，不打包、不提交。**
- `reports/upload-info-144.json` 是上传记录（`reports/` 未进 `.gitignore`，已登记 `docs/BACKLOG.md` B-3），**不属本轮，不提交。**

---

## 11. 下一步（给接棒的人）

1. **本次不打包、不上传**（由交付岗接手）：客户在微信开发者工具打开本项目 → 上传开发版，版本号 **1.4.5**（`utils/version.js` 已就绪）。
2. 真机按 §7 四条验收 + `docs/10_DEVICE_ACCEPTANCE.md`。
3. 若客户要「浅色图形也 ≥4.5:1」或「语义色也跟主题走」→ 见 §8 第 1、2 条，**需先确认可改验收视觉**。

---

## 12. 相关文档索引

| 文档 | 用途 |
| --- | --- |
| `docs/HANDOFF_v1.4.4.md` | 上一版（图表可读性 / 坐标轴） |
| `docs/BACKLOG.md` | B-1 主题扩展调研与本版落地差异说明 |
| `CHANGELOG.md` | 逐版本变更（本版条目在最上） |
| `artifacts/theme-preview/index.html` | 4 套 × 深 / 浅配色样张 |
| `artifacts/theme-preview/contrast-check.js` | 36 项对比度验证脚本 |
| `tests/theme.test.js` | 主题契约测试（本版 285 断言） |
| `docs/10_DEVICE_ACCEPTANCE.md` | 真机验收清单 |
| `docs/09_WECHAT_UPLOAD.md` | 微信上传步骤 |
| `docs/HANDOFF_v1.4.5.md` | 本文件 |
