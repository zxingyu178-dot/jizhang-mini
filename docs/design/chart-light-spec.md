# 统计页其余图表 · 「车削」光影语言落地规格

> 配套原型：`docs/design/donut-mock.html` 的 `key:'A' 车削双层环`（客户已选定）。
> 本文只做一件事：把 A 的「多层几何叠出明暗台阶」翻译成 4 张图的**可抄参数**。
> 不改颜色合同、不改数据口径、不改环形图（环形图由寇豆码按 A 落实）。
> 代码基线：`jizhang-mini` 当前工作区，`renderer: skyline`（app.json:25）、`componentFramework: glass-easel`。

---

## 0. 一页速查

| 图 | 画法（已核实） | 承接明暗的面 | 新增元素 | 手法一句话 |
|---|---|---|---|---|
| 日支出柱状图 | WXML view + WXSS（**不是 SVG**） | 柱顶倒角边 / 顶光 / 受光 / 柱身 / 背光 / 接触暗 + 柱后地面槽 | **0**＋1 个地面槽 | 单元素里用「硬停渐变」切 6 段明度台阶，0 层叠 |
| 年度 12 月柱状图 | 同上（同一段 wxml 结构，`.ca__plot` 内） | 同上 | **0**＋1 个地面槽 | 同上，只有柱宽不同 |
| 累计支出折线 | **SVG 字符串 → base64 → `<image>`** | 折线（暗缘 / 本体 / 高光三道同路径描边）+ 线下面积（单档） | **+2** 个 `<path>` | 同一条 `d` 描三遍，不碰数据几何 |
| 日价曲线 | **原生 Canvas 2D** | 折线（同三道描边）+ 面积渐变 + 0 档地面线 | **0**（无 DOM） | 同一个 `path` 画三遍，纯参数 |

**合计新增 DOM 元素 2 个、新增 SVG 节点 2 个。** 全部为「不增加元素数量级」的方案，逐图预算见 §6。

---

## 1. 先把 A 的语言抽象成三条规则（后面 4 张图都按它执行）

A 方向在环形图上的 5 层参数是（`donut-mock.html` `DIRS` 里 `key:'A'`）：

| 层 | 占带宽 | 深色混白/混黑 | 浅色混白/混黑 |
|---|---|---|---|
| 外高光 | 1.3 / 12 = 10.8% | 混白 38% | 混白 55% |
| 外受光 | 2.4 / 12 = 20.0% | 混白 14% | 混白 22% |
| 本体 | 4.2 / 12 = 35.0% | 0（本色） | 0（本色） |
| 内背光 | 3.0 / 12 = 25.0% | 混黑 26% | 混黑 30% |
| 内接触暗 | 1.9 / 12 = 15.8% | 混黑 48% | 混黑 52% |

三条可复用规则（这就是「光影语言」本身）：

**规则 1 —— 只在一根色轴上做明度台阶，最多 5 档，档与档之间是硬边（无过渡）。**
色相一位不动：只有 `本色 → 混白 → 更白` 与 `本色 → 混黑 → 更黑` 两个方向。

**规则 2 —— 台阶在「截面」方向上排布，不在「长度」方向上排布。**
环形图里明暗是沿**半径**走的（横切过环带）；柱状图对应的是**柱的高**（横切过柱身）；折线图对应的是**线的粗细**（横切过线）。长度方向（弧长 / 柱的时间轴 / 折线走向）一律不加明暗 —— 一旦沿长度加明暗，就等于在图上多画了一条「趋势」，那是假的。

**规则 3 —— 最外那一档必须是本色，不许让高光顶到轮廓线上。**
环形图外层是「本色居中 + 亮在中线外」，柱状图同理：柱的最顶 4% 高度保持本色，高光从 4% 处开始。原因见 §2.5 的实测对比度（浅色下混白 40% 后只有 2.01:1，柱子轮廓线会消失，**读高度就变成猜**）。

**两条管线不要混为一谈（这是最容易被误执行的一条）：**

- **SVG 内（累计折线走 `<image>`）**：禁 `hsl()`、禁 `rgba()`、禁 filter、禁 `url(#gradient)`。颜色必须是 `#RRGGBB`，透明度只能写 `fill-opacity` / `stroke-opacity`。混色要在 JS 里算成实色 hex 再写进去 —— 因为 `stroke-opacity` 是「和底下卡片混」，不是「和白色混」，两者明度结果完全不同。
- **WXSS / Canvas 内（柱状图、日价曲线）**：`rgba()` 完全正常，项目里到处在用（`app.wxss:59-73`）。柱状图的正解就是「本色做 background-color，白色/黑色半透明做 background-image 叠上去」—— `rgba(255,255,255,α)` 压在实色上，数学上就等于 `mix(base,#FFF,α)`，与环形图口径一致。

---

## 2. 日支出柱状图

### 2.1 现状实现（已核实）

| 项 | 事实 | 位置 |
|---|---|---|
| 画法 | **WXML `<view>` + WXSS**，无 SVG、无 Canvas | `statistics-panel.wxml:130-139` |
| 柱高 | `barHeightRpx = value / niceMax × zoneRpx`，`zoneRpx = 180` | `statistics-panel.js:120-140`、`:58` |
| 柱宽 | `.bar { width: 60% }`（占列宽 60%） | `statistics-panel.wxss:430-434` |
| 柱体填充 | `linear-gradient(180deg, var(--primary) 0%, var(--primary-deep) 100%)` | `statistics-panel.wxss:435-440` |
| 圆角 | `8rpx 8rpx 0 0` | `statistics-panel.wxss:432` |
| 柱数 | **28~31 根**（整月每一天，含 0 支出日） | `data/statistics/month.js:48-53` |
| 地面 | 只有 0 档网格线 `1px`（`--chart-grid`），柱脚直接贴在线上 | `statistics-panel.wxss:394-403` |

