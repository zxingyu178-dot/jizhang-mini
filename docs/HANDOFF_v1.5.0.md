# HANDOFF — v1.5.0 环形图立体感（车削双层环）

> 项目：`D:\AIHome_2.0_L1_L2\projects\jizhang-mini`
> 版本：1.5.0 · 日期：2026-11-11
> 客户：C 类技术方（可读代码、看数字、接受技术结论）

---

## 1. 本版范围

**只做一件事**：分类占比环形图（`category-donut`）的立体感重做。

**不做**（明确排除，非遗漏）：
- 数据合同（Bill V3 / Backup V3 / Recurring Store V1 / Budget V1）——零改动
- 统计口径、`computeCategoryShare` 计算——零改动
- 分类色相（黄金角确定性配色）——零改动
- 交互（点击钻取 / 长按 / 中心文字选中态）——零改动
- 其余三张图的光影——已出规格，**1.5.1 落地**

---

## 2. 根因

原实现是一条 12 单位宽的**纯色**描边一次性铺满环带。纯色只能表达「面积」，表达不了「厚度」——所以无论怎么调颜色，读起来都是「贴在卡片上的彩带」而不是一个物件。

**立体感缺失的根因是「环带内部没有明暗方向」**，不是配色问题。

---

## 3. 改动

### 3.1 `data/statistics/donut.js`（+155 / −32）

新增常量（参数唯一事实源：`docs/design/donut-mock.html` 的 `key:'A'`）：

```js
const DONUT_GAP = 0.9;          // 段间细缝
const TRACK_STROKE = 12.8;      // 底槽描边宽
const SELECT_SHIFT = 1.5;       // 选中态整层外移
const TRACK_SPEC = {
  dark:  { color: '#000000', opacity: 0.45 },
  light: { color: '#191C28', opacity: 0.10 },
};
const DONUT_LAYERS = [
  { r: 40.20, w: 4.2, tone: 'base' },
  { r: 45.35, w: 1.3, tone: 'light', amt: { dark: 0.38, light: 0.55 } },
  { r: 43.50, w: 2.4, tone: 'light', amt: { dark: 0.14, light: 0.22 } },
  { r: 36.60, w: 3.0, tone: 'dark',  amt: { dark: 0.26, light: 0.30 } },
  { r: 34.15, w: 1.9, tone: 'dark',  amt: { dark: 0.48, light: 0.52 } },
];
```

新增纯函数：`mixHex(hex, target, t)`（RGB 等比插值，色相不变）、`num3`、`numTrim`、`layerColor`。

`buildDonutSVG` 重写拼装循环：

```js
const spanRad = a.ratio * TAU - gapRad;
const baseOffsetRad = a.startRatio * TAU + gapRad / 2;
DONUT_LAYERS.forEach((L) => {
  const r = L.r + shift;
  const dash = Math.max(MIN_DASH, spanRad * r);
  const rest = Math.max(0, TAU * r - dash);
  const offset = -baseOffsetRad * r;
  // ...<circle> 拼装
});
```

**几何常量 `RADIUS=40` / `STROKE=12` / `CENTER=50` / `CIRCUMFERENCE` 全部未动。**

### 3.2 `components/category-donut/category-donut.js`（+12 / −8）
- `TRACK_COLORS` 本地表删除，改从 `donut.TRACK_SPEC` 单点取
- 诊断字段新增 `circleCount`

### 3.3 设计资产（新增）
| 文件 | 用途 |
|---|---|
| `docs/design/donut-mock.html` | 4 方向并排样张（现状 / A / B / C），深浅双主题、6/12 段、150/180px 可切 |
| `docs/design/chart-light-spec.md` | 其余三张图的同套光影参数表（1.5.1 用） |

---

## 4. 两条必须记住的实现细节

### 4.1 多层不能共用同一份 `stroke-dasharray`
`stroke-dasharray` 量的是**该圆自己的周长**。R=40 与 R=45.35 周长差 13%，共用同一份 dash 会让五层端点各自错开，画出来是放射状扇骨／锯齿。

正确写法：**先在角度域算占比，再乘该层半径**。
- `dash = (ratio × 2π − 缝宽弧度) × r`
- `offset = −(累计比例 × 2π + 缝宽弧度 / 2) × r`
- `rest = 2πr − dash`

### 4.2 不用 `stroke-linecap="round"`
每层 `stroke-width` 不同，圆头会让各层端点外扩不同的 `w/2`，端点立刻错位。要圆头只能单层，并从 dash 里各减一个 `stroke-width` 补偿两端。

### 4.3 单段不切缝
占比 100%（或脏数据钳制后只剩一段）时 `gapRad = 0`。整圈留一个孤零零的缺口会被读成渲染 bug。

### 4.4 dash 必须兜底
`Math.max(MIN_DASH, …)`，`MIN_DASH = 0.2`。负数或 NaN 会让整条弧不画，而现场分不清是数据脏了还是渲染不支持。

