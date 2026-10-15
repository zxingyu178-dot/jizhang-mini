// packages/importer/pages/result/result.js
Page({
  data: {
    imported: 0,
    isRestore: false,
  },

  onLoad(query) {
    this.setData({
      imported: Number(query.imported || 0),
      isRestore: query.restore === '1',
    });
  },

  onFinish() {
    wx.reLaunch({ url: '/pages/main/main' });
  },
});
