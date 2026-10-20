/**
 * data/storage-integrity.js — 本地存储完整性扫描（v0.8.0 / G4 P0）
 *
 * 背景：旧数据层对 categories/settings/recurring/manifest 经 readJSON(fallback) 读取，
 * 文件损坏（JSON 解析失败）被静默当成「空 / 不存在」，甚至 ensureManifest 重建清单，
 * 导致「文件曾经存在但损坏」与「首次安装、从未存在」混为一谈。
 *
 * 本扫描对每个关键文件做原始读取（readText + JSON.parse），给出五态：
 *   - MISSING：文件不存在（首次安装允许，不视为损坏）；
 *   - CORRUPT：JSON 解析失败（曾存在但损坏）；
 *   - INVALID_SHAPE：JSON 合法但顶层结构 / 必备字段错误；
 *   - UNSUPPORTED_VERSION：version 字段不在受支持范围；
 *   - VALID：正常。
 *
 * 只读、不修改、不创建任何文件（月份目录直接列，不 ensure）。
 * G6 数据保护模式据此决定是否进入安全模式；G8 release:check 也复用。
 */
const fs = require('./fs');
const paths = require('./paths');
const ledger = require('./ledger');

const STATUS = {
  MISSING: 'MISSING',
  CORRUPT: 'CORRUPT',
  INVALID_SHAPE: 'INVALID_SHAPE',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  VALID: 'VALID',
};

const VALID_SCHEMA_VERSIONS = [1, 2, 3];
const RECURRING_VERSIONS = [1];

function entry(kind, file, status, detail) {
  return { kind, file, status, detail: detail == null ? '' : String(detail) };
}

/** 扫描一个 JSON 文件：exists → read → parse → shape */
function scanJsonFile(kind, file, shape) {
  if (!fs.exists(file)) return entry(kind, file, STATUS.MISSING);
  let txt;
  try {
    txt = fs.getFS().readFileSync(file, 'utf8');
  } catch (e) {
    return entry(kind, file, STATUS.CORRUPT, '读取失败');
  }
  let data;
  try {
    data = JSON.parse(txt);
  } catch (e) {
    return entry(kind, file, STATUS.CORRUPT);
  }
  const r = shape(data);
  if (r) return entry(kind, file, r.status, r.detail);
  return entry(kind, file, STATUS.VALID);
}

/* ------- 顶层 shape validators：null=合法，否则 {status, detail} ------- */
function shapeManifest(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return { status: STATUS.INVALID_SHAPE, detail: '不是对象' };
  }
  if (VALID_SCHEMA_VERSIONS.indexOf(d.schemaVersion) < 0) {
    return { status: STATUS.UNSUPPORTED_VERSION, detail: 'schemaVersion=' + d.schemaVersion };
  }
  return null;
}

function shapeCategories(d) {
  if (!Array.isArray(d)) return { status: STATUS.INVALID_SHAPE, detail: '不是数组' };
  for (let i = 0; i < d.length; i++) {
    const c = d[i];
    if (!c || typeof c !== 'object' || Array.isArray(c) || !c.id) {
      return { status: STATUS.INVALID_SHAPE, detail: 'categories[' + i + '] 非法' };
    }
  }
  return null;
}

function shapeSettings(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return { status: STATUS.INVALID_SHAPE, detail: '不是对象' };
  }
  if (d.budget !== undefined && d.budget !== null) {
    if (typeof d.budget !== 'object' || Array.isArray(d.budget)) {
      return { status: STATUS.INVALID_SHAPE, detail: 'budget 不是对象' };
    }
    if (!Array.isArray(d.budget.rules)) {
      return { status: STATUS.INVALID_SHAPE, detail: 'budget.rules 不是数组' };
    }
  }
  return null;
}

function shapeRecurring(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return { status: STATUS.INVALID_SHAPE, detail: '不是对象' };
  }
  if (RECURRING_VERSIONS.indexOf(d.version) < 0) {
    return { status: STATUS.UNSUPPORTED_VERSION, detail: 'version=' + d.version };
  }
  if (!Array.isArray(d.rules)) {
    return { status: STATUS.INVALID_SHAPE, detail: 'rules 不是数组' };
  }
  return null;
}

/** 扫描一个月份分片（parse 失败 → CORRUPT；复用 ledger.validateMonthShape） */
function scanMonthFile(ym) {
  const file = paths.billFile(ym);
  let txt;
  try {
    txt = fs.getFS().readFileSync(file, 'utf8');
  } catch (e) {
    return entry('month', file, STATUS.CORRUPT, '读取失败');
  }
  let data;
  try {
    data = JSON.parse(txt);
  } catch (e) {
    return entry('month', file, STATUS.CORRUPT);
  }
  try {
    ledger.validateMonthShape(ym, data);
  } catch (e) {
    const map = {
      MONTH_INVALID_SHAPE: STATUS.INVALID_SHAPE,
      MONTH_UNSUPPORTED_VERSION: STATUS.UNSUPPORTED_VERSION,
    };
    return entry('month', file, map[e.code] || STATUS.INVALID_SHAPE, e.detail);
  }
  return entry('month', file, STATUS.VALID);
}

/**
 * 完整扫描本地存储（manifest / categories / settings / recurring + 全部月份分片）。
 * 只读，不创建目录。ok = 无 CORRUPT / INVALID_SHAPE / UNSUPPORTED_VERSION（MISSING 不算）。
 */
function scanStorage() {
  const files = [
    scanJsonFile('manifest', paths.FILE.manifest, shapeManifest),
    scanJsonFile('categories', paths.FILE.categories, shapeCategories),
    scanJsonFile('settings', paths.FILE.settings, shapeSettings),
    scanJsonFile('recurring', paths.FILE.recurring, shapeRecurring),
  ];
  // 直接列月份目录（不 ensure），纯只读
  const monthNames = fs
    .listDir(paths.DIR.bills)
    .filter((n) => /^\d{4}-\d{2}\.json$/.test(n))
    .sort();
  const months = monthNames.map((n) => scanMonthFile(n.replace('.json', '')));
  const all = files.concat(months);
  const counts = { MISSING: 0, CORRUPT: 0, INVALID_SHAPE: 0, UNSUPPORTED_VERSION: 0, VALID: 0 };
  all.forEach((e) => {
    counts[e.status] += 1;
  });
  return {
    ok:
      counts.CORRUPT === 0 &&
      counts.INVALID_SHAPE === 0 &&
      counts.UNSUPPORTED_VERSION === 0,
    files,
    months,
    all,
    counts,
  };
}

module.exports = {
  STATUS,
  scanJsonFile,
  scanMonthFile,
  scanStorage,
};
