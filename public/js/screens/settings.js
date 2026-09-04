'use strict';

/* Settings: session, sync health, server endpoint, sign out. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { esc, toast, beep } from '../ui.js';
import { getSyncState, syncNow, push, pull, setServerUrl, outboxStats } from '../sync.js';

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
        <div class="row"><button class="btn" id="syncNowBtn">Sync now</button></div>
      </section>

      <section class="set-card">
        <h3>Server</h3>
        <div class="field">
          <span>API server URL (blank = this device)</span>
          <input id="serverUrl" type="url" placeholder="http://192.168.1.50:8080" value="${esc(m.serverUrl || '')}"
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
        <p>Orison POS · offline-first PWA<br>Edge server: Fastify + SQLite · sync protocol v1</p>
        <p class="muted">Install from the browser menu — works fully offline after first sync.</p>
      </section>

      <button class="btn btn-block btn-danger" id="signoutBtn">Sign out</button>`;

    root.querySelector('#syncNowBtn').addEventListener('click', async () => {
      root.querySelector('#syncNowBtn').disabled = true;
      root.querySelector('#syncNowBtn').textContent = 'Syncing…';
      const res = await syncNow();
      root.querySelector('#syncNowBtn').disabled = false;
      root.querySelector('#syncNowBtn').textContent = 'Sync now';
      redraw();
      if (res && res.offline) toast('Offline — queued locally', 'warn');
    });

    root.querySelector('#saveUrl').addEventListener('click', async () => {
      const url = root.querySelector('#serverUrl').value.trim();
      await setServerUrl(url);
      try {
        await pull();
        toast('Connected', 'ok'); beep('ok');
      } catch (_) {
        toast('Server unreachable — will retry once online', 'warn');
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