/**
 * utils/submit-guard.js — 保存入口防连点锁（v1.4.0 P1-01）
 *
 * 四处保存入口（记账 / 日价 / 周期 / 预算）共用同一份极小实现，
 * 避免各写一份出现语义漂移（历史上只有预算页有锁，另外三处连点即重复写库）。
 *
 * 接口（只有三个方法）：
 *   begin() 空闲则占用并返回 true；已被占用返回 false —— 调用方拿到 false 必须直接 return，
 *           不得进入保存流程（不写库、不弹确认框）。
 *   end()   释放。**失败路径必须在 catch 里调用**，否则一次异常就永久锁死按钮。
 *   busy()  只读状态，不改状态（供按钮置灰 / 测试断言使用）。
 *
 * 为什么成功路径不立刻 end()：
 *   真实重复写入的窗口不只在保存函数内部——保存成功后父页才把 Bottom Sheet 关掉，
 *   关之前要等 hideKeyboard（≤120ms 兜底）再播 300ms 收起动画，这段时间按钮还在屏上、
 *   仍然可以点第二次。所以成功路径保持占用，直到表单重新进入（reset() / edit() /
 *   重新打开发层时调用 end()）。全程事件驱动，**不用 setTimeout 计时假解锁**。
 */

function createSubmitGuard() {
  let busy = false;
  return {
    begin() {
      if (busy) return false;
      busy = true;
      return true;
    },
    end() {
      busy = false;
    },
    busy() {
      return busy;
    },
  };
}

module.exports = { createSubmitGuard };