⚠️ 关键数字：375px 屏下卡片内容区 `638rpx → 319px`，减 Y 轴留白 ≈30px，`plotW ≈ 289px`。
**31 列 → 列宽 9.3px、柱宽 5.6px**；12 个月 → 列宽 24.1px、柱宽 14.4px。
（不是任务书里写的 13 根 —— 日支出是 28~31 根，这个差别直接决定 §6 的预算结论。）

### 2.2 套用层级（6 个面，全部落在同一个 view 内）

| 序 | 面 | 位置（占柱高） | 说明 |
|---|---|---|---|
| 1 | 顶倒角边 | 0 ~ 3% | 本色，保轮廓（**不许让高光顶到轮廓线上**，规则 3） |
| 2 | 顶光 | 3 ~ 8% | 混白最高档 |
| 3 | 受光 | 8 ~ 15% | 混白中档 |
| 4 | 柱身 | 15 ~ 80% | 本色，面积最大，不叠任何东西 |
| 5 | 背光 | 80 ~ 93% | 混黑中档 |
| 6 | 接触暗 | 93 ~ 100% | 混黑最高档（柱脚压在槽里的那一截） |
| 7 | 柱后地面槽 | 柱区底部 6rpx 通栏 | 中性色，不属于柱体，见 2.4 |

比例沿用 §1 表格的量级（10.8/20/35/25/15.8 → 取整为 5/7/65/13/7），另加 3% 倒角边。
**这套 6 档是在浏览器里实渲染比对后收紧的**，不是拍脑袋：第一版用 4/10/20/76/92（顶光带占柱高 16%），在 31 根柱的图上矮柱的顶光过重、柱身被挤掉，实渲染对照见 `chart-light-mock.html` 最末一行「未采用」。收紧到 3/8/15/80/93 后顶光带占柱高 12%，大柱有台阶、矮柱自然退化。

### 2.3 具体数值（照抄这一段）

**A. 柱体：把 `linear-gradient` 换成「实色底 + 硬停叠层」**

⚠️ 先说一个会直接让方案失效的点（已核实）：**组件内的 wxss 默认 style isolation 为 `isolated`，页面根上的 `.theme-light` 匹配不进组件内部**。证据：`statistics-panel.wxss` 全文 **0 处** `theme-light` / `theme-dark` 选择器，所有深浅差异一律走 CSS 变量（`var(--primary)`、`var(--chart-grid)`、`var(--text-axis)`…）。
所以**不要写 `.theme-light .bar--exp`**，必须在 `app.wxss` 的主题块里加变量（变量是继承值，穿透隔离边界）。

第一步，`app.wxss` 加 6 个变量（深色块改 `page, .theme-dark`（第 47 行起），浅色块改 `.theme-light`（第 199 行起））：

```css
/* 深色块：page, .theme-dark */
--bar-cap:   rgba(255, 255, 255, 0.38);   /* 顶光 */
--bar-lit:   rgba(255, 255, 255, 0.16);   /* 受光 */
--bar-shade: rgba(0, 0, 0, 0.26);         /* 背光 */
--bar-foot:  rgba(0, 0, 0, 0.48);         /* 接触暗 */
--bar-plate: rgba(0, 0, 0, 0.42);         /* 柱后地面槽底 */
--bar-lip:   rgba(255, 255, 255, 0.10);   /* 槽口高光线 */
```

```css
/* 浅色块：.theme-light */
--bar-cap:   rgba(255, 255, 255, 0.40);
--bar-lit:   rgba(255, 255, 255, 0.18);
--bar-shade: rgba(0, 0, 0, 0.30);
--bar-foot:  rgba(0, 0, 0, 0.44);
--bar-plate: rgba(25, 28, 40, 0.06);
--bar-lip:   rgba(255, 255, 255, 0.60);
```

第二步，`statistics-panel.wxss` 的 `.bar--exp`（现 435-440 行）整条替换为（**一套，不分主题**）：

```css
/* 车削柱：本色做底，白/黑半透明做「硬停」叠层。rgba 白压本色 ≡ mixHex(本色,#FFF,α)。
   深浅差异由 app.wxss 的 --bar-* 变量提供，此处不写 .theme-light 选择器。 */
.bar--exp {
  background-color: var(--primary);
  background-image: linear-gradient(180deg,
    var(--bar-none) 0%,   var(--bar-none) 3%,    /* 1 顶倒角边：本色，保轮廓 */
    var(--bar-cap)  3%,   var(--bar-cap)  8%,    /* 2 顶光 */
    var(--bar-lit)  8%,   var(--bar-lit)  15%,   /* 3 受光 */
    var(--bar-none) 15%,  var(--bar-none) 80%,   /* 4 柱身：透明 = 露本色 */
    var(--bar-shade) 80%, var(--bar-shade) 93%,  /* 5 背光 */
    var(--bar-foot) 93%,  var(--bar-foot) 100%   /* 6 接触暗 */
  );
  box-shadow: none;   /* 保持 v1.4.4 的「去发光」决定，不回退 */
}
```

