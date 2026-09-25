'use strict';

import { $t, $tn, N_, dateLocale } from '../lang.js';

/* Repairs — the bench book.

   A customer hands over a device; this is where it lives until they get it
   back. The part that matters to the rest of the system is that fitting a part
   takes it off the shelf here and now, so the on-hand figure keeps describing
   what is physically in the building.

   Collection is deliberately not a status anyone can pick. A repair is
   collected by charging for it (Collect & charge), which writes a real sale —
   otherwise a job could be marked collected without any money changing hands.

   The amounts on the collect dialog come from the server's own quote
   (invoiceTotal, balanceDue), priced by the same function that charges, so the
   balance a cashier asks for is always the balance the server accepts. */

import { api } from '../api.js';
import { idb } from '../db.js';
import { fmt, esc, toast, beep, skeleton, emptyState, openModal, closeModal } from '../ui.js';
import { exportCsv } from '../csv.js';
import { screenHead, sectionHead, dataTable } from '../components.js';
import { receiptDoc } from '../receipt-doc.js';
import { receiptContext } from '../receipt-labels.js';
import { openWarrantyLookup, statusChip } from '../warranty.js';

export const REPAIR_FLOW = [
  { id: 'intake', label: N_('Booked in'), tone: 'new' },
  { id: 'diagnosed', label: N_('Diagnosed'), tone: 'work' },
  { id: 'awaiting_parts', label: N_('Awaiting parts'), tone: 'wait' },
  { id: 'in_progress', label: N_('On the bench'), tone: 'work' },
  { id: 'ready', label: N_('Ready'), tone: 'good' },
  { id: 'collected', label: N_('Collected'), tone: 'done' },
  { id: 'unrepairable', label: N_('Unrepairable'), tone: 'bad' },
  { id: 'cancelled', label: N_('Cancelled'), tone: 'bad' },
  { id: 'voided', label: N_('Voided'), tone: 'bad' },
];

const CLOSED = new Set(['collected', 'cancelled', 'unrepairable', 'voided']);
const OPEN_ORDER = ['intake', 'diagnosed', 'awaiting_parts', 'in_progress', 'ready'];

/* The bench as a spreadsheet: every ticket, what it is worth, and where it is. */
export function repairsCsv(rows) {
  const n = (v) => (v == null ? '' : String(v));
  return {
    columns: ['ticket', 'status', 'customer', 'phone', 'device', 'serial', 'fault', 'booked_in', 'promised', 'parts', 'labour', 'total', 'deposit', 'waiting_on_parts'],
    rows: (rows || []).map((t) => [t.ticketNo, t.status, t.customerName, t.customerPhone, t.device, t.deviceSerial,
      t.reportedFault, t.createdAt, t.promisedAt, n(t.partsTotal), n(t.labourTotal), n(t.total), n(t.depositTotal), n(t.needsCount || 0)]),
  };
}

export function needState(need) {
  const n = need || {};
  if (n.canFit) return { id: 'here', label: N_('On the shelf'), cls: 'need-here' };
  if (n.poNumber) return { id: 'ordered', label: N_('On order'), cls: 'need-ordered' };
  if (Number(n.onOrder) > 0) return { id: 'coming', label: N_('On order'), cls: 'need-ordered' };
  return { id: 'none', label: N_('Nobody has ordered it'), cls: 'need-short' };
}

