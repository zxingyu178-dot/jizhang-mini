// components/statistics-panel/statistics-panel.js
// 统计 Panel V1（v0.3.0）：月度 / 年度切换，纯 WXSS 柱图 / 条形图。
// 计算全部走 data/statistics 纯函数，页面只负责取数与展示；不引图表库。
const store = require('../../data/index');
const money = require('../../data/money');
const util = require('../../utils/util');
const M = require('../../data/statistics/month');
const Y = require('../../data/statistics/year');
const R = require('../../data/statistics/range');
const dateUtil = require('../../data/date');
const statCfg = require('../../data/statistics/config');
const donut = require('../../data/statistics/donut');
const axis = require('../../data/statistics/axis');
const insight = require('../../data/statistics/insight');
const theme = require('../../utils/theme');
const device = require('../../utils/device');
const viewport = require('../../utils/viewport');
const barShading = require('../../utils/bar-shading');
const { b64encodeAscii } = require('../../utils/b64');
const { pickCategoryVisual } = require('../../data/category-icons');

/** 模块 ID → 中文展示名（管理 Bottom Sheet 用） */
const MODULE_LABELS = {
  'category-share': '分类占比',
  'daily-expense-trend': '每日花费趋势',
  'cumulative-trend': '累计消费趋势',
  'budget-analysis': '预算分析',
  'income-expense-compare': '收入 / 支出对比',
  'custom-range': '自定义日期统计',
  'year-monthly-trend': '12 个月支出趋势',
  'year-review': '年度回顾',
};

function currentYM() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function shiftYM(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
/** 'YYYY-MM-DD' → 当日起始/结束时间戳（v1.1.1 起复用 data/date，结束含 999ms） */
function dayStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return dateUtil.startOfLocalDay(y, m, d);
}
function dayEnd(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return dateUtil.endOfLocalDay(y, m, d);
}
/** 'YYYY-MM' → 该月最后一天 'YYYY-MM-DD'（处理闰年 / 大小月） */
function lastDateOfYM(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return ym + '-' + String(last).padStart(2, '0');
}

// 柱区可用高度（rpx）：容器高 - 标签高 - 少量顶部间隙。固定值，避免 height:% 解析问题。
var BAR_ZONE_DAILY_RPX = 180; // 220(容器) - 34(标签) - 6(间隙)
var BAR_ZONE_MONTH_RPX = 200; // 240(容器) - 34(标签) - 6(间隙)
function withBarHeight(points, zoneRpx) {
  return points.map((p) => Object.assign({}, p, {
    barHeightRpx: Math.round((p.percent / 100) * zoneRpx),
  }));
}

/* ---------- 柱体明暗台阶（v1.5.3） ----------
   柱子从 31 个 view 改成「每张图 1 个 <image>」，图源是 bar-shading 生成的 SVG。
   为什么不是 Canvas：Canvas 2D 版实测在本页画不出任何像素（节点尺寸正常、柱区全空），
   而累计折线 / 分类圆环用的 SVG data-URI 在同一张卡片里渲染正常，所以走同一条路。
   好处：明暗台阶是 SVG 矩形（硬边），且随 setData 自动更新，不需要重绘调度。 */

/** 矮柱的点击兜底高度（px）：1px 高的柱子在旧 DOM 下也点不到，这里给 8px 不让它变成死区 */
const BAR_TAP_MIN_PX = 8;

/** 当前主题下柱体的 6 档实色（SVG 读不到 CSS 变量，必须由 JS 按主题取主色再混色） */
function barPalette(themeKey) {
  let primary = themeKey === 'light' ? '#6e78f5' : '#7c86ff';
  try {
    primary = theme.getAccentPalette().primary || primary;
  } catch (e) {
    /* 主题未初始化：用默认靛蓝，不抛 */
  }
  return barShading.paletteFor(primary, themeKey);
}

/** 顶部圆角 px（8rpx）：按窗口宽度换算，与 WXSS 的 rpx 同口径 */
function barRadiusPx() {
  let winW = 375;
  try {
    const info = device.measure();
    winW = info && info.windowWidth ? info.windowWidth : 375;
  } catch (e) {
    winW = 375;
  }
  return (8 * winW) / 750;
}

/* ---------- 坐标轴（v1.4.4）：Y 轴 3 档金额刻度 + X 标签按宽度抽稀 ---------- */

/** 刻度字号（px）：窄屏 10px，其余 11px；与 cumulative-trend 同口径，不用 rpx（窄屏会被缩到 9px 以下） */
var AXIS_FONT_NARROW = 10;
var AXIS_FONT_NORMAL = 11;
/** 字号下限：标签实在放不下时可以缩到 10px，但不许再小（再小就是「看不清」） */
var AXIS_FONT_MIN = 10;
/** 图表卡内容区宽度（rpx）= 750 - .sta 左右 padding(28×2) - .chart 左右 padding(28×2) */
var CHART_CONTENT_RPX = 638;
/** Y 轴刻度文字宽度（px），按文字实际长度算，不写死 */
function axisFontPx(isNarrow) {
  return isNarrow ? AXIS_FONT_NARROW : AXIS_FONT_NORMAL;
}
/** 图表卡内容区宽度（px）：按窗口宽度换算，取不到窗口信息时按 375 兜底 */
function chartContentPx(winW) {
  const w = Number.isFinite(winW) && winW > 0 ? winW : 375;
  return Math.round(CHART_CONTENT_RPX * (w / 750) * 100) / 100;
}

/** 某张图「只看刻度文字」所需的 Y 轴留白（px）：与 buildBarChart / cumulative 同口径 */
function gutterOfChart(maxCents, fontPx) {
  const ticks = axis.buildTicks(maxCents, 3, { prefix: '¥' });
  const topLabel = ticks.length ? ticks[ticks.length - 1].label : '0';
  return axis.axisGutterPx(topLabel, fontPx);
}
/** 同一列里多张图共用同一个 Y 轴留白（终检⑥：左边界也要对齐，不能各算各的） */
function sharedGutterPx(opt, maxList) {
  const fontPx = Number(opt && opt.fontPx) > 0 ? Number(opt.fontPx) : AXIS_FONT_NORMAL;
  let g = 0;
  (maxList || []).forEach((m) => {
    const v = gutterOfChart(m, fontPx);
    if (v > g) g = v;
  });
  return g;
}

/**
 * 柱状图坐标轴：算出 Y 轴 nice 刻度、留白列宽，并按可用宽度重写每个点的 showLabel。
 *
 * v1.4.4 终检改动（三条，都影响「读不读得出数」）：
 *   1) **刻度取整（nice ticks）**：顶档 = 向上取整到 1/1.5/2/2.5/3/4/5/6/8 ×10ⁿ（≥ 实际最大值），
 *      中档 = 顶档 / 2。原来顶档直接等于 max（¥127 / ¥5999），要在 63 和 127 之间心算。
 *   2) **柱高比例尺跟着 niceMax 走**：柱高 = 值 / niceMax × 柱区高。最高柱不再顶到顶线
 *      （顶线是「够用且好读」的上界）——这是正确的，柱子与刻度必须同一比例尺。
 *   3) **12 个月标签绝不允许抽稀**（opt.requireAll）：宽度不够先缩格式（'1月'→'1'），
 *      再缩字号（下限 10px）。用户要靠 12 个标签找「哪个月没数据」。
 *
 * @param {Array} points 点数组（不修改入参）
 * @param {(p:Object)=>number} valueOf 取该点的金额（分）
 * @param {number} zoneRpx 柱区高度（rpx）
 * @param {number} maxXCount X 轴标签业务上限（每日图 7 个 / 月份图 12 个）
 * @param {{fontPx:number, contentPx:number, requireAll?:boolean, shortLabels?:boolean}} opt
 * @returns {{points:Array, axis:{gutterPx:number, fontPx:number, zoneRpx:number, ticks:Array, maxCents:number}}}
 */
