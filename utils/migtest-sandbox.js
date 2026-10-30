// utils/migtest-sandbox.js
// 迁移自检的隔离沙箱（v1.3.3 替代旧 __migtest 直接操作正式账本的危险做法）。
//
// 设计原则：
//   1. 所有文件读写都限制在 USER_DATA_PATH 下的独立沙箱目录 __migtest_sandbox__，
//      不碰正式 manifest、正式 bills 月份分片、正式 wx.storage 的 jm_records；
//   2. 复用真实迁移模块的纯转换函数 legacyToBill（最易出错的旧分类映射 / 金额×100 /
//      日期解析 / 确定性 id），保证冒烟的是真实转换逻辑；
//   3. 在沙箱内独立完成「备份旧数据 → 按月分片 → 读回校验条数/金额/分类」，
//      结束后整个沙箱目录递归删除，可一键复原；
//   4. runMigration 的文件写入 / 快照回滚 / 幂等编排已由 Node 单测覆盖，
//      此入口只负责在真实运行时冒烟转换正确性与文件可写性。
'use strict';

const fs = require('../data/fs');
const ledger = require('../data/ledger');
const migration = require('../data/migration');

const SANDBOX = fs.userRoot() + '/__migtest_sandbox__';
const SANDBOX_BILLS = SANDBOX + '/bills';
const SANDBOX_BACKUP = SANDBOX + '/legacy/jm_records.backup.json';

/** 沙箱内月份分片路径（与正式 paths.billFile 同构，但根目录隔离）。 */
function sandboxBillFile(ym) {
  return SANDBOX_BILLS + '/' + ym + '.json';
}

/** 递归删除沙箱目录（微信 FS 无 Node rm -rf，手动 depth-first 删除）。 */
function rmTree(dir) {
  fs.listDir(dir).forEach((name) => {
    const full = dir + '/' + name;
    const st = fs.getFS().statSync(full);
    if (st.isDirectory()) rmTree(full);
    else fs.remove(full);
  });
  fs.getFS().rmdirSync(dir);
}

function removeSandbox() {
  if (fs.exists(SANDBOX)) rmTree(SANDBOX);
}

/**
 * 执行隔离迁移自检。
 * 返回可读结果；任何校验失败都抛错。无论成功或失败，结束时都删除整个沙箱。
 */
function runMigtestSandbox() {
  // 干净开始：先清掉上一轮可能残留的沙箱。
  removeSandbox();
  fs.ensureDir(SANDBOX);

  // 声明在 try 外，finally 才能回填清理状态。
  let result;
  try {
    // 虚构旧数据（与历史用例一致：跨 2026-09 / 2026-10，覆盖 food/salary/transport）。
    const legacy = [
      { id: 'x1', createdAt: 1760000000000, type: 'expense', amount: 25.5, category: 'food', date: '2026-10-15', note: '午餐' },
      { id: 'x2', createdAt: 1760000001000, type: 'income', amount: 1000, category: 'salary', date: '2026-10-15' },
      { id: 'x3', createdAt: 1760000002000, type: 'expense', amount: 12, category: 'transport', date: '2026-09-30' },
    ];

    // 1. 复用真实转换函数（legacyToBill 内部调用 categories.mapLegacyCategory）。
    const bills = legacy.map(migration.legacyToBill);

    // 期望汇总（金额×100 四舍五入）。
    let expectedIncome = 0;
    let expectedExpense = 0;
    bills.forEach((b) => {
      if (b.type === 'income') expectedIncome += b.amountCents;
      else expectedExpense += b.amountCents;
    });

    // 2. 沙箱内写旧数据备份（对应 runMigration 的 legacyRecordsBackup）。
    fs.writeJSON(SANDBOX_BACKUP, {
      backedUpAt: Date.now(),
      recordCount: legacy.length,
      records: legacy,
    });

    // 3. 按月份分组，在沙箱内写分片（结构与正式月份分片一致：{ ym, version, bills }）。
    const byMonth = {};
    bills.forEach((b) => {
      const ym = ledger.ymOf(b.occurredAt);
      if (!byMonth[ym]) byMonth[ym] = [];
      byMonth[ym].push(b);
    });
    const months = Object.keys(byMonth).sort();
    months.forEach((ym) => {
      fs.writeJSON(sandboxBillFile(ym), { ym, version: ledger.SCHEMA_VERSION, bills: byMonth[ym] });
    });

    // 4. 读回沙箱分片，校验条数与金额。
    let actualCount = 0;
    let actualIncome = 0;
    let actualExpense = 0;
    months.forEach((ym) => {
      const mf = fs.readJSON(sandboxBillFile(ym), { bills: [] });
      (mf.bills || []).forEach((b) => {
        actualCount += 1;
        if (b.type === 'income') actualIncome += b.amountCents;
        else actualExpense += b.amountCents;
      });
    });

    result = {
      recordCount: bills.length,
      actualCount,
      months,
      backupExists: fs.exists(SANDBOX_BACKUP),
      incomeCents: expectedIncome,
      expenseCents: expectedExpense,
      foodCategory: (bills.find((b) => b.id === 'mig-x1') || {}).categoryId,
      sandboxRemoved: false,
    };

    // 5. 断言（收集所有错误，再统一抛出）。
    const errors = [];
    if (actualCount !== bills.length) errors.push('条数不一致：期望 ' + bills.length + '，实际 ' + actualCount);
    if (actualIncome !== expectedIncome) errors.push('收入金额不一致：期望 ' + expectedIncome + '，实际 ' + actualIncome);
    if (actualExpense !== expectedExpense) errors.push('支出金额不一致：期望 ' + expectedExpense + '，实际 ' + actualExpense);
    if (!result.backupExists) errors.push('旧数据备份未生成');
    if (result.foodCategory !== 'c-food') errors.push('旧分类 food 映射错误：实际 ' + result.foodCategory);
    if (months.join(',') !== '2026-09,2026-10') errors.push('迁移月份异常：' + months.join(','));

    if (errors.length) throw new Error('迁移沙箱自检失败：' + errors.join('；'));
    return result;
  } finally {
    // 6. 无论成功或失败（含中途抛错），都尝试删除整个沙箱。
    //    清理单独 try/catch：清理失败只标记、不抛出，避免覆盖 try 块的原始异常。
    try {
      removeSandbox();
      if (result) result.sandboxRemoved = !fs.exists(SANDBOX);
    } catch (cleanupErr) {
      if (result) result.sandboxRemoved = false;
    }
  }
}

module.exports = { runMigtestSandbox, SANDBOX };
