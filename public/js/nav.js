'use strict';

/* The navigation model: one list of destinations, and the selectors the bottom
   bar, the sidebar and the launcher all read. Pure - no DOM, no imports - so
   the shape of the app's navigation is data that can be tested, and adding a
   destination is one line here rather than two buttons in two navs. Labels are
   marked with N_() and translated where they are drawn. */

import { N_ } from './lang.js';

const MANAGER = ['admin', 'manager'];
const ADMIN = ['admin'];

/* Grouped so the sidebar and the Menu read as a few short lists rather than
   one long one (team feedback, v1.46.0). Order within DESTINATIONS is the
   order on screen. */
export const GROUPS = [
  { id: 'counter', label: N_('Counter') },
  { id: 'cash', label: N_('Cash') },
  { id: 'stock', label: N_('Stock & customers') },
  { id: 'insights', label: N_('Insights') },
  { id: 'team', label: N_('Team') },
  /* no heading: a lone Settings entry does not need a title saying Settings */
  { id: 'system', label: '' },
];

export const DESTINATIONS = [
  { id: 'refund', label: N_('Refund'), screen: 'history', roles: null, group: 'counter' },
  { id: 'tradein', label: N_('Trade-In'), screen: 'tradein', roles: null, group: 'counter' },
  { id: 'repairs', label: N_('Repairs'), screen: 'repairs', roles: null, group: 'counter' },
  { id: 'drawer', label: N_('Open Drawer'), screen: 'dashboard', roles: null, dialog: 'drawer', group: 'counter' },
  { id: 'payout', label: N_('Paid Out'), screen: 'dashboard', roles: MANAGER, dialog: 'payout', group: 'cash' },
  { id: 'pickup', label: N_('Cash Pick Up'), screen: 'dashboard', roles: MANAGER, dialog: 'pickup', group: 'cash' },
  { id: 'expense', label: N_('Staff Expense'), screen: 'dashboard', roles: MANAGER, dialog: 'expense', group: 'cash' },
  { id: 'customers', label: N_('Customers'), screen: 'customers', roles: MANAGER, group: 'stock' },
  { id: 'inventory', label: N_('Products'), screen: 'inventory', roles: MANAGER, group: 'stock' },
  { id: 'purchases', label: N_('Purchases'), screen: 'purchases', roles: MANAGER, group: 'stock' },
  { id: 'external', label: N_('Sold Elsewhere'), screen: 'register', roles: MANAGER, dialog: 'external', group: 'stock' },
  { id: 'alerts', label: N_('Alerts'), screen: 'alerts', roles: MANAGER, group: 'stock' },
  { id: 'dashboard', label: N_('Dashboard'), screen: 'dashboard', roles: null, group: 'insights' },
  { id: 'salesreport', label: N_('Sales Report'), screen: 'salesreport', roles: null, group: 'insights' },
  { id: 'reports', label: N_('Reports'), screen: 'reports', roles: MANAGER, group: 'insights' },
  { id: 'accounts', label: N_('Accounts'), screen: 'accounts', roles: ADMIN, group: 'insights' },
  { id: 'audit', label: N_('Audit Log'), screen: 'audit', roles: ADMIN, group: 'insights' },
  { id: 'staff', label: N_('Time Clock'), screen: 'staff', roles: null, group: 'team' },
  { id: 'settings', label: N_('Settings'), screen: 'settings', roles: null, group: 'system' },
];

/* The bar is the same three for every role. A slot that means different things
   to different people is the kind of thing that has to be learned. */
const BAR = [
  { id: 'menu', label: N_('Menu'), screen: 'menu', primary: true },
  { id: 'register', label: N_('Sell'), screen: 'register', primary: false },
  { id: 'history', label: N_('History'), screen: 'history', primary: false },
];

function allows(roles, role) {
  if (!roles) return true;
  return roles.indexOf(String(role || 'cashier')) >= 0;
}

export function primaryTabs() {
  return BAR.map((t) => ({ ...t }));
}

export function menuTiles(role) {
  return DESTINATIONS.filter((d) => allows(d.roles, role)).map((d) => ({ ...d }));
}

/* Headings only earn their space on a long list. */
export const FLAT_UP_TO = 8;

/* The destinations this role may open, under their group headings. A group
   with nothing in it for this role is left out. A short list (a cashier's) is
   one group with no heading: a heading over a single tile is clutter too. */
export function navGroups(role) {
  const tiles = menuTiles(role);
  if (tiles.length <= FLAT_UP_TO) return [{ id: 'all', label: '', items: tiles }];
  return GROUPS
    .map((g) => ({ ...g, items: tiles.filter((t) => t.group === g.id) }))
    .filter((g) => g.items.length);
}

export function isRestricted(id, role) {
  const hit = DESTINATIONS.find((d) => d.id === id);
  if (!hit) return false;
  return !allows(hit.roles, role);
}
