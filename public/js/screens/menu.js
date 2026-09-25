'use strict';

/* The launcher: every job this account can do, as labelled tiles under a few
   short headings - Counter, Cash, Stock & customers, Insights, Team - so a long
   list reads as small groups. No submenus: every tile is one tap. */

import { esc } from '../ui.js';
import { menuTiles, navGroups } from '../nav.js';
import { tileGrid, screenHead, roleLabel } from '../components.js';
import { $t } from '../lang.js';
import { openCashOutDialog } from '../money-dialogs.js';
import { openExternalSaleDialog } from './external-sale.js';
import { openDrawerDialog } from '../drawer-dialog.js';

export const screen = {
  id: 'menu',
  tab: 'menu',
  title: 'Menu',

  async render(ctx, root) {
    document.getElementById('tabbar').classList.remove('hidden');
    const { state, router } = ctx;
    const role = (state.user || {}).role || 'cashier';
    const tiles = menuTiles(role);

    root.innerHTML = `
      ${screenHead({ title: $t('Menu'), sub: $t(roleLabel(role)) })}
      ${navGroups(role).map((g) => `
        <section class="menu-group">
          ${g.label ? `<h3 class="menu-head">${esc($t(g.label))}</h3>` : ''}
          ${tileGrid(g.items)}
        </section>`).join('')}`;

    const onTap = (e) => {
      const btn = e.target.closest('[data-go]');
      if (!btn) return;
      const hit = tiles.find((x) => x.id === btn.dataset.go);
      if (!hit) return;
      if (hit.dialog === 'external') { openExternalSaleDialog(ctx); return; }
      if (hit.dialog === 'drawer') { openDrawerDialog(ctx); return; }
      if (hit.dialog === 'banking') { import('../banking-dialog.js').then((m) => m.openBankingDialog(ctx)); return; }
      if (hit.dialog) { openCashOutDialog(ctx, hit.dialog); return; }
      router.show(hit.screen);
    };
    root.addEventListener('click', onTap);

    return () => root.removeEventListener('click', onTap);
  },
};
