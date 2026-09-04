import puppeteer from 'puppeteer-core'
import Database from 'better-sqlite3'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:8080'
const EMAIL = 'tariq@orisonigt.com'
const PIN = '1234'
const SERIAL = '359999001234567'
const LOG = join(process.cwd(), 'tests', 'e2e-run.log')
const SHOTDIR = join(process.cwd(), 'tests', 'shots')

mkdirSync(SHOTDIR, { recursive: true })
const log = []
const out = (...a) => { log.push(a.join(' ')); try { console.log(...a) } catch (e) {} }

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  const tag = cond ? 'PASS' : 'FAIL'
  if (cond) pass++; else fail++
  out(`${tag}  ${name}${extra ? '  [' + extra + ']' : ''}`)
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

let page, browser
const ces = []
try {
  browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  })
  page = await browser.newPage()
  await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true })


  page.on('console', m => { ces.push('[console:' + m.type() + '] ' + m.text()) })
  page.on('pageerror', e => ces.push('[pageerror] ' + e.message))
  page.on('dialog', d => { ces.push('[dialog] ' + d.type() + ': ' + d.message().slice(0, 60)); d.dismiss().catch(() => {}) })
  page.on('requestfailed', r => ces.push('[requestfailed] ' + r.url() + ' ' + (r.failure()?.errorText || '')))

  out('boot: goto')
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 })
  await sleep(1500)
  ok('title Orison POS', (await page.title()).toLowerCase().includes('orison'), 'title=' + await page.title())
  ok('login screen rendered', await page.$eval('body', b => b.innerText.includes('Sign in')))

  // ---- Login via PIN pad ----
  await page.type('#loginEmail', EMAIL)
  for (const ch of PIN) { await page.click(`.pp-key[data-k="${ch}"]`); await sleep(50) }
  ok('PIN pad shows ' + PIN.length + ' digits', await page.$eval('#loginPin', el => el.value).then(v => v === PIN), 'val=' + await page.$eval('#loginPin', el => el.value))
  await page.screenshot({ path: join(SHOTDIR, '01-login.png') })
  await page.click('#loginBtn')
  await page.waitForFunction(() => document.querySelectorAll('.prod-card').length > 0, { timeout: 10000 })
  await sleep(700)
  ok('reaches register screen', await page.$eval('body', b => b.innerText.includes('Register')))
  await page.screenshot({ path: join(SHOTDIR, '02-register.png') })

  // ---- Catalog ----
  await page.waitForFunction(() => document.querySelectorAll('.prod-card').length >= 10, { timeout: 10000 })
  const cards = await page.$$eval('.prod-card', els => els.length)
  ok('catalog >= 10 cards', cards >= 10, 'cards=' + cards)

  // ---- Search & add serialized item ----
  await page.type('#searchInput', 'S24 Ultra', { delay: 30 })
  await sleep(400)
  ok('search finds S24 Ultra', await page.$eval('body', b => b.innerText.includes('S24 Ultra')))
  await page.click('.prod-card')
  await sleep(400)
  ok('serial dialog opens', await page.$eval('body', b => b.innerText.includes('Scan IMEI / Serial')).catch(() => false))
  await page.screenshot({ path: join(SHOTDIR, '03-serial.png') })

  await page.type('#serialInput', SERIAL)
  await sleep(150)
  await page.click('#serialAdd')
  await sleep(600)
  ok('cart sheet auto-opens with 1 item', await page.$eval('.cart-head .pill', el => parseInt(el.textContent, 10)) === 1)
  await page.screenshot({ path: join(SHOTDIR, '04-cart.png') })

  // ---- Charge ----
  await page.click('#chargeBtn')
  await sleep(700)
  ok('checkout screen shows total', await page.$eval('body', b => /Total due/.test(b.innerText)))
  await page.click('.quick')  // sets a round tender >= total
  await sleep(200)
  await page.click('#addTender')
  await sleep(300)
  const completeEnabled = await page.$eval('#completeBtn', el => !el.disabled)
  ok('complete button enabled after tender', completeEnabled)
  await page.click('#completeBtn')
  await sleep(1200)
  let receiptShown = false
  try { receiptShown = await page.$eval('.receipt', el => el.offsetParent !== null) } catch (e) {}
  ok('receipt shown after completing sale', receiptShown)
  await page.screenshot({ path: join(SHOTDIR, '05-receipt.png') })
  const rt = await page.$eval('.receipt', el => el.innerText).catch(() => '')
  ok('receipt store name', rt.includes('ORISON ELECTRONICS'))
  ok('receipt has serial on item', rt.includes(SERIAL))
  ok('receipt has total', /Total/.test(rt))
  ok('receipt has change line', /Change/.test(rt))

  // ---- History ----
  await sleep(3400)  // let the "Synced" toast clear so the receipt actions are clickable
  await page.click('#doneBtn')
  await sleep(700)
  await page.click('[data-tab="history"]')
  await sleep(1000)
  const histText = await page.$eval('body', b => b.innerText)
  ok('history lists a transaction', /SYNCED|Tariq/i.test(histText))
  await page.screenshot({ path: join(SHOTDIR, '06-history.png') })

  // ---- Reload persistence ----
  await page.reload({ waitUntil: 'load' })
  await sleep(1800)
  let stillIn = false
  try { stillIn = await page.$eval('body', b => !b.innerText.includes('Sign in')) } catch (e) {}
  ok('session survives reload', stillIn)

  // ---- DB verification (server side) ----
  const db = new Database(join(process.cwd(), 'data', 'orison.db'), { readonly: true })
  const tx = db.prepare('SELECT * FROM transactions WHERE status = ? ORDER BY created_at DESC LIMIT 1').get('COMPLETED')
  ok('server recorded a COMPLETED transaction', !!tx)
  if (tx) {
    ok('tx grand_total > 0', tx.grand_total > 0, 'total=' + tx.grand_total)
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL)
    ok('tx linked to logged-in user', !!user && tx.user_id === user.id)
    const items = db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?').all(tx.id)
    ok('tx has items', items.length >= 1, 'items=' + items.length)
    ok('tx item carried serial', items.some(i => (i.serial_number || '') === SERIAL))
    const used = db.prepare('SELECT * FROM product_serials WHERE serial_number = ?').get(SERIAL)
    ok('serial marked SOLD on server', !!used && used.status === 'SOLD')
  }
  db.close()

  out('--- console/page errors ---')
  if (ces.length) { ces.forEach(c => out(c)) } else { out('(none)') }
} catch (err) {
  fail++
  out('FATAL: ' + (err && err.stack ? err.stack : String(err)))
  if (page) {
    try {
      out('URL: ' + page.url())
      out('HASH: ' + await page.evaluate(() => location.hash))
      const txt = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 600) : '(no body)'))
      out('BODY: ' + JSON.stringify(txt))
      out('CES: ' + (ces.length ? ces.join(' | ') : '(none)'))
      await page.screenshot({ path: join(SHOTDIR, '99-fatal.png') }).catch(() => {})
    } catch (e) { out('dump failed: ' + e.message) }
  }
}

out(`${pass} passed, ${fail} failed`)
try { await browser?.close() } catch (e) {}
writeFileSync(LOG, log.join('\n'))
process.exit(fail ? 1 : 0)