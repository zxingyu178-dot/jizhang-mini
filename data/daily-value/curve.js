/**
 * data/daily-value/curve.js — 日价下降曲线（纯函数，Bill 派生，不存每日快照）
 *
 * 第 N 天日价 = amountCents / N（动态计算）。
 * 不生成「每天几千个点」：总天数超过安全上限时均匀采样（约 80~120 点），
 * 但始终包含 第 1 天 与 今天，并尽量保留 7/30/100/365… 关键节点。
 * 对齐 Android buildDailyValueCurve（detail.ts）。
 */
const core = require('./core');
const detailMod = require('./detail');

/** 使用时间关键节点（长周期采样时尽量保留） */
const USAGE_TARGETS = [7, 30, 100, 365, 730, 1095, 1460, 1825];
/** 曲线最大采样点数（默认值） */
const CURVE_MAX_POINTS = 100;

/** 起算日期 + 第 N 天 → 业务日期（本地日历，自动处理跨月/跨年） */
function dayDate(startDate, day) {
  const parts = String(startDate).split('-').map(Number);
  const y = parts[0];
  const m = (parts[1] || 1) - 1;
  const d = parts[2] || 1;
  const dt = new Date(y, m, d + day - 1);
  return core.localDateKey(dt);
}

function range(from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

/** 幂等采样：过滤非法值、去重、升序，并保证都 >= 1 */
function dedupeSorted(days) {
  const set = new Set(days.filter((d) => Number.isFinite(d) && d >= 1));
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * 构建日价下降曲线（第 1 天 → 今天）。
 * @param {object} bill 启用日价的账单
 * @param {string} [today]
 * @param {number} [maxPoints]
 * @returns {Array<{day:number,date:string,label:string,valueCents:number}>}
 */
function buildDailyValueCurve(bill, today, maxPoints) {
  const t = today || core.localDateKey();
  const detail = detailMod.computeDailyValueDetail(bill, t);
  if (!detail.ok) return [];

  const totalDays = Math.max(1, detail.elapsed);
  const amountCents = detail.amountCents;
  const cap = Math.floor(maxPoints) || CURVE_MAX_POINTS;
  const safeMax = Math.max(8, Math.min(120, cap));

  let days;
  if (totalDays <= safeMax) {
    days = dedupeSorted([1, totalDays].concat(range(2, totalDays)));
  } else {
    // 均匀采样：步长保证约 safeMax 个点
    const step = totalDays / safeMax;
    const sampled = [];
    for (let d = 1; d <= totalDays; d += step) sampled.push(Math.round(d));
    const keep = USAGE_TARGETS.filter((x) => x <= totalDays);
    days = dedupeSorted([1, totalDays].concat(sampled, keep));
  }

  return days.map((d) => {
    const value = d > 0 ? amountCents / d : amountCents;
    return {
      day: d,
      date: dayDate(detail.startDate, d),
      label: '第' + d + '天',
      // 保留 2 位小数精度（分）；页面展示再换算为元
      valueCents: Math.round(value * 100) / 100,
    };
  });
}

module.exports = {
  USAGE_TARGETS,
  CURVE_MAX_POINTS,
  dayDate,
  buildDailyValueCurve,
};
