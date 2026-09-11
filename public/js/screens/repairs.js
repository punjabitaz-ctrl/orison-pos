'use strict';

/* Repairs — the bench book.

   A customer hands over a device; this is where it lives until they get it
   back. The part that matters to the rest of the system is that fitting a part
   takes it off the shelf here and now, so the on-hand figure keeps describing
   what is physically in the building.

   Collection is deliberately not a status anyone can pick. A repair is
   collected by invoicing it, which is v1.32.0's job — otherwise a job could be
   marked collected without any money changing hands. */

import { api } from '../api.js';
import { idb } from '../db.js';
import { fmt, esc, toast, beep, skeleton, emptyState, openModal, closeModal } from '../ui.js';
import { screenHead, sectionHead, dataTable } from '../components.js';

export const REPAIR_FLOW = [
  { id: 'intake', label: 'Booked in', tone: 'new' },
  { id: 'diagnosed', label: 'Diagnosed', tone: 'work' },
  { id: 'awaiting_parts', label: 'Awaiting parts', tone: 'wait' },
  { id: 'in_progress', label: 'On the bench', tone: 'work' },
  { id: 'ready', label: 'Ready', tone: 'good' },
  { id: 'collected', label: 'Collected', tone: 'done' },
  { id: 'unrepairable', label: 'Unrepairable', tone: 'bad' },
  { id: 'cancelled', label: 'Cancelled', tone: 'bad' },
  { id: 'voided', label: 'Voided', tone: 'bad' },
];

const CLOSED = new Set(['collected', 'cancelled', 'unrepairable', 'voided']);
const OPEN_ORDER = ['intake', 'diagnosed', 'awaiting_parts', 'in_progress', 'ready'];

