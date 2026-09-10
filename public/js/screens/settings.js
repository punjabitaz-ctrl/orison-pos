'use strict';

/* Settings: session, sync health, server endpoint, sign out. */

import { idb } from '../db.js';
import { api } from '../api.js';
import { esc, toast, beep, fmt, denomLabel } from '../ui.js';
import { openModal, closeModal } from '../ui.js';
import { getSyncState, syncNow, push, pull, setServerUrl, setAppToken, setSyncInterval, outboxStats } from '../sync.js';
import { displayEnabled, setDisplayEnabled, openDisplay, publishIdle } from '../customer-display.js';

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
        <h3>Customer display</h3>
        <p class="muted">Mirror the cart on a second screen facing the shopper. Item names, quantities, prices and the amount due only — never cost, margin or customer records.</p>
        <label class="check"><input id="cdOn" type="checkbox" ${displayEnabled() ? 'checked' : ''}> Mirror this terminal</label>
        <div class="row"><button class="btn" id="cdOpen">Open display window</button></div>
        <p id="cdMsg" class="muted" role="status"></p>
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
        <div class="set-row"><span>Language &amp; country</span><span>${esc(m.store.locale || 'en-US')} · ${esc(m.store.country || 'US')}</span></div>
        <div class="set-row"><span>Currency</span><span>${esc(m.store.currency || 'USD')} · sample ${fmt(1234.5)}</span></div>
        <div class="set-row"><span>Till counts</span><span>${esc(((m.store.denoms || []).map(denomLabel).join(', ')) || '—')}</span></div>
        ${(user && user.role === 'admin') ? `
        <div class="row"><button class="btn btn-ghost btn-sm" id="storeSetupBtn">Language, country &amp; currency</button></div>` : ''}
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

      ${(user && user.role === 'admin') ? `
      <section class="set-card">
        <h3>Staff</h3>
        <p class="muted">Add staff, reset a forgotten PIN, or deactivate a leaver. A new PIN is set by the admin here — hand it over, then the staff member changes it on their own terminal.</p>
        <div class="row"><button class="btn" id="addStaffBtn">Add staff</button><button class="btn btn-ghost" id="reloadStaffBtn">Reload</button></div>
        <div id="staffList" class="muted">Loading…</div>
      </section>` : ''}

      <section class="set-card">
        <h3>Change PIN</h3>
        <p class="muted">Rotate your sign-in PIN. All terminals — including this one — are signed out, so sign back in with the new PIN.</p>
        <div class="field">
          <span>Current PIN</span>
          <input id="pinCurrent" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
        </div>
        <div class="field">
          <span>New PIN (6 digits)</span>
          <input id="pinNew" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
        </div>
        <div class="row"><button class="btn" id="changePinBtn">Change PIN</button></div>
        <p id="pinMsg" class="muted" role="status"></p>
      </section>

      <section class="set-card set-about">
        <p>Orison POS · offline-first PWA<br>Backend: Google Apps Script + Sheets + Drive · protocol v1</p>
        <p class="muted">Install from the browser menu — works fully offline after first sync.</p>
      </section>

      <button class="btn btn-block btn-danger" id="signoutBtn">Sign out</button>`;

    root.querySelector('#storeSetupBtn')?.addEventListener('click', async () => {
      const { openStoreSetup } = await import('./store-setup.js');
      openStoreSetup({ store: m.store, firstRun: false, onSaved: () => redraw() });
    });

    root.querySelector('#cdOn').addEventListener('change', (e) => {
      setDisplayEnabled(e.target.checked);
      const msg = root.querySelector('#cdMsg');
      if (e.target.checked) {
        publishIdle((state.store && state.store.name) || '');
        msg.textContent = 'Mirroring on. Open the display window on the customer-facing screen.';
      } else {
        msg.textContent = 'Mirroring off — any open display goes back to the welcome screen.';
      }
    });

    root.querySelector('#cdOpen').addEventListener('click', async () => {
      const msg = root.querySelector('#cdMsg');
      if (!displayEnabled()) {
        setDisplayEnabled(true);
        root.querySelector('#cdOn').checked = true;
      }
      const res = await openDisplay();
      if (!res.opened) {
        msg.textContent = 'The browser blocked the window — allow pop-ups for this site and try again.';
        toast('Pop-up blocked', 'warn');
        return;
      }
      if (res.secondScreen) msg.textContent = 'Display opened on the second screen.';
      else if (res.reason === 'single-screen') msg.textContent = 'Only one screen detected — opened here; drag it across if you attach one.';
      else msg.textContent = 'Display opened. Drag it to the customer-facing screen and full-screen it (F11).';
      publishIdle((state.store && state.store.name) || '');
    });

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

    root.querySelector('#staffList')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-staff]');
      if (!btn) return;
      const { id, email, name, act } = btn.dataset;
      if (act === 'pin') {
        const modalEl = openModal(`
          <div class="tx-detail">
            <button class="icon-btn abs-close" data-x>✕</button>
            <h3>Reset PIN for ${esc(name)}</h3>
            <p class="muted">Set a new 6-digit PIN for ${esc(email)}. They are signed out everywhere and must use this PIN on next sign-in.</p>
            <label class="field-label">New PIN
              <input class="field" id="staffPin" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="6 digits">
            </label>
            <button class="btn" id="staffPinSave">Set PIN</button>
          </div>`);
        modalEl.querySelector('[data-x]').addEventListener('click', closeModal);
        modalEl.querySelector('#staffPinSave').addEventListener('click', async () => {
          const pinVal = modalEl.querySelector('#staffPin').value.trim();
          if (!/^\d{6}$/.test(pinVal)) { toast('PIN must be exactly 6 digits', 'warn'); return; }
          const save = modalEl.querySelector('#staffPinSave');
          save.disabled = true;
          try {
            await api.post('/api/admin/pin', { email, pin: pinVal });
            closeModal();
            toast('PIN set — hand it to the staff member', 'ok', 3200); beep('ok');
          } catch (err) {
            toast((err && (err.data && err.data.error)) || (err && err.message) || 'Reset failed', 'warn');
            save.disabled = false;
          }
        });
        return;
      }
      if (act === 'toggle') {
        btn.disabled = true;
        try {
          await api.post('/api/admin/users/patch', { id, active: btn.dataset.want === '1' });
          toast(btn.dataset.want === '1' ? 'Staff re-activated' : 'Staff deactivated — signed out everywhere', 'ok');
          beep('ok');
          await loadStaff();
        } catch (err) {
          toast((err && (err.data && err.data.error)) || (err && err.message) || 'Update failed', 'warn');
          btn.disabled = false;
        }
        return;
      }
    });

    async function loadStaff() {
      const list = root.querySelector('#staffList');
      try {
        const res = await api.post('/api/admin/users/list', {});
        const me = (await idb.get('meta', 'config'))?.user;
        list.innerHTML = res.users.map((u) => `
          <div class="set-row">
            <span>
              <strong>${esc(u.firstName + ' ' + u.lastName)}</strong>
              <span class="muted"> · ${esc(u.email)} · ${esc(u.role)}</span>
              ${u.active ? '' : ' <span class="tag-bad">off</span>'}
              ${String(u.id) === String(me && me.id) ? ' <span class="tag-ok">you</span>' : ''}
            </span>
            <span class="set-inline">
              <button class="btn btn-sm" data-staff data-id="${esc(u.id)}" data-email="${esc(u.email)}" data-name="${esc(u.firstName + ' ' + u.lastName)}" data-act="pin">PIN</button>
              ${String(u.id) === String(me && me.id) ? '' : `
              <button class="btn btn-sm ${u.active ? 'btn-danger' : 'btn-ghost'}" data-staff data-id="${esc(u.id)}" data-want="${u.active ? '0' : '1'}" data-act="toggle">${u.active ? 'Off' : 'On'}</button>`}
            </span>
          </div>`).join('');
      } catch (err) {
        list.textContent = (err && (err.data && err.data.error)) || 'Could not load staff';
      }
    }

    let staffModal = null;
    root.querySelector('#addStaffBtn')?.addEventListener('click', () => {
      staffModal = openModal(`
        <div class="tx-detail">
          <button class="icon-btn abs-close" data-x>✕</button>
          <h3>Add staff</h3>
          <label class="field-label">First name
            <input class="field" id="nsFirst" autocomplete="off">
          </label>
          <label class="field-label">Last name
            <input class="field" id="nsLast" autocomplete="off">
          </label>
          <label class="field-label">Email
            <input class="field" id="nsEmail" type="email" autocapitalize="none" autocomplete="off">
          </label>
          <label class="field-label">Role
            <select class="field" id="nsRole">
              <option value="cashier">Cashier</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button class="btn" id="nsCreate">Create account</button>
          <p id="nsMsg" class="muted" role="status"></p>
        </div>`);
      staffModal.querySelector('[data-x]').addEventListener('click', closeModal);
      staffModal.querySelector('#nsCreate').addEventListener('click', async () => {
        const cMsg = staffModal.querySelector('#nsMsg');
        const cBtn = staffModal.querySelector('#nsCreate');
        const firstName = staffModal.querySelector('#nsFirst').value.trim();
        const lastName = staffModal.querySelector('#nsLast').value.trim();
        const email = staffModal.querySelector('#nsEmail').value.trim();
        const role = staffModal.querySelector('#nsRole').value;
        cBtn.disabled = true;
        try {
          const res = await api.post('/api/admin/users', { firstName, lastName, email, role });
          staffModal.innerHTML = `
            <div class="tx-detail">
              <button class="icon-btn abs-close" data-x>✕</button>
              <h3>Account created</h3>
              <p class="muted">Show this PIN once and have it changed at the terminal. It is not shown again and not stored anywhere.</p>
              <div class="staff-pin">${esc(res.oneTimePin)}</div>
              <p class="muted">${esc(email)}</p>
              <button class="btn" id="nsDone">Done</button>
            </div>`;
          staffModal.querySelector('[data-x]').addEventListener('click', closeModal);
          staffModal.querySelector('#nsDone').addEventListener('click', async () => { closeModal(); await loadStaff(); });
          beep('ok');
        } catch (err) {
          cMsg.textContent = (err && (err.data && err.data.error)) || (err && err.message) || 'Create failed';
          cBtn.disabled = false;
        }
      });
    });

    root.querySelector('#reloadStaffBtn')?.addEventListener('click', loadStaff);

    root.querySelector('#changePinBtn').addEventListener('click', async () => {
      const current = root.querySelector('#pinCurrent').value.trim();
      const next = root.querySelector('#pinNew').value.trim();
      const msg = root.querySelector('#pinMsg');
      const btn = root.querySelector('#changePinBtn');
      if (!/^\d{6}$/.test(next)) { msg.textContent = 'New PIN must be exactly 6 digits.'; return; }
      btn.disabled = true;
      try {
        await api.post('/api/pin', { currentPin: current, newPin: next });
        msg.textContent = 'PIN changed. Use it next time you sign in.';
        msg.className = 'muted';
        beep('ok');
        root.querySelector('#pinCurrent').value = '';
        root.querySelector('#pinNew').value = '';
      } catch (err) {
        msg.textContent = (err && (err.data && err.data.error)) || (err && err.message) || 'Change failed';
        msg.className = 'muted';
        beep('err');
      }
      btn.disabled = false;
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

    if (root.querySelector('#reloadStaffBtn')) await loadStaff();
  },
};