// 深度探测：reLaunch 重载，验证选择器与 size
const automator = require('miniprogram-automator')

async function main() {
  const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9420' })
  console.log('=== connected, reLaunch ===')
  const page = await mp.reLaunch('/pages/main/main')
  await page.waitFor(1500)

  console.log('path:', page.path)

  const shell = await page.$('.shell')
  console.log('shell size:', JSON.stringify(await shell.size()))

  const swiper = await page.$('.swiper')
  console.log('swiper size:', JSON.stringify(await swiper.size()),
    ' offset:', JSON.stringify(await swiper.offset()))

  const allViews = await page.$$('view')
  console.log('页面 view 总数:', allViews.length)

  const pageData = await page.data()
  console.log('page data keys:', Object.keys(pageData).join(','))
  console.log('windowHeight=', pageData.windowHeight, ' headerHeight=', pageData.headerHeight,
    ' swiperTop=', pageData.swiperTop, ' current=', pageData.current)

  process.exit(0)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