---

## 5. 验证

### 5.1 已通过
| 项 | 结果 |
|---|---|
| `npm test` | **53/53 全通过**（含 `donut-render.test.js` 从旧断言扩到 206 行新增） |
| `npm run release:check` | FAIL 0 / WARN 0 |
| 颜色格式静态断言 | `hasRgba=false` `hasHsl=false` `hasNaN=false`（Skyline 硬约束） |
| 元素数 / 体积（5 段） | 26 个圆 · SVG 4,596 字节 · base64 6,158 |
| 元素数 / 体积（12 段上限） | 61 个圆 · SVG 10,691 字节（改动前 13 个 / 3,048） |
| 离线渲染（深浅 × 5/12 段 + 选中态） | 逐张肉眼确认：明暗台阶成立、缝均匀、**无扇骨**、无整段消失 |
| 模拟器真实渲染（5 段 · 浅色） | `imgStatus: load`，截图放大确认外缘亮边 + 内侧暗边 + 段间细缝 |

### 5.2 未取到（**如实记录，不要当成已验**）
1. **深色主题的模拟器取证失败**：自动化脚本执行「切到 dark」后 `diagSnapshot.theme` 仍为 `light`，`seg6_dark` 与 `seg6_light` 截图字节数完全相同（163,060）。判定为**该会话主题切换未生效**，不是组件读错档位（`getEffectiveTheme()` 返回的 `_effective` 与 `getThemeClass()` 同源，机制上同步）。
   → 深色参数（混白 38% / 14%）目前只有离线渲染证据，**需真机确认**。
2. **12 段的模拟器取证失败**：脚本「直接给组件赋值 12 段」那一步诊断返回 `null`，截到的仍是 5 段真实数据。12 段几何只有离线渲染证据。
3. **真机未测。**

### 5.3 自动化环境问题（供后续排查）
- 开发者工具若**不带 `--auto-port`** 重启，9420 端口不会监听，`ensureAutomation` 会一直等到 120s 超时。本版期间遇到两次。
- 截图**不可写入项目目录**：IDE 监听项目文件，写入即触发重编译 → 模拟器 reload → WebSocket 失步 → 之后所有命令报 `timeout waiting for automator response`。`tests/e2e/config.js` 的 `SHOT_STAGE_DIR` 就是为这个存在的，别绕过它。

---

## 6. 风险与后续

| # | 事项 | 影响 | 处理 |
|---|---|---|---|
| 1 | 深色主题效果未在模拟器/真机取证 | 深色下五层明暗差比浅色大（38% vs 55% 反而是浅色更大），理论上更明显，但未验证 | 真机验收时重点看深色环形图 |
| 2 | 环形图配色会集中在某一色系 | 5 段时若分类 id 的黄金角哈希落在同一色相区间，会出现「一大片紫」（本次离线样张就是这个情况）。这是既有配色合同的结果，不是本次改动引入 | 若要改，属**配色合同变更**，需单独立项 |
| 3 | 其余三张图未做 | 客户要求「环形图 + 其余图表统一光影」，本版只交付环形图 | **1.5.1** 按 `docs/design/chart-light-spec.md` 落地 |
| 4 | 柱状图方案依赖「单元素硬停渐变」 | `linear-gradient` 在 Skyline 下的支持已确认（官方类型表 ✓、色标位置支持 %），但**同一位置两个色标的硬停**没有项目内先例 | `chart-light-spec.md` §2 已列，1.5.1 开工前先用一个临时元素实测 |

---

## 7. 下一步（1.5.1）

按 `docs/design/chart-light-spec.md` 落地其余三张图：
1. **先做 5 分钟前置验证**：在模拟器里给一个临时 `view` 设硬停渐变（`linear-gradient(to top, #f00 0%, #f00 50%, #00f 50%, #00f 100%)`），截图确认是否为硬边。不成立则柱状图改用「每根柱 2 个绝对定位子元素」的降级方案。
2. 柱状图（每日花费 + 年度 12 月）：单元素硬停渐变，0 新增元素 + 1 个地面槽
3. 累计折线：同一路径描三遍（暗缘 / 本体 / 高光），+2 个 `<path>`
4. 日价曲线（Canvas 2D）：同一 path 描三遍，0 新增元素
5. 全部保持：不改色相、不用 filter、不牺牲数据几何

---

## 8. 相关文件

| 文件 | 说明 |
|---|---|
| `data/statistics/donut.js` | 环形图纯计算与 SVG 拼装（本版核心） |
| `components/category-donut/` | 组件（wxml/js/wxss 共 410 行） |
| `tests/donut-render.test.js` | 渲染断言（本版新增 206 行） |
| `tests/e2e/donut-depth-shots.js` | 模拟器取证脚本（含失步重连） |
| `docs/design/donut-mock.html` | 4 方向样张 |
| `docs/design/chart-light-spec.md` | 其余图表光影规格（1.5.1 用） |
