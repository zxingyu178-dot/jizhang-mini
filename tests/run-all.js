// tests/run-all.js
// `npm test` 统一入口：依次在独立子进程运行三个测试套件，任一失败则以非零码退出。
// 跨平台（Windows / macOS / Linux），只依赖 Node，不依赖 shell 的 && 语法。
const path = require('path');
const { spawnSync } = require('child_process');

const suites = ['device.test.js', 'data.test.js', 'accounting.test.js', 'statistics.test.js', 'daily-value.test.js', 'budget.test.js', 'categories.test.js', 'recurring.test.js', 'settings.test.js', 'health.test.js', 'strict-read.test.js', 'backup-validator.test.js', 'importer.test.js'];

let failed = 0;
const results = [];

suites.forEach((file) => {
  const target = path.join(__dirname, file);
  console.log('\n==================== 运行 ' + file + ' ====================');
  const r = spawnSync(process.execPath, [target], { stdio: 'inherit' });
  const ok = r.status === 0;
  results.push({ file, ok: ok });
  if (!ok) failed += 1;
});

console.log('\n==================== 汇总 ====================');
results.forEach((r) => {
  console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.file);
});

if (failed > 0) {
  console.error('\n' + failed + ' 个测试套件失败');
  process.exit(1);
}
console.log('\n全部测试套件通过（' + suites.length + '/' + suites.length + '）');
process.exit(0);
