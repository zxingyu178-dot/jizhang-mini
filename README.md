# 记账mini（jizhang-mini）

一个使用**微信原生小程序**实现的轻量本地记账应用，无后端、无网络请求、无需登录，账单数据仅保存在本机 `wx.Storage`。

- 技术栈：微信原生小程序（WXML + WXSS + JavaScript，不依赖任何 npm 框架）
- 适用工具：微信开发者工具 Stable 2.02 及以上
- 当前版本：0.1.0（脚手架 / 最小可用版本）

## 已实现功能

- **明细页（首页）**：本月收入 / 支出 / 结余汇总；按日期分组展示账单；点击记录可删除（二次确认）。
- **记账页**：支出 / 收入切换；金额输入（限制两位小数）；分类网格选择；日期选择；备注；保存后回到明细页。
- **统计页**：按分类汇总累计支出 / 收入，展示金额、占比与条形分布。
- 数据通过 `wx.setStorageSync` 本地持久化，关闭后不丢失。

## 目录结构

```text
jizhang-mini/
├── app.js                 # 小程序入口
├── app.json               # 全局配置：页面路由、窗口、tabBar
├── app.wxss               # 全局样式与配色变量
├── project.config.json    # 开发者工具工程配置（appid 为测试号占位）
├── sitemap.json           # 小程序索引配置
├── pages/
│   ├── index/             # 明细页（账单列表 + 本月汇总）
│   ├── add/               # 记账页（新增收入 / 支出）
│   └── stats/             # 统计页（分类占比）
├── utils/
│   ├── db.js              # 本地数据存取与统计逻辑
│   └── util.js            # 日期、金额、ID 等通用工具
└── images/tab/            # tabBar 图标（普通态 / 选中态）
```

## 快速开始

1. 安装微信开发者工具（Windows 64 位稳定版安装包已下载到
   `D:\AIHome_2.0_L1_L2\environment\cache\wechat_devtools_2.02.2608080_win32_x64.exe`，双击安装）。
2. 打开开发者工具，使用微信扫码登录。
3. 选择「小程序」→「导入项目」，目录选择本文件夹 `jizhang-mini`。
4. AppID 处理：
   - 仅本地学习 / 调试：可直接使用「测试号」或保留当前 `touristappid`；
   - 需要真机预览 / 发布：到 [mp.weixin.qq.com](https://mp.weixin.qq.com) 注册小程序，把真实 AppID 填入 `project.config.json` 的 `appid` 字段。
5. 导入后工具会自动编译，在模拟器中即可点「记账」开始使用。

## 数据说明

- 账单存储键：`jm_records`，值为记录数组。
- 单条记录结构：

```json
{
  "id": "记录唯一ID",
  "type": "expense",
  "amount": 25.5,
  "category": "food",
  "date": "2026-10-15",
  "note": "午餐",
  "createdAt": 1728969600000
}
```

- `type`：`expense`（支出）/ `income`（收入）。
- 分类标识见 `utils/db.js` 的 `CATEGORIES`。

## 后续可扩展（脚手架预留方向）

- 按月筛选统计、账单编辑、分类管理与自定义分类
- 预算设置与超支提醒
- 数据导出 CSV / 云同步（接入微信云开发或自建后端）
- 图表升级（可引入 ec-canvas）、搜索账单

## 参考资源

- 小程序指南：https://developers.weixin.qq.com/miniprogram/dev/framework/
- 开发者工具下载：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
