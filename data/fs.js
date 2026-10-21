/**
 * data/fs.js — 本地文件系统封装（wx.env.USER_DATA_PATH）
 *
 * 全部为同步接口：数据层在启动 / 记账时调用，数据量小，同步更简单可靠；
 * 导入大批量数据时在 M4 配合 staging 原子化。
 * 纯本地，无网络、无 Node（不使用 Buffer / fs / path）。
 */

function getFS() {
  return wx.getFileSystemManager();
}

function userRoot() {
  return wx.env.USER_DATA_PATH;
}

function parentDir(p) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
}

/** 构造带 code 的文件错误（供 strict 读取 / 上层分类处理） */
function fileError(code, path, detail) {
  const err = new Error(code + ': ' + path + (detail ? ' (' + detail + ')' : ''));
  err.code = code;
  err.filePath = path;
  if (detail) err.detail = detail;
  return err;
}

/**
 * 严格读 JSON（写路径 / 完整性扫描用）：
 *   文件不存在 / 读失败 → 抛 FILE_MISSING / FILE_READ_FAILED；
 *   JSON 解析失败 → 抛 FILE_CORRUPT（绝不静默返回 fallback，避免「损坏被当空数据覆盖」）。
 */
function readJSONStrict(path) {
  let txt;
  try {
    txt = getFS().readFileSync(path, 'utf8');
  } catch (e) {
    if (!exists(path)) throw fileError('FILE_MISSING', path);
    throw fileError('FILE_READ_FAILED', path, e.message || String(e));
  }
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw fileError('FILE_CORRUPT', path, e.message || String(e));
  }
}

/** 文件或目录是否存在 */
function exists(path) {
  try {
    getFS().accessSync(path);
    return true;
  } catch (e) {
    return false;
  }
}

/** 递归确保目录存在 */
function ensureDir(dirPath) {
  if (!dirPath) return;
  if (exists(dirPath)) return;
  getFS().mkdirSync(dirPath, true);
}

/** 读 JSON；不存在或解析失败返回 fallback */
function readJSON(path, fallback) {
  try {
    const txt = getFS().readFileSync(path, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    return fallback;
  }
}

/** 写 JSON（自动创建父目录） */
function writeJSON(path, obj) {
  ensureDir(parentDir(path));
  getFS().writeFileSync(path, JSON.stringify(obj), 'utf8');
}

/**
 * 原子写 JSON（核心账本 / 设置 / 分类 / 周期文件用）：
 *   1) 写 <path>.tmp；
 *   2) 重新读回 tmp，校验内容一致且 JSON.parse 通过；
 *   3) 旧正式文件（若存在）rename 为 <path>.bak；
 *   4) tmp rename 为正式文件；
 *   5) 成功后删除 .bak。
 *
 * 微信 renameSync 不覆盖已存在目标（错误码 1301005 file already exists），
 * 因此必须先把旧文件挪到 .bak，不能直接 rename tmp → 已存在的正式文件。
 *
 * 任一步失败：清理 tmp；若旧文件已被挪到 .bak 而新文件未就位，
 * 回滚 .bak → 正式文件。正式文件要么是旧内容、要么是新内容，绝不留下半截 JSON。
 */
function writeJSONAtomic(path, obj) {
  ensureDir(parentDir(path));
  const tmp = path + '.tmp';
  const bak = path + '.bak';
  const payload = JSON.stringify(obj);
  const hadOriginal = exists(path);
  let movedOriginal = false;
  try {
    getFS().writeFileSync(tmp, payload, 'utf8');
    const back = getFS().readFileSync(tmp, 'utf8');
    if (back !== payload) throw fileError('ATOMIC_VERIFY_FAILED', path, 'tmp 读回内容不一致');
    JSON.parse(back); // 确保 tmp 是合法 JSON
    if (hadOriginal) {
      try { getFS().unlinkSync(bak); } catch (e) {} // 清掉陈旧 bak
      getFS().renameSync(path, bak);
      movedOriginal = true;
    }
    getFS().renameSync(tmp, path);
    if (hadOriginal) {
      try { getFS().unlinkSync(bak); } catch (e) {}
    }
  } catch (e) {
    try { getFS().unlinkSync(tmp); } catch (e2) {}
    if (movedOriginal && !exists(path) && exists(bak)) {
      try { getFS().renameSync(bak, path); } catch (e3) {}
    }
    if (e && e.code === 'ATOMIC_VERIFY_FAILED') throw e;
    throw fileError('ATOMIC_WRITE_FAILED', path, (e && e.message) || String(e));
  }
}

/**
 * 原子「读-改-写」（所有准备修改核心 JSON 的操作必须使用）：
 *   strict read（文件不存在用 create() 初始值）→ updater(state) 修改 →
 *   validate(state)（可选）→ writeJSONAtomic。
 *
 * 原文件存在但损坏（FILE_CORRUPT / 读取失败）：直接抛出，绝不 fallback 到
 * 默认值再覆盖，从源头堵住「用户自定义分类 / 预算规则被默认值覆盖」。
 *
 * @param {string} path
 * @param {function():any} create   文件不存在时的初始值
 * @param {function(any):any} updater  接收当前 state，就地修改（或返回新 state）
 * @param {function(any):void} [validate]  可选校验，抛错即中止
 * @returns {any} 写入后的新 state
 */
function updateJSONAtomic(path, create, updater, validate) {
  let state;
  if (exists(path)) {
    state = readJSONStrict(path); // 损坏即抛
  } else {
    state = create();
  }
  const result = updater(state) || state;
  if (typeof validate === 'function') validate(result);
  writeJSONAtomic(path, result);
  return result;
}

/** 读文本；失败返回 null */
function readText(path) {
  try {
    return getFS().readFileSync(path, 'utf8');
  } catch (e) {
    return null;
  }
}

/** 写文本（自动创建父目录） */
function writeText(path, text) {
  ensureDir(parentDir(path));
  getFS().writeFileSync(path, text, 'utf8');
}

/** 读 ArrayBuffer（XLSX 用） */
function readBuffer(path) {
  return getFS().readFileSync(path);
}

/** 删除文件；成功返回 true */
function remove(path) {
  try {
    getFS().unlinkSync(path);
    return true;
  } catch (e) {
    return false;
  }
}

/** 列出目录下条目；失败返回空数组 */
function listDir(path) {
  try {
    return getFS().readdirSync(path);
  } catch (e) {
    return [];
  }
}

/** 复制文件（备份/恢复用） */
function copy(srcPath, destPath) {
  const buf = getFS().readFileSync(srcPath);
  ensureDir(parentDir(destPath));
  getFS().writeFileSync(destPath, buf);
}

module.exports = {
  getFS,
  userRoot,
  parentDir,
  exists,
  ensureDir,
  readJSON,
  readJSONStrict,
  fileError,
  writeJSON,
  writeJSONAtomic,
  updateJSONAtomic,
  readText,
  writeText,
  readBuffer,
  remove,
  listDir,
  copy,
};
