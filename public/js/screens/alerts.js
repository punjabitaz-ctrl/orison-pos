'use strict';

import { $t, $tn, N_ } from '../lang.js';

/* Alerts screen: inventory health for managers/admin — out of stock, low
   stock (at/below reorder point), locked items held from sale, and aging
   ("paying dust") items with 7/15/30-day buckets. Pure read + one unlock
   action; stock changes happen in Inventory. */

import { idb } from '../db.js';
import { screenHead } from '../components.js';
import { api } from '../api.js';
import { fmt, esc, toast, beep } from '../ui.js';
import { inventoryAlerts } from '../alerts.js';
import { pull, SYNC_EVENT } from '../sync.js';

const SEV = {
  out:   { label: N_('Out of stock'), cls: 'sev-out' },
  low:   { label: N_('Low stock'), cls: 'sev-low' },
  locked:{ label: N_('Locked'), cls: 'sev-locked' },
};

export const screen = {
  id: 'alerts',
  tab: 'alerts',
  title: 'Alerts',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const { state } = ctx;
    const isManager = state.user && (state.user.role === 'admin' || state.user.role === 'manager');

    let products = [];

    function metaLine(p) {
      if (p.itemType === 'service') return $t('service');
      if (p.isSerialized) return $tn('{n} unit', '{n} units', (p.serials || []).length);
      return $t('{n} left', { n: p.onHand || 0 });
    }

    function agingText(a) {
      if (!a || !a.ageDays) return '';
      return $tn('{n} day idle', '{n} days idle', a.ageDays);
    }

    function row(a) {
      const p = a.product;
      const locked = a.severity === 'locked';
      const qty = p.itemType === 'service' ? '' : ` · ${metaLine(p)}`;
      const reorder = a.reorder ? ` · ${$t('reorder @ {n}', { n: a.reorder })}` : '';
      return `
        <div class="al-row ${SEV[a.severity].cls}">
          <div class="al-main">
            <div class="al-name">${esc(p.name)}${locked ? ' <span class="lock-dot">🔒</span>' : ''}</div>
            <div class="al-meta">${esc(`${p.sku || ''}${qty}${reorder}${a.ageDays ? ' · ' + agingText(a) : ''}`)}</div>
          </div>
          <div class="al-right">
            <span class="al-tag">${esc($t(SEV[a.severity].label))}</span>
            ${locked && isManager
              ? `<button class="btn btn-ghost btn-sm" data-unlock="${esc(p.id)}">${$t('Unlock')}</button>`
              : ''}
          </div>
        </div>`;
    }

    function section(key, title, items, sub) {
      if (!items.length) return '';
      return `
        <section class="dash-section">
          <h3>${esc(title)}${sub ? ` <span class="muted">· ${esc(sub)}</span>` : ''} <span class="pill">${items.length}</span></h3>
          <div class="rank-list">${items.map(row).join('')}</div>
        </section>`;
    }

    function draw() {
      const alerts = inventoryAlerts(products);
      const out = alerts.filter((a) => a.severity === 'out');
      const low = alerts.filter((a) => a.severity === 'low' && !a.aging);
      const aging = alerts.filter((a) => a.aging);
      const locked = alerts.filter((a) => a.severity === 'locked');
      const agingGroups = [7, 15, 30]
        .map((d) => ({ days: d, items: aging.filter((a) => a.aging.days === d) }))
        .filter((g) => g.items.length);

      root.innerHTML = `
        ${screenHead({
          title: $t('Alerts'),
          sub: `${alerts.length ? $tn('{n} action needed', '{n} actions needed', alerts.length) : $t('All healthy')} · ${$tn('{n} item tracked', '{n} items tracked', products.length)}`,
          actions: `<button class="icon-btn" id="alRefresh" aria-label="${$t('Refresh')}">⟳</button>`,
        })}
        ${!alerts.length ? `<div class="empty"><p>${$t('No inventory alerts. Everything is stocked and selling.')}</p></div>` : ''}
        ${section('out', $t('Out of stock'), out)}
        ${section('low', $t('Low stock'), low, $t('at or below reorder point'))}
        ${agingGroups.map((g) => section('aging', $t('Paying dust'), g.items, $t('{n}+ days without a sale', { n: g.days }))).join('')}
        ${section('locked', $t('Locked'), locked, $t('held from sale by admin'))}`;
    }

    async function refresh() {
      products = await idb.getAll('products');
      draw();
    }

    root.querySelector('#alRefresh')?.addEventListener('click', refresh);
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-unlock]');
      if (!btn || !isManager) return;
      btn.disabled = true;
      try {
        await api.post('/api/admin/products/patch', { productId: btn.dataset.unlock, locked: false });
        await pull();
        await refresh();
        toast($t('Item unlocked'), 'ok'); beep('ok');
      } catch (err) {
        toast((err && err.message) || $t('Unlock failed'), 'warn');
        btn.disabled = false;
      }
    });

    await refresh();
    const handleSync = () => refresh();
    window.addEventListener(SYNC_EVENT, handleSync);
    return () => window.removeEventListener(SYNC_EVENT, handleSync);
  },
};