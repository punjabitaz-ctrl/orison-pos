'use strict';

/* Inventory tools (v1.15.0): bulk repricing, stock-take, shelf labels and the
   low-stock reorder worksheet. Each is a modal opened from Products → Tools.

   Repricing and counting are server-authoritative: the client sends a rule or
   a count sheet and the backend recomputes and writes under its script lock,
   so a stale catalog on this terminal can never dictate a price or a shelf. */

import { api } from '../api.js';
import {
  fmt, esc, toast, beep, openModal, closeModal, skeleton, emptyState,
  csvRows, downloadCsv,
} from '../ui.js';
import { labelsFor, labelSheetHtml, labelCode } from '../labels.js';
import { dataTable, statRow } from '../components.js';
import { printSheet } from '../print-sheet.js';

function fmtMoney(v) {
  return fmt(Number(v) || 0);
}

function printNode(html, title) {
  if (!printSheet(html, title)) {
    toast('The browser blocked the print window — allow pop-ups for this site', 'warn', 4200);
  }
}

/* ---------------- Bulk price update ---------------- */

export function bulkPriceModal({ products, onDone }) {
  const categories = [...new Set((products || []).map((p) => p.category).filter(Boolean))].sort();
  const modal = openModal(`
    <div class="form-modal inv-tool">
      <h3>Bulk price update</h3>
      <p class="muted">Set a rule; the server recalculates each price and records every change in price history. Preview first — nothing is written until you apply.</p>
      <div class="two fields-row">
        <div class="field"><span>Apply to</span>
          <select id="bpScope">
            <option value="All">All products</option>
            ${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><span>Field</span>
          <select id="bpField">
            <option value="retail_price">Retail price</option>
            <option value="cost_price">Cost price</option>
          </select>
        </div>
      </div>
      <div class="two fields-row">
        <div class="field"><span>Change</span>
          <select id="bpMode">
            <option value="pct">By percentage</option>
            <option value="delta">By amount</option>
            <option value="set">Set to</option>
          </select>
        </div>
        <div class="field"><span id="bpValLabel">Percent</span>
          <input id="bpValue" type="number" inputmode="decimal" step="0.01" value="0">
        </div>
      </div>
      <div class="field"><span>Round result to nearest (0 = don't round)</span>
        <input id="bpRound" type="number" inputmode="decimal" min="0" step="0.01" value="0">
      </div>
      <div id="bpBody" class="ph-body"></div>
      <p id="bpErr" class="login-err"></p>
      <div class="row">
        <button class="btn btn-ghost" data-cancel>Close</button>
        <button class="btn" id="bpPreview">Preview</button>
        <button class="btn" id="bpApply" disabled>Apply</button>
      </div>
    </div>`);

  const body = modal.querySelector('#bpBody');
  const err = modal.querySelector('#bpErr');
  const applyBtn = modal.querySelector('#bpApply');
  let pending = null;

  const rule = () => {
    const scope = modal.querySelector('#bpScope').value;
    return {
      category: scope === 'All' ? '' : scope,
      field: modal.querySelector('#bpField').value,
      mode: modal.querySelector('#bpMode').value,
      value: Number(modal.querySelector('#bpValue').value) || 0,
      roundTo: Number(modal.querySelector('#bpRound').value) || 0,
    };
  };

  modal.querySelector('#bpMode').addEventListener('change', (e) => {
    modal.querySelector('#bpValLabel').textContent =
      e.target.value === 'pct' ? 'Percent' : (e.target.value === 'set' ? 'New price' : 'Amount');
    invalidate();
  });
  ['#bpScope', '#bpField', '#bpValue', '#bpRound'].forEach((sel) => {
    modal.querySelector(sel).addEventListener('input', invalidate);
    modal.querySelector(sel).addEventListener('change', invalidate);
  });

  function invalidate() {
    pending = null;
    applyBtn.disabled = true;
    body.innerHTML = '';
  }

  function renderChanges(res) {
    if (!res.changes.length) {
      body.innerHTML = emptyState({ icon: '=', title: 'Nothing would change', body: `${res.matched} product${res.matched === 1 ? '' : 's'} matched, but the rule leaves every price where it is.` });
      return;
    }
    body.innerHTML = `
      ${dataTable({
        head: [{ label: 'Item' }, { label: 'SKU' }, { label: 'Now', num: true }, { label: 'After', num: true }],
        bodyHtml: `
            ${res.changes.slice(0, 200).map((c) => `
              <tr>
                <td>${esc(c.name)}</td>
                <td>${esc(c.sku)}</td>
                <td class="num">${fmtMoney(c.oldValue)}</td>
                <td class="num ${c.newValue > c.oldValue ? 'gp' : 'neg'}">${fmtMoney(c.newValue)}</td>
              </tr>`).join('')}`,
      })}
      <p class="muted">${res.changed} of ${res.matched} matched product${res.matched === 1 ? '' : 's'} would change${res.changes.length > 200 ? ' (first 200 shown)' : ''}.</p>`;
  }

  modal.querySelector('#bpPreview').addEventListener('click', async () => {
    err.textContent = '';
    body.innerHTML = skeleton('table', 3);
    try {
      const res = await api.post('/api/admin/products/bulk-price', { ...rule(), preview: true });
      pending = rule();
      renderChanges(res);
      applyBtn.disabled = res.changed === 0;
    } catch (e) {
      body.innerHTML = '';
      err.textContent = (e && e.data && e.data.error) || e.message;
    }
  });

  applyBtn.addEventListener('click', async () => {
    if (!pending) return;
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying…';
    try {
      const res = await api.post('/api/admin/products/bulk-price', pending);
      toast(`${res.changed} price${res.changed === 1 ? '' : 's'} updated`, 'ok');
      beep('ok');
      closeModal();
      if (onDone) await onDone();
    } catch (e) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply';
      err.textContent = (e && e.data && e.data.error) || e.message;
    }
  });

  modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
}

