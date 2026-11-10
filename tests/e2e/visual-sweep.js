// tests/e2e/visual-sweep.js — 逐页视觉巡检：注入一份「有代表性的真实数据」后逐页截图
//
// 用途：人工（或视觉模型）逐张看界面有没有截断 / 溢出 / 留白 / 重叠。
// 数据安全：只改当月账单分片，跑完原样写回；顺手清掉上次巡检残留（id 前缀 e2e-sweep-）。
//
// 运行：node tests/e2e/visual-sweep.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const { ensureAutomation, sleep } = require('./launcher');

const OUT_DIR = path.join(config.ARTIFACTS_ROOT, 'visual-sweep', new Date().toISOString().replace(/[:.]/g, '-'));

function ymOf(d) {
  return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
}

/** 造一份有代表性的数据：多分类、含大额、含收入、含日价 */
function buildBills(now) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const cats = ['c-food', 'c-transport', 'c-shopping', 'c-entertainment', 'c-home', 'c-other'];
  const today = now.getDate();
  const bills = [];
  let seq = 0;
  const push = (o) => { seq += 1; bills.push(Object.assign({ id: 'e2e-sweep-' + seq }, o)); };

  for (let d = 1; d <= Math.min(today, 28); d++) {
    for (let k = 0; k < 3; k++) {
      const ts = new Date(y, m - 1, d, 8 + k * 4, 15).getTime();
      push({
        type: 'expense',
        amountCents: 800 + d * 53 + k * 617,
        categoryId: cats[(d + k) % cats.length],
        occurredAt: ts,
        title: '',
        merchant: '商户' + d + '-' + k,
        note: k === 0 ? '早餐' : '',
        source: 'manual',
        sourceTxnId: null,
        importBatchId: null,
        createdAt: ts,
        updatedAt: ts,
        ledgerImpact: 'normal',
      });
    }
  }
  // 大额支出（验证 Hero / 排行榜 / 圆环长数字是否溢出）
  const bigTs = new Date(y, m - 1, Math.min(today, 12), 15, 30).getTime();
  push({
    type: 'expense', amountCents: 123456789, categoryId: 'c-shopping', occurredAt: bigTs,
    title: '', merchant: '大额测试商户', note: '大额', source: 'manual', sourceTxnId: null,
    importBatchId: null, createdAt: bigTs, updatedAt: bigTs, ledgerImpact: 'normal',
  });
  // 收入
  [1, 8].forEach((d, i) => {
    if (d > today) return;
    const ts = new Date(y, m - 1, d, 10, 0).getTime();
    push({
      type: 'income', amountCents: 1200000 + i * 350000, categoryId: 'c-salary', occurredAt: ts,
      title: '', merchant: '', note: '工资', source: 'manual', sourceTxnId: null,
      importBatchId: null, createdAt: ts, updatedAt: ts, ledgerImpact: 'normal',
    });
  });
  // 日价物品（3 件，进入日价 Tab）
  for (let i = 0; i < 3; i++) {
    const ts = new Date(y, m - 1, 3 + i * 4, 9, 0).getTime();
    push({
      type: 'expense', amountCents: 19900 + i * 30000, categoryId: 'c-shopping', occurredAt: ts,
      title: '日价物品' + (i + 1), merchant: '日价商户' + (i + 1), note: '', source: 'manual',
      sourceTxnId: null, importBatchId: null, createdAt: ts, updatedAt: ts,
      ledgerImpact: 'daily-value-only',
      dailyValue: { enabled: true, mode: 'elapsed', startDate: ymOf(new Date(y, m - 1, 3 + i * 4)) + '-' + String(3 + i * 4).padStart(2, '0') },
    });
  }
  return bills;
}

async function shot(mp, name) {
  const b64 = await mp.screenshot();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(path.join(OUT_DIR, name + '.png'), buf);
  console.log('[sweep] 截图 ' + name + ' (' + Math.round(buf.length / 1024) + 'KB)');
  return buf;
}

