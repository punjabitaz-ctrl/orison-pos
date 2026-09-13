'use strict';

import { $t, N_, dateLocale } from '../lang.js';

/* Trade-ins: the shop buys a used device from a customer.

   The device joins stock under its IMEI at exactly what was paid for it, and
   the seller is paid in cash or store credit. Anyone at the counter can take
   one in; a cashier needs a manager's approval for the amount, the same way a
   refund works. Managers also see the register of everything bought in.

   Needs the server: whether an IMEI is already in stock is a whole-shop
   question, and a device must never be bought twice. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { screenHead } from '../components.js';
import { fmt, esc, toast, beep, openModal, closeModal } from '../ui.js';
import { pull } from '../sync.js';

export const CONDITIONS = [
  { id: 'like_new', label: N_('Like new') },
  { id: 'good', label: N_('Good') },
  { id: 'fair', label: N_('Fair') },
  { id: 'faulty', label: N_('Faulty') },
];

export const ID_TYPES = [
  { id: 'driving_licence', label: N_('Driving licence') },
  { id: 'passport', label: N_('Passport') },
  { id: 'national_id', label: N_('National ID') },
  { id: 'other', label: N_('Other ID') },
];

const PAID_BY = { cash: N_('Cash'), store_credit: N_('Store credit') };

function labelOf(list, id) {
  const hit = list.find((x) => x.id === id);
  return hit ? $t(hit.label) : id;
}

/* What the form must have before it goes to the server. Pure, so it is tested. */
export function tradeInProblem(f) {
  if (!f.customer) return N_('Pick the seller, or add them as a customer');
  if (!f.product) return N_('Pick the product the device goes into');
  if (!String(f.serialNumber || '').trim()) return N_('Enter the device IMEI or serial number');
  if (!f.condition) return N_('Pick the device condition');
  if (!(Number(f.amount) > 0)) return N_('Enter what the shop is paying for it');
  if (!f.idType) return N_('Record the ID that was checked');
  const ref = String(f.idRef || '').replace(/\s+/g, '');
  if (ref.length < 2 || ref.length > 6) return N_('Enter the last 2 to 6 characters of the ID - not the whole number');
  return '';
}

