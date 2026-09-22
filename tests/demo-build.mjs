'use strict';

/* The demo build: the real Code.gs running on the in-browser Google services
   emulator, seeded with a shop's two weeks of history. Checks the emulator is
   faithful enough (crypto, sessions, a reload from saved state) and that the
   sample data is sound - the books balance and Reports agree with them.
   Run:  node tests/demo-build.mjs */

import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createGasRuntime, memoryStorage, sha256, hmacSha256 } from '../demo/gas-emulator.js';
import { seedDemo, DEMO_ACCOUNTS } from '../demo/seed-demo.js';

const source = readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8');

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ok  ' + name); } else { failed++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('\n== emulator');
const hex = (u) => Buffer.from(u).toString('hex');
let cryptoOk = true;
for (let i = 0; i < 200; i++) {
  const m = randomBytes(i), k = randomBytes(i % 80);
  if (hex(sha256(m)) !== createHash('sha256').update(m).digest('hex')) cryptoOk = false;
  if (hex(hmacSha256(k, m)) !== createHmac('sha256', k).update(m).digest('hex')) cryptoOk = false;
}
check('SHA-256 and HMAC-SHA256 match Node crypto', cryptoOk);

const storage = memoryStorage();
const rt = createGasRuntime({ source, storage });
const t0 = Date.now();
const seeded = seedDemo(rt);
check('the demo seeds without an error', seeded.sales > 30, JSON.stringify(seeded));
console.log('  (seeded in ' + (Date.now() - t0) + ' ms, state ' + Math.round(storage.raw().length / 1024) + ' KB)');
check('the saved state is small enough for browser storage', storage.raw().length < 1.5 * 1024 * 1024);

const call = (r, action, payload, session, params) => r.handle({ action, method: 'POST', params: params || {}, payload: payload || {}, session: session || null });

console.log('\n== demo accounts');
const tokens = {};
for (const a of DEMO_ACCOUNTS) {
  const r = call(rt, '/api/login', { email: a.email, pin: a.pin });
  tokens[a.role] = tokens[a.role] || (r.ok && r.data.token);
  check('signs in: ' + a.email + ' (' + a.role + ') with PIN ' + a.pin, r.ok && r.data.user.role === a.role, JSON.stringify(r).slice(0, 200));
}
check('a wrong PIN is refused', call(rt, '/api/login', { email: 'tariq@example.com', pin: '000000' }).ok === false);
check('the store is set up, so an admin is not asked to configure it', call(rt, '/api/config', {}, tokens.admin).data.store.configured === true);
check('a request with no session is refused', call(rt, '/api/products', {}).status === 401);

console.log('\n== after a reload');
const rt2 = createGasRuntime({ source, storage: memoryStorage(storage.raw()) });
const again = call(rt2, '/api/products', {}, tokens.admin);
check('a session issued before the reload still works (secret and data persisted)', again.ok && again.data.length > 20, JSON.stringify(again).slice(0, 200));

console.log('\n== sample data');
const day = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const rep = call(rt2, '/api/reports', {}, tokens.admin, { from: day(14), to: day(-1) }).data;
check('two weeks of sales show in Reports', rep.summary.salesCount >= 30 && rep.byDay.length >= 10, JSON.stringify(rep.summary).slice(0, 200));
check('there is a refund, cash out and a collection', rep.summary.refunds > 0 && rep.summary.cashOut > 0 && rep.summary.collections > 0);
check('a trade-in and a repair deposit are in', rep.summary.tradeInCount === 1 && rep.summary.depositsIn === 50);
const books = call(rt2, '/api/accounting', {}, tokens.admin, { from: day(14), to: day(-1) }).data;
check('the books balance', books.trialBalance.balanced === true);
check('no demo entry needed rounding', books.checks.rounded === 0, String(books.checks.rounded));
check('the books agree with Reports on gross profit', Math.abs(books.pnl.grossProfit - rep.summary.grossProfit) < 0.01, JSON.stringify([books.pnl.grossProfit, rep.summary.grossProfit]));
const cust = call(rt2, '/api/customers/receivables', {}, tokens.manager).data;
check('the business customer owes on account', (cust.customers || []).some((c) => /Liberty/.test(c.name) && c.balance > 0), JSON.stringify(cust).slice(0, 200));
const repairs = call(rt2, '/api/repairs', {}, tokens.cashier).data;
check('three repairs are on the bench', (repairs.tickets || repairs.repairs || repairs).length === 3, JSON.stringify(repairs).slice(0, 200));
const pos = call(rt2, '/api/purchase-orders', {}, tokens.manager).data.orders;
check('one purchase order received, one still on its way', pos.some((o) => o.status === 'RECEIVED') && pos.some((o) => o.status === 'ORDERED'));
const waiting = call(rt2, '/api/purchase-orders/detail', {}, tokens.manager, { id: pos.find((o) => o.status === 'ORDERED').id }).data.order;
check('the order still on its way is on trade terms, so receiving it shows the discount and the tax',
  waiting.discountPct === 5 && waiting.taxAmount === 35 && waiting.lines.every((l) => Math.abs(l.netUnitCost - l.unitCost * 0.95) < 0.005),
  JSON.stringify([waiting.discountPct, waiting.taxAmount, waiting.lines.map((l) => l.netUnitCost)]));
