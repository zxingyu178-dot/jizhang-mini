// utils/test-registry.js
// 测试桥接：运行 ID + 持久化测试清单 + 命名空间安全清理（v1.3.4 Review Fix 再加固）。
//
// 设计目标（fail-safe，宁可少删、绝不误删真实账单）：
//   1. 测试账单 note 统一带命名空间前缀 `__TEST__:<runId>`，普通真实账单永远不匹配；
//   2. 清单 readRegistry 严格校验 version / runs / runId / billIds，任何结构异常都标记
//      corrupt；cleanupTestBills 遇到 corrupt 清单时不删除任何账单；
//   3. 按清单 ID 删除时三重核对：账单 ID + note 命名空间 + note 内 runId 三者一致才删，
//      真实账单 ID 即使被错误写入清单也会保留；
//   4. 兜底扫描仅覆盖「已登记 runId」的账单，清单缺失 / runs 为空时兜底删不了任何东西；
//   5. runId 先登记（空 billIds），每笔账单创建后 addBillToRun 及时登记，支持中途异常
//      退出时仍能清理本次已登记账单。
//
// 本模块仅在 develop / trial 测试桥接路径使用，release 下入口 fail-closed、不可达。
const fs = require('../data/fs');

const TEST_NOTE_PREFIX = '__TEST__:';
const REGISTRY_FILE_NAME = '__test_registry__.json';
const REGISTRY_VERSION = 1;

function registryPath() {
  return fs.userRoot() + '/' + REGISTRY_FILE_NAME;
}

/* ---------------- 运行 ID ---------------- */

function makeRunId(prefix) {
  const p = prefix ? String(prefix) : 'run';
  return p + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

/* ---------------- 测试 note 编码 / 识别 / 提取 ---------------- */

function encodeTestNote(runId) {
  return TEST_NOTE_PREFIX + runId;
}

function isTestNote(note) {
  return typeof note === 'string' && note.indexOf(TEST_NOTE_PREFIX) === 0;
}

function runIdFromNote(note) {
  if (!isTestNote(note)) return null;
  const runId = note.slice(TEST_NOTE_PREFIX.length);
  return runId.length > 0 ? runId : null;
}

/* ---------------- 清单结构校验 ---------------- */

function isValidRunId(runId) {
  return typeof runId === 'string' && runId.length > 0;
}

function isValidBillIds(billIds) {
  return Array.isArray(billIds)
    && billIds.every((id) => typeof id === 'string' && id.length > 0);
}

/** 校验单个 run；合法则返回规范化副本（billIds 去重拷贝），非法返回 null。 */
function normalizeRun(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isValidRunId(raw.runId)) return null;
  if (!isValidBillIds(raw.billIds)) return null;
  const seen = new Set();
  const billIds = [];
  raw.billIds.forEach((id) => {
    if (!seen.has(id)) { seen.add(id); billIds.push(id); }
  });
  return {
    runId: raw.runId,
    kind: typeof raw.kind === 'string' && raw.kind ? raw.kind : 'test',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    billIds,
  };
}

function emptyRegistry() {
  return { version: REGISTRY_VERSION, runs: [] };
}

/**
 * 读取并严格校验清单。
 * @returns {{version:number, runs:Array, corrupt:boolean, missing:boolean}}
 *   - 文件不存在：missing=true（正常空态，非损坏）；
 *   - 读取 / 解析失败或结构非法：corrupt=true，runs 强制为空（fail-safe）；
 *   - 正常：corrupt=false，runs 为规范化数组。
 */
function readRegistry() {
  const path = registryPath();
  if (!fs.exists(path)) {
    return Object.assign(emptyRegistry(), { corrupt: false, missing: true });
  }
  let data;
  try {
    data = fs.readJSONStrict(path);
  } catch (e) {
    return Object.assign(emptyRegistry(), { corrupt: true, missing: false });
  }
  if (!data || typeof data !== 'object'
      || data.version !== REGISTRY_VERSION
      || !Array.isArray(data.runs)) {
    return Object.assign(emptyRegistry(), { corrupt: true, missing: false });
  }
  const runs = [];
  for (const raw of data.runs) {
    const run = normalizeRun(raw);
    if (!run) {
      // 含任意非法 run：整体 fail-safe，返回空 runs，避免基于部分异常清单做删除。
      return Object.assign(emptyRegistry(), { corrupt: true, missing: false });
    }
    runs.push(run);
  }
  return { version: REGISTRY_VERSION, runs, corrupt: false, missing: false };
}