export const screen = {
  id: 'tradein',
  tab: 'tradein',
  title: 'Trade-In',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const user = ctx.state.user || (await idb.get('meta', 'config'))?.user || {};
    const isManager = user.role === 'admin' || user.role === 'manager';
    let rows = null;
    let q = '';

    async function load() {
      if (!isManager) return;
      try {
        rows = (await api.get('/api/tradeins' + (q ? '?q=' + encodeURIComponent(q) : ''))).tradeIns || [];
      } catch (err) {
        rows = [];
        toast((err && !err.offline) ? (err.message || $t('Could not load trade-ins')) : $t('Offline — trade-ins need the server'), 'warn');
      }
      drawList();
    }

    root.innerHTML = `
      ${screenHead({ title: $t('Trade-In'), sub: $t('Buy a used device from a customer') })}
      <section class="dash-section ti-intro">
        <p class="muted">${$t('The device goes into stock at what you pay for it, and is resold with 30 days of warranty. The seller is paid in cash or store credit.')}</p>
        <button class="btn" id="tiNew">${$t('Buy a device')}</button>
      </section>
      ${isManager ? `
      <section class="dash-section">
        <h3>${$t('Trade-in register')}</h3>
        <div class="field"><input id="tiSearch" type="search" placeholder="${$t('Number, seller, IMEI or product…')}" autocomplete="off" spellcheck="false"></div>
        <div id="tiList"><p class="muted">${$t('Loading…')}</p></div>
      </section>` : ''}`;

    function drawList() {
      const el = root.querySelector('#tiList');
      if (!el) return;
      if (!rows || !rows.length) { el.innerHTML = `<p class="empty">${$t('No trade-ins yet.')}</p>`; return; }
      const loc = dateLocale();
      el.innerHTML = `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>${$t('Date')}</th><th>${$t('Device')}</th><th>${$t('Seller')}</th><th>${$t('Condition')}</th><th class="num">${$t('Paid')}</th><th>${$t('Status')}</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${esc(new Date(r.createdAt).toLocaleDateString(loc))}<br><span class="muted">${esc(r.tradeInNo)}</span></td>
          <td>${esc(r.productName)}<br><span class="muted">${esc(r.serialNumber)}</span></td>
          <td>${esc(r.sellerName)}<br><span class="muted">${esc(labelOf(ID_TYPES, r.idType))} ···${esc(r.idRef)}</span></td>
          <td>${esc(labelOf(CONDITIONS, r.condition))}${r.notes ? `<br><span class="muted">${esc(r.notes)}</span>` : ''}</td>
          <td class="num">${fmt(r.amount)}<br><span class="muted">${esc($t(PAID_BY[r.paidBy] || r.paidBy))}</span></td>
          <td><span class="tag ${r.inStock ? 'tag-ok' : ''}">${r.inStock ? $t('In stock') : $t('Sold on')}</span></td>
        </tr>`).join('')}</tbody></table></div>`;
    }

    root.querySelector('#tiNew').addEventListener('click', () => openTradeInDialog(ctx, user, () => load()));
    const search = root.querySelector('#tiSearch');
    if (search) {
      let d = null;
      search.addEventListener('input', () => { clearTimeout(d); d = setTimeout(() => { q = search.value.trim(); load(); }, 300); });
    }
    await load();
  },
};

export function openTradeInDialog(ctx, user, onDone) {
  const isManager = user.role === 'admin' || user.role === 'manager';
  const f = { customer: null, product: null, serialNumber: '', condition: '', amount: '', paidBy: 'cash', idType: '', idRef: '', notes: '' };
  let products = [];

  const modal = openModal(`
    <div class="form-modal ti-form">
      <h3>${$t('Buy a device')}</h3>

      <div class="field"><span>${$t('Seller')}</span>
        <div id="tiCustPicked"></div>
        <input id="tiCust" type="search" placeholder="${$t('Search customers by name or phone…')}" autocomplete="off" spellcheck="false">
        <div id="tiCustResults" class="cust-results"></div>
      </div>

      <div class="two fields-row">
        <div class="field"><span>${$t('ID checked')}</span>
          <select id="tiIdType"><option value="">${$t('Choose…')}</option>${ID_TYPES.map((t) => `<option value="${t.id}">${esc($t(t.label))}</option>`).join('')}</select>
        </div>
        <div class="field"><span>${$t('ID ends in')}</span>
          <input id="tiIdRef" maxlength="6" autocomplete="off" spellcheck="false" placeholder="${$t('e.g. 4821')}">
        </div>
      </div>

      <div class="field"><span>${$t('Goes into product')}</span>
        <div id="tiProdPicked"></div>
        <input id="tiProd" type="search" placeholder="${$t('Products tracked by IMEI…')}" autocomplete="off" spellcheck="false">
        <div id="tiProdResults" class="cust-results"></div>
      </div>

      <div class="two fields-row">
        <div class="field"><span>${$t('IMEI / serial')}</span>
          <input id="tiSerial" autocomplete="off" spellcheck="false" inputmode="numeric">
        </div>
        <div class="field"><span>${$t('Condition')}</span>
          <select id="tiCond"><option value="">${$t('Choose…')}</option>${CONDITIONS.map((c) => `<option value="${c.id}">${esc($t(c.label))}</option>`).join('')}</select>
        </div>
      </div>

      <div class="field"><span>${$t('Notes')}</span>
        <input id="tiNotes" maxlength="300" autocomplete="off" placeholder="${$t('e.g. cracked back, battery 86%')}">
      </div>

      <div class="two fields-row">
        <div class="field"><span>${$t('Paying')}</span>
          <input id="tiAmount" type="number" min="0" step="0.01" inputmode="decimal">
        </div>
        <div class="field"><span>${$t('Paid as')}</span>
          <div class="seg seg-sm" id="tiPaid">
            ${Object.keys(PAID_BY).map((k) => `<button type="button" class="seg-btn ${k === f.paidBy ? 'on' : ''}" data-paid="${k}">${esc($t(PAID_BY[k]))}</button>`).join('')}
          </div>
        </div>
      </div>

      <p id="tiErr" class="login-err" role="alert"></p>
      <div class="row">
        <button class="btn btn-ghost" data-cancel type="button">${$t('Cancel')}</button>
        <button class="btn" id="tiSave" type="button">${$t('Buy it')}</button>
      </div>
    </div>`);

  const err = modal.querySelector('#tiErr');
  const $ = (sel) => modal.querySelector(sel);

  idb.getAll('products').then((all) => {
    products = (all || []).filter((p) => p.isSerialized && p.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  });

  function paintPicked() {
    $('#tiCustPicked').innerHTML = f.customer ? `<div class="ti-picked"><b>${esc(f.customer.name)}</b> <button type="button" class="link" data-unpick="customer">${$t('Change')}</button></div>` : '';
    $('#tiCust').hidden = !!f.customer;
    $('#tiProdPicked').innerHTML = f.product ? `<div class="ti-picked"><b>${esc(f.product.name)}</b> <span class="muted">${esc(f.product.sku || '')}</span> <button type="button" class="link" data-unpick="product">${$t('Change')}</button></div>` : '';
    $('#tiProd').hidden = !!f.product;
    modal.querySelectorAll('[data-unpick]').forEach((b) => b.addEventListener('click', () => { f[b.dataset.unpick] = null; paintPicked(); }));
  }

  let cd = null;
  $('#tiCust').addEventListener('input', () => {
    clearTimeout(cd);
    const q = $('#tiCust').value.trim();
    const out = $('#tiCustResults');
    if (!q) { out.innerHTML = ''; return; }
    cd = setTimeout(async () => {
      let matches = [];
      try { matches = (await api.get('/api/customers?q=' + encodeURIComponent(q))).customers || []; } catch (_) {}
      out.innerHTML = matches.map((c) => `<button type="button" class="cust-row" data-id="${esc(c.id)}" data-name="${esc(c.name)}">${esc(c.name)}<em class="muted">${esc(c.phone || c.email || '')}</em></button>`).join('')
        + `<button type="button" class="cust-row cust-new" data-create="1" data-name="${esc(q)}">＋ ${esc($t('New customer: {name}', { name: q }))}</button>`;
    }, 300);
  });
  $('#tiCustResults').addEventListener('click', async (e) => {
    const btn = e.target.closest('.cust-row');
    if (!btn) return;
    if (btn.dataset.create) {
      try {
        const res = await api.post('/api/admin/customers', { name: btn.dataset.name });
        f.customer = { id: res.customer.id, name: res.customer.name };
      } catch (_) { toast($t('Could not add customer'), 'warn'); return; }
    } else {
      f.customer = { id: btn.dataset.id, name: btn.dataset.name };
    }
    $('#tiCustResults').innerHTML = '';
    $('#tiCust').value = '';
    paintPicked();
  });

  $('#tiProd').addEventListener('input', () => {
    const q = $('#tiProd').value.trim().toLowerCase();
    const out = $('#tiProdResults');
    if (!q) { out.innerHTML = ''; return; }
    const hits = products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)).slice(0, 8);
    out.innerHTML = hits.map((p) => `<button type="button" class="cust-row" data-pick="${esc(p.id)}">${esc(p.name)}<em class="muted">${esc(p.sku || '')}</em></button>`).join('')
      || `<p class="muted">${$t('No product tracked by IMEI matches. Add one in Products first.')}</p>`;
  });
  $('#tiProdResults').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    f.product = products.find((p) => p.id === btn.dataset.pick) || null;
    $('#tiProdResults').innerHTML = '';
    $('#tiProd').value = '';
    paintPicked();
  });

  modal.querySelectorAll('[data-paid]').forEach((b) => b.addEventListener('click', () => {
    f.paidBy = b.dataset.paid;
    modal.querySelectorAll('[data-paid]').forEach((x) => x.classList.toggle('on', x.dataset.paid === f.paidBy));
  }));
  modal.querySelector('[data-cancel]').addEventListener('click', closeModal);

  $('#tiSave').addEventListener('click', async () => {
    f.serialNumber = $('#tiSerial').value.trim();
    f.condition = $('#tiCond').value;
    f.amount = $('#tiAmount').value;
    f.idType = $('#tiIdType').value;
    f.idRef = $('#tiIdRef').value.trim();
    f.notes = $('#tiNotes').value.trim();
    const problem = tradeInProblem(f);
    if (problem) { err.textContent = $t(problem); beep('err'); return; }
    err.textContent = '';
    const amount = Math.round(Number(f.amount) * 100) / 100;
    const payload = {
      customerId: f.customer.id, productId: f.product.id, serialNumber: f.serialNumber, condition: f.condition,
      notes: f.notes, amount, paidBy: f.paidBy, idType: f.idType, idRef: f.idRef,
    };
    /* a cashier buys with a manager's approval, bound to this IMEI and amount */
    if (!isManager) {
      const { requestApproval } = await import('../approval-dialog.js');
      payload.ref = f.serialNumber + '|' + Date.now().toString(36);
      const granted = await requestApproval({
        action: 'tradein', ref: payload.ref, amount,
        detail: $t('{amount} for {device} · {serial}', { amount: fmt(amount), device: f.product.name, serial: f.serialNumber }),
      });
      if (!granted) return;
      payload.approval = granted.approval;
    }
    const save = $('#tiSave');
    save.disabled = true;
    try {
      const res = await api.post('/api/tradein', payload);
      closeModal();
      toast(res.paidBy === 'cash'
        ? $t('{no}: pay {amount} from the drawer', { no: res.tradeInNo, amount: fmt(res.amount) })
        : $t('{no}: {amount} store credit for {name}', { no: res.tradeInNo, amount: fmt(res.amount), name: res.customer.name }), 'ok', 5000);
      beep('ok');
      pull().catch(() => {});
      if (onDone) await onDone(res);
    } catch (e) {
      save.disabled = false;
      err.textContent = (e && e.offline) ? $t('Offline — trade-ins need the server') : ((e && e.message) || $t('Could not record the trade-in'));
    }
  });

  paintPicked();
  $('#tiCust').focus();
  return modal;
}