export function statusLabel(id) {
  const hit = REPAIR_FLOW.find((s) => s.id === id);
  if (hit) return hit.label;
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
  return isNaN(d) ? String(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function pill(status) {
  return `<span class="rp-pill rp-${esc(statusTone(status))}">${esc(statusLabel(status))}</span>`;
}

export const screen = {
  id: 'repairs',
  tab: 'repairs',
  title: 'Repairs',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const { state } = ctx;
    const isAdmin = String((state.user || {}).role) === 'admin';

    let status = '';
    let query = '';
    let rows = [];
    let matched = 0;
    let nextCursor = '';
    let openId = '';

    root.innerHTML = `
      ${screenHead({
    title: 'Repairs',
    sub: 'Devices in for repair',
    actions: '<button class="btn" id="rpNew" type="button">Book in a repair</button>',
  })}
      <div class="seg seg-sm rp-filters" id="rpFilters"></div>
      <div class="field"><input id="rpSearch" type="search" placeholder="Ticket number, customer, phone or IMEI…" autocomplete="off" spellcheck="false"></div>
      <div id="rpBody">${skeleton('table', 5)}</div>
      <div id="rpDetail"></div>`;

    const body = root.querySelector('#rpBody');
    const detail = root.querySelector('#rpDetail');
    const filters = root.querySelector('#rpFilters');
    const search = root.querySelector('#rpSearch');

    const FILTERS = [{ id: '', label: 'Open' }].concat(
      REPAIR_FLOW.filter((s) => s.id !== 'voided').map((s) => ({ id: s.id, label: s.label })),
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
        body.innerHTML = emptyState({ title: 'Could not load repairs', body: (e && e.message) || '' });
      }
    }

    function paint() {
      if (!rows.length) {
        body.innerHTML = emptyState({
          title: query ? 'Nothing matches that' : 'No repairs here',
          body: query ? 'Try the ticket number, the customer, or the IMEI.' : 'Book one in to get started.',
        });
        return;
      }
      const bodyHtml = rows.map((r) => `
        <tr class="rp-row" data-open="${esc(r.id)}">
          <td><strong>${esc(r.ticketNo)}</strong><br><span class="muted">${esc(when(r.createdAt))}</span></td>
          <td>${esc(r.device || '—')}<br><span class="muted">${esc(r.reportedFault.slice(0, 60))}</span></td>
          <td>${esc(r.customerName || r.customerPhone || '—')}</td>
          <td>${pill(r.status)}</td>
          <td class="num">${esc(fmt(r.total))}</td>
        </tr>`).join('');

      body.innerHTML = dataTable({
        head: [{ label: 'Ticket' }, { label: 'Device' }, { label: 'Customer' }, { label: 'Status' }, { label: 'Total', num: true }],
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
        detail.innerHTML = emptyState({ title: 'Could not open that ticket', body: (e && e.message) || '' });
        return;
      }

      const moves = nextStatuses(t.status);
      const partsHtml = t.parts.length
        ? dataTable({
          head: [{ label: 'Part' }, { label: 'Qty', num: true }, { label: 'Price', num: true }, { label: '' }],
          bodyHtml: t.parts.map((p, i) => `
            <tr>
              <td>${esc(p.name)}${p.serialNumber ? `<br><span class="muted">${esc(p.serialNumber)}</span>` : ''}</td>
              <td class="num">${esc(p.quantity)}</td>
              <td class="num">${esc(fmt(p.unitPrice))}</td>
              <td>${CLOSED.has(t.status) ? '' : `<button class="cl-remove" data-drop-part="${i}" aria-label="Remove">✕</button>`}</td>
            </tr>`).join(''),
        })
        : '<p class="muted">Nothing fitted yet.</p>';

      const labourHtml = t.labour.length
        ? dataTable({
          head: [{ label: 'Work' }, { label: 'Amount', num: true }, { label: '' }],
          bodyHtml: t.labour.map((l, i) => `
            <tr>
              <td>${esc(l.description)}</td>
              <td class="num">${esc(fmt(l.amount))}</td>
              <td>${CLOSED.has(t.status) ? '' : `<button class="cl-remove" data-drop-lab="${i}" aria-label="Remove">✕</button>`}</td>
            </tr>`).join(''),
        })
        : '<p class="muted">No labour yet.</p>';

      detail.innerHTML = `
        <div class="card rp-detail">
          ${sectionHead({ title: t.ticketNo, asideHtml: pill(t.status) })}
          <div class="rp-grid">
            <div><span class="muted">Device</span><strong>${esc(t.device || '—')}</strong></div>
            <div><span class="muted">IMEI / serial</span><strong>${esc(t.deviceSerial || '—')}</strong></div>
            <div><span class="muted">Customer</span><strong>${esc(t.customerName || '—')}</strong></div>
            <div><span class="muted">Phone</span><strong>${esc(t.customerPhone || '—')}</strong></div>
          </div>
          <p><span class="muted">Reported fault</span><br>${esc(t.reportedFault)}</p>
          ${t.conditionNote ? `<p><span class="muted">Condition at intake</span><br>${esc(t.conditionNote)}</p>` : ''}
          ${t.accessories ? `<p><span class="muted">Left with it</span><br>${esc(t.accessories)}</p>` : ''}

          ${sectionHead({ title: 'Parts', asideHtml: CLOSED.has(t.status) ? '' : '<button class="btn btn-sm" id="rpAddPart" type="button">Fit a part</button>' })}
          ${partsHtml}

          ${sectionHead({ title: 'Labour', asideHtml: CLOSED.has(t.status) ? '' : '<button class="btn btn-sm" id="rpAddLab" type="button">Add labour</button>' })}
          ${labourHtml}

          <div class="rp-total"><span>Total so far</span><strong>${esc(fmt(t.total))}</strong></div>

          ${moves.length ? `
            <div class="field"><span>Move this job to</span>
              <div class="seg seg-sm" id="rpMoves">
                ${moves.map((m) => `<button class="seg-btn" data-move="${esc(m)}" type="button">${esc(statusLabel(m))}</button>`).join('')}
              </div>
            </div>` : '<p class="muted">This ticket is closed.</p>'}

          ${isAdmin && !CLOSED.has(t.status) ? '<button class="btn btn-ghost btn-danger" id="rpVoid" type="button">Void this ticket</button>' : ''}
        </div>`;

      detail.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => move(t, b.dataset.move)));
      detail.querySelectorAll('[data-drop-part]').forEach((b) => b.addEventListener('click', () => dropPart(t.id, Number(b.dataset.dropPart))));
      detail.querySelectorAll('[data-drop-lab]').forEach((b) => b.addEventListener('click', () => dropLabour(t.id, Number(b.dataset.dropLab))));
      const ap = detail.querySelector('#rpAddPart');
      if (ap) ap.addEventListener('click', () => partDialog(t.id));
      const al = detail.querySelector('#rpAddLab');
      if (al) al.addEventListener('click', () => labourDialog(t.id));
      const vd = detail.querySelector('#rpVoid');
      if (vd) vd.addEventListener('click', () => voidDialog(t));
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async function move(t, to) {
      const ending = to === 'cancelled' || to === 'unrepairable';
      if (ending && !window.confirm(
        `Mark ${t.ticketNo} as ${statusLabel(to).toLowerCase()}? Every fitted part goes back into stock, and the ticket closes for good.`)) return;
      try {
        const res = await api.post('/api/repairs/status', { id: t.id, status: to });
        toast(res.returned
          ? `${statusLabel(to)} — ${res.returned} part(s) back in stock`
          : statusLabel(to), 'ok');
        beep('ok');
        await openTicket(t.id);
        await load();
      } catch (e) {
        toast((e && e.message) || 'Could not move that ticket', 'err');
        beep('err');
      }
    }

    async function dropPart(id, index) {
      try {
        await api.post('/api/repairs/parts', { id, removeIndex: index });
        toast('Part returned to stock', 'ok');
        await openTicket(id);
      } catch (e) { toast((e && e.message) || 'Could not remove that part', 'err'); }
    }

    async function dropLabour(id, index) {
      try {
        await api.post('/api/repairs/labour', { id, removeIndex: index });
        await openTicket(id);
      } catch (e) { toast((e && e.message) || 'Could not remove that line', 'err'); }
    }

    function partDialog(id) {
      const modal = openModal(`
        <div class="form-modal">
          <h3>Fit a part</h3>
          <div class="field"><span>Find the part</span>
            <input id="rpPartQ" type="search" placeholder="Name, SKU or barcode…" autocomplete="off"></div>
          <div id="rpPartHits" class="cust-results"></div>
          <p id="rpPartErr" class="login-err"></p>
          <div class="row"><button class="btn btn-ghost" data-cancel type="button">Cancel</button></div>
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
            ${esc(p.name)}<em class="muted">${esc(p.sku || '')} · ${esc(p.onHand)} on hand</em>
          </button>`).join('') || '<p class="muted">Nothing matches.</p>';
        hits.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', async () => {
          const p = found.find((x) => x.id === b.dataset.pick);
          if (!p) return;
          let serialNumber = '';
          if (p.isSerialized) {
            serialNumber = String(window.prompt(`Which ${p.name}? Enter the serial.`) || '').trim();
            if (!serialNumber) return;
          }
          try {
            await api.post('/api/repairs/parts', {
              id, add: [{ productId: p.id, quantity: 1, unitPrice: p.retailPrice, serialNumber }],
            });
            closeModal();
            toast('Part fitted and taken off the shelf', 'ok');
            beep('ok');
            await openTicket(id);
          } catch (e) {
            err.textContent = (e && e.message) || 'Could not fit that part';
            beep('err');
          }
        }));
      });
      q.focus();
    }

    function labourDialog(id) {
      const modal = openModal(`
        <div class="form-modal">
          <h3>Add labour</h3>
          <div class="field"><span>What was done</span>
            <input id="rpLabDesc" placeholder="e.g. Screen fit and calibration" autocomplete="off"></div>
          <div class="field"><span>Amount</span>
            <input id="rpLabAmt" type="number" min="0" step="0.01" value="0"></div>
          <p id="rpLabErr" class="login-err"></p>
          <div class="row">
            <button class="btn btn-ghost" data-cancel type="button">Cancel</button>
            <button class="btn" id="rpLabSave" type="button">Add</button>
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
        } catch (e) { err.textContent = (e && e.message) || 'Could not add that line'; }
      });
      modal.querySelector('#rpLabDesc').focus();
    }

    function voidDialog(t) {
      const modal = openModal(`
        <div class="form-modal">
          <h3>Void ${esc(t.ticketNo)}</h3>
          <p class="muted">Use this only for a ticket that should never have existed — a duplicate, or a mis-entry. A customer who changed their mind is a <strong>cancel</strong>, not a void. Any fitted parts go back into stock.</p>
          <div class="field"><span>Why</span><input id="rpVoidWhy" placeholder="e.g. Entered twice" autocomplete="off"></div>
          <p id="rpVoidErr" class="login-err"></p>
          <div class="row">
            <button class="btn btn-ghost" data-cancel type="button">Keep it</button>
            <button class="btn btn-danger" id="rpVoidGo" type="button">Void</button>
          </div>
        </div>`);
      const err = modal.querySelector('#rpVoidErr');
      modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
      modal.querySelector('#rpVoidGo').addEventListener('click', async () => {
        try {
          await api.post('/api/repairs/void', { id: t.id, reason: modal.querySelector('#rpVoidWhy').value.trim() });
          closeModal();
          detail.innerHTML = '';
          toast('Ticket voided', 'ok');
          await load();
        } catch (e) { err.textContent = (e && e.message) || 'Could not void that ticket'; }
      });
    }

    function intakeDialog() {
      const modal = openModal(`
        <div class="form-modal">
          <h3>Book in a repair</h3>
          <div class="two fields-row">
            <div class="field"><span>Customer name</span><input id="rpInName" autocomplete="off"></div>
            <div class="field"><span>Phone</span><input id="rpInPhone" autocomplete="off"></div>
          </div>
          <div class="two fields-row">
            <div class="field"><span>Make</span><input id="rpInMake" placeholder="Apple" autocomplete="off"></div>
            <div class="field"><span>Model</span><input id="rpInModel" placeholder="iPhone 13" autocomplete="off"></div>
          </div>
          <div class="field"><span>IMEI / serial</span><input id="rpInSerial" autocomplete="off"></div>
          <div class="field"><span>What is wrong with it</span><textarea id="rpInFault" rows="2"></textarea></div>
          <div class="field"><span>Condition at intake</span><textarea id="rpInCond" rows="2" placeholder="Scratches, dents, cracked back — anything you would not want to be blamed for"></textarea></div>
          <div class="field"><span>Left with it</span><input id="rpInAcc" placeholder="Case, charger, SIM tray" autocomplete="off"></div>
          <p id="rpInErr" class="login-err"></p>
          <div class="row">
            <button class="btn btn-ghost" data-cancel type="button">Cancel</button>
            <button class="btn" id="rpInSave" type="button">Book it in</button>
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
          toast(`Booked in as ${res.ticketNo}`, 'ok');
          beep('ok');
          await load();
          await openTicket(res.id);
        } catch (e) {
          err.textContent = (e && e.message) || 'Could not book that in';
          beep('err');
        }
      });
      modal.querySelector('#rpInName').focus();
    }

    root.querySelector('#rpNew').addEventListener('click', intakeDialog);
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { query = search.value.trim(); nextCursor = ''; load(); }, 250);
    });

    paintFilters();
    await load();
  },
};
