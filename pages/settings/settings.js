// pages/settings/settings.js
// 设置：数据导入入口、备份/恢复（.dvmini.json）、导入历史、关于。
const store = require('../../data/index');
const device = require('../../utils/device');

const SOURCE_META = {
  wechat: { icon: '💚', name: '微信账单' },
  alipay: { icon: '🅰️', name: '支付宝账单' },
  dailyvalue: { icon: '📱', name: 'Android DailyValue' },
  dvmini: { icon: '📦', name: 'Mini 备份' },
};

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}
function fmtTime(ts) {
  const d = new Date(ts);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    version: '0.2.0',
    history: [],
  },
  onLoad() {
    const info = device.get();
    this.setData({
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      headerHeight: info.headerHeight,
    });
  },
  onShow() {
    this.loadHistory();
  },
  loadHistory() {
    const h = store.getImportHistory().slice(0, 10).map((r) => {
      const meta = SOURCE_META[r.source] || { icon: '📄', name: r.fileName || '数据文件' };
      return {
        id: r.id,
        icon: meta.icon,
        name: meta.name,
        time: fmtTime(r.importedAt),
        count: r.importedCount,
      };
    });
    this.setData({ history: h });
  },
  onBack() {
    wx.navigateBack({ delta: 1 });
  },

  /** 数据导入：统一导入引擎分包 */
  onImport() {
    wx.navigateTo({ url: '/packages/importer/pages/import/import' });
  },

  /** 备份：生成 .dvmini.json 并分享到微信（文件传输助手） */
  onExport() {
    try {
      const backup = store.buildBackup();
      const json = JSON.stringify(backup, null, 2);
      const d = new Date();
      const stamp = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
      const filePath = wx.env.USER_DATA_PATH + '/daily-value-mini-backup-' + stamp + '.dvmini.json';
      wx.getFileSystemManager().writeFileSync(filePath, json, 'utf8');
      wx.shareFileMessage({
        filePath,
        success: () => wx.showToast({ title: '可发送到文件传输助手', icon: 'none' }),
        fail: () => wx.showToast({ title: '已生成备份文件', icon: 'none' }),
      });
    } catch (e) {
      wx.showToast({ title: '备份失败', icon: 'none' });
    }
  },

  /** 恢复：从微信文件选择 .dvmini.json */
  onRestore() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: (res) => {
        const tempPath = res.tempFiles[0].path;
        let backup;
        try {
          const content = wx.getFileSystemManager().readFileSync(tempPath, 'utf8');
          backup = JSON.parse(content);
        } catch (e) {
          wx.showToast({ title: '不是有效的备份文件', icon: 'none' });
          return;
        }
        wx.showModal({
          title: '恢复备份',
          content: '恢复将覆盖当前全部数据，建议先备份。确定继续吗？',
          confirmText: '恢复',
          confirmColor: '#ff4d4d',
          cancelText: '取消',
          success: (r) => {
            if (!r.confirm) return;
            try {
              const result = store.restoreBackup(backup);
              wx.showToast({ title: '已恢复 ' + result.restored + ' 笔', icon: 'none' });
              this.loadHistory();
            } catch (e) {
              wx.showToast({ title: '恢复失败，已回滚', icon: 'none' });
            }
          },
        });
      },
    });
  },
});
