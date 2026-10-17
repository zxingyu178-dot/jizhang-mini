# DailyValue Mini · GUI 自动化测试 SOP（E2E Harness）

> 适用：微信原生小程序 DailyValue Mini（AppID `wxcdcf83d9191065d9`）。
>
> 本文是「一条命令可跑、可重复、自动断言 + 自动截图」的 GUI 端到端回归流程的长期事实源。
> harness 位于 `tests/e2e/`，基于官方 **miniprogram-automator**，不依赖任何屏幕坐标、不依赖虚拟显示器。

---

## 1. 三层测试策略

| 层级 | 工具 | 命令 | 覆盖什么 | 谁来跑 |
| --- | --- | --- | --- | --- |
| ① 纯逻辑单测（主力） | Node 原生断言 | `npm test` | 预算/分类/周期/导入/日价/统计/健康体检等所有数据口径与边界，**833 项 / 11 套件** | 每次改动必跑，CI 友好 |
| ② GUI 自动化（本 harness） | miniprogram-automator | `npm run e2e` | 页面渲染、数据绑定、交互闭环（增/改/停用/删）、自动截图 | 每次版本、改 UI 后 |
| ③ 真机 Gate（人工） | 真实微信 Android/iOS | 按版本 `DEVICE_GATE` | Canvas 曲线、毛玻璃 Bottom Sheet 穿字、性能、触控、安全区 | **用户本人**，助手不代签 |

原则：

- **数学口径、边界条件放第 ① 层**（快、稳、可枚举），不要用 GUI 去堆逻辑分支。
- **GUI 只验证「接线是否正确」**：页面是否渲染、按钮是否联动、`data` 是否绑定、关键交互是否闭环。
- **模拟器不能替代真机**：Canvas 日价曲线在模拟器不渲染、毛玻璃/性能必须真机看。模拟器截图统一带 `_simulator` 后缀，禁止冒充真机。

---

## 2. 一条命令

```bash
# 在项目根目录（D:\AIHome_2.0_L1_L2\projects\jizhang-mini）
npm run e2e
# 等价于：node tests/e2e/run.js
```

行为：

1. 若 9420 端口已有自动化实例 → 直接复用；
2. 若没有 → 自动拉起微信开发者工具 `cli auto`（隐藏窗口），等待端口监听并等首页编译就绪；
3. 顺序跑黄金路径 12 个用例（T01–T12），每个用例自动断言，子页自动截图；
4. 断开连接后，把截图从项目外暂存目录复制到 `docs/screenshots/e2e/`；
5. 退出码：全绿 `0`，有失败 `1`。

已验证三种入口都能跑通：**手动启动 IDE 后跑、IDE 已在跑复用、完全不启动 IDE 直接跑（自动冷启动）**。

### 前置条件（一次性）

- 微信开发者工具已安装；harness 默认从以下路径解析 `cli.bat`（也可用环境变量 `WECHAT_CLI` 覆盖）：
  - `C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`
  - `C:\Program Files\Tencent\微信web开发者工具\cli.bat`
- 开发者工具「设置 → 安全设置 → 服务端口」**已开启**。
- 项目已在开发者工具中打开过并完成「信任项目」；`cli auto` 会显式带 `--trust-project`。
- 已安装依赖：`miniprogram-automator`（devDependencies，已在 `package.json`）。

### 环境变量（均可省略）

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `WECHAT_CLI` | 上述默认路径 | 覆盖 cli 路径 |
| `AUTO_PORT` | `9420` | 自动化 WebSocket 端口 |
| `E2E_LAUNCH_TIMEOUT` | `120000` | 冷启动等待端口上限（ms） |
| `E2E_READY_TIMEOUT` | `90000` | 端口通后等首页就绪上限（ms） |
| `E2E_SHOT_DIR` | `docs/screenshots/e2e` | 截图最终归档目录（项目内） |
| `E2E_SHOT_STAGE_DIR` | `%TEMP%\dailyvalue-mini-e2e-shots` | 截图暂存目录（**必须在项目外**） |

---

## 3. harness 结构

```
tests/e2e/
├── config.js       # 路径/端口/超时/CLI 解析/截图目录，支持环境变量覆盖
├── launcher.js     # 幂等启动/复用 IDE：ensureAutomation / waitForReady / spawnCli
├── helpers.js      # Ctx 测试上下文：导航、等待、断言、标准截图
├── golden-path.js  # 黄金路径 12 个用例（T01–T12，数据 + UI 绑定 + 子页截图）
└── run.js          # 一键入口：连接 → 跑用例 → 收集日志 → 归档截图 → 退出码
```

