// components/daily-value-curve/daily-value-curve.js
// 日价下降曲线（原生 Canvas 2D，不引入 ECharts）：
//   折线 + 轻面积渐变 + 少量 X/Y 标签 + 触摸轻提示（日期 / 已用天数 / 日价，无十字线）。
// 数据全部由 data/daily-value 纯函数（buildDailyValueCurve）动态计算，不存每日快照。
const store = require('../../data/index');
const dv = require('../../data/daily-value/index');
const money = require('../../data/money');

function fullDateText(s) {
  const p = String(s || '').split('-').map(Number);
  if (p.length < 3) return '';
  return p[0] + '年' + p[1] + '月' + p[2] + '日';
}
function shortDate(s) {
  const p = String(s || '').split('-').map(Number);
  return p[1] + '/' + p[2];
}

Component({
  properties: {
    billId: { type: String, value: '' },
  },
  data: {
    ready: false,
    tipShow: false,
    tipLeft: 0,
    tipTop: 0,
    tipDate: '',
    tipDays: '',
    tipValue: '',
  },
  lifetimes: {
    attached() {
      // 等待详情页布局完成再取 canvas node
      wx.nextTick(() => this.initCanvas());
    },
    detached() {
      this._canvas = null;
    },
  },
  methods: {
    /** 数据变化（编辑金额 / 起算日）后由父页面调用重画 */
    refresh() {
      this._points = null;
      this.setData({ tipShow: false });
      if (this._ctx && this._size) this.draw();
      else this.initCanvas();
    },
    initCanvas() {
      const bill = store.getBill(this.data.billId);
      if (!bill || !dv.isDailyValueEnabled(bill)) return;
      wx.createSelectorQuery()
        .in(this)
        .select('#dvCurve')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) return;
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio) || 2;
          const size = { w: res[0].width, h: res[0].height };
          canvas.width = size.w * dpr;
          canvas.height = size.h * dpr;
          ctx.scale(dpr, dpr);
          this._canvas = canvas;
          this._ctx = ctx;
          this._size = size;
          this.setData({ ready: true });
          this.draw();
        });
    },
    getPoints() {
      if (this._points) return this._points;
      const bill = store.getBill(this.data.billId);
      if (!bill) return [];
      this._points = dv.buildDailyValueCurve(bill);
      return this._points;
    },
    layout() {
      const { w, h } = this._size;
      const padL = 10;
      const padR = 10;
      const padT = 18;
      const padB = 26;
      return { padL, padR, padT, padB, cw: w - padL - padR, ch: h - padT - padB };
    },
    coords() {
      const points = this.getPoints();
      const L = this.layout();
      const n = points.length;
      const maxV = points[0].valueCents;
      const xAt = (i) => L.padL + (n <= 1 ? L.cw / 2 : (i / (n - 1)) * L.cw);
      const yAt = (v) => L.padT + L.ch - (maxV > 0 ? (v / maxV) * L.ch : 0);
      return { points, L, xAt, yAt, maxV };
    },
    draw(highlightIdx) {
      const ctx = this._ctx;
      const { w, h } = this._size;
      const { points, L, xAt, yAt, maxV } = this.coords();
      if (!points.length) return;

      ctx.clearRect(0, 0, w, h);

      // 水平网格线（0 / 0.5 / 1）
      ctx.font = '10px sans-serif';
      ctx.textBaseline = 'middle';
      [1, 0.5, 0].forEach((ratio) => {
        const y = L.padT + L.ch - ratio * L.ch;
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(L.padL, y);
        ctx.lineTo(L.padL + L.cw, y);
        ctx.stroke();
        const v = (maxV * ratio) / 100;
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.textAlign = 'left';
        ctx.fillText('¥' + (v >= 100 ? Math.round(v) : v.toFixed(1)), L.padL + 2, y - 7);
      });

      // 面积渐变
      const grad = ctx.createLinearGradient(0, L.padT, 0, L.padT + L.ch);
      grad.addColorStop(0, 'rgba(124,134,255,0.32)');
      grad.addColorStop(1, 'rgba(124,134,255,0.0)');
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = xAt(i);
        const y = yAt(p.valueCents);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineTo(xAt(points.length - 1), L.padT + L.ch);
      ctx.lineTo(xAt(0), L.padT + L.ch);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // 折线
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = xAt(i);
        const y = yAt(p.valueCents);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#7c86ff';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // X 轴标签（最多 5 个）
      const labelCount = Math.min(5, points.length);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let k = 0; k < labelCount; k++) {
        const i = Math.round((k / (labelCount - 1 || 1)) * (points.length - 1));
        ctx.fillText(shortDate(points[i].date), xAt(i), L.padT + L.ch + 8);
      }

      // 高亮点（触摸）
      if (highlightIdx >= 0) {
        const p = points[highlightIdx];
        const x = xAt(highlightIdx);
        const y = yAt(p.valueCents);
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(124,134,255,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    },
    onTouch(e) {
      const touch = e.touches && e.touches[0];
      if (!touch) return;
      const { points, L, xAt } = this.coords();
      const n = points.length;
      const localX = touch.x != null ? touch.x : touch.clientX;
      let i = Math.round(((localX - L.padL) / L.cw) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      const p = points[i];
      this.draw(i);

      // 轻提示（wxml 浮层，位置在 canvas 内并做边界钳制）
      const px = xAt(i);
      const cardW = 150;
      const tipLeft = Math.max(0, Math.min(this._size.w - cardW, px - cardW / 2));
      this.setData({
        tipShow: true,
        tipLeft,
        tipTop: 4,
        tipDate: fullDateText(p.date),
        tipDays: '已使用 ' + p.day + ' 天',
        tipValue: '¥' + money.formatCents(Math.round(p.valueCents)) + '/天',
      });
    },
    onTouchEnd() {
      this.draw();
      this.setData({ tipShow: false });
    },
  },
});
