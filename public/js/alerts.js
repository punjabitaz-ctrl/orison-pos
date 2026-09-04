'use strict';

/* Alert computation for inventory & sales operations — pure functions that
   run offline against the local catalog. Shared by the Alerts screen, the
   Dashboard summary, and the tab badge, so every surface agrees on what
   counts as an alert.

   Alert buckets
   - low   : non-serialized product with onHand <= reorder (or <= 5 default)
   - out   : available stock is 0 (serialized count or onHand)
   - locked: item/admin switched it to "locked" so it must not be sold
   - aging : low/out item not sold in the last 30 days, bucketed
             at ~7, ~15 and ~30-day lookbacks. Stays until sold or resupplied.
*/

const AGING_BUCKETS = [
  { key: '7',  days: 7,  label: '7 days' },
  { key: '15', days: 15, label: '15 days' },
  { key: '30', days: 30, label: '30 days' },
];

export function available(p) {
  return p && p.isSerialized ? (p.serials || []).length : Number(p && p.onHand) || 0;
}

export function reorderThreshold(p) {
  if (!p || p.isSerialized || p.itemType === 'service') return 0;
  if (p.reorderPoint != null && p.reorderPoint !== '' && Number(p.reorderPoint) > 0) return Number(p.reorderPoint);
  return 5;
}

export function inventoryAlerts(products) {
  const list = [];
  for (const p of products || []) {
    if (!p || p.itemType === 'service') continue;
    const avail = available(p);
    const reorder = reorderThreshold(p);
    const out = avail <= 0;
    const low = !out && reorder > 0 && avail <= reorder;
    const locked = p.locked === true || p.locked === 1 || String(p.locked) === '1';
    const last = p.lastSoldAt ? new Date(p.lastSoldAt) : null;
    const ageDays = last && !isNaN(last) ? Math.floor((Date.now() - last.getTime()) / 86400000) : null;
    const aging = low && !locked ? agingBucket(ageDays) : null;

    if (!out && !low && !locked && !aging) continue;

    list.push({
      product: p,
      severity: out ? 'out' : (low ? 'low' : 'locked'),
      avail,
      reorder,
      locked,
      aging,
      ageDays,
      lastSoldAt: last ? last.toISOString() : null,
    });
  }
  list.sort((a, b) => severities(a.severity, b.severity) || a.avail - b.avail);
  return list;
}

function severities(a, b) {
  const order = { out: 0, low: 1, locked: 2 };
  return (order[a] ?? 3) - (order[b] ?? 3);
}

// Latest accent bucket this age qualifies for (7 < 15 < 30). Returns null when
// the item is fresh (sold recently) or has no lastSold data.
export function agingBucket(ageDays) {
  if (ageDays == null || isNaN(ageDays) || ageDays < 7) return null;
  const hit = AGING_BUCKETS.filter((b) => ageDays >= b.days).pop();
  return hit ? { days: hit.days, label: hit.label, ageDays } : null;
}

export function bucketLabel(key) {
  const b = AGING_BUCKETS.find((x) => String(x.key) === String(key));
  return b ? b.label : '';
}