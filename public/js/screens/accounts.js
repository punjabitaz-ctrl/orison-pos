'use strict';

import { $t, $tn, N_, arrow, dateLocale } from '../lang.js';

/* Accounts: the shop's books, admin only. Double entry to generally accepted
   accounting principles, built on the server from the ledger for a period -
   profit and loss, trial balance, balance movements and the journal - with
   CSV exports an accountant can load. Nothing here is computed locally. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { screenHead } from '../components.js';
import { fmt, esc, toast, beep, csvCell, downloadCsv, openModal, closeModal } from '../ui.js';
import { PRESETS, rangeFor } from './reports.js';
import { exportPdf } from '../pdf-export.js';

const ACCOUNT_NAMES = {
  1000: N_('Cash'),
  1010: N_('Card clearing'),
  1020: N_('Bank transfers'),
  1030: N_('Cash in transit'),
  1100: N_('Accounts receivable'),
  1150: N_('Marketplace receivable'),
  1200: N_('Inventory'),
  2000: N_('Sales tax / VAT payable'),
  2100: N_('Customer deposits'),
  2200: N_('Store credit'),
  2300: N_('Accounts payable'),
  4000: N_('Product sales'),
  4010: N_('Service sales'),
  4100: N_('Sales returns'),
  5000: N_('Cost of goods sold'),
  5100: N_('Inventory shrinkage'),
  6000: N_('Paid out'),
  6100: N_('Staff expenses'),
  6200: N_('Wages'),
  6300: N_('Rent'),
  6310: N_('Utilities'),
  6320: N_('Phone and internet'),
  6330: N_('Marketing'),
  6340: N_('Transport and delivery'),
  6350: N_('Insurance and licences'),
  6360: N_('Professional fees'),
  6370: N_('Repairs and maintenance'),
  6380: N_('Bank charges'),
  6390: N_('Other running costs'),
  6900: N_('Rounding'),
};

const KIND_LABELS = {
  sale: N_('Sale'),
  refund: N_('Refund'),
  payout: N_('Paid out'),
  pickup: N_('Cash pick-up'),
  expense: N_('Staff expense'),
  payment: N_('Payment on account'),
  deposit: N_('Deposit taken'),
  deposit_refund: N_('Deposit refunded'),
  purchase: N_('Stock received'),
  tradein: N_('Trade-in'),
  supplier_payment: N_('Supplier payment'),
  stocktake: N_('Stock take'),
};

const JOURNAL_SHOWN = 50;

export function accountName(code, fallback) {
  const n = ACCOUNT_NAMES[code];
  return n ? $t(n) : String(fallback || code);
}

/* What the books should say about where they started. A shop that was
   already trading has stock, cash and a bank balance on the day it starts
   here; until somebody says so, every balance opens at zero and the balance
   sheet is wrong from the first hour. */
export function openingNotice(state) {
  if (!state) return null;
  if (!state.set) {
    return {
      id: 'missing',
      tone: 'warn',
      title: N_('The books open at zero'),
      body: N_('This shop was trading before today. Say what was in the till, in the bank and on the shelf, and the balance sheet will start where the shop did.'),
      action: N_('Enter opening balances'),
    };
  }
  return {
    id: 'set',
    tone: 'ok',
    title: N_('Opening balances are set'),
    body: '',
    action: N_('Review'),
  };
}

