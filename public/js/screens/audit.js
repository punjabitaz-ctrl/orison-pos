'use strict';

/* Audit log: who did what, when. Admin only, append-only, newest first.

   This is the screen you open when the numbers do not add up and you need to
   know who changed what. It shows the actor, their role at the time, the action
   and enough of a summary to judge it without opening anything else. */

import { api } from '../api.js';
import { esc, toast, skeleton, emptyState, csvRows, downloadCsv } from '../ui.js';
import { screenHead, sectionHead, dataTable } from '../components.js';

const ACTIONS = [
  { id: '', label: 'Everything' },
  { id: 'store.settings', label: 'Store settings' },
  { id: 'price.bulk', label: 'Bulk pricing' },
  { id: 'stock.take', label: 'Stock takes' },
  { id: 'user.patch', label: 'Staff changes' },
  { id: 'device.revoke', label: 'Terminal revoked' },
];

function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleString('en-US', {
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
        title: 'Audit log',
        sub: 'Every privileged action, newest first',
        actions: '<button class="icon-btn" id="auRefresh" aria-label="Refresh">⟳</button>',
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
        body.innerHTML = `<p class="empty">${esc((err && err.data && err.data.error) || 'Could not load the audit log.')}</p>`;
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
            title: `${entries.length} of ${total} entries`,
            asideHtml: `<div class="seg seg-sm">${ACTIONS.map((a) =>
              `<button class="seg-btn ${a.id === action ? 'on' : ''}" data-act="${esc(a.id)}">${esc(a.label)}</button>`).join('')}</div>`,
          })}
          ${entries.length ? dataTable({
            head: [{ label: 'When' }, { label: 'Who' }, { label: 'Role' }, { label: 'Action' }, { label: 'Detail' }],
            bodyHtml: entries.map((e) => `
              <tr>
                <td>${esc(when(e.at))}</td>
                <td>${esc(e.userName || '—')}</td>
                <td>${esc(e.role || '')}</td>
                <td><span class="k-chip k-payout">${esc(e.action)}</span></td>
                <td>${esc(e.summary || '')}</td>
              </tr>`).join(''),
          }) : emptyState({
            icon: '🗂',
            title: 'Nothing logged yet',
            body: 'Privileged actions appear here as they happen.',
          })}
          <div class="row dash-actions">
            ${nextCursor ? '<button class="btn btn-ghost" id="auMore">Load 100 more</button>' : ''}
            ${entries.length ? '<button class="btn btn-ghost" id="auCsv">Export CSV</button>' : ''}
          </div>
        </div>`;

      body.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
        action = b.dataset.act;
        body.innerHTML = skeleton('table', 5);
        load(false);
      }));
      const more = body.querySelector('#auMore');
      if (more) more.addEventListener('click', () => load(true));
      const csv = body.querySelector('#auCsv');
      if (csv) csv.addEventListener('click', () => {
        const rows = [['at', 'user', 'role', 'action', 'target_type', 'target_id', 'summary']];
        for (const e of entries) rows.push([e.at, e.userName, e.role, e.action, e.targetType, e.targetId, e.summary]);
        downloadCsv(`orison-audit-${new Date().toISOString().slice(0, 10)}.csv`, csvRows(rows));
        toast('Audit log exported', 'ok');
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
