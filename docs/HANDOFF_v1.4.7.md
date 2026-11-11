# HANDOFF — 随时随地大小记 v1.4.7（记账输入链路专项体检）

> 交付日期：2026-11-11
> 触发：客户「继续做产品优化，尤其是日常用得最多的输入账单重点检查」
> 定性：**不是新功能，是把最高频那条路上的三处硬伤修掉**（保存无回执 / 跨月看不到 / 展开分类后保存按钮被挤出屏幕）

---

## 0. 结论速览

| 项 | 结果 |
|---|---|
| 体检方式 | 新写 GUI 探针 `tests/e2e/input-flow-probe.js`，测量 7 项效率指标（不是测「算得对不对」，那个 `real-tap.js` 早覆盖了） |
| 确证缺陷 | **3 个 P1** + **2 个 P2**（详见 §1） |
| 数据合同 | **零改动**（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1 字段集合与语义一条未动） |
| 统计口径 | **零改动** |
| 依赖 / 渲染器 | 未引入依赖、未改 Skyline |
| 表单内容高 | 598.4 → **542.9px**（省 55.5px） |
| 展开 12 个分类 | 保存按钮底边溢出 **9.7px → 0px** |
| 测试 | `npm test` **53/53**；`input-interaction.test.js` **105 → 145 断言** |
| 发布检查 | `release:check` **FAIL 0 / WARN 0** |
| 真机 | **未测**（模拟器 390×844） |

---

## 1. 体检发现的 5 件事（全部有实测数据）

### P1-1 保存后没有任何回执
- 实测：填入 ¥3.21 点「确认记一笔」→ Sheet 关闭，`wx.showToast` 探针收到 **空数组**
- 用户视角：窗口一关，什么都没说。记上了吗？记成多少了？

### P1-2 补记别的月份 → 界面上完全看不到
- 实测：打开表单，日期改到 `2026-10-15`，存 ¥8.88
- 保存后：Hero 仍显示「2026年11月」，本月支出仍是 ¥3.21，列表里只有 11 月那笔，**toast 为空**
- 用户视角：**看起来就是没记上**。实际数据写进了 10 月分片，完全正确 —— 这是最危险的一类 bug：数据没错，感知错了
- 截图证据：`04_cross_month`（保存 10 月的账之后，界面上没有任何痕迹）

### P1-3 展开全部分类 → 保存按钮被挤出屏幕
- 实测：点「更多」，分类 5 → 12 个，内容高 598.4 → 657.1
- 保存按钮底边 **849 > 视口 844**，被裁 9.7px；「更多」按钮同时消失，**没有任何收起入口**
- **根因不在表单，在弹层**：`bottom-sheet` 的面板高度只在 `show` 变 true 那一刻 `_fit()` 量一次。slot 内容之后变高不会重算，scroll-view 还停在旧高度，多出来的两行被挤到面板外
- 这条最容易被误诊成「表单太高，压一压就行」—— 压了 55px 之后仍然溢出，因为**高度没重算，压多少都白压**

### P2-1 日期没有快捷入口
- 实测：日期行只有 picker 一行（`chipsCount=0`）
- 补记昨天的账要「开 picker → 滚轮 → 确定」三步，而这在记账场景里是**每天都会发生**的动作

### P2-2 连续记账每次重选分类
- 实测：保存后重开表单，金额 / 商户 / 备注清空（合理），分类回到默认「餐饮」（不合理）
- 早餐 → 午餐 → 晚餐连记三笔同类，要选三次分类

---

## 2. 改法（逐条）

### 2.1 保存回执
`bill-form` 的 `saved` 事件补三个字段（**只是加字段，不改既有 `id`**）：

```js
const savedDetail = { ym: dateStr.slice(0, 7), amountCents: cents, dateStr };
this.triggerEvent('saved', Object.assign({ id: bill.id }, savedDetail));
```

主页面 `onBillSaved` 按场景回显：
- 当月 → `已记 ¥12.80`
- 跨月 → `已记入 10 月`

