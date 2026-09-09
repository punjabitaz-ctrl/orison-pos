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
        <div class="set-row"><span>Tax rate</span><span>${m.store.taxRate != null ? `${m.store.taxRate}%` : '0%'}</span></div>
        ${(user && user.role === 'admin') ? `
        <div class="set-row">
          <span>Sales tax % (admin)</span>
          <span class="set-inline">
            <input id="taxRate" type="number" inputmode="decimal" min="0" max="100" step="0.01" value="${m.store.taxRate != null ? m.store.taxRate : 0}" style="width:6em">
            <button class="btn btn-sm" id="saveTax">Save</button>
          </span>
        </div>` : ''}
      </section>` : ''}

      ${(user && user.role === 'admin') ? `
      <section class="set-card">
        <h3>Security</h3>
        <p class="muted">Manage a staff member's terminals. Find the lost device — compare Terminal ID with Settings → Terminal ID on each device — and revoke just that one, or kill every session.</p>
        <div class="field">
          <span>Staff email</span>
          <input id="secEmail" type="email" placeholder="staff@example.com" autocapitalize="none" spellcheck="false">
        </div>
        <div class="row"><button class="btn" id="listDevicesBtn">List terminals</button></div>
        <div id="deviceList"></div>
        <div class="row"><button class="btn btn-danger" id="revokeAllBtn">Revoke all sessions</button></div>
        <p id="secMsg" class="muted" role="status"></p>
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

    root.querySelector('#saveTax')?.addEventListener('click', async () => {
      const rate = parseFloat(root.querySelector('#taxRate').value);
      if (isNaN(rate) || rate < 0 || rate > 100) { toast('Tax rate must be between 0 and 100', 'warn'); return; }
      try {
        await api.post('/api/admin/store', { taxRate: rate });
        await pull();
        toast('Tax rate saved', 'ok'); beep('ok');
      } catch (err) {
        toast((err && (err.data && err.data.error)) || (err && err.message) || 'Save failed', 'warn');
      }
      redraw();
    });

    const secEmail = () => root.querySelector('#secEmail');
    const secMsg = () => root.querySelector('#secMsg');
    const deviceList = () => root.querySelector('#deviceList');

    async function listDevices(email) {
      const res = await api.post('/api/admin/devices', { email });
      const list = deviceList();
      if (!res.devices.length) {
        list.innerHTML = '<p class="muted">No registered terminals for that account yet.</p>';
        secMsg().textContent = '';
        return;
      }
      list.innerHTML = res.devices.map((d) => `
        <div class="set-row">
          <span>
            <code>${esc(d.deviceId.slice(0, 8).toUpperCase())}</code>
            <span class="muted"> · last seen ${d.lastSeen ? esc(new Date(d.lastSeen).toLocaleString()) : 'never'}</span>
            ${d.revoked ? '<span class="tag-bad">revoked</span>' : ''}
          </span>
          ${d.revoked ? '' : `<button class="btn btn-sm btn-danger" data-dev="${esc(d.deviceId)}">Revoke</button>`}
        </div>`).join('');
      list.querySelectorAll('button[data-dev]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await api.post('/api/admin/revoke-device', { email, deviceId: btn.dataset.dev });
            secMsg().textContent = `Revoked terminal ${btn.dataset.dev.slice(0, 8).toUpperCase()}. It will be forced to sign in again.`;
            beep('ok');
            await listDevices(email);
          } catch (err) {
            secMsg().textContent = (err && (err.data && err.data.error)) || (err && err.message) || 'Revoke failed';
            beep('err');
          }
        });
      });
    }

    root.querySelector('#listDevicesBtn')?.addEventListener('click', async () => {
      const email = secEmail().value.trim().toLowerCase();
      if (!email.includes('@')) { secMsg().textContent = 'Enter a valid staff email.'; return; }
      try {
        await listDevices(email);
      } catch (err) {
        secMsg().textContent = (err && (err.data && err.data.error)) || (err && err.message) || 'List failed';
        beep('err');
      }
    });

    root.querySelector('#revokeAllBtn')?.addEventListener('click', async () => {
      const email = secEmail().value.trim().toLowerCase();
      if (!email.includes('@')) { secMsg().textContent = 'Enter a valid staff email.'; return; }
      if (!window.confirm(`Revoke ALL sessions for ${email}?`)) return;
      try {
        await api.post('/api/admin/revoke', { email });
        secMsg().textContent = `All sessions revoked for ${email}. They must sign in again on every device.`;
        beep('ok');
        await listDevices(email);
      } catch (err) {
        secMsg().textContent = (err && (err.data && err.data.error)) || (err && err.message) || 'Revoke failed';
        beep('err');
      }
    });

    root.querySelector('#signoutBtn').addEventListener('click', async () => {
      if (!window.confirm('Sign out of this terminal?')) return;
      // Revoke this terminal's token server-side so a lost device can't keep
      // using it; best-effort (offline sign-out still clears locally).
      try { await api.post('/api/logout', {}); } catch (_) {}
      await api.clearToken();
      const mm = (await idb.get('meta', 'config')) || {};
      delete mm.user;
      await idb.put('meta', mm, 'config');
      state.user = null;
      router.show('login');
    });
  },
};