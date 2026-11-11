# HANDOFF — v1.5.3（柱状图 6 档明暗台阶落地）

> 项目：`D:\AIHome_2.0_L1_L2\projects\jizhang-mini` · 日期：2026-11-11
> 上一版 1.5.2 是「台阶没做成的更正版」，本版把它真正做出来了。

---

## 1. 一句话结论

统计页四张图现在**同一套材质**：环形图（5 层同心弧）· 累计折线（描三遍）· 日价曲线（描三遍）· 两张柱状图（6 档明暗台阶）。柱子从「31 个 view」变成「每张图 1 个 `<image>`」，且台阶已在模拟器截图里**逐像素验证存在**。

---

## 2. 改了什么

| 文件 | 改动 |
|---|---|
| `utils/bar-shading.js`（新增） | 6 档台阶的**唯一实现**：档位定义 `3/5/7/65/13/7 %`、两套混色比例、`bandHeights()`（每档保底 1px + 最大余数法，小柱不掉档）、`roundedTopPath()`（只圆顶部两角，避免 `<rect rx>` 四角全圆）、`buildBarsSVG()`。纯函数，Node 里可直接测 |
| `components/statistics-panel/statistics-panel.js` | 新增 `barUri()` / `barBoxPx()` / `barPalette()`；在 `loadMonth` / `loadYear` / `rebuildAxis` / `recolorForTheme` 四处重算图源；月份柱点击改为「坐标反查列号」 |
| `components/statistics-panel/statistics-panel.wxml` | 两处 31 个 bar view → 各 1 个 `<image mode="scaleToFill">`；月度柱区加 `id="monthlyPlot"` |
| `components/statistics-panel/statistics-panel.wxss` | 删 `.bar` / `.bar--exp`，新增 `.ca__bars-img`（绝对定位铺满、不参与 flex） |
| `tests/chart-axis.test.js` | 新增柱体台阶断言（档位边界、每档 ≥1px、合计严格等于柱高、矮柱退化、顶部圆角不外溢、mixHex 实色、深/浅两套档位色） |
| `tests/e2e/bar-shading-shots.js`（新增） | 模拟器取证：四阶段（年度/月度 × 深/浅）截图 + 逐像素采样 |
| `tests/e2e/png-lite.js`（新增） | 零依赖 PNG 编解码（zlib inflate + 反滤波），产物可裁可缩放 |
| `tests/e2e/bar-analyze.js`（新增） | 截图 → 档位分析：逐列找最长连续色段 → 定基线 → 采样最高柱中线 |
| `docs/screenshots/bar-shading/`（新增） | 12 张图（4 张现场全图 + 4 张裁切 + 4 张 3 倍放大）+ `report.json` |

### 未改（红线）
- 数据几何：柱高比例、柱宽 60%、顶角 8rpx、Y 轴刻度、X 标签抽稀规则 —— **一个数都没动**。
- 颜色合同：所有档位色都由 `mixHex(--primary)` 派生，色相不变；深浅两套各算各的。
- 统计口径：`withBarHeight` / `buildBarChart` 的计算结果原样复用。

---

## 3. 关键决定与依据

### 3.1 为什么用 SVG 而不是客户拍板的 Canvas
Canvas 2D 版**先做了、也实测了**，结论是画不出来：

- `<canvas type="2d">` 放进统计页（swiper-item 内 / Skyline / glass-easel）后，`createSelectorQuery` 回调不返回 node；
- `panel.$$('canvas')` 数量为 0，`outerWxml` 里也没有该节点；
- 画布尺寸查得到（286.8×93.6 CSS px），但柱区截图**全空**。

同一张卡片里，累计折线 / 分类圆环走「SVG → base64 → data-URI → `<image>`」一直正常。改用同一条路后一次通过。

> ⚠️ **这条替代与客户拍板不一致，目前是「已落地 + 待确认」状态**：客户原定「柱状图改成画布绘制」，开发遇到上述阻塞后改走 SVG。本版按工程可行路径先落地并取证，**是否接受由客户决定**；若坚持 Canvas，需要另开一轮排查 Skyline 下 canvas 节点挂载（成本不可控）。

### 3.2 为什么最外一档必须是本色
顶部若用混白高光一直顶到轮廓线，浅色主题下柱子与卡片背景的对比只有 2.01:1，柱子边界会消失。所以 0~3% 留本色当「倒角」，高光从 3% 才开始。

