'use strict';

import { $t, $tn, LANGUAGES, storeLanguage, loadChoice, saveChoice, dateLocale } from '../lang.js';

/* Settings: session, sync health, server endpoint, sign out. */

import { idb } from '../db.js';
import { screenHead, roleLabel } from '../components.js';
import { api } from '../api.js';
import { esc, toast, beep, fmt, denomLabel } from '../ui.js';
import { openModal, closeModal } from '../ui.js';
import { getSyncState, syncNow, push, pull, setServerUrl, setAppToken, setSyncInterval, outboxStats } from '../sync.js';
import { displayEnabled, setDisplayEnabled, openDisplay, publishIdle } from '../customer-display.js';
import { printerCardHtml, mountPrinterCard } from './printer-settings.js';

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

    const langChoice = await loadChoice(idb);

    root.innerHTML = `
      ${screenHead({ title: $t('Settings'), sub: $t('Terminal & account') })}

      <section class="set-card">
        <div class="set-user">
          <div class="avatar">${esc((user && (user.firstName || '?'))[0] || '?')}</div>
          <div>
            <strong>${esc(user ? `${user.firstName} ${user.lastName || ''}` : $t('Not signed in'))}</strong>
            <p class="muted">${esc(user ? ((user.email || '') + ' · ' + $t(roleLabel(user.role || 'cashier'))) : '')}</p>
          </div>
        </div>
      </section>

      <section class="set-card" id="langCard">
        <h3>${$t('Language')}</h3>
        <p class="muted">${esc($t('The language of this till’s screens. Receipts and the customer display use the store’s language: {name}.', { name: (LANGUAGES.find((l) => l.code === storeLanguage()) || LANGUAGES[0]).name }))}</p>
        <div class="seg seg-sm" id="langPick">
          <button class="seg-btn ${langChoice === 'store' ? 'on' : ''}" data-lang="store" type="button">${$t('Match the store')}</button>
          ${LANGUAGES.map((l) => `<button class="seg-btn ${langChoice === l.code ? 'on' : ''}" data-lang="${l.code}" lang="${l.code}" type="button">${esc(l.name)}</button>`).join('')}
        </div>
      </section>

      ${(user && user.role === 'admin') ? `
      <section class="set-card">
        <h3>${$t('Scheduled reports')}</h3>
        <p class="muted">${$t('Daily, weekly and monthly figures emailed automatically. Each report covers the period that just closed and carries the CSV.')}</p>
        <div class="field">
          <span>${$t('Send to (comma separated)')}</span>
          <input id="rsTo" type="text" placeholder="owner@example.com, books@example.com" autocapitalize="none" spellcheck="false">
        </div>
        <label class="check"><input id="rsDaily" type="checkbox"> ${$t('Daily')}</label>
        <label class="check"><input id="rsWeekly" type="checkbox"> ${$t('Weekly')}</label>
        <label class="check"><input id="rsMonthly" type="checkbox"> ${$t('Monthly')}</label>
        <div class="row">
          <button class="btn" id="rsSave">${$t('Save')}</button>
          <button class="btn btn-ghost" id="rsTest">${$t('Send one now')}</button>
        </div>
        <p id="rsMsg" class="muted" role="status"></p>
      </section>

      <section class="set-card">
        <h3>${$t('Backups')}</h3>
        <p class="muted">${$t('A copy of the whole workbook lands nightly in a Drive folder called “POS Backup”, named with the date and time. The last 30 nights and 12 months are kept.')}</p>
        <div id="bkStatus" class="muted">${$t('Checking…')}</div>
        <div class="row"><button class="btn" id="bkRun">${$t('Back up now')}</button></div>
        <p id="bkMsg" class="muted" role="status"></p>
      </section>` : ''}

      <section class="set-card">
        <h3>${$t('Customer display')}</h3>
        <p class="muted">${$t('Mirror the cart on a second screen facing the shopper. Item names, quantities, prices and the amount due only — never cost, margin or customer records.')}</p>
        <label class="check"><input id="cdOn" type="checkbox" ${displayEnabled() ? 'checked' : ''}> ${$t('Mirror this terminal')}</label>
        <div class="row"><button class="btn" id="cdOpen">${$t('Open display window')}</button></div>
        <p id="cdMsg" class="muted" role="status"></p>
      </section>

      ${printerCardHtml()}

      <section class="set-card">
        <h3>${$t('Sync')}</h3>
        <div class="set-row"><span>${$t('Terminal ID')}</span><code>${esc(syncState.deviceId || '—')}</code></div>
        <div class="set-row"><span>${$t('Last sync')}</span><span>${esc(syncState.lastSyncAt ? new Date(syncState.lastSyncAt).toLocaleString(dateLocale()) : $t('never'))}</span></div>
        <div class="set-row"><span>${$t('Network')}</span><span class="${navigator.onLine ? 'tag-ok' : 'tag-bad'}">${navigator.onLine ? $t('Online') : $t('Offline')}</span></div>
        <div class="set-row"><span>${$t('Queued to send')}</span><span class="${stats.pending ? 'tag-warn' : ''}">${stats.pending}</span></div>
        <div class="set-row"><span>${$t('Synced')}</span><span>${stats.synced}</span></div>
        <div class="set-row"><span>${$t('Voided (server-rejected)')}</span><span>${stats.voided}</span></div>
        <div class="field">
          <span>${$t('Offline sync window (minutes) — sales sync instantly when online')}</span>
          <input id="syncMin" type="number" min="1" max="1440" value="${Number(m.syncIntervalMin || 30)}" autocomplete="off">
        </div>
        <div class="row"><button class="btn" id="syncNowBtn">${$t('Sync now')}</button></div>
      </section>

      ${(user && user.role === 'admin') ? `
      <section class="set-card">
        <h3>${$t('Backend')}</h3>
        <div class="field">
          <span>${$t('Apps Script deployment URL (ends in /exec)')}</span>
          <input id="serverUrl" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(m.serverUrl || '')}"
                 autocapitalize="off" autocorrect="off" spellcheck="false">
        </div>
        <div class="field">
          <span>${$t('App token (matches Script Properties APP_TOKEN)')}</span>
          <input id="appToken" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
                 placeholder="${m.appToken ? $t('Saved — leave blank to keep it') : $t('shared app token')}">
        </div>
        <div class="row"><button class="btn" id="saveUrl">${$t('Save &amp; reconnect')}</button></div>
      </section>` : ''}

      ${m.store ? `
      <section class="set-card">
        <h3>${$t('Store')}</h3>
        <div class="set-row"><span>${$t('Name')}</span><span>${esc(m.store.name)}</span></div>
        <div class="set-row"><span>${$t('Code')}</span><span>${esc(m.store.code)}</span></div>
        <div class="set-row"><span>${$t('Address')}</span><span>${esc(m.store.address || '—')}</span></div>
        <div class="set-row"><span>${$t('Tax rate')}</span><span>${m.store.taxRate != null ? `${m.store.taxRate}%` : '0%'}</span></div>
        <div class="set-row"><span>${$t('Language &amp; country')}</span><span>${esc(m.store.locale || 'en-US')} · ${esc(m.store.country || 'US')}</span></div>
        <div class="set-row"><span>${$t('Currency')}</span><span>${esc($t('{currency} · sample {amount}', { currency: m.store.currency || 'USD', amount: fmt(1234.5) }))}</span></div>
        <div class="set-row"><span>${$t('Till counts')}</span><span>${esc(((m.store.denoms || []).map(denomLabel).join(', ')) || '—')}</span></div>
        ${(user && user.role === 'admin') ? `
        <div class="row"><button class="btn btn-ghost btn-sm" id="storeSetupBtn">${$t('Language, country &amp; currency')}</button></div>` : ''}
        ${(user && user.role === 'admin') ? `
        <div class="set-row">
          <span>${$t('Sales tax % (admin)')}</span>
          <span class="set-inline">
            <input id="taxRate" type="number" inputmode="decimal" min="0" max="100" step="0.01" value="${m.store.taxRate != null ? m.store.taxRate : 0}" style="width:6em">
            <button class="btn btn-sm" id="saveTax">${$t('Save')}</button>
          </span>
        </div>` : ''}
      </section>` : ''}

      ${(user && user.role === 'admin') ? `
      <section class="set-card">
        <h3>${$t('Security')}</h3>
        <p class="muted">${$t('Manage a staff member\'s terminals. Find the lost device — compare Terminal ID with Settings → Terminal ID on each device — and revoke just that one, or kill every session.')}</p>
        <div class="field">
          <span>${$t('Staff email')}</span>
          <input id="secEmail" type="email" placeholder="staff@example.com" autocapitalize="none" spellcheck="false">
        </div>
        <div class="row"><button class="btn" id="listDevicesBtn">${$t('List terminals')}</button></div>
        <div id="deviceList"></div>
        <div class="row"><button class="btn btn-danger" id="revokeAllBtn">${$t('Revoke all sessions')}</button></div>
        <p id="secMsg" class="muted" role="status"></p>
      </section>` : ''}

      ${(user && user.role === 'admin') ? `
      <section class="set-card">
        <h3>${$t('Staff')}</h3>
        <p class="muted">${$t('Add staff, reset a forgotten PIN, or deactivate a leaver. A new PIN is set by the admin here — hand it over, then the staff member changes it on their own terminal.')}</p>
        <div class="row"><button class="btn" id="addStaffBtn">${$t('Add staff')}</button><button class="btn btn-ghost" id="reloadStaffBtn">${$t('Reload')}</button></div>
        <div id="staffList" class="muted">${$t('Loading…')}</div>
      </section>` : ''}

      <section class="set-card">
        <h3>${$t('Change PIN')}</h3>
        <p class="muted">${$t('Rotate your sign-in PIN. All terminals — including this one — are signed out, so sign back in with the new PIN.')}</p>
        <div class="field">
          <span>${$t('Current PIN')}</span>
          <input id="pinCurrent" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
        </div>
        <div class="field">
          <span>${$t('New PIN (6 digits)')}</span>
          <input id="pinNew" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
        </div>
        <div class="row"><button class="btn" id="changePinBtn">${$t('Change PIN')}</button></div>
        <p id="pinMsg" class="muted" role="status"></p>
      </section>

      <section class="set-card set-about">
        <p>${$t('Orison POS · offline-first PWA')}<br>${$t('Backend: Google Apps Script + Sheets + Drive · protocol v1')}</p>
        <p class="muted">${$t('Install from the browser menu — works fully offline after first sync.')}</p>
      </section>

      <button class="btn btn-block btn-danger" id="signoutBtn">${$t('Sign out')}</button>`;

    root.querySelectorAll('#langPick [data-lang]').forEach((b) => b.addEventListener('click', async () => {
      await saveChoice(idb, b.dataset.lang);
      /* A reload is the honest switch: every screen and the layout direction start again in the new language. */
      window.location.reload();
    }));

    root.querySelector('#storeSetupBtn')?.addEventListener('click', async () => {
      const { openStoreSetup } = await import('./store-setup.js');
      openStoreSetup({ store: m.store, firstRun: false, onSaved: () => redraw() });
    });

    const rsSave = root.querySelector('#rsSave');
    if (rsSave) {
      const rsMsg = root.querySelector('#rsMsg');
      const paintSchedule = (st) => {
        if (!st) { rsMsg.textContent = $t('Could not read the schedule.'); return; }
        root.querySelector('#rsTo').value = (st.recipients || []).join(', ');
        root.querySelector('#rsDaily').checked = !!st.daily;
        root.querySelector('#rsWeekly').checked = !!st.weekly;
        root.querySelector('#rsMonthly').checked = !!st.monthly;
        const last = [
          st.lastDaily ? $t('daily {date}', { date: new Date(st.lastDaily).toLocaleDateString(dateLocale()) }) : '',
          st.lastWeekly ? $t('weekly {date}', { date: new Date(st.lastWeekly).toLocaleDateString(dateLocale()) }) : '',
          st.lastMonthly ? $t('monthly {date}', { date: new Date(st.lastMonthly).toLocaleDateString(dateLocale()) }) : '',
        ].filter(Boolean).join(' · ');
        rsMsg.innerHTML = last ? esc($t('Last sent: {list}', { list: last })) : esc($t('Nothing sent yet.'));
        if (st.lastError) rsMsg.innerHTML += `<br><span class="tag-bad">${esc(st.lastError)}</span>`;
      };
      api.post('/api/reports/schedule', {}).then(paintSchedule).catch(() => paintSchedule(null));

      const saveSchedule = async () => {
        rsSave.disabled = true;
        try {
          await api.post('/api/reports/schedule', { recipients: root.querySelector('#rsTo').value });
          for (const [id, cadence] of [['#rsDaily', 'daily'], ['#rsWeekly', 'weekly'], ['#rsMonthly', 'monthly']]) {
            await api.post('/api/reports/schedule', { cadence, on: root.querySelector(id).checked });
          }
          const st = await api.post('/api/reports/schedule', {});
          paintSchedule(st);
          toast($t('Schedule saved'), 'ok'); beep('ok');
        } catch (err) {
          rsMsg.textContent = (err && err.message) || $t('Could not save');
          toast($t('Could not save the schedule'), 'warn');
        }
        rsSave.disabled = false;
      };
      rsSave.addEventListener('click', saveSchedule);

      root.querySelector('#rsTest').addEventListener('click', async () => {
        rsMsg.textContent = $t('Sending…');
        try {
          const res = await api.post('/api/reports/schedule', { sendNow: 'daily' }, { timeout: 45000 });
          rsMsg.textContent = res.sent
            ? $tn('Sent to {n} recipient.', 'Sent to {n} recipients.', res.recipients)
            : $t('Nobody to send to — add a recipient and save first.');
          if (res.sent) { toast($t('Report sent'), 'ok'); beep('ok'); }
        } catch (err) {
          rsMsg.textContent = (err && err.message) || $t('Send failed');
        }
      });
    }

    const bkRun = root.querySelector('#bkRun');
    if (bkRun) {
      const bkStatus = root.querySelector('#bkStatus');
      const bkMsg = root.querySelector('#bkMsg');
      const paint = (st) => {
        if (!st) { bkStatus.textContent = $t('Could not read backup status.'); return; }
        const when = st.lastAt ? new Date(st.lastAt).toLocaleString(dateLocale()) : $t('never');
        bkStatus.innerHTML = `${esc($t('Last backup:'))} <strong>${esc(when)}</strong>${st.lastName ? ' · ' + esc(st.lastName) : ''}`;
        if (st.lastError) bkStatus.innerHTML += `<br><span class="tag-bad">${esc($t('Last failure: {reason}', { reason: st.lastError }))}</span>`;
      };
      api.get('/api/backup/status').then(paint).catch(() => paint(null));
      bkRun.addEventListener('click', async () => {
        bkRun.disabled = true;
        bkMsg.textContent = $t('Backing up…');
        try {
          const res = await api.post('/api/backup/run', {}, { timeout: 60000 });
          bkMsg.textContent = $t('Saved {name}', { name: res.name });
          toast($t('Backup saved'), 'ok'); beep('ok');
          api.get('/api/backup/status').then(paint).catch(() => {});
        } catch (err) {
          bkMsg.textContent = (err && err.message) || $t('Backup failed');
          toast($t('Backup failed'), 'warn');
        }
        bkRun.disabled = false;
      });
    }

    root.querySelector('#cdOn').addEventListener('change', (e) => {
      setDisplayEnabled(e.target.checked);
      const msg = root.querySelector('#cdMsg');
      if (e.target.checked) {
        publishIdle((state.store && state.store.name) || '');
        msg.textContent = $t('Mirroring on. Open the display window on the customer-facing screen.');
      } else {
        msg.textContent = $t('Mirroring off — any open display goes back to the welcome screen.');
      }
    });

    mountPrinterCard(root, { store: m.store || null });

    root.querySelector('#cdOpen').addEventListener('click', async () => {
      const msg = root.querySelector('#cdMsg');
      if (!displayEnabled()) {
        setDisplayEnabled(true);
        root.querySelector('#cdOn').checked = true;
      }
      const res = await openDisplay();
      if (!res.opened) {
        msg.textContent = $t('The browser blocked the window — allow pop-ups for this site and try again.');
        toast($t('Pop-up blocked'), 'warn');
        return;
      }
      if (res.secondScreen) msg.textContent = $t('Display opened on the second screen.');
      else if (res.reason === 'single-screen') msg.textContent = $t('Only one screen detected — opened here; drag it across if you attach one.');
      else msg.textContent = $t('Display opened. Drag it to the customer-facing screen and full-screen it (F11).');
      publishIdle((state.store && state.store.name) || '');
    });

    root.querySelector('#syncNowBtn').addEventListener('click', async () => {
      root.querySelector('#syncNowBtn').disabled = true;
      root.querySelector('#syncNowBtn').textContent = $t('Syncing…');
      await setSyncInterval(Number(root.querySelector('#syncMin').value || 30));
      const res = await syncNow();
      root.querySelector('#syncNowBtn').disabled = false;
      root.querySelector('#syncNowBtn').textContent = $t('Sync now');
      redraw();
      if (res && res.offline) toast($t('Offline — queued locally'), 'warn');
    });

    root.querySelector('#saveUrl')?.addEventListener('click', async () => {
      const url = root.querySelector('#serverUrl').value.trim();
      const token = root.querySelector('#appToken').value.trim();
      await setServerUrl(url);
      if (token) await setAppToken(token);
      try {
        await pull();
        toast($t('Connected'), 'ok'); beep('ok');
      } catch (_) {
        toast($t('Backend unreachable — will retry once online'), 'warn');
      }
      redraw();
    });

    root.querySelector('#saveTax')?.addEventListener('click', async () => {
      const rate = parseFloat(root.querySelector('#taxRate').value);
      if (isNaN(rate) || rate < 0 || rate > 100) { toast($t('Tax rate must be between 0 and 100'), 'warn'); return; }
      try {
        await api.post('/api/admin/store', { taxRate: rate });
        await pull();
        toast($t('Tax rate saved'), 'ok'); beep('ok');
      } catch (err) {
        toast((err && err.message) || $t('Save failed'), 'warn');
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
        list.innerHTML = `<p class="muted">${$t('No registered terminals for that account yet.')}</p>`;
        secMsg().textContent = '';
        return;
      }
      list.innerHTML = res.devices.map((d) => `
        <div class="set-row">
          <span>
            <code>${esc(d.deviceId.slice(0, 8).toUpperCase())}</code>
            <span class="muted"> · ${esc($t('last seen {when}', { when: d.lastSeen ? new Date(d.lastSeen).toLocaleString(dateLocale()) : $t('never') }))}</span>
            ${d.revoked ? `<span class="tag-bad">${$t('revoked')}</span>` : ''}
          </span>
          ${d.revoked ? '' : `<button class="btn btn-sm btn-danger" data-dev="${esc(d.deviceId)}">${$t('Revoke')}</button>`}
        </div>`).join('');
      list.querySelectorAll('button[data-dev]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await api.post('/api/admin/revoke-device', { email, deviceId: btn.dataset.dev });
            secMsg().textContent = $t('Revoked terminal {id}. It will be forced to sign in again.', { id: btn.dataset.dev.slice(0, 8).toUpperCase() });
            beep('ok');
            await listDevices(email);
          } catch (err) {
            secMsg().textContent = (err && err.message) || $t('Revoke failed');
            beep('err');
          }
        });
      });
    }

    root.querySelector('#listDevicesBtn')?.addEventListener('click', async () => {
      const email = secEmail().value.trim().toLowerCase();
      if (!email.includes('@')) { secMsg().textContent = $t('Enter a valid staff email.'); return; }
      try {
        await listDevices(email);
      } catch (err) {
        secMsg().textContent = (err && err.message) || $t('List failed');
        beep('err');
      }
    });

    root.querySelector('#revokeAllBtn')?.addEventListener('click', async () => {
      const email = secEmail().value.trim().toLowerCase();
      if (!email.includes('@')) { secMsg().textContent = $t('Enter a valid staff email.'); return; }
      if (!window.confirm($t('Revoke ALL sessions for {email}?', { email }))) return;
      try {
        await api.post('/api/admin/revoke', { email });
        secMsg().textContent = $t('All sessions revoked for {email}. They must sign in again on every device.', { email });
        beep('ok');
        await listDevices(email);
      } catch (err) {
        secMsg().textContent = (err && err.message) || $t('Revoke failed');
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
            <h3>${esc($t('Reset PIN for {name}', { name }))}</h3>
            <p class="muted">${esc($t('Set a new 6-digit PIN for {email}. They are signed out everywhere and must use this PIN on next sign-in.', { email }))}</p>
            <label class="field-label">${$t('New PIN')}
              <input class="field" id="staffPin" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="${$t('6 digits')}">
            </label>
            <button class="btn" id="staffPinSave">${$t('Set PIN')}</button>
          </div>`);
        modalEl.querySelector('[data-x]').addEventListener('click', closeModal);
        modalEl.querySelector('#staffPinSave').addEventListener('click', async () => {
          const pinVal = modalEl.querySelector('#staffPin').value.trim();
          if (!/^\d{6}$/.test(pinVal)) { toast($t('PIN must be exactly 6 digits'), 'warn'); return; }
          const save = modalEl.querySelector('#staffPinSave');
          save.disabled = true;
          try {
            await api.post('/api/admin/pin', { email, pin: pinVal });
            closeModal();
            toast($t('PIN set — hand it to the staff member'), 'ok', 3200); beep('ok');
          } catch (err) {
            toast((err && err.message) || $t('Reset failed'), 'warn');
            save.disabled = false;
          }
        });
        return;
      }
      if (act === 'edit') {
        const u = staffRows.find((r) => String(r.id) === String(id));
        if (!u) return;
        const me = (await idb.get('meta', 'config'))?.user;
        const self = String(u.id) === String(me && me.id);
        const modalEl = openModal(`
          <div class="tx-detail">
            <button class="icon-btn abs-close" data-x>✕</button>
            <h3>${esc($t('Edit {name}', { name: u.firstName + ' ' + u.lastName }))}</h3>
            <label class="field-label">${$t('First name')}
              <input class="field" id="esFirst" autocomplete="off" value="${esc(u.firstName)}">
            </label>
            <label class="field-label">${$t('Last name')}
              <input class="field" id="esLast" autocomplete="off" value="${esc(u.lastName)}">
            </label>
            <label class="field-label">${$t('Email')}
              <input class="field" id="esEmail" type="email" autocapitalize="none" autocomplete="off" value="${esc(u.email)}">
            </label>
            <label class="field-label">${$t('Role')}
              <select class="field" id="esRole" ${self ? 'disabled' : ''}>
                ${['cashier', 'manager', 'admin'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${esc($t(roleLabel(r)))}</option>`).join('')}
              </select>
            </label>
            <p class="muted">${$t('Changing the email or the role signs this person out everywhere.')}</p>
            <button class="btn" id="esSave">${$t('Save')}</button>
            <p id="esMsg" class="login-err" role="status"></p>
          </div>`);
        modalEl.querySelector('[data-x]').addEventListener('click', closeModal);
        modalEl.querySelector('#esSave').addEventListener('click', async () => {
          const save = modalEl.querySelector('#esSave');
          const payload = {
            id: u.id,
            firstName: modalEl.querySelector('#esFirst').value,
            lastName: modalEl.querySelector('#esLast').value,
            email: modalEl.querySelector('#esEmail').value,
          };
          if (!self) payload.role = modalEl.querySelector('#esRole').value;
          save.disabled = true;
          try {
            const res = await api.post('/api/admin/users/patch', payload);
            closeModal();
            toast(res.changed ? $t('Staff updated') : $t('Nothing would change'), 'ok'); beep('ok');
            await loadStaff();
          } catch (err) {
            modalEl.querySelector('#esMsg').textContent = (err && err.message) || $t('Update failed');
            save.disabled = false;
          }
        });
        return;
      }
      if (act === 'toggle') {
        btn.disabled = true;
        try {
          await api.post('/api/admin/users/patch', { id, active: btn.dataset.want === '1' });
          toast(btn.dataset.want === '1' ? $t('Staff re-activated') : $t('Staff deactivated — signed out everywhere'), 'ok');
          beep('ok');
          await loadStaff();
        } catch (err) {
          toast((err && err.message) || $t('Update failed'), 'warn');
          btn.disabled = false;
        }
        return;
      }
    });

    let staffRows = [];
    async function loadStaff() {
      const list = root.querySelector('#staffList');
      try {
        const res = await api.post('/api/admin/users/list', {});
        staffRows = res.users || [];
        const me = (await idb.get('meta', 'config'))?.user;
        list.innerHTML = res.users.map((u) => `
          <div class="set-row">
            <span>
              <strong>${esc(u.firstName + ' ' + u.lastName)}</strong>
              <span class="muted"> · ${esc(u.email)} · ${esc($t(roleLabel(u.role)))}</span>
              ${u.active ? '' : ` <span class="tag-bad">${$t('off')}</span>`}
              ${String(u.id) === String(me && me.id) ? ` <span class="tag-ok">${$t('you')}</span>` : ''}
            </span>
            <span class="set-inline">
              <button class="btn btn-sm btn-ghost" data-staff data-id="${esc(u.id)}" data-act="edit">${$t('Edit')}</button>
              <button class="btn btn-sm" data-staff data-id="${esc(u.id)}" data-email="${esc(u.email)}" data-name="${esc(u.firstName + ' ' + u.lastName)}" data-act="pin">${$t('PIN')}</button>
              ${String(u.id) === String(me && me.id) ? '' : `
              <button class="btn btn-sm ${u.active ? 'btn-danger' : 'btn-ghost'}" data-staff data-id="${esc(u.id)}" data-want="${u.active ? '0' : '1'}" data-act="toggle">${u.active ? $t('Off') : $t('On')}</button>`}
            </span>
          </div>`).join('');
      } catch (err) {
        list.textContent = (err && err.message) || $t('Could not load staff');
      }
    }

    let staffModal = null;
    root.querySelector('#addStaffBtn')?.addEventListener('click', () => {
      staffModal = openModal(`
        <div class="tx-detail">
          <button class="icon-btn abs-close" data-x>✕</button>
          <h3>${$t('Add staff')}</h3>
          <label class="field-label">${$t('First name')}
            <input class="field" id="nsFirst" autocomplete="off">
          </label>
          <label class="field-label">${$t('Last name')}
            <input class="field" id="nsLast" autocomplete="off">
          </label>
          <label class="field-label">${$t('Email')}
            <input class="field" id="nsEmail" type="email" autocapitalize="none" autocomplete="off">
          </label>
          <label class="field-label">${$t('Role')}
            <select class="field" id="nsRole">
              <option value="cashier">${$t('Cashier')}</option>
              <option value="manager">${$t('Manager')}</option>
              <option value="admin">${$t('Admin')}</option>
            </select>
          </label>
          <button class="btn" id="nsCreate">${$t('Create account')}</button>
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
              <h3>${$t('Account created')}</h3>
              <p class="muted">${$t('Show this PIN once and have it changed at the terminal. It is not shown again and not stored anywhere.')}</p>
              <div class="staff-pin">${esc(res.oneTimePin)}</div>
              <p class="muted">${esc(email)}</p>
              <button class="btn" id="nsDone">${$t('Done')}</button>
            </div>`;
          staffModal.querySelector('[data-x]').addEventListener('click', closeModal);
          staffModal.querySelector('#nsDone').addEventListener('click', async () => { closeModal(); await loadStaff(); });
          beep('ok');
        } catch (err) {
          cMsg.textContent = (err && err.message) || $t('Create failed');
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
      if (!/^\d{6}$/.test(next)) { msg.textContent = $t('New PIN must be exactly 6 digits.'); return; }
      btn.disabled = true;
      try {
        await api.post('/api/pin', { currentPin: current, newPin: next });
        msg.textContent = $t('PIN changed. Use it next time you sign in.');
        msg.className = 'muted';
        beep('ok');
        root.querySelector('#pinCurrent').value = '';
        root.querySelector('#pinNew').value = '';
      } catch (err) {
        msg.textContent = (err && err.message) || $t('Change failed');
        msg.className = 'muted';
        beep('err');
      }
      btn.disabled = false;
    });

    root.querySelector('#signoutBtn').addEventListener('click', async () => {
      if (!window.confirm($t('Sign out of this terminal?'))) return;
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