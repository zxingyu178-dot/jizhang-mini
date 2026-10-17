# DailyValue Mini · GUI 自动化测试 SOP（E2E Harness）

> 适用：微信原生小程序 DailyValue Mini（AppID `wxcdcf83d9191065d9`）。
>
> 本文是「一条命令可跑、可重复、自动断言 + 自动截图」的 GUI 端到端回归流程的长期事实源。
> harness 位于 `tests/e2e/`，基于官方 **miniprogram-automator**，不依赖任何屏幕坐标、不依赖虚拟显示器。

---

## 1. 三层测试策略

| 层级 | 工具 | 命令 | 覆盖什么 | 谁来跑 |
| --- | --- | --- | --- | --- |
| ① 纯逻辑单测（主力） | Node 原生断言 | `npm test` | 预算/分类/周期/导入/日价/统计等所有数据口径与边界，743 项 | 每次改动必跑，CI 友好 |
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
3. 顺序跑黄金路径 7 个用例，每个用例自动断言 + 自动截图；
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
├── golden-path.js  # 黄金路径 7 个用例（数据 + UI 绑定 + 截图）
└── run.js          # 一键入口：连接 → 跑用例 → 收集日志 → 归档截图 → 退出码
```

黄金路径（全部在模拟器，测试数据用唯一备注 `E2E回归` 标识，开头清理、结尾删除，**幂等**）：

| 用例 | 断言要点 |
| --- | --- |
| T01 主页 | 标题「每日的价值」、顶部 3 个 Tab、FAB 存在、`#accountingPanel` 已渲染 |
| T02 设置 | 版本号与 `utils/version.js` 一致、每日预算提示含 ¥ |
| T03 分类 | 系统核心 5 类（餐饮/交通/购物/娱乐/生活）只读、无归档按钮；自定义分类各行带归档按钮 |
| T04 周期新建 | 每周·周日 ¥28 餐饮、备注「E2E回归」、下次=下一个周日（**覆盖 Android 周日 day=0 口径**） |
| T05 停用 | `enabled=false`、显示「已停用」、不再显示「下次」 |
| T06 重启用 | 重新计算并显示下次日期 |
| T07 编辑+删除 | 编辑改金额 38 生效；删除后测试规则消失、数据恢复（幂等） |

产出：`docs/screenshots/e2e/e2e_*_simulator.png`（8 张：main / settings / category_manage / recurring_weekly_sunday / disabled / enabled / edit / empty）。

---

## 4. 核心经验：六条必守的坑（automator 0.12.1 + Skyline 实测）

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
