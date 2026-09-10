'use strict';

/* Composed UI shared across screens: navigation buttons, launcher tiles and the
   app header. ui.js holds primitives that know nothing about this app; this is
   the layer that knows what a destination is. Every function is a pure string
   builder, so what the navigation renders can be asserted without a browser. */

import { esc } from './ui.js';

const SVG = (body) => `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  menu: SVG('<rect x="3" y="3" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.7"/><rect x="14" y="3" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.7"/><rect x="3" y="14" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.7"/><rect x="14" y="14" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.7"/>'),
  register: SVG('<rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3 9h18M8 13h4M8 16h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  history: SVG('<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5l3.5 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  refund: SVG('<path d="M9 5L4 10l5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 10h9a6 6 0 010 12h-3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  payout: SVG('<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.6"/><path d="M12 17V7M9 14l3 3 3-3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'),
  staff: SVG('<circle cx="9" cy="7.5" r="3.2" stroke="currentColor" stroke-width="1.6"/><path d="M3.2 20c.9-3.6 3.2-5.2 5.8-5.2 1 0 2 .25 2.9.75" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.8" cy="16.2" r="4.3" stroke="currentColor" stroke-width="1.6"/><path d="M16.8 14.2v2.2l1.5 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  customers: SVG('<circle cx="9" cy="8" r="3.5" stroke="currentColor" stroke-width="1.6"/><path d="M3 20c1-4 3.5-5.5 6-5.5s5 1.5 6 5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="17" cy="9" r="2.5" stroke="currentColor" stroke-width="1.6"/><path d="M16 14.6c1.8.3 3.6 1.4 4.4 3.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  inventory: SVG('<path d="M4 7l8-4 8 4-8 4-8-4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 7v10l8 4 8-4V7M12 11v10" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'),
  alerts: SVG('<path d="M12 3l9 17H3l9-17z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 10v4M12 17h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  purchases: SVG('<path d="M3 6h18l-2 12H5L3 6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M3 6l2 3h14l2-3M9 12h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  reports: SVG('<rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 16v-4M12 16V8M16 16v-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  dashboard: SVG('<rect x="3" y="3" width="8" height="10" rx="1.5" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="3" width="8" height="6" rx="1.5" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="15" width="8" height="6" rx="1.5" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="11" width="8" height="10" rx="1.5" stroke="currentColor" stroke-width="1.6"/>'),
  settings: SVG('<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.4 2.7a7 7 0 00-2 1.2l-2.5-1-2 3.4 2.1 1.5a7 7 0 000 2.4L3.1 14.6l2 3.4 2.5-1a7 7 0 002 1.2L10 21h4l.4-2.7a7 7 0 002-1.2l2.5 1 2-3.4-2.1-1.5c.1-.4.2-.8.2-1.2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'),
};

const FALLBACK = SVG('<circle cx="12" cy="12" r="3.5" stroke="currentColor" stroke-width="1.7"/>');

export function icon(id) {
  return ICONS[id] || FALLBACK;
}

export function tile({ id, label } = {}) {
  return `
    <button class="mtile" data-go="${esc(id)}" type="button">
      <span class="mtile-icon i-${esc(id)}">${icon(id)}</span>
      <span class="mtile-label">${esc(label)}</span>
    </button>`;
}

export function tileGrid(tiles) {
  return `<div class="menu-grid">${(tiles || []).map((t) => tile(t)).join('')}</div>`;
}

export function navButton({ id, label, primary } = {}) {
  return `
    <button class="tab${primary ? ' tab-primary' : ''}" data-tab="${esc(id)}" aria-label="${esc(label)}" title="${esc(label)}">
      ${icon(id)}
      <span>${esc(label)}</span>
      ${id === 'alerts' || id === 'menu' ? '<span class="tab-badge hidden"></span>' : ''}
    </button>`;
}

export function appHeaderHtml({ storeName, userName, role } = {}) {
  const name = String(userName || '').trim();
  const initial = name ? name[0] : '·';
  return `
    <div class="ab-left">
      <span class="ab-store">${esc(storeName || 'Orison POS')}</span>
    </div>
    <div class="ab-right">
      <span id="appStatus" class="ab-status"><span class="dot"></span><span class="ab-status-text"></span></span>
      <time id="appClock" class="ab-clock"></time>
      <button id="appUser" class="ab-user" type="button" aria-label="${esc(name || 'Account')}" title="${esc(name)}${role ? ' · ' + esc(role) : ''}">${esc(initial)}</button>
    </div>`;
}
