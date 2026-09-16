/* Orison POS demo: a shop with two weeks of history.

   Everything here goes through the same API routes the app uses, as the staff
   member who would really do it, so the sample data obeys every rule the
   production backend enforces. The only things set directly are the demo
   PINs, which a real deployment never has fixed. */

export const DEMO_ACCOUNTS = [
  { email: 'tariq@example.com', pin: '246810', role: 'admin', name: 'Tariq Al-Sayed' },
  { email: 'sarah@example.com', pin: '135791', role: 'manager', name: 'Sarah Lindqvist' },
  { email: 'amara@example.com', pin: '112233', role: 'cashier', name: 'Amara Njoku' },
  { email: 'diego@example.com', pin: '445566', role: 'cashier', name: 'Diego Ramirez' },
];

export const DEMO_TAX_RATE = 6.625;

/* a small deterministic generator, so every fresh demo looks the same */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedDemo(rt, { now = new Date() } = {}) {
  const rand = prng(20260913);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const fail = (what, res) => { throw new Error('Demo seed failed at ' + what + ': ' + JSON.stringify(res).slice(0, 300)); };
  const req = (session, action, payload, params) => {
    const res = rt.handle({ action, method: 'POST', params: params || {}, payload: payload || {}, session });
    if (!res.ok) fail(action, res);
    return res.data;
  };

  /* the workbook, the catalogue, and the staff with known PINs */
  rt.call('ensureSeed_');
  const users = rt.call('readRows_', 'Users', rt.get('USER_HEADERS'));
  const patches = {};
  for (const u of users) {
    const acct = DEMO_ACCOUNTS.find((a) => a.email === String(u.email));
    if (!acct) continue;
    const salt = rt.get('Utilities').getUuid().split('-')[0];
    patches[String(u.id)] = { pin_salt: salt, pin_hash: rt.call('sha256Hex_', salt + ':' + acct.pin) };
  }
  rt.call('applyPatches_', 'Users', rt.get('USER_HEADERS'), 'id', patches);

  const session = {};
  const ids = {};
  for (const a of DEMO_ACCOUNTS) {
    const r = req(null, '/api/login', { email: a.email, pin: a.pin });
    session[a.role === 'cashier' ? a.email.split('@')[0] : a.role] = r.token;
    ids[a.email.split('@')[0]] = r.user.id;
  }
  const adm = session.admin, mgr = session.manager;

  req(adm, '/api/admin/store', { taxRate: DEMO_TAX_RATE, tzOffsetMin: -now.getTimezoneOffset(), locale: 'en-US', country: 'US', currency: 'USD' });

  /* a few more things a phone shop sells */
  const mk = (p) => req(adm, '/api/admin/products', Object.assign({ onHand: 0, costPrice: 0 }, p)).id;
  mk({ name: 'Screen Protector Install', sku: 'SV-SCREENPROT', category: 'Services', retailPrice: 15, itemType: 'service' });
  mk({ name: 'Data Transfer & Setup', sku: 'SV-SETUP', category: 'Services', retailPrice: 35, itemType: 'service' });
  mk({ name: 'Tempered Glass Screen Protector', sku: 'AC-GLASS', category: 'Accessories', costPrice: 3, retailPrice: 19, onHand: 60 });
  mk({ name: 'Clear Phone Case', sku: 'AC-CASE-CLR', category: 'Accessories', costPrice: 4, retailPrice: 24, onHand: 45 });
  const usedPhone = mk({ name: 'Apple iPhone 13 128GB (Used)', sku: 'PU-IP13-128', category: 'Pre-owned', costPrice: 0, retailPrice: 429, isSerialized: true, warrantyDays: 30 });
  mk({ name: 'Samsung Galaxy S22 (Used)', sku: 'PU-S22-128', category: 'Pre-owned', costPrice: 0, retailPrice: 329, isSerialized: true, warrantyDays: 30 });

  /* customers, one of them a business on account */
  const cust = {};
  for (const c of [
    { key: 'liberty', name: 'Liberty Phone Repair LLC', phone: '(732) 555-0142', email: 'accounts@libertyphone.example', creditLimit: 2500 },
    { key: 'maya', name: 'Maya Patel', phone: '(732) 555-0187', email: 'maya.patel@example.com' },
    { key: 'james', name: 'James Okafor', phone: '(908) 555-0123' },
    { key: 'lucia', name: 'Lucia Romano', phone: '(732) 555-0164', email: 'lucia.r@example.com' },
    { key: 'omar', name: 'Omar Haddad', phone: '(848) 555-0109' },
    { key: 'grace', name: 'Grace Kim', phone: '(732) 555-0198' },
  ]) {
    const { key, ...body } = c;
    cust[key] = req(adm, '/api/admin/customers', body).customer.id;
  }

  /* two weeks of sales */
  const products = () => req(adm, '/api/products');
  const bySku = (list, sku) => list.find((p) => p.sku === sku);
  const cents = (n) => Math.round(n * 100);
  const cashiers = ['amara', 'diego', 'amara', 'diego', 'manager'];
  const accessories = ['AC-GLASS', 'AC-CASE-CLR', 'CB-USBC-1M', 'CB-LTN-1M', 'CH-65W-GAN', 'CH-WIRELESS-15W', 'AU-PB-10000', 'ST-SDCARD-128', 'AU-JBLGO4', 'AU-AIRPODS3', 'GM-XBOXWIRELESS'];
  const devices = ['PH-G62-128', 'PH-RN13-128', 'PH-S24-128', 'PH-IP15-128', 'TB-IPAD10-64', 'PH-S24U-256'];
  const services = ['SV-SCREENPROT', 'SV-SETUP'];
  const sales = [];
  let n = 0;

  function sell(daysAgo, hour, who, lines, opts = {}) {
    const list = products();
    const items = [];
    let subC = 0;
    for (const [sku, qty] of lines) {
      const p = bySku(list, sku);
      if (!p) continue;
      if (p.isSerialized) {
        const sn = (p.serials || [])[0];
        if (!sn) continue;
        items.push({ productId: p.id, quantity: 1, unitPrice: p.retailPrice, serialNumber: sn, discountPct: 0 });
        subC += cents(p.retailPrice);
      } else {
        if (p.itemType !== 'service' && p.onHand < qty) continue;
        items.push({ productId: p.id, quantity: qty, unitPrice: p.retailPrice, discountPct: 0 });
        subC += cents(p.retailPrice) * qty;
      }
    }
    if (!items.length) return null;
    const totalC = subC + Math.round(subC * DEMO_TAX_RATE / 100);
    const total = totalC / 100;
    let tenders;
    if (opts.tender === 'net30') tenders = [{ type: 'net30', amount: total }];
    else if (opts.tender === 'card' || (!opts.tender && (totalC > 15000 || rand() < 0.45))) tenders = [{ type: 'card', amount: total }];
    else {
      const handed = Math.ceil(total / 20) * 20;
      tenders = [{ type: 'cash', amount: handed }];
    }
    const at = new Date(now.getTime() - daysAgo * 86400000);
    at.setHours(hour, Math.floor(rand() * 60), 0, 0);
    if (at > now) at.setTime(now.getTime() - (n + 1) * 60000);
    const clientTxId = 'demo-sale-' + (++n);
    const actor = who === 'manager' ? { s: mgr, id: ids.sarah } : { s: session[who], id: ids[who] };
    const r = req(actor.s, '/api/sync/push', { deviceId: 'demo-till-1', batch: [{
      clientTxId, userId: actor.id, discountPct: 0, grandTotal: total, createdAt: at.toISOString(),
      tenders, items, customerId: opts.customerId || '', channel: 'in_store',
    }] });
    if (!r.results[0].accepted) fail('sale ' + clientTxId, r.results[0]);
    const sale = { clientTxId, total, items, tenders, at };
    sales.push(sale);
    return sale;
  }

  for (let d = 13; d >= 0; d--) {
    const count = d === 0 ? 3 : 2 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const hour = 10 + Math.floor(rand() * 8);
      const who = pick(cashiers);
      const roll = rand();
      let lines;
      if (roll < 0.22 && d > 1) lines = [[pick(devices), 1], ['AC-GLASS', 1], ['SV-SCREENPROT', 1]];
      else if (roll < 0.3) lines = [[pick(services), 1]];
      else lines = [[pick(accessories), 1 + Math.floor(rand() * 2)], ...(rand() < 0.4 ? [[pick(accessories), 1]] : [])];
      sell(d, hour, who, lines);
    }
  }
  /* the business customer buys on account, and pays some of it */
  sell(9, 11, 'manager', [['CB-USBC-1M', 10], ['CH-65W-GAN', 5]], { tender: 'net30', customerId: cust.liberty });
  sell(4, 15, 'manager', [['AC-GLASS', 20], ['AC-CASE-CLR', 10]], { tender: 'net30', customerId: cust.liberty });
  const pay = (daysAgo, h) => { const t = new Date(now.getTime() - daysAgo * 86400000); t.setHours(h, 5, 0, 0); return t.toISOString(); };
  req(mgr, '/api/sync/push', { deviceId: 'demo-till-1', batch: [
    { clientTxId: 'demo-pay-1', kind: 'payment', userId: ids.sarah, customerId: cust.liberty, grandTotal: 250, tenders: [{ type: 'transfer', amount: 250 }], createdAt: pay(2, 12), items: [] },
    { clientTxId: 'demo-payout-1', kind: 'payout', userId: ids.sarah, grandTotal: 40, tenders: [], counterparty: 'Window cleaning', note: 'Monthly window clean', createdAt: pay(6, 9), items: [] },
    { clientTxId: 'demo-pickup-1', kind: 'pickup', userId: ids.sarah, grandTotal: 300, tenders: [], note: 'Bank deposit', createdAt: pay(3, 17), items: [] },
    { clientTxId: 'demo-expense-1', kind: 'expense', userId: ids.sarah, grandTotal: 18.5, tenders: [], counterparty: 'Staff lunch', createdAt: pay(1, 13), items: [] },
  ] });

  /* a customer brings something back */
  const refundable = sales.find((s) => s.items.length > 1 && !s.items.some((i) => i.serialNumber) && s.at < new Date(now.getTime() - 86400000));
  if (refundable) {
    const line = refundable.items.find((i) => bySku(products(), 'SV-SCREENPROT').id !== i.productId && bySku(products(), 'SV-SETUP').id !== i.productId);
    if (line) {
      const lineC = cents(line.unitPrice);
      const back = (lineC + Math.round(lineC * DEMO_TAX_RATE / 100)) / 100;
      const r = req(mgr, '/api/sync/push', { deviceId: 'demo-till-1', batch: [{
        clientTxId: 'demo-refund-1', kind: 'refund', originalClientTx: refundable.clientTxId, userId: ids.sarah,
        grandTotal: back, tenders: [{ type: 'cash', amount: back }], createdAt: new Date(refundable.at.getTime() + 86400000).toISOString(),
        items: [{ productId: line.productId, quantity: 1, unitPrice: line.unitPrice }],
      }] });
      if (!r.results[0].accepted) fail('refund', r.results[0]);
    }
  }

  /* stock arriving: one order received, one still on its way */
  const supplier = req(adm, '/api/suppliers', {}).suppliers[0];
  const list = products();
  const po1 = req(mgr, '/api/purchase-orders', { supplierId: supplier.id, status: 'ORDERED', note: 'Weekly accessories restock',
    lines: [{ productId: bySku(list, 'AC-GLASS').id, quantity: 30, unitCost: 3 }, { productId: bySku(list, 'CB-USBC-1M').id, quantity: 20, unitCost: 6 }] });
  req(mgr, '/api/purchase-orders/receive', { id: po1.id, lines: [{ productId: bySku(list, 'AC-GLASS').id, quantity: 30 }, { productId: bySku(list, 'CB-USBC-1M').id, quantity: 20 }] });
  const expected = new Date(now.getTime() + 3 * 86400000).toISOString().slice(0, 10);
  req(mgr, '/api/purchase-orders', { supplierId: supplier.id, status: 'ORDERED', expectedDate: expected, note: 'Phones for the weekend',
    lines: [{ productId: bySku(list, 'PH-G62-128').id, quantity: 2, unitCost: 399 }, { productId: bySku(list, 'AU-BOSEQC45').id, quantity: 4, unitCost: 279 }] });

  /* the counter today: a till shift open, repairs on the bench, a trade-in */
  req(session.amara, '/api/shifts/open', { openingFloat: 200, note: 'Morning float' });
  const glass = req(session.amara, '/api/repairs', { customerId: cust.maya, customerName: 'Maya Patel', customerPhone: '(732) 555-0187',
    deviceMake: 'Apple', deviceModel: 'iPhone 12', deviceSerial: '353918104455667', reportedFault: 'Cracked screen, touch works', estimateTotal: 189, accessories: 'Case' });
  req(session.amara, '/api/repairs/deposit', { id: glass.id, amount: 50 });
  req(mgr, '/api/repairs/status', { id: glass.id, status: 'awaiting_parts', note: 'Screen ordered' });
  const battery = req(session.diego, '/api/repairs', { customerId: cust.james, customerName: 'James Okafor', customerPhone: '(908) 555-0123',
    deviceMake: 'Samsung', deviceModel: 'Galaxy S21', reportedFault: 'Battery drains by lunchtime', estimateTotal: 89 });
  req(mgr, '/api/repairs/labour', { id: battery.id, add: { description: 'Battery replacement', amount: 89 } });
  req(mgr, '/api/repairs/status', { id: battery.id, status: 'ready', note: 'Tested, holds charge' });
  req(session.diego, '/api/repairs', { customerId: cust.grace, customerName: 'Grace Kim', customerPhone: '(732) 555-0198',
    deviceMake: 'Google', deviceModel: 'Pixel 7', reportedFault: 'Will not charge', estimateTotal: 0 });

  req(mgr, '/api/tradein', { customerId: cust.omar, productId: usedPhone, serialNumber: '356112233445566', condition: 'good',
    notes: 'Battery 88%, light scratches', amount: 260, paidBy: 'store_credit', idType: 'driving_licence', idRef: '7731' });

  /* the marketplace sheet, with orders waiting to be imported */
  const book = rt.get('SpreadsheetApp').create('Orison marketplace orders (demo)');
  req(adm, '/api/marketplace/settings', { sheet: book.getId() });
  const today = now.toISOString().slice(0, 10);
  /* whichever phone still has a unit left after the fortnight's sales */
  const phone = products().filter((p) => p.category === 'Phones' && (p.serials || []).length)
    .sort((x, y) => y.serials.length - x.serials.length)[0];
  const orders = rt.book(book.getId()).sheets.Orders;
  orders.push(
    ['EBAY-11-40213', today, 'marketplace', 'AU-JBLGO4', '', 2, 45, '', ''],
    ['EBAY-11-40219', today, 'marketplace', phone.sku, phone.serials[phone.serials.length - 1], 1, Math.round(phone.retailPrice * 0.94), '', ''],
    ['SITE-1088', today, 'online', 'CH-65W-GAN', '', 1, 32, '', ''],
  );
  rt.save();

  return { accounts: DEMO_ACCOUNTS, sales: sales.length, marketplaceSheet: book.getId() };
}
