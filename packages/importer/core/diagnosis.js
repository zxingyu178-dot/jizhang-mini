// packages/importer/core/diagnosis.js
// 导入脱敏诊断：解析失败/部分成功时，生成可安全外发的诊断信息。
//
// 铁律：诊断中绝不包含姓名、商户原文、商品、备注、账号、银行卡、交易号、金额原值，
// 也不包含文件名。只允许出现：来源、文件类型、编码、表头是否找到、行号、列名、
// 列序号、各类计数与枚举化的错误原因。
const MAX_ERRORS = 20;

function newDiagnostic() {
  return {
    source: 'unknown',
    fileType: 'unknown', // xlsx / csv / json / dvbackup / unknown
    encoding: 'unknown', // utf-8 / gb18030 / unknown
    headerFound: false,
    headerRowIndex: -1, // 0-based
    totalDataRows: 0, // 表头之后非空数据行
    nonFlowSkipped: 0, // 不计收支 / 与收支无关，正常跳过
    // 去重 / 校验后由 detector 填充
    counts: null,
    errors: [], // {row, columnName, columnIndex, reason}
  };
}

/**
 * 记录一条行级错误（仅行号、列名、列序号、枚举原因）。
 * @param {object} diag
 * @param {number} rowZeroBased 行下标（0-based，与数组一致）
 * @param {string} columnName 表头列名（固定字段，非个人数据）
 * @param {number} colZeroBased 列下标（-1 表示该列不存在）
 * @param {string} reason 枚举化原因，禁止包含单元格原文
 */
function addError(diag, rowZeroBased, columnName, colZeroBased, reason) {
  if (!diag) return;
  if (diag.errors.length >= MAX_ERRORS) return;
  diag.errors.push({
    row: rowZeroBased + 1, // 转成人类习惯的 1-based（近似 Excel 行号）
    columnName: columnName || '',
    columnIndex: colZeroBased >= 0 ? colZeroBased + 1 : -1,
    reason: reason || '',
  });
}

function setHeader(diag, found, rowZeroBased) {
  if (!diag) return;
  diag.headerFound = !!found;
  diag.headerRowIndex = rowZeroBased == null ? -1 : rowZeroBased;
}

const SOURCE_LABEL = {
  wechat: '微信账单',
  alipay: '支付宝账单',
  dailyvalue: 'Android DailyValue',
  dvmini: 'Mini 完整备份',
  unknown: '未识别',
};

const TYPE_LABEL = {
  xlsx: 'XLSX',
  csv: 'CSV',
  json: 'JSON',
  dvbackup: 'dvbackup',
  unknown: '未知',
};

function line(label, value) {
  return label + '：' + value;
}

/**
 * 生成可复制的脱敏诊断文本（多行）。
 * @param {object} diag
 * @param {string} [fatalMessage] 导致完全无法解析的错误（枚举/通用，不含用户数据）
 */
function toText(diag, fatalMessage) {
  if (!diag) diag = newDiagnostic();
  const c = diag.counts || {};
  const out = [];
  out.push('=== 每日的价值 导入诊断（脱敏，无个人账单内容）===');
  out.push(line('来源识别', SOURCE_LABEL[diag.source] || diag.source || '未识别'));
  out.push(line('文件类型', TYPE_LABEL[diag.fileType] || diag.fileType || '未知'));
  if (diag.encoding && diag.encoding !== 'unknown') {
    out.push(line('文本编码', diag.encoding === 'utf-8' ? 'UTF-8' : diag.encoding === 'gb18030' ? 'GBK/GB18030' : diag.encoding));
  }
  out.push(line('表头找到', diag.headerFound ? '是' : '否（第 ' + (diag.headerRowIndex + 1) + ' 行附近未识别到标准表头）'));
  if (diag.headerRowIndex >= 0) {
    out.push(line('表头所在行', '第 ' + (diag.headerRowIndex + 1) + ' 行'));
  }
  out.push(line('数据行', diag.totalDataRows));
  if (diag.counts) {
    out.push(line('准备导入', c.ready || 0));
    out.push(line('疑似重复（默认不导）', c.suspect || 0));
    out.push(line('已存在（重复，跳过）', (c.existing || 0) + (c.duplicate || 0)));
    out.push(line('需确认（退款/关闭等）', c.needconfirm || 0));
    out.push(line('不计收支/异常跳过', (c.skipped || 0) + diag.nonFlowSkipped));
  }
  if (diag.errors && diag.errors.length) {
    out.push('无法解析的行（最多 ' + MAX_ERRORS + ' 条）：');
    diag.errors.forEach((e) => {
      const col = e.columnIndex > 0 ? '第 ' + e.columnIndex + ' 列' : '某列';
      const name = e.columnName ? '“' + e.columnName + '”' : '';
      out.push('  · 第 ' + e.row + ' 行 ' + col + name + '：' + e.reason);
    });
  }
  if (fatalMessage) {
    out.push('终止原因：' + fatalMessage);
  }
  out.push('（此诊断不含姓名、商户、账号、交易号、金额等原始内容）');
  return out.join('\n');
}

module.exports = {
  newDiagnostic,
  addError,
  setHeader,
  toText,
  MAX_ERRORS,
};
