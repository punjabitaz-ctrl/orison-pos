'use strict';

/* What the Sell screen shows: the categories, one category's products, or
   search results from the whole catalog. Pure, so it is tested without a DOM. */

export function matchesTerm(product, term) {
  const q = String(term || '').trim().toLowerCase();
  if (!q) return true;
  const p = product || {};
  return String(p.name || '').toLowerCase().includes(q)
    || String(p.sku || '').toLowerCase().includes(q)
    || String(p.upc || '').toLowerCase().includes(q)
    || (p.serials || []).join(',').toLowerCase().includes(q);
}

/* One entry per category: how many products it holds and how many of those
   can be sold right now. `available(product)` is what the open cart leaves. */
export function categorySummaries(products, available) {
  const byName = new Map();
  for (const p of products || []) {
    const name = String(p.category || '').trim() || 'Uncategorized';
    const e = byName.get(name) || { name, count: 0, sellable: 0 };
    e.count += 1;
    const isService = p.itemType === 'service';
    if (isService || (available ? available(p) : 0) > 0) e.sellable += 1;
    byName.set(name, e);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* The products to show. A search always looks across every category, so a
   scan or a typed name finds the item wherever it lives. */
export function productsInView(products, { category, term } = {}) {
  const q = String(term || '').trim();
  return (products || []).filter((p) => {
    if (q) return matchesTerm(p, q);
    if (!category) return false;
    return (String(p.category || '').trim() || 'Uncategorized') === category;
  });
}
