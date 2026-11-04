/**
 * data/quarantine.js — 损坏月份分片的「删前隔离转存」（v1.4.0 / QA-01）
 *
 * 背景（数据不可恢复风险）：
 *   恢复 / 回滚会先 `listMonths()` 全删月份分片，再按安全点或备份重写。而安全点来自
 *   `ledger.rangeBills()`，其读取走 `readMonthFile()`（解析失败回落空结构）——
 *   于是「已损坏月份」既不在安全点里、其原始字节又被物理删除，
 *   `protection.buildRawExport()` 的抢救材料随之永久丢失。
 *
 * 本模块只做一件事：**删除 / 重写之前，把「存在但不可解析」的分片原始字节抄一份到
 *   <USER_DATA_PATH>/quarantine/<YYYYMMDD-HHmmss-SSS>/<ym>.json，并写 meta.json 记录
 *   原路径 / 字节数 / 时间 / 触发动作 / 失败原因摘要。**
 *
 * 红线：
 *   1. 绝不影响主流程。整段 try/catch，任何失败只记一条警告后继续，
 *      调用方（restore / rollback）的语义与抛错行为完全不变。
 *   2. meta 与日志里**不允许出现账单金额 / 商户 / 备注等用户内容**，
 *      只允许：路径、字节数、错误码、时间戳、触发动作。
 *   3. 只读源分片 + 只写 quarantine 目录，不删除、不改写任何账本文件。
 */
const fs = require('./fs');
const paths = require('./paths');
const ledger = require('./ledger');

/** 触发动作（写进 meta，便于日后判断这批字节是哪一步救下来的） */
const TRIGGERS = {
  RESTORE: 'restore',
  IMPORT_ROLLBACK: 'import-rollback',
};

const META_FORMAT = 'daily-value-quarantine';

/** 时间戳目录名（UTC，形如 20261104-153012-123；与设备时区无关，天然可排序） */
function batchName(date) {
  const d = date || new Date();
  const iso = d.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
  return (
    iso.slice(0, 4) +
    iso.slice(5, 7) +
    iso.slice(8, 10) +
    '-' +
    iso.slice(11, 13) +
    iso.slice(14, 16) +
    iso.slice(17, 19) +
    '-' +
    iso.slice(20, 23)
  );
}

/** 同一毫秒内多次触发时避让已存在的批次目录 */
function uniqueBatchName(date) {
  const base = batchName(date);
  let name = base;
  let i = 1;
  while (fs.exists(paths.quarantineDir(name)) && i <= 100) {
    name = base + '-' + i;
    i += 1;
  }
  return name;
}

/** 原始字节长度（ArrayBuffer 用 byteLength，Buffer / string 用 length） */
function rawSize(raw) {
  if (!raw) return 0;
  if (typeof raw.byteLength === 'number') return raw.byteLength;
  if (typeof raw.length === 'number') return raw.length;
  return 0;
}

/** 错误码摘要（只取 code / 极少数字段，不含 detail 正文，避免带出用户内容） */
function errorCode(e) {
  if (!e) return 'UNKNOWN';
  if (typeof e.code === 'string' && e.code) return e.code;
  return 'UNKNOWN';
}

/**
 * 找出「存在但不可解析」的月份分片：
 *   判定口径 = `ledger.readMonthFileStrict()`（生产写路径用的同一把尺）不通过
 *   （MONTH_CORRUPT / MONTH_INVALID_SHAPE / MONTH_UNSUPPORTED_VERSION / 读取失败）。
 *   这些正是「字节还在、但任何读取路径都用不上、被删即永久丢失」的分片。
 */
function findUnreadableMonths() {
  const out = [];
  ledger.listMonths().forEach((ym) => {
    const file = paths.billFile(ym);
    if (!fs.exists(file)) return;
    try {
      ledger.readMonthFileStrict(ym);
    } catch (e) {
      out.push({ ym: ym, file: file, code: errorCode(e) });
    }
  });
  return out;
}

/**
 * 执行删前隔离转存。**永不抛出**（失败只 console.warn 一条，不含账单内容）。
 *
 * @param {string} trigger  触发动作（TRIGGERS.RESTORE / TRIGGERS.IMPORT_ROLLBACK）
 * @returns {{ok:boolean, dir:string, items:Array, failed:Array, skipped:string}}
 *          ok=true 表示至少有一份分片成功转存；skipped 说明未转存的原因
 *          （'none-unreadable' 无损坏分片 / 'failed' 全失败 / '' 已转存）。
 */
function quarantineUnreadableMonths(trigger) {
  const result = { ok: false, dir: '', items: [], failed: [], skipped: '' };
  try {
    const targets = findUnreadableMonths();
    if (!targets.length) {
      result.skipped = 'none-unreadable';
      return result;
    }

    // 目录创建失败 → 视为整批失败，交给外层 catch 降级
    const dirName = uniqueBatchName();
    const dir = paths.quarantineDir(dirName);
    fs.ensureDir(dir);
    result.dir = dir;

    const createdAt = new Date().toISOString();
    targets.forEach((t) => {
      try {
        // 原始字节搬运：readBuffer 不带 encoding（ArrayBuffer），writeBuffer 原样落盘
        const raw = fs.readBuffer(t.file);
        fs.writeBuffer(dir + '/' + t.ym + '.json', raw);
        result.items.push({
          ym: t.ym,
          originalPath: t.file,
          bytes: rawSize(raw),
          reason: t.code,
        });
      } catch (e) {
        result.failed.push({ ym: t.ym, originalPath: t.file, reason: errorCode(e) });
        console.warn(
          '[quarantine] 分片转存失败，已跳过：' + t.file + ' reason=' + errorCode(e)
        );
      }
    });

    // meta.json（原子写；失败也不影响已转存的分片字节）
    try {
      fs.writeJSONAtomic(dir + '/meta.json', {
        format: META_FORMAT,
        trigger: trigger || 'unknown',
        createdAt: createdAt,
        items: result.items,
        failed: result.failed,
      });
    } catch (e) {
      console.warn('[quarantine] meta 写入失败：' + dir + ' reason=' + errorCode(e));
    }

    result.ok = result.items.length > 0;
    if (!result.ok) result.skipped = 'failed';
    return result;
  } catch (e) {
    // 任何未预期异常都不许影响恢复 / 回滚主流程
    result.skipped = 'failed';
    try {
      console.warn('[quarantine] 隔离整体失败，主流程继续：' + errorCode(e));
    } catch (e2) {}
    return result;
  }
}

module.exports = {
  TRIGGERS,
  META_FORMAT,
  batchName,
  findUnreadableMonths,
  quarantineUnreadableMonths,
};
