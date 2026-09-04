'use strict';

/* Login screen: email + PIN pad. Attempts the server first; if the network
   is down it falls back to a cached offline hash so the terminal keeps
   usable in a disconnected store. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { el, beep } from '../ui.js';
import { pull } from '../sync.js';

function sha256(str) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then((buf) =>
    Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
  );
}

async function cachedPins() {
  const meta = (await idb.get('meta', 'config')) || {};
  return meta.offlinePins || {};
}

export const screen = {
  id: 'login',
  tab: null,
  title: 'Sign in',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.add('hidden');

    const m = await idb.get('meta', 'config');
    const storeName = (m && m.store && m.store.name) || 'Orison Electronics';

    root.innerHTML = `
      <div class="login">
        <div class="login-card">
          <div class="brand">
            <div class="brand-mark" aria-hidden="true"></div>
            <h1>Orison <em>POS</em></h1>
          </div>
          <p class="login-store">${esc(storeName)}</p>
          <p class="login-sub">Offline-first point of sale</p>

          <label class="field">
            <span>Email</span>
            <input id="loginEmail" type="email" inputmode="email" autocomplete="username"
                   placeholder="you@orisonigt.com" autocapitalize="none" spellcheck="false">
          </label>

          <div class="pins">
            <input id="loginPin" class="pin-display" type="password" inputmode="numeric"
                   maxlength="8" placeholder="Enter PIN" readonly>
            <div class="pinpad">
              ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((k) => k === ''
                ? '<span class="pp-key"></span>'
                : `<button class="pp-key" data-k="${k}">${k}</button>`).join('')}
            </div>
          </div>

          <button id="loginBtn" class="btn btn-block" disabled>Sign in</button>
          <p id="loginErr" class="login-err" role="alert"></p>

          <button class="linklike" id="serverCfg">Server: ${esc((m && m.serverUrl) || '(this device)')}</button>
        </div>
      </div>`;

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
      const url = window.prompt('Server URL (blank = this device):', m.serverUrl || '');
      if (url !== null) {
        const cfg = (await idb.get('meta', 'config')) || {};
        cfg.serverUrl = url.trim();
        await idb.put('meta', cfg, 'config');
        this.render(ctx, root);
      }
    });

    async function doLogin(email, pinValue) {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail.includes('@') || pinValue.length < 4) return;
      btn.disabled = true;
      btn.textContent = 'Checking…';
      errEl.textContent = '';

      let user = null;
      let token = null;

      try {
        const res = await api.post('/api/login', { email: cleanEmail, pin: pinValue }, { timeout: 8000 });
        user = res.user;
        token = res.token;
        await api.setToken(token);
        const m = (await idb.get('meta', 'config')) || {};
        m.store = res.store;
        m.user = user;
        m.offlinePins = await sha256(pinValue).then((h) => ({ ...(m.offlinePins || {}), [user.id]: h }));
        await idb.put('meta', m, 'config');
      } catch (err) {
        if (err && err.offline) {
          const usr = await findOfflineUser(cleanEmail);
          if (!usr) {
            btn.disabled = false; btn.textContent = 'Sign in';
            errEl.textContent = 'Offline and no cached account for that email.';
            beep('err');
            return;
          }
          const pins = await cachedPins();
          const hash = await sha256(pinValue);
          if (pins[usr.id] !== hash) {
            btn.disabled = false; btn.textContent = 'Sign in';
            errEl.textContent = 'Incorrect PIN (offline mode).';
            beep('err');
            return;
          }
          user = usr;
          const m = (await idb.get('meta', 'config')) || {};
          m.user = user;
          await idb.put('meta', m, 'config');
        } else {
          btn.disabled = false; btn.textContent = 'Sign in';
          errEl.textContent = (err && (err.data && err.data.error)) || (err && err.message) || 'Login failed';
          beep('err');
          return;
        }
      }

      if (!user) { btn.disabled = false; btn.textContent = 'Sign in'; return; }

      btn.textContent = 'Signed in ✓';
      beep('ok');
      try { await pull(); } catch (_) { /* offline — app is fully functional */ }
      ctx.state.user = user;
      ctx.router.show('register');
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