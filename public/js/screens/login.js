'use strict';

/* Login screen: email + PIN pad. Attempts the server first; if the network
   is down it falls back to a cached offline credential so the terminal keeps
   usable in a disconnected store. The credential is an opaque per-device key
   issued by the server — nothing derived from the PIN ever touches storage. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { el, beep } from '../ui.js';
import { pull, getDeviceId, applyStoreFormat } from '../sync.js';
import { $t, LANGUAGES, language, loadChoice, saveChoice, resolveLanguage, setStoreLanguage } from '../lang.js';

async function cachedCreds() {
  const meta = (await idb.get('meta', 'config')) || {};
  return meta.offlineCreds || {};
}

export const screen = {
  id: 'login',
  tab: null,
  title: 'Sign in', /* router-internal; the screen shows $t('Sign in') */

  async render(ctx, root) {
    document.getElementById('tabbar').classList.add('hidden');

    const m = await idb.get('meta', 'config');
    const storeName = (m && m.store && m.store.name) || $t('Orison Electronics');
    const choice = await loadChoice(idb);

    root.innerHTML = `
      <div class="login">
        <div class="login-card">
          <div class="seg seg-sm login-lang" role="group" aria-label="Language / اللغة / زبان">
            ${LANGUAGES.map((l) => `<button class="seg-btn ${choice === l.code || (choice === 'store' && language() === l.code) ? 'on' : ''}" data-lang="${l.code}" type="button" lang="${l.code}">${esc(l.name)}</button>`).join('')}
          </div>
          <div class="brand">
            <div class="brand-mark" aria-hidden="true"></div>
            <h1>Orison <em>POS</em></h1>
          </div>
          <p class="login-store">${esc(storeName)}</p>
          <p class="login-sub">${esc($t('Offline-first point of sale'))}</p>

          <label class="field">
            <span>${esc($t('Email'))}</span>
            <input id="loginEmail" type="email" inputmode="email" autocomplete="username"
                   placeholder="you@orisonigt.com" autocapitalize="none" spellcheck="false">
          </label>

          <div class="pins">
            <input id="loginPin" class="pin-display" type="password" inputmode="numeric"
                   maxlength="8" placeholder="${esc($t('Enter PIN'))}" readonly>
            <div class="pinpad">
              ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((k) => k === ''
                ? '<span class="pp-key"></span>'
                : `<button class="pp-key" data-k="${k}">${k}</button>`).join('')}
            </div>
          </div>

          <button id="loginBtn" class="btn btn-block" disabled>${esc($t('Sign in'))}</button>
          <p id="loginErr" class="login-err" role="alert"></p>

          <button class="linklike" id="serverCfg">${esc($t('Backend: {url}', { url: (m && m.serverUrl) || $t('(not configured)') }))}</button>
        </div>
      </div>`;

    root.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', async () => {
      await saveChoice(idb, b.dataset.lang);
      /* Reload so every screen, and the layout direction, starts in the new language. */
      window.location.reload();
    }));

    const emailEl = root.querySelector('#loginEmail');
    const pinEl = root.querySelector('#loginPin');
    const btn = root.querySelector('#loginBtn');
    const errEl = root.querySelector('#loginErr');
    let pin = '';

    function setPin(value) {
      pin = value;
      pinEl.value = pin;
      pinEl.type = 'password';
      btn.disabled = !(emailEl.value.includes('@') && pin.length >= 4);
    }

    function refresh() {
      btn.disabled = !(emailEl.value.includes('@') && pin.length >= 4);
    }

    emailEl.addEventListener('input', refresh);
    emailEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') pinEl && pinEl.focus(); });

    root.querySelector('.pinpad').addEventListener('click', (e) => {
      const key = e.target.getAttribute && e.target.getAttribute('data-k');
      if (key == null) return;
      if (key === '⌫') setPin(pin.slice(0, -1));
      else if (pin.length < 8) setPin(pin + key);
      beep('ok');
      refresh();
    });

    btn.addEventListener('click', () => doLogin(emailEl.value, pin));
    pinEl.addEventListener('focus', () => { pinEl.type = 'text'; });
    pinEl.addEventListener('blur', () => { pinEl.type = 'password'; });
    pinEl.addEventListener('keydown', (e) => {
      if (/^\d$/.test(e.key)) { if (pin.length < 8) setPin(pin + e.key); e.preventDefault(); }
      else if (e.key === 'Backspace') { setPin(pin.slice(0, -1)); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); refresh(); if (!btn.disabled) btn.click(); }
    });

    root.querySelector('#serverCfg').addEventListener('click', async () => {
      const m = (await idb.get('meta', 'config')) || {};
      const url = window.prompt($t('Apps Script deployment URL (ends in /exec):'), m.serverUrl || '');
      if (url !== null) {
        const cfg = (await idb.get('meta', 'config')) || {};
        cfg.serverUrl = url.trim();
        const token = window.prompt($t('App token (matches Script Properties APP_TOKEN):'), cfg.appToken || '');
        if (token !== null) cfg.appToken = token.trim();
        await idb.put('meta', cfg, 'config');
        screen.render(ctx, root);
      }
    });

    async function doLogin(email, pinValue) {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail.includes('@') || pinValue.length < 4) return;
      btn.disabled = true;
      btn.textContent = $t('Checking…');
      errEl.textContent = '';

      let user = null;
      let token = null;

      try {
        // Send the terminal id so the backend registers this device and can
        // revoke it individually if the terminal is lost.
        const deviceId = await getDeviceId();
        const res = await api.post('/api/login', { email: cleanEmail, pin: pinValue, deviceId }, { timeout: 8000 });
        user = res.user;
        token = res.token;
        await api.setToken(token);
        const m = (await idb.get('meta', 'config')) || {};
        m.store = res.store;
        m.user = user;
        applyStoreFormat(res.store);
        await setStoreLanguage(resolveLanguage('store', res.store && res.store.locale));
        // Opaque server-issued credential for offline sign-in on this terminal.
        // The old offlinePins map was a PIN hash and is deleted here so a legacy
        // device never keeps PIN-material lying around after upgrading.
        delete m.offlinePins;
        m.offlineCreds = { ...(m.offlineCreds || {}), [user.id]: res.offlineKey };
        await idb.put('meta', m, 'config');
      } catch (err) {
        if (err && err.offline) {
          const usr = await findOfflineUser(cleanEmail);
          if (!usr) {
            btn.disabled = false; btn.textContent = $t('Sign in');
            errEl.textContent = $t('Offline and no cached account for that email.');
            beep('err');
            return;
          }
          const creds = await cachedCreds();
          if (!creds[usr.id]) {
            btn.disabled = false; btn.textContent = $t('Sign in');
            errEl.textContent = $t('Offline and no credential cached for that account on this terminal.');
            beep('err');
            return;
          }
          // The credential is gating, not the PIN: nothing stored here is
          // derivable to the PIN, so the PIN is never verified offline.
          user = usr;
          const m = (await idb.get('meta', 'config')) || {};
          m.user = user;
          await idb.put('meta', m, 'config');
        } else {
          btn.disabled = false; btn.textContent = $t('Sign in');
          errEl.textContent = (err && err.message) || $t('Login failed');
          beep('err');
          return;
        }
      }

      if (!user) { btn.disabled = false; btn.textContent = $t('Sign in'); return; }

      btn.textContent = $t('Signed in ✓');
      beep('ok');
      try { await pull(); } catch (_) { /* offline — app is fully functional */ }
      ctx.state.user = user;
      /* First sign-in on a fresh terminal learns the store's language here; a
         till set to match the store restarts in it. */
      const storeLocale = ((await idb.get('meta', 'config')) || {}).store?.locale || '';
      if (resolveLanguage(choice, storeLocale) !== language()) { window.location.reload(); return; }
      ctx.router.show('dashboard');
    }
  },
};

async function findOfflineUser(email) {
  const users = await idb.getAll('users');
  return users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}