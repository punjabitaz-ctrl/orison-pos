'use strict';

/* The launcher: every job this account can do, as one flat grid of labelled
   tiles. No groups, no submenus - the whole point is that nothing here has to
   be learned or remembered. */

import { esc } from '../ui.js';
import { menuTiles } from '../nav.js';
import { tileGrid, screenHead } from '../components.js';
import { openCashOutDialog } from '../money-dialogs.js';

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
      ${screenHead({ title: 'Menu', sub: String(role) })}
      ${tileGrid(tiles)}`;

    const onTap = (e) => {
      const btn = e.target.closest('[data-go]');
      if (!btn) return;
      const hit = tiles.find((x) => x.id === btn.dataset.go);
      if (!hit) return;
      if (hit.dialog) {
        openCashOutDialog(ctx, hit.dialog);
        return;
      }
      router.show(hit.screen);
    };
    root.addEventListener('click', onTap);

    return () => root.removeEventListener('click', onTap);
  },
};