`--bar-none` 只需在深色块定义一次（**透明不随主题变，继承即可**）：`--bar-none: rgba(255, 255, 255, 0);`

> 变量总数 7 个（6 + `--bar-none`），深色块定义 7、浅色块覆盖 6。

> 浅色比环形图降了 2 个百分点（环形图混黑 30%/52%，这里 30%/44%）：**大面积色块比 1.9 单位的细环带更吃重量**，同样 52% 在黑环上是「内壁」，铺满一根 14px 宽的柱子底部就是「半截黑柱」。

**等价实色 hex（默认靛蓝，仅用于交叉核对，代码里不要写死 —— 4 套主题色 × 深浅共 8 组，写死会漏）**

| 档 | 深色（底 `#7C86FF`） | 浅色（底 `#6E78F5`） |
|---|---|---|
| 顶光 | `#AEB4FF` | `#A8AEF9` |
| 受光 | `#9199FF` | `#8B93F7` |
| 柱身 | `#7C86FF` | `#6E78F5` |
| 背光 | `#5C63BD` | `#4D54AC` |
| 接触暗 | `#404685` | `#3B4184` |

**B. 柱后地面槽（新增 1 个 view，每张柱状图 1 个）**

`statistics-panel.wxml`：在 **`.ca__plot` 的第一个子节点位置**（日支出 130 行 `<view class="ca__plot" ...>` 之后、`<block wx:for="{{dailyAxis.ticks}}">` 之前；年度 368 行同理）插入：

```xml
<view class="ca__plate"></view>
```

```css
/* 柱脚槽：让柱子「站在一条浅槽里」，不是贴在卡片上。
   height 6rpx=3px；中性黑/白，不参与主题色色相合同；深浅值走 --bar-plate / --bar-lip。 */
.ca__plate {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 6rpx;
  background: var(--bar-plate);
  border-top: 1rpx solid var(--bar-lip);
  pointer-events: none;
}
```

⚠️ **必须放在 `.ca__plot` 的第一个子节点**：它同时被「DOM 顺序 = 绘制顺序」约束 ——
放在网格线之后会盖住 0 档网格线（`bottom:0` + `translateY(1px)`，`wxss:394-403`），数据底线的读数依据就没了；放在网格线之前，则网格线和柱子都压在它上面，槽只在柱间空隙露出来，正是要的效果。

### 2.4 为什么不做「逐列暗槽 / 每柱多子层」（元素预算的正面回答）

| 做法 | 元素数（日支出 31 列） | 结论 |
|---|---|---|
| 每柱 5 个子层（照搬环形图 5 层） | 31 × 5 = **155** 个新元素 | ❌ 超预算 3.9 倍 |
| 每柱 1 层 + 逐列暗槽 | 31 × 2 = **62** | ❌ 超 40 |
| 通栏地面槽 + 单元素硬停渐变 | **1** | ✅ 采用 |

另有一条硬理由：`statistics-panel.wxss:362-364` 已经写明「Skyline 下 overflow 行为与 WebView 不同，柱子不能靠裁剪收边」。子层要贴住 8rpx 圆角必须靠父级 `overflow:hidden` 裁剪 —— 这条路本项目已经踩过并放弃了。硬停渐变不依赖任何裁剪。

逐列暗槽还被否掉一次：**0 支出日会露出一截 6rpx 高的槽，和「小额支出」的矮柱（9rpx）难以分辨** —— 那是把光影做成了假数据。

### 2.5 风险（含实测对比度）

| 风险 | 数值 | 判断 |
|---|---|---|
| 浅色下顶光「脏」 | 混白 40% 后 `#A8AEF9` 对白卡片 **2.01:1**（<3:1） | **必然偏弱**。这就是把顶光从 0% 挪到 3% 的原因：轮廓线仍是本体 `#6E78F5`（**3.58:1**），顶光只在倒角内侧发光，读成「倒角」而非「反光」。**刻意如此**，浅色不该有强高光。 |
| 深色下「糊」 | 柱身对卡片 5.78:1；接触暗 `#404685` 对卡片 **2.09:1**（卡片取最亮角 ≈`#14161C`，最暗角更接近 `#0B0C10`，对比只会更高） | 可接受。底部暗档只做「压脚」，不承担读数；柱身 5.78:1 已过图形 3:1。 |
| 短柱（9rpx=4.5px） | 顶光带 = 4.5 × 5% = 0.22px | 退化为单色，**无锯齿**（相邻档色彩差 < 8% 时亚像素混合看不出来）。这是刻意降级：矮柱本来也不该有内部结构。 |
| 31 根窄柱（柱宽 5.6px） | 6 条横带跨 5.6px 全宽，@3x = 16.8 设备像素 | 带子读得出。**不做横向/侧边高光**，5.6px 宽的柱子上侧边光会变成一条 1px 的杂线。 |
| 12 个月标签 | 未改动（字号下限 10px、`requireAll` 保留） | 地面槽在 `.ca__plot` 内，标签在 `.ca__xrow`（34rpx，`wxss:410-415`），**不重叠**。 |

### 2.6 落地改动点

