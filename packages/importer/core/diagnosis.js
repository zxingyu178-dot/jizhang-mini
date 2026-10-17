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
    nonFlowSkipped: 0, // 不计收支 / 中性，正常跳过
    expenseRows: 0, // 收/支=支出 的数据行
    incomeRows: 0, // 收/支=收入 的数据行
    missingColumns: [], // 表头已识别但缺失的关键列主名（如「金额」）
    // 去重 / 校验后由 detector 填充
    counts: null,
    errors: [], // {row, columnName, columnIndex, reason}
  };
}

/** 记录表头已识别但缺失的关键列（主名），用于“列格式变化”诊断 */
function setMissingColumns(diag, arr) {
  if (!diag) return;
  diag.missingColumns = Array.isArray(arr) ? arr : [];
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

// 周期规则被 fail-closed 跳过的原因（枚举化，不含任何用户内容）
const RECURRING_SKIP_REASON_LABEL = {
  'invalid-frequency': '频率不支持',
  'invalid-day': '周期日期非法',
  'invalid-month': '周期月份非法',
  'invalid-amount': '金额非法',
  'invalid-start-date': '开始日期非法',
  'invalid-interval': '间隔非法',
  unknown: '未知格式异常',
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
  if (diag.missingColumns && diag.missingColumns.length) {
    out.push(line('缺失必需列', diag.missingColumns.join('、')));
  }
  out.push(line('数据行', diag.totalDataRows));
  // 结构摘要（按官方「收/支」字段统计，不含金额明细）
  out.push(line('结构摘要', '支出 ' + (diag.expenseRows || 0) + ' / 收入 ' + (diag.incomeRows || 0) + ' / 中性 ' + (diag.nonFlowSkipped || 0)));
  if (diag.counts) {
    out.push(line('准备导入', c.ready || 0));
    out.push(line('疑似重复（默认不导）', c.suspect || 0));
    out.push(line('已存在（重复，跳过）', (c.existing || 0) + (c.duplicate || 0)));
    out.push(line('需确认（退款/关闭等）', c.needconfirm || 0));
    out.push(line('不计收支/异常跳过', (c.skipped || 0) + diag.nonFlowSkipped));
  }
  // 周期规则迁移（fail-closed）：识别 / 导入 / 跳过（仅计数 + 枚举原因，无规则内容）
  if (diag.recurringRulesRecognized > 0) {
    out.push(line('周期规则识别', diag.recurringRulesRecognized));
    out.push(line('周期规则导入', diag.recurringRulesImported || 0));
    out.push(line('周期规则跳过（格式异常）', diag.recurringRulesSkipped || 0));
    if ((diag.recurringRulesSkipped || 0) > 0 && diag.recurringSkipReasons) {
      const parts = Object.keys(diag.recurringSkipReasons).map((k) => {
        const label = RECURRING_SKIP_REASON_LABEL[k] || k;
        return label + ' ' + diag.recurringSkipReasons[k] + ' 条';
      });
      out.push('  跳过原因：' + parts.join('、'));
    }
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
  setMissingColumns,
  toText,
  MAX_ERRORS,
};