/* ---------------- Stock take ---------------- */

export function stockTakeModal({ products, onDone }) {
  /* Serialized stock is counted by scanning serials, not by typing a number,
     so it is out of scope here — the server refuses it too. */
  const countable = (products || []).filter((p) => p.itemType !== 'service' && !p.isSerialized);
  const counts = new Map();

  const modal = openModal(`
    <div class="form-modal inv-tool">
      <h3>Stock take</h3>
      <p class="muted">Scan or search an item, enter what is physically on the shelf, then commit. Every line is recorded with its variance and what that variance is worth at cost.</p>
      <div class="field">
        <span>Scan barcode or search</span>
        <input id="stSearch" type="search" placeholder="Scan, or type a name or SKU…" autocomplete="off" autocapitalize="off" spellcheck="false">
      </div>
      <div id="stMatches" class="cust-results"></div>
      <div id="stSheet"></div>
      <p id="stErr" class="login-err"></p>
      <div class="row">
        <button class="btn btn-ghost" data-cancel>Close</button>
        <button class="btn" id="stCommit" disabled>Commit count</button>
      </div>
    </div>`);

  const search = modal.querySelector('#stSearch');
  const matches = modal.querySelector('#stMatches');
  const sheet = modal.querySelector('#stSheet');
  const commit = modal.querySelector('#stCommit');
  const err = modal.querySelector('#stErr');

  function addLine(product, counted) {
    counts.set(product.id, {
      product,
      counted: counted == null ? (Number(product.onHand) || 0) : counted,
    });
    renderSheet();
  }

  function renderSheet() {
    if (!counts.size) {
      sheet.innerHTML = emptyState({ icon: '📋', title: 'Nothing counted yet', body: 'Scan an item or search for it to start the sheet.' });
      commit.disabled = true;
      return;
    }
    const rows = [...counts.values()];
    const variance = rows.reduce((n, r) => n + (r.counted - (Number(r.product.onHand) || 0)), 0);
    const value = rows.reduce((n, r) => n + (r.counted - (Number(r.product.onHand) || 0)) * (Number(r.product.costPrice) || 0), 0);
    sheet.innerHTML = `
      ${dataTable({
        extraCls: 'st-table',
        head: [{ label: 'Item' }, { label: 'Book', num: true }, { label: 'Counted', num: true }, { label: 'Variance', num: true }, { label: '' }],
        bodyHtml: `
            ${rows.map((r) => {
              const book = Number(r.product.onHand) || 0;
              const v = r.counted - book;
              return `<tr>
                <td>${esc(r.product.name)}<br><span class="muted">${esc(r.product.sku || '')}</span></td>
                <td class="num">${book}</td>
                <td class="num"><input class="field st-count" data-id="${esc(r.product.id)}" type="number" inputmode="numeric" min="0" step="1" value="${r.counted}"></td>
                <td class="num ${v === 0 ? '' : (v > 0 ? 'gp' : 'neg')}">${v > 0 ? '+' : ''}${v}</td>
                <td><button class="cl-remove" data-drop="${esc(r.product.id)}" aria-label="Remove line">✕</button></td>
              </tr>`;
            }).join('')}`,
        footHtml: `<tr>
            <td colspan="3">${rows.length} line${rows.length === 1 ? '' : 's'} · net variance</td>
            <td class="num ${variance === 0 ? '' : (variance > 0 ? 'gp' : 'neg')}">${variance > 0 ? '+' : ''}${variance}</td>
            <td class="num ${value === 0 ? '' : (value > 0 ? 'gp' : 'neg')}">${fmtMoney(value)}</td>
          </tr>`,
      })}`;
    commit.disabled = false;

    sheet.querySelectorAll('.st-count').forEach((inp) => {
      inp.addEventListener('focus', () => inp.select());
      inp.addEventListener('change', () => {
        const entry = counts.get(inp.dataset.id);
        const v = parseInt(inp.value, 10);
        if (!entry) return;
        entry.counted = isNaN(v) || v < 0 ? 0 : v;
        renderSheet();
      });
    });
    sheet.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', () => {
      counts.delete(b.dataset.drop);
      renderSheet();
    }));
  }

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { matches.innerHTML = ''; return; }
    const hits = countable.filter((p) => p.name.toLowerCase().includes(q)
      || (p.sku || '').toLowerCase().includes(q)
      || (p.upc || '').toLowerCase().includes(q)).slice(0, 8);
    matches.innerHTML = hits.map((p) => `
      <button class="cust-row" data-pick="${esc(p.id)}">
        ${esc(p.name)}<em class="muted">${esc(p.sku || '')} · book ${Number(p.onHand) || 0}</em>
      </button>`).join('') || '<p class="muted">No countable item matches — serialized stock is counted by serial.</p>';
    matches.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      const p = countable.find((x) => x.id === b.dataset.pick);
      if (p) { addLine(p); search.value = ''; matches.innerHTML = ''; search.focus(); }
    }));
  });

  /* A handheld scanner types the code then presses Enter: match it exactly and
     drop straight onto the sheet so counting never leaves the keyboard. */
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = search.value.trim();
    if (!raw) return;
    const hit = countable.find((p) => (p.upc && p.upc.trim() === raw)
      || (p.sku && p.sku.trim().toLowerCase() === raw.toLowerCase()));
    if (hit) {
      const existing = counts.get(hit.id);
      addLine(hit, existing ? existing.counted + 1 : 1);
      beep('ok');
      search.value = '';
      matches.innerHTML = '';
    } else {
      beep('err');
      toast(`No countable item matches “${raw}”`, 'warn');
    }
  });

  commit.addEventListener('click', async () => {
    err.textContent = '';
    commit.disabled = true;
    commit.textContent = 'Committing…';
    try {
      const res = await api.post('/api/admin/stock-take', {
        counts: [...counts.values()].map((r) => ({ productId: r.product.id, counted: r.counted })),
        note: 'stock take',
      });
      closeModal();
      toast(`Counted ${res.summary.lines} · ${res.summary.adjusted} adjusted · ${fmtMoney(res.summary.valueDelta)} at cost`,
        res.summary.valueDelta < 0 ? 'warn' : 'ok', 5000);
      beep('ok');
      if (onDone) await onDone();
    } catch (e) {
      commit.disabled = false;
      commit.textContent = 'Commit count';
      err.textContent = (e && e.data && e.data.error) || e.message;
    }
  });

  modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
  renderSheet();
  search.focus();
}