| 文件 | 位置 | 改什么 |
|---|---|---|
| `app.wxss` | 深色块 `page, .theme-dark`（47 行起） | 新增 7 个变量：`--bar-none/-cap/-lit/-shade/-foot/-plate/-lip` |
| `app.wxss` | 浅色块 `.theme-light`（199 行起） | 覆盖 6 个（`--bar-none` 不重复定义） |
| `components/statistics-panel/statistics-panel.wxss` | 430-440 `.bar` / `.bar--exp` | 换 `.bar--exp` 的 `background-color` + `background-image` |
| 同上 | 403 行后 | 新增 `.ca__plate` |
| `components/statistics-panel/statistics-panel.wxml` | 130 行内、`<block wx:for="{{dailyAxis.ticks}}">` 前 | 插入 `<view class="ca__plate"></view>` |
| `components/statistics-panel/statistics-panel.js` | 无 | **不改**。柱高算法、nice 刻度、标签抽稀一行都不动 |

---

## 3. 年度 12 个月柱状图

### 3.1 现状实现（已核实）

同一组件、同一段结构：`statistics-panel.wxml:368-377`；柱区高 `zoneRpx = 200`（`statistics-panel.js:59`）；数据 `this.data.monthly`，12 个点全保留标签（`requireAll`）。

### 3.2 套用层级 / 3.3 数值

**与 §2 完全一致**（同一组 `.bar--exp` 规则、同一个 `.ca__plate`）。不需要第二套参数 —— 这正是把光影写进 class 而不是写进 `style` 的原因。

差异只在下表：

| 项 | 日支出 | 年度 12 月 | 影响 |
|---|---|---|---|
| 柱数 | 28~31 | 12 | 年度柱宽 14.4px，明暗台阶更清楚 |
| 柱区高 | 180rpx | 200rpx | 顶光带 = 100px × 6% = 6px（视觉最舒服的一档） |
| 可点 | 否 | 是（`.bar-col--tap:active` 整列 `opacity 0.55`） | 见下方风险 |

### 3.4 风险

- **`active` 压暗会吃掉台阶**：`opacity 0.55` 落在整列上，按下时 6 档台阶的对比同步降到 55%，看起来「糊了」。取舍是**不改** —— 按下的 200ms 里用户看的是「我点到了没」，不是「这柱多高」；改它反而会和 `.bar-col--tap:active` 的既有统一交互冲突（全项目都在用这个反馈）。**这条写进 §7 取舍清单。**
- 12 根柱、柱宽 14.4px、@3x = 43 设备像素：6 条带全部清晰，无失真。

### 3.5 落地改动点

同 §2.6，一次改动同时生效于两张图（`.bar--exp` 是共用 class）。**年度图只需补 1 行 wxml**（`<view class="ca__plate">`）。

---

## 4. 累计支出折线

### 4.1 现状实现（已核实）

| 项 | 事实 | 位置 |
|---|---|---|
| 画法 | **SVG 字符串 → base64 → `<image mode="scaleToFill">`** | `cumulative-trend.wxml:2`、`cumulative-trend.js:205` |
| 生成函数 | `buildCumulativeSVG(points, max, gridColor, box, opts)` | `data/statistics/cumulative.js:122-175` |
| 几何 | `viewBox` = 显示盒像素（1:1），`strokeW = min(w,h) × 0.012` | `cumulative.js:81`、`:126` |
| 线色 | 运行时 `theme.getAccentPalette().primary`（随 4 套主题色变） | `cumulative-trend.js:89-96` |
| 现有元素 | 网格 ≤3 条 `<line>` + 面积 `<path>` + 折线 `<path>` + 末端 `<circle>` = **6 个** | `cumulative.js:154-173` |
| 面积 | `fill=lineColor fill-opacity=0.18`，单档平铺，**无渐变** | `cumulative.js:169` |

375px 屏实测几何：盒子 319×180，`padT=18`、`padB=21.6`、`strokeW = 180 × 0.012 = 2.16px`。（`w=319,h=180` → `min=180`）

### 4.2 套用层级

折线的「截面」是**线的粗细**（规则 2），所以只有 3 个面：

| 序 | 面 | 几何 |
|---|---|---|
| 1 | 暗缘（两侧各 0.75px） | 同一条 `d`，`stroke-width = strokeW + 1.5`，先画 |
| 2 | 本体 | 同一条 `d`，`stroke-width = strokeW`，色 = lineColor，后画盖住中线 |
| 3 | 高光（贴在线顶沿内侧） | 同一条 `d`，`stroke-width = 0.99`，整体上移 0.62px |

**线下面积不做台阶**（理由见 §7）：保持单档，只把 `fill-opacity` 从 0.18 降到 0.15（深）/ 0.13（浅），因为线加了两道描边后，面积再维持原强度会把线压住。

### 4.3 具体数值

`data/statistics/cumulative.js` 的 `buildCumulativeSVG`，在 return 之前插入（`strokeW` 用 `geo.strokeW`）：

```js
// 文件头新增：const { mixHex } = require('../../utils/color-mix');
// buildCumulativeSVG 里、area/line 拼好之后、return 之前：
const isLight = o.theme === 'light';
// 车削折线：同一条 d 描三遍。颜色全部由一个 mixHex 派生，色相不变 → 不动颜色合同。
const rimW  = r2(geo.strokeW + 1.5);                       // 深色/浅色同值
const specW = r2(Math.max(0.8, geo.strokeW * 0.46));       // 319×180 下 = 0.99
const RIM  = mixHex(lineColor, '#000000', isLight ? 0.28 : 0.34);
const SPEC = mixHex(lineColor, '#FFFFFF', isLight ? 0.52 : 0.42);
const specDy = isLight ? -0.55 : -0.62;                    // px，向 y 负方向 = 上移
```

