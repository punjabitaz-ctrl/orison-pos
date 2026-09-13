'use strict';

/* One receipt, every printer.

   Checkout and History used to build receipts separately, and drifted: the
   reprint showed the internal transaction id instead of the receipt number, and
   would have printed a repair deposit as a bare "deposit". This module builds a
   single plain-data model from a sale. The roll printout, the full-page
   printout and the Bluetooth printer all render from it, so a receipt reads the
   same wherever it comes out.

   Amounts stay numbers here; each renderer formats them. Labels are passed in
   so a translated receipt changes words and never numbers. No DOM, no imports. */

const DEFAULT_LABELS = {
  brand: 'ORISON ELECTRONICS',
  cashier: 'Cashier',
  customer: 'Customer',
  subtotal: 'Subtotal',
  discount: 'Discount',
  tax: 'Tax',
  total: 'Total',
  totalInclTax: 'Total incl. tax',
  taxIncluded: 'Tax included',
  taxInvoice: 'Tax Invoice',
  trn: 'TRN',
  customerTrn: 'Customer TRN',
  change: 'Change',
  thanks: 'Thank you for shopping at Orison!',
  pending: 'Receipt number pending sync',
  tender_cash: 'Cash',
  tender_card: 'Card',
  tender_transfer: 'Transfer',
  tender_store_credit: 'Store credit',
  tender_net30: 'On account',
  tender_account: 'On account',
  tender_deposit: 'Deposit applied',
  qty: 'Qty',
  price: 'Price',
  amount: 'Amount',
};

function cents(n) {
  return Math.round((Number(n) || 0) * 100);
}

function tenderLabel(type, labels) {
  const key = 'tender_' + String(type || 'cash');
  if (labels[key]) return labels[key];
  const words = String(type || '').replace(/_/g, ' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : labels.tender_cash;
}

function dateTime(iso, locale) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d)) return '';
  const date = d.toLocaleDateString(locale || 'en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(locale || 'en-US', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

export function receiptDoc(tx, ctx = {}) {
  const labels = { ...DEFAULT_LABELS, ...(ctx.labels || {}) };
  const t = tx || {};

  /* Tax rules come from the store (v1.40.0): a UAE store prints a Tax Invoice
     with its TRN, names the tax VAT, and shows it as included in the price. */
  const tax = ctx.tax || {};
  const inclusive = t.taxInclusive != null ? !!t.taxInclusive : !!tax.inclusive;
  const meta = [dateTime(t.createdAt, ctx.locale)];
  if (tax.invoice && ctx.storeAddress) meta.push(ctx.storeAddress);
  if (tax.regNo) meta.push(`${labels.trn}: ${tax.regNo}`);
  if (t.cashier) meta.push(`${labels.cashier}: ${t.cashier}`);
  if (t.customerName) meta.push(`${labels.customer}: ${t.customerName}`);
  if (t.customerTrn && tax.invoice) meta.push(`${labels.customerTrn}: ${t.customerTrn}`);

  const lines = (t.items || []).map((i) => {
    const qty = Math.max(1, Number(i.quantity) || 1);
    const pct = Math.min(100, Math.max(0, Number(i.discountPct) || 0));
    const gross = cents(i.unitPrice) * qty;
    const net = gross - Math.round(gross * pct / 100);
    return {
      name: i.serialNumber ? `${i.name} [${i.serialNumber}]` : String(i.name || ''),
      qty,
      unitPrice: cents(i.unitPrice) / 100,
      discountPct: pct,
      amount: net / 100,
    };
  });

  const totals = [{ key: 'subtotal', label: labels.subtotal, amount: cents(t.subtotal) / 100 }];
  if (cents(t.discount) > 0) {
    totals.push({ key: 'discount', label: labels.discount, amount: -cents(t.discount) / 100 });
  }
  const rate = t.taxRate != null ? Number(t.taxRate) || 0 : Number(tax.rate) || 0;
  if (inclusive) {
    /* the tax is inside the total, so it is shown after it, as information */
    totals.push({ key: 'total', label: labels.totalInclTax, amount: cents(t.total) / 100, strong: true });
    if (cents(t.taxAmount) > 0) totals.push({ key: 'tax', label: labels.taxIncluded, amount: cents(t.taxAmount) / 100, rate, included: true });
  } else {
    if (cents(t.taxAmount) > 0) totals.push({ key: 'tax', label: labels.tax, amount: cents(t.taxAmount) / 100, rate });
    totals.push({ key: 'total', label: labels.total, amount: cents(t.total) / 100, strong: true });
  }

  const tenders = (t.tenders || [])
    .filter((td) => cents(td.amount) > 0)
    .map((td) => ({ type: String(td.type || 'cash'), label: tenderLabel(td.type, labels), amount: cents(td.amount) / 100 }));
  const paidC = tenders.reduce((s, td) => s + cents(td.amount), 0);
  const changeC = Math.max(0, paidC - cents(t.total));

  const receiptNo = String(t.receiptNo || '');
  return {
    brand: labels.brand,
    title: tax.invoice ? labels.taxInvoice : '',
    store: String(ctx.storeName || ''),
    meta: meta.filter(Boolean),
    lines,
    totals,
    tenders,
    change: changeC / 100,
    changeLabel: labels.change,
    footer: [labels.thanks],
    reference: receiptNo || `# ${t.clientTxId || t.id || ''}`,
    pending: !receiptNo,
    pendingLabel: labels.pending,
    columns: { qty: labels.qty, price: labels.price, amount: labels.amount },
    dir: ctx.dir === 'rtl' ? 'rtl' : 'ltr',
  };
}
