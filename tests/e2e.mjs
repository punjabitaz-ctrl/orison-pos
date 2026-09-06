import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rmSync } from 'node:fs'

/* End-to-end test for the Orison POS PWA.
 *
 * Requirements:
 *   - A backend must be reachable. Either:
 *       a) a deployed Google Apps Script web app:
 *            E2E_GAS_URL   = https://script.google.com/macros/s/…/exec
 *            E2E_APP_TOKEN = the APP_TOKEN Script Property
 *       b) a same-origin local server (fallback default http://127.0.0.1:8080)
 *   - The backend must be freshly seeded, or seeded and not already out of
 *     the specific serials the test sells.
 *
 * Pass sane numbers via BASE/AUTH envs, e.g.:
 *   $env:E2E_BASE='http://127.0.0.1:8080'; node tests/e2e.mjs
 *   $env:E2E_GAS_URL='...'; $env:E2E_APP_TOKEN='...'; node tests/e2e.mjs
 */

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8080'
const GAS_URL = process.env.E2E_GAS_URL || ''
const APP_TOKEN = process.env.E2E_APP_TOKEN || ''
// Seed PINs are generated per deployment and never committed. Read the admin
// and cashier PINs from the Apps Script execution log (see README) and pass
// them in, e.g. E2E_PIN=481902 E2E_CASHIER_PIN=730155 npm run test:e2e
const EMAIL = process.env.E2E_EMAIL || 'tariq@example.com'
const PIN = process.env.E2E_PIN || ''
const CASHIER_EMAIL = process.env.E2E_CASHIER_EMAIL || 'amara@example.com'
const CASHIER_PIN = process.env.E2E_CASHIER_PIN || ''
// Skip rather than fail: this suite also needs a running server and a deployed
// backend, so it cannot be part of a default `npm test` run. Exiting non-zero
// here would make `npm test` permanently red on a clean checkout.
if (!PIN || !CASHIER_PIN) {
  console.log('SKIP e2e: set E2E_PIN and E2E_CASHIER_PIN to run it — see README > Starter logins.')
  process.exit(0)
}

// Imported dynamically, below the guard: a static import is hoisted above it,
// so a checkout without devDependencies would crash before the skip could run.
const puppeteer = (await import('puppeteer-core')).default

// Created only once we know the run will proceed, so a skip leaks no temp dir.
const PROFILE = mkdtempSync(join(tmpdir(), 'orison-e2e-'))
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

/* Thin transport mirroring public/js/api.js so the test can cross-check
   whatever backend the app is pointed at (local server OR Apps Script). */
async function raw(action, { method = 'GET', params = {}, payload = null } = {}) {
  const endpoint = GAS_URL || BASE
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, method, params, payload, appToken: APP_TOKEN, session: SESSION }),
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!data || data.ok === false) throw new Error((data && data.error) || 'request failed: ' + action)
  return data.data
}
let SESSION = null
async function backendLogin() {
  const d = await raw('/api/login', { method: 'POST', payload: { email: EMAIL, pin: PIN } })
  SESSION = d.token
  return d
}

