// packages/importer/pages/preview/preview.js
const store = require('../../../../data/index');
const money = require('../../../../data/money');
const theme = require('../../../../utils/theme');
const commit = require('../../core/commit');
const diagnosis = require('../../core/diagnosis');

const SOURCE_LABEL = {
  wechat: '微信支付账单',
  alipay: '支付宝账单',
  dailyvalue: 'DailyValue 数据',
  dvmini: 'Mini 完整备份',
};

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}
function fmtDate(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/**
 * 根据恢复 / 回滚状态生成用户提示（v1.4.2）：
 *   - 未开始修改：原账本未修改；
 *   - 回滚成功：已恢复到操作前状态；
 *   - 回滚失败：恢复未完成，当前状态需检查，安全点保留；
 *   - 状态不明确：无法确认，禁止重复操作。
 */
function recoveryErrorText(err) {
  const code = (err && err.code) || '';
  const suffix = code ? '\n\n错误码：' + code : '';
  if (err && err.mutationStarted === false && !err.rollbackAttempted) {
    return '原账本未修改，请重试。' + suffix;
  }
  if (err && err.rollbackAttempted === true && err.rollbackCompleted === false) {
    return '恢复未完成，当前数据状态需要检查。安全点已保留，请勿重复提交，请返回后人工核对。' + suffix;
  }
  if (err && err.rollbackCompleted === true) {
    return '已恢复到操作前状态，请重试。' + suffix;
  }
  return '无法确认当前数据状态，请勿重复操作，请返回后人工核对。' + suffix;
}

/** 回滚失败 / 状态不明确时禁止再次提交 */
function shouldBlockResubmit(err) {
  if (err && err.mutationStarted === false && !err.rollbackAttempted) return false;
  if (err && err.rollbackAttempted === true && err.rollbackCompleted === true) return false;
  return true;
}

Page({
  data: {
    session: null,
    sourceLabel: '',
    rangeText: '',
    counts: null,
    total: 0,
    samples: [],
    includeSuspect: false,
    isRestore: false,
    currentCount: 0,
    submitting: false,
    submitBlocked: false,
    recurringStats: null, // { recognized, imported, skipped } | null（仅 Android .dvbackup 有）
    themeClass: 'theme-dark',
  },

  onLoad() {
    // 主题绑定：根容器 themeClass 实时跟随，不重启、不丢状态。
    this._offTheme = theme.bindPage(this);
    const session = getApp().globalData.__importSession;
    if (!session) {
      wx.showModal({
        title: '会话已失效',
        content: '请重新选择文件',
        showCancel: false,
        success: () => wx.navigateBack(),
      });
      return;
    }

    const c = session.counts || {};
    const currentCount = store.rangeBills().length;

    // 样例：取 ready/suspect 前 20 条，按时间倒序
    const resolveCategory = store.getCategoryResolver(); // 单次预览快照
    const samples = session.bills
      .filter((b) => b.status === 'ready' || b.status === 'suspect')
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, 20)
      .map((b) => {
        const cat = resolveCategory(b.categoryId);
        return {
          day: fmtDate(b.occurredAt),
          merchant: b.merchant || b.note || (cat ? cat.name : '其他'),
          category: cat ? cat.name : '其他',
          amountText: (b.type === 'income' ? '+' : '-') + money.formatCentsWithSymbol(b.amountCents),
          isIncome: b.type === 'income',
        };
      });

    let rangeText = '';
    if (session.dateRange) {
      rangeText = fmtDate(session.dateRange.start) + ' ～ ' + fmtDate(session.dateRange.end);
    }

    // 周期规则迁移口径（fail-closed）：仅 Android .dvbackup 会有；识别/导入/跳过计数
    const diag0 = session.diagnostic || {};
    let recurringStats = null;
    if (diag0.recurringRulesRecognized > 0) {
      recurringStats = {
        recognized: diag0.recurringRulesRecognized,
        imported: diag0.recurringRulesImported || 0,
        skipped: diag0.recurringRulesSkipped || 0,
      };
    }

    this.setData({
      session,
      sourceLabel: SOURCE_LABEL[session.source] || '账单',
      rangeText,
      counts: c,
      total: session.bills.length,
      samples,
      isRestore: !!session.isRestore,
      currentCount,
      recurringStats,
    });
  },

  onUnload() {
    if (this._offTheme) { this._offTheme(); this._offTheme = null; }
  },

  onToggleSuspect() {
    this.setData({ includeSuspect: !this.data.includeSuspect });
  },

  onConfirm() {
    if (this.data.submitting || this.data.submitBlocked) return;
    this.setData({ submitting: true });
    wx.showLoading({ title: '正在写入…', mask: true });

    const { session, isRestore, includeSuspect } = this.data;

    setTimeout(() => {
      try {
        let result;
        if (isRestore) {
          result = commit.commitRestore(session);
        } else {
          result = commit.commitImport(session, { includeSuspect });
        }

        // 写导入历史（普通导入）
        if (!isRestore) {
          const c = session.counts || {};
          store.addImportHistory({
            source: session.source,
            fileName: session.fileName,
            importedCount: result.imported,
            skippedCount: (c.existing || 0) + (c.duplicate || 0) + (c.skipped || 0),
            duplicateCount: (c.existing || 0) + (c.duplicate || 0),
          });
        }

        getApp().globalData.__importSession = null;
        wx.hideLoading();
        wx.redirectTo({
          url:
            '/packages/importer/pages/result/result?imported=' +
            result.imported +
            '&merged=' +
            (result.merged || 0) +
            '&restore=' +
            (isRestore ? 1 : 0),
        });
      } catch (e) {
        wx.hideLoading();
        const blocked = shouldBlockResubmit(e);
        this.setData({ submitting: false, submitBlocked: blocked });
        wx.showModal({
          title: blocked ? '恢复未完成' : '写入失败',
          content: recoveryErrorText(e),
          showCancel: false,
          confirmText: blocked ? '返回检查' : '知道了',
        });
      }
    }, 30);
  },

  /** 复制脱敏诊断（成功预览也可反馈，确认行数/跳过/需确认口径） */
  onCopyDiagnostic() {
    const session = this.data.session;
    const diag = session && session.diagnostic;
    if (!diag) {
      wx.showToast({ title: '暂无诊断信息', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: diagnosis.toText(diag, null),
      success: () => wx.showToast({ title: '诊断已复制', icon: 'none' }),
    });
  },

  onCancel() {
    wx.navigateBack();
  },
});