/** 写入清单：永远规范化为合法结构（非法 run 被丢弃）。 */
function writeRegistry(reg) {
  const rawRuns = reg && Array.isArray(reg.runs) ? reg.runs : [];
  const runs = [];
  rawRuns.forEach((raw) => {
    const run = normalizeRun(raw);
    if (run) runs.push(run);
  });
  fs.writeJSON(registryPath(), { version: REGISTRY_VERSION, runs });
}

function registryExists() {
  return fs.exists(registryPath());
}

/* ---------------- 运行登记 ---------------- */

/**
 * 登记一个新 run（通常 billIds 初始为空，账单创建后再 addBillToRun）。
 * 同 runId 已存在则不重复追加。当前清单损坏时，重建只含本次 run 的新清单。
 */
function registerRun(entry) {
  if (!entry || !isValidRunId(entry.runId)) {
    throw new Error('registerRun 缺少合法 runId');
  }
  const current = readRegistry();
  const runs = current.corrupt ? [] : current.runs;
  if (runs.some((r) => r.runId === entry.runId)) {
    return readRegistry();
  }
  const billIds = isValidBillIds(entry.billIds)
    ? entry.billIds.slice()
    : [];
  runs.push({
    runId: entry.runId,
    kind: typeof entry.kind === 'string' && entry.kind ? entry.kind : 'test',
    createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
    billIds,
  });
  writeRegistry({ version: REGISTRY_VERSION, runs });
  return readRegistry();
}

/**
 * 往已登记 run 追加一笔账单 ID（每笔账单创建后及时登记）。
 * 清单损坏时重建只含本次 run 的新清单，确保本次账单可被追踪。
 */
function addBillToRun(runId, billId) {
  if (!isValidRunId(runId)) throw new Error('addBillToRun 缺少合法 runId');
  if (typeof billId !== 'string' || !billId) {
    throw new Error('addBillToRun 缺少合法 billId');
  }
  const current = readRegistry();
  if (current.corrupt) {
    writeRegistry({
      version: REGISTRY_VERSION,
      runs: [{
        runId, kind: 'test', createdAt: Date.now(), billIds: [billId],
      }],
    });
    return;
  }
  const run = current.runs.find((r) => r.runId === runId);
  if (!run) throw new Error('addBillToRun 找不到已登记 run：' + runId);
  if (run.billIds.indexOf(billId) < 0) run.billIds.push(billId);
  writeRegistry({ version: REGISTRY_VERSION, runs: current.runs });
}

/* ---------------- 安全清理 ---------------- */