`ymLabel()` 处理跨年（`2025-12` → `2025 年 12 月`），避免「1 月」歧义。

### 2.2 跨月自动落位
```js
const beforeYm = acc ? acc.data.ym : '';
const crossMonth = !!(d.ym && beforeYm && d.ym !== beforeYm);
this.refreshPanels({ accYm: d.ym });   // 一次到位，不先刷当前月再跳
```

`refreshPanels` 新增 `opts.accYm`：目标月与当前月不同 → 直接 `loadData(目标月)`；相同 → 照旧 `refresh()`。**不先刷当前月再跳**，避免两次重载与中间帧闪动。

⛔ 注意：`refreshPanels` 原有的 `opts.preserveStatistics`（主题切换保留圆环状态）语义**未动**，两个选项互不干扰。

### 2.3 弹层高度重算（本版最关键的一处）
`components/bottom-sheet/bottom-sheet.js` 新增：

```js
refit() {
  if (!this.data.show) return Promise.resolve(false);   // 未展示不动作，绝不偷开
  return this._fit().then(() => true);                   // 复用同一套高度预算
}
```

`bill-form` 在展开 / 收起后 `triggerEvent('resize')`（放在 `setData` 回调里，等 DOM 更新完）→ 主页面 `onBillFormResize` → `selectComponent('#billSheet').refit()`。

**这条是可复用的教训**：任何「slot 内容会在打开后变高」的场景（未来的折叠面板、动态加载列表）都要走这条路，否则表现是「底部按钮看得见但点不到」，而 CSS 和逻辑代码里都看不出问题。

### 2.4 分类收起
展开态在「分类」标题右侧出现「收起」（`wx:if="{{showAllCats}}"`，不占网格位置、不加行高）。

### 2.5 日期快捷
两个 chip 内嵌在日期行内（**不新增行高**）：

| 当前日期 | 显示 |
|---|---|
| 是今天 | `昨天` `前天` |
| 是过去某天 | `今天`（一键退回） |

`onQuickDate` 的 `data-days` = 回退天数（0/1/2），非数字或负数直接 return 不改日期；结果仍与 `todayStr` 夹一次（防系统时间被改）。

### 2.6 分类沿用
```js
rememberedCategoryId(type) {
  const id = this._lastCategoryId;
  if (!id) return null;
  const hit = store.getActiveCategories().find((c) => c.id === id);
  return hit ? hit.id : null;    // 归档 / 删除 → null，调用方回退默认
}
```
- 只存**实例属性**（内存），不落盘、**不进数据合同**；
- 只记**支出**分类（收入频率低，默认「工资」更符合预期）；
- 分类被归档则自动失效。

### 2.7 打开即聚焦金额
`bottom-sheet` 在 `visible: true`（高度已落位、滑入开始）后 `triggerEvent('opened')` → 主页面调 `bill-form.focusAmount()`。

```js
focusAmount() {
  if (this.data.editingId) return;          // 编辑态不抢焦点
  if (this.data.amountFocused) return;      // 幂等
  this.setData({ amountFocused: true });
}
```

⛔ **为什么必须等 `opened`**：`onAdd` 里直接聚焦时面板还在屏外、`_fit()` 还没量完，键盘先弹会缩小视口，面板高度就按错误的视口算 —— 表现是面板突然变矮或按钮跑出屏幕。这一条是 v1.4.7 期间踩过的坑。

⛔ 编辑态不聚焦：点开一笔已有账单多半是看或改商户 / 备注 / 分类，不一定是改金额；且键盘会盖住「删除此账单」与「保存修改」。

⚠️ **键盘遮挡仍未验证**：模拟器不弹真键盘。自动聚焦上线后，真机必须确认「键盘弹起时金额框是否仍在可视区、分类区被遮多少」。

### 2.8 表单纵向瘦身（598.4 → 542.9）