function buildBarChart(points, valueOf, zoneRpx, maxXCount, opt) {
  const o = opt || {};
  let fontPx = Number(o.fontPx) > 0 ? Number(o.fontPx) : AXIS_FONT_NORMAL;
  const contentPx = Number(o.contentPx) > 0 ? Number(o.contentPx) : chartContentPx(375);
  const list = (points || []).map((p) => Object.assign({}, p));
  let maxVal = 0;
  list.forEach((p) => {
    const v = Number(valueOf(p));
    if (Number.isFinite(v) && v > maxVal) maxVal = v;
  });

  // ① nice 刻度：顶档 = 向上取整档位，中档 = 顶档 / 2
  const ticks = axis.buildTicks(maxVal, 3, { prefix: '¥' });
  const maxCents = ticks.length ? ticks[ticks.length - 1].cents : 0;

  // ② 柱高按 niceMax 归一（与刻度同一比例尺，绝不越过顶线）
  list.forEach((p) => {
    const v = Number(valueOf(p));
    const ratio = maxCents > 0 && Number.isFinite(v) ? Math.min(1, v / maxCents) : 0;
    p.barHeightRpx = Math.round(ratio * zoneRpx);
  });

  // ③ 窄屏优先缩「格式」而不是缩「字号」：'1日' → '1'
  if (o.shortLabels) list.forEach((p) => { p.label = axis.shortAxisLabel(p.label); });

  let topLabel = ticks.length ? ticks[ticks.length - 1].label : '0';
  // 统一内边距（终检⑥）：同一列里的图共用同一个留白宽度，左右边界才对得齐
  const forced = Number(o.gutterPx);
  let gutterPx = Number.isFinite(forced) && forced > 0
    ? Math.min(56, Math.max(22, Math.round(forced)))
    : axis.axisGutterPx(topLabel, fontPx);
  let plotW = Math.max(40, contentPx - gutterPx);

  const labelW = (fs) => {
    let w = 0;
    list.forEach((p) => {
      const t = axis.textWidthPx(p.label, fs);
      if (t > w) w = t;
    });
    return w;
  };

  if (o.requireAll && list.length) {
    // 标签必须全在：先缩格式，再缩字号（下限 AXIS_FONT_MIN），绝不抽稀
    const colW = plotW / list.length;
    if (labelW(fontPx) > colW - 1) {
      list.forEach((p) => { p.label = axis.shortAxisLabel(p.label); });
    }
    const need = labelW(fontPx);
    const colW2 = plotW / list.length;
    if (need > colW2 - 1 && need > 0) {
      const fit = Math.floor((fontPx * (colW2 - 1)) / need);
      fontPx = Math.max(AXIS_FONT_MIN, Math.min(fontPx, fit));
      topLabel = ticks.length ? ticks[ticks.length - 1].label : '0';
      gutterPx = Number.isFinite(forced) && forced > 0
        ? Math.min(56, Math.max(22, Math.round(forced)))
        : axis.axisGutterPx(topLabel, fontPx);
      plotW = Math.max(40, contentPx - gutterPx);
    }
    list.forEach((p) => { p.showLabel = true; });
  } else {
    const idxs = axis.pickXLabels(list, maxXCount, plotW, fontPx * 0.58);
    const shown = {};
    idxs.forEach((i) => { shown[i] = true; });
    // 覆写 showLabel：原逻辑按固定步长抽稀（窄屏会叠字），改为按实际可用宽度算
    list.forEach((p, i) => { p.showLabel = !!shown[i]; });
  }

  return {
    points: list,
    axis: {
      gutterPx,
      fontPx,
      zoneRpx,
      maxCents,
      ticks: ticks.map((t) => ({
        key: t.key,
        label: t.label,
        bottomRpx: Math.round(t.ratio * zoneRpx),
        showGrid: !!t.showGrid,
      })),
    },
  };
}

/**
 * 某月「1 日 ~ lastDay」的支出累计（分）。
 * 口径与 computeMonthOverview 的「支出」一致：ledgerImpact !== 'daily-value-only' 且非收入；
 * 只累加到 lastDay（防御未来日期的账单把「本月累计」虚增）。
 * @param {Array} bills 该月账单
 * @param {number} lastDay 累计到的日（1~31）；非法 → 0
 * @returns {number}
 */
function sumExpenseThroughDay(bills, lastDay) {
  const cap = Math.round(Number(lastDay));
  if (!Number.isFinite(cap) || cap < 1) return 0;
  let sum = 0;
  (bills || []).forEach((b) => {
    if (!b) return;
    if (b.ledgerImpact === 'daily-value-only') return;
    if (b.type === 'income') return;
    const d = new Date(b.occurredAt).getDate();
    if (d >= 1 && d <= cap) sum += b.amountCents;
  });
  return sum;
}

/**
 * 结论行文案 → wxml 渲染分段（每段一个原子的 <text>，段内 nowrap）。
 * 只在空格处切，所以渲染层只能在段间换行，金额永远整段落在同一行。
 * @param {string} text
 * @returns {Array<{k:number, t:string}>}
 */
function toInsightSegs(text) {
  return insight.splitInsightSegments(text).map((t, i) => ({ k: i, t: t }));
}

/** 结论行字段 → 分段字段（一一对应；patch 里出现哪个就同步哪个） */
const INSIGHT_SEG_KEYS = {
  categoryInsight: 'categoryInsightSegs',
  dailyInsight: 'dailyInsightSegs',
  cumInsight: 'cumInsightSegs',
  monthlyInsight: 'monthlyInsightSegs',
};

/**
 * 给 patch 补上结论行的渲染分段。空串 → []（与 wx:if 判空口径一致）。
 * @param {Object} patch
 * @returns {Object} 同一个 patch（原地补齐，调用方直接交给 setData）
 */
function withInsightSegs(patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  Object.keys(INSIGHT_SEG_KEYS).forEach((textKey) => {
    if (!Object.prototype.hasOwnProperty.call(p, textKey)) return;
    p[INSIGHT_SEG_KEYS[textKey]] = toInsightSegs(p[textKey]);
  });
  return p;
}

/** 账单 → 分类明细列表项（点击支出排行时弹；只含该分类支出，收入不混入） */
function toCatItems(bills, catId) {
  return M.listCategoryExpenseBills(bills, catId).map((b) => {
    const d = new Date(b.occurredAt);
    return {
      id: b.id,
      date: d.getMonth() + 1 + '月' + d.getDate() + '日',
      amountText: '-' + money.formatCents(b.amountCents),
      isExpense: true,
      note: b.note || b.merchant || '',
    };
  });
}