async function main() {
  const log = (...a) => console.log('[sweep]', ...a);
  const mp = await ensureAutomation(config, log);
  const now = new Date();
  const ym = ymOf(now);
  let backup = null;

  try {
    // 1) 备份 + 清残留
    backup = await mp.evaluate((ymArg) => {
      const fsm = wx.getFileSystemManager();
      const p = wx.env.USER_DATA_PATH + '/bills/' + ymArg + '.json';
      let before = null;
      try {
        const raw = String(fsm.readFileSync(p, 'utf8'));
        try {
          const obj = JSON.parse(raw);
          if (obj && Array.isArray(obj.bills)) {
            obj.bills = obj.bills.filter((b) => !(b && typeof b.id === 'string' && b.id.indexOf('e2e-sweep-') === 0));
            before = JSON.stringify(obj, null, 2);
          } else before = raw;
        } catch (e) { before = raw; }
      } catch (e) { before = null; }
      return { path: p, before: before };
    }, ym);
    fs.writeFileSync(path.join(os.tmpdir(), 'dailyvalue-sweep-backup.json'), JSON.stringify(backup));

    // 2) 注入
    const bills = buildBills(now);
    await mp.evaluate((arg) => {
      const fsm = wx.getFileSystemManager();
      try { fsm.mkdirSync(wx.env.USER_DATA_PATH + '/bills', true); } catch (e) { /* 已存在 */ }
      fsm.writeFileSync(arg.path, JSON.stringify({ ym: arg.ym, version: 3, bills: arg.bills }, null, 2), 'utf8');
      return true;
    }, { path: backup.path, ym: ym, bills: bills });
    log('已注入 ' + bills.length + ' 笔（含大额 1 笔 / 收入 2 笔 / 日价 3 件 / ' + ym + '）');

    // 3) 重启首页
    await mp.reLaunch('/pages/main/main');
    await sleep(1600);

    // 4) 统计 Tab：打开全部月度模块
    const page = await mp.currentPage();
    const tabs = await page.$$('.tabs__item');
    await tabs[0].tap();
    await sleep(900);
    const panel = await page.$('#statisticsPanel');
    const monthly = ['category-share', 'daily-expense-trend', 'cumulative-trend', 'budget-analysis', 'income-expense-compare', 'custom-range'];
    for (const id of monthly) {
      await panel.callMethod('onToggleModule', { currentTarget: { dataset: { id: id } }, detail: { value: true } });
      await sleep(220);
    }
    await sleep(900);
    await shot(mp, '01-stats-monthly-all');

    // 关键：统计页开满模块时 Skyline swiper 很重，切 Tab 容易让 automator 超时。
    // 先关回默认模块，再去截其它页面；单步失败不中断整轮（各自 try/catch）。
    const safe = async (name, fn) => {
      try { await fn(); } catch (e) {
        log('⚠ ' + name + ' 失败：' + (e && e.message));
      }
    };

    await safe('reset-modules', async () => {
      await panel.callMethod('onResetModules', {});
      await sleep(900);
    });

    // 5) 记账 Tab
    await safe('03-accounting', async () => {
      const tabs2 = await page.$$('.tabs__item');
      await tabs2[1].tap();
      await sleep(1600);
      await shot(mp, '03-accounting');
    });

    // 6) 日价 Tab
    await safe('04-daily-value', async () => {
      const tabs3 = await page.$$('.tabs__item');
      await tabs3[2].tap();
      await sleep(1600);
      await shot(mp, '04-daily-value');
      await tabs3[0].tap();
      await sleep(900);
    });

    // 7) 其余页面
    const routes = [
      ['05-settings', '/pages/settings/settings'],
      ['06-category-manage', '/pages/category-manage/category-manage'],
      ['07-recurring', '/pages/recurring/recurring'],
      ['08-budget-settings', '/pages/budget-settings/budget-settings'],
      ['09-backup-restore', '/pages/backup-restore/backup-restore'],
      ['10-appearance', '/pages/appearance/appearance'],
      ['11-search', '/pages/search/search'],
    ];
    for (const [name, url] of routes) {
      await safe(name, async () => {
        await mp.callWxMethod('navigateTo', { url: url });
        await sleep(1800);
        await shot(mp, name);
        await mp.callWxMethod('navigateBack', { delta: 1 });
        await sleep(1000);
      });
    }

    log('完成，截图目录：' + OUT_DIR);
  } catch (e) {
    console.error('[sweep] 异常：', e && e.message ? e.message : e);
    process.exitCode = 1;
  } finally {
    if (backup) {
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        try {
          await mp.evaluate((arg) => {
            const fsm = wx.getFileSystemManager();
            if (arg.before === null) { try { fsm.unlinkSync(arg.path); } catch (e) { /* 不存在 */ } }
            else fsm.writeFileSync(arg.path, arg.before, 'utf8');
            return true;
          }, backup);
          ok = true;
        } catch (e) {
          log('恢复第 ' + (i + 1) + ' 次失败：' + (e && e.message));
          await sleep(1500);
        }
      }
      log(ok ? '已恢复原始分片' : '⚠ 恢复失败，备份在系统临时目录 dailyvalue-sweep-backup.json');
    }
    try { await mp.disconnect(); } catch (e) { /* 忽略 */ }
  }
}

main();