| 位置 | 改动 | 省 |
|---|---|---|
| 「计算日价」 | 两行卡片（label + 副标题 + 开关，66px）→ 定高单行 72rpx（约 42px），副标题右置并 ellipsis | ~24px |
| 分类格 | padding 14→8rpx、图标间距 6→4rpx、名称 22→21rpx | ~17px |
| 表单行 | padding 24→22rpx（行高仍 40px+，触控达标） | ~6px |
| 分类网格 / 保存按钮 | margin-bottom 12→8rpx、margin-top 24→20rpx | ~4px |

收益不只是「好看」：**小屏（667 高）需要滚动的距离从 98.4px 降到 42.9px**。

---

## 3. 修改文件

| 文件 | 改了什么 |
|---|---|
| `components/bill-form/bill-form.wxml` | 日期行改 `bf-row--date` + 内嵌 picker + 三个条件 chip；日价块压成单行；分类标题行加「收起」 |
| `components/bill-form/bill-form.js` | `onQuickDate`、`onHideAllCats`、`rememberedCategoryId`、`_rememberCategory`；`reset()` 沿用上次分类；`saved` 事件带 `ym`/`amountCents`/`dateStr` |
| `components/bill-form/bill-form.wxss` | `.bf-row--date` `.bf-quick` `.bf-chip` `.bf-date` `.bf-row__value--date` `.bf-cats-head` `.bf-cats-collapse` 新增；`.bf-daily` 改单行；分类格与表单行压缩 |
| `components/bottom-sheet/bottom-sheet.js` | 新增公开方法 `refit()` |
| `pages/main/main.wxml` | `<bottom-sheet id="billSheet">` + `<bill-form bind:resize="onBillFormResize">` |
| `pages/main/main.js` | `onBillSaved` 加回执与跨月落位、`ymLabel`、`onBillFormResize`、`refreshPanels` 支持 `accYm` |
| `tests/input-interaction.test.js` | +40 断言（21 静态契约 + 17 动态行为，含自动聚焦三态） |
| `tests/e2e/input-flow-probe.js` | 新增：7 项效率测量探针（造的数据跑完按备份还原） |
| `tests/e2e/input-form-shots.js` | 新增：深/浅/编辑/昨日 6 帧视觉复查 + 账本零残留校验 |
| `CHANGELOG.md` / `README.md` / `docs/BACKLOG.md` / `pages/release-notes` / `utils/version.js` / `package*.json` | 版本与文档同步 |

---

## 4. 回归实测（本轮实跑，可复制）

```bash
node tests/e2e/input-flow-probe.js    # 7 项效率指标
node tests/e2e/input-form-shots.js    # 6 帧视觉 + 账本残留校验
npm test                              # 53/53
npm run release:check                 # FAIL 0 / WARN 0
```

### 探针实测对比（视口 390×844，safeBottom 34）

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 表单内容高 | 598.4px | **542.9px** |
| 首屏保存按钮 | 可见（余量 0.6px） | 可见（余量充裕） |
| 展开 12 个分类 · 按钮底边 | 849（溢出 9.7） | **795（溢出 0）** |
| 展开态收起入口 | 无 | 有（收起后按钮回首屏） |
| 日期快捷 chip | 0 个 | **2 个**（今天态）/ 1 个（过去态） |
| 保存当月 · toast | 空 | **`已记 ¥3.21`** |
| 保存上月 · Hero 月份 | 11 月 → 11 月 | 11 月 → **10 月** |
| 保存上月 · 当前列表可见 | **false** | **true** |
| 保存上月 · toast | 空 | **`已记入 10 月`** |
| 重开表单 · 分类 | 默认 c-food | **沿用 c-fun**（非默认值，排除假阳性） |
| 账本笔数（探针前后） | — | **8 → 8**（零残留） |

### 视觉复查（`input-form-shots.js`）
深色首屏 / 深色展开 / 深色昨日态 / 深色编辑态 / 浅色首屏 / 浅色展开，6 帧全部人工看过：
- 浅色下 chip 边框与文字清晰（用 `--glass-input` / `--glass-input-border` / `--text-secondary`，都是既有语义变量）
- 「收起」用 `--primary-text`（v1.4.5 引入的「主色当文字专用」变量，≥4.5:1）
- 编辑态金额回填 ¥12.80、商户备注回填正确、「删除此账单」与「保存修改」均完整可见。