Component({
  data: {
    mode: 'month', // month | year
    // 窄屏标记（v1.4.3）：Skyline 下 WXSS 宽度断点不生效，改由 JS 判定挂 class
    // （≤360px 给 .hero__foot--three 加 --narrow，收字号 + 提升中间列弹性）
    isNarrow: false,
    // 月度
    ym: '',
    monthLabel: '',
    canNextMonth: false,
    mExpense: '0.00',
    mIncome: '0.00',
    mBalance: '0.00',
    // Hero V2 摘要（v1.3.0）：记录数 / 最高消费日 / 日均支出
    mCount: 0,
    mTopDay: '—',
    mTopDayAmount: '—',
    mDailyAvg: '—',
    // 同期环比（v1.4.6）：Hero「本月支出」右侧一句话；空串 = 不渲染（Hero 保持原样）
    momText: '',
    momDir: '', // 'up' | 'down' | ''（持平 / 上月同期无支出时为空，只决定 class，不决定颜色）
    // 月度最大单笔（独立卡，点击打开账单编辑）
    mLargest: null,
    mLargestId: '',
    // 分类占比（category-donut + 列表；列表点击钻取 Bill Explorer）
    shareSegments: [],
    shareList: [],
    shareAggregated: false,
    shareExpanded: false,
    fullShareList: [],
    shareSelectedId: '', // 圆环 / 图例选中的分类 id（聚合为 AGGREGATE id）
    shareAggCount: 0, // 聚合「其他」包含的真实分类数
    categoryInsight: '', // 分类占比结论行（B-2：一句话总结，空串 = 不显示）
    categoryInsightSegs: [], // 同上按空格切段（wxml 逐段 nowrap 渲染，段间才允许换行）
    daily: [],
    dailyAxis: null, // 每日花费趋势的 Y 轴刻度（buildBarAxis 产出）
    dailyBarUri: '', // 柱体图源（6 档明暗台阶 SVG 的 data-URI，每张图 1 个 <image>）
    dailyEmpty: false, // 整月无支出（显示空态文案，不画空图）
    dailyInsight: '', // 每日花费趋势结论行
    dailyInsightSegs: [],
    // 累计消费趋势（cumulative-trend，默认关闭）
    cumPoints: [],
    cumMax: 0,
    cumEmpty: false, // 整月无支出（同上）
    cumGutter: 0, // 与日柱图共用的 Y 轴留白（px，0 = 组件自适应）
    cumMonth: 0, // 1-12：X 轴日期标签用（M/DD）
    cumInsight: '', // 累计消费趋势结论行（当月含月末预测）
    cumInsightSegs: [],
    rank: [],
    cmp: { income: '0.00', expense: '0.00', incomeBar: 0, expenseBar: 0 },
    // 预算日历 + 节奏摘要（无任何预算规则时显示轻空态）
    budgetCalendar: null,
    budgetEmpty: false,
    pace: [],
    // 年度
    year: 0,
    canNextYear: false,
    yExpense: '0.00',
    yIncome: '0.00',
    yBalance: '0.00',
    yCount: 0,
    yAvg: '0.00',
    highest: '',
    lowest: '',
    monthly: [],
    monthlyAxis: null, // 12 个月趋势的 Y 轴刻度
    monthlyBarUri: '', // 柱体图源（同上）
    monthlyInsight: '', // 12 个月趋势结论行
    monthlyInsightSegs: [],
    yearRank: [],
    // 全年分类占比（复用 category-donut，使用完整年度分类列表）
    yearShareSegments: [],
    yearShareList: [],
    yearShareAggregated: false,
    yearShareExpanded: false,
    yearFullShareList: [],
    yearShareSelectedId: '',
    yearShareAggCount: 0,
    // 自定义日期统计（月度区域）
    crStart: '',
    crEnd: '',
    crMaxStart: '2099-12-31',
    crMaxEnd: '2099-12-31',
    crStats: null, // {expense, income, balance, count}
    crInvalid: false, // 开始晚于结束
    // 年度回顾再补三项（Gate 5）
    yrLargest: null, // {dateLabel, title, amountText}
    yrLargestId: '',
    yrTopCat: null, // {name, emoji, count}
    yrTopMonth: null, // {label, count}
    // 模块定制（Gate 3）
    showManage: false,
    enabledModules: [], // 当前启用模块 ID
    modMap: {}, // 模块 ID → 是否启用（WXML 条件用）
    moduleRows: [], // 管理弹层行 {id,label,checked,scope}
    scrollInto: '', // 临时滚动定位（GUI 验证用）
  },
  lifetimes: {
    attached() {
      // 不在此加载：组件位于 swiper-item 中，未激活时其布局尺寸未就绪，
      // 此时取数会让柱状图首次渲染异常。等 main 在该 item 首次激活时调用 activate()。
      // 但要订阅主题：切主题后圆环明度由 category-donut 自更新，而本面板的
      // shareList / fullShareList（年度同理）的颜色需重新取色，否则会停留在旧主题。
      this._offTheme = theme.subscribe(() => {
        // 未激活时不提前取数（保持「激活才加载」的设计）；首次 activate 会用当前主题取色。
        // 只做局部颜色刷新：不重读账本、不重置选中 / 展开态，避免打断用户当前操作。
        if (this._activated) this.recolorForTheme();
      });

      // 窄屏判定（v1.4.3）：Skyline 下 WXSS 宽度断点不生效，改由 JS 读窗口宽度挂 class。
      // 放 attached 而不放 ready：attached 在组件首次布局（ready）之前执行，此时 setData
      // 会随首帧一起渲染，不会出现「先按宽屏画一帧再跳成窄屏」；且 Hero 数值要等
      // activate() 的 220ms 延时取数后才有值，首帧本就是占位符，无可见跳变。
      this.setData({ isNarrow: device.isNarrowScreen() });
      // 窗口变化（安卓分屏、平板旋转/变宽、大字体无障碍缩放后的宽度变化）：
      // 复用 utils/viewport 已有的全局 wx.onWindowResize → device.reset() → onRecover 链路，
      // 不新增监听器；仅当跨过 360 阈值时才 setData（键盘收起等无关事件不产生多余渲染）。
      this._offViewport = viewport.onRecover(() => {
        const next = device.isNarrowScreen();
        if (next !== this.data.isNarrow) {
          this.setData({ isNarrow: next });
          // 刻度字号与 X 轴标签密度跟着宽度变（只重算坐标轴，不重读账本）
          this.rebuildAxis(next);
        }
      });
    },
    detached() {
      if (this._offTheme) { this._offTheme(); this._offTheme = null; }
      if (this._offViewport) { this._offViewport(); this._offViewport = null; }
    },
  },
  methods: {
    /** 由 main 在 swiper-item 首次激活时调用；仅首次执行初始取数 */
    activate() {
      if (this._activated) return;
      this._activated = true;
      // 等 swiper 切换动画结束、布局稳定后再取数，确保图表能正常渲染
      setTimeout(() => {
        if (this.data.mode === 'year') this.loadYear(this.data.year || new Date().getFullYear());
        else this.loadMonth(this.data.ym || currentYM());
      }, 220);
    },
    refresh() {
      // 与 activate 一致地兜底：组件可能尚未激活（data.ym 仍为空串），
      // 直接 loadMonth('') 会解析出 NaN 年月，需回退到当前月 / 当前年。
      if (this.data.mode === 'year') this.loadYear(this.data.year || new Date().getFullYear());
      else this.loadMonth(this.data.ym || currentYM());
    },
    /** 坐标轴尺寸参数（刻度字号随窄屏变、绘图区宽度随窗口宽度变） */
    axisOpt(narrow) {
      let winW = 375;
      try {
        const info = device.measure();
        winW = info && info.windowWidth ? info.windowWidth : 375;
      } catch (e) {
        winW = 375; // 取不到窗口信息：按 375 兜底，只影响 X 标签抽稀精度，不影响数值正确性
      }
      const isNarrow = narrow == null ? this.data.isNarrow : !!narrow;
      return {
        fontPx: axisFontPx(isNarrow),
        contentPx: chartContentPx(winW),
        // 窄屏优先缩标签格式（'1日' → '1'），不靠缩字号省宽度
        shortLabels: isNarrow,
      };
    },
    /** 窗口宽度变化（旋转 / 分屏）后只重算坐标轴：不重读账本、不重算统计 */
    rebuildAxis(narrow) {
      const opt = this.axisOpt(narrow);
      const patch = {};
      // 统一留白（终检⑥）：用缓存的两张图最大值重算，保证左右边界继续对齐
      const sharedGutter = sharedGutterPx(opt, [
        (this.data.daily || []).reduce((m, p) => Math.max(m, Number(p.cents) || 0), 0),
        Number(this.data.cumMax) || 0,
      ]);
      if (this.data.daily && this.data.daily.length) {
        const bc = buildBarChart(this.data.daily, (p) => p.cents, BAR_ZONE_DAILY_RPX, 7,
          Object.assign({}, opt, { gutterPx: sharedGutter }));
        patch.daily = bc.points;
        patch.dailyAxis = bc.axis;
        // 宽度变了 → 柱区 px 尺寸变了 → 图源必须按新显示盒重算（柱高比例不变）
        patch.dailyBarUri = this.barUri(bc.points, bc.axis, opt);
      }
      patch.cumGutter = sharedGutter;
      if (this.data.monthly && this.data.monthly.length) {
        const bc = buildBarChart(this.data.monthly, (p) => p.expense, BAR_ZONE_MONTH_RPX, 12,
          Object.assign({}, opt, { requireAll: true }));
        patch.monthly = bc.points;
        patch.monthlyAxis = bc.axis;
        patch.monthlyBarUri = this.barUri(bc.points, bc.axis, opt);
      }
      if (Object.keys(patch).length) this.setData(patch);
    },

    /* ---------- 柱体明暗台阶（v1.5.3） ---------- */
    /**
     * 柱区显示盒（CSS px）：宽 = 图表内容宽 − Y 轴留白（与 .ca__plot 的 flex 计算结果同口径），
     * 高 = 柱区 rpx 换算 px（rpx × 窗口宽 / 750，与 WXSS 一致）。
     * 取不到窗口信息时按 375 兜底；数值只影响 SVG 内部坐标，柱高比例不受影响。
     */
    barBoxPx(axis, opt) {
      let winW = 375;
      try {
        const info = device.measure();
        winW = info && info.windowWidth ? info.windowWidth : 375;
      } catch (e) {
        winW = 375;
      }
      const contentPx = opt && Number(opt.contentPx) > 0 ? Number(opt.contentPx) : chartContentPx(winW);
      const gutterPx = Number(axis && axis.gutterPx) || 0;
      const zoneRpx = Number(axis && axis.zoneRpx) || 0;
      return {
        width: Math.max(40, contentPx - gutterPx),
        height: Math.max(1, (zoneRpx * winW) / 750),
        zoneRpx: zoneRpx || 1,
      };
    },
    /**
     * 柱体图源（data-URI）：6 档明暗台阶在 utils/bar-shading 里生成 SVG，base64 后交给 <image>。
     * 与累计折线 / 分类圆环同一条渲染路径，不需要重绘调度 —— setData 换了 uri 就自动更新。
     */
    barUri(points, axis, opt, themeKey) {
      const box = this.barBoxPx(axis, opt);
      const svg = barShading.buildBarsSVG(points, {
        width: box.width,
        height: box.height,
        zoneRpx: box.zoneRpx,
        colors: barPalette(themeKey || this.shareThemeKey()),
        radius: barRadiusPx(),
      });
      return 'data:image/svg+xml;base64,' + b64encodeAscii(svg);
    },

    /**
     * 主题切换的局部颜色刷新（不重读账本、不重置选中 / 展开态）。
     * 仅用缓存的原始占比（_monthShare / _yearShare）重新解析圆环、列表、展开行颜色，
     * 当前年月、选中 id、展开态与其他统计数据原样保留，避免大账本下的无谓重读重算。
     */
    recolorForTheme() {
      const patch = {};
      const toCentsRow = (x) => Object.assign({}, x, { centsText: money.formatCents(x.cents) });
      const themeKey = this.shareThemeKey();

      if (this._monthShare) {
        const monthColored = donut.resolveSegmentColors(this._monthShare.segments, themeKey);
        patch.shareSegments = monthColored;
        patch.shareList = monthColored.map(toCentsRow);
        // buildExpandedShareRows 内部读当前主题，传缓存 share 即可重建展开行颜色
        patch.fullShareList = this.buildExpandedShareRows(this._monthShare);
      }
      if (this._yearShare) {
        const yearColored = donut.resolveSegmentColors(this._yearShare.segments, themeKey);
        patch.yearShareSegments = yearColored;
        patch.yearShareList = yearColored.map(toCentsRow);
        patch.yearFullShareList = this.buildExpandedShareRows(this._yearShare);
      }
      // 主题切换后柱体 6 档实色全变（主色与混白/混黑比例都随主题）：
      // 用当前已渲染的柱子数据只重算图源，不重读账本、不动选中态
      const axisOpt = this.axisOpt();
      if (this.data.dailyAxis && (this.data.daily || []).length) {
        patch.dailyBarUri = this.barUri(this.data.daily, this.data.dailyAxis, axisOpt, themeKey);
      }
      if (this.data.monthlyAxis && (this.data.monthly || []).length) {
        patch.monthlyBarUri = this.barUri(this.data.monthly, this.data.monthlyAxis, axisOpt, themeKey);
      }
      if (Object.keys(patch).length) this.setData(patch);
    },
    /* ---------- 模式切换 ---------- */
    onModeMonth() {
      if (this.data.mode === 'month') return;
      this.setData({ mode: 'month' });
      this.loadMonth(this.data.ym || currentYM());
    },
    onModeYear() {
      if (this.data.mode === 'year') return;
      this.setData({ mode: 'year' });
      this.loadYear(this.data.year || new Date().getFullYear());
    },
    /** 当前主题 key（dark/light），未知值安全回退 dark */
    shareThemeKey() {
      let t = 'dark';
      try { t = theme.getEffectiveTheme(); } catch (e) { t = 'dark'; }
      return t === 'light' ? 'light' : 'dark';
    },
    /**
     * 构建「查看全部分类」展开列表（月度 / 年度共用同一套数据处理与视觉规范）。
     * - 未聚合（≤8）：展开与默认一致，全部真实分类；
     * - 聚合态：前 7 保持圆环原色 → 明确「其他」分组头（总额 + 分类数）→
     *   被聚合真实分类列在分组下，颜色标记统一用「其他」中性色并标注属于圆环「其他」，
     *   子分类仍为真实分类、支持独立钻取。
     */
    buildExpandedShareRows(share) {
      const themeKey = this.shareThemeKey();
      const toRow = (x, extra) => Object.assign(
        {}, x, { centsText: money.formatCents(x.cents) }, extra || {}
      );
      if (!share.aggregated) {
        return donut.resolveSegmentColors(share.all, themeKey)
          .map((x) => toRow(x, { kind: 'top' }));
      }
      const rows = [];
      const top = share.all.slice(0, M.TOP_N_WHEN_AGGREGATED);
      const rest = share.all.slice(M.TOP_N_WHEN_AGGREGATED);
      // 前 7：保持圆环原色
      donut.resolveSegmentColors(top, themeKey).forEach((x) => rows.push(toRow(x, { kind: 'top' })));
      // 「其他」分组头：用圆环聚合段的总额 / 分类数
      const aggSeg = share.segments.find((s) => s.aggregate);
      rows.push({
        categoryId: M.AGGREGATE_OTHER_ID,
        name: '其他',
        cents: aggSeg.cents,
        count: aggSeg.count,
        ratio: aggSeg.ratio,
        percentText: aggSeg.percentText,
        color: donut.AGGREGATE_COLOR,
        centsText: money.formatCents(aggSeg.cents),
        iconType: 'emoji',
        iconValue: '📦',
        emoji: '📦',
        aggregate: true,
        kind: 'group',
        aggCount: rest.length,
      });
      // 被聚合子分类：统一中性色标记，保留真实 id 支持独立钻取
      rest.forEach((x) => {
        rows.push(toRow(Object.assign({}, x, { color: donut.AGGREGATE_COLOR }), {
          kind: 'child',
          aggregate: false,
        }));
      });
      return rows;
    },
    /* ---------- 月度取数（Lazy Compute：关闭的可选模块不计算） ---------- */
    loadMonth(ym) {
      const bills = store.rangeBills(ym, ym);
      const resolveCategory = store.getCategoryResolver(); // 单次渲染快照
      const [y, m] = ym.split('-').map(Number);
      const config = store.getSettings().statistics;
      const on = (id) => statCfg.isEnabled(config, id);
      const toShareRow = (x) => Object.assign({}, x, { centsText: money.formatCents(x.cents) });
      // 结论行口径（B-2）：当月 / 历史月决定「日均分母」与「要不要月末预测」
      const now = new Date();
      const isCurrentMonth = ym === currentYM();
      const daysInMonth = M.monthDays(y, m); // 该月总天数（2 月 28/29、31 天月都准）
      const elapsedDays = isCurrentMonth ? now.getDate() : daysInMonth;

      // —— 强制保留：Hero 概览 ——
      const ov = M.computeMonthOverview(bills);
      // Hero V2 摘要：最高消费日 / 日均支出（均从当月 normal 账单现算，不新增存储）
      const topDay = M.findTopExpenseDay(bills, y, m);
      const dailyAvgCents = M.computeDailyAverageExpense(bills, y, m, new Date());
      // —— 强制保留：月度最大单笔（独立卡，点击 triggerEvent openbill） ——
      const largestBill = M.findLargestExpense(bills);
      let mLargest = null;
      let mLargestId = '';
      if (largestBill) {
        const lcat = resolveCategory(largestBill.categoryId);
        const ld = new Date(largestBill.occurredAt);
        mLargest = Object.assign(
          {
            title: largestBill.title || largestBill.merchant || lcat.name || '支出',
            dateLabel: ld.getMonth() + 1 + '-' + ld.getDate(),
            amountText: '¥' + money.formatCents(largestBill.amountCents),
          },
          pickCategoryVisual(lcat)
        );
        mLargestId = largestBill.id;
      }

      const patch = {
        ym,
        monthLabel: y + '年' + m + '月',
        canNextMonth: ym < currentYM(),
        mExpense: money.formatCents(ov.expense),
        mIncome: money.formatCents(ov.income),
        mBalance: money.formatCents(ov.balance),
        mCount: ov.count,
        mTopDay: topDay ? topDay.day + '日' : '—',
        mTopDayAmount: topDay ? '¥' + money.formatCents(topDay.cents) : '—',
        mDailyAvg: '¥' + money.formatCents(dailyAvgCents),
        mLargest,
        mLargestId,
        enabledModules: config.modules.slice(),
        modMap: config.modules.reduce((acc, id) => { acc[id] = true; return acc; }, {}),
      };

      // —— Hero 同期环比（v1.4.6）——
      // 口径红线：本月 1~已过天数 vs 上月 1~同期，⛔ 绝不拿本月半月比上月整月（会假报「少 50%」）。
      // 本月已过天数为 0 支出时不比（首日或本月还没记账，「少 100%」是凭空结论，不是洞察）。
      // 上月同期为 0 → buildMoMCompare 返回「上月同期无支出」；两边都 0 → null，本行不渲染。
      const momCur = sumExpenseThroughDay(bills, elapsedDays);
      if (momCur > 0) {
        const prevYM = shiftYM(ym, -1);
        const [py, pm] = prevYM.split('-').map(Number);
        // 上月只有 28/30 天而本月已过 31 天时，上月同期按上月最后一天封顶（不凭空算 -100%）
        const prevCap = insight.clampPeriodDay(elapsedDays, M.monthDays(py, pm));
        const momPrev = sumExpenseThroughDay(store.rangeBills(prevYM, prevYM), prevCap);
        const mom = insight.buildMoMCompare(momCur, momPrev);
        patch.momText = mom.text || '';
        patch.momDir = mom.dir || '';
      } else {
        patch.momText = '';
        patch.momDir = '';
      }

      // —— 分类占比（category-share） ——
      patch.shareSelectedId = ''; // 切月重置选中
      if (on('category-share')) {
        const share = M.computeCategoryShare(bills, resolveCategory);
        // 缓存原始占比（无颜色）：切主题时复用它仅重新取色，不重读账本。
        this._monthShare = share;
        const themeKey = this.shareThemeKey();
        // 圆环与默认图例同一套颜色解析（主题透传），保证颜色完全一致
        const colored = donut.resolveSegmentColors(share.segments, themeKey);
        patch.shareSegments = colored;
        patch.shareList = colored.map(toShareRow);
        patch.shareAggregated = share.aggregated;
        patch.shareExpanded = false;
        // 展开列表走统一构建：前 7 原色 + 「其他」分组 + 中性色子分类
        patch.fullShareList = this.buildExpandedShareRows(share);
        patch.shareAggCount = share.aggregated ? share.all.length - M.TOP_N_WHEN_AGGREGATED : 0;
        // 结论行复用已算好的占比数组（share.all 按金额倒序、含全部真实分类）
        patch.categoryInsight = insight.buildCategoryInsight(share.all);
      } else {
        // 关闭：清空，避免显示上次旧结果
        patch.shareSegments = [];
        patch.shareList = [];
        patch.fullShareList = [];
        patch.shareAggregated = false;
        patch.shareExpanded = false;
        patch.shareAggCount = 0;
        patch.categoryInsight = '';
      }

      // —— 每日花费趋势（daily-expense-trend） ——
      const optM = this.axisOpt();
      const dailyRaw = on('daily-expense-trend') ? M.computeDailyExpenseTrend(bills, y, m) : null;
      const cum = on('cumulative-trend') ? M.computeCumulativeTrend(bills, y, m) : null;
      // 同一列里的日柱图与累计图共用 Y 轴留白（终检⑥：左右边界都要对齐）
      const sharedGutter = sharedGutterPx(optM, [
        dailyRaw ? dailyRaw.max : 0,
        cum ? cum.max : 0,
      ]);
      if (dailyRaw) {
        const pts = withBarHeight(dailyRaw.points, BAR_ZONE_DAILY_RPX);
        // X 轴标签按「每日图最多 7 个」+ 实际可用宽度抽稀（窄屏自动减，不叠字）
        const bc = buildBarChart(pts, (p) => p.cents, BAR_ZONE_DAILY_RPX, 7,
          Object.assign({}, optM, { gutterPx: sharedGutter }));
        patch.daily = bc.points;
        patch.dailyAxis = bc.axis;
        patch.dailyBarUri = this.barUri(bc.points, bc.axis, optM);
        // 整月无支出 → 空态文案（不再画一根 0 高度的空图 + 顶部挂个 0）
        patch.dailyEmpty = !(bc.axis.maxCents > 0);
        // 结论行：日均分母与 Hero「日均支出」同口径（当月=截至今天，历史月=整月天数）
        patch.dailyInsight = insight.buildDailyInsight(dailyRaw.points, elapsedDays, m);
      } else {
        patch.daily = [];
        patch.dailyAxis = null;
        patch.dailyBarUri = '';
        patch.dailyEmpty = false;
        patch.dailyInsight = '';
      }

      // —— 累计消费趋势（cumulative-trend，默认关闭） ——
      patch.cumMonth = m;
      patch.cumGutter = sharedGutter;
      if (cum) {
        patch.cumPoints = cum.points;
        patch.cumMax = cum.max;
        patch.cumEmpty = !(cum.max > 0);
        // 结论行：当月给月末预测，历史月只报日均（历史月已完整，预测没有意义）
        patch.cumInsight = insight.buildCumulativeInsight({
          totalCents: cum.total,
          elapsedDays,
          spanDays: daysInMonth,
          isCurrentMonth,
        });
      } else {
        patch.cumPoints = [];
        patch.cumMax = 0;
        patch.cumEmpty = false;
        patch.cumInsight = '';
      }

      // —— 收入 / 支出对比（income-expense-compare） ——
      if (on('income-expense-compare')) {
        const cmp = M.computeIncomeExpenseCompare(bills);
        patch.cmp = {
          income: money.formatCents(cmp.income),
          expense: money.formatCents(cmp.expense),
          incomeBar: cmp.incomeBar,
          expenseBar: cmp.expenseBar,
        };
      } else {
        patch.cmp = { income: '0.00', expense: '0.00', incomeBar: 0, expenseBar: 0 };
      }

      // —— 预算分析（budget-analysis） ——
      const today = util.formatDate(new Date());
      const hasBudgetRules = store.getBudgetState().rules.length > 0;
      patch.budgetEmpty = !hasBudgetRules;
      if (on('budget-analysis') && hasBudgetRules) {
        patch.budgetCalendar = store.buildBudgetCalendar(y, m, today);
        // 节奏摘要随所选月份走：当前月=本周/本月截至今日+上周/上月；历史月=本月/上月最终。
        const paceCtx = store.buildBudgetMonthPace(y, m, today);
        patch.pace = paceCtx.items.map((p) => ({
          label: p.label,
          text: (p.delta >= 0 ? '+' : '-') + '¥' + money.formatCents(Math.abs(p.delta)),
          positive: p.delta >= 0,
          hasBudget: p.hasBudget,
        }));
      } else {
        patch.budgetCalendar = null;
        patch.pace = [];
      }

      // —— 自定义日期统计（custom-range，默认关闭） ——
      if (on('custom-range')) {
        let crStart = this.data.crStart;
        let crEnd = this.data.crEnd;
        if (!crStart || !crEnd) {
          // 首次：当前月=1 日~今天；历史月=1 日~该月最后一天
          crStart = ym + '-01';
          crEnd = ym === today.slice(0, 7) ? today : lastDateOfYM(ym);
        }
        const cr = this.buildCustomRange(crStart, crEnd);
        patch.crStart = crStart;
        patch.crEnd = crEnd;
        patch.crStats = cr.crStats;
        patch.crInvalid = cr.crInvalid;
      } else {
        // 关闭：清空统计结果（保留已选日期，重新开启时恢复）
        patch.crStats = null;
        patch.crInvalid = false;
      }

      this.setData(withInsightSegs(patch));
    },
    /* ---------- 自定义日期统计 ---------- */
    /** 由起止日期字符串计算范围统计；开始晚于结束 → 无效（不偷偷交换） */
    buildCustomRange(crStart, crEnd) {
      if (!crStart || !crEnd) return { crStats: null, crInvalid: false };
      // 'YYYY-MM-DD' 字典序即时间序，可直接比较
      if (crStart > crEnd) return { crStats: null, crInvalid: true };
      // 只读取覆盖该日期范围的月份分片（crStart/crEnd 所在月），不再全历史读取
      const ymStart = crStart.slice(0, 7);
      const ymEnd = crEnd.slice(0, 7);
      const stats = R.computeRangeStats(store.rangeBills(ymStart, ymEnd), dayStart(crStart), dayEnd(crEnd));
      return {
        crStats: {
          expense: money.formatCents(stats.expense),
          income: money.formatCents(stats.income),
          balance: money.formatCents(stats.balance),
          count: stats.count,
        },
        crInvalid: false,
      };
    },
    onCrStart(e) {
      const crStart = e.detail.value;
      const cr = this.buildCustomRange(crStart, this.data.crEnd);
      this.setData({ crStart, crStats: cr.crStats, crInvalid: cr.crInvalid });
    },
    onCrEnd(e) {
      const crEnd = e.detail.value;
      const cr = this.buildCustomRange(this.data.crStart, crEnd);
      this.setData({ crEnd, crStats: cr.crStats, crInvalid: cr.crInvalid });
    },
    onPrevMonth() {
      this.loadMonth(shiftYM(this.data.ym, -1));
    },
    onNextMonth() {
      if (!this.data.canNextMonth) return;
      this.loadMonth(shiftYM(this.data.ym, 1));
    },
    /* ---------- 年度取数（Lazy Compute：年度可选模块按开关计算） ---------- */
    loadYear(year) {
      const bills = store.rangeBills(year + '-01', year + '-12');
      const resolveCategory = store.getCategoryResolver(); // 单次渲染快照
      const config = store.getSettings().statistics;
      const on = (id) => statCfg.isEnabled(config, id);

      // —— 强制保留：年度 Hero ——
      const ov = Y.computeYearOverview(bills, year);
      const ext = Y.computeExpenseExtremes(bills, year);
      const yearRank = Y.computeYearCategoryRanking(bills, resolveCategory).top.map((x) => ({
        ...x,
        centsText: money.formatCents(x.cents),
      }));

      const patch = {
        year,
        canNextYear: year < new Date().getFullYear(),
        yExpense: money.formatCents(ov.expense),
        yIncome: money.formatCents(ov.income),
        yBalance: money.formatCents(ov.balance),
        yCount: ov.count,
        yAvg: money.formatCents(ov.monthlyAvg),
        highest: ext.highest ? ext.highest.month + '月 · ¥' + money.formatCents(ext.highest.expense) : '—',
        lowest: ext.lowest ? ext.lowest.month + '月 · ¥' + money.formatCents(ext.lowest.expense) : '—',
        yearRank,
        enabledModules: config.modules.slice(),
        modMap: config.modules.reduce((acc, id) => { acc[id] = true; return acc; }, {}),
      };

      // —— 12 个月支出趋势（year-monthly-trend） ——
      if (on('year-monthly-trend')) {
        // 趋势原始点先留一份：柱高加工（withBarHeight）不改变 expense，结论行直接复用它
        const trendPts = Y.computeMonthlyTrend(bills, year).points;
        const pts = withBarHeight(trendPts, BAR_ZONE_MONTH_RPX);
        // 12 个月标签必须全在（用户靠它找「哪个月没数据」）：宽度不够先缩格式再缩字号，绝不抽稀
        const optY = this.axisOpt();
        const bc = buildBarChart(pts, (p) => p.expense, BAR_ZONE_MONTH_RPX, 12,
          Object.assign({}, optY, { requireAll: true }));
        patch.monthly = bc.points;
        patch.monthlyAxis = bc.axis;
        patch.monthlyBarUri = this.barUri(bc.points, bc.axis, optY);
        // 结论行：月均口径与 Hero「yAvg」（computeYearOverview.monthlyAvg）完全一致
        patch.monthlyInsight = insight.buildMonthlyInsight(trendPts);
      } else {
        patch.monthly = [];
        patch.monthlyAxis = null;
        patch.monthlyBarUri = '';
        patch.monthlyInsight = '';
      }

      // —— 年度回顾（year-review）：最大单笔 / 记录最多分类 / 最常消费月 ——
      if (on('year-review')) {
        const largestBill = Y.findLargestExpense(bills);
        let yrLargest = null;
        let yrLargestId = '';
        if (largestBill) {
          const ld = new Date(largestBill.occurredAt);
          const lcat = resolveCategory(largestBill.categoryId);
          yrLargest = {
            dateLabel: ld.getMonth() + 1 + '月' + ld.getDate() + '日',
            title: largestBill.title || largestBill.merchant || lcat.name || '支出',
            amountText: '¥' + money.formatCents(largestBill.amountCents),
          };
          yrLargestId = largestBill.id;
        }
        const topCat = Y.findMostRecordedCategory(bills, resolveCategory);
        const yrTopCat = topCat
          ? {
              categoryId: topCat.categoryId,
              name: topCat.name,
              emoji: topCat.emoji,
              iconType: topCat.iconType,
              iconValue: topCat.iconValue,
              count: topCat.count,
            }
          : null;
        const topMonth = Y.findMostActiveMonth(bills);
        const yrTopMonth = topMonth
          ? { label: topMonth.month + '月', month: topMonth.month, count: topMonth.count }
          : null;
        patch.yrLargest = yrLargest;
        patch.yrLargestId = yrLargestId;
        patch.yrTopCat = yrTopCat;
        patch.yrTopMonth = yrTopMonth;
      } else {
        patch.yrLargest = null;
        patch.yrLargestId = '';
        patch.yrTopCat = null;
        patch.yrTopMonth = null;
      }

      // —— 全年分类占比（固定模块：复用 category-donut，使用完整年度分类列表） ——
      patch.yearShareSelectedId = ''; // 切年重置选中
      const yearShare = M.computeCategoryShare(bills, resolveCategory);
      // 缓存原始占比（无颜色）：切主题时复用它仅重新取色，不重读账本。
      this._yearShare = yearShare;
      const toYearShareRow = (x) => Object.assign({}, x, { centsText: money.formatCents(x.cents) });
      const yThemeKey = this.shareThemeKey();
      const yColored = donut.resolveSegmentColors(yearShare.segments, yThemeKey);
      patch.yearShareSegments = yColored;
      patch.yearShareList = yColored.map(toYearShareRow);
      patch.yearShareAggregated = yearShare.aggregated;
      patch.yearShareExpanded = false;
      patch.yearFullShareList = this.buildExpandedShareRows(yearShare);
      patch.yearShareAggCount = yearShare.aggregated
        ? yearShare.all.length - M.TOP_N_WHEN_AGGREGATED
        : 0;

      this.setData(withInsightSegs(patch));
    },
    onPrevYear() {
      this.loadYear(this.data.year - 1);
    },
    onNextYear() {
      if (!this.data.canNextYear) return;
      this.loadYear(this.data.year + 1);
    },
    /* ---------- 年度回顾三项点击（Gate 5） ---------- */
    /** 最大单笔支出：直接打开该账单编辑（交由 main 复用 bill-form） */
    onTapYrLargest() {
      if (!this.data.yrLargestId) return;
      this.triggerEvent('openbill', { id: this.data.yrLargestId });
    },
    /** 记录最多分类：钻取该年 + 该分类（Bill Explorer） */
    onTapYrTopCat() {
      const c = this.data.yrTopCat;
      if (!c) return;
      wx.navigateTo({
        url: '/pages/search/search?year=' + this.data.year + '&category=' + c.categoryId,
      });
    },
    /** 最常消费月份：钻取该月（Bill Explorer） */
    onTapYrTopMonth() {
      const m = this.data.yrTopMonth;
      if (!m) return;
      const mm = String(m.month).padStart(2, '0');
      wx.navigateTo({
        url: '/pages/search/search?month=' + this.data.year + '-' + mm,
      });
    },
    /** 空态：前往预算设置页 */
    onBudgetSettings() {
      wx.navigateTo({ url: '/pages/budget-settings/budget-settings' });
    },
    /* ---------- 预算日详情：组装数据后交由 main 页面弹层（只读） ---------- */
    onTapDay(e) {
      const dateStr = e.currentTarget.dataset.date;
      if (!dateStr) return;
      const today = util.formatDate(new Date());
      // 未来日不打开详情（只读，无预算盈亏）
      if (dateStr > today) return;
      const d = store.buildBudgetDayDetail(dateStr);
      const resolveDayCategory = store.getCategoryResolver(); // 单次详情快照
      const dp = dateStr.split('-').map(Number);
      const title = dp[1] + '月' + dp[2] + '日';
      const payload = {
        title,
        hasBudget: d.hasBudget,
        budgetText: '¥' + money.formatCents(d.budgetCents),
        actualText: '¥' + money.formatCents(d.actualCents),
        delta: d.deltaCents,
        deltaLabel: d.deltaCents >= 0 ? '盈余' : '超支',
        deltaText:
          (d.deltaCents >= 0 ? '+' : '-') + '¥' + money.formatCents(Math.abs(d.deltaCents)),
        categories: d.categories.map((c) => ({
          categoryId: c.categoryId,
          name: c.name,
          emoji: c.emoji,
          iconType: c.iconType,
          iconValue: c.iconValue,
          centsText: '¥' + money.formatCents(c.cents),
        })),
        bills: d.bills.map((b) => {
          const cat = resolveDayCategory(b.categoryId);
          return {
            id: b.id,
            name: b.title || b.merchant || cat.name || '支出',
            amountText: '¥' + money.formatCents(b.amountCents),
          };
        }),
        billCount: d.billCount,
      };
      this.triggerEvent('daydetail', payload);
    },
    /* ---------- 分类明细：组装数据后交由 main 页面弹层展示 ----------
       （弹层需在页面级 fixed，组件内 fixed 会相对 swiper-item 定位错乱） */
    onTapMonthCat(e) {
      const catId = e.currentTarget.dataset.id;
      const bills = store.rangeBills(this.data.ym, this.data.ym);
      const items = toCatItems(bills, catId);
      const title = (store.getCategory(catId).name || '分类') + ' · ' + this.data.monthLabel;
      // 携带钻取上下文，供弹层「查看全部」跳到 Bill Explorer
      this.triggerEvent('categorydetail', {
        title, items, scope: 'month', categoryId: catId, ym: this.data.ym,
      });
    },
    onTapYearCat(e) {
      const catId = e.currentTarget.dataset.id;
      const bills = store.rangeBills(this.data.year + '-01', this.data.year + '-12');
      const items = toCatItems(bills, catId);
      const title = (store.getCategory(catId).name || '分类') + ' · ' + this.data.year + '年';
      this.triggerEvent('categorydetail', {
        title, items, scope: 'year', categoryId: catId, year: this.data.year,
      });
    },
    /** 年度钻取公共逻辑：真实分类 → Bill Explorer 该年该分类支出；聚合 → 展开列表 */
    drillYearShare(segment) {
      if (!segment) return;
      if (segment.aggregate || segment.categoryId === M.AGGREGATE_OTHER_ID) {
        this.setData({ yearShareExpanded: true });
        return;
      }
      wx.navigateTo({
        url: '/pages/search/search?year=' + this.data.year + '&category=' + segment.categoryId + '&type=expense',
      });
    },
    /** 全年分类占比行点击 */
    onTapYearShareRow(e) {
      this.drillYearShare({
        categoryId: e.currentTarget.dataset.id,
        aggregate: !!e.currentTarget.dataset.agg,
      });
    },
    /** 年度圆环选中分段：同步图例高亮（不跳转） */
    onYearDonutSelect(e) {
      const seg = e.detail.segment;
      if (!seg) return;
      this.setData({ yearShareSelectedId: seg.categoryId });
    },
    /** 年度圆环中心点击：执行钻取 */
    onYearDonutDrill(e) {
      this.drillYearShare(e.detail.segment);
    },
    /** 全年分类占比：查看全部 / 收起 */
    onToggleYearShareExpand() {
      this.setData({ yearShareExpanded: !this.data.yearShareExpanded });
    },
    /** 年度 12 月趋势：点某个月的标签 → Bill Explorer 该月全部账单 */
    onTapMonthBar(e) {
      const m = Number(e.currentTarget.dataset.month);
      if (!m) return;
      this.drillMonth(m);
    },
    /** 柱体按下：记起点，供 touchend 区分「点击」与「滑动切页」（滚动时不误跳） */
    onMonthlyBarTouchStart(e) {
      const p = this.tapClientPoint(e);
      this._barTouch = p ? { x: p.x, y: p.y, t: Date.now() } : null;
    },
    /**
     * 年度 12 月趋势：点柱体 → 反查列号 → 同一目标页。
     * 柱子从 view 换成「1 张图」后没有 DOM 可挂 data-month，只能按坐标反查；
     * 命中范围与旧 .bar-col 等价：列宽内 + 柱高范围内（矮柱给 BAR_TAP_MIN_PX 兜底，
     * 否则 1px 高的月份永远点不到，等于把点击弄丢）。
     * 点击时才量 #monthlyPlot 的矩形：不缓存位置，滚动 / 切模式后都不会算错列。
     */
    onTapMonthlyBar(e) {
      const start = this._barTouch || null;
      this._barTouch = null;
      // touchend 与 tap 都挂了同一个处理器：真机上两者都会来，这里去重，避免跳两次
      const nowTs = Date.now();
      if (this._barTapAt && nowTs - this._barTapAt < 500) return;
      const pt = this.tapClientPoint(e);
      if (!pt) return;
      this._barTapAt = nowTs;
      // 滚动误触保护：按下→抬起位移 > 10px 或超过 600ms 视为滑动，不跳转。
      // 用 touchend 而不是 tap：tap 在 Skyline 下的触摸字段不保证带坐标，touchend 一定带。
      if (start) {
        if (Math.abs(pt.x - start.x) > 10 || Math.abs(pt.y - start.y) > 10) return;
        if (Date.now() - start.t > 600) return;
      }
      if (typeof wx === 'undefined' || !wx.createSelectorQuery) return;
      wx.createSelectorQuery().in(this).select('#monthlyPlot').boundingClientRect((rect) => {
        if (!rect || !(rect.width > 0) || !(rect.height > 0)) return;
        const lx = pt.x - rect.left;
        const ly = pt.y == null ? null : pt.y - rect.top;
        if (lx < 0 || lx >= rect.width) return;
        const pts = this.data.monthly || [];
        if (!pts.length) return;
        const colW = rect.width / pts.length;
        const i = Math.max(0, Math.min(pts.length - 1, Math.floor(lx / colW)));
        const p = pts[i];
        if (!p || !p.month) return;
        if (ly != null) {
          const zoneRpx = Number((this.data.monthlyAxis || {}).zoneRpx) || 1;
          const barH = ((Number(p.barHeightRpx) || 0) / zoneRpx) * rect.height;
          const barTop = rect.height - barH;
          if (ly < Math.min(barTop, rect.height - BAR_TAP_MIN_PX)) return; // 点在柱子上方的空白：不跳转
        }
        this.drillMonth(p.month);
      }).exec();
    },
    /**
     * 触摸点 → 视口坐标（CSS px）。
     * 优先 changedTouches[0].clientX/Y（与 daily-value-curve 同口径）；
     * 没有 clientX 时退回 touch.x/y（已是元素内局部坐标，交给调用方当视口值会偏，
     * 所以这里只在拿不到 client 系列时才用，并容忍偏差）；只剩 detail 时只认 x。
     */
    tapClientPoint(e) {
      const t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]) || null;
      if (t && t.clientX != null && t.clientY != null) return { x: t.clientX, y: t.clientY };
      if (t && t.pageX != null && t.pageY != null) return { x: t.pageX, y: t.pageY };
      if (e.detail && e.detail.x != null && e.detail.y != null) return { x: e.detail.x, y: e.detail.y };
      return null;
    },
    /** 月份钻取公共出口（标签点击 / 柱体点击共用，避免两处拼 URL 走偏） */
    drillMonth(m) {
      const month = Number(m);
      if (!month) return;
      const ym = this.data.year + '-' + String(month).padStart(2, '0');
      wx.navigateTo({ url: '/pages/search/search?month=' + ym });
    },
    /** 月度最大单笔：直接打开该账单编辑（main 已绑定 openbill 复用 bill-form） */
    onTapMonthLargest() {
      if (!this.data.mLargestId) return;
      this.triggerEvent('openbill', { id: this.data.mLargestId });
    },
    /** 月度钻取公共逻辑：真实分类 → Bill Explorer 当月该分类支出；聚合 → 展开列表 */
    drillMonthShare(segment) {
      if (!segment) return;
      if (segment.aggregate || segment.categoryId === M.AGGREGATE_OTHER_ID) {
        this.setData({ shareExpanded: true });
        return;
      }
      wx.navigateTo({
        url: '/pages/search/search?month=' + this.data.ym + '&category=' + segment.categoryId + '&type=expense',
      });
    },
    /** 分类占比行点击 */
    onTapShareRow(e) {
      this.drillMonthShare({
        categoryId: e.currentTarget.dataset.id,
        aggregate: !!e.currentTarget.dataset.agg,
      });
    },
    /** 月度圆环选中分段：同步图例高亮（不跳转） */
    onDonutSelect(e) {
      const seg = e.detail.segment;
      if (!seg) return;
      this.setData({ shareSelectedId: seg.categoryId });
    },
    /** 月度圆环中心点击：执行钻取 */
    onDonutDrill(e) {
      this.drillMonthShare(e.detail.segment);
    },
    /** 查看全部 / 收起完整分类列表 */
    onToggleShareExpand() {
      this.setData({ shareExpanded: !this.data.shareExpanded });
    },
    /* ---------- 统计模块管理（Gate 3） ---------- */
    /** 打开管理弹层：按当前模式组装模块行（月度 / 年度各一组） */
    onOpenManage() {
      const config = store.getSettings().statistics;
      const scope = this.data.mode === 'year' ? statCfg.YEARLY_MODULES : statCfg.MONTHLY_MODULES;
      const moduleRows = scope.map((id) => ({
        id,
        label: MODULE_LABELS[id] || id,
        checked: statCfg.isEnabled(config, id),
      }));
      this.setData({ showManage: true, moduleRows });
    },
    /** 关闭管理弹层 */
    onCloseManage() {
      this.setData({ showManage: false });
    },
    /** 开关某模块：更新配置 → 原子持久化 → 立即重新加载（真 Lazy Compute） */
    onToggleModule(e) {
      const id = e.currentTarget.dataset.id;
      const value = e.detail.value;
      const current = store.getSettings().statistics;
      const set = new Set(current.modules);
      if (value) set.add(id);
      else set.delete(id);
      // 按 VALID_MODULES 标准顺序输出，避免顺序漂移
      const ordered = statCfg.VALID_MODULES.filter((mid) => set.has(mid));
      const next = statCfg.withModules(ordered);
      store.updateSettings({ statistics: next });
      const moduleRows = this.data.moduleRows.map((r) =>
        r.id === id ? Object.assign({}, r, { checked: value }) : r
      );
      this.setData({ moduleRows, enabledModules: next.modules });
      if (this.data.mode === 'year') this.loadYear(this.data.year);
      else this.loadMonth(this.data.ym);
    },
    /** 恢复默认：持久化默认配置 → 刷新弹层行并重新加载 */
    onResetModules() {
      const def = statCfg.defaultConfig();
      store.updateSettings({ statistics: def });
      const moduleRows = this.data.moduleRows.map((r) =>
        Object.assign({}, r, { checked: statCfg.isEnabled(def, r.id) })
      );
      this.setData({ moduleRows, enabledModules: def.modules });
      if (this.data.mode === 'year') this.loadYear(this.data.year);
      else this.loadMonth(this.data.ym);
    },
  },
});
