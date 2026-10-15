# DailyValue Mini v0.2.0 iOS / Android 双端兼容报告

- 版本：v0.2.0
- 核心模块：`utils/device.js`（统一测量）+ 各页面/组件的安全区适配

---

## 一、适配策略

只使用微信官方 API，**没有任何机型硬编码**（不存在 `if iPhone X / 15 / 16` 之类判断）。

- 窗口信息：优先 `wx.getWindowInfo()`，回退 `wx.getSystemInfoSync()`。
- 右上角胶囊：`wx.getMenuButtonBoundingClientRect()`，用于自定义 Header 内容与胶囊垂直对齐，带 fallback。
- 安全区：由 `windowInfo.safeArea` 计算 `safeInsets`（top/bottom/left/right）；
  - `top` 至少等于 `statusBarHeight`，覆盖刘海 / 灵动岛；
  - 无 `safeArea` 的设备回退到「状态栏顶部 + 底部 0」；
  - 结果只测量一次并缓存，普通生命周期内不变。

`device.measure()` 暴露：`platform / isIOS / isAndroid / windowWidth / windowHeight / statusBarHeight / safeArea / safeInsets / safeBottom / menu / navBarHeight / headerHeight`。

## 二、关键区域适配

| 区域 | 处理方式 |
| --- | --- |
| 顶部自定义 Header（刘海 / 灵动岛 / 状态栏） | `headerHeight = statusBarHeight + navBarHeight`，navBar 依据胶囊 top/height 反推 |
| 右上角微信胶囊 | 标题与胶囊垂直对齐，不重叠 |
| 顶部 Tabs / 内容高度 | 由 `windowHeight - headerHeight - Tabs 高度` 动态计算 swiper 高度，避免塌缩 |
| 右下角 FAB（+） | 内联 `bottom = safeBottom + 视觉间距`，不压 Home Indicator |
| Bottom Sheet（记账表单） | 底部 `padding-bottom: env(safe-area-inset-bottom)` |
| 预览页确认按钮 / 结果页按钮 | 底部安全区留白 |
| 键盘 | 表单使用小程序原生输入，未做额外高度 hack，真机键盘弹起需确认 |

## 三、单元测试（device.test.js）— 6/6 PASS

用 `windowInfo` 入参模拟，覆盖换算逻辑：

| 模拟机型 | 尺寸 | 关注点 |
| --- | --- | --- |
| iPhone SE（Home 键） | 375×667 | 无底部安全区 |
| iPhone 12（刘海） | 390×844 | 状态栏 + Home Indicator |
| iPhone 14 Pro Max（灵动岛） | 430×932 | 更大顶部安全区 + 底部 |
| Android 标准 | 360×800 | 无底部安全区 |
| 无 safeArea | 缺省 | 回退状态栏 |
| 缓存 | — | 只测量一次 |

## 四、模拟器渲染验证

- 机型：iPhone 12/13（390×844，刘海 + Home Indicator）。
- 渲染模式：**Skyline + glass-easel**。
- 已验证页面：主页（三 Panel/月份/列表/FAB）、记账表单 Bottom Sheet、设置、导入入口、导入预览、导入结果。
- 结果：顶部 Header 与胶囊无重叠；FAB 悬浮于 Home Indicator 上方；底部弹层主按钮未被指示条遮挡。截图见 `screenshots/01–07`。

## 五、待真机验收（NOT TESTED）

当前证据是**逻辑单测 + 单机型模拟器**，按纪律不把它等同于真机通过。

- iOS 真机（尤其灵动岛机型、SE）：Home Indicator、灵动岛、键盘弹起、下拉刷新，需扫码在真机确认。
- Android 真机：360px 窄屏、390/412px 常规、小米/vivo 长屏比例，避免为适配 iPhone 把 Android 做坏。
- 多机型模拟器（SE / 普通刘海 / 灵动岛 / Max）在本次仅以 Node 单测覆盖**换算逻辑**，未在开发者工具逐机型截图；开发者工具的设备下拉在自动化环境下切换不稳定，未逐机型渲染。
- WebView 渲染模式：当前仅在 Skyline 下验证；低版本基础库回退 WebView 时毛玻璃降级效果未逐页回归。

## 六、给真机验收的检查清单

1. 顶部标题不被胶囊遮挡、不压刘海/灵动岛；
2. 底部 FAB 与「确认」按钮在 Home Indicator 上方；
3. 打开键盘时表单输入框可见、可提交、关闭后布局恢复；
4. 长屏 / 小屏列表可滚动且不出现空白；
5. 导入流程中 `chooseMessageFile` 从微信文件传输助手选择文件正常（iPhone 需先分享到文件传输助手）。
