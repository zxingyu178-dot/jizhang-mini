// packages/importer/core/detector.js
// 格式探测 + 解析主流程：读文件 → 识别来源 → adapter → 校验 → 去重 → 会话。
// 全程收集脱敏诊断（diagnosis），失败时随 error.diagnostic 抛出，成功时挂到 session。
const reader = require('../excel/reader');
const csvEnc = require('../encoding/csv');
const gbkEnc = require('../encoding/gbk');
const validator = require('./validator');
const dedupe = require('./dedupe');
const diagnosis = require('./diagnosis');
const wechat = require('../adapters/wechat');
const alipay = require('../adapters/alipay');
const dailyvalue = require('../adapters/dailyvalue');
const dvmini = require('../adapters/dvmini');

const MAX_FILE = 15 * 1024 * 1024;

function bufferToText(buffer) {
  return gbkEnc.decodeBytes(buffer).text;
}

/** 在二维数组中扫描表头关键字，判定来源 */
function detectTableSource(rows) {
  let text = '';
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    text += rows[i].join(' ') + ' ';
  }
  if (text.indexOf('交易分类') >= 0 || text.indexOf('收/付款方式') >= 0 || text.indexOf('对方账号') >= 0) {
    return 'alipay';
  }
  if (text.indexOf('交易单号') >= 0 || text.indexOf('商户单号') >= 0 || text.indexOf('微信支付') >= 0) {
    return 'wechat';
  }
  if (text.indexOf('账本影响') >= 0 || (text.indexOf('日期') >= 0 && text.indexOf('来源') >= 0)) {
    return 'dailyvalue';
  }
  return 'wechat';
}

function parseFile(file) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: file.path,
      success: (res) => {
        try {
          resolve(processData(res.data, file));
        } catch (e) {
          reject(e);
        }
      },
      fail: () => reject(new Error('文件读取失败，请重试')),
    });
  });
}

function processData(buffer, file) {
  const diag = diagnosis.newDiagnostic();
  const name = file.name || '';
  const lower = name.toLowerCase();

  if (file.size && file.size > MAX_FILE) {
    throw new Error('文件较大，请按较短时间范围重新导出账单');
  }
  if (lower.endsWith('.zip')) {
    throw new Error('这个账单还是压缩包，请先用微信提供的密码解压，再把 Excel/CSV 发到文件传输助手');
  }

  let session;
  try {
    session = doParse(buffer, file, lower, diag);
  } catch (e) {
    // 失败：带上脱敏诊断，便于用户在不提供真实账单的前提下反馈
    e.diagnostic = diag;
    throw e;
  }
  if (session.diagnostic) return session;
  return session;
}

function doParse(buffer, file, lower, diag) {
  const name = file.name || '';
  let bills = [];
  let source = file.hintedSource || '';
  let restoreObj = null;

  if (lower.endsWith('.xlsx')) {
    diag.fileType = 'xlsx';
    const { rows } = reader.readFirstSheet(buffer);
    source = source || detectTableSource(rows);
    diag.source = source;
    const adapter = source === 'alipay' ? alipay : wechat;
    bills = adapter.parseRows(rows, source, diag);
  } else if (lower.endsWith('.csv')) {
    diag.fileType = 'csv';
    // UTF-8 自动识别；GBK 先系统 TextDecoder，不支持则纯 JS CP936 fallback，无需用户转码
    const decoded = gbkEnc.decodeBytes(buffer);
    diag.encoding = decoded.encoding || 'unknown';
    const rows = csvEnc.parseCSV(decoded.text);
    source = source || detectTableSource(rows);
    diag.source = source;
    if (source === 'dailyvalue') {
      bills = dailyvalue.parseRows(rows, 'dailyvalue', diag);
    } else if (source === 'alipay') {
      bills = alipay.parseRows(rows, 'alipay', diag);
    } else {
      bills = wechat.parseRows(rows, 'wechat', diag);
    }
  } else if (lower.endsWith('.dvbackup')) {
    diag.fileType = 'dvbackup';
    const obj = JSON.parse(bufferToText(buffer));
    bills = dailyvalue.parseBackup(obj);
    source = 'dailyvalue';
    diag.source = source;
  } else if (lower.endsWith('.json')) {
    diag.fileType = 'json';
    const obj = JSON.parse(bufferToText(buffer));
    if (obj.format === 'daily-value-mini-backup') {
      bills = dvmini.parse(obj);
      source = 'dvmini';
      restoreObj = obj;
    } else {
      bills = dailyvalue.parseBackup(obj);
      source = 'dailyvalue';
    }
    diag.source = source;
  } else {
    // 无明确扩展名，尝试 JSON
    diag.fileType = 'unknown';
    try {
      const obj = JSON.parse(bufferToText(buffer));
      if (obj.format === 'daily-value-mini-backup') {
        bills = dvmini.parse(obj);
        source = 'dvmini';
        restoreObj = obj;
      } else {
        bills = dailyvalue.parseBackup(obj);
        source = 'dailyvalue';
      }
      diag.source = source;
    } catch (e) {
      throw new Error('无法识别的文件格式，请选择账单导出的 Excel/CSV/备份文件');
    }
  }

  // Mini 完整恢复：不做导入去重，整库替换
  if (source === 'dvmini') {
    let dateRange = null;
    if (bills.length) {
      const ts = bills.map((b) => b.occurredAt);
      dateRange = { start: Math.min(...ts), end: Math.max(...ts) };
    }
    diag.counts = { ready: bills.length, existing: 0, duplicate: 0, suspect: 0, skipped: 0, needconfirm: 0 };
    return {
      source,
      fileName: name,
      bills,
      counts: diag.counts,
      dateRange,
      isRestore: true,
      restoreObj,
      diagnostic: diag,
    };
  }

  bills = validator.validateAll(bills);
  bills = dedupe.classify(bills);
  const counts = dedupe.countByStatus(bills);
  diag.counts = counts;

  const valid = bills.filter((b) => b.status === 'ready' || b.status === 'suspect');
  let dateRange = null;
  if (valid.length) {
    const ts = valid.map((b) => b.occurredAt);
    dateRange = { start: Math.min(...ts), end: Math.max(...ts) };
  }

  return {
    source,
    fileName: name,
    bills,
    counts,
    dateRange,
    diagnostic: diag,
  };
}

module.exports = {
  parseFile,
  detectTableSource,
};
