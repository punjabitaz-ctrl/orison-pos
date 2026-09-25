import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvText, csvName } from '../public/js/csv.js';
import { repairsCsv } from '../public/js/screens/repairs.js';
import { purchasesCsv } from '../public/js/screens/purchases.js';
import { payRunCsv } from '../public/js/screens/payroll.js';

test('csvText() - one shape for every export in the app', async (t) => {
  await t.test('title, columns and rows, in that order', () => {
    const out = csvText('Repairs', ['a', 'b'], [['1', '2']]);
    assert.deepEqual(out.split('\n'), ['"Repairs"', 'a,b', '"1","2"']);
  });
  await t.test('an extra block comes before the main table, with a blank line', () => {
    const out = csvText('T', ['a'], [['1']], [{ title: 'Summary', columns: ['x'], rows: [['9']] }]);
    assert.match(out, /"Summary"\nx\n"9"\n\na\n"1"/);
  });
  await t.test('a cell that looks like a formula cannot run in a spreadsheet', () => {
    assert.match(csvText('', ['a'], [['=1+1']]), /"'=1\+1"/);
  });
  await t.test('a cell with a comma or a quote survives the round trip', () => {
    assert.match(csvText('', ['a'], [['one, two']]), /"one, two"/);
    assert.match(csvText('', ['a'], [['say "hi"']]), /"say ""hi"""/);
  });
  await t.test('nothing to export is still a valid file, not a crash', () => {
    assert.equal(typeof csvText('Empty', ['a'], []), 'string');
    assert.equal(typeof csvText('', [], null), 'string');
  });
});

test('csvName() - a file a person can find again', async (t) => {
  await t.test('a period names both ends', () => {
    assert.equal(csvName('Running costs', { from: '2026-09-01', to: '2026-09-30' }), 'orison-running-costs-2026-09-01-to-2026-09-30.csv');
  });
  await t.test('no period falls back to today', () => {
    assert.match(csvName('products'), /^orison-products-\d{4}-\d{2}-\d{2}\.csv$/);
  });
  await t.test('spaces and punctuation never reach the file system', () => {
    assert.match(csvName('Pay run / draft'), /^orison-pay-run-draft-/);
  });
});

test('the screen builders produce what a spreadsheet needs', async (t) => {
  await t.test('repairs: one row per ticket, with its money', () => {
    const built = repairsCsv([{ ticketNo: 'R-1', status: 'ready', customerName: 'Maya', device: 'iPhone 12', partsTotal: 149, labourTotal: 40, total: 189 }]);
    assert.ok(built.columns.includes('ticket') && built.columns.includes('total'));
    assert.equal(built.rows[0][0], 'R-1');
    assert.equal(built.rows[0][built.columns.indexOf('total')], '189');
  });
  await t.test('purchases: what is owed comes before the orders', () => {
    const built = purchasesCsv({ payables: { suppliers: [{ name: 'Swift', balance: 110, overdue: 110 }] }, orders: [{ poNumber: 'PO-1', supplierName: 'Swift', status: 'RECEIVED', total: 210 }] });
    assert.equal(built.extra[0].title, 'Owed to suppliers');
    assert.equal(built.extra[0].rows[0][0], 'Swift');
    assert.equal(built.rows[0][0], 'PO-1');
  });
  await t.test('a pay run: one row per person, plus the summary', () => {
    const built = payRunCsv({ periodFrom: '2026-09-01', periodTo: '2026-09-30', status: 'PAID', grossTotal: 3280, method: 'cash',
      lines: [{ name: 'Amara', payType: 'hourly', rate: 18, hours: 37.5, basePay: 675, adjustment: 60, adjustmentNote: 'Saturday', gross: 735 }] });
    assert.match(built.title, /2026-09-01 to 2026-09-30/);
    assert.equal(built.rows[0][0], 'Amara');
    assert.equal(built.rows[0][built.columns.indexOf('gross')], '735');
    assert.equal(built.extra[0].rows[0][1], '3280');
  });
});

/* ---- PDF: the same data, laid out for a person rather than a spreadsheet ---- */
const { pdfHtml } = await import('../public/js/pdf-export.js');

test('pdfHtml() - the printable sheet', async (t) => {
  await t.test('columns and rows become a table', () => {
    const html = pdfHtml({ columns: ['Name', 'Amount'], rows: [['Rent', '3500']] });
    assert.match(html, /<th[^>]*>Name<\/th>/);
    assert.match(html, /<td[^>]*>Rent<\/td>/);
  });
  await t.test('numericFrom right-aligns the money columns', () => {
    const html = pdfHtml({ columns: ['Name', 'Amount'], rows: [['Rent', '3500']], numericFrom: 1 });
    assert.match(html, /<td class="num">3500<\/td>/);
    assert.match(html, /<td class="">Rent<\/td>/);
  });
  await t.test('an extra block comes before the main table, with its own heading', () => {
    const html = pdfHtml({ title: 'Orders', columns: ['a'], rows: [['1']], extra: [{ title: 'Owed', columns: ['b'], rows: [['2']] }] });
    assert.ok(html.indexOf('Owed') < html.indexOf('Orders'), html);
  });
  await t.test('a customer name cannot inject markup into the sheet', () => {
    const html = pdfHtml({ columns: ['Name'], rows: [['<img src=x onerror=alert(1)>']] });
    assert.ok(!/<img/.test(html), html);
    assert.match(html, /&lt;img/);
  });
  await t.test('nothing to show says so rather than printing an empty page', () => {
    assert.match(pdfHtml({ columns: ['a'], rows: [] }), /Nothing to show/);
  });
});