/* ---------------- Barcode labels ---------------- */

export function labelsModal({ products, storeName }) {
  const labelable = (products || []).filter((p) => p.itemType !== 'service' && labelCode(p));
  const qty = {};

  const modal = openModal(`
    <div class="form-modal inv-tool">
      <h3>Print shelf labels</h3>
      <p class="muted">Code 128 barcodes with name and price. Items are labelled by UPC where they have one, otherwise by SKU.</p>
      <div class="field">
        <span>Search</span>
        <input id="lbSearch" type="search" placeholder="Filter by name or SKU…" autocomplete="off">
      </div>
      <div class="row lb-quick">
        <button class="btn btn-ghost btn-sm" id="lbOne">1 each (shown)</button>
        <button class="btn btn-ghost btn-sm" id="lbClear">Clear</button>
      </div>
      <div id="lbList" class="ph-body"></div>
      <div id="lbPreview" class="lbl-preview"></div>
      <div class="row">
        <button class="btn btn-ghost" data-cancel>Close</button>
        <button class="btn" id="lbPrint" disabled>Print</button>
      </div>
    </div>`);

  const list = modal.querySelector('#lbList');
  const preview = modal.querySelector('#lbPreview');
  const printBtn = modal.querySelector('#lbPrint');
  const search = modal.querySelector('#lbSearch');

  function shown() {
    const q = search.value.trim().toLowerCase();
    return labelable.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
  }

  function total() {
    return labelsFor(labelable, qty).length;
  }

  function render() {
    const rows = shown().slice(0, 60);
    list.innerHTML = rows.length ? dataTable({
          head: [{ label: 'Item' }, { label: 'Code' }, { label: 'Price', num: true }, { label: 'Labels', num: true }],
          bodyHtml: `
            ${rows.map((p) => `
              <tr>
                <td>${esc(p.name)}</td>
                <td>${esc(labelCode(p))}</td>
                <td class="num">${fmtMoney(p.retailPrice)}</td>
                <td class="num"><input class="field lb-qty" data-id="${esc(p.id)}" type="number" inputmode="numeric" min="0" max="200" step="1" value="${qty[p.id] || 0}"></td>
              </tr>`).join('')}`,
        })
      : emptyState({ icon: '🏷', title: 'Nothing to label', body: 'Only products with a UPC or SKU can carry a barcode.' });

    list.querySelectorAll('.lb-qty').forEach((inp) => {
      inp.addEventListener('focus', () => inp.select());
      inp.addEventListener('input', () => {
        const v = parseInt(inp.value, 10);
        qty[inp.dataset.id] = isNaN(v) || v < 0 ? 0 : Math.min(200, v);
        updateTotals();
      });
    });
    updateTotals();
  }

  function updateTotals() {
    const n = total();
    printBtn.disabled = n === 0;
    printBtn.textContent = n ? `Print ${n} label${n === 1 ? '' : 's'}` : 'Print';
    const sample = labelsFor(labelable, qty).slice(0, 3);
    preview.innerHTML = sample.length
      ? `<p class="muted">Preview</p>${labelSheetHtml(sample, { fmt: fmtMoney, store: storeName })}`
      : '';
  }

  search.addEventListener('input', render);
  modal.querySelector('#lbOne').addEventListener('click', () => {
    for (const p of shown()) qty[p.id] = 1;
    render();
  });
  modal.querySelector('#lbClear').addEventListener('click', () => {
    for (const k of Object.keys(qty)) delete qty[k];
    render();
  });
  printBtn.addEventListener('click', () => {
    const labels = labelsFor(labelable, qty);
    if (!labels.length) return;
    closeModal();
    printNode(labelSheetHtml(labels, { fmt: fmtMoney, store: storeName }), '');
  });
  modal.querySelector('[data-cancel]').addEventListener('click', closeModal);

  render();
}