return 里改成这个顺序（**顺序不能变**，暗缘必须在最下、本体盖中线、高光最后）：

```js
return (
  open +
  grids +
  // 1 面积（单档，透明度下调）
  '<path d="' + area + '" fill="' + lineColor + '" fill-opacity="' + (isLight ? 0.13 : 0.15) + '" stroke="none"/>' +
  // 2 暗缘：宽 1.5 的暗描边垫在底下，本体压上去后两侧各露 0.75px
  '<path d="' + line + '" fill="none" stroke="' + RIM + '" stroke-width="' + rimW + '" ' +
    'stroke-linejoin="round" stroke-linecap="round"/>' +
  // 3 本体
  '<path d="' + line + '" fill="none" stroke="' + lineColor + '" stroke-width="' + geo.strokeW + '" ' +
    'stroke-linejoin="round" stroke-linecap="round"/>' +
  // 4 高光：上移 specDy，落在线顶沿内侧
  '<path d="' + line + '" fill="none" stroke="' + SPEC + '" stroke-width="' + specW + '" ' +
    'stroke-linejoin="round" stroke-linecap="round" transform="translate(0 ' + specDy + ')"/>' +
  // 5 末端点（不变）
  '<circle cx="' + last.x + '" cy="' + last.y + '" r="' + dotR + '" fill="' + lineColor + '"/>' +
  '</svg>'
);
```

`isLight` 由组件传入（`opts.theme`，`'light' | 'dark'`，缺省 `'dark'`），**不要在 pure 模块里读 `wx`** —— 该文件头注释已明确「本模块不读主题」。

`mixHex` 目前**不存在**（只有 mock 里有）。新增纯函数文件 `utils/color-mix.js`：

```js
/** '#RRGGBB' 朝 target('#RRGGBB') 混合 t(0..1)，输出 '#RRGGBB'。非法输入原样返回底色，不抛。 */
function mixHex(hex, target, t) { /* 与 donut-mock.html 中 mixHex 同实现，24 行内 */ }
module.exports = { mixHex };
```

⛔ **不要往 `data/statistics/donut.js` 里加** —— 寇豆码正在改那个文件，加函数会撞车。也⛔ 不要给 `donut.js` 的 `buildDonutSVG` 传新参数。

**深色 / 浅色两套 hex（默认靛蓝，交叉核对用）**

| 面 | 深色（lineColor `#7C86FF`） | 浅色（`#6E78F5`） |
|---|---|---|
| 暗缘 | `#5258A8`（混黑 34%） | `#4F56B0`（混黑 28%） |
| 本体 | `#7C86FF` | `#6E78F5` |
| 高光 | `#B3B9FF`（混白 42%） | `#B9BEFA`（混白 52%） |
| 面积 | 本体 + `fill-opacity 0.15` | 本体 + `fill-opacity 0.13` |

### 4.4 风险

| 风险 | 数值 | 判断 |
|---|---|---|
| 暗缘在深色下看不见 | `#5258A8` 对卡片 **2.86:1** | 接近 3:1，作为「边缘」够用（它不承载读数，柱身/线本体才是 5.78:1）。若真机实测发灰，把 0.34 降到 0.26 即可，不必改结构。 |
| 高光把线「漂白」 | `#B3B9FF` 对卡片 9.73:1 | 安全。宽度只有 0.99px，不会改变线的视觉粗细（本体 2.16px 仍在）。 |
| **尖角处暗缘外翻** | 累计线是阶梯上升，`linejoin="round"` 在凹角处会让 3.66px 的暗缘比 2.16px 的本体多露出 0.75×√2 ≈ 1.06px | 可接受，读作「圆角接头的侧壁」。**不做 bevel/miter**：改 join 会让整条线的接头形状变，属于几何变更。 |
| 1 个点时退化 | `n=1` 时 `line` 是 `M x y`，三描边都画出**一个圆点**（linecap=round） | 直径 2.16 / 3.66 / 0.99 同心圆 = 一个小圆环，**符合预期**（单点本来就该是一个点），不糊。 |
| 体积增长 | 3 条同 `d` 的 path，每条 `d` 在 31 点时约 780 字节 → +1560 字节，base64 后约 +2080 | 现状 SVG 约 2~3KB，增量 < 一倍，`<image>` 无压力。可打 `diagLog` 核对。 |
| 浅色下面积偏灰 | `#6E78F5` @0.13 叠白卡片 | 浅色面积本来就该比深色淡（视觉重量在白底上放大），13% 是实测看起来「有面、不脏」的一档。 |

### 4.5 落地改动点

| 文件 | 位置 | 改什么 |
|---|---|---|
| `utils/color-mix.js` | 新建 | `mixHex`（唯一必需导出） |
| `data/statistics/cumulative.js` | 122-175 `buildCumulativeSVG` | 加 `rimW/specW/RIM/SPEC/specDy` 5 个局部量；return 里插 2 条 path、面积 opacity 改值；`opts.theme` 新增（缺省 `'dark'`） |
| `data/statistics/cumulative.js` | 177-190 `module.exports` | 无需新增导出（除测试想单测 mixHex） |
| `components/cumulative-trend/cumulative-trend.js` | 168-175 调 `buildCumulativeSVG` 处 | 传 `theme: theme.getEffectiveTheme() === 'light' ? 'light' : 'dark'` |
| `data/statistics/cumulative.test.js`（若存在） | — | 断言的元素数量若写死 6，改成 8 |