function ymOf(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/**
 * 清理测试账单（fail-safe）。
 * @param {object} store 数据层（rangeBills / deleteBill）
 * @param {{runId?:string}} [opts] opts.runId 仅清理指定 run；缺省清理全部已登记 run。
 * @returns {{removedById:string[], removedByScan:string[], removed:number,
 *            months:string[], corrupt:boolean}}
 */
function cleanupTestBills(store, opts) {
  const options = opts || {};
  const removedById = [];
  const removedByScan = [];
  const touchedMonths = new Set();
  // 删除失败的账单按 runId 归属：{ [runId]: string[] }。回写清单时这些 ID 连同
  // run 一并保留，等下次 cleanup 继续清理，避免账单残留且失去追踪依据。
  const failedByRun = Object.create(null);

  function markFailed(runId, billId) {
    if (!failedByRun[runId]) failedByRun[runId] = [];
    if (failedByRun[runId].indexOf(billId) < 0) failedByRun[runId].push(billId);
  }

  function record(bill, list) {
    list.push(bill.id);
    touchedMonths.add(ymOf(bill.occurredAt));
  }

  const current = readRegistry();

  // fail-safe：清单损坏（读取 / 解析 / 结构异常）→ 不删除任何账单，也不覆盖清单。
  if (current.corrupt) {
    return {
      removedById,
      removedByScan,
      removed: 0,
      months: [],
      corrupt: true,
    };
  }

  // 已登记 runId 集合：兜底扫描的唯一合法范围。
  const registeredRunIds = new Set(current.runs.map((r) => r.runId));
  const targetRuns = current.runs
    .filter((r) => !options.runId || r.runId === options.runId);

  // 1) 按清单 ID 删除：三重核对（ID + note 命名空间 + note 内 runId）。
  const billById = new Map(store.rangeBills().map((b) => [b.id, b]));
  targetRuns.forEach((run) => {
    run.billIds.forEach((id) => {
      const bill = billById.get(id);
      if (!bill) return; // 账单已不存在，无需处理
      const noteRunId = runIdFromNote(bill.note);
      // 真实账单 ID 被错误写入清单：note 非测试命名空间或 runId 不匹配 → 保留。
      if (noteRunId !== run.runId) return;
      try {
        store.deleteBill(id);
        record(bill, removedById);
      } catch (e) {
        // 单笔删除失败：保留该 runId/billId，等下次清理，不影响其余清理。
        markFailed(run.runId, id);
      }
    });
  });

  // 2) 兜底扫描：仅删除 note 的 runId 已登记、且属于本次目标范围的残留账单。
  store.rangeBills().forEach((bill) => {
    const noteRunId = runIdFromNote(bill.note);
    if (noteRunId === null) return; // 非测试命名空间（含 E2E_DONUT / SELFTEST 裸备注）
    if (!registeredRunIds.has(noteRunId)) return; // runId 未登记 → 不删
    if (options.runId && noteRunId !== options.runId) return;
    try {
      store.deleteBill(bill.id);
      record(bill, removedByScan);
    } catch (e) {
      // 兜底删除失败：按 note 内 runId 保留账单 ID，等下次清理。
      markFailed(noteRunId, bill.id);
    }
  });

  // 3) 回写清单：
  //    - 删除成功的 run 移除（缺省）或保留非目标 run（指定 runId 时）；
  //    - 任何仍有「删除失败账单」的 run 必须保留，billIds 只保留未删成功的 ID，
  //      等下次 cleanup 继续清理，账单不残留为无追踪的孤儿。
  const remainingRuns = [];
  current.runs.forEach((run) => {
    const isTarget = !options.runId || run.runId === options.runId;
    if (!isTarget) {
      remainingRuns.push(run); // 指定 runId 清理时，非目标 run 原样保留
      return;
    }
    const failed = failedByRun[run.runId] || [];
    // 保留 ID：原清单中删除失败的 + 兜底扫描删除失败的（去重）。
    const keepIds = Array.from(new Set(
      run.billIds.filter((id) => failed.indexOf(id) >= 0).concat(failed)
    ));
    if (keepIds.length > 0) {
      remainingRuns.push(Object.assign({}, run, { billIds: keepIds }));
    }
    // 该 run 全部删除成功 → 不保留。
  });
  writeRegistry({ version: REGISTRY_VERSION, runs: remainingRuns });

  const failedBillIds = Array.from(new Set(
    Object.keys(failedByRun).reduce((all, k) => all.concat(failedByRun[k]), [])
  ));

  return {
    removedById,
    removedByScan,
    removed: removedById.length + removedByScan.length,
    failedBillIds,
    months: Array.from(touchedMonths).sort(),
    corrupt: false,
  };
}

module.exports = {
  TEST_NOTE_PREFIX,
  REGISTRY_FILE_NAME,
  REGISTRY_VERSION,
  makeRunId,
  encodeTestNote,
  isTestNote,
  runIdFromNote,
  readRegistry,
  writeRegistry,
  registryExists,
  registerRun,
  addBillToRun,
  cleanupTestBills,
};
