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
  writeJSON,
  readText,
  writeText,
  readBuffer,
  remove,
  listDir,
  copy,
};