### 3.3 为什么混色在 JS 里算成实色
`stroke-opacity` / `opacity` 得到的是「和底下卡片混」，`mixHex` 得到的是「和白色混」——两者明度结果完全不同。SVG 里也不支持 `rgba()`（1.4.x 实测），所以只能在 JS 里算好 `#rrggbb` 再写进 SVG。

### 3.4 为什么每档保底 1px
按比例直接取整时，10~20px 的小柱会让 3% / 5% 两档各自取整成 0，「台阶凭空少两级」，看上去就是一根纯色柱子。改成「先每档 1px，余量按原始比例用最大余数法分配」，合计严格等于柱高。

---

## 4. 验证

```
npm test          → 53/53 全绿
npm run release:check → FAIL 0 / WARN 0
node tests/e2e/bar-shading-shots.js → 4 阶段全部通过
```

### 逐像素采样结果（`docs/screenshots/bar-shading/report.json`）

| 阶段 | 采样列柱高 | 档数 | 档位序列（上→下） | 相邻档最小跳变 |
|---|---|---|---|---|
| 年度 深色 | 121px | 6 | 本色×4 → 顶光×7 → 受光×9 → 柱身×74 → 背光×16 → 接触暗×9 | 19.0 |
| 年度 浅色 | 121px | 6 | 同上（浅色档位） | 10.3 |
| 月度 深色 | 102px | 6 | 本色×2 → 顶光×5 → 受光×7 → 柱身×62 → 背光×13 → 接触暗×7 | 19.0 |
| 月度 浅色 | 102px | 6 | 同上（浅色档位） | 10.3 |

跳变下限取 4 色阶（肉眼可辨）；实测最小 10.3，余量充足。颜色种数 5（本色在柱顶、柱身各出现一次），也印证「是硬台阶而非软过渡」（软过渡会得到几十种颜色）。

---

## 5. 真实交付状态

| 图 | 状态 |
|---|---|
| 分类占比环形图 | ✅ 5 层同心弧 + 暗槽 + 段间细缝 |
| 累计趋势折线 | ✅ 同路径描三遍 |
| 日价曲线 | ✅ Canvas 同 path 描三遍 |
| 每日花费柱状图 | ✅ 6 档明暗台阶（本版） |
| 年度 12 月柱状图 | ✅ 6 档明暗台阶（本版） |

**「四张图统一材质」这个目标，本版 4/4 达成。**

---

## 6. 风险与待办

1. **柱顶不再是独立元素**：以后若要做柱顶 hover / 生长动画，得改回元素方案或加交互层。
2. **点击命中依赖坐标反查**：`#monthlyPlot` 的 `boundingClientRect` 在点击瞬间才量，滚动 / 切模式都不会算错；但若将来给柱区加 `transform`，需重新验证。
3. **`app.wxss` 里 `--bar-cap/-lit/-shade/-foot` 四个变量**：值已由测试锁住当「明暗比例的文档」，当前无人消费。清理约 10 分钟，等排期。
4. **进程内三份 `mixHex`**：`data/statistics/donut.js`、`utils/color-mix.js`、`statistics-panel.js` 各有一份，约 60 行 / 4KB 重复。合并需动环形图，风险大于收益，暂不动。
5. **真机未测**：全部取证都在开发者工具模拟器完成。真机待验见第 7 节。

---

## 7. 需要客户在真机上确认（6 条）

1. 点一下年度 12 月柱状图的柱子，是否能跳到对应月份的搜索页；（矮月份也有 8px 兜底，别只试高柱）
2. 深色 / 浅色两种模式下，四张图的明暗是否一致、有没有哪张明显更「假」；
3. 浅色主题下柱顶那条亮边会不会把柱子轮廓吃掉（理论上有本色的倒角兜着，但真机屏不同）；
4. 累计折线有没有双线 / 重影；
5. 日价曲线是否正常（这张最没底，取证时数据少）；
6. 环形图点选某一段，是否整块浮起。

---

## 8. 复现命令

```bash
npm test
npm run release:check
node tests/e2e/bar-shading-shots.js              # 四阶段全跑
BAR_ONLY=year_light node tests/e2e/bar-shading-shots.js   # 只跑某一阶段
```
