// app.js
const store = require('./data/index');

App({
  globalData: {
    appName: '每日的价值',
    version: '0.2.0'
  },

  onLaunch() {
    // 纯本地账本：建目录、默认分类/设置、无损迁移旧 jm_records。
    // 无登录、无网络、无 OpenID，账单仅保存在设备本地。
    try {
      this.dataStatus = store.init();
    } catch (e) {
      console.error('数据层初始化失败', e);
      this.dataStatus = { error: String(e && e.message) };
    }
  }
});
