// packages/importer/pages/import/import.js
// 导入入口：三个来源 + 导出方法说明 + 从微信文件选择。
const device = require('../../../../utils/device');
const store = require('../../../../data/index');
const detector = require('../../core/detector');
const diagnosis = require('../../core/diagnosis');

const SOURCE_NAME = {
  wechat: '微信账单',
  alipay: '支付宝账单',
  dailyvalue: 'Android DailyValue',
  dvmini: 'Mini 备份',
};

function fmtTime(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
}

const SOURCES = [
  {
    key: 'dailyvalue',
    icon: '📱',
    name: 'DailyValue 数据',
    desc: 'Android DailyValue 导出的 CSV 或 .dvbackup',
    expanded: false,
    guide:
      '1. 打开 Android 上的 DailyValue；\n2. 设置 → 数据备份 → 导出 CSV 或 .dvbackup；\n3. 分享到微信「文件传输助手」；\n4. 回到本页，点「从微信文件中选择」。',
    iosTip: 'DailyValue 为 Android 应用，iPhone 可选择微信 / 支付宝账单导入。',
  },
  {
    key: 'wechat',
    icon: '💚',
    name: '微信账单',
    desc: '微信个人账单（XLSX 或 CSV）',
    expanded: false,
    guide:
      '1. 微信 → 我 → 服务 → 钱包 → 账单；\n2. 右上角「常见问题」→「下载账单」；\n3. 用途选「个人对账」，选择时间范围；\n4. 账单发送到邮箱，解压后把 Excel/CSV 发到微信「文件传输助手」。',
    iosTip: '邮箱文件先在「文件」App 解压，再分享到微信「文件传输助手」。',
  },
  {
    key: 'alipay',
    icon: '🅰️',
    name: '支付宝账单',
    desc: '支付宝个人账单（XLSX 或 CSV）',
    expanded: false,
    guide:
      '1. 支付宝 → 我的 → 账单；\n2. 右上角「...」→「开具交易流水证明」；\n3. 选「用于个人对账」，选择时间范围；\n4. 证明发到邮箱，解压后把 Excel/CSV 发到微信「文件传输助手」。',
    iosTip: 'CSV 若乱码，本应用会自动识别编码，无需手动转换。',
  },
];

const EXT_BY_SOURCE = {
  dailyvalue: ['csv', 'json', 'dvbackup'],
  wechat: ['xlsx', 'csv'],
  alipay: ['xlsx', 'csv'],
};

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    sources: SOURCES,
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
    const history = store.getImportHistory().slice(0, 8).map((r) => ({
      id: r.id,
      name: SOURCE_NAME[r.source] || r.fileName || '数据文件',
      time: fmtTime(r.importedAt),
      count: r.importedCount,
    }));
    this.setData({ history });
  },
  onToggleGuide(e) {
    const key = e.currentTarget.dataset.key;
    const sources = this.data.sources.map((s) =>
      s.key === key ? Object.assign({}, s, { expanded: !s.expanded }) : s
    );
    this.setData({ sources });
  },
  onChooseFile(e) {
    const source = e.currentTarget.dataset.key;
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: EXT_BY_SOURCE[source],
      success: (res) => {
        const file = res.tempFiles[0];
        if (!file) return;
        wx.showLoading({ title: '正在解析…', mask: true });
        // 交给 detector 解析；成功后跳预览页
        detector
          .parseFile({ path: file.path, size: file.size, name: file.name, hintedSource: source })
          .then((session) => {
            wx.hideLoading();
            getApp().globalData.__importSession = session;
            wx.navigateTo({ url: '/packages/importer/pages/preview/preview' });
          })
          .catch((err) => {
            wx.hideLoading();
            const message = (err && err.message) || '文件格式无法识别，请确认是账单导出文件。';
            const diag = err && err.diagnostic;
            if (!diag) {
              wx.showModal({ title: '无法解析', content: message, showCancel: false });
              return;
            }
            // 有脱敏诊断：提供“复制诊断”，用户可在不提供真实账单的前提下反馈
            wx.showModal({
              title: '无法解析',
              content: message + '\n\n可复制脱敏诊断（不含姓名、商户、账号、交易号、金额）后反馈。',
              confirmText: '复制诊断',
              cancelText: '关闭',
              success: (r) => {
                if (!r.confirm) return;
                wx.setClipboardData({
                  data: diagnosis.toText(diag, message),
                  success: () => wx.showToast({ title: '诊断已复制', icon: 'none' }),
                });
              },
            });
          });
      },
    });
  },
});