---

## 5. 日价曲线

### 5.1 现状实现（已核实）

| 项 | 事实 | 位置 |
|---|---|---|
| 画法 | **原生 Canvas 2D**（`type="2d"` + dpr 缩放） | `daily-value-curve.wxml:2-10`、`.js:114-138` |
| 绘制入口 | `draw(highlightIdx)` | `daily-value-curve.js:163-244` |
| 布局 | `padL=10 padR=10 padT=18 padB=26`，`ch = 380rpx/2 - 44 ≈ 146px` | `.js:146-153` |
| 线 | `lineWidth = 2`，`lineJoin='round'`（**无 lineCap**，默认 butt） | `.js:214-217` |
| 面积 | `createLinearGradient` 从上 `rgba(primary,0.32)` 到 `rgba(primary,0)` | `.js:190-204`、`:22` `:30` |
| 底色 | `rgba` 全部走 `hexToRgbTriple()` 拼字符串 | `.js:36-44` |

### 5.2 套用层级

与 §4 同构（截面 = 线粗），Canvas 里额外多一个「面积」面：

| 序 | 面 | 手法 |
|---|---|---|
| 1 | 面积 | 保留渐变（Canvas 渐变是原生能力，不是 SVG 的 `url(#)`），只降 α |
| 2 | 0 档地面线 | 在 `baseY` 画 1px 主色 30% 的线（现在那里只有 `pal.grid` 的白 6%，几乎看不见） |
| 3 | 折线暗缘 | 同路径 `lineWidth 3.4` |
| 4 | 折线本体 | `lineWidth 2`（不变） |
| 5 | 折线高光 | 同路径 `lineWidth 0.9`，整体上移 |

### 5.3 具体数值

`PALETTES`（`.js:16-33`）新增 4 个字段：

```js
dark: {
  /* 原 grid / gridLabel / xLabel / hlDot 保持不动 */
  areaAlpha: 0.26,        // 原 0.32（线加粗后降面积，避免抢主体）
  rimMix: 0.34,           // 暗缘 = mixHex(primary, #000, 0.34)
  specMix: 0.40,          // 高光 = mixHex(primary, #FFF, 0.40)
  specDy: -0.55,          // px
  specW: 0.9,             // px
  rimExtra: 1.4,          // 暗缘比本体每边宽 0.7px
  floorAlpha: 0.30,       // 0 档地面线
},
light: {
  areaAlpha: 0.18,        // 原 0.22
  rimMix: 0.28,
  specMix: 0.50,
  specDy: -0.50,
  specW: 0.9,
  rimExtra: 1.4,
  floorAlpha: 0.26,
},
```

`palette()`（`.js:46-66`）返回值补：`rim`、`spec`、`specDy`、`specW`、`rimW = 2 + rimExtra`、`floor`（`rgba(rgb,floorAlpha)`）。

`draw()` 的绘制顺序改为（**替换 190-217 行这段**）：

```js
// 1 面积渐变（α 已下调，见 PALETTES）
//    ...原 190-204 行代码一字不改，只靠 pal.areaAlpha 生效...

// 2 0 档地面线：面积落地处的一条「接触线」，比网格线实一档
ctx.beginPath();
ctx.moveTo(L.padL, L.padT + L.ch);
ctx.lineTo(L.padL + L.cw, L.padT + L.ch);
ctx.strokeStyle = pal.floor;
ctx.lineWidth = 1;
ctx.stroke();

// 3-5 折线三描边：同一个 path 画三遍
const tracePath = () => {
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xAt(i), y = yAt(p.valueCents);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
};
ctx.lineJoin = 'round';

tracePath();                              // 暗缘
ctx.strokeStyle = pal.rim;
ctx.lineWidth = pal.rimW;                 // 3.4
ctx.stroke();

tracePath();                              // 本体
ctx.strokeStyle = pal.line;
ctx.lineWidth = 2;
ctx.stroke();

ctx.save();                               // 高光：整体上移
ctx.translate(0, pal.specDy);
tracePath();
ctx.strokeStyle = pal.spec;
ctx.lineWidth = pal.specW;                // 0.9
ctx.stroke();
ctx.restore();
```

> 注意：`tracePath` 是**同一套 `xAt/yAt`**，没有任何坐标被改动 —— 数据几何零变更。
> `ctx.save()/restore()` 只管 transform，不动 `lineJoin`/`strokeStyle` 之外的状态。

**深色 / 浅色两套 hex（默认靛蓝，核对用）**

| 面 | 深色（primary `#7C86FF`） | 浅色（`#6E78F5`） |
|---|---|---|
| 暗缘 | `#5258A8` | `#4F56B0` |
| 本体 | `#7C86FF` | `#6E78F5` |
| 高光 | `#B3B9FF` | `#B9BEFA` |
| 面积顶 α | 0.26 | 0.18 |
| 地面线 | `rgba(124,134,255,0.30)` | `rgba(110,120,245,0.26)` |

### 5.4 风险