const owed = call(rt2, '/api/suppliers/payables', {}, tokens.manager).data;
check('a supplier is owed money, part of it overdue, after a part payment',
  owed.totalOwed === 110 && owed.totalOverdue === 110 && owed.suppliers[0].paid === 100, JSON.stringify([owed.totalOwed, owed.totalOverdue]));
const bench = call(rt2, '/api/repairs/needs', {}, tokens.cashier).data;
check('two jobs on the bench are waiting for a part, and one of them nobody has ordered',
  bench.ticketCount === 2 && bench.parts.length === 2 && bench.shortfallCount === 1,
  JSON.stringify(bench.parts.map((p) => [p.sku, p.needed, p.onOrder, p.shortfall])));
check('the screen the waiting job needs is on the order that is coming',
  bench.parts.some((p) => p.sku === 'RP-SCR-IP12' && p.onOrder === 1 && p.shortfall === 0
    && p.tickets[0].status === 'awaiting_parts'), JSON.stringify(bench.parts.find((p) => p.sku === 'RP-SCR-IP12')));

const shifts = call(rt2, '/api/shifts', {}, tokens.manager).data;
check('a till shift is open for today', JSON.stringify(shifts).indexOf('OPEN') >= 0);

console.log('\n== marketplace sheet');
const imp = call(rt2, '/api/marketplace/import', {}, tokens.manager);
check('the waiting marketplace orders import', imp.ok && imp.data.imported === 3 && imp.data.errors === 0, JSON.stringify(imp));
const sheet = rt2.book(seeded.marketplaceSheet).sheets.Orders;
check('and their status is written back into the demo sheet', sheet.slice(1).every((r) => /^Imported/.test(String(r[7]))), JSON.stringify(sheet.slice(1).map((r) => r[7])));
check('the drive export works without Google Drive', call(rt2, '/api/drive/export', {}, tokens.manager).ok === true);

console.log('\n== site build');
const outDir = mkdtempSync(join(tmpdir(), 'orison-demo-'));
execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build-demo.mjs', import.meta.url)), outDir], { stdio: 'pipe' });
const html = readFileSync(join(outDir, 'index.html'), 'utf8');
check('the page loads the demo boot before the app', html.indexOf('demo/boot.js') > 0 && html.indexOf('demo/boot.js') < html.indexOf('js/app.js'));
const swText = readFileSync(join(outDir, 'sw.js'), 'utf8');
const pkgVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
check('the demo has its own service-worker cache, and caches the demo files',
  swText.includes(`'orison-pos-v${pkgVersion}-demo'`) && swText.includes("'./demo/Code.gs.txt'"));
check('the backend it runs is this commit’s Code.gs', readFileSync(join(outDir, 'demo/Code.gs.txt'), 'utf8') === source);
const cached = [...swText.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
check('every file the service worker caches is in the site', cached.length > 40 && cached.every((f) => existsSync(join(outDir, f))),
  cached.filter((f) => !existsSync(join(outDir, f))).join(', '));
rmSync(outDir, { recursive: true, force: true });

console.log('\n-------------------------------------');
console.log('PASS ' + passed + '  FAIL ' + failed);
process.exit(failed ? 1 : 0);
