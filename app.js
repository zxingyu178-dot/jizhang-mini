// app.js
App({
  globalData: {
    appName: '记账mini',
    version: '0.1.0'
  },

  onLaunch() {
    // 本应用为纯本地记账：数据保存在设备 Storage，无需登录、无网络请求。
    // 首次启动数据为空，可在「记账」页添加第一笔记录。
  }
})
