'use strict';

/* Settings: session, sync health, server endpoint, sign out. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { esc, toast, beep } from '../ui.js';
import { getSyncState, syncNow, push, pull, setServerUrl, setAppToken, setSyncInterval, outboxStats } from '../sync.js';

export const screen = {
  id: 'settings',
  tab: 'settings',
  title: 'Settings',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const { state, router } = ctx;

    const syncState = await getSyncState();
    const stats = await outboxStats();
    const m = (await idb.get('meta', 'config')) || {};
    const user = state.user || m.user;

    async function redraw() {
      screen.render(ctx, root);
    }

    root.innerHTML = `
      <header class="scr-head">
        <div class="scr-title">
          <h2>Settings</h2>
          <p>Terminal &amp; account</p>
        </div>
      </header>

      <section class="set-card">
        <div class="set-user">
          <div class="avatar">${esc((user && (user.firstName || '?'))[0] || '?')}</div>
          <div>
            <strong>${esc(user ? `${user.firstName} ${user.lastName || ''}` : 'Not signed in')}</strong>
            <p class="muted">${esc(user ? ((user.email || '') + ' · ' + (user.role || 'cashier')) : '')}</p>
          </div>
        </div>
      </section>

      <section class="set-card">
        <h3>Sync</h3>
        <div class="set-row"><span>Terminal ID</span><code>${esc(syncState.deviceId || '—')}</code></div>
        <div class="set-row"><span>Last sync</span><span>${esc(syncState.lastSyncAt ? new Date(syncState.lastSyncAt).toLocaleString() : 'never')}</span></div>
        <div class="set-row"><span>Network</span><span class="${navigator.onLine ? 'tag-ok' : 'tag-bad'}">${navigator.onLine ? 'Online' : 'Offline'}</span></div>
        <div class="set-row"><span>Queued to send</span><span class="${stats.pending ? 'tag-warn' : ''}">${stats.pending}</span></div>
        <div class="set-row"><span>Synced</span><span>${stats.synced}</span></div>
        <div class="set-row"><span>Voided (server-rejected)</span><span>${stats.voided}</span></div>
        <div class="field">
          <span>Offline sync window (minutes) — sales sync instantly when online</span>
          <input id="syncMin" type="number" min="1" max="1440" value="${Number(m.syncIntervalMin || 30)}" autocomplete="off">
        </div>
        <div class="row"><button class="btn" id="syncNowBtn">Sync now</button></div>
      </section>

      <section class="set-card">
        <h3>Backend</h3>
        <div class="field">
          <span>Apps Script deployment URL (ends in /exec)</span>
          <input id="serverUrl" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(m.serverUrl || '')}"
                 autocapitalize="off" autocorrect="off" spellcheck="false">
        </div>
        <div class="field">
          <span>App token (matches Script Properties APP_TOKEN)</span>
          <input id="appToken" type="text" placeholder="shared app token" value="${esc(m.appToken || '')}"
                 autocapitalize="off" autocorrect="off" spellcheck="false">
        </div>
        <div class="row"><button class="btn" id="saveUrl">Save &amp; reconnect</button></div>
      </section>

      ${m.store ? `
      <section class="set-card">
        <h3>Store</h3>
        <div class="set-row"><span>Name</span><span>${esc(m.store.name)}</span></div>
        <div class="set-row"><span>Code</span><span>${esc(m.store.code)}</span></div>
        <div class="set-row"><span>Address</span><span>${esc(m.store.address || '—')}</span></div>
      </section>` : ''}

      <section class="set-card set-about">
        <p>Orison POS · offline-first PWA<br>Backend: Google Apps Script + Sheets + Drive · protocol v1</p>
        <p class="muted">Install from the browser menu — works fully offline after first sync.</p>
      </section>

      <button class="btn btn-block btn-danger" id="signoutBtn">Sign out</button>`;

    root.querySelector('#syncNowBtn').addEventListener('click', async () => {
      root.querySelector('#syncNowBtn').disabled = true;
      root.querySelector('#syncNowBtn').textContent = 'Syncing…';
      await setSyncInterval(Number(root.querySelector('#syncMin').value || 30));
      const res = await syncNow();
      root.querySelector('#syncNowBtn').disabled = false;
      root.querySelector('#syncNowBtn').textContent = 'Sync now';
      redraw();
      if (res && res.offline) toast('Offline — queued locally', 'warn');
    });

    root.querySelector('#saveUrl').addEventListener('click', async () => {
      const url = root.querySelector('#serverUrl').value.trim();
      const token = root.querySelector('#appToken').value.trim();
      await setServerUrl(url);
      await setAppToken(token);
      try {
        await pull();
        toast('Connected', 'ok'); beep('ok');
      } catch (_) {
        toast('Backend unreachable — will retry once online', 'warn');
      }
      redraw();
    });

    root.querySelector('#signoutBtn').addEventListener('click', async () => {
      if (!window.confirm('Sign out of this terminal?')) return;
      await api.clearToken();
      const mm = (await idb.get('meta', 'config')) || {};
      delete mm.user;
      await idb.put('meta', mm, 'config');
      state.user = null;
      router.show('login');
    });
  },
};