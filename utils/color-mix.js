// utils/color-mix.js
// 明度混色纯函数（v1.5.1 车削光影）：只做「朝白 / 朝黑」的 RGB 通道线性插值。
//
// 为什么需要它：累计折线 / 日价曲线的 SVG 内禁止 rgba() 与 url(#gradient)（Skyline 实测），
// 而 stroke-opacity 是「和底下卡片混」，不是「和白色混」—— 两者明度结果完全不同。
// 所以「高光 / 暗缘」必须在 JS 里算成实色 #RRGGBB 再写进 SVG / Canvas。
//
// 色相合同：只在 RGB 通道等比插值 → 色相一位不改，只改明度，
// 因此图例、面板、对比度审计都不用跟着改。
//
// 本模块不读 wx、不读主题，是纯函数（与 data/statistics/cumulative.js 的定位一致）。

/**
 * '#RRGGBB' 朝 target('#RRGGBB') 按 t（0..1）线性混合，输出 '#RRGGBB'。
 * 非法输入（非 6 位 hex）原样返回 hex，不抛异常 —— 图形宁可用错色也不要整图崩掉。
 * @param {string} hex 基准色
 * @param {string} target '#FFFFFF' 或 '#000000'
 * @param {number} t 混合比例（<0 视为 0，>1 视为 1）
 * @returns {string} '#RRGGBB'
 */
function mixHex(hex, target, t) {
  const a = String(hex == null ? '' : hex).trim().replace('#', '');
  const b = String(target == null ? '' : target).trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(a) || !/^[0-9a-fA-F]{6}$/.test(b)) return hex;
  const k = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const p = parseInt(a.substr(i * 2, 2), 16);
    const q = parseInt(b.substr(i * 2, 2), 16);
    const v = Math.round(p + (q - p) * k);
    out += (v < 16 ? '0' : '') + v.toString(16);
  }
  return out;
}

module.exports = { mixHex };
