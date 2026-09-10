'use strict';

/* First-run store setup: language, country, currency, and the cash ladder the
   till will be counted against.

   This runs once, for an admin, on a workbook nobody has configured yet — and
   is reachable afterwards from Settings. It matters more than it looks: the
   currency chosen here decides what every receipt, report and export prints,
   and the ladder decides what a counted drawer is worth, so a store left on
   the default would reconcile its takings against the wrong notes. */

import { api } from '../api.js';
import { esc, toast, beep, openModal, closeModal, skeleton, denomLabel, setMoneyFormat } from '../ui.js';
import { applyStoreFormat } from '../sync.js';
import { idb } from '../db.js';

/* Common shop languages, kept short on purpose: this is the formatting locale,
   not a translation of the interface. */
const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'ar', name: 'العربية' },
  { code: 'de', name: 'Deutsch' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'sw', name: 'Kiswahili' },
  { code: 'ur', name: 'اردو' },
  { code: 'ja', name: '日本語' },
];

const COUNTRIES = [
  { code: 'US', name: 'United States', currency: 'USD', lang: 'en' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', lang: 'en' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', lang: 'en' },
  { code: 'CA', name: 'Canada', currency: 'CAD', lang: 'en' },
  { code: 'AU', name: 'Australia', currency: 'AUD', lang: 'en' },
  { code: 'IE', name: 'Ireland', currency: 'EUR', lang: 'en' },
  { code: 'DE', name: 'Germany', currency: 'EUR', lang: 'de' },
  { code: 'FR', name: 'France', currency: 'EUR', lang: 'fr' },
  { code: 'ES', name: 'Spain', currency: 'EUR', lang: 'es' },
  { code: 'PT', name: 'Portugal', currency: 'EUR', lang: 'pt' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', lang: 'pt' },
  { code: 'MX', name: 'Mexico', currency: 'MXN', lang: 'es' },
  { code: 'IN', name: 'India', currency: 'INR', lang: 'hi' },
  { code: 'PK', name: 'Pakistan', currency: 'PKR', lang: 'ur' },
  { code: 'PH', name: 'Philippines', currency: 'PHP', lang: 'en' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', lang: 'en' },
  { code: 'KE', name: 'Kenya', currency: 'KES', lang: 'sw' },
  { code: 'GH', name: 'Ghana', currency: 'GHS', lang: 'en' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', lang: 'ar' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', lang: 'ar' },
  { code: 'JP', name: 'Japan', currency: 'JPY', lang: 'ja' },
];

function localeTag(lang, country) {
  return `${lang || 'en'}-${country || 'US'}`;
}

export async function openStoreSetup({ store, firstRun = false, onSaved } = {}) {
  const current = store || {};
  const modal = openModal(`
    <div class="form-modal store-setup">
      <h3>${firstRun ? 'Set up this store' : 'Store &amp; localisation'}</h3>
      <p class="muted">${firstRun
        ? 'Choose the language, country and currency this shop trades in. Every receipt, report and drawer count follows this — you can change it later in Settings.'
        : 'Language, country and currency for every figure this store prints, and the notes and coins its till is counted in.'}</p>
      <div id="ssBody">${skeleton('rows', 3)}</div>
      <p id="ssErr" class="login-err"></p>
      <div class="row">
        ${firstRun ? '' : '<button class="btn btn-ghost" data-cancel>Cancel</button>'}
        <button class="btn" id="ssSave" disabled>Save</button>
      </div>
    </div>`);

  const body = modal.querySelector('#ssBody');
  const err = modal.querySelector('#ssErr');
  const saveBtn = modal.querySelector('#ssSave');
  const cancel = modal.querySelector('[data-cancel]');
  if (cancel) cancel.addEventListener('click', closeModal);

  let currencies = [];
  try {
    const cfg = await api.get('/api/config');
    currencies = cfg.currencies || [];
  } catch (e) {
    body.innerHTML = '';
    err.textContent = 'Could not reach the backend — store setup needs a connection.';
    return;
  }

  const state = {
    lang: String(current.locale || 'en-US').split('-')[0] || 'en',
    country: current.country || 'US',
    currency: current.currency || 'USD',
    denoms: (current.denoms && current.denoms.length ? current.denoms.slice() : null),
  };
  if (!state.denoms) state.denoms = defaultsFor(state.currency);

  function defaultsFor(code) {
    const hit = currencies.find((c) => c.code === code);
    return hit ? hit.denoms.slice() : [100, 50, 20, 10, 5, 1];
  }

  function preview() {
    /* Show the choice in the choice's own terms: install the format, render,
       then put the terminal's live format back so the screen behind the dialog
       does not flicker into a currency nobody has saved yet. */
    const before = setMoneyFormat({});
    setMoneyFormat({ locale: localeTag(state.lang, state.country), currency: state.currency });
    const sample = { total: denomLabel(1234.5), ladder: state.denoms.map(denomLabel) };
    setMoneyFormat(before);
    return sample;
  }

  function render() {
    const sample = preview();
    body.innerHTML = `
      <div class="two fields-row">
        <div class="field"><span>Language</span>
          <select id="ssLang">
            ${LANGUAGES.map((l) => `<option value="${esc(l.code)}" ${l.code === state.lang ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><span>Country</span>
          <select id="ssCountry">
            ${COUNTRIES.map((c) => `<option value="${esc(c.code)}" ${c.code === state.country ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field"><span>Currency</span>
        <select id="ssCurrency">
          ${currencies.map((c) => `<option value="${esc(c.code)}" ${c.code === state.currency ? 'selected' : ''}>${esc(c.code)} — ${esc(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="ss-preview">
        <span>A price will read</span><strong>${esc(sample.total)}</strong>
      </div>
      <div class="field">
        <span>Notes and coins the till is counted in</span>
        <input id="ssDenoms" type="text" inputmode="decimal" value="${esc(state.denoms.join(', '))}"
               autocomplete="off" spellcheck="false">
      </div>
      <div class="ss-ladder">${sample.ladder.map((l) => `<span class="chip-static">${esc(l)}</span>`).join('')}</div>
      <p class="muted">Only these amounts are counted at close of shift, so they must match the cash the drawer actually holds. Change the currency to reset them.</p>`;

    body.querySelector('#ssLang').addEventListener('change', (e) => {
      state.lang = e.target.value;
      render();
    });
    body.querySelector('#ssCountry').addEventListener('change', (e) => {
      state.country = e.target.value;
      const hit = COUNTRIES.find((c) => c.code === state.country);
      if (hit) {
        state.currency = hit.currency;
        state.denoms = defaultsFor(state.currency);
        if (!current.locale) state.lang = hit.lang;
      }
      render();
    });
    body.querySelector('#ssCurrency').addEventListener('change', (e) => {
      state.currency = e.target.value;
      state.denoms = defaultsFor(state.currency);
      render();
    });
    body.querySelector('#ssDenoms').addEventListener('change', (e) => {
      const parsed = String(e.target.value).split(/[,\s]+/)
        .map((v) => Number(v))
        .filter((v) => isFinite(v) && v > 0);
      if (parsed.length) {
        state.denoms = [...new Set(parsed)].sort((a, b) => b - a);
        err.textContent = '';
      } else {
        err.textContent = 'Enter at least one positive amount, separated by commas.';
      }
      render();
    });
    saveBtn.disabled = false;
  }

  saveBtn.addEventListener('click', async () => {
    err.textContent = '';
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const saved = await api.post('/api/admin/store', {
        locale: localeTag(state.lang, state.country),
        country: state.country,
        currency: state.currency,
        denoms: state.denoms,
      });
      const m = (await idb.get('meta', 'config')) || {};
      m.store = saved;
      await idb.put('meta', m, 'config');
      applyStoreFormat(saved);
      closeModal();
      toast('Store settings saved', 'ok');
      beep('ok');
      if (onSaved) await onSaved(saved);
    } catch (e) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      err.textContent = (e && e.data && e.data.error) || e.message;
    }
  });

  render();
}
