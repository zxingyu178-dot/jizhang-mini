/**
 * data/daily-value/milestones.js — 日价里程碑（纯数学事实，纯函数）
 *
 * 两类节点（对齐 Android detail.ts）：
 *   1. 使用时间：7 / 30 / 100 / 365 / 730 / 1095 / 1460 / 1825 天；
 *   2. 日价目标：¥100 / ¥50 / ¥20 / ¥10 / ¥5 / ¥1 每天，requiredDays=ceil(原价/目标)。
 *
 * 只陈述数学事实，禁止「回本 / 物有所值 / 建议继续使用 / 消费理性」等评价文案。
 * 金额单位：整数分（amountCents）；目标节点对外仍以元（targetYuan）展示。
 */
const core = require('./core');

/** 使用时间节点（天） */
const USAGE_TARGETS = [7, 30, 100, 365, 730, 1095, 1460, 1825];
/** 日价目标节点（元 / 天） */
const PRICE_TARGETS_YUAN = [100, 50, 20, 10, 5, 1];

/**
 * 使用时间里程碑（已达高亮，未达给出剩余天数）。
 * 窗口：targets <= max(365, elapsed*4)，长周期物品才逐步显示更远节点。
 */
function computeUsageMilestones(startDate, today) {
  const t = today || core.localDateKey();
  const elapsed = Math.max(1, core.elapsedDays(startDate, t));
  return USAGE_TARGETS.filter((target) => target <= Math.max(365, elapsed * 4)).map((target) => ({
    target,
    achieved: elapsed >= target,
    elapsed,
    remaining: elapsed >= target ? 0 : Math.max(0, target - elapsed),
  }));
}

/**
 * 日价目标节点：按原价自动选择 3~5 个有意义节点（原价 >= 目标的前 4 个）。
 * requiredDays = ceil(amountCents / targetCents)。
 * amountCents <= 0 / 非数 → 空数组（安全）。
 */
function computeDailyPriceMilestones(amountCents, elapsed) {
  const cents = Number(amountCents);
  if (!Number.isFinite(cents) || cents <= 0) return [];
  const safeElapsed = Math.max(0, Math.floor(Number(elapsed) || 0));
  return PRICE_TARGETS_YUAN.filter((targetYuan) => cents >= targetYuan * 100)
    .slice(0, 4)
    .map((targetYuan) => {
      const targetCents = targetYuan * 100;
      const requiredDays = Math.max(1, Math.ceil(cents / targetCents));
      const achieved = safeElapsed >= requiredDays;
      return {
        targetYuan,
        targetCents,
        requiredDays,
        achieved,
        remainingDays: achieved ? 0 : Math.max(0, requiredDays - safeElapsed),
      };
    });
}

/** 第一个未达成的日价目标（全部达成 / 无节点 → undefined） */
function nextPriceMilestone(milestones) {
  return (milestones || []).find((m) => !m.achieved);
}

/**
 * 最近里程碑摘要：
 *   已达成：「已使用 N 天，日价已经降到 ¥X/天以内」（否则仅「已使用 N 天」）；
 *   下一站：「下一站 ¥Y/天，还需 M 天」（无则 null）。
 * @param {object} detail computeDailyValueDetail 结果
 * @param {Array} priceMilestones computeDailyPriceMilestones 结果
 */
function buildMilestoneSummary(detail, priceMilestones) {
  if (!detail || !detail.ok) return null;
  const achieved = (priceMilestones || []).filter((m) => m.achieved);
  const next = nextPriceMilestone(priceMilestones);
  const achievedText =
    achieved.length > 0
      ? '已使用 ' + detail.elapsed + ' 天，日价已经降到 ¥' + achieved[achieved.length - 1].targetYuan + '/天以内'
      : '已使用 ' + detail.elapsed + ' 天';
  const nextText = next ? '下一站 ¥' + next.targetYuan + '/天，还需 ' + next.remainingDays + ' 天' : null;
  return { achievedText, nextText };
}

module.exports = {
  USAGE_TARGETS,
  PRICE_TARGETS_YUAN,
  computeUsageMilestones,
  computeDailyPriceMilestones,
  nextPriceMilestone,
  buildMilestoneSummary,
};
