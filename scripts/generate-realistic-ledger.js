#!/usr/bin/env node
/**
 * scripts/generate-realistic-ledger.js — Realistic Ledger Generator（v1.3.0 Gate I）
 *
 * 生成「模拟用户长期使用」的 Backup V3 标准备份（.dvmini.json）+ 预期统计摘要。
 * 与 tests/perf/large-ledger 的「均匀随机」不同，本生成器按真实记账习惯组织：
 *   固定工资、每月房租、周期话费/会员、高频餐饮、工作日交通、中频购物、
 *   季节性旅游、双11/年末购物峰值、红包/退款收入、混合来源（手动/导入/周期）、
 *   内置 SVG + Emoji + 自定义 + 归档分类、多阶段预算规则、少量日价物品，
 *   并显式覆盖闰年 2-29、月末、跨年、23:59:59.999、周日周期等边界。
 *
 * 固定 seed，同参数输出可完全复现；全部为虚构数据，不读取任何真实账单。
 * 输出目录默认 tests/generated/（已 .gitignore），不提交大 JSON。
 *
 * 用法：
 *   node scripts/generate-realistic-ledger.js --profile typical
 *   node scripts/generate-realistic-ledger.js --count 15000 --years 4 --out realistic-15k
 *   可选：--seed <int>  --anchor yyyy-MM-dd  --out-dir <dir>
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ============================ CLI 参数 ============================ */
function parseArgs(argv) {
  const a = {
    profile: null,
    count: null,
    years: null,
    seed: 20261029,
    anchor: '2026-10-29',
    out: null,
    outDir: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--profile') a.profile = next();
    else if (k === '--count') a.count = Number(next());
    else if (k === '--years') a.years = Number(next());
    else if (k === '--seed') a.seed = Number(next());
    else if (k === '--anchor') a.anchor = next();
    else if (k === '--out') a.out = next();
    else if (k === '--out-dir') a.outDir = next();
  }
  return a;
}

const PROFILES = {
  // name    ：时间跨度 / 目标账单数 / 每月常规密度
  typical: { years: 3, count: 5000, density: 1.0 },
  heavy: { years: 5, count: 20000, density: 1.7 },
  stress: { years: 10, count: 50000, density: 2.1 },
};

/* ============================ 确定性 PRNG ============================ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function Rng(seed) {
  const r = mulberry32(seed);
  return {
    next: r,
    chance: (p) => r() < p,
    randInt: (min, max) => min + Math.floor(r() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    // 按权重选择：items=[{w, v}]
    weighted(items) {
      let total = 0;
      items.forEach((it) => (total += it.w));
      let x = r() * total;
      for (let i = 0; i < items.length; i++) {
        x -= items[i].w;
        if (x <= 0) return items[i].v;
      }
      return items[items.length - 1].v;
    },
  };
}

/* ============================ 日历工具 ============================ */
function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}
function pad2(n) {
  return String(n).padStart(2, '0');
}
function dateStr(y, m, d) {
  return y + '-' + pad2(m) + '-' + pad2(d);
}
function localTs(y, m, d, h, mi, s, ms) {
  return new Date(y, m - 1, d, h || 0, mi || 0, s || 0, ms || 0).getTime();
}
function parseAnchor(s) {
  const p = s.split('-').map(Number);
  return { y: p[0], m: p[1], d: p[2] };
}