黄金路径（全部在模拟器，测试数据用唯一备注 `E2E回归` / `E2E账单回归` / `E2E日价回归物品` 标识，开头清理、结尾删除，**幂等**）：

| 用例 | 断言要点 |
| --- | --- |
| T01 主页 | 标题「每日的价值」、顶部 3 个 Tab、FAB 存在、`#accountingPanel` 已渲染 |
| T02 设置 | 版本号与 `utils/version.js` 一致、每日预算提示含 ¥ |
| T03 分类 | 系统核心 5 类只读、无归档按钮；自定义分类各行带归档按钮 |
| T04 周期新建 | 每周·周日 ¥28 餐饮，`startDate`=严格未来的下一个周日（确定性）、下次=该周日（**周日 day=0 口径**） |
| T05 停用+重启用 | 停用 `enabled=false` 显示「已停用」、无下次；重启用重算下次 |
| T06 编辑+删除 | 编辑改金额 38 生效；删除后规则消失、数据恢复（幂等） |
| T07 预算设置 | 开关/金额联动 canSave；保存 ¥66/天；**结束恢复原预算** |
| T08 预算 Hero | 预算模式 + 今日/本周/本月分段 DOM 断言（`bd.hasBudget` / 文案），随后恢复原预算 |
| T09 搜索 | 初始空态、无结果空态（input focus 页**不截图**，只 DOM 断言） |
| T10 快速记账新增 | FAB → 金额/备注 → 保存，新账单进入时间线（DOM 断言） |
| T11 快速记账编辑 | 点开回填 → 改 56.78 → 重开断言；删除清理（mock showModal） |
| T12 日价新增 | 切日价 Tab → 建日价物品 → 进列表 → 详情整单删除（按 `item.name` 定位） |

> 主页三态（预算 Hero / 快速记账结果 / 日价 Tab）是常驻 main 上的状态，截图会帧冻结（见坑 7），T08/T10/T12 **只做 DOM 断言不截图**；真实视觉留档用独立冷启动脚本（见坑 7）。
>
> 产出：`docs/screenshots/e2e/e2e_*_simulator.png`（8 张**子页**：main / settings / category_manage / recurring_weekly_sunday / disabled / enabled / edit / empty）。

---

## 4. 核心经验：十条必守的坑（automator 0.12.1 + Skyline 实测）

> 以下每一条都曾导致「T01 过、T02 起全部 `timeout waiting for automator response`」，
> 或「逻辑 data 正确但渲染层整块不绘制」，用二分法逐一定位，**务必照搬，不要重新踩**。

### 坑 1：冷启动首页就绪前，绝对不能发路由命令（会永久黑屏）

`cli auto` 拉起后，**9420 端口先监听（约 15–25s），但小程序首页仍在编译**，此时 `pageStack()` 返回 `[]`。
这个窗口内发 `reLaunch` / `navigateTo` 会打断首屏加载，之后页面栈永久为空、模拟器黑屏、所有命令超时。

**正确做法**：connect 后先轮询 `waitForReady()`——每 1.5s 查 `pageStack`，直到页面栈非空且 `currentPage().path` 可读，再开始任何操作。
冷启动时初始页就是 `pages/main/main`，**首页会自己加载，不需要也不应该 reLaunch 去「打开首页」**。

### 坑 2：全程不要用 reLaunch，用例间清栈只用 navigateBack

- 冷启动首屏就绪前 reLaunch → 黑屏（见坑 1）；
- 同一会话多次 reLaunch → WebSocket 与新页面失步，后续命令超时。

本项目 **没有 tabBar**（顶部「统计/记账/日价」是 main 内自定义 swiper），所有页面都能 `navigateTo`。
因此用例间统一 `backToHome()`：读 `pageStack` 深度，用 `navigateBack({delta: depth-1})` 回到栈深 1 的主页，再 `navigateTo` 到目标页。

### 坑 3：截图绝不能写进项目目录（会触发 IDE 自动重编译，杀死会话）

这是最隐蔽的一条。微信开发者工具会**监听项目目录**，`mp.screenshot({path})` 一旦把 png 写进项目内
（如 `docs/screenshots/...`），就会触发「文件变更 → 自动重新编译 → 模拟器 reload → automator WebSocket 失步」，
下一条命令立即超时，且看起来与截图操作无关。

**正确做法（两段式）**：

