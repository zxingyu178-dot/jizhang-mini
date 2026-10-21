// pages/release-notes/release-notes.js
// 更新日志：按版本列出主要变化（第一版不自动弹，仅从设置进入）。
const device = require('../../utils/device');
const theme = require('../../utils/theme');

const RELEASES = [
  {
    version: '1.1.0',
    title: 'Bill Explorer & Analytics',
    items: [
      '账单高级搜索：支持关键词、类型、分类、时间范围筛选',
      '统计钻取：从月度 / 年度分类、月份柱直接查看对应账单',
      '自定义日期统计：任选起止日期查看收支与账单数',
      '年度回顾：最大单笔、记录最多分类、最常消费月份',
      '账单 CSV 导出：Excel / WPS / Numbers 可直接打开',
      '存储可靠性：原子写入与写入前严格读取，降低数据损坏风险',
    ],
  },
  {
    version: '1.0.0',
    title: '正式发布版',
    items: [
      '深色 / 浅色 / 跟随系统三种主题',
      '统计、记账、日价三大核心功能',
      '完整的数据保护模式与备份恢复',
    ],
  },
];

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    themeClass: 'theme-dark',
    releases: RELEASES,
  },
  onLoad() {
    const info = device.get();
    this.setData({
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      headerHeight: info.headerHeight,
    });
    // 主题绑定：根容器 themeClass 实时跟随，不重启、不丢状态。
    this._offTheme = theme.bindPage(this);
  },
  onUnload() {
    if (this._offTheme) { this._offTheme(); this._offTheme = null; }
  },
});
