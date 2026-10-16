// app.js
// 注意：data/index 与 data/daily-value 不在文件顶层静态 require，而在生命周期内
// 动态加载。否则 appLaunch 关键路径会同步加载/编译整个数据层，在冷启动时触发
// appLaunch timeout（模拟器白屏、页面栈为空）。版本号模块极轻，可在顶层引入。
const { APP_VERSION } = require('./utils/version');

App({
  globalData: {
    appName: '每日的价值',
    version: APP_VERSION
  },

  onLaunch() {
    // 纯本地账本：建目录、默认分类/设置、无损迁移旧 jm_records / Bill V1→V2。
    // 无登录、无网络、无 OpenID，账单仅保存在设备本地。
    const store = require('./data/index');
    const dv = require('./data/daily-value/index');
    this.$store = store;
    this.$dv = dv;
    try {
      this.dataStatus = store.init();
    } catch (e) {
      console.error('数据层初始化失败', e);
      this.dataStatus = { error: String(e && e.message) };
    }
  },

  onShow() {
    // 从后台切回时日期可能已跨天：先刷新可见日价，再排下一次本地午夜定时器。
    this.refreshVisibleDailyValue();
    this.scheduleMidnight();
  },

  onHide() {
    // 进入后台清掉定时器；回前台 onShow 重新精确调度（避免 DST 漂移）。
    this.clearMidnightTimer();
  },

  /**
   * 排定「下一次本地午夜」定时器（不固定 24h）：
   * 每次精确算到下一个本地 00:00，触发后重新调度，DST 23/25 小时日也准确。
   */
  scheduleMidnight() {
    const dv = this.$dv || require('./data/daily-value/index');
    this.clearMidnightTimer();
    const ms = dv.msUntilNextLocalMidnight();
    this._midnightTimer = setTimeout(() => {
      this.onMidnight();
    }, ms);
  },

  clearMidnightTimer() {
    if (this._midnightTimer) {
      clearTimeout(this._midnightTimer);
      this._midnightTimer = null;
    }
  },

  /** 午夜到达：重算可见日价视图（日价派生，不持久化），再排下一次。 */
  onMidnight() {
    this.refreshVisibleDailyValue();
    this.scheduleMidnight();
  },

  /**
   * 刷新当前可见页面中的日价数据：
   *   - main：刷新三个 Panel（含日价 Hero / 列表）；
   *   - 日价详情：重算详情并刷新曲线。
   */
  refreshVisibleDailyValue() {
    try {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      if (!cur) return;
      if (cur.route === 'pages/main/main' && typeof cur.refreshPanels === 'function') {
        cur.refreshPanels();
      } else if (cur.route === 'pages/daily-value-detail/detail' && typeof cur.loadDetail === 'function') {
        cur.loadDetail();
        const curve = cur.selectComponent('#detailCurve');
        if (curve && typeof curve.refresh === 'function') curve.refresh();
      }
    } catch (e) {
      console.error('日价跨日刷新失败', e);
    }
  }
});
