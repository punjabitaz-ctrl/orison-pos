'use strict';

/* Pure aggregation helpers shared by the Dashboard and the Staff screen.
   Everything here takes a plain transaction list and returns numbers — no
   IndexedDB, no network, no clock — so the same maths runs offline, in the
   register, and in the unit tests. Day keys are the terminal's local calendar
   day, matching the rest of the client. */

export function kindOf(tx) {
  return (tx && tx.kind) || 'sale';
}

export function dayKey(iso) {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d)) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function shiftDayKey(offsetDays = 0, from = new Date()) {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() - offsetDays);
  return dayKey(d);
}

/* Money in minus money out for one row: sales and collections are cash in,
   refunds and payouts are cash out. Mirrors the server's export lines. */
export function signedNet(tx) {
  const v = Number(tx && tx.grandTotal) || 0;
  const k = kindOf(tx);
  return (k === 'refund' || k === 'payout') ? -v : v;
}

export function unitsOf(tx) {
  return (tx.items || []).reduce((s, i) => s + (Number(i.quantity) || 1), 0);
}

export function dayTotals(txs, key) {
  const out = { key, net: 0, sales: 0, refunds: 0, payouts: 0, collections: 0, count: 0, units: 0, gp: 0, tickets: 0 };
  for (const t of txs || []) {
    if (dayKey(t.createdAt) !== key) continue;
    const k = kindOf(t);
    const v = Number(t.grandTotal) || 0;
    out.count += 1;
    out.gp += Number(t.grossProfit) || 0;
    if (k === 'sale') { out.sales += v; out.units += unitsOf(t); out.tickets += 1; }
    else if (k === 'refund') out.refunds += v;
    else if (k === 'payout') out.payouts += v;
    else if (k === 'payment') out.collections += v;
    out.net += signedNet(t);
  }
  out.avgTicket = out.tickets ? out.sales / out.tickets : 0;
  return out;
}

/* Direction + size of a change against a baseline. A baseline of 0 has no
   meaningful percentage, so pct stays null rather than reporting ∞. */
export function trend(current, baseline) {
  const c = Number(current) || 0;
  const b = Number(baseline) || 0;
  const delta = c - b;
  const pct = b === 0 ? null : (delta / Math.abs(b)) * 100;
  return {
    current: c,
    baseline: b,
    delta,
    pct,
    dir: delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat'),
  };
}

/* Mean of the same measure over the N days before `key` (exclusive), so
   "today vs the last 7 days" never counts today in its own baseline. */
export function baselineAverage(txs, key, days = 7, measure = 'net') {
  if (!days || days < 1) return 0;
  const anchor = new Date(`${key}T12:00:00`);
  if (isNaN(anchor)) return 0;
  let sum = 0;
  for (let i = 1; i <= days; i++) {
    const d = new Date(anchor.getTime());
    d.setDate(d.getDate() - i);
    sum += dayTotals(txs, dayKey(d))[measure] || 0;
  }
  return sum / days;
}

export function hourlyBuckets(txs, key) {
  const buckets = [];
  for (let h = 0; h < 24; h++) buckets.push({ hour: h, sales: 0, count: 0, units: 0 });
  for (const t of txs || []) {
    if (kindOf(t) !== 'sale') continue;
    if (dayKey(t.createdAt) !== key) continue;
    const d = new Date(t.createdAt);
    if (isNaN(d)) continue;
    const b = buckets[d.getHours()];
    b.sales += Number(t.grandTotal) || 0;
    b.count += 1;
    b.units += unitsOf(t);
  }
  return buckets;
}

/* Trading window only: the run from the first to the last hour with a sale,
   padded by an hour each side, so an empty overnight doesn't flatten the day. */
export function tradingWindow(buckets) {
  const active = (buckets || []).filter((b) => b.count > 0);
  if (!active.length) return { from: 8, to: 20 };
  const from = Math.max(0, active[0].hour - 1);
  const to = Math.min(23, active[active.length - 1].hour + 1);
  return { from, to: Math.max(to, from + 1) };
}

export function busiestHour(buckets) {
  let best = null;
  for (const b of buckets || []) {
    if (!b.count) continue;
    if (!best || b.sales > best.sales) best = b;
  }
  return best;
}

export function topSellers(txs, limit = 5) {
  const tally = new Map();
  for (const t of txs || []) {
    if (kindOf(t) !== 'sale') continue;
    for (const it of t.items || []) {
      const name = String(it.name || 'Item');
      const e = tally.get(name) || { name, units: 0, rev: 0, gp: 0 };
      const qty = Number(it.quantity) || 1;
      e.units += qty;
      e.rev += (Number(it.unitPrice) || 0) * qty;
      if (it.unitCost != null) e.gp += ((Number(it.unitPrice) || 0) - (Number(it.unitCost) || 0)) * qty;
      tally.set(name, e);
    }
  }
  return [...tally.values()]
    .sort((a, b) => b.rev - a.rev || b.units - a.units)
    .slice(0, limit)
    .map((e) => ({ ...e, margin: e.rev ? (e.gp / e.rev) * 100 : 0 }));
}

export function withinDays(txs, days, from = new Date()) {
  const cutoff = new Date(from.getTime());
  cutoff.setDate(cutoff.getDate() - days);
  return (txs || []).filter((t) => {
    const d = new Date(t.createdAt);
    return !isNaN(d) && d >= cutoff;
  });
}

/* Hours worked from time-clock entries. An entry still OPEN counts up to now,
   so "on the floor" staff show live hours instead of a blank. */
export function hoursFromEntries(entries, now = Date.now()) {
  let minutes = 0;
  for (const e of entries || []) {
    if (e.minutes != null && e.status === 'CLOSED') { minutes += Number(e.minutes) || 0; continue; }
    const start = new Date(e.clockIn).getTime();
    if (isNaN(start)) continue;
    const end = e.clockOut ? new Date(e.clockOut).getTime() : now;
    if (isNaN(end) || end < start) continue;
    minutes += Math.round((end - start) / 60000);
  }
  return minutes / 60;
}

export function fmtDuration(hours) {
  const total = Math.max(0, Math.round((Number(hours) || 0) * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
