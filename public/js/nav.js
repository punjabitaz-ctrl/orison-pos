'use strict';

/* The navigation model: one list of destinations, and the selectors the bottom
   bar, the sidebar and the launcher all read. Pure - no DOM, no imports - so
   the shape of the app's navigation is data that can be tested, and adding a
   destination is one line here rather than two buttons in two navs. */

const MANAGER = ['admin', 'manager'];

export const DESTINATIONS = [
  { id: 'refund', label: 'Refund', screen: 'history', roles: MANAGER },
  { id: 'payout', label: 'Paid Out', screen: 'dashboard', roles: MANAGER, dialog: 'payout' },
  { id: 'pickup', label: 'Cash Pick Up', screen: 'dashboard', roles: MANAGER, dialog: 'pickup' },
  { id: 'expense', label: 'Staff Expense', screen: 'dashboard', roles: MANAGER, dialog: 'expense' },
  { id: 'staff', label: 'Time Clock', screen: 'staff', roles: null },
  { id: 'customers', label: 'Customers', screen: 'customers', roles: MANAGER },
  { id: 'inventory', label: 'Products', screen: 'inventory', roles: MANAGER },
  { id: 'alerts', label: 'Alerts', screen: 'alerts', roles: MANAGER },
  { id: 'purchases', label: 'Purchases', screen: 'purchases', roles: MANAGER },
  { id: 'reports', label: 'Reports', screen: 'reports', roles: MANAGER },
  { id: 'dashboard', label: 'Dashboard', screen: 'dashboard', roles: null },
  { id: 'settings', label: 'Settings', screen: 'settings', roles: null },
];

/* The bar is the same three for every role. A slot that means different things
   to different people is the kind of thing that has to be learned. */
const BAR = [
  { id: 'menu', label: 'Menu', screen: 'menu', primary: true },
  { id: 'register', label: 'Sell', screen: 'register', primary: false },
  { id: 'history', label: 'History', screen: 'history', primary: false },
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
