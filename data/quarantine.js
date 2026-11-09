/**
 * data/quarantine.js — 损坏月份分片的「删前隔离转存」（v1.4.0 / QA-01，v1.4.1 fail-closed）
 *
 * 背景（数据不可恢复风险）：
 *   恢复 / 回滚会先 `listMonths()` 全删月份分片，再按安全点或备份重写。而安全点来自
 *   `ledger.rangeBills()`，其读取走 `readMonthFile()`（解析失败回落空结构）——
 *   于是「已损坏月份」既不在安全点里、其原始字节又被物理删除，
 *   `protection.buildRawExport()` 的抢救材料随之永久丢失。
 *
 * 本模块做一件事：**删除 / 重写之前，把「存在但不可解析」的分片原始字节抄一份到
 *   <USER_DATA_PATH>/quarantine/<YYYYMMDD-HHmmss-SSS>/<ym>.json，逐字节回读校验，
 *   并写 meta.json 记录原路径 / 字节数 / 时间 / 触发动作 / 失败原因摘要。**
 *
 * v1.4.1 起改为 fail-closed：
 *   - 返回结构化结果，只有 `safeToProceed === true` 才允许调用方执行删除 / 覆盖；
 *   - 没有损坏分片 = 安全（无需隔离）；
 *   - 目录创建失败 / 任一文件复制失败 / 回读字节不一致 / meta 写入失败
 *     → `safeToProceed = false`，调用方必须中止破坏性操作。
 *
 * 红线：
 *   1. 本模块自身永不抛出（内部整段 try/catch），由调用方根据返回值决定中止；
 *   2. meta 与日志里**不允许出现账单金额 / 商户 / 备注等用户内容**，
 *      只允许：路径、字节数、错误码、时间戳、触发动作；
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

/** 统一成 Uint8Array 视图（ArrayBuffer / Buffer / TypedArray 均可） */
function asBytes(raw) {
  if (!raw) return new Uint8Array(0);
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  return new Uint8Array(0);
}

/** 逐字节比较（不允许只比长度 / 文件大小） */
function sameBytes(a, b) {
  const ua = asBytes(a);
  const ub = asBytes(b);
  if (ua.length !== ub.length) return false;
  for (let i = 0; i < ua.length; i++) {
    if (ua[i] !== ub[i]) return false;
  }
  return true;
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
 * 执行删前隔离转存。**永不抛出**（内部失败只 console.warn，且不含账单内容）。
 *
 * 调用方必须先看 `safeToProceed`：
 *   - true  ：没有损坏分片，或全部损坏分片均已逐字节转存且 meta 写入成功，
 *             允许继续执行删除 / 覆盖；
 *   - false ：任一环节失败，**禁止**执行任何破坏性操作。
 *
 * @param {string} trigger  触发动作（TRIGGERS.RESTORE / TRIGGERS.IMPORT_ROLLBACK）
 * @returns {{
 *   complete:boolean, safeToProceed:boolean,
 *   targetCount:number, copiedCount:number, failedCount:number, metaWritten:boolean,
 *   dir:string, items:Array, failed:Array, skipped:string
 * }}
 */
function quarantineUnreadableMonths(trigger) {
  const result = {
    complete: false,
    safeToProceed: false,
    targetCount: 0,
    copiedCount: 0,
    failedCount: 0,
    metaWritten: false,
    dir: '',
    items: [],
    failed: [],
    skipped: '',
  };
  try {
    const targets = findUnreadableMonths();
    result.targetCount = targets.length;
    // 没有需要隔离的文件：直接视为安全，不创建目录
    if (!targets.length) {
      result.complete = true;
      result.safeToProceed = true;
      result.skipped = 'none-unreadable';
      return result;
    }

    const dirName = uniqueBatchName();
    const dir = paths.quarantineDir(dirName);
    try {
      fs.ensureDir(dir);
    } catch (e) {
      result.skipped = 'dir-failed';
      console.warn('[quarantine] 隔离目录创建失败，已中止：' + dir + ' reason=' + errorCode(e));
      return result;
    }
    result.dir = dir;

    const createdAt = new Date().toISOString();
    targets.forEach((t) => {
      const dest = dir + '/' + t.ym + '.json';
      try {
        // 原始字节搬运 + 回读逐字节校验（只比大小不足以证明内容完整）
        const raw = fs.readBuffer(t.file);
        fs.writeBuffer(dest, raw);
        const back = fs.readBuffer(dest);
        if (!sameBytes(raw, back)) {
          const err = new Error('VERIFY_MISMATCH');
          err.code = 'QUARANTINE_VERIFY_MISMATCH';
          throw err;
        }
        result.items.push({
          ym: t.ym,
          originalPath: t.file,
          bytes: rawSize(raw),
          reason: t.code,
          verified: true,
        });
      } catch (e) {
        result.failed.push({ ym: t.ym, originalPath: t.file, reason: errorCode(e) });
        console.warn('[quarantine] 分片转存失败：' + t.file + ' reason=' + errorCode(e));
      }
    });
    result.copiedCount = result.items.length;
    result.failedCount = result.failed.length;

    // meta.json（原子写）；失败 = 无审计记录，同样不允许继续清理
    try {
      fs.writeJSONAtomic(dir + '/meta.json', {
        format: META_FORMAT,
        trigger: trigger || 'unknown',
        createdAt: createdAt,
        complete: result.failedCount === 0,
        items: result.items,
        failed: result.failed,
      });
      result.metaWritten = true;
    } catch (e) {
      result.skipped = 'meta-failed';
      console.warn('[quarantine] meta 写入失败，已中止：' + dir + ' reason=' + errorCode(e));
    }

    result.complete =
      result.copiedCount === result.targetCount && result.failedCount === 0 && result.metaWritten;
    result.safeToProceed = result.complete;
    if (!result.complete && !result.skipped) {
      result.skipped = result.failedCount ? 'copy-failed' : 'incomplete';
    }
    if (result.complete) result.skipped = '';
    return result;
  } catch (e) {
    // 未预期异常：fail-closed，禁止调用方继续删除
    result.complete = false;
    result.safeToProceed = false;
    result.skipped = 'unexpected';
    try {
      console.warn('[quarantine] 隔离整体失败，已中止：' + errorCode(e));
    } catch (e2) {}
    return result;
  }
}

module.exports = {
  TRIGGERS,
  META_FORMAT,
  batchName,
  sameBytes,
  findUnreadableMonths,
  quarantineUnreadableMonths,
};
