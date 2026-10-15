// 一次性脚本：从 excel/xlsx.js（内联 SheetJS cptable）提取 CP936 的 dec 码表，
// 生成项目自有的 encoding/cp936.js，供纯 JS GBK fallback 使用。运行后可删除本脚本。
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'packages', 'importer', 'excel', 'xlsx.js'), 'utf8');

// 形如：cptable[936]=function(){ ... return{enc:t,dec:r}}();
const startTag = 'cptable[936]=function(){';
const endTag = 'return{enc:t,dec:r}}();';
const s = src.indexOf(startTag);
if (s < 0) {
  console.error('未找到 cptable[936] 起始定义');
  process.exit(1);
}
const eRel = src.indexOf(endTag, s);
if (eRel < 0) {
  console.error('未找到 cptable[936] 结束标记');
  process.exit(1);
}
const seg = src.substring(s, eRel + endTag.length); // cptable[936]=function(){...}();

let table;
try {
  const cptable = {};
  const fn = new Function('cptable', seg);
  fn(cptable);
  table = cptable[936];
} catch (e) {
  console.error('执行 cptable[936] 失败：', e.message);
  process.exit(1);
}

if (!table || !Array.isArray(table.dec)) {
  console.error('cptable[936].dec 不可用');
  process.exit(1);
}

const out =
  '// 自动生成，请勿手工编辑。来源：SheetJS cptable[936] dec（CP936/GBK 双字节→Unicode）。\n' +
  '// 仅包含解码数组，用于 GBK 纯 JS fallback；与 SheetJS 运行时解耦。\n' +
  'var DEC = ' + JSON.stringify(table.dec) + ';\n' +
  'module.exports = { dec: DEC };\n';

fs.writeFileSync(path.join(__dirname, '..', 'packages', 'importer', 'encoding', 'cp936.js'), out);
console.log('cp936.js 已生成，dec 长度 =', table.dec.length);
