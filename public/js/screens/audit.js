'use strict';

import { $t, N_, dateLocale } from '../lang.js';

/* Audit log: who did what, when. Admin only, append-only, newest first.

   This is the screen you open when the numbers do not add up and you need to
   know who changed what. It shows the actor, their role at the time, the action
   and enough of a summary to judge it without opening anything else. */

import { api } from '../api.js';
import { esc, toast, skeleton, emptyState, csvRows, downloadCsv } from '../ui.js';
import { screenHead, sectionHead, dataTable, roleLabel } from '../components.js';

/* Grouped the way an owner asks the question: "who touched the money", "who
   touched stock", "who touched people". The ids are the server's action names. */
export const ACTION_GROUPS = [
  { label: N_('Money'), actions: [
    { id: 'refund', label: N_('Refunds') },
    { id: 'cash.payout', label: N_('Paid out') },
    { id: 'cash.pickup', label: N_('Cash pick-ups') },
    { id: 'cash.expense', label: N_('Staff expenses') },
    { id: 'customer.payment', label: N_('Payments on account') },
    { id: 'drawer.open', label: N_('Drawer opened without a sale') },
    { id: 'export.drive', label: N_('Drive exports') },
    { id: 'marketplace.import', label: N_('Marketplace imports') },
    { id: 'tradein.create', label: N_('Trade-ins bought') },
    { id: 'supplier.payment', label: N_('Suppliers paid') },
    { id: 'supplier.payment_void', label: N_('Supplier payments voided') },
    { id: 'marketplace.settings', label: N_('Marketplace sheet changes') },
  ] },
  { label: N_('Stock'), actions: [
    { id: 'stock.adjust', label: N_('Stock adjustments') },
    { id: 'stock.take', label: N_('Stock takes') },
    { id: 'product.create', label: N_('New products') },
    { id: 'product.update', label: N_('Product edits') },
    { id: 'price.bulk', label: N_('Bulk pricing') },
    { id: 'serial.add', label: N_('Serials added') },
    { id: 'supplier.create', label: N_('New suppliers') },
    { id: 'po.create', label: N_('Purchase orders') },
    { id: 'po.receive', label: N_('Deliveries received') },
    { id: 'po.cancel', label: N_('Orders cancelled') },
  ] },
  { label: N_('Repairs'), actions: [
    { id: 'repair.created', label: N_('Repairs booked in') },
    { id: 'repair.part', label: N_('Parts fitted or returned') },
    { id: 'repair.need', label: N_('Parts a job is waiting for') },
    { id: 'repair.labour', label: N_('Labour') },
    { id: 'repair.status', label: N_('Status changes') },
    { id: 'repair.deposit', label: N_('Deposits taken') },
    { id: 'repair.deposit_refund', label: N_('Deposits given back') },
    { id: 'repair.collected', label: N_('Repairs collected') },
    { id: 'repair.voided', label: N_('Tickets voided') },
  ] },
  { label: N_('People and access'), actions: [
    { id: 'approval.granted', label: N_('Manager approvals') },
    { id: 'timeclock.correct', label: N_('Punches corrected') },
    { id: 'shift.force_close', label: N_('Shifts closed by a manager') },
    { id: 'auth.login', label: N_('Sign-ins') },
    { id: 'auth.locked', label: N_('Lockouts') },
    { id: 'user.unlock', label: N_('Lockouts released') },
    { id: 'user.create', label: N_('New staff') },
    { id: 'user.patch', label: N_('Staff changes') },
    { id: 'payroll.draft', label: N_('Pay runs drafted') },
    { id: 'payroll.adjust', label: N_('Pay lines adjusted') },
    { id: 'payroll.pay', label: N_('Pay runs paid') },
    { id: 'payroll.void', label: N_('Pay runs voided') },
    { id: 'opening.set', label: N_('Opening balances set') },
    { id: 'opening.void', label: N_('Opening balances voided') },
    { id: 'user.pin_reset', label: N_('PIN resets') },
    { id: 'session.revoke_all', label: N_('Sessions revoked') },
    { id: 'device.revoke', label: N_('Terminal revoked') },
    { id: 'customer.create', label: N_('New customers') },
    { id: 'customer.update', label: N_('Customer changes') },
    { id: 'conflict.review', label: N_('Conflict reviews') },
  ] },
  { label: N_('The business'), actions: [
    { id: 'store.settings', label: N_('Store settings') },
    { id: 'report.recipients', label: N_('Report recipients') },
    { id: 'report.cadence', label: N_('Report schedule') },
    { id: 'report.sent', label: N_('Reports sent') },
    { id: 'report.failed', label: N_('Reports failed') },
    { id: 'backup.run', label: N_('Backups') },
    { id: 'backup.failed', label: N_('Backup failures') },
  ] },
];