export function statusLabel(id) {
  const hit = REPAIR_FLOW.find((s) => s.id === id);
  if (hit) return $t(hit.label);
  const words = String(id || '').replace(/_/g, ' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

export function statusTone(id) {
  const hit = REPAIR_FLOW.find((s) => s.id === id);
  return hit ? hit.tone : 'new';
}

/* What a ticket may legally become next. The obvious forward step comes first,
   then the other open states, then the two ways a job ends without money.
   Collected is never here: it comes from invoicing, not from a menu. */
export function nextStatuses(status) {
  if (CLOSED.has(status)) return [];
  const i = OPEN_ORDER.indexOf(status);
  const out = [];
  if (i >= 0 && i < OPEN_ORDER.length - 1) out.push(OPEN_ORDER[i + 1]);
  for (const s of OPEN_ORDER) if (s !== status && !out.includes(s)) out.push(s);
  out.push('unrepairable', 'cancelled');
  return out;
}

function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' });
}

function pill(status) {
  return `<span class="rp-pill rp-${esc(statusTone(status))}">${esc(statusLabel(status))}</span>`;
}

export const screen = {
  id: 'repairs',
  tab: 'repairs',
  title: $t('Repairs'),

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const { state } = ctx;
    const role = String((state.user || {}).role || 'cashier');
    const isAdmin = role === 'admin';
    const isManager = role === 'admin' || role === 'manager';

    let status = '';
    let query = '';
    let rows = [];
    let matched = 0;
    let nextCursor = '';
    let openId = '';

    root.innerHTML = `
      ${screenHead({
    title: $t('Repairs'),
    sub: $t('Devices in for repair'),
    actions: `<span class="btn-row"><button class="btn btn-ghost btn-sm" id="rpCsv" type="button">${$t('Export CSV')}</button><button class="btn btn-ghost" id="rpWarranty" type="button">${$t('Check warranty')}</button><button class="btn" id="rpNew" type="button">${$t('Book in a repair')}</button></span>`,
  })}
      <div class="seg seg-sm rp-filters" id="rpFilters"></div>
      <div class="field"><input id="rpSearch" type="search" placeholder="${$t('Ticket number, customer, phone or IMEI…')}" autocomplete="off" spellcheck="false"></div>
      <div id="rpBody">${skeleton('table', 5)}</div>
      <div id="rpDetail"></div>`;

    const body = root.querySelector('#rpBody');
    const detail = root.querySelector('#rpDetail');
    const filters = root.querySelector('#rpFilters');
    const search = root.querySelector('#rpSearch');

    const FILTERS = [{ id: '', label: $t('Open') }].concat(
      REPAIR_FLOW.filter((s) => s.id !== 'voided').map((s) => ({ id: s.id, label: $t(s.label) })),
    );

    function paintFilters() {
      filters.innerHTML = FILTERS.map((f) => `
        <button class="seg-btn ${f.id === status ? 'on' : ''}" data-st="${esc(f.id)}" type="button">${esc(f.label)}</button>`).join('');
      filters.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => {
        status = b.dataset.st;
        nextCursor = '';
        load();
      }));
    }

    async function load(append) {
      if (!append) body.innerHTML = skeleton('table', 5);
      const qs = [];
      if (status) qs.push('status=' + encodeURIComponent(status));
      if (query) qs.push('q=' + encodeURIComponent(query));
      if (append && nextCursor) qs.push('cursor=' + encodeURIComponent(nextCursor));
      try {
        const res = await api.get('/api/repairs' + (qs.length ? '?' + qs.join('&') : ''));
        rows = append ? rows.concat(res.repairs || []) : (res.repairs || []);
        matched = res.matched || 0;
        nextCursor = res.nextCursor || '';
        paint();
      } catch (e) {
        body.innerHTML = emptyState({ title: $t('Could not load repairs'), body: (e && e.message) || '' });
      }
    }

    function paint() {
      if (!rows.length) {
        body.innerHTML = emptyState({
          title: query ? $t('Nothing matches that') : $t('No repairs here'),
          body: query ? $t('Try the ticket number, the customer, or the IMEI.') : $t('Book one in to get started.'),
        });
        return;
      }
      const bodyHtml = rows.map((r) => `
        <tr class="rp-row" data-open="${esc(r.id)}">
          <td><strong>${esc(r.ticketNo)}</strong><br><span class="muted">${esc(when(r.createdAt))}</span></td>
          <td>${esc(r.device || '—')}<br><span class="muted">${esc(r.reportedFault.slice(0, 60))}</span></td>
          <td>${esc(r.customerName || r.customerPhone || '—')}</td>
          <td>${pill(r.status)}${r.depositTotal > 0 ? `<br><span class="muted rp-dep">Deposit ${esc(fmt(r.depositTotal))}</span>` : ''}</td>
          <td class="num">${esc(fmt(r.total))}</td>
        </tr>`).join('');

      body.innerHTML = dataTable({
        head: [{ label: $t('Ticket') }, { label: $t('Device') }, { label: $t('Customer') }, { label: $t('Status') }, { label: $t('Total'), num: true }],
        bodyHtml,
      }) + (nextCursor
        ? `<button class="btn btn-ghost" id="rpMore" type="button">Load 100 more (${matched - rows.length} left)</button>`
        : `<p class="muted">${rows.length} of ${matched} shown</p>`);

      body.querySelectorAll('[data-open]').forEach((tr) => tr.addEventListener('click', () => openTicket(tr.dataset.open)));
      const more = body.querySelector('#rpMore');
      if (more) more.addEventListener('click', () => load(true));
    }

    async function openTicket(id) {
      openId = id;
      detail.innerHTML = skeleton('table', 3);
      let t;
      try {
        t = await api.get('/api/repairs/detail?id=' + encodeURIComponent(id));
      } catch (e) {
        detail.innerHTML = emptyState({ title: $t('Could not open that ticket'), body: (e && e.message) || '' });
        return;
      }

      const moves = nextStatuses(t.status);
      const partsHtml = t.parts.length
        ? dataTable({
          head: [{ label: $t('Part') }, { label: $t('Qty'), num: true }, { label: $t('Price'), num: true }, { label: '' }],
          bodyHtml: t.parts.map((p, i) => `
            <tr>
              <td>${esc(p.name)}${p.serialNumber ? `<br><span class="muted">${esc(p.serialNumber)}</span>` : ''}</td>
              <td class="num">${esc(p.quantity)}</td>
              <td class="num">${esc(fmt(p.unitPrice))}</td>
              <td>${CLOSED.has(t.status) ? '' : `<button class="cl-remove" data-drop-part="${i}" aria-label="${$t('Remove')}">✕</button>`}</td>
            </tr>`).join(''),
        })
        : `<p class="muted">${$t('Nothing fitted yet.')}</p>`;

      const needsHtml = (t.needs || []).length
        ? dataTable({
          head: [{ label: $t('Waiting for') }, { label: $t('Qty'), num: true }, { label: $t('Where it is') }, { label: '' }],
          bodyHtml: t.needs.map((n, i) => {
            const st = needState(n);
            const where = [
              n.poNumber ? $t('{number}{due}', { number: n.poNumber, due: n.expectedDate ? ' · ' + $t('due {date}', { date: n.expectedDate }) : '' }) : '',
              $t('{n} on the shelf', { n: n.onHand }),
            ].filter(Boolean).join(' · ');
            return `
            <tr>
              <td>${esc(n.name)}${n.note ? `<br><span class="muted">${esc(n.note)}</span>` : ''}</td>
              <td class="num">${esc(n.quantity)}</td>
              <td><span class="po-chip ${st.cls}">${esc($t(st.label))}</span><br><span class="muted">${esc(where)}</span></td>
              <td>${CLOSED.has(t.status) ? '' : `
                ${n.canFit ? `<button class="btn btn-sm" data-fit-need="${i}">${$t('Fit it')}</button>` : ''}
                <button class="cl-remove" data-drop-need="${i}" aria-label="${$t('Remove')}">✕</button>`}</td>
            </tr>`;
          }).join(''),
        })
        : `<p class="muted">${$t('Not waiting for anything.')}</p>`;

      const labourHtml = t.labour.length
        ? dataTable({
          head: [{ label: $t('Work') }, { label: $t('Amount'), num: true }, { label: '' }],
          bodyHtml: t.labour.map((l, i) => `
            <tr>
              <td>${esc(l.description)}</td>
              <td class="num">${esc(fmt(l.amount))}</td>
              <td>${CLOSED.has(t.status) ? '' : `<button class="cl-remove" data-drop-lab="${i}" aria-label="${$t('Remove')}">✕</button>`}</td>
            </tr>`).join(''),
        })
        : `<p class="muted">${$t('No labour yet.')}</p>`;

      detail.innerHTML = `
        <div class="card rp-detail">
          ${sectionHead({ title: t.ticketNo, asideHtml: pill(t.status) })}
          <div class="rp-grid">
            <div><span class="muted">${$t('Device')}</span><strong>${esc(t.device || '—')}</strong></div>
            <div><span class="muted">${$t('IMEI / serial')}</span><strong>${esc(t.deviceSerial || '—')}</strong>
              ${t.warrantyStatus ? `<br>${statusChip(t.warrantyStatus, t.warrantyUntil)}${t.warrantyReceipt ? ` <span class="muted">${esc(t.warrantyReceipt)}</span>` : ''}` : ''}</div>
            <div><span class="muted">${$t('Customer')}</span><strong>${esc(t.customerName || '—')}</strong></div>
            <div><span class="muted">${$t('Phone')}</span><strong>${esc(t.customerPhone || '—')}</strong></div>
          </div>
          <p><span class="muted">${$t('Reported fault')}</span><br>${esc(t.reportedFault)}</p>
          ${t.conditionNote ? `<p><span class="muted">${$t('Condition at intake')}</span><br>${esc(t.conditionNote)}</p>` : ''}
          ${t.accessories ? `<p><span class="muted">${$t('Left with it')}</span><br>${esc(t.accessories)}</p>` : ''}

          ${sectionHead({ title: $t('Waiting on parts'), asideHtml: CLOSED.has(t.status) ? '' : `<button class="btn btn-sm" id="rpAddNeed" type="button">${$t('Wait for a part')}</button>` })}
          ${needsHtml}

          ${sectionHead({ title: $t('Parts'), asideHtml: CLOSED.has(t.status) ? '' : `<button class="btn btn-sm" id="rpAddPart" type="button">${$t('Fit a part')}</button>` })}
          ${partsHtml}

          ${sectionHead({ title: $t('Labour'), asideHtml: CLOSED.has(t.status) ? '' : `<button class="btn btn-sm" id="rpAddLab" type="button">${$t('Add labour')}</button>` })}
          ${labourHtml}

          <div class="rp-money">
            <div><span>${$t('Job total')}${t.invoiceTax > 0 ? ' ' + $t('(incl. tax)') : ''}</span><strong>${esc(fmt(t.invoiceTotal))}</strong></div>
            <div><span>${$t('Deposit held')}</span><strong>${esc(fmt(t.depositTotal))}</strong></div>
            ${t.status === 'collected'
    ? `<div class="rp-total"><span>${$t('Charged')}</span><strong>${esc(fmt(t.finalTotal))}</strong></div>`
    : `<div class="rp-total"><span>${t.overpaid > 0 ? $t('Deposit exceeds job by') : $t('Balance due')}</span><strong>${esc(fmt(t.overpaid > 0 ? t.overpaid : t.balanceDue))}</strong></div>`}
          </div>

          ${CLOSED.has(t.status) ? '' : `
            <div class="row rp-actions">
              <button class="btn btn-ghost" id="rpDeposit" type="button">${$t('Take deposit')}</button>
              <button class="btn" id="rpCollect" type="button" ${(t.parts.length || t.labour.length) && !(t.overpaid > 0) ? '' : 'disabled'}>${$t('Collect &amp; charge')}</button>
            </div>
            ${t.overpaid > 0 ? `<p class="muted">${$t('The deposit is more than the job. Give the difference back before collecting.')}</p>` : ''}`}

          ${t.status !== 'collected' && t.depositTotal > 0
    ? `<button class="btn btn-ghost btn-danger" id="rpDepRefund" type="button">${$t('Give deposit back')}</button>` : ''}

          ${moves.length ? `
            <div class="field"><span>${$t('Move this job to')}</span>
              <div class="seg seg-sm" id="rpMoves">
                ${moves.map((m) => `<button class="seg-btn" data-move="${esc(m)}" type="button">${esc(statusLabel(m))}</button>`).join('')}
              </div>
            </div>` : `<p class="muted">${$t('This ticket is closed.')}</p>`}

          ${isAdmin && !CLOSED.has(t.status) && !(t.depositTotal > 0) ? `<button class="btn btn-ghost btn-danger" id="rpVoid" type="button">${$t('Void this ticket')}</button>` : ''}
        </div>`;

      detail.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => move(t, b.dataset.move)));
      detail.querySelectorAll('[data-drop-part]').forEach((b) => b.addEventListener('click', () => dropPart(t.id, Number(b.dataset.dropPart))));
      detail.querySelectorAll('[data-drop-lab]').forEach((b) => b.addEventListener('click', () => dropLabour(t.id, Number(b.dataset.dropLab))));
      const addNeedBtn = detail.querySelector('#rpAddNeed');
      if (addNeedBtn) addNeedBtn.addEventListener('click', () => needDialog(t.id));
      detail.querySelectorAll('[data-drop-need]').forEach((b) => b.addEventListener('click', () => dropNeed(t.id, Number(b.dataset.dropNeed))));
      detail.querySelectorAll('[data-fit-need]').forEach((b) => b.addEventListener('click', () => fitNeed(t.id, Number(b.dataset.fitNeed), t.needs[Number(b.dataset.fitNeed)])));

      const ap = detail.querySelector('#rpAddPart');
      if (ap) ap.addEventListener('click', () => partDialog(t.id));
      const al = detail.querySelector('#rpAddLab');
      if (al) al.addEventListener('click', () => labourDialog(t.id));
      const dp = detail.querySelector('#rpDeposit');
      if (dp) dp.addEventListener('click', () => depositDialog(t));
      const cl = detail.querySelector('#rpCollect');
      if (cl) cl.addEventListener('click', () => collectDialog(t));
      const dr = detail.querySelector('#rpDepRefund');
      if (dr) dr.addEventListener('click', () => depositRefundDialog(t));
      const vd = detail.querySelector('#rpVoid');
      if (vd) vd.addEventListener('click', () => voidDialog(t));
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async function move(t, to) {
      const ending = to === 'cancelled' || to === 'unrepairable';
      if (ending && !window.confirm(
        $t('Mark {ticket} as {status}? Every fitted part goes back into stock, and the ticket closes for good.', { ticket: t.ticketNo, status: statusLabel(to) }))) return;
      try {
        const res = await api.post('/api/repairs/status', { id: t.id, status: to });
        toast(res.returned
          ? $tn('{status} — {n} part back in stock', '{status} — {n} parts back in stock', res.returned, { status: statusLabel(to) })
          : statusLabel(to), 'ok');
        beep('ok');
        await openTicket(t.id);
        await load();
      } catch (e) {
        toast((e && e.message) || $t('Could not move that ticket'), 'err');
        beep('err');
      }
    }

    async function dropPart(id, index) {
      try {
        await api.post('/api/repairs/parts', { id, removeIndex: index });
        toast($t('Part returned to stock'), 'ok');
        await openTicket(id);
      } catch (e) { toast((e && e.message) || $t('Could not remove that part'), 'err'); }
    }

    async function dropLabour(id, index) {
      try {
        await api.post('/api/repairs/labour', { id, removeIndex: index });
        await openTicket(id);
      } catch (e) { toast((e && e.message) || $t('Could not remove that line'), 'err'); }
    }

    async function dropNeed(id, index) {
      try {
        await api.post('/api/repairs/needs', { id, removeIndex: index });
        await openTicket(id);
      } catch (e) { toast((e && e.message) || $t('Could not remove that line'), 'err'); }
    }

    async function fitNeed(id, index, need) {
      if (!need) return;
      try {
        const all = await idb.getAll('products');
        const prod = (all || []).find((p) => p.id === need.productId) || {};
        let serialNumber = '';
        if (prod.isSerialized) {
          serialNumber = String(window.prompt($t('Which {name}? Enter the serial.', { name: need.name })) || '').trim();
          if (!serialNumber) return;
        }
        await api.post('/api/repairs/parts', {
          id,
          needIndex: index,
          add: [{ productId: need.productId, quantity: need.quantity, unitPrice: prod.retailPrice || 0, serialNumber }],
        });
        toast($t('Part fitted and taken off the shelf'), 'ok');
        beep('ok');
        await openTicket(id);
      } catch (e) {
        toast((e && e.message) || $t('Could not fit that part'), 'err');
        beep('err');
      }
    }

    function needDialog(id) {
      const modal = openModal(`
        <div class="form-modal">
          <h3>${$t('Wait for a part')}</h3>
          <p class="muted">${$t('This holds nothing back from the shop floor — it records what the job needs so it can be ordered.')}</p>
          <div class="form-grid">
            <div class="field"><span>${$t('How many')}</span>
              <input id="rpNeedQty" inputmode="numeric" value="1"></div>
            <div class="field"><span>${$t('Note')}</span>
              <input id="rpNeedNote" placeholder="${$t('Colour, variant, anything the order needs')}"></div>
          </div>
          <div class="field"><span>${$t('Find the part')}</span>
            <input id="rpNeedQ" type="search" placeholder="${$t('Name, SKU or barcode…')}" autocomplete="off"></div>
          <div id="rpNeedHits" class="cust-results"></div>
          <p id="rpNeedErr" class="login-err"></p>
          <div class="row"><button class="btn btn-ghost" data-cancel type="button">${$t('Cancel')}</button></div>
        </div>`);
      const q = modal.querySelector('#rpNeedQ');
      const hits = modal.querySelector('#rpNeedHits');
      const err = modal.querySelector('#rpNeedErr');
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);

      q.addEventListener('input', async () => {
        const term = q.value.trim().toLowerCase();
        if (!term) { hits.innerHTML = ''; return; }
        const all = await idb.getAll('products');
        const found = (all || []).filter((p) => p.itemType !== 'service'
          && (p.name.toLowerCase().includes(term)
          || (p.sku || '').toLowerCase().includes(term)
          || (p.upc || '').toLowerCase().includes(term))).slice(0, 8);
        hits.innerHTML = found.map((p) => `
          <button class="cust-row" data-pick="${esc(p.id)}" type="button">
            ${esc(p.name)}<em class="muted">${esc(p.sku || '')} · ${esc($t('{n} on hand', { n: p.onHand }))}</em>
          </button>`).join('') || `<p class="muted">${$t('Nothing matches.')}</p>`;
        hits.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
          const p = found.find((x) => x.id === b.dataset.pick);
          if (!p) return;
          const quantity = Math.max(1, Math.floor(Number(modal.querySelector('#rpNeedQty').value) || 1));
          try {
            await api.post('/api/repairs/needs', {
              id, add: [{ productId: p.id, quantity, note: modal.querySelector('#rpNeedNote').value.trim() }],
            });
            closeModal();
            toast($t('Added to what this job is waiting for'), 'ok');
            await openTicket(id);
          } catch (e) {
            err.textContent = (e && e.message) || $t('Could not add that part');
            beep('err');
          }
        }));
      });
      q.focus();
    }

    function partDialog(id) {
      const modal = openModal(`
        <div class="form-modal">
          <h3>${$t('Fit a part')}</h3>
          <div class="field"><span>${$t('Find the part')}</span>
            <input id="rpPartQ" type="search" placeholder="${$t('Name, SKU or barcode…')}" autocomplete="off"></div>
          <div id="rpPartHits" class="cust-results"></div>
          <p id="rpPartErr" class="login-err"></p>
          <div class="row"><button class="btn btn-ghost" data-cancel type="button">${$t('Cancel')}</button></div>
        </div>`);
      const q = modal.querySelector('#rpPartQ');
      const hits = modal.querySelector('#rpPartHits');
      const err = modal.querySelector('#rpPartErr');
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);

      q.addEventListener('input', async () => {
        const term = q.value.trim().toLowerCase();
        if (!term) { hits.innerHTML = ''; return; }
        const all = await idb.getAll('products');
        const found = (all || []).filter((p) => p.name.toLowerCase().includes(term)
          || (p.sku || '').toLowerCase().includes(term)
          || (p.upc || '').toLowerCase().includes(term)).slice(0, 8);
        hits.innerHTML = found.map((p) => `
          <button class="cust-row" data-pick="${esc(p.id)}" type="button">
            ${esc(p.name)}<em class="muted">${esc(p.sku || '')} · ${esc($t('{n} on hand', { n: p.onHand }))}</em>
          </button>`).join('') || `<p class="muted">${$t('Nothing matches.')}</p>`;
        hits.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
          const p = found.find((x) => x.id === b.dataset.pick);
          if (!p) return;
          let serialNumber = '';
          if (p.isSerialized) {
            serialNumber = String(window.prompt($t('Which {name}? Enter the serial.', { name: p.name })) || '').trim();
            if (!serialNumber) return;
          }
          try {
            await api.post('/api/repairs/parts', {
              id, add: [{ productId: p.id, quantity: 1, unitPrice: p.retailPrice, serialNumber }],
            });
            closeModal();
            toast($t('Part fitted and taken off the shelf'), 'ok');
            beep('ok');
            await openTicket(id);
          } catch (e) {
            err.textContent = (e && e.message) || $t('Could not fit that part');
            beep('err');
          }
        }));
      });
      q.focus();
    }

    function labourDialog(id) {
      const modal = openModal(`
        <div class="form-modal">
          <h3>${$t('Add labour')}</h3>
          <div class="field"><span>${$t('What was done')}</span>
            <input id="rpLabDesc" placeholder="${$t('e.g. Screen fit and calibration')}" autocomplete="off"></div>
          <div class="field"><span>${$t('Amount')}</span>
            <input id="rpLabAmt" type="number" min="0" step="0.01" value="0"></div>
          <p id="rpLabErr" class="login-err"></p>
          <div class="row">
            <button class="btn btn-ghost" data-cancel type="button">${$t('Cancel')}</button>
            <button class="btn" id="rpLabSave" type="button">${$t('Add')}</button>
          </div>
        </div>`);
      const err = modal.querySelector('#rpLabErr');
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('#rpLabSave').addEventListener('click', async () => {
        const description = modal.querySelector('#rpLabDesc').value.trim();
        const amount = Number(modal.querySelector('#rpLabAmt').value) || 0;
        try {
          await api.post('/api/repairs/labour', { id, add: { description, amount } });
          closeModal();
          await openTicket(id);
        } catch (e) { err.textContent = (e && e.message) || $t('Could not add that line'); }
      });
      modal.querySelector('#rpLabDesc').focus();
    }

    function depositDialog(t) {
      const modal = openModal(`
        <div class="form-modal">
          <h3>${esc($t('Take a deposit on {ticket}', { ticket: t.ticketNo }))}</h3>
          <p class="muted">${$t('Held against the job, not counted as a sale. It comes off the bill when the customer collects.')}</p>
          <div class="field"><span>${$t('Amount')}</span><input id="rpDepAmt" type="number" min="0" step="0.01" inputmode="decimal"></div>
          <div class="field"><span>${$t('Paid by')}</span>
            <div class="seg seg-sm" id="rpDepType">
              <button class="seg-btn on" data-type="cash" type="button">${$t('Cash')}</button>
              <button class="seg-btn" data-type="card" type="button">${$t('Card')}</button>
            </div>
          </div>
          <p id="rpDepErr" class="login-err"></p>
          <div class="row">
            <button class="btn btn-ghost" data-cancel type="button">${$t('Cancel')}</button>
            <button class="btn" id="rpDepGo" type="button">${$t('Take deposit')}</button>
          </div>
        </div>`);
      let type = 'cash';
      const err = modal.querySelector('#rpDepErr');
      modal.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
        type = b.dataset.type;
        modal.querySelectorAll('[data-type]').forEach((x) => x.classList.toggle('on', x.dataset.type === type));
      }));
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('#rpDepGo').addEventListener('click', async () => {
        const amount = Number(modal.querySelector('#rpDepAmt').value) || 0;
        try {
          await api.post('/api/repairs/deposit', { id: t.id, amount, tenders: [{ type, amount }] });
          closeModal();
          toast($t('Deposit of {amount} taken', { amount: fmt(amount) }), 'ok');
          beep('ok');
          await openTicket(t.id);
          await load();
        } catch (e) { err.textContent = (e && e.message) || $t('Could not take that deposit'); beep('err'); }
      });
      modal.querySelector('#rpDepAmt').focus();
    }

    function collectDialog(t) {
      const due = Number(t.balanceDue) || 0;
      const modal = openModal(`
        <div class="form-modal">
          <h3>${esc($t('Collect {ticket}', { ticket: t.ticketNo }))}</h3>
          <div class="rp-money">
            <div><span>${$t('Job total')}</span><strong>${esc(fmt(t.invoiceTotal))}</strong></div>
            <div><span>${$t('Deposit applied')}</span><strong>− ${esc(fmt(t.depositTotal))}</strong></div>
            <div class="rp-total"><span>${$t('To pay now')}</span><strong>${esc(fmt(due))}</strong></div>
          </div>
          ${due > 0 ? `
            <div class="field"><span>${$t('Paid by')}</span>
              <div class="seg seg-sm" id="rpColType">
                <button class="seg-btn on" data-type="cash" type="button">${$t('Cash')}</button>
                <button class="seg-btn" data-type="card" type="button">${$t('Card')}</button>
              </div>
            </div>` : `<p class="muted">${$t('The deposit covers the whole job. Nothing more to take.')}</p>`}
          <p id="rpColErr" class="login-err"></p>
          <div class="row">
            <button class="btn btn-ghost" data-cancel type="button">${$t('Cancel')}</button>
            <button class="btn" id="rpColGo" type="button">${due > 0 ? esc($t('Charge {amount}', { amount: fmt(due) })) : $t('Hand it back')}</button>
          </div>
        </div>`);
      let type = 'cash';
      const err = modal.querySelector('#rpColErr');
      modal.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
        type = b.dataset.type;
        modal.querySelectorAll('[data-type]').forEach((x) => x.classList.toggle('on', x.dataset.type === type));
      }));
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      const go = modal.querySelector('#rpColGo');
      go.addEventListener('click', async () => {
        go.disabled = true;
        try {
          const res = await api.post('/api/repairs/collect', {
            id: t.id, tenders: due > 0 ? [{ type, amount: due }] : [],
          });
          closeModal();
          beep('ok');
          collectedDialog(t, res);
          await openTicket(t.id);
          await load();
        } catch (e) {
          go.disabled = false;
          err.textContent = (e && e.message) || $t('Could not collect that job');
          beep('err');
        }
      });
    }

    /* The collection is a sale like any other: same receipt, same drawer. */
    function collectionDoc(t, res) {
      return receiptDoc({
        createdAt: new Date().toISOString(),
        cashier: `${(state.user || {}).firstName || ''} ${(state.user || {}).lastName || ''}`.trim(),
        customerName: t.customerName || '',
        items: t.parts.map((p) => ({ name: p.name, quantity: p.quantity, unitPrice: p.unitPrice, serialNumber: p.serialNumber || null }))
          .concat(t.labour.map((l) => ({ name: l.description, quantity: 1, unitPrice: l.amount }))),
        subtotal: t.invoiceSubtotal,
        taxAmount: t.invoiceTax,
        taxInclusive: !!(state.store && state.store.pricesIncludeTax),
        total: res.total,
        tenders: res.tenders || [],
        receiptNo: res.receiptNo,
        clientTxId: res.transactionId,
      }, receiptContext(state.store));
    }

    function collectedDialog(t, res) {
      const doc = collectionDoc(t, res);
      const modal = openModal(`
        <div class="form-modal">
          <h3>${esc($t('{ticket} collected', { ticket: t.ticketNo }))}</h3>
          <p>${$t('Receipt')} <strong>${esc(res.receiptNo)}</strong> — ${esc(fmt(res.total))}</p>
          <div class="row">
            <button class="btn btn-ghost" id="rpPrint" type="button">${$t('Print receipt')}</button>
            <button class="btn" data-cancel type="button">${$t('Done')}</button>
          </div>
        </div>`);
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('#rpPrint').addEventListener('click', async () => {
        const pr = await import('../printing.js');
        const r = await pr.printDoc(doc);
        if (!r.ok) toast(r.message, 'warn', 3600);
      });
      import('../printing.js').then(async (pr) => {
        const kicked = await pr.maybeKickForSale(res.tenders || []);
        if (!kicked.ok && kicked.message) toast(kicked.message, 'warn', 3200);
        const printed = await pr.maybeAutoPrint(doc);
        if (!printed.ok && printed.message) toast(printed.message, 'warn', 3200);
      }).catch(() => {});
    }

    function depositRefundDialog(t) {
      const modal = openModal(`
        <div class="form-modal">
          <h3>${esc($t('Give back the deposit on {ticket}', { ticket: t.ticketNo }))}</h3>
          <p class="muted">${esc($t('Cash leaves the drawer. Held now: {amount}. Leave the amount blank to give it all back.', { amount: fmt(t.depositTotal) }))}</p>
          <div class="field"><span>${$t('Amount')}</span><input id="rpDrAmt" type="number" min="0" step="0.01" inputmode="decimal" placeholder="${esc(String(t.depositTotal))}"></div>
          <div class="field"><span>${$t('Why')}</span><input id="rpDrWhy" placeholder="${$t('e.g. Board is dead, customer withdrew')}" autocomplete="off"></div>
          <p id="rpDrErr" class="login-err"></p>
          <div class="row">
            <button class="btn btn-ghost" data-cancel type="button">${$t('Cancel')}</button>
            <button class="btn btn-danger" id="rpDrGo" type="button">${$t('Give it back')}</button>
          </div>
        </div>`);
      const err = modal.querySelector('#rpDrErr');
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('#rpDrGo').addEventListener('click', async () => {
        const raw = modal.querySelector('#rpDrAmt').value.trim();
        const reason = modal.querySelector('#rpDrWhy').value.trim();
        const amount = raw === '' ? undefined : Number(raw);
        const payload = { id: t.id, reason, amount };
        /* a cashier gives a deposit back with a manager's approval, bound to
           this ticket (v1.37.0) */
        if (!isManager) {
          if (!reason) { err.textContent = $t('Giving a deposit back needs a reason'); return; }
          const { requestApproval } = await import('../approval-dialog.js');
          payload.ref = t.id + '|' + Date.now().toString(36);
          const granted = await requestApproval({
            action: 'deposit_refund', ref: payload.ref, amount: amount == null ? t.depositTotal : amount,
            detail: $t('{amount} back on {ticket}', { amount: fmt(amount == null ? t.depositTotal : amount), ticket: t.ticketNo }),
            note: reason,
          });
          if (!granted) return;
          payload.approval = granted.approval;
        }
        try {
          const res = await api.post('/api/repairs/deposit-refund', payload);
          closeModal();
          toast($t('{amount} given back', { amount: fmt(res.amount) }), 'ok');
          await openTicket(t.id);
          await load();
        } catch (e) { err.textContent = (e && e.message) || $t('Could not give that back'); }
      });
    }

    function voidDialog(t) {
      const modal = openModal(`
        <div class="form-modal">
          <h3>${esc($t('Void {ticket}', { ticket: t.ticketNo }))}</h3>
          <p class="muted">${$t('Use this only for a ticket that should never have existed — a duplicate, or a mis-entry. A customer who changed their mind is a cancel, not a void. Any fitted parts go back into stock.')}</p>
          <div class="field"><span>${$t('Why')}</span><input id="rpVoidWhy" placeholder="${$t('e.g. Entered twice')}" autocomplete="off"></div>
          <p id="rpVoidErr" class="login-err"></p>
          <div class="row">
            <button class="btn btn-ghost" data-cancel type="button">${$t('Keep it')}</button>
            <button class="btn btn-danger" id="rpVoidGo" type="button">${$t('Void')}</button>
          </div>
        </div>`);
      const err = modal.querySelector('#rpVoidErr');
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('#rpVoidGo').addEventListener('click', async () => {
        try {
          await api.post('/api/repairs/void', { id: t.id, reason: modal.querySelector('#rpVoidWhy').value.trim() });
          closeModal();
          detail.innerHTML = '';
          toast($t('Ticket voided'), 'ok');
          await load();
        } catch (e) { err.textContent = (e && e.message) || $t('Could not void that ticket'); }
      });
    }

    function intakeDialog() {
      const modal = openModal(`
        <div class="form-modal">
          <h3>${$t('Book in a repair')}</h3>
          <div class="two fields-row">
            <div class="field"><span>${$t('Customer name')}</span><input id="rpInName" autocomplete="off"></div>
            <div class="field"><span>${$t('Phone')}</span><input id="rpInPhone" autocomplete="off"></div>
          </div>
          <div class="two fields-row">
            <div class="field"><span>${$t('Make')}</span><input id="rpInMake" placeholder="Apple" autocomplete="off"></div>
            <div class="field"><span>${$t('Model')}</span><input id="rpInModel" placeholder="iPhone 13" autocomplete="off"></div>
          </div>
          <div class="field"><span>${$t('IMEI / serial')}</span><input id="rpInSerial" autocomplete="off"></div>
          <div class="field"><span>${$t('What is wrong with it')}</span><textarea id="rpInFault" rows="2"></textarea></div>
          <div class="field"><span>${$t('Condition at intake')}</span><textarea id="rpInCond" rows="2" placeholder="${$t('Scratches, dents, cracked back — anything you would not want to be blamed for')}"></textarea></div>
          <div class="field"><span>${$t('Left with it')}</span><input id="rpInAcc" placeholder="${$t('Case, charger, SIM tray')}" autocomplete="off"></div>
          <p id="rpInErr" class="login-err"></p>
          <div class="row">
            <button class="btn btn-ghost" data-cancel type="button">${$t('Cancel')}</button>
            <button class="btn" id="rpInSave" type="button">${$t('Book it in')}</button>
          </div>
        </div>`);
      const err = modal.querySelector('#rpInErr');
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('#rpInSave').addEventListener('click', async () => {
        const v = (id) => modal.querySelector(id).value.trim();
        try {
          const res = await api.post('/api/repairs', {
            customerName: v('#rpInName'), customerPhone: v('#rpInPhone'),
            deviceMake: v('#rpInMake'), deviceModel: v('#rpInModel'),
            deviceSerial: v('#rpInSerial'), reportedFault: v('#rpInFault'),
            conditionNote: v('#rpInCond'), accessories: v('#rpInAcc'),
          });
          closeModal();
          toast(res.warranty && res.warranty.status === 'active'
            ? $t('Booked in as {ticket} — under warranty from {receipt}', { ticket: res.ticketNo, receipt: res.warranty.receiptNo })
            : $t('Booked in as {ticket}', { ticket: res.ticketNo }), 'ok', 3600);
          beep('ok');
          await load();
          await openTicket(res.id);
        } catch (e) {
          err.textContent = (e && e.message) || $t('Could not book that in');
          beep('err');
        }
      });
      modal.querySelector('#rpInName').focus();
    }

    root.querySelector('#rpNew').addEventListener('click', intakeDialog);
    root.querySelector('#rpWarranty').addEventListener('click', () => openWarrantyLookup(''));
    root.querySelector('#rpCsv')?.addEventListener('click', () => exportCsv('repairs', { title: 'Repairs', ...repairsCsv(rows) }));
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { query = search.value.trim(); nextCursor = ''; load(); }, 250);
    });

    paintFilters();
    await load();
  },
};