| 风险 | 数值 | 判断 |
|---|---|---|
| 高光在无 `lineCap` 的短段上超出端点 | 默认 `butt`，端点齐平，上移 0.55px 后高光端头与本体端头**平行错开 0.55px** | 视觉读作「顶沿的一条光」；**不要改成 `round`**，改了会让线两端各多出 0.45px 的圆头，与既有形态不一致。 |
| 触摸高亮点被压住 | `hlDot` 半径 5、`hlRing` 半径 8 在**三描边之后**绘制（`.js:229-243`），不受影响 | 安全，不用改。 |
| 地面线与 0 档网格线重叠 | 两者都在 `padT+ch`：网格白 6% + 主色 30% | 叠加后是一条「带色的底线」，正是要的效果；不会读成数据。 |
| 面积梯度在数据抖动时视觉位置漂移 | 渐变从 `padT` 到 `padT+ch` 固定，而面积上边界随数据走 | 这是既有行为，**本次不修**（要修得改成按折线起算的渐变，属于另一个改动）。 |
| 浅色下面积 0.18 与地面线 0.26 抢 | `#6E78F5` 30% 在白卡片上约 1.6:1 | 地面线是结构线，弱是应该的；不追求对比度。 |

### 5.5 落地改动点

| 文件 | 位置 | 改什么 |
|---|---|---|
| `components/daily-value-curve/daily-value-curve.js` | 16-33 `PALETTES` | 新增 7 个字段（2 套） |
| 同上 | 46-66 `palette()` | 补 `rim/spec/specDy/specW/rimW/floor` |
| 同上 | 190-217 | 面积保持、插入地面线、折线改三描边 |
| `utils/color-mix.js` | 新建 | `mixHex`（与 §4.5 同一个文件，**只建一次**） |

---

## 6. 元素预算（逐图算给你看）

| 图 | 元素构成 | 现状 | 落地后 | 增量 |
|---|---|---|---|---|
| 日支出柱 | 31 柱 + 31 标签 + 3 刻度字 + 3 网格 + **1 地面槽** | 68 | 69 | **+1** |
| 年度 12 月柱 | 12 + 12 + 3 + 3 + **1** | 30 | 31 | **+1** |
| 累计折线（SVG 节点） | 3 网格 + 1 面积 + **1 暗缘 + 1 本体(原) + 1 高光** + 1 端点 | 6 | 8 | **+2** |
| 日价曲线 | Canvas，无 DOM 子节点 | 0 | 0 | **0** |

**环形图之外合计新增：DOM 2 个 + SVG 节点 2 个 = 4 个。**
对照任务书的 40 上限：**没有一张图接近**，也没有一张图需要降层 —— 因为「多层」全部被压进了单元素的背景/同路径描边里，而不是叠视图。

被放弃的高成本方案（已核算）：每柱 5 层 = 155（日）/ 60（年），逐列暗槽 + 1 层 = 62（日）。

---

## 7. 我的取舍（刻意不做的，附理由）

1. **柱状图不做逐列暗槽**，只做通栏地面槽。理由两条：31 列 × 2 层 = 62 元素；且 0 支出日的槽和 9rpx 的矮柱无法区分，等于用光影伪造数据。
2. **柱状图不做侧边竖高光**。柱宽 5.6px，侧边光在 @3x 下只有 3 设备像素，会变成一条杂线；只有年度图（14.4px 宽）放得下，但同一个 class 服务两张图，不为一张图开分叉。
3. **累计折线的面积不做台阶**。SVG 里禁 `rgba()`、`url(#gradient)` 未验证、`clipPath` 未验证，唯一能做「按 y 切档」的办法是把面积按 y 档切成多条闭合路径 —— 那要在每个 y 档与折线求交，几何复杂、易错点比例尺，收益只有「面积看起来更厚」。改单档透明度 0.15/0.13 已足够。
4. **不改 `.bar-col--tap:active { opacity: 0.55 }`**。按下 200ms 用户看的是「点到了没」，此时台阶对比下降到 55% 无所谓；改它会和全项目的按下反馈不统一。
5. **不改环形图相关任何文件**（`data/statistics/donut.js`、`components/category-donut/*`）。寇豆码正在改，且客户已经确认 A 的环形参数。
6. **不做「柱体沿时间轴渐变」**。规则 2：长度方向的明暗会被读成趋势。
7. **不给 4 套主题色各写一组 hex**。柱状图用 `rgba` 叠层、折线/Canvas 用运行时 `mixHex(primary)`，8 组主题自动适配，写死 40 个 hex 才是维护地狱。
8. **样张只做到「数值核对」这一层，不做 4 张图全套**（已产出，见 §11）。柱状图与折线已实渲染核对并据此改过一版数值；日价曲线是 Canvas，浏览器样张无法代表 Skyline 的 Canvas 表现，**交由真机验收**，不额外做样张。

---

## 8. 需要核实的三件事（不许当成「应该可以」）

1. **Skyline 是否支持「多色标硬停渐变」**（同一位置两个色标，例如 `var(--bar-cap) 10%, var(--bar-lit) 10%`）。
   现状只用到 2 色标软过渡（`app.wxss:62`），8 色标硬停**没有在本项目验证过**。→ **【需生态核实 / 需真机核对】**，找滕观澜或真机跑一次。
   若被渲染成软过渡：视觉退化为「平滑渐变」，柱子仍可用、台阶感消失，**不影响数据**；此时改用降级方案（见下）。
