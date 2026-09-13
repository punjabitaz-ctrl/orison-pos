'use strict';

/* Warranty (v1.41.0): 1 year for brand-new hardware, 30 days otherwise, none
   for a service. The days are captured on the sale line, so a lookup by IMEI or
   receipt shows what the customer was actually sold. */

import { api } from './api.js';
import { esc, openModal, closeModal } from './ui.js';
import { $t, N_, dateLocale } from './lang.js';

export const WARRANTY_OPTIONS = [
  { days: 365, label: N_('1 year — brand-new hardware') },
  { days: 30, label: N_('30 days') },
  { days: 0, label: N_('No warranty') },
];

const STATUS = {
  active: { label: N_('Under warranty'), cls: 'tag-ok' },
  expired: { label: N_('Warranty expired'), cls: 'tag-bad' },
  refunded: { label: N_('Refunded — no warranty'), cls: 'tag-warn' },
};

export function warrantyOptionsHtml(selected) {
  return WARRANTY_OPTIONS.map((o) => `<option value="${o.days}" ${Number(selected) === o.days ? 'selected' : ''}>${esc($t(o.label))}</option>`).join('');
}

export function periodLabel(days) {
  const d = Number(days) || 0;
  if (d >= 365) return $t('1 year');
  if (d > 0) return $t('30 days');
  return $t('No warranty');
}

function shortDate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString(dateLocale(), { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}

export function statusChip(status, untilIso) {
  const s = STATUS[status];
  if (!s) return '';
  const when = status === 'refunded' ? '' : ` · ${status === 'active' ? $t('until {date}', { date: shortDate(untilIso) }) : $t('ended {date}', { date: shortDate(untilIso) })}`;
  return `<span class="tag ${s.cls}">${esc($t(s.label) + when)}</span>`;
}

/* The counter question: "is this still under warranty?" By IMEI or receipt. */
export function openWarrantyLookup(initial) {
  const m = openModal(`
    <div class="form-modal wr-lookup">
      <h3>${$t('Check warranty')}</h3>
      <div class="field"><span>${$t('IMEI, serial or receipt number')}</span>
        <input id="wrQ" type="search" autocomplete="off" spellcheck="false" value="${esc(initial || '')}"></div>
      <div id="wrOut" class="wr-out"></div>
      <div class="row"><button class="btn btn-ghost" data-cancel type="button">${$t('Close')}</button><button class="btn" id="wrGo" type="button">${$t('Check')}</button></div>
    </div>`);
  const out = m.querySelector('#wrOut');
  const q = m.querySelector('#wrQ');
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  const run = async () => {
    const query = q.value.trim();
    if (query.length < 4) { out.innerHTML = `<p class="muted">${$t('Type at least four characters to look up a sale')}</p>`; return; }
    out.innerHTML = `<p class="muted">${$t('Loading…')}</p>`;
    try {
      const res = await api.get('/api/warranty?q=' + encodeURIComponent(query));
      const matches = (res.matches || []).filter((x) => x.lines.length);
      if (!matches.length) {
        out.innerHTML = `<p class="muted">${$t('No warranty found — this was not sold here, or it was sold without one.')}</p>`;
        return;
      }
      out.innerHTML = matches.map((x) => `
        <div class="wr-sale">
          <p class="muted">${esc(x.receiptNo || x.clientTxId)} · ${esc(shortDate(x.soldAt))}${x.customer ? ' · ' + esc(x.customer) : ''}</p>
          ${x.lines.map((l) => `
            <div class="wr-line">
              <div><strong>${esc(l.name)}</strong>${l.serialNumber ? `<br><span class="muted">${esc(l.serialNumber)}</span>` : ''}
                <br><span class="muted">${esc(periodLabel(l.warrantyDays))}</span></div>
              <div>${statusChip(l.status, l.expiresAt)}</div>
            </div>`).join('')}
        </div>`).join('');
    } catch (e) {
      out.innerHTML = `<p class="login-err">${esc((e && e.message) || $t('Could not check the warranty'))}</p>`;
    }
  };
  m.querySelector('#wrGo').addEventListener('click', run);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  if (initial) run();
  return m;
}
