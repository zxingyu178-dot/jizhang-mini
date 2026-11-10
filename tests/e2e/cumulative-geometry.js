// tests/e2e/cumulative-geometry.js — 累计趋势图「铺满整宽」真机几何验证（v1.4.3）
//
// 背景：用户真机截图里「累计消费趋势」只画到卡片约 2/3 宽就断了。
// 根因是 SVG viewBox 固定 100×100（正方形）+ <image mode="aspectFit"> 在 320×180 盒里
// 被等比缩成 180×180 居中。本用例注入当月数据后，直接量「图片元素」与「容器」的真实宽度，
// 断言两者一致，并核验 SVG 的 viewBox 宽高比 = 显示盒宽高比。
//
// 数据安全：只改 `<USER_DATA_PATH>/bills/<当月>.json` 一个文件，跑完原样写回（原本不存在则删掉）。
//
// 运行：node tests/e2e/cumulative-geometry.js
'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { ensureAutomation, sleep } = require('./launcher');

function ymOf(d) {
  return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
}

function buildBills(now) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const bills = [];
  let seq = 0;
  for (let d = 1; d <= 28; d++) {
    for (let k = 0; k < 2; k++) {
      seq += 1;
      bills.push({
        id: 'e2e-geom-' + seq,
        type: 'expense',
        amountCents: 1000 + d * 40 + k * 210,
        categoryId: 'c-food',
        occurredAt: new Date(y, m - 1, d, 9 + k, 0).getTime(),
        title: '',
        merchant: '几何验证商户' + seq,
        note: '',
        source: 'manual',
        sourceTxnId: null,
        importBatchId: null,
        createdAt: new Date(y, m - 1, d, 9 + k, 0).getTime(),
        updatedAt: new Date(y, m - 1, d, 9 + k, 0).getTime(),
        ledgerImpact: 'normal',
      });
    }
  }
  return bills;
}

