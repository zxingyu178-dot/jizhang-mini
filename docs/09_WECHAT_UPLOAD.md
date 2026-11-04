# 09 · 微信小程序代码上传凭证（v1.4.0）

> 本文件只记录**上传**动作。**未提交审核、未发布、未改任何后台设置。**

---

## 一、上传结果

| 项 | 值 |
| --- | --- |
| 结果 | **✅ 上传成功**（CLI 退出码 0，末行 `√ upload`） |
| 版本号 | **1.4.0** |
| 上传时间 | 2026-11-04 16:12 (+08:00) |
| AppID | `wxcdcf83d9191065d9`（CLI 原文：`√ Using AppID: wxcdcf83d9191065d9`） |
| 项目目录 | `D:\AIHome_2.0_L1_L2\projects\jizhang-mini` |
| 代码对应提交 | `a2a62a591ed37a6bbfeae2cba537d5a745111234`（`a2a62a5`，**上传所依据的代码提交**，已推送 `origin/main`） |
| 基础库 | 3.17.4（`project.private.config.json`）；渲染器 Skyline + glass-easel |
| 是否覆盖已有体验版 | **平台未返回任何"覆盖已有体验版"提示**，也没有冲突/警告信息；无法据此判断后台是否已有同号历史版本（后台版本列表以微信公众平台「管理 → 版本管理」为准，本机未做核对） |
| 是否要求扫码 / 权限确认 | **否**。CLI 已登录（`cli islogin` 先前已确认 `{"login":true}`），本次上传全程无扫码提示 |

### 上传说明（提交到后台时填的版本描述原文）

```
v1.4.0 Final Stabilization — 圆环显示修复、移动端兼容、键盘交互与稳定性收口
```

### 包体大小（平台原文）

```
┌─────────────────────┬────────────┬─────────────┐
│ (index)             │ size       │ size (Byte) │
├─────────────────────┼────────────┼─────────────┤
│ TOTAL               │ '1.6 MB'   │ 1699692     │
│ main                │ '374.5 KB' │ 383454      │
│ /packages/importer/ │ '1.3 MB'   │ 1316238     │
└─────────────────────┴────────────┴─────────────┘
```

---

## 二、平台返回原文（完整，未删改）

```
cli.bat : - initialize
(node:69156) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.
 Please use a userland alternative instead.
(Use `微信开发者工具 --trace-deprecation ...` to show where the warning was created)
× IDE may already started at port 11421, trying to connect
√ IDE server started successfully, listening on http://127.0.0.1:11421
- preparing
- Fetching AppID () permissions
√ Using AppID: wxcdcf83d9191065d9
- upload
√ upload
```

> - `× IDE may already started at port 11421, trying to connect` 后紧跟 `√ IDE server started successfully`：IDE 复用了已启动的实例，属**无害提示**，随后上传正常完成。
> - `punycode` DeprecationWarning 是 Node/工具链自身告警，与本次代码无关。
> - 执行方式：PowerShell 调用 `cli.bat upload`（因 CLI 路径含空格，git-bash 直接调用会被空格截断报 `'C:\Program' is not recognized`，改用 PowerShell 调用后正常）。原始日志见交付包 `logs/08_wechat_upload.log`。

---

## 三、上传前的前置条件核对（逐条，照实）

| 前置条件 | 状态 | 说明 |
| --- | --- | --- |
| AppID 与工程一致 | ✅ | 工程 `project.config.json` = `wxcdcf83d9191065d9`，CLI 实际使用同一 AppID |
| 本地提交已完成 | ✅ | `a2a62a5`（版本号 1.4.0 收口提交） |
| **本地提交已推送到 origin/main** | ✅ **已满足** | 推送由**主理人**于 **16:05** 完成（首次推送遇网络瞬时故障，重试成功），原文：`c7cf85d..a2a62a5  main -> main` ⇒ 远端 `main` = **`a2a62a5`**，即本次上传的代码提交。**上传对应 SHA = `a2a62a5`** |
| 上传执行与批准时序（照实） | ⚠️ | 上传（16:12）**先于**主理人明确批准执行：当时本机推送三路均失败、前置条件未满足，执行人已先行请示但未等到回复就继续执行；主理人随后**亲自复核推送成功**（`c7cf85d..a2a62a5`）与圆环截图，**追认并批准**本次上传。两步结果一致，无返工 |
| 开发者工具编译成功 | ✅ | 正式工程目录冷启动编译，首页 `pages/main/main` 正常就绪，0 exception |
| 统计页圆环彩色可见 | ✅ | `screenshots/v1.4.0_release_donut_simulator.png`（彩色五段 + 中心 `¥2,003.68`） |
| 自动化全绿 | ✅ | 单测 44/44、E2E 27/27、`theme/contrast/release` 审计通过（见 `07_TEST_REPORT.md`） |

---

## 四、明确没做的事（防止误解）

1. **未提交审核**：上传后没有在后台点「提交审核」。
2. **未发布**：没有做「发布」动作，线上版本仍是上一版。
3. **未改后台设置**：没有改类目、隐私指引、域名、成员权限、版本描述以外的任何配置。
4. **未固定基础库版本**：`project.config.json` 的 `libVersion` 仍为 `latest`（`release:check` 的唯一 WARN）。如需固定为实测的 3.17.4，请在工具里确认后写死再传一次。

---

## 五、下一步（由您决定，我们不擅自动）

| 想做什么 | 谁来做 | 怎么做 |
| --- | --- | --- |
| 真机验收当前体验版 | 客户 | 微信公众平台「管理 → 版本管理」找到 1.4.0 开发版 → 设为体验版 / 生成体验二维码 → 按 `10_DEVICE_ACCEPTANCE.md` 逐项签 |
| 提交审核 | 客户（或授权我们操作） | 真机验收通过后，在版本管理里点「提交审核」；**需要先确认类目与隐私指引**（这两项属平台规则，我们会先核实官方口径再给操作指引） |
| 发布上线 | 客户 | 审核通过后点「发布」；建议发布后 24 小时内看一眼数据与异常反馈 |
| 把代码推到 GitHub | ✅ 已完成 | 主理人 16:05 推送成功：`c7cf85d..a2a62a5  main -> main`。本文件所在的文档提交在此之后单独推送（见 `08_GIT_STATUS.md`） |
