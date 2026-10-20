// pages/backup-restore/backup-restore.js
// 备份与恢复：创建备份（.dvmini.json）+ 从微信文件恢复。
const device = require('../../utils/device');
const store = require('../../data/index');
const theme = require('../../utils/theme');

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 备份导出目录与本地缓存保留份数（v0.8.0/G10：不无限堆积临时导出） */
const EXPORT_DIR = wx.env.USER_DATA_PATH + '/exports';
const EXPORT_KEEP = 3;

/**
 * 清理 exports/ 目录：只保留最近 EXPORT_KEEP 个 .dvmini.json（文件名含日期戳，按名倒序）。
 * 同一天导出覆盖同一文件，故约等于保留最近 3 天的本地备份缓存。
 */
function pruneExports() {
  const fsm = wx.getFileSystemManager();
  try {
    fsm.mkdirSync(EXPORT_DIR, true);
  } catch (e) {}
  let names = [];
  try {
    names = fsm.readdirSync(EXPORT_DIR);
  } catch (e) {
    names = [];
  }
  const files = names
    .filter((n) => /\.dvmini\.json$/.test(n))
    .map((n) => EXPORT_DIR + '/' + n)
    .sort((a, b) => (a < b ? 1 : -1)); // 文件名含日期戳，新的在前
  files.slice(EXPORT_KEEP).forEach((full) => {
    try {
      fsm.unlinkSync(full);
    } catch (e) {}
  });
}

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    themeClass: 'theme-dark',
    lastBackup: '',
  },
  onLoad() {
    const info = device.get();
    this.setData({
      windowHeight: info.windowHeight,
      statusBarHeight: info.statusBarHeight,
      headerHeight: info.headerHeight,
    });
    // 主题绑定：根容器 themeClass 实时跟随，不重启、不丢状态。
    this._offTheme = theme.bindPage(this);
  },
  onUnload() {
    if (this._offTheme) { this._offTheme(); this._offTheme = null; }
  },

  /** 创建备份：生成 .dvmini.json 并分享到微信（文件传输助手） */
  onExport() {
    try {
      const backup = store.buildBackup();
      const json = JSON.stringify(backup, null, 2);
      const d = new Date();
      const stamp = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
      const filePath = EXPORT_DIR + '/daily-value-mini-backup-' + stamp + '.dvmini.json';
      wx.getFileSystemManager().mkdirSync(EXPORT_DIR, true);
      wx.getFileSystemManager().writeFileSync(filePath, json, 'utf8');
      // 清理旧的本地导出缓存（只保留最近 3 个），不影响已分享到微信的副本
      pruneExports();
      this.setData({
        lastBackup: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
      });
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
          content: '恢复将覆盖当前全部数据，建议先创建备份。确定继续吗？',
          confirmText: '恢复',
          confirmColor: '#ff4d4d',
          cancelText: '取消',
          success: (r) => {
            if (!r.confirm) return;
            try {
              const result = store.restoreBackup(backup);
              // 恢复后立即重算周期 nextOccurrence / 补齐到期账单，不强制用户切后台再回来
              if (store.recurring && typeof store.recurring.runRecurringGenerator === 'function') {
                Promise.resolve(store.recurring.runRecurringGenerator()).catch((e) => {
                  console.error('恢复后周期补齐失败', e);
                });
              }
              if (result.warningCount > 0) {
                wx.showModal({
                  title: '恢复完成',
                  content:
                    '已恢复 ' + result.restored + ' 笔账单。检测到 ' + result.warningCount +
                    ' 项历史引用提示（如已删除的分类或周期规则），不影响正常使用。',
                  showCancel: false,
                  confirmText: '知道了',
                });
              } else {
                wx.showToast({ title: '已恢复 ' + result.restored + ' 笔', icon: 'none' });
              }
            } catch (e) {
              wx.showToast({ title: '恢复失败，已回滚', icon: 'none' });
            }
          },
        });
      },
    });
  },
});