async function main() {
  const log = (...a) => console.log('[e2e]', ...a);
  const mp = await ensureAutomation(config, log);
  const checks = [];
  const ok = (cond, msg) => { checks.push({ cond, msg }); log((cond ? 'PASS ' : 'FAIL ') + msg); };

  const now = new Date();
  const ym = ymOf(now);
  let backup = null;

  try {
    // ---- 1. 备份当月分片（顺手清掉上一次跑残留的 e2e-geom-* 账单，避免污染累积） ----
    backup = await mp.evaluate((ymArg) => {
      const fsm = wx.getFileSystemManager();
      const p = wx.env.USER_DATA_PATH + '/bills/' + ymArg + '.json';
      let before = null;
      let removed = 0;
      try {
        const raw = String(fsm.readFileSync(p, 'utf8'));
        try {
          const obj = JSON.parse(raw);
          if (obj && Array.isArray(obj.bills)) {
            const keep = obj.bills.filter((b) => !(b && typeof b.id === 'string' && b.id.indexOf('e2e-geom-') === 0));
            removed = obj.bills.length - keep.length;
            obj.bills = keep;
            before = JSON.stringify(obj, null, 2);
          } else {
            before = raw;
          }
        } catch (e) {
          before = raw; // 解析不了就原样保留，绝不乱改用户数据
        }
      } catch (e) {
        before = null;
      }
      return { path: p, before: before, removed: removed };
    }, ym);
    log('当月分片：' + backup.path + '（' + (backup.before ? '已存在，将恢复' : '原本不存在，将删除')
      + '；清理上次残留 ' + backup.removed + ' 笔）');

    // ---- 2. 注入数据 ----
    const bills = buildBills(now);
    const payload = JSON.stringify({ ym: ym, version: 3, bills: bills });
    await mp.evaluate((arg) => {
      const fsm = wx.getFileSystemManager();
      try { fsm.mkdirSync(wx.env.USER_DATA_PATH + '/bills', true); } catch (e) { /* 已存在 */ }
      fsm.writeFileSync(arg.path, arg.payload, 'utf8');
      return true;
    }, { path: backup.path, payload: payload });
    log('已注入 ' + bills.length + ' 笔到 ' + ym);

    // ---- 3. 重启一次首页，让统计重新取数 ----
    await mp.reLaunch('/pages/main/main');
    await sleep(1500);

    // ---- 4. 打开统计 → 启用累计趋势 ----
    let page = await mp.currentPage();
    const tabs = await page.$$('.tabs__item');
    await tabs[0].tap();
    await sleep(900);
    const panel = await page.$('#statisticsPanel');
    if (!panel) throw new Error('找不到 statisticsPanel');
    await panel.callMethod('onToggleModule', {
      currentTarget: { dataset: { id: 'cumulative-trend' } },
      detail: { value: true },
    });
    await sleep(1200);

    const pd = await panel.data();
    ok(pd.cumPoints && pd.cumPoints.length > 0, '累计 points 有数据（' + (pd.cumPoints ? pd.cumPoints.length : 0) + ' 点）');

    // ---- 5. 量真实几何 ----
    await panel.setData({ scrollInto: 'cumCard' });
    await sleep(900);

    const cumEl = await panel.$('cumulative-trend');
    const boxEl = await cumEl.$('.ct');
    const imgEl = await cumEl.$('.ct__img');
    const boxRect = await boxEl.size();
    const imgRect = await imgEl.size();
    log('容器 .ct 尺寸 = ' + JSON.stringify(boxRect));
    log('图片 .ct__img 尺寸 = ' + JSON.stringify(imgRect));

    ok(boxRect && boxRect.width > 100, '容器宽度正常（' + (boxRect && boxRect.width) + 'px）');
    ok(
      Math.abs(imgRect.width - boxRect.width) <= 2,
      '图片宽度 = 容器宽度（差 ' + Math.abs(imgRect.width - boxRect.width).toFixed(1) + 'px，>2px 即两侧留白）'
    );
    ok(
      Math.abs(imgRect.height - boxRect.height) <= 2,
      '图片高度 = 容器高度（差 ' + Math.abs(imgRect.height - boxRect.height).toFixed(1) + 'px）'
    );

    // ---- 6. 核验 SVG viewBox 宽高比 = 显示盒宽高比 ----
    const cd = await cumEl.data();
    ok(typeof cd.uri === 'string' && cd.uri.indexOf('data:image/svg+xml') === 0, 'SVG data-URI 已生成');
    const b64 = cd.uri.replace('data:image/svg+xml;base64,', '');
    const svg = Buffer.from(b64, 'base64').toString('utf8');
    const vb = svg.match(/viewBox="([^"]+)"/);
    ok(!!vb, 'SVG 含 viewBox');
    if (vb) {
      const n = vb[1].trim().split(/\s+/).map(Number);
      const vbRatio = n[2] / n[3];
      const boxRatio = boxRect.width / boxRect.height;
      log('viewBox = ' + n[2] + '×' + n[3] + '（比 ' + vbRatio.toFixed(3) + '）；显示盒比 ' + boxRatio.toFixed(3));
      ok(Math.abs(vbRatio - boxRatio) <= 0.05, 'viewBox 宽高比 = 显示盒宽高比（差 ' + Math.abs(vbRatio - boxRatio).toFixed(3) + '）');
      ok(Math.abs(n[2] - boxRect.width) <= 3, 'viewBox 宽度 = 容器宽度（' + n[2] + ' vs ' + boxRect.width + '）');
    }

    // ---- 7. 截图 ----
    const shot = await mp.screenshot();
    await panel.setData({ scrollInto: '' });
    await sleep(300);

    fs.mkdirSync(config.SHOT_DIR, { recursive: true });
    const buf = Buffer.from(shot, 'base64');
    fs.writeFileSync(path.join(config.SHOT_DIR, 'cumulative-geometry_simulator.png'), buf);
    log('截图已归档：cumulative-geometry_simulator.png (' + buf.length + ' bytes)');

    // ---- 8. 还原模块开关（默认关闭） ----
    await panel.callMethod('onResetModules', {});
    await sleep(600);
  } catch (e) {
    console.error('几何验证异常：', e && e.message ? e.message : e);
    checks.push({ cond: false, msg: '异常：' + (e && e.message) });
  } finally {
    // ---- 9. 恢复原始分片（无论成败都恢复；自动重试 3 次） ----
    if (backup) {
      // 先落一份到本地临时文件，防止连线断开后再也找不回原内容
      try {
        fs.writeFileSync(path.join(require('os').tmpdir(), 'dailyvalue-cumgeom-backup.json'), JSON.stringify(backup));
      } catch (e) { /* 忽略 */ }
      let restored = false;
      for (let i = 0; i < 3 && !restored; i++) {
        try {
          await mp.evaluate((arg) => {
            const fsm = wx.getFileSystemManager();
            if (arg.before === null) {
              try { fsm.unlinkSync(arg.path); } catch (e) { /* 本来就不存在 */ }
            } else {
              fsm.writeFileSync(arg.path, arg.before, 'utf8');
            }
            return true;
          }, backup);
          restored = true;
        } catch (e) {
          log('恢复第 ' + (i + 1) + ' 次失败：' + (e && e.message));
          await sleep(1500);
        }
      }
      log(restored ? '已恢复原始分片' : '⚠ 恢复分片失败，备份已存到系统临时目录 dailyvalue-cumgeom-backup.json');
    }
    try { await mp.disconnect(); } catch (e) { /* 忽略 */ }
  }

  const failed = checks.filter((c) => !c.cond);
  log('几何检查汇总：' + (checks.length - failed.length) + '/' + checks.length + ' 通过');
  process.exit(failed.length ? 1 : 0);
}

main();