let page, browser
const ces = []
try {
  browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    userDataDir: PROFILE,
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

  // ---- Point the app at the GAS backend when configured ----
  if (GAS_URL) {
    await page.click('#serverCfg')
    const d1 = new Promise(r => page.once('dialog', d => { r(); d.accept(GAS_URL) }))
    await d1
    const d2 = new Promise(r => page.once('dialog', d => { r(); d.accept(APP_TOKEN) }))
    await d2
    await sleep(400)
  }

  // ---- Login via PIN pad ----
  await page.type('#loginEmail', EMAIL)
  for (const ch of PIN) { await page.click(`.pp-key[data-k="${ch}"]`); await sleep(50) }
  ok('PIN pad shows ' + PIN.length + ' digits', await page.$eval('#loginPin', el => el.value).then(v => v === PIN), 'val=' + await page.$eval('#loginPin', el => el.value))
  await page.screenshot({ path: join(SHOTDIR, '01-login.png') })
  await page.click('#loginBtn')
  await page.waitForFunction(() => document.body.innerText.includes('Dashboard'), { timeout: 15000 })
  await sleep(700)
  ok('lands on Dashboard after login', await page.$eval('body', b => b.innerText.includes('Dashboard')))
  ok('dashboard role badge shows admin', await page.$eval('body', b => b.innerText.includes('admin')))
  await page.screenshot({ path: join(SHOTDIR, '02-dashboard.png') })

  // ---- Register screen ----
  await page.click('[data-tab="register"]')
  await page.waitForFunction(() => document.querySelectorAll('.prod-card').length > 0, { timeout: 10000 })
  await sleep(400)
  ok('reaches register screen via tab', await page.$eval('body', b => b.innerText.includes('Register')))

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

  // ---- Add a non-serialized item too ----
  await page.click('#searchInput', { clickCount: 3 })
  await page.type('#searchInput', 'USB-C Cable', { delay: 20 })
  await sleep(400)
  await page.click('.prod-card')
  await sleep(400)
  ok('cart has 2 items after second add', await page.$eval('.cart-head .pill', el => parseInt(el.textContent, 10)) === 2)

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
  await sleep(1500)
  let receiptShown = false
  try { receiptShown = await page.$eval('.receipt', el => el.offsetParent !== null) } catch (e) {}
  ok('receipt shown after completing sale', receiptShown)
  await page.screenshot({ path: join(SHOTDIR, '05-receipt.png') })
  const rt = await page.$eval('.receipt', el => el.innerText).catch(() => '')
  ok('receipt store name', rt.includes('ORISON ELECTRONICS'))
  ok('receipt has serial on item', rt.includes(SERIAL))
  ok('receipt has total', /Total/.test(rt))
  ok('receipt has change line', /Change/.test(rt))

  // ---- Grab the local clientTxId from IndexedDB for backend verification ----
  const localTxId = await page.evaluate(() => new Promise((resolve) => {
    const r = indexedDB.open('orison-pos')
    r.onsuccess = () => {
      try {
        const db = r.result
        const t = db.transaction('transactions', 'readonly')
        const req = t.objectStore('transactions').getAll()
        req.onsuccess = () => {
          const rows = (req.result || [])
          rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          resolve(rows.length ? rows[0].id : null)
        }
        req.onerror = () => resolve(null)
      } catch (e) { resolve(null) }
    }
    r.onerror = () => resolve(null)
  }))
  ok('local tx id captured', !!localTxId, 'id=' + localTxId)

  // ---- Backend verification via API (works for GAS or local server) ----
  let backendTx = null
  try {
    const login = await backendLogin()
    ok('backend login via API', !!login.token)
    const txs = await raw('/api/transactions', { params: { limit: '50' } })
    backendTx = txs.transactions.find(t => t.clientTxId === localTxId)
    ok('backend recorded a COMPLETED transaction for local id', !!backendTx && backendTx.grandTotal > 0, 'total=' + (backendTx && backendTx.grandTotal))
    if (backendTx) ok('backend tx carried the serial', (backendTx.items || []).some(i => i.serialNumber === SERIAL))
    const products = await raw('/api/products')
    const s24 = products.find(p => p.sku === 'PH-S24U-256')
    ok('serial consumed on backend (SOLD/removed)', !!s24 && !(s24.serials || []).includes(SERIAL) && (s24.onHand || 0) < 4, 'onHand=' + (s24 && s24.onHand))
    const usb = products.find(p => p.sku === 'CB-USBC-1M')
    ok('non-serialized stock decremented', !!usb && usb.onHand === 39, 'usb onHand=' + (usb && usb.onHand))
  } catch (err) {
    ces.push('[api-check] ' + err.message)
    ok('backend verification reachable', false, err.message)
  }

  // ---- History ----
  await sleep(3400)  // let the "Synced" toast clear so the receipt actions are clickable
  await page.click('#doneBtn')
  await sleep(700)
  await page.click('[data-tab="history"]')
  await sleep(1000)
  const histText = await page.$eval('body', b => b.innerText)
  ok('history lists a transaction', /SYNCED|SERVER/i.test(histText))
  await page.screenshot({ path: join(SHOTDIR, '06-history.png') })

  // ---- Dashboard KPIs after a sale ----
  await page.click('[data-tab="dashboard"]')
  await sleep(1000)
  const dashText = await page.$eval('body', b => b.innerText)
  ok('dashboard shows Revenue today', /Revenue today/.test(dashText))
  ok('dashboard shows recent-server txs for admin', /Top sellers/.test(dashText))
  await page.screenshot({ path: join(SHOTDIR, '07-dashboard-after.png') })

  // ---- Reload persistence ----
  await page.reload({ waitUntil: 'load' })
  await sleep(1800)
  let stillIn = false
  try { stillIn = await page.$eval('body', b => !b.innerText.includes('Sign in')) } catch (e) {}
  ok('session survives reload', stillIn)

  // ---- Cashier role: inventory tab hidden + dashboard simplified ----
  const page2 = await browser.newPage()
  await page2.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true })
  await page2.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 })
  await sleep(1200)
  await page2.type('#loginEmail', CASHIER_EMAIL)
  for (const ch of CASHIER_PIN) { await page2.click(`.pp-key[data-k="${ch}"]`); await sleep(40) }
  await page2.click('#loginBtn')
  await page2.waitForFunction(() => document.body.innerText.includes('Dashboard'), { timeout: 15000 })
  await sleep(600)
  const invHidden = await page2.$$eval('.tab', els => els.some(t => t.dataset.tab === 'inventory' && t.classList.contains('hidden')))
  ok('cashier sees no Inventory tab', invHidden)
  const cashierText = await page2.$eval('body', b => b.innerText)
  ok('cashier dashboard is personal (no Top sellers)', /My recent/.test(cashierText) && !/Top sellers/.test(cashierText))
  await page2.screenshot({ path: join(SHOTDIR, '08-cashier-dashboard.png') })
  await page2.close()

  out('--- console/page errors ---')
  if (ces.length) { ces.forEach(c => out(c)) } else { out('(none)') }
} catch (err) {
  fail++
  out('FATAL: ' + (err && err.stack ? err.stack : String(err)))
  if (page) {
    try {
      out('URL: ' + page.url())
      const txt = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 600) : '(no body)'))
      out('BODY: ' + JSON.stringify(txt))
      out('CES: ' + (ces.length ? ces.join(' | ') : '(none)'))
      await page.screenshot({ path: join(SHOTDIR, '99-fatal.png') }).catch(() => {})
    } catch (e) { out('dump failed: ' + e.message) }
  }
}

out(`${pass} passed, ${fail} failed`)
try { await browser?.close() } catch (e) {}
try { rmSync(PROFILE, { recursive: true, force: true }) } catch (e) {}
writeFileSync(LOG, log.join('\n'))
process.exit(fail ? 1 : 0)