/** 生成 startYm → endYm 的月份列表（含两端） */
function monthSpan(sy, sm, ey, em) {
  const out = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push({ y, m, ym: y + '-' + pad2(m) });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/* ============================ 分类构建 ============================ */
/**
 * 在默认 12 分类基础上增加：
 *  - 自定义 Emoji 分类（c-pet 宠物、c-edu 学习）
 *  - 一个归档分类（c-legacy 旧分类，archived=true，早期账单引用）
 * 演示：builtin SVG（多数）、emoji（自定义）、归档（历史软引用）三类同时存在。
 */
function buildCategories() {
  const base = [
    { id: 'c-food', name: '餐饮', emoji: '🍚', iconType: 'builtin', iconValue: 'dining', builtin: true, sort: 1, archived: false },
    { id: 'c-transport', name: '交通', emoji: '🚗', iconType: 'builtin', iconValue: 'transport', builtin: true, sort: 2, archived: false },
    { id: 'c-shopping', name: '购物', emoji: '🛍️', iconType: 'builtin', iconValue: 'shopping', builtin: true, sort: 3, archived: false },
    { id: 'c-fun', name: '娱乐', emoji: '🎮', iconType: 'builtin', iconValue: 'fun', builtin: true, sort: 4, archived: false },
    { id: 'c-life', name: '生活', emoji: '🏠', iconType: 'builtin', iconValue: 'life', builtin: true, sort: 5, archived: false },
    { id: 'c-drink', name: '饮料', emoji: '🥤', iconType: 'builtin', iconValue: 'drink', builtin: false, sort: 6, archived: false },
    { id: 'c-bill', name: '话费', emoji: '📱', iconType: 'builtin', iconValue: 'phone-bill', builtin: false, sort: 7, archived: false },
    { id: 'c-salary', name: '工资', emoji: '💰', iconType: 'builtin', iconValue: 'salary', builtin: false, sort: 8, archived: false },
    { id: 'c-medical', name: '医疗', emoji: '💊', iconType: 'builtin', iconValue: 'medical', builtin: false, sort: 9, archived: false },
    { id: 'c-housing', name: '住房', emoji: '🏢', iconType: 'builtin', iconValue: 'housing', builtin: false, sort: 10, archived: false },
    { id: 'c-travel', name: '旅行', emoji: '✈️', iconType: 'builtin', iconValue: 'travel', builtin: false, sort: 11, archived: false },
    { id: 'c-other', name: '其他', emoji: '📦', iconType: 'builtin', iconValue: 'other', builtin: false, sort: 12, archived: false },
    // 自定义 Emoji 分类（用户自建，保持 emoji 模式）
    { id: 'c-pet', name: '宠物', emoji: '🐶', iconType: 'emoji', iconValue: '🐶', builtin: false, sort: 13, archived: false },
    { id: 'c-edu', name: '学习', emoji: '📚', iconType: 'emoji', iconValue: '📚', builtin: false, sort: 14, archived: false },
    // 归档分类：早期账单引用，之后被归档（历史账单仍可解析）
    { id: 'c-legacy', name: '旧类', emoji: '🗂️', iconType: 'emoji', iconValue: '🗂️', builtin: false, sort: 15, archived: true },
  ];
  return base;
}

/* ============================ 商户 / 文案池 ============================ */
const MERCH = {
  food: ['星巴克', '肯德基', '麦当劳', '海底捞', '老乡鸡', '公司食堂', '便利店', '兰州拉面'],
  drink: ['瑞幸咖啡', '喜茶', '蜜雪冰城', '便利店'],
  transport: ['地铁', '公交', '滴滴出行', '中国石化', '充电站'],
  shopping: ['淘宝', '京东', '沃尔玛', '拼多多', '银泰百货'],
  fun: ['万达影城', '腾讯游戏', 'KTV', 'Steam'],
  life: ['宜家', '物业公司', '干洗店'],
  medical: ['人民医院', '同仁堂药店', '体检中心'],
  other: ['五金店', '文具店'],
};

/* ============================ 生成器主体 ============================ */
function Generator(opts) {
  const rng = Rng(opts.seed);
  const anchor = parseAnchor(opts.anchor);
  const startY = anchor.y - opts.years;
  const months = monthSpan(startY, anchor.m, anchor.y, anchor.m);
  const density = opts.density;

  let seq = 0;
  const bills = [];

  /** 构造一条完整 Bill V3 */
  function bill(type, amountCents, categoryId, y, m, d, h, mi, extra) {
    seq += 1;
    const id = 'rl-' + String(seq).padStart(6, '0');
    const ts = localTs(y, m, d, h, mi, 0, extra && extra.ms != null ? extra.ms : 0);
    const b = {
      id,
      type,
      amountCents,
      categoryId,
      occurredAt: ts,
      title: (extra && extra.title) || '',
      merchant: (extra && extra.merchant) || '',
      note: (extra && extra.note) || '',
      source: (extra && extra.source) || 'manual',
      sourceTxnId: (extra && extra.sourceTxnId) || null,
      importBatchId: (extra && extra.importBatchId) || null,
      createdAt: ts,
      updatedAt: ts,
      ledgerImpact: (extra && extra.ledgerImpact) || 'normal',
    };
    if (extra && extra.dailyValue) b.dailyValue = extra.dailyValue;
    if (extra && extra.recurringRuleId) b.recurringRuleId = extra.recurringRuleId;
    bills.push(b);
    return b;
  }

  // 该月允许的最大日期（anchor 月只到 anchor.d）
  function maxDayOf(mon) {
    const dim = daysInMonth(mon.y, mon.m);
    if (mon.y === anchor.y && mon.m === anchor.m) return Math.min(dim, anchor.d);
    return dim;
  }
  function dayIn(mon, prefer) {
    const max = maxDayOf(mon);
    if (prefer) return Math.min(prefer, max);
    return rng.randInt(1, max);
  }

  const yuan = (n) => n * 100;
  // 随机金额（整数分）
  function amt(minY, maxY) {
    return rng.randInt(yuan(minY), yuan(maxY));
  }

  /* ---- 按月生成 ---- */
  const monthIndex = new Map();
  months.forEach((mon, idx) => monthIndex.set(mon.ym, idx));

  months.forEach((mon, idx) => {
    const isFirstYear = idx < 12;
    const isNov = mon.m === 11;
    const isDec = mon.m === 12;
    const isAnchorMonth = mon.y === anchor.y && mon.m === anchor.m;
    // 旅游季：5 月 / 10 月（黄金周）
    const travelSeason = mon.m === 5 || mon.m === 10;

    // 1) 工资收入（每月 10 日，固定 8500 上下小幅波动）
    const salary = yuan(8500) + rng.randInt(-yuan(3), yuan(8));
    bill('income', salary, 'c-salary', mon.y, mon.m, dayIn(mon, 10), 10, 0, {
      merchant: '公司财务',
      source: 'manual',
    });

    // 2) 房租（每月 1 日，周期规则生成的账单）
    bill('expense', yuan(1800), 'c-housing', mon.y, mon.m, dayIn(mon, 1), 9, 0, {
      merchant: '房东',
      source: 'recurring',
      recurringRuleId: 'rr-rent',
    });

    // 3) 话费（每月 25 日，周期）
    if (rng.chance(0.85)) {
      bill('expense', yuan(rng.randInt(49, 99)), 'c-bill', mon.y, mon.m, dayIn(mon, 25), 8, 30, {
        merchant: '中国移动',
        source: 'recurring',
        recurringRuleId: 'rr-phone',
      });
    }

    // 4) 会员（每月 1 笔，周期；年费月份额外）
    if (rng.chance(0.8)) {
      bill('expense', yuan(rng.randInt(15, 25)), 'c-fun', mon.y, mon.m, dayIn(mon, 5), 12, 0, {
        merchant: '视频会员',
        source: 'recurring',
        recurringRuleId: 'rr-vip',
      });
    }

    // 高频：餐饮（base 22 × density）
    const foodN = Math.round(22 * density);
    for (let i = 0; i < foodN; i++) {
      const d = dayIn(mon);
      // 早/午/晚不同时段
      const slot = rng.weighted([
        { w: 2, v: [rng.randInt(7, 9), rng.randInt(0, 50)] },
        { w: 4, v: [rng.randInt(11, 13), rng.randInt(0, 50)] },
        { w: 4, v: [rng.randInt(17, 20), rng.randInt(0, 50)] },
      ]);
      const merchant = rng.pick(MERCH.food);
      const useImport = rng.chance(0.35);
      bill('expense', amt(8, 55), 'c-food', mon.y, mon.m, d, slot[0], slot[1], useImport
        ? { merchant, source: 'import', sourceTxnId: (rng.chance(0.5) ? 'wechat:' : 'alipay:') + 't' + seq, importBatchId: 'batch-' + mon.ym }
        : { merchant, source: 'manual' });
    }

    // 高频：交通（base 16 × density，工作日）
    const transN = Math.round(16 * density);
    for (let i = 0; i < transN; i++) {
      const d = dayIn(mon);
      const dow = new Date(mon.y, mon.m - 1, d).getDay();
      const rush = dow === 0 || dow === 6 ? rng.randInt(10, 18) : rng.pick([8, 9, 18, 19]);
      const merchant = rng.pick(MERCH.transport);
      const isFuel = merchant === '中国石化' || merchant === '充电站';
      bill('expense', isFuel ? amt(200, 400) : amt(2, 35), 'c-transport', mon.y, mon.m, d, rush, rng.randInt(0, 50), {
        merchant,
        source: rng.chance(0.4) ? 'import' : 'manual',
        sourceTxnId: 'wechat:t' + seq,
        importBatchId: 'batch-' + mon.ym,
      });
    }

    // 饮料（每月 6 × density）
    const drinkN = Math.round(6 * density);
    for (let i = 0; i < drinkN; i++) {
      bill('expense', amt(5, 28), 'c-drink', mon.y, mon.m, dayIn(mon), rng.randInt(10, 21), rng.randInt(0, 50), {
        merchant: rng.pick(MERCH.drink),
        source: rng.chance(0.5) ? 'import' : 'manual',
      });
    }

    // 购物（base 4；双11 激增；年末略增）
    let shopN = Math.round(4 * density);
    if (isNov) shopN += Math.round(14 * density);
    if (isDec) shopN += Math.round(5 * density);
    for (let i = 0; i < shopN; i++) {
      let d = dayIn(mon);
      if (isNov) d = rng.chance(0.6) ? rng.randInt(8, Math.min(12, maxDayOf(mon))) : d;
      const big = isNov && rng.chance(0.3);
      bill('expense', big ? amt(300, 1500) : amt(50, 600), 'c-shopping', mon.y, mon.m, d, rng.randInt(9, 22), rng.randInt(0, 50), {
        merchant: rng.pick(MERCH.shopping),
        source: rng.chance(0.7) ? 'import' : 'manual',
        sourceTxnId: 'alipay:t' + seq,
        importBatchId: 'batch-' + mon.ym,
      });
    }

    // 娱乐（每月 3）
    for (let i = 0; i < Math.round(3 * density); i++) {
      bill('expense', amt(30, 300), 'c-fun', mon.y, mon.m, dayIn(mon), rng.randInt(10, 22), 0, {
        merchant: rng.pick(MERCH.fun),
        source: 'manual',
      });
    }

    // 生活（每月 3）
    for (let i = 0; i < Math.round(3 * density); i++) {
      bill('expense', amt(20, 200), 'c-life', mon.y, mon.m, dayIn(mon), rng.randInt(9, 19), 0, {
        merchant: rng.pick(MERCH.life),
        source: 'manual',
      });
    }

    // 宠物 / 学习（自定义 emoji 分类，少量）
    if (rng.chance(0.5)) {
      bill('expense', amt(30, 200), 'c-pet', mon.y, mon.m, dayIn(mon), rng.randInt(10, 20), 0, { source: 'manual' });
    }
    if (rng.chance(0.4)) {
      bill('expense', amt(20, 150), 'c-edu', mon.y, mon.m, dayIn(mon), rng.randInt(10, 20), 0, { source: 'manual' });
    }

    // 医疗（低频，约每 4 月 1 次）
    if (rng.chance(0.25)) {
      bill('expense', amt(80, 1500), 'c-medical', mon.y, mon.m, dayIn(mon), rng.randInt(8, 16), 0, {
        merchant: rng.pick(MERCH.medical),
        source: 'manual',
      });
    }

    // 旅游（季节月，低频高额）
    if (travelSeason && rng.chance(0.55)) {
      const d = rng.randInt(1, Math.min(7, maxDayOf(mon)));
      bill('expense', amt(2000, 8000), 'c-travel', mon.y, mon.m, d, rng.randInt(7, 12), 0, {
        merchant: '旅行社',
        source: 'manual',
      });
    }

    // 红包收入（节日，少量）
    if ((isNov || isDec || mon.m === 1 || mon.m === 2) && rng.chance(0.5)) {
      bill('income', amt(10, 200), 'c-other', mon.y, mon.m, dayIn(mon), rng.randInt(9, 20), 0, {
        merchant: '红包',
        source: 'manual',
      });
    }

    // 退款（少量收入，import）
    if (rng.chance(0.12)) {
      bill('income', amt(20, 300), 'c-other', mon.y, mon.m, dayIn(mon), rng.randInt(9, 18), 0, {
        merchant: '退款',
        source: 'import',
        sourceTxnId: 'alipay:refund' + seq,
      });
    }

    // 早期账单：前 6 个月有一部分引用归档分类 c-legacy
    if (isFirstYear && idx < 6 && rng.chance(0.5)) {
      bill('expense', amt(15, 120), 'c-legacy', mon.y, mon.m, dayIn(mon), rng.randInt(9, 18), 0, {
        source: 'manual',
      });
    }

    // 日价物品（少量，约每 3 月 1 个，daily-value-only）
    if (rng.chance(0.3)) {
      const d = dayIn(mon);
      const start = dateStr(mon.y, mon.m, d);
      bill('expense', amt(100, 800), 'c-life', mon.y, mon.m, d, rng.randInt(9, 18), 0, {
        title: '日价物品',
        ledgerImpact: 'daily-value-only',
        dailyValue: { enabled: true, mode: 'elapsed', startDate: start },
        source: 'manual',
      });
    }

    /* ---- 边界注入（确定性，不依赖随机命中） ---- */
    const dim = daysInMonth(mon.y, mon.m);
    // 月末：31 日（或该月最后一天）显式一笔
    const lastD = Math.min(dim, maxDayOf(mon));
    if (!isAnchorMonth || anchor.d >= lastD) {
      bill('expense', amt(10, 80), 'c-other', mon.y, mon.m, lastD, 23, 59, {
        ms: 999,
        merchant: '月末账单',
        source: 'manual',
      });
    }
    // 闰年 2-29 显式一笔
    if (mon.m === 2 && isLeap(mon.y) && maxDayOf(mon) >= 29) {
      bill('expense', amt(10, 60), 'c-food', mon.y, mon.m, 29, 12, 0, {
        merchant: '闰日餐饮',
        source: 'manual',
      });
    }
  });

  /* ---- 精确数量控制：用高频餐饮填充到目标 count ---- */
  let guard = 0;
  while (bills.length < opts.count && guard < opts.count + 10) {
    guard += 1;
    const mon = rng.pick(months);
    if (mon.y === anchor.y && mon.m === anchor.m) continue;
    const d = rng.randInt(1, maxDayOf(mon));
    bill('expense', amt(8, 45), 'c-food', mon.y, mon.m, d, rng.randInt(11, 20), rng.randInt(0, 50), {
      merchant: rng.pick(MERCH.food),
      source: 'manual',
    });
  }

  // 按 occurredAt 倒序（与 ledger 写入排序一致，便于核对）
  bills.sort((a, b) => b.occurredAt - a.occurredAt || (a.id < b.id ? 1 : -1));

  return { bills, months, anchor, rng: rng };
}

/* ============================ 周期规则（写入备份） ============================ */
function buildRecurringRules(anchor) {
  // 周日周期：rr-sunday 用 weekly + day=0（覆盖周日周期边界）
  return [
    {
      id: 'rr-rent', enabled: true, type: 'expense', amountCents: 180000, categoryId: 'c-housing',
      note: '房租', frequency: 'monthly', interval: 1, day: 1, startDate: '2020-01-01', time: '09:00', createdAt: 1,
    },
    {
      id: 'rr-phone', enabled: true, type: 'expense', amountCents: 6900, categoryId: 'c-bill',
      note: '话费', frequency: 'monthly', interval: 1, day: 25, startDate: '2020-01-01', time: '08:30', createdAt: 1,
    },
    {
      id: 'rr-vip', enabled: true, type: 'expense', amountCents: 2000, categoryId: 'c-fun',
      note: '会员', frequency: 'monthly', interval: 1, day: 5, startDate: '2020-01-01', time: '12:00', createdAt: 1,
    },
    {
      id: 'rr-sunday', enabled: true, type: 'expense', amountCents: 1500, categoryId: 'c-life',
      note: '周日保洁', frequency: 'weekly', interval: 1, day: 0, startDate: '2020-01-05', time: '10:00', createdAt: 1,
    },
  ];
}

/* ============================ 预算规则（多阶段） ============================ */
function buildBudget(startY) {
  // 历史中修改过几次：启用 → 调整 → 关闭 → 重新启用
  const rules = [
    { id: 'b-1', enabled: true, dailyCents: 12000, effectiveFrom: startY + '-01-01', createdAt: 1 },
    { id: 'b-2', enabled: true, dailyCents: 15000, effectiveFrom: (startY + 1) + '-06-01', createdAt: 2 },
    { id: 'b-3', enabled: false, dailyCents: 15000, effectiveFrom: (startY + 2) + '-03-01', createdAt: 3 },
    { id: 'b-4', enabled: true, dailyCents: 18000, effectiveFrom: (startY + 2) + '-09-01', createdAt: 4 },
  ];
  return { version: 1, weekStartsOn: 1, rules };
}

/* ============================ 预期统计摘要 ============================ */
function buildExpected(bills, anchor, categories) {
  // 分类映射：搜索关键字会命中分类名 / 分类 id（与 data/search/filters.matchKeyword 同口径）。
  const catMap = {};
  (categories || []).forEach((c) => { catMap[c.id] = c; });
  // 复刻 money.formatCents（金额是可搜索字段；中文关键字不会命中，保持口径完整）。
  function formatCentsText(cents) {
    const abs = Math.abs(cents || 0);
    const yuan = Math.floor(abs / 100);
    const frac = abs % 100;
    const ys = String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return ys + '.' + (frac < 10 ? '0' : '') + frac;
  }
  const summary = {
    totalBills: bills.length,
    normalBills: 0,
    dailyValueOnlyBills: 0,
    totalExpenseCents: 0,
    totalIncomeCents: 0,
    expenseByYear: {},
    expenseByMonth: {},
    expenseByCategory: {},
    countByCategory: {},
    dayExpense: {},
    largestExpense: null,
    searchCases: [],
  };
  let largest = null;
  bills.forEach((b) => {
    const d = new Date(b.occurredAt);
    const ym = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
    const dkey = dateStr(d.getFullYear(), d.getMonth() + 1, d.getDate());

    if (b.ledgerImpact === 'daily-value-only') {
      summary.dailyValueOnlyBills += 1;
      return;
    }
    summary.normalBills += 1;

    if (b.type === 'income') {
      summary.totalIncomeCents += b.amountCents;
    } else {
      summary.totalExpenseCents += b.amountCents;
      summary.expenseByYear[d.getFullYear()] = (summary.expenseByYear[d.getFullYear()] || 0) + b.amountCents;
      summary.expenseByMonth[ym] = (summary.expenseByMonth[ym] || 0) + b.amountCents;
      summary.expenseByCategory[b.categoryId] = (summary.expenseByCategory[b.categoryId] || 0) + b.amountCents;
      summary.countByCategory[b.categoryId] = (summary.countByCategory[b.categoryId] || 0) + 1;
      summary.dayExpense[dkey] = (summary.dayExpense[dkey] || 0) + b.amountCents;
      if (!largest || b.amountCents > largest.amountCents) {
        largest = { id: b.id, amountCents: b.amountCents, date: dkey };
      }
    }
  });
  summary.largestExpense = largest;
  summary.balanceCents = summary.totalIncomeCents - summary.totalExpenseCents;

  // 最高消费日（按全天支出合计）
  let topDay = null;
  Object.keys(summary.dayExpense).forEach((k) => {
    if (!topDay || summary.dayExpense[k] > topDay.amountCents ||
      (summary.dayExpense[k] === topDay.amountCents && k < topDay.date)) {
      topDay = { date: k, amountCents: summary.dayExpense[k] };
    }
  });
  summary.topExpenseDay = topDay;

  // 搜索用例（与 data/search matchKeyword 同口径：商户/名称/备注/分类名/分类id/金额，小写匹配）
  const countKeyword = (kw, type) => {
    const key = String(kw).toLowerCase();
    return bills.filter((b) => {
      if (b.ledgerImpact === 'daily-value-only') return false;
      if (type && b.type !== type) return false;
      const cat = catMap[b.categoryId];
      const fields = [
        b.merchant || '',
        b.title || '',
        b.note || '',
        cat ? cat.name : '',
        cat ? cat.id : '',
        formatCentsText(b.amountCents),
      ];
      return fields.some((f) => String(f).toLowerCase().indexOf(key) >= 0);
    }).length;
  };
  summary.searchCases = [
    { keyword: '咖啡', type: 'expense', expected: countKeyword('咖啡', 'expense') },
    { keyword: '红包', type: 'income', expected: countKeyword('红包', 'income') },
    { keyword: '退款', type: 'income', expected: countKeyword('退款', 'income') },
    { keyword: '工资', type: 'income', expected: countKeyword('工资', 'income') },
  ];
  return summary;
}

/* ============================ 主流程 ============================ */
function main() {
  const args = parseArgs(process.argv);
  let profile = args.profile ? PROFILES[args.profile] : null;
  if (!profile && args.profile) {
    console.error('未知 profile：' + args.profile + '（可选 typical/heavy/stress）');
    process.exit(1);
  }
  const years = args.years || (profile ? profile.years : 3);
  const count = args.count || (profile ? profile.count : 5000);
  const density = profile ? profile.density : 1.0;
  const anchor = parseAnchor(args.anchor);

  const genOpts = { years, count, density, seed: args.seed, anchor: args.anchor };
  const result = Generator(genOpts);
  const categories = buildCategories();
  const recurringRules = buildRecurringRules(anchor);
  const budget = buildBudget(anchor.y - years);
  const expected = buildExpected(result.bills, anchor, categories);

  const backup = {
    format: 'daily-value-mini-backup',
    schemaVersion: 3,
    appVersion: '1.3.0',
    // 固定为 anchor 当天中午，保证同参数整份备份字节级可复现。
    exportedAt: new Date(anchor.y, anchor.m - 1, anchor.d, 12, 0, 0, 0).toISOString(),
    data: {
      bills: result.bills,
      categories,
      settings: { currency: '¥', theme: 'dark', budget, statistics: { version: 1, modules: [] } },
      recurringRules,
    },
  };

  const outDir = args.outDir || path.join(__dirname, '..', 'tests', 'generated');
  fs.mkdirSync(outDir, { recursive: true });
  const baseName = args.out || (args.profile ? 'realistic-' + args.profile : 'realistic-' + count);
  const backupPath = path.join(outDir, baseName + '.dvmini.json');
  const expectedPath = path.join(outDir, baseName + '.expected.json');
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  fs.writeFileSync(expectedPath, JSON.stringify(expected, null, 2));

  console.log('已生成（seed=' + args.seed + '，anchor=' + args.anchor + '）');
  console.log('  备份：' + backupPath);
  console.log('  摘要：' + expectedPath);
  console.log('  账单总数=' + result.bills.length + '（目标 ' + count + '）');
  console.log('  普通=' + expected.normalBills + ' 日价only=' + expected.dailyValueOnlyBills);
  console.log('  支出=' + (expected.totalExpenseCents / 100) + ' 收入=' + (expected.totalIncomeCents / 100));
  console.log('  最大单笔=' + (expected.largestExpense ? expected.largestExpense.amountCents / 100 : '—') +
    ' 最高消费日=' + (expected.topExpenseDay ? expected.topExpenseDay.date : '—'));
}

if (require.main === module) {
  main();
}
module.exports = {
  Generator,
  buildCategories,
  buildExpected,
  buildRecurringRules,
  buildBudget,
  PROFILES,
  monthSpan,
  isLeap,
  daysInMonth,
};