const ACTION_LABEL = Object.create(null);
for (const g of ACTION_GROUPS) for (const a of g.actions) ACTION_LABEL[a.id] = a.label;

export function actionLabel(id) {
  return ACTION_LABEL[id] ? $t(ACTION_LABEL[id]) : String(id || '');
}

function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleString(dateLocale(), {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
}

export const screen = {
  id: 'audit',
  tab: 'audit',
  title: 'Audit log',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const { state } = ctx;
    let action = '';
    let entries = [];
    let nextCursor = null;
    let total = 0;
    let loading = false;

    root.innerHTML = `
      ${screenHead({
        title: $t('Audit log'),
        sub: $t('Every privileged action, newest first'),
        actions: `<button class="icon-btn" id="auRefresh" aria-label="${$t('Refresh')}">⟳</button>`,
      })}
      <div id="auBody">${skeleton('table', 5)}</div>`;

    const body = root.querySelector('#auBody');

    async function load(more) {
      if (loading) return;
      loading = true;
      if (!more) { entries = []; nextCursor = null; }
      const qs = [`limit=100`];
      if (action) qs.push('action=' + encodeURIComponent(action));
      if (more && nextCursor) qs.push('cursor=' + encodeURIComponent(nextCursor));
      try {
        const res = await api.get('/api/audit?' + qs.join('&'));
        entries = entries.concat(res.entries || []);
        nextCursor = res.nextCursor || null;
        total = res.total || entries.length;
      } catch (err) {
        body.innerHTML = `<p class="empty">${esc((err && err.message) || $t('Could not load the audit log.'))}</p>`;
        loading = false;
        return;
      }
      loading = false;
      draw();
    }

    function draw() {
      body.innerHTML = `
        <div class="dash-section">
          ${sectionHead({
            title: $t('{shown} of {total} entries', { shown: entries.length, total }),
            asideHtml: `<select class="field au-filter" id="auAction" aria-label="${$t('Action')}">
              <option value="">${$t('Everything')}</option>
              ${ACTION_GROUPS.map((g) => `<optgroup label="${esc($t(g.label))}">${g.actions.map((a) =>
                `<option value="${esc(a.id)}" ${a.id === action ? 'selected' : ''}>${esc($t(a.label))}</option>`).join('')}</optgroup>`).join('')}
            </select>`,
          })}
          ${entries.length ? dataTable({
            head: [{ label: $t('When') }, { label: $t('Who') }, { label: $t('Role') }, { label: $t('Action') }, { label: $t('Detail') }],
            bodyHtml: entries.map((e) => `
              <tr>
                <td>${esc(when(e.at))}</td>
                <td>${esc(e.userName || '—')}</td>
                <td>${esc(e.role ? $t(roleLabel(e.role)) : '')}</td>
                <td><span class="k-chip k-payout" title="${esc(e.action)}">${esc(actionLabel(e.action))}</span></td>
                <td>${esc(e.summary || '')}</td>
              </tr>`).join(''),
          }) : emptyState({
            icon: '🗂',
            title: $t('Nothing logged yet'),
            body: $t('Privileged actions appear here as they happen.'),
          })}
          <div class="row dash-actions">
            ${nextCursor ? `<button class="btn btn-ghost" id="auMore">${$t('Load 100 more')}</button>` : ''}
            ${entries.length ? `<button class="btn btn-ghost" id="auCsv">${$t('Export CSV')}</button>` : ''}
          </div>
        </div>`;

      body.querySelector('#auAction').addEventListener('change', (ev) => {
        action = ev.target.value;
        body.innerHTML = skeleton('table', 5);
        load(false);
      });
      const more = body.querySelector('#auMore');
      if (more) more.addEventListener('click', () => load(true));
      const csv = body.querySelector('#auCsv');
      if (csv) csv.addEventListener('click', () => {
        const rows = [['at', 'user', 'role', 'action', 'target_type', 'target_id', 'summary']];
        for (const e of entries) rows.push([e.at, e.userName, e.role, e.action, e.targetType, e.targetId, e.summary]);
        downloadCsv(`orison-audit-${new Date().toISOString().slice(0, 10)}.csv`, csvRows(rows));
        toast($t('Audit log exported'), 'ok');
      });
    }

    root.querySelector('#auRefresh').addEventListener('click', () => {
      body.innerHTML = skeleton('table', 5);
      load(false);
    });

    await load(false);
    return () => {};
  },
};