1. 测试中截图统一写到**项目外暂存目录** `SHOT_STAGE_DIR`（默认 `%TEMP%\dailyvalue-mini-e2e-shots`）；
2. 全部用例跑完、`mp.disconnect()` **之后**，再由 `run.js` 的 `publishShots()` 复制到项目内 `docs/screenshots/e2e/`（此刻再触发编译也不影响测试）。

排查方法：用「每个操作后做一次导航往返」逐步二分，能精确定位到「某一步之后导航必失败」。

### 坑 4：Windows 下 spawn CLI 必须处理含空格路径

`cli.bat` 默认在 `C:\Program Files (x86)\...`（含空格）。
Node 出于安全限制，Windows 上 `.bat` 不能裸 `spawn`，必须 `shell:true`；但 `shell:true` 对命令与参数**只拼接不转义**，
于是路径被空格截断成 `'C:\Program' is not recognized`。

**正确做法**：`shell:true` 下对所有含空白的命令/参数显式包双引号：

```js
const q = (s) => (/\s/.test(String(s)) ? `"${s}"` : String(s);
spawn(q(config.CLI_PATH), args.map(q), { shell: true, windowsHide: true, ... });
```

> 冷启动日志里 `crashpad ... TransactNamedPipe`、`punycode deprecated`、`IDE may already started at port xxxx`
> 都是 IDE 自身的无害告警；以 `IDE server started successfully` + `√ auto` 为准。自动化走的是 9420 WebSocket，
> 日志里的 HTTP 端口（如 11421）是动态的，忽略即可。

### 坑 5：Skyline 组件引用「多行声明的 CSS 自定义属性」会整块不渲染（v0.7.0 实测）

在 `app.wxss` 里新增 Design Token 时，把变量值写成多行（冒号后换行、值另起一行）：

```css
/* ❌ 错误：值换行 */
--button-primary:
  linear-gradient(135deg, #7c86ff 0%, #5b67f0 100%);
--glass-sheet:
  linear-gradient(...),
  linear-gradient(...);
```

现象非常迷惑：**逻辑层完全正确**（`page.data()` / 组件 `data` 里 `visible=true`、`closed=false`、`canSubmit=true`），
但 **Skyline 渲染层整块不绘制**——Hero 卡片白屏、Bottom Sheet 逻辑 `visible=true` 却连遮罩都不弹、表单按钮区消失。
关键不对称：**页面级 wxss（如 `budget-settings`、分包 `import`）引用同一变量能正常显示，只有组件（isolated / apply-shared）不渲染**。
曾因此误判为「isolated 组件不能用新增变量」，实际是「组件编译单元不接受多行变量值」。

**正确做法**：所有自定义属性值**单行声明**，多背景 gradient 用逗号连在同一行：

```css
/* ✅ 正确：值与冒号同一行 */
--button-primary: linear-gradient(135deg, #7c86ff 0%, #5b67f0 100%);
--glass-sheet: linear-gradient(...), linear-gradient(...);
```

排查口诀：**「逻辑 data 正确、截图不显示」先怀疑组件 wxss 引用的变量**；用 `git stash` 回纯 HEAD 基线对照
（基线正常即确认是改动引入），再逐文件二分。

### 坑 6：改 app.wxss 新增变量后，先清 WeappCompileCache 全量编译，否则误判代码 bug

即使代码正确，Skyline **增量编译缓存**有时不会把「新增的 page CSS 变量」同步进组件编译单元，
表现与坑 5 相同（组件白屏）。这时反复改代码、回退都没用，必须强制全量编译：

1. 关闭 IDE（`Get-Process -Name '微信开发者工具' | Stop-Process -Force`；注意 `Get-Process wechatdevtools` 永远返回 0，是假象）；
2. 删除编译缓存目录下的 hash 子目录（**只删 `WeappCompileCache` 下的子目录**）：
   `C:\Users\30566\AppData\Local\微信开发者工具\User Data\<hash>\WeappCache\WeappCompileCache\`；
3. 重新 `cli auto` 冷启动（约 90–100s 后再连接）。

**绝对不要删 `WeappLocalData`**——会丢掉 `wx.storage` 里的测试账单。

### 坑 7：常驻主页 main 截图会「帧冻结」（v0.7.0 实测，最反直觉）

现象：automator + Skyline 下，**常驻主页 `pages/main/main` 在同一会话里，`mp.screenshot` 只对第一张主页帧新鲜；之后无论怎么 `navigateBack` 回主页、真实 tap 切 Tab、`callMethod/setData`，截图都永久停在本会话第一张主页画面**。

- 但 `page.data()` / 组件 `data()` **已经正确变化**（DOM 断言全绿，证明接线正确），只是截屏 surface 不更新；
- 对比：`navigateTo` 打开的**二级子页每次都是新页面，截图始终新鲜**（settings / category / recurring 都正常）；
- 同页内 swiper 切「统计/记账/日价」属于**同一页面内切换**，不产生新页面，所以也被冻结。

**结论与对策**：

1. GUI 回归对主页三态**一律以 DOM/data 断言为准**，不要相信截图、也不要为截图服务（T08/T10/T12 不截图）；
2. 确实需要主页真实视觉留档时，**每个目标场景独立重启一次 IDE**：`cli quit` → 重新 `cli auto` 拉起 → 新连接后**只做一次**切 Tab（真实 tap，触发面板加载）→ 立即截图。全新会话的第一次主页画面是新鲜的；
3. 不要用 `reLaunch` 试图在同一会话内刷新主页——reLaunch 后 `currentPage()`/tap 会与新页面失步，截到的仍是旧帧。
4. 参考实现：v0.7.0 冷启动留档脚本（temp，不入仓库）对记账/统计/日价/预算 Hero 各自独立重启会话；二级子页（日价详情等）在同一会话 `navigateTo` 即可。

### 坑 8：自定义组件内部节点必须用「组件实例」的 `$$` 穿透

`page.$$('empty-state .es__action')` 这类**跨组件后代选择器返回 0**，点不到组件内部的按钮。

**正确做法**：先拿组件实例，再在实例上 `$$`：

```js
const es = await page.$('empty-state');   // CustomElement
const btns = await es.$$('.es__action');  // 组件内部节点
await btns[0].tap();
```

同理，`#accountingPanel` 内的支出/预算分段、周期 Sheet 内 chips 等，都要先 `page.$('#组件 id')` 再 `$$`。注意：组件内部继续 `$$` 拿到的是普通 `WxmlElement`，**没有 `data()` 方法**（只有最外层组件实例有 `data()/callMethod()/setData()`）。

### 坑 9：input 聚焦（键盘弹起）的页面不要截图，只做 DOM 断言

搜索页、金额/备注输入等会让 input `focus=true`、唤起软键盘，此时 `mp.screenshot` 会永久 timeout 或截到异常帧。

**对策**：这类页面只做 DOM 断言（如 T09 搜索验证 `groups=[]`、空态渲染），不截图；金额输入优先用 `callMethod('onAmount', {detail:{value}})` 注入，避免真实键盘干扰同帧截图。

### 坑 10：空列表的新建入口可能在 empty-state 组件里（选择器随数据变化）

v0.7.0 周期页 `.rc-add` 改为 `wx:if="{{!empty}}"`——**有规则时才渲染底部新建按钮，空列表时新建入口是 empty-state 的 action 按钮**（`.es__action`，在组件内部）。

因此周期页 `goto` 的就绪选择器不能用 `.rc-add`（空态时不存在 → 超时），要用恒在的容器（`.rc-page` / `page-header`）；打开新建编辑器要分两种情况：非空点 `.rc-add`，空态走 `empty-state` 组件的 `.es__action`（配合坑 8）。

### 补充：几个交互/诊断事实

- **切 main 顶部自定义 Tab 必须用真实元素 tap**：`page.$$('.tabs__item')[i].tap()` 有效；
  `page.callMethod('onTab', {currentTarget:{dataset:{i:2}}})` 因构造的 event 不完整而不生效。
- **Bottom Sheet 状态诊断**：main 有 3 个 `bottom-sheet`，`page.$$('bottom-sheet')[i].data()` 读 `show/visible/closed`；
  逻辑状态对但不画 = 样式问题（坑 5/6），逻辑状态不对 = 绑定/事件问题。
- **关闭 Sheet 调页面方法**：`page.callMethod('onSheetClose')` / `onDvSheetClose()`。

---

## 5. automator 0.12.1 API 事实（实测，避免重踩）