2. **`background-color` + `background-image` 双层是否按预期叠放**（WXSS 里）。这是 CSS 标准行为，但 Skyline 是自绘管线，需真机截图确认一次（1 分钟）。
3. **`var()` 作为渐变里的色标是否可用**。项目里 `var()` 只用在单值属性（`--primary`、`--chart-grid` 等），**从未出现在 `linear-gradient()` 的色标位置**。→ **【需真机核对】**。
   若 3 不成立，降级方案 B：在 `.ca` 根节点挂 JS 计算的 class（组件里已有现成方法 `shareThemeKey()` 返回 `'light' | 'dark'`，`statistics-panel.js:498-503`），写 `.ca--light .bar--exp { … }` 两套 —— 代价是渐变要写两遍，但样式隔离内是合法的（同组件内的 class 组合）。

**降级方案（若 1 或 2 不成立）**：把 6 档压成 3 档（`0–4% 本色 / 4–18% 混白 / 18–82% 本色 / 82–100% 混黑`），并把渐变换成**纯实色 `#RRGGBB` 4 色标**（不依赖 `background-color` 打底、不依赖 `var()`），代价是丧失「受光/背光」两个中间档，且 8 种主题组合要各写一组 hex。3 档的观感损失小于元素翻倍的成本。

---

## 9. 开发自检清单（1:1 还原验收）

- [ ] 柱状图柱高与改动前**像素一致**（截图对照同一份数据，柱子外轮廓不得变动）
- [ ] **组件 wxss 里没有出现 `.theme-light` / `.theme-dark` 选择器**（样式隔离，写了也不生效）
- [ ] 12 个月标签仍 12 个全在、字号 ≥10px
- [ ] 0 支出日不出现任何可见的「假柱」（地面槽通栏连续才算对）
- [ ] 累计折线：3 条 path 的 `d` 完全一致（可直接比对字符串）
- [ ] 日价曲线：`xAt/yAt` 未被改写，只多画了两遍
- [ ] 8 种主题组合（4 accent × 深浅）各截 1 张：柱身色相未变、只是明暗变
- [ ] 深色 / 浅色各验一张 31 柱（当月 31 天）和一张 12 柱
- [ ] 累计折线单点数据（`points.length === 1`）不报错、不画歪

---

## 10. 云端可配说明（回应「少传一次审核」）

本套改动**不建议做成云端可配**，理由是可量化的：

- 参数全是**纯视觉常量**（混白/混黑百分比、档位占比、槽高 6rpx），半年内客户不会改 —— 按判据「未来半年客户大概率会改吗」，答案是否。
- 云端下发颜色参数会在冷启动时产生一次「先按默认色画、拿到配置再重画」的闪烁（本项目图都是**生成后交给 `<image>`/Canvas 绘制**的，重画就是整图重绘，可见），体验代价 > 灵活性收益。
- 若未来要做「主题市场 / 皮肤」，正确做法是**加第 5 套 accent class**（`app.wxss` 已有 4 套 × 2 模式的成熟结构），依然不需要云端下发参数。

唯一值得云端可配的是**文案**（如「本月还没有支出」），但那不属于本次光影改动范围，登记到支线。


---

## 11. 实渲染核对记录（这份规格不是纸上推演）

样张：`docs/design/chart-light-mock.html`（单文件，双击即开，无外部依赖）。
做法：内联脚本复刻 `buildBarChart` 的 rpx 换算与 nice 顶档、复刻 `buildCumulativeSVG` 的三描边，柱图用与规格完全相同的 CSS 规则 + 同一组 `--bar-*` 变量；折线走真 `data:image/svg+xml → <img>` 管线。逐张在 1060×1500 与 560×900 两种视口、deviceScaleFactor 2 与 3 下渲过。

**改动（都是先渲后改，不是拍脑袋）**

| 发现 | 改了什么 |
|---|---|
| 第一版 6 档用 `4/10/20/76/92`，顶光带占柱高 16%；31 根柱里矮柱（9~18rpx）被顶光吃掉大半，柱身只剩一条，读起来像「两根叠在一起的短棒」 | 收紧为 `3/8/15/80/93`（顶光带 12%），矮柱退化为单色，高柱保留台阶。原方案留在样张末行标「未采用」 |
| 顶光若从 0% 起，浅色下柱顶混白 40% 后对白卡片只有 **2.01:1**，柱子轮廓消失 | 顶光起点从 0% 挪到 3%，顶上留 3% 本色「倒角边」，轮廓线维持 **3.58:1** |
| 折线暗缘按 `strokeW + 2.0` 预估时，线读起来像「管子」 | 收到 `strokeW + 1.5`（每侧露 0.75px），高光宽度 `strokeW × 0.46 = 0.99px` |

**核对到的、与预期一致的**

- 31 根柱、柱宽 5.6px 时，6 条横带清晰可辨，无锯齿、无误读；12 根柱（柱宽 14.4px）台阶最清楚。
- 地面槽在柱间空隙是一条连续暗带，柱脚压上去后自然形成「站在槽里」的关系；0 支出日不会被看成矮柱。
- 折线在 319×180 下：暗缘、本体、高光三层同心，无错位；末端圆点正常；单点数据退化为一枚同心圆点。
- 面积单档（0.15 / 0.13）在深色下呈「实体块」而非「雾状渐变」，与 A 的材质感一致。

**样张证明不了的（仍需真机）**

- Skyline 的渐变硬停与 `var()` 色标（§8 第 1、3 条）。
- Canvas 的日价曲线（浏览器 Canvas 与小程序 Canvas 2D 的 `save/translate` 行为一致，但抗锯齿与 dpr 缩放要真机看）。
- 字体与刻度文字的实际像素宽度（样张用 `font-size:11px` 近似，线上是 JS 算的 `axisGutterPx`）。