---

## 5. 向后兼容

- **数据**：不新增字段、不改字段语义。`saved` 事件只**增加** `ym`/`amountCents`/`dateStr`，原有 `id` 不变；`daily-value-form` 等其他表单的 `saved` 事件未动。
- **视觉**：表单比原来紧凑（行距 -2rpx、分类格 -2rpx），主色 / 主题色 / 图表几何 / Hero 布局零改动。
- **交互**：日期行仍是 picker，新增 chip 不改变原有操作路径；分类默认仍是「餐饮」（只在**本次会话内已记过账**时才沿用）。
- **主题**：新增元素的颜色全部走既有语义变量，8 套配色（4 色 × 深/浅）自动适配，未新增硬编码色值。

---

## 6. 真机验收建议（**未执行**）

模拟器 390×844 只覆盖一种尺寸，以下 5 条必须在真机过一遍：

1. **键盘遮挡**（本版**未覆盖**）：模拟器不弹真键盘，`wx.onKeyboardHeightChange` 探针收到空数组。请在 iPhone SE 与一台 Android 上确认：金额输入时键盘弹起，「确认记一笔」是否被遮；商户 / 备注输入时呢。
2. **小屏首屏**：iPhone SE（375×667）打开「记一笔」，确认底部只露出「备注」行的一部分（= 可滚提示），滚一次能到保存按钮（预算约 42.9px）。
3. **跨月保存**：把日期改到上个月存一笔，确认 Sheet 关闭后 Hero 月份**跳到上个月**、这笔账出现在列表首行、toast 显示「已记入 X 月」。
4. **日期快捷**：点「昨天」，确认日期变成昨天且 chip 变成「今天」；再点「今天」，确认回到今天。
5. **连续记账**：记一笔「娱乐」→ 再点 FAB，确认分类仍停在「娱乐」而不是跳回「餐饮」。

---

## 7. 已知限制 / 遗留（如实列）

| # | 事项 | 原因 |
|---|---|---|
| 1 | 小屏（667 高）首屏仍看不到保存按钮，需滚 42.9px | 继续压缩会牺牲触控尺寸与可读性；底部裁切本身是「可滚」提示。真机确认后再定 |
| 2 | 分类网格未改 6 列 | 改 6 列能让展开 12 个只占 2 行、与收起态等高，但视觉变更明显（图标与字号都要缩），未取得客户确认 |
| 3 | 键盘遮挡未验证 | 模拟器限制，见 §6-1 |
| 4 | 编辑态「删除此账单」在内容多时需滚一下 | 删除是低频且破坏性操作，放末尾反而降低误触，**有意保持** |
| 5 | 保存后不主动滚动列表定位 | 当月新增天然在列表顶部（实测「时间线首行」就是它），无需滚动；跨月场景已改为直接切月 |
| 6 | 探针 `mp.evaluate` 里 `require` 相对路径不可用 | 实测报 `module '../../data/index.js' is not defined`，数据层统一走 `getApp().$store`。写新探针时注意 |

---

## 8. Git

- 分支：`main`（跟踪 `origin/main`）
- 本版提交：见 `git log --oneline -1`
- 历史交付 ZIP 在 `artifacts/releases/`（未跟踪，**不是源码改动**，禁止删除）

---

## 9. 工作区说明（别误报成脏工作区）

- `reports/`、`artifacts/` 已在 `.gitignore` 内，但 `artifacts/releases/*.zip`（约 86 MiB）与部分历史 `reports/` 文件仍是**未跟踪**状态 —— 这是 v1.4.6 归档的既有状态，不属于本版改动。
- 截图一律先写系统临时目录（`%TEMP%\jizhang-input-flow-probe` / `jizhang-input-form-shots`），disconnect 后才归档，避免触发 IDE 重编译。
