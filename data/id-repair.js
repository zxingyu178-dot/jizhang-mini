/**
 * data/id-repair.js — 历史账单缺 id 修复（v0.8.x 数据收口）
 *
 * 背景：真机上发现一批历史账单（早期导入 / 写入路径未补 id）缺少 id 字段，
 * 导致 schema 迁移的「不可变字段」校验把多个 id=undefined 账单互相串扰，
 * init() 抛 "不可变字段在迁移中被改变：undefined" 而进入保护模式。
 *
 * 本修复为「补缺损省」而非「修非法值」：id 缺失是明确的必填字段缺失，
 * 补一个确定性 id 不改变任何业务语义（金额 / 时间 / 分类 / 收支全部保持不变）。
 *
 * 幂等：
 *   - 已有 id（非空字符串）的账单不动；
 *   - 缺 id 账单的 id 由「ym + 排序位置 + 内容指纹」确定性生成，
 *     同一条账单在位置与内容不变时每次生成相同 id，反复运行不重复修补。
 *
 * 必须在 schema 迁移（V1→V2→V3）之前执行，使后续校验的 id 键全部有效。
 */
const ledger = require('./ledger');

/** 稳定字符串哈希（djb2，36 进制），不依赖 Node crypto */
function hashStr(s) {
  let h = 5381;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** 账单内容指纹（不含 id，用于区分同位置不同内容） */
function billFingerprint(b) {
  return [
    b.amountCents,
    b.occurredAt,
    b.type,
    b.categoryId || '',
    b.title || '',
    b.merchant || '',
    b.note || '',
    b.ledgerImpact || '',
  ].join('|');
}

/** 账单是否已具备有效 id */
function hasId(b) {
  return !!b && typeof b.id === 'string' && b.id.length > 0;
}

/**
 * 为全部月份中缺 id 的账单补确定性 id。
 * 返回 { repaired, months }；只读 strict，已有文件损坏时抛错（fail-closed）。
 */
function repairMissingIds() {
  const months = ledger.listMonths();
  let repaired = 0;
  const touchedMonths = [];

  months.forEach((ym) => {
    const mf = ledger.readMonthFileStrict(ym);
    if (!mf.bills.some((b) => !hasId(b))) return;

    // 先排序固定位置，使「ym + index」成为稳定坐标
    ledger.sortBills(mf.bills);

    // 已占用 id（含同文件内现有 id）
    const used = {};
    mf.bills.forEach((b) => {
      if (hasId(b)) used[b.id] = true;
    });

    let changed = false;
    mf.bills.forEach((b, i) => {
      if (hasId(b)) return;
      const base = 'fix-' + ym + '-' + i + '-' + hashStr(billFingerprint(b));
      let id = base;
      let n = 1;
      while (used[id]) {
        id = base + '-' + n;
        n++;
      }
      b.id = id;
      used[id] = true;
      repaired++;
      changed = true;
    });

    if (changed) {
      ledger.writeMonthFile(ym, mf);
      touchedMonths.push(ym);
    }
  });

  return { repaired, months: touchedMonths };
}

module.exports = {
  hashStr,
  billFingerprint,
  hasId,
  repairMissingIds,
};
