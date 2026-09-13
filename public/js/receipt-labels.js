'use strict';

/* Receipt words in the STORE's language.

   The cashier may read the till in Urdu while the shop's customers read
   English or Arabic, so a receipt is never in the cashier's language: it is in
   the store's, set by the admin in store setup. receipt-doc.js stays pure and
   takes these labels as data. The brand name is not translated. */

import { N_, tIn, dirOf, storeLanguage } from './lang.js';

const WORDS = {
  cashier: N_('Cashier'),
  customer: N_('Customer'),
  subtotal: N_('Subtotal'),
  discount: N_('Discount'),
  tax: N_('Tax'),
  total: N_('Total'),
  totalInclTax: N_('Total incl. tax'),
  taxIncluded: N_('Tax included'),
  taxInvoice: N_('Tax Invoice'),
  trn: N_('TRN'),
  customerTrn: N_('Customer TRN'),
  warrantyYear: N_('1-year warranty'),
  warranty30: N_('30-day warranty'),
  warrantyUntil: N_('until'),
  change: N_('Change'),
  thanks: N_('Thank you for shopping at Orison!'),
  pending: N_('Receipt number pending sync'),
  tender_cash: N_('Cash'),
  tender_card: N_('Card'),
  tender_transfer: N_('Transfer'),
  tender_store_credit: N_('Store credit'),
  tender_net30: N_('On account'),
  tender_account: N_('On account'),
  tender_deposit: N_('Deposit applied'),
  tender_marketplace: N_('Marketplace'),
  qty: N_('Qty'),
  price: N_('Price'),
  amount: N_('Amount'),
};

/* In the UAE the tax is VAT, so its words are VAT's. */
const VAT_WORDS = {
  tax: N_('VAT'),
  totalInclTax: N_('Total incl. VAT'),
  taxIncluded: N_('VAT included'),
};

export function taxRules(store) {
  const s = store || {};
  const jur = s.taxJurisdiction || 'US';
  return {
    jurisdiction: jur,
    invoice: jur === 'AE',
    vat: jur === 'AE',
    regNo: jur === 'AE' ? String(s.taxRegNo || '') : '',
    inclusive: !!s.pricesIncludeTax,
    rate: Number(s.taxRate) || 0,
  };
}

export function receiptContext(store) {
  const code = storeLanguage();
  const labels = {};
  for (const [key, english] of Object.entries(WORDS)) labels[key] = tIn(code, english);
  const s = store || {};
  const tax = taxRules(s);
  if (tax.vat) for (const [key, english] of Object.entries(VAT_WORDS)) labels[key] = tIn(code, english);
  return { storeName: s.name || '', storeAddress: s.address || '', labels, dir: dirOf(code), locale: s.locale || undefined, tax };
}
