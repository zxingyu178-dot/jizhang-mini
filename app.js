// app.js
// 注意：data/index 与 data/daily-value 不在文件顶层静态 require，而在生命周期内
// 动态加载。否则 appLaunch 关键路径会同步加载/编译整个数据层，在冷启动时触发
// appLaunch timeout（模拟器白屏、页面栈为空）。版本号模块极轻，可在顶层引入。
const { APP_VERSION } = require('./utils/version');
const theme = require('./utils/theme');

App({
  globalData: {
    appName: '随时随地大小记',
    version: APP_VERSION,
    themeMode: 'dark',
    effectiveTheme: 'dark'
  },

  onLaunch() {
    // 主题尽早初始化（数据层之前），避免浅色用户冷启动「先黑后白」。
    this.initTheme();
    // 纯本地账本：建目录、默认分类/设置、无损迁移旧 jm_records / Bill V1→V2。
    // 无登录、无网络、无 OpenID，账单仅保存在设备本地。
    // 全局启动键盘/窗口恢复监听（v0.8.1 Android 键盘白条保险）。
    try {
      require('./utils/viewport').start();
    } catch (e) {
      /* 忽略，不影响启动 */
    }
    const store = require('./data/index');
    const dv = require('./data/daily-value/index');
    this.$store = store;
    this.$dv = dv;
    try {
      // G6：先做只读完整性扫描。发现损坏则进入数据保护模式，不执行正常初始化
      // （避免 ensureManifest 重建清单、损坏月被新账覆盖等），等用户在保护模式处理。
      const si = require('./data/storage-integrity');
      let scan = null;
      try {
        scan = si.scanStorage();
      } catch (e) {
        scan = { ok: false, scanError: String(e && e.message) };
      }
      if (!scan.ok) {
        this.protection = scan;
        this.globalData.protection = scan;
        console.warn('检测到本地存储异常，进入数据保护模式');
        return;
      }
      // 完整性已通过：清理上次原子写中途崩溃留下的残留。仅清理「正式文件 VALID」的
      // .tmp/.bak（safeToClean）；正式文件 MISSING 的孤儿残留不自动处理（可能是可恢复候选）。
      try {
        const fsSafe = require('./data/fs');
        (scan.leftovers || []).forEach((lf) => {
          if (lf.safeToClean) {
            try { fsSafe.remove(lf.file); } catch (e2) {}
          }
        });
      } catch (e1) {}
      this.dataStatus = store.init();
      // 冷启动补齐「已到期但未生成」的周期账单（含长期未打开后的 catch-up）。
      // 附加能力，失败不阻断启动（生成器内部已隔离，这里再兜底防止 unhandled rejection）。
      this.runRecurringCatchup().catch((e) => {
        console.error('启动周期补生成失败', e);
      });
    } catch (e) {
      console.error('数据层初始化失败', e);
      this.dataStatus = { error: String(e && e.message) };
      // 初始化抛错也进入数据保护模式
      this.protection = { ok: false, initError: String(e && e.message) };
      this.globalData.protection = this.protection;
    }
  },

  /**
   * 初始化主题：读取/解析 effectiveTheme、写 globalData、同步原生窗口色、订阅变化。
   * 只改主题 class 与窗口色，不重置数据、不 reLaunch。
   */
  initTheme() {
    try {
      const s = theme.init();
      this.globalData.themeMode = s.themeMode;
      this.globalData.effectiveTheme = s.effectiveTheme;
      this.syncChrome(s.effectiveTheme);
      theme.subscribe((s2) => {
        this.globalData.themeMode = s2.themeMode;
        this.globalData.effectiveTheme = s2.effectiveTheme;
        this.syncChrome(s2.effectiveTheme);
      });
      // Native Chrome Guard：系统主题变化但 App 为手动模式时，内容不跟随，
      // 但原生 Chrome 可能被系统重置，按当前 effectiveTheme 重新守住窗口颜色。
      theme.onChromeNeed((eff) => {
        this.syncChrome(eff);
      });
    } catch (e) {
      console.warn('主题初始化失败，使用深色', e);
    }
  },

  /**
   * 同步原生窗口外观（feature detect + 容错）：
   *   dark → 状态/窗口前景白、背景深；light → 前景黑、背景浅。
   * 微信右上角胶囊为平台控件，不自行绘制、不改其内部样式。
   */
  syncChrome(effective) {
    try {
      if (effective === 'light') {
        if (wx.setNavigationBarColor) {
          wx.setNavigationBarColor({ frontColor: '#000000', backgroundColor: '#f3f4fa' });
        }
        if (wx.setBackgroundColor) {
          wx.setBackgroundColor({ backgroundColor: '#f3f4fa', backgroundColorTop: '#f3f4fa', backgroundColorBottom: '#e9ecf6' });
        }
      } else {
        if (wx.setNavigationBarColor) {
          wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: '#05060a' });
        }
        if (wx.setBackgroundColor) {
          wx.setBackgroundColor({ backgroundColor: '#05060a', backgroundColorTop: '#05060a', backgroundColorBottom: '#0b0d16' });
        }
      }
    } catch (e) {
      /* 忽略，不影响启动 */
    }
  },

  onShow() {
    // 前台主题校准必须在保护模式判断之前：保护模式是异常时最不能再出现 UI 错乱的页面。
    // system 模式补偿后台期间可能丢失的系统主题变化（内容跟随）；
    // 无论是否变化都重新守住原生窗口颜色（防后台被系统重置，含手动模式）。
    try {
      const rs = theme.refreshSystemTheme();
      this.globalData.themeMode = rs.themeMode;
      this.globalData.effectiveTheme = rs.effectiveTheme;
      this.syncChrome(rs.effectiveTheme);
    } catch (e) {
      console.warn('前台主题校准失败', e);
    }
    // G6 保护模式：不补账、不刷新正常视图（恢复需重启小程序）；
    // 但主题 / 原生窗口已在上面校准，保护模式页面也能跟随系统。
    if (this.protection) return;
    // 回前台：先补齐后台期间到期的周期账单，再刷新时间敏感视图（日价 / 预算 / 周期），排午夜。
    // 周期是附加能力：无论补生成成功与否（含 rejected），刷新都必须执行，且不产生 unhandled rejection。
    this.runRecurringCatchup()
      .catch((e) => {
        console.error('周期账单补生成失败', e);
      })
      .finally(() => {
        this.refreshTimeSensitiveViews();
      });
    this.scheduleMidnight();
  },

  /**
   * 周期账单补生成（小程序无后台常驻）：
   * 每次冷启动 / 回到前台时，自动补齐所有已经到期但尚未生成的周期账单。
   * 生成器内部带并发锁，onLaunch 与首次 onShow 短时重复触发也只跑一个 drain。
   */
  runRecurringCatchup() {
    try {
      const store = this.$store || require('./data/index');
      if (!store.isInitialized()) return Promise.resolve(null);
      return store.recurring.runRecurringGenerator();
    } catch (e) {
      console.error('周期账单补生成失败', e);
      return Promise.resolve(null);
    }
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

  /** 午夜到达：重算可见时间敏感视图（日价 / 预算，均为派生不持久化），再排下一次。 */
  onMidnight() {
    this.refreshTimeSensitiveViews();
    this.scheduleMidnight();
  },

  /**
   * 刷新当前可见页面中的时间敏感数据（日价 + 预算）：
   *   - main：刷新三个 Panel（日价 Hero / 列表、预算 Hero / 日历）；
   *   - 日价详情：重算详情并刷新曲线。
   * 不建第二套午夜 Timer，预算与日价共用同一刷新入口。
   */
  refreshTimeSensitiveViews() {
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
      } else if (cur.route === 'pages/search/search' && typeof cur.refreshAfterExternalDataChange === 'function') {
        // 回前台周期补账后，刷新 Bill Explorer 会话快照并保持当前筛选，不重建页面
        cur.refreshAfterExternalDataChange();
      }
    } catch (e) {
      console.error('时间敏感视图跨日刷新失败', e);
    }
  }
});
