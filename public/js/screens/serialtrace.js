'use strict';

import { $t, $tn, N_ } from '../lang.js';

/* Serial / IMEI lifecycle trace (v1.53.0): every leg a serial has walked —
   the intake (PO or trade-in) it came in with, the sales that carried it,
   refunds that brought it back into stock, repair tickets filed against that
   exact device, and trade-ins where the store bought it back. One IMEI query,
   ordered server-side from the ledger into an immutable timeline of steps.
   This screen is a read-only view into that timeline — it never mutates. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { screenHead, sectionHead, dataTable } from '../components.js';
import { statusLabel } from './repairs.js';
import { fmt, esc, toast } from '../ui.js';

export function stepLabel(s) {
  switch (s.kind) {
    case 'intake': return N_('Intake');
    case 'sale': return N_('Sale');
    case 'restock': return N_('Refunded & restocked');
    case 'repair': return N_('Repair');
    case 'tradein': return N_('Trade-in bought back');
    default: return N_('Step');
  }
}

function stepChip(kind) {
  const cls = kind === 'sale' ? 'gp' : kind === 'restock' ? 'warn-text' : kind === 'repair' ? '' : kind === 'tradein' ? '' : 'muted';
  const chip = kind === 'intake' ? 'muted' : cls;
  return `<span class="chip-static ${chip}">${esc($t(stepLabel(kind)))}</span>`;
}

export const screen = {
  id: 'serialtrace',
  tab: 'serialtrace',
  title: 'Serial Trace',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const { state } = ctx;
    const user = state.user || (await idb.get('meta', 'config'))?.user || {};
    if ((user.role || 'cashier') !== 'admin' && (user.role || 'cashier') !== 'manager') {
      root.innerHTML = `<div class="empty"><p>${$t('Managers and admins only.')}</p></div>`;
      return;
    }

    let q = '';
    let data = null;
    let searching = false;
    let traced = '';
    let error = null;

    function money(v) { return v == null ? '' : fmt(v); }
    function date(v) {
      if (!v) return $t('—');
      const d = new Date(v);
      return isNaN(d) ? $t('—') : d.toLocaleDateString();
    }

    async function search() {
      const needle = q.trim();
      if (needle.length < 3) {
        toast($t('Enter at least three characters of the IMEI or serial.'), 'warn');
        return;
      }
      searching = true;
      error = null;
      data = null;
      traced = needle;
      draw();
      try {
        const res = await api.get(`/api/serials/trace?q=${encodeURIComponent(needle)}`);
        data = res;
      } catch (err) {
        error = err && !err.offline ? $t('Trace failed') : $t('Offline — trace needs the server');
      }
      searching = false;
      draw();
    }

    function stepRow(s, i) {
      const idx = i + 1;
      const detail = [];
      if (s.kind === 'sale') {
        detail.push(`<div class="muted">${$t('Sale')} #${esc(s.receipt || '')} · ${esc(s.customer || '')}</div>`);
        detail.push(`<div class="num">${money(s.money)}</div>`);
      } else if (s.kind === 'restock') {
        detail.push(`<div class="muted">${$t('Refunded & restocked')} · ${esc(s.customer || '')}</div>`);
        detail.push(`<div class="num">${money(s.money)}</div>`);
      } else if (s.kind === 'repair') {
        detail.push(`<div class="muted">${$t('Repair')} ${esc(s.ticket || '')} · ${esc(statusLabel(s.repaired))}</div>`);
        detail.push(`<div class="num">${esc(s.issue || '')}</div>`);
      } else if (s.kind === 'tradein') {
        detail.push(`<div class="muted">${$t('Buy-back from')} ${esc(s.seller || '')}</div>`);
        detail.push(`<div class="num">${money(s.money)}</div>`);
      } else if (s.kind === 'intake') {
        detail.push(`<div class="muted">${$t(s.source === 'tradein' ? 'Taken in on trade-in' : 'Received via PO')}</div>`);
        detail.push(`<div class="num">${money(s.money)}</div>`);
      }
      return `
        <tr>
          <td class="num muted">${idx}</td>
          <td>${stepChip(s.kind)}</td>
          <td>${date(s.date)}</td>
          <td>${detail[0] || '<span class="muted">—</span>'}</td>
          <td>${detail[1] || '<span class="muted">—</span>'}</td>
        </tr>`;
    }

    function draw() {
      root.innerHTML = `
        ${screenHead({
          title: $t('Serial Trace'),
          sub: $t('One IMEI or serial, its whole life in one timeline.'),
        })}

        <section class="dash-section">
          ${sectionHead({ title: $t('Search'), asideHtml: '' })}
          <div class="row gap">
            <input class="field grow" id="stInput" type="search" placeholder="${$t('IMEI / serial number, at least three characters…')}" value="${esc(q)}" autocomplete="off">
            <button class="btn btn-primary" id="stGo">${esc($t('Trace'))}</button>
          </div>
          <p class="muted st-hint">${$t('Intake, sales, refunds, repairs and trade-ins — any leg that touched this serial is listed oldest to newest.')}</p>
        </section>

        ${searching ? `<div class="empty"><p>${$t('Loading…')}</p></div>` : error ? `<div class="empty"><p>${error}</p></div>` : data ? `
        ${data.found ? `
        <section class="dash-section">
          ${sectionHead({
            title: $t('Serial'),
            asideHtml: `<span class="muted">${esc(data.query)}</span>`,
          })}
          ${dataTable({
            head: [
              { label: $t('IMEI / serial') },
              { label: $t('Product') },
              { label: $t('Status') },
            ],
            bodyHtml: `
              <tr>
                <td><b>${esc(data.serial.serialNumber)}</b></td>
                <td>${esc(data.serial.productName || '')}</td>
                <td>${stepChip(data.serial.status === 'IN_STOCK' ? 'intake' : data.serial.status === 'SOLD' ? 'sale' : data.serial.status)}</td>
              </tr>`,
          })}
        </section>

        <section class="dash-section">
          ${sectionHead({ title: $t('Lifecycle'), asideHtml: `<span class="muted">${esc($tn('{n} step', '{n} steps', data.steps.length))}</span>` })}
          ${data.steps.length ? dataTable({
            head: [
              { label: $t('#'), num: true },
              { label: $t('Step') },
              { label: $t('Date') },
              { label: $t('Detail') },
              { label: $t('Value'), num: true },
            ],
            bodyHtml: data.steps.map(stepRow).join(''),
          }) : `<p class="empty">${$t('No lifecycle recorded yet — the intake is missing its stamp, or this serial is brand new.')}</p>`}
        </section>` : `
        <div class="empty"><p>${$t('No serial found for')} <b>${esc(traced)}</b>.</p></div>`}
        ` : ''}`;

      const go = () => {
        const input = root.querySelector('#stInput');
        if (input) q = input.value;
        search();
      };
      root.querySelector('#stGo')?.addEventListener('click', go);
      const input = root.querySelector('#stInput');
      if (input) {
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        input.focus();
        let t;
        input.addEventListener('input', () => {
          clearTimeout(t);
          t = setTimeout(() => { q = input.value; }, 200);
        });
      }
    }

    draw();
  },
};