- 页面路径是 `page.path`（不是 `route`）；`page.data()` 是**异步方法**（`await page.data()`，不是属性）。
- `page.$(selector)` 找不到返回 `null`（不抛异常）；`page.$$(selector)` 返回数组。
- 元素：`element.tap()`、`inputEl.input('文本')`、`element.text()`、`element.wxml()`。
- 自定义组件是 `CustomElement`，有 `data()` / `callMethod()` / `setData()`。
- 导航：`mp.callWxMethod('navigateTo', { url: '/pages/xxx/xxx' })`（URL 必须带前导 `/`）、`navigateBack`。
- 弹窗：`mp.mockWxMethod('showModal', { confirm: true, cancel: false })` 自动点确认，用完 `restoreWxMethod('showModal')`。
- 开关（switch）：直接 `page.callMethod('onToggle', { currentTarget: { dataset: { id } }, detail: { value: true/false } })`。
- 干净手机框截图：`mp.screenshot({ path })`（输出 390×844 PNG）。
- 官方 `Launcher.js` 的启动流程只做：spawn `cli auto` → 轮询 connect → checkVersion → sleep，**没有额外编译步骤**。

---

## 6. 扩展新用例

1. 在 `golden-path.js` 追加一个 `await ctx.test('T0x ...', async () => { ... })`。
2. 用 `ctx.goto(route, readySelector)` 进页面（内部先回主页再 navigateTo），用 `ctx.home()` 回主页。
3. 用 `page.$ / $$`、`el.tap()`、`el.input()`、`await page.data()` 取数据做断言；断言用 `ctx.eq/ok/truthy/includes`。
4. 涉及新增/删除数据时，用唯一标识（如固定备注）并在开头清理、结尾删除，保证**幂等、可重复**。
5. 需要确认弹窗就 `mockWxMethod('showModal', ...)`，用完 `restoreWxMethod`。
6. 用 `ctx.shot('e2e_xxx')` 截图（自动写暂存目录、自动加 `_simulator` 后缀）。
7. 选择器 / `data` 字段以页面源码为准（`pages/<page>/*.wxml`、`*.js`），不要凭记忆。

---

## 7. 故障排查

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 端口一直不监听 | 未开服务端口 / CLI 路径错 / 未信任项目 | 开安全设置服务端口；`WECHAT_CLI` 指定 cli；确认项目可正常打开 |
| 首页就绪后第一页正常，之后全部超时 | 多用了 reLaunch，或截图写进了项目 | 见坑 2、坑 3；用 navigateBack；截图写项目外 |
| 冷启动永久黑屏、`pageStack=[]` | 就绪前发了路由 | 见坑 1；用 `waitForReady` |
| 组件 data 正确但白屏 / Sheet 不弹 | 组件引用了多行声明的 CSS 变量 | 见坑 5；token 值全部改单行 |
| 改了 app.wxss 新变量仍不生效 | 增量编译缓存未同步到组件 | 见坑 6；删 `WeappCompileCache` 子目录全量重编 |
| `callMethod('onTab')` 切不了 Tab | 构造的 event 不完整 | 用 `page.$$('.tabs__item')[i].tap()` |
| `'C:\Program' is not recognized` | CLI 路径含空格未加引号 | 见坑 4 |
| 某用例偶发超时 | 页面动画/加载比固定 sleep 慢 | 用 `waitFor(selector)` 轮询代替固定 sleep；必要时调大 |
| 主页 DOM 已变但截图还是旧画面 | 常驻 main 帧冻结（坑 7） | 主页以 DOM 断言为准；真实视觉每场景独立重启 IDE 拍首张 |
| `page.$$('组件 .内部类')` 返回 0 | 跨组件后代选择器不穿透（坑 8） | 先 `page.$('组件')` 再用组件实例 `$$('.内部类')` |
| 截图永久 timeout / 画面异常 | input focus 唤起键盘（坑 9） | 搜索/金额页只 DOM 断言不截图，金额用 callMethod 注入 |
| 周期页等待 `.rc-add` 超时 | 空列表时新建按钮在 empty-state 里（坑 10） | 就绪选择器用恒在的 `.rc-page`，新建走组件 `.es__action` |
| 残留「E2E回归」测试规则 | 上次中途异常退出 | 下次运行 T04 开头 `cleanupTestRules` 会自动清理 |

关闭全部 IDE：`cli quit`；查 9420：`Get-NetTCPConnection -LocalPort 9420 -State Listen`（PowerShell）。

---

## 8. 真机 Gate 边界（模拟器做不到的）

以下项必须由用户在真实微信 Android 上验收，**模拟器截图不允许替代、助手不代签**：

- Canvas 日价曲线（模拟器不渲染 Canvas）；
- 毛玻璃 Bottom Sheet 是否穿透背景文字；
- 触控手感、安全区、真机性能与信息密度；
- 版本要求的 `*_android.png` 真机截图（不带 `_simulator` 后缀）。

模拟器用于「接线与逻辑闭环」回归；真机用于「视觉与体验」验收，二者互补。