/* ---------------- Reorder worksheet ---------------- */

export function reorderModal() {
  const modal = openModal(`
    <div class="form-modal inv-tool">
      <h3>Reorder worksheet</h3>
      <p class="muted">What to buy next: shelves at or under their reorder point, or short of the target cover at the current sales rate. Suggestions only — nothing is ordered here.</p>
      <div class="two fields-row">
        <div class="field"><span>Sales window (days)</span>
          <input id="roDays" type="number" inputmode="numeric" min="1" max="365" step="1" value="30">
        </div>
        <div class="field"><span>Target cover (days)</span>
          <input id="roCover" type="number" inputmode="numeric" min="1" max="180" step="1" value="14">
        </div>
      </div>
      <div class="row">
        <button class="btn btn-ghost btn-sm" id="roRun">Recalculate</button>
        <button class="btn btn-ghost btn-sm" id="roCsv" disabled>CSV</button>
        <button class="btn btn-ghost btn-sm" id="roPrint" disabled>Print</button>
      </div>
      <div id="roBody" class="ph-body">${skeleton('table', 4)}</div>
      <div class="row"><button class="btn btn-ghost" data-cancel>Close</button></div>
    </div>`);

  const body = modal.querySelector('#roBody');
  const csvBtn = modal.querySelector('#roCsv');
  const printBtn = modal.querySelector('#roPrint');
  let data = null;

  function tableHtml(items) {
    return dataTable({
          head: [
            { label: 'Item' }, { label: 'Supplier' }, { label: 'On hand', num: true },
            { label: 'Sold', num: true }, { label: 'Cover', num: true },
            { label: 'Order', num: true }, { label: 'Est. cost', num: true },
          ],
          bodyHtml: `
            ${items.map((it) => `
              <tr>
                <td>${esc(it.name)}<br><span class="muted">${esc(it.sku || '')}</span></td>
                <td>${esc(it.supplierName || '—')}${it.lastPo ? `<br><span class="muted">${esc(it.lastPo)}</span>` : ''}</td>
                <td class="num ${it.onHand <= 0 ? 'neg' : ''}">${it.onHand}</td>
                <td class="num">${it.soldUnits}</td>
                <td class="num">${it.daysOfCover == null ? '—' : it.daysOfCover + 'd'}</td>
                <td class="num"><strong>${it.suggested}</strong></td>
                <td class="num">${fmtMoney(it.lineCost)}</td>
              </tr>`).join('')}`,
          footHtml: `<tr>
            <td colspan="5">${items.length} line${items.length === 1 ? '' : 's'}</td>
            <td class="num">${items.reduce((n, x) => n + x.suggested, 0)}</td>
            <td class="num">${fmtMoney(items.reduce((n, x) => n + x.lineCost, 0))}</td>
          </tr>`,
        });
  }

  async function run() {
    body.innerHTML = skeleton('table', 4);
    csvBtn.disabled = true;
    printBtn.disabled = true;
    const days = Math.max(1, Math.min(365, parseInt(modal.querySelector('#roDays').value, 10) || 30));
    const cover = Math.max(1, Math.min(180, parseInt(modal.querySelector('#roCover').value, 10) || 14));
    try {
      data = await api.get(`/api/inventory/reorder?days=${days}&cover=${cover}`);
      if (!data.items.length) {
        body.innerHTML = emptyState({ icon: '✅', title: 'Nothing to reorder', body: 'Every shelf is above its reorder point and covered at the current sales rate.' });
        return;
      }
      body.innerHTML = `
        ${statRow([
          { label: 'Lines', value: data.summary.lines },
          { label: 'Units', value: data.summary.units },
          { label: 'Est. cost', value: fmtMoney(data.summary.cost) },
        ])}
        ${tableHtml(data.items)}`;
      csvBtn.disabled = false;
      printBtn.disabled = false;
    } catch (e) {
      data = null;
      body.innerHTML = `<p class="empty">${esc((e && e.data && e.data.error) || 'Failed to load — check connection.')}</p>`;
    }
  }

  csvBtn.addEventListener('click', () => {
    if (!data) return;
    const rows = [['sku', 'name', 'category', 'supplier', 'last_po', 'on_hand', 'reorder_point', 'sold_units', 'per_day', 'days_of_cover', 'order_qty', 'unit_cost', 'line_cost']];
    for (const it of data.items) {
      rows.push([it.sku, it.name, it.category, it.supplierName, it.lastPo, it.onHand, it.reorderPoint,
        it.soldUnits, it.perDay, it.daysOfCover == null ? '' : it.daysOfCover, it.suggested,
        Number(it.unitCost).toFixed(2), Number(it.lineCost).toFixed(2)]);
    }
    downloadCsv(`orison-reorder-${String(data.asOf).slice(0, 10)}.csv`, csvRows(rows));
    toast('Reorder worksheet downloaded', 'ok');
  });

  printBtn.addEventListener('click', () => {
    if (!data) return;
    printNode(tableHtml(data.items), `Reorder worksheet · ${String(data.asOf).slice(0, 10)}`);
  });

  modal.querySelector('#roRun').addEventListener('click', run);
  modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
  run();
}
