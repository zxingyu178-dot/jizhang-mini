// packages/importer/pages/import/import.js
// 导入入口：三个来源 + 导出方法说明 + 从微信文件选择。
const device = require('../../../../utils/device');
const store = require('../../../../data/index');
const theme = require('../../../../utils/theme');
const fs = require('../../../../data/fs');
const env = require('../../../../utils/env');
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

/** E2E 临时文件扩展名白名单（与真实文件选择器接受类型一致，另保留 zip 用于拒绝路径测试） */
const E2E_ALLOWED_EXT = ['csv', 'xlsx', 'dvbackup', 'json', 'zip'];

/**
 * E2E 临时文件名：固定目录 + 自动生成文件名，杜绝 ../ 路径穿越。
 * 只保留 basename，非法字符替换为 _，扩展名不在白名单时回退 csv。
 */
function e2eTempFileName(raw) {
  const base = String(raw || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop();
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_');
  const parts = cleaned.split('.');
  let ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
  if (E2E_ALLOWED_EXT.indexOf(ext) < 0) ext = 'csv';
  const stem = parts.join('.').replace(/^\.+/, '').slice(0, 40) || 'import';
  return 'e2e-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + stem + '.' + ext;
}

Page({
  data: {
    windowHeight: 0,
    statusBarHeight: 0,
    headerHeight: 0,
    themeClass: 'theme-dark',
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
    // 主题绑定：根容器 themeClass 实时跟随，不重启、不丢状态。
    this._offTheme = theme.bindPage(this);
  },
  onUnload() {
    if (this._offTheme) { this._offTheme(); this._offTheme = null; }
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

  /**
   * E2E 专用：直接解析一段账单文本（不唤起文件选择器）。
   *
   * 边界：
   *   - 仅 develop 环境可用（trial / release / 无法识别一律抛错，fail-closed）；
   *   - 不改变 onChooseFile 的真实文件选择路径；
   *   - 只写 USER_DATA_PATH 下的临时文件，解析结束即删除；
   *   - 结果写入 data.__e2eLast 供自动化轮询（不弹 UI、不落正式账本）。
   */
  __e2eImportText(payload) {
    if (!env.isDevEnv()) {
      throw new Error('__e2eImportText 仅开发环境可用');
    }
    const text = payload && payload.text;
    const name = e2eTempFileName(payload && payload.name);
    const source = (payload && payload.source) || 'alipay';
    if (typeof text !== 'string' || !text) {
      throw new Error('__e2eImportText 缺少 text');
    }
    const filePath = fs.userRoot() + '/__e2e_import__/' + name;
    fs.writeText(filePath, text);
    const cleanup = () => {
      try { fs.remove(filePath); } catch (e) {}
    };
    this.setData({ __e2eLast: null });
    return detector
      .parseFile({ path: filePath, size: text.length, name: name, hintedSource: source })
      .then((session) => {
        cleanup();
        getApp().globalData.__importSession = session;
        const out = {
          ok: true,
          total: session.bills.length,
          counts: session.counts || null,
          isRestore: !!session.isRestore,
        };
        this.setData({ __e2eLast: out });
        return out;
      })
      .catch((err) => {
        cleanup();
        const out = { ok: false, error: (err && err.message) || '解析失败' };
        this.setData({ __e2eLast: out });
        return out;
      });
  },
});
