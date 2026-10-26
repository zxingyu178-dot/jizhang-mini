/**
 * data/search/range.js — 时间范围纯函数（v1.1.0 Gate 3；v1.1.1 起复用 data/date）
 *
 * 把统计钻取的便捷参数（month: 'YYYY-MM' / year: YYYY）
 * 统一换算成搜索 Contract 的 dateFrom / dateTo（毫秒时间戳，含端点）。
 * 非法输入返回 null，便于调用方 fail-closed。
 *
 * v1.1.1：日期口径统一收敛到 data/date.js（结束边界覆盖最后 999ms），
 * 这里保留模块名与对外导出，避免改动 require 路径。
 */
const dateUtil = require('../date');

module.exports = {
  daysInMonth: dateUtil.daysInMonth,
  monthRange: dateUtil.monthRange,
  yearRange: dateUtil.yearRange,
};
