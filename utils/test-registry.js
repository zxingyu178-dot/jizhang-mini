// utils/test-registry.js
// 测试桥接共享的「运行 ID + 持久化测试清单 + 命名空间标记」机制。
// 仅由测试桥接（e2e-donut-seed / main.__selftest）在非 release 环境调用；
// release 下入口 fail-closed，本模块不可达，为测试环境专用模块。
//
// 设计目的（消除「凭普通备注文本误删真实账单」）：
//   1. 每次测试生成唯一 runId；
//   2. 账单 note 写带专用前缀的命名空间标记（TEST_NOTE_PREFIX + runId），
//      不是用户可能巧合输入的普通文本；
//   3. runId 与本次账单 ID 持久化到独立测试清单文件（与账本数据分离）；
//   4. 清理优先按清单内账单 ID 精确删除，兜底只扫描命名空间前缀的残留；
//   5. 绝不删除 note 不带测试前缀的账单。

const fs = require('../data/fs');

const TEST_NOTE_PREFIX = '__TEST__:';
const REGISTRY_FILE_NAME = '__test_registry__.json';
const REGISTRY_VERSION = 1;

function registryPath() {
  return fs.userRoot() + '/' + REGISTRY_FILE_NAME;
}

/** 生成唯一运行 ID（前缀 + 时间戳 + 随机），不依赖网络。 */
function makeRunId(prefix) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return String(prefix || 'run') + '-' + ts + '-' + rand;
}

/** 编码测试账单 note（命名空间前缀 + runId）。 */
function encodeTestNote(runId) {
  return TEST_NOTE_PREFIX + runId;
}

/** note 是否属于测试命名空间（绝不仅凭普通文本认定）。 */
function isTestNote(note) {
  return typeof note === 'string' && note.indexOf(TEST_NOTE_PREFIX) === 0;
}

/** 从测试 note 取 runId；非测试 note 返回 null。 */
function runIdFromNote(note) {
  if (!isTestNote(note)) return null;
  return note.slice(TEST_NOTE_PREFIX.length);
}

/** 读取测试清单；损坏 / 不存在返回空骨架（不抛错，保证清理可自愈）。 */
function readRegistry() {
  const fallback = { version: REGISTRY_VERSION, runs: [] };
  const data = fs.readJSON(registryPath(), fallback);
  if (!data || !Array.isArray(data.runs)) return fallback;
  return data;
}

/** 持久化测试清单。 */
function writeRegistry(reg) {
  fs.writeJSON(registryPath(), reg);
}

/** 测试清单文件是否存在（用于区分「测试框架运行过的环境」与全新 / 真实账本）。 */
function registryExists() {
  return fs.exists(registryPath());
}

/** 登记一次测试运行（runId + 账单 ID 列表）。 */
function registerRun(entry) {
  const reg = readRegistry();
  reg.runs.push({
    runId: entry.runId,
    kind: entry.kind || 'test',
    createdAt: entry.createdAt || Date.now(),
    billIds: Array.isArray(entry.billIds) ? entry.billIds : [],
  });
  writeRegistry(reg);
}

/**
 * 清理测试账单：
 *   1) 先按清单内账单 ID 精确删除（不看 note）；
 *   2) 再兜底扫描全部账单，只删除 note 属于测试命名空间的残留；
 *   3) 绝不删除 note 不带测试前缀的账单。
 * @param {object} store 数据层
 * @param {object} [opts]
 * @param {string} [opts.runId] 仅清理指定 run；缺省清理全部测试 run
 * @returns {{removedById:string[],removedByScan:string[],removed:number,months:string[]}}
 */
function cleanupTestBills(store, opts) {
  const options = opts || {};
  const reg = readRegistry();
  const removedById = [];
  const removedByScan = [];
  const touchedMonths = {};

  function mark(id, ym, list) {
    list.push(id);
    if (ym) touchedMonths[ym] = true;
  }

  // 1) 按清单账单 ID 精确删除
  const allBills = store.rangeBills();
  const targetIds = new Set();
  reg.runs.forEach((run) => {
    if (options.runId && run.runId !== options.runId) return;
    run.billIds.forEach((id) => targetIds.add(id));
  });
  targetIds.forEach((id) => {
    try {
      const b = allBills.find((x) => x.id === id);
      const ym = b ? store.ledger.ymOf(b.occurredAt) : null;
      store.deleteBill(id);
      mark(id, ym, removedById);
    } catch (e) {
      /* 已不存在则忽略，继续兜底 */
    }
  });

  // 2) 兜底：扫描命名空间前缀残留
  store.rangeBills().forEach((b) => {
    if (!isTestNote(b.note)) return;
    if (options.runId && runIdFromNote(b.note) !== options.runId) return;
    const ym = store.ledger.ymOf(b.occurredAt);
    try {
      store.deleteBill(b.id);
      mark(b.id, ym, removedByScan);
    } catch (e) {
      /* 忽略 */
    }
  });

  // 3) 更新清单：全量清理清空；指定 run 仅移除该 run
  if (options.runId) {
    reg.runs = reg.runs.filter((r) => r.runId !== options.runId);
  } else {
    reg.runs = [];
  }
  writeRegistry(reg);

  return {
    removedById,
    removedByScan,
    removed: removedById.length + removedByScan.length,
    months: Object.keys(touchedMonths).sort(),
  };
}

module.exports = {
  TEST_NOTE_PREFIX,
  REGISTRY_FILE_NAME,
  makeRunId,
  encodeTestNote,
  isTestNote,
  runIdFromNote,
  readRegistry,
  writeRegistry,
  registryExists,
  registerRun,
  cleanupTestBills,
};
