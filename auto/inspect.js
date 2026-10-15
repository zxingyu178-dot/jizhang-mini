// miniprogram-automator 布局诊断（element.$ 穿透自定义组件）
// 用法：node auto/inspect.js
const automator = require('miniprogram-automator')

async function main() {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' })
  console.log('=== connected, reLaunch ===')
  const page = await mp.reLaunch('/pages/main/main')
  await page.waitFor(1500)

  // 页面级
  async function ps(sel, label) {
    const el = await page.$(sel)
    if (!el) return console.log(`[缺失] ${label}`)
    const s = await el.size(); const o = await el.offset()
    console.log(`${label}: ${s.width} x ${s.height}  @(${o.left}, ${o.top})`)
  }
  console.log('--- 页面级 ---')
  await ps('.shell', 'shell       ')
  await ps('.swiper', 'swiper      ')

  // 自定义组件 Element
  const comp = await page.$('#accountingPanel')
  console.log('component tagName:', comp ? comp.tagName : 'NULL')

  async function cs(sel, label) {
    const el = await comp.$(sel)
    if (!el) return console.log(`[缺失] ${label}`)
    const s = await el.size(); const o = await el.offset()
    console.log(`${label}: ${s.width} x ${s.height}  @(${o.left}, ${o.top})`)
  }

  console.log('--- accounting 组件内部 ---')
  await cs('.panel-scroll', 'scroll-view ')
  await cs('.acc', 'acc         ')
  await cs('.acc__month', 'month       ')
  await cs('.acc__numbers', 'glass-card  ')
  await cs('.num-block', 'num-block   ')
  await cs('.num-row', 'num-row     ')
  await cs('.num-label', 'num-label   ')
  await cs('.num-value', 'num-value   ')

  console.log('--- 收入/结余两个 num-half ---')
  const halves = await comp.$$('.num-half')
  for (let i = 0; i < halves.length; i++) {
    const s = await halves[i].size(); const o = await halves[i].offset()
    console.log(`num-half[${i}]: ${s.width} x ${s.height}  @(${o.left}, ${o.top})`)
  }

  process.exit(0)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
