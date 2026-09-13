'use strict';

/* The navigation model: one list of destinations, and the selectors the bottom
   bar, the sidebar and the launcher all read. Pure - no DOM, no imports - so
   the shape of the app's navigation is data that can be tested, and adding a
   destination is one line here rather than two buttons in two navs. Labels are
   marked with N_() and translated where they are drawn. */

import { N_ } from './lang.js';

const MANAGER = ['admin', 'manager'];
const ADMIN = ['admin'];

export const DESTINATIONS = [
  { id: 'refund', label: N_('Refund'), screen: 'history', roles: null },
  { id: 'payout', label: N_('Paid Out'), screen: 'dashboard', roles: MANAGER, dialog: 'payout' },
  { id: 'pickup', label: N_('Cash Pick Up'), screen: 'dashboard', roles: MANAGER, dialog: 'pickup' },
  { id: 'expense', label: N_('Staff Expense'), screen: 'dashboard', roles: MANAGER, dialog: 'expense' },
  { id: 'drawer', label: N_('Open Drawer'), screen: 'dashboard', roles: null, dialog: 'drawer' },
  { id: 'external', label: N_('Sold Elsewhere'), screen: 'register', roles: MANAGER, dialog: 'external' },
  { id: 'tradein', label: N_('Trade-In'), screen: 'tradein', roles: null },
  { id: 'staff', label: N_('Time Clock'), screen: 'staff', roles: null },
  { id: 'customers', label: N_('Customers'), screen: 'customers', roles: MANAGER },
  { id: 'inventory', label: N_('Products'), screen: 'inventory', roles: MANAGER },
  { id: 'alerts', label: N_('Alerts'), screen: 'alerts', roles: MANAGER },
  { id: 'repairs', label: N_('Repairs'), screen: 'repairs', roles: null },
  { id: 'purchases', label: N_('Purchases'), screen: 'purchases', roles: MANAGER },
  { id: 'reports', label: N_('Reports'), screen: 'reports', roles: MANAGER },
  { id: 'dashboard', label: N_('Dashboard'), screen: 'dashboard', roles: null },
  { id: 'accounts', label: N_('Accounts'), screen: 'accounts', roles: ADMIN },
  { id: 'audit', label: N_('Audit Log'), screen: 'audit', roles: ADMIN },
  { id: 'settings', label: N_('Settings'), screen: 'settings', roles: null },
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

export function isRestricted(id, role) {
  const hit = DESTINATIONS.find((d) => d.id === id);
  if (!hit) return false;
  return !allows(hit.roles, role);
}