export const screen = {
  id: 'accounts',
  tab: 'accounts',
  title: 'Accounts',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const user = ctx.state.user || (await idb.get('meta', 'config'))?.user || {};
    if (user.role !== 'admin') {
      root.innerHTML = `<div class="empty"><p>${$t('Admins only.')}</p></div>`;
      return;
    }

    let preset = 'month';
    let from = '';
    let to = '';
    let data = null;
    let opening = null;
    let loading = false;

    async function load() {
      const range = rangeFor(preset, from, to);
      loading = true;
      draw();
      try {
        data = await api.get(`/api/accounting?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
        from = range.from;
        to = range.to;
        opening = await api.get('/api/opening-balances').catch(() => null);
      } catch (err) {
        data = null;
        toast((err && !err.offline) ? (err.message || $t('Accounts failed')) : $t('Offline — accounts need the server'), 'warn');
      }
      loading = false;
      draw();
    }

    function draw() {
      const range = rangeFor(preset, from, to);
      const tb = data && data.trialBalance;
      root.innerHTML = `
        ${screenHead({
          title: $t('Accounts'),
          sub: data ? `${range.from} ${arrow()} ${range.to} · ${$tn('{n} entry', '{n} entries', data.journal.length)}` : $t('Profit and loss, trial balance and journal'),
        })}

        <div class="rep-chips">
          ${PRESETS.map((p) => `<button class="rep-chip ${p.id === preset ? 'on' : ''}" data-p="${p.id}">${esc($t(p.label))}</button>`).join('')}
          ${preset === 'custom' ? `
            <div class="rep-dates">
              <input class="field" id="acFrom" type="date" value="${esc(from)}" aria-label="${$t('From')}">
              <span class="muted">${arrow()}</span>
              <input class="field" id="acTo" type="date" value="${esc(to)}" aria-label="${$t('To')}">
              <button class="btn btn-sm" id="acGo">${$t('Go')}</button>
            </div>` : ''}
        </div>

        ${loading ? `<div class="empty"><p>${$t('Loading…')}</p></div>` : !data ? `<div class="empty"><p>${$t('No accounts yet — pick a period above.')}</p></div>` : `
        ${(() => {
          const notice = openingNotice(opening);
          if (!notice) return '';
          const entry = opening && opening.entry;
          return `<div class="acct-opening ${notice.id === 'missing' ? 'acct-opening-warn' : ''}">
            <div>
              <strong>${esc($t(notice.title))}</strong>
              ${notice.body ? `<p class="muted">${esc($t(notice.body))}</p>` : ''}
              ${entry ? `<p class="muted">${esc($t('As of {date} · till {cash} · bank {bank} · stock {stock}', {
                date: entry.asOf, cash: fmt(entry.cash), bank: fmt(entry.bank), stock: fmt(entry.stockValue),
              }))}</p>` : ''}
            </div>
            <button class="btn btn-sm ${notice.id === 'missing' ? 'btn-primary' : 'btn-ghost'}" id="acOpening">${esc($t(notice.action))}</button>
          </div>`;
        })()}

        <div class="acct-status">
          <span class="tag ${tb.balanced ? 'tag-ok' : 'tag-bad'}">${tb.balanced ? $t('Books balance') : $t('Out of balance')}</span>
          <span class="muted">${esc($t('Debits {debit} · credits {credit}', { debit: fmt(tb.debit), credit: fmt(tb.credit) }))}</span>
          <span class="acct-exports">
            <button class="btn btn-ghost btn-sm" id="acJournalCsv">${$t('Journal CSV')}</button>
            <button class="btn btn-ghost btn-sm" id="acTrialCsv">${$t('Trial balance CSV')}</button>
            <button class="btn btn-ghost btn-sm" id="acPdf">${$t('PDF')}</button>
          </span>
        </div>

        <div class="acct-grid">
          <section class="dash-section">
            <h3>${$t('Profit and loss')}</h3>
            ${pnlTable(data.pnl)}
          </section>
          <section class="dash-section">
            <h3>${$t('Balance movements')}</h3>
            <p class="muted acct-note">${$t('How much each balance rose or fell in this period.')}</p>
            ${movementsTable(data.movements)}
          </section>
        </div>

        <section class="dash-section">
          <h3>${$t('Trial balance')}</h3>
          ${trialTable(tb)}
          <p class="muted acct-note">${$t('Accounts payable rises with stock received and falls with supplier payments recorded in Purchases.')}</p>
        </section>

        <section class="dash-section">
          <h3>${$t('Journal')} <span class="muted">· ${esc(data.journal.length > JOURNAL_SHOWN
            ? $t('latest {shown} of {n} — export for the rest', { shown: JOURNAL_SHOWN, n: data.journal.length })
            : $tn('{n} entry', '{n} entries', data.journal.length))}</span></h3>
          ${journalTable(data.journal.slice(-JOURNAL_SHOWN).reverse())}
        </section>
        `}`;

      root.querySelectorAll('.rep-chip').forEach((b) => b.addEventListener('click', () => {
        preset = b.dataset.p;
        if (preset === 'custom') { draw(); return; }
        load();
      }));
      const go = root.querySelector('#acGo');
      if (go) go.addEventListener('click', () => {
        from = root.querySelector('#acFrom').value;
        to = root.querySelector('#acTo').value;
        if (!from || !to) { toast($t('Pick both dates'), 'warn'); return; }
        load();
      });
      root.querySelector('#acOpening')?.addEventListener('click', openingModal);
      /* the one an accountant, a landlord or a bank actually gets handed */
      root.querySelector('#acPdf')?.addEventListener('click', () => {
        const p = data.pnl;
        const money = (v) => fmt(v);
        const pnlRows = [
          [$t('Product sales'), money(p.productSales)],
          [$t('Service sales'), money(p.serviceSales)],
          [$t('Less sales returns'), money(-p.returns)],
          [$t('Net sales'), money(p.netSales)],
          [$t('Less cost of goods sold'), money(-p.cogs)],
          [$t('Gross profit'), money(p.grossProfit)],
          ...(p.expenseLines || []).map((l) => [$t(ACCOUNT_NAMES[l.code] || l.name), money(-l.amount)]),
          [$t('Net income'), money(p.netIncome)],
        ];
        exportPdf('books', {
          title: $t('Profit and loss'),
          range: { from: data.period.from.slice(0, 10), to: data.period.to.slice(0, 10) },
          columns: [$t('Line'), $t('Amount')],
          numericFrom: 1,
          rows: pnlRows,
          extra: [{
            title: $t('Trial balance'),
            columns: [$t('Code'), $t('Account'), $t('Debit'), $t('Credit')],
            numericFrom: 2,
            rows: data.trialBalance.accounts.map((a) => [a.code, $t(ACCOUNT_NAMES[a.code] || a.name), money(a.debit), money(a.credit)])
              .concat([['', $t('Total'), money(data.trialBalance.debit), money(data.trialBalance.credit)]]),
          }],
          meta: data.trialBalance.balanced ? $t('Books balance') : $t('Out of balance'),
        });
      });
      root.querySelector('#acJournalCsv')?.addEventListener('click', () => {
        downloadCsv(`orison-journal-${range.from}-${range.to}.csv`, journalCsv(data));
        toast($tn('Journal CSV · {n} entry', 'Journal CSV · {n} entries', data.journal.length), 'ok');
        beep('ok');
      });
      root.querySelector('#acTrialCsv')?.addEventListener('click', () => {
        downloadCsv(`orison-trial-balance-${range.from}-${range.to}.csv`, trialCsv(data));
        toast($t('Trial balance CSV saved'), 'ok');
        beep('ok');
      });
    }

    function openingModal() {
      const entry = opening && opening.entry;
      const suggested = (opening && opening.suggestedStockValue) || 0;
      const m = openModal(`
        <h3>${$t('Opening balances')}</h3>
        ${entry ? `
          <p class="muted">${esc($t('Set as of {date} by {who}.', { date: entry.asOf, who: entry.createdBy }))}</p>
          <div class="po-lines-subtotal"><span class="muted">${$t('In the till')}</span><strong>${esc(fmt(entry.cash))}</strong></div>
          <div class="po-lines-subtotal"><span class="muted">${$t('In the bank')}</span><strong>${esc(fmt(entry.bank))}</strong></div>
          <div class="po-lines-subtotal"><span class="muted">${$t('Stock at cost')}</span><strong>${esc(fmt(entry.stockValue))}</strong></div>
          <div class="po-lines-subtotal"><span>${$t('Total')}</span><strong>${esc(fmt(entry.total))}</strong></div>
          ${entry.note ? `<p class="muted">${esc(entry.note)}</p>` : ''}
          <p class="muted">${$t('If this is wrong, void it and enter it again. Nothing else in the books changes.')}</p>
          <label class="field-label">${$t('Reason for voiding')}</label>
          <input class="field" id="acVoidWhy" placeholder="${$t('Counted the safe twice')}">
          <div class="modal-actions">
            <button class="btn btn-ghost" data-close>${$t('Close')}</button>
            <button class="btn btn-danger" id="acVoidGo">${$t('Void these')}</button>
          </div>
        ` : `
          <p class="muted">${$t('What the shop had on the day it started keeping its books here. This is not a sale and not a drawer movement — it is the balance sheet admitting what was already there.')}</p>
          <label class="field-label">${$t('As of')}</label>
          <input class="field" id="acAsOf" type="date" value="${esc((opening && opening.suggestedAsOf) || '')}">
          <div class="form-grid">
            <div>
              <label class="field-label">${$t('In the till')}</label>
              <input class="field" id="acCash" inputmode="decimal" value="0">
            </div>
            <div>
              <label class="field-label">${$t('In the bank')}</label>
              <input class="field" id="acBank" inputmode="decimal" value="0">
            </div>
          </div>
          <label class="field-label">${$t('Stock at cost')}</label>
          <input class="field" id="acStock" inputmode="decimal" value="${esc(String(suggested))}">
          <p class="muted">${esc($t('Offered from what is on the shelf right now, at cost: {amount}. Change it only if the shop counted something different.', { amount: fmt(suggested) }))}</p>
          <label class="field-label">${$t('Note')}</label>
          <input class="field" id="acOpenNote" placeholder="${$t('Counted with the owner')}">
          <p id="acOpenErr" class="login-err"></p>
          <div class="modal-actions">
            <button class="btn btn-ghost" data-close>${$t('Cancel')}</button>
            <button class="btn btn-primary" id="acOpenGo">${$t('Set them')}</button>
          </div>
        `}
      `);

      m.querySelector('#acOpenGo')?.addEventListener('click', async () => {
        const go = m.querySelector('#acOpenGo');
        go.disabled = true;
        try {
          await api.post('/api/opening-balances', {
            asOf: m.querySelector('#acAsOf').value,
            cash: Number(m.querySelector('#acCash').value) || 0,
            bank: Number(m.querySelector('#acBank').value) || 0,
            stockValue: Number(m.querySelector('#acStock').value) || 0,
            note: m.querySelector('#acOpenNote').value.trim(),
          });
          closeModal();
          toast($t('Opening balances set'), 'ok');
          beep('ok');
          await load();
        } catch (err) {
          m.querySelector('#acOpenErr').textContent = (err && err.message) || $t('Could not set those');
          go.disabled = false;
        }
      });

      m.querySelector('#acVoidGo')?.addEventListener('click', async () => {
        const reason = m.querySelector('#acVoidWhy').value.trim();
        if (!reason) { toast($t('A void needs a reason'), 'warn'); return; }
        const go = m.querySelector('#acVoidGo');
        go.disabled = true;
        try {
          await api.post('/api/opening-balances/void', { reason });
          closeModal();
          toast($t('Opening balances voided'), 'ok');
          await load();
        } catch (err) {
          toast((err && err.message) || $t('Could not void those'), 'err');
          go.disabled = false;
        }
      });
    }

    await load();
  },
};

/* ---- render helpers ---- */

function money(v) { return fmt(v || 0); }

function pnlTable(p) {
  const row = (label, v, cls) => `<tr class="${cls || ''}"><td>${esc(label)}</td><td class="num${v < 0 ? ' neg' : ''}">${money(v)}</td></tr>`;
  return `<div class="table-wrap"><table class="data-table acct-pnl"><tbody>
    ${row($t('Product sales'), p.productSales)}
    ${row($t('Service sales'), p.serviceSales)}
    ${row($t('Less sales returns'), -p.returns)}
    ${row($t('Net sales'), p.netSales, 'acct-sub')}
    ${row($t('Less cost of goods sold'), -p.cogs)}
    ${row($t('Gross profit'), p.grossProfit, 'acct-sub')}
    ${(p.expenseLines && p.expenseLines.length
      ? p.expenseLines.map((l) => row($t(ACCOUNT_NAMES[l.code] || l.name), -l.amount)).join('')
      : [row($t('Inventory shrinkage'), -p.shrinkage),
         row($t('Paid out'), -p.paidOut),
         row($t('Staff expenses'), -p.staffExpenses),
         row($t('Wages'), -(p.wages || 0))].join(''))}
    ${p.rounding ? row($t('Rounding'), -p.rounding) : ''}
  </tbody><tfoot>${row($t('Net income'), p.netIncome)}</tfoot></table></div>`;
}

function movementsTable(list) {
  return `<div class="table-wrap"><table class="data-table"><tbody>
    ${list.map((m) => `<tr><td>${esc(accountName(m.code, m.name))}</td><td class="num${m.change < 0 ? ' neg' : ''}">${m.change > 0 ? '+' : ''}${money(m.change)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function trialTable(tb) {
  if (!tb.accounts.length) return `<p class="empty">${$t('Nothing in this window.')}</p>`;
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>${$t('Code')}</th><th>${$t('Account')}</th><th class="num">${$t('Debit')}</th><th class="num">${$t('Credit')}</th></tr></thead>
    <tbody>${tb.accounts.map((a) => `<tr><td class="acct-code">${esc(a.code)}</td><td>${esc(accountName(a.code, a.name))}</td><td class="num">${a.debit ? money(a.debit) : ''}</td><td class="num">${a.credit ? money(a.credit) : ''}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td></td><td>${$t('Total')}</td><td class="num">${money(tb.debit)}</td><td class="num">${money(tb.credit)}</td></tr></tfoot>
  </table></div>`;
}

function journalTable(entries) {
  if (!entries.length) return `<p class="empty">${$t('Nothing in this window.')}</p>`;
  const loc = dateLocale();
  return `<div class="table-wrap"><table class="data-table acct-journal">
    <thead><tr><th>${$t('Date')}</th><th>${$t('Entry')}</th><th>${$t('Account')}</th><th class="num">${$t('Debit')}</th><th class="num">${$t('Credit')}</th></tr></thead>
    ${entries.map((j) => `<tbody class="acct-entry">
      ${j.lines.map((l, i) => `<tr>
        ${i === 0 ? `<td rowspan="${j.lines.length}">${esc(new Date(j.date).toLocaleDateString(loc))}</td><td rowspan="${j.lines.length}"><b>${esc($t(KIND_LABELS[j.kind] || j.kind))}</b><br><span class="muted">${esc(j.ref)}</span></td>` : ''}
        <td class="${l.credit ? 'acct-cr' : ''}">${esc(l.code)} ${esc(accountName(l.code, l.name))}</td>
        <td class="num">${l.debit ? money(l.debit) : ''}</td>
        <td class="num">${l.credit ? money(l.credit) : ''}</td>
      </tr>`).join('')}
    </tbody>`).join('')}
  </table></div>`;
}

/* CSV stays in English with plain numbers: it is for spreadsheets and
   accounting software, which expect stable column names. */
export function journalCsv(data) {
  const n = (v) => Number(v || 0).toFixed(2);
  const lines = [['entry', 'date', 'kind', 'reference', 'memo', 'account_code', 'account', 'debit', 'credit'].join(',')];
  for (const j of data.journal) {
    for (const l of j.lines) {
      lines.push([String(j.no), j.date, j.kind, j.ref, j.memo, l.code, l.name, n(l.debit), n(l.credit)].map(csvCell).join(','));
    }
  }
  return lines.join('\n');
}

export function trialCsv(data) {
  const n = (v) => Number(v || 0).toFixed(2);
  const tb = data.trialBalance;
  const lines = [`Trial balance,${csvCell(data.period.from)},${csvCell(data.period.to)}`, ['account_code', 'account', 'type', 'debit', 'credit', 'balance'].join(',')];
  for (const a of tb.accounts) lines.push([a.code, a.name, a.type, n(a.debit), n(a.credit), n(a.balance)].map(csvCell).join(','));
  lines.push(['', 'Total', '', n(tb.debit), n(tb.credit), n(tb.debit - tb.credit)].map(csvCell).join(','));
  lines.push('');
  lines.push('Profit and loss');
  const p = data.pnl;
  for (const [k, v] of [['product_sales', p.productSales], ['service_sales', p.serviceSales], ['sales_returns', p.returns], ['net_sales', p.netSales], ['cost_of_goods_sold', p.cogs], ['gross_profit', p.grossProfit], ['inventory_shrinkage', p.shrinkage], ['paid_out', p.paidOut], ['staff_expenses', p.staffExpenses], ['wages', p.wages || 0], ...(p.expenseLines || []).map((l) => [`account_${l.code}`, l.amount]), ['rounding', p.rounding], ['net_income', p.netIncome]]) {
    lines.push([k, n(v)].join(','));
  }
  return lines.join('\n');
}
