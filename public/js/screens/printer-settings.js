'use strict';

/* Settings → Printer & cash drawer. Per terminal: each till has its own
   printer. Every choice saves as it is made, so there is no Save button to
   forget. */

import { esc, fmt, toast } from '../ui.js';
import { receiptDoc } from '../receipt-doc.js';
import {
  bluetooth, canUseBluetooth, getPrinterSettings, kickDrawer, printDoc, setPrinterSettings,
} from '../printing.js';

const MODES = [
  {
    id: 'dialog',
    label: 'Receipt printer',
    help: 'Prints through this computer\'s print dialog at roll width. Works with any receipt printer installed on the computer, USB or network. A cash drawer cannot be opened this way.',
  },
  {
    id: 'sheet',
    label: 'Standard printer',
    help: 'Prints a full page on an ordinary office or home printer.',
  },
  {
    id: 'bluetooth',
    label: 'Bluetooth printer',
    help: 'Prints straight to a Bluetooth receipt printer with no dialog, and can open a cash drawer plugged into it. Needs Chrome or Edge on Windows, Mac, Chromebook or Android - not an iPhone or iPad - and a printer that supports Bluetooth Low Energy.',
  },
];

export function printerCardHtml() {
  return `
    <section class="set-card" id="prCard">
      <h3>Printer &amp; cash drawer</h3>
      <p class="muted">Set for this terminal only.</p>
      <div class="field"><span>Print receipts on</span>
        <div class="seg seg-sm" id="prMode">
          ${MODES.map((m) => `<button class="seg-btn" data-mode="${m.id}" type="button">${esc(m.label)}</button>`).join('')}
        </div>
      </div>
      <p class="muted" id="prHelp"></p>

      <div class="field" id="prPaperRow"><span>Roll width</span>
        <div class="seg seg-sm" id="prPaper">
          <button class="seg-btn" data-paper="58" type="button">58 mm</button>
          <button class="seg-btn" data-paper="80" type="button">80 mm</button>
        </div>
      </div>

      <div class="field" id="prPageRow"><span>Paper size</span>
        <div class="seg seg-sm" id="prPage">
          <button class="seg-btn" data-page="auto" type="button">Printer default</button>
          <button class="seg-btn" data-page="a4" type="button">A4</button>
          <button class="seg-btn" data-page="letter" type="button">Letter</button>
        </div>
      </div>

      <div id="prBtRow">
        <div class="set-row"><span>Bluetooth printer</span><span id="prBtStatus">Not connected</span></div>
        <p class="muted" id="prBtUnsupported" hidden>This browser cannot use Bluetooth printers. Open the till in Chrome or Edge on a Windows, Mac, Chromebook or Android device.</p>
        <div class="row"><button class="btn btn-ghost" id="prBtConnect" type="button">Connect printer</button></div>
      </div>

      <label class="check"><input id="prAuto" type="checkbox"> Print a receipt automatically after every sale</label>

      <div id="prDrawerRow">
        <label class="check"><input id="prDrawerOn" type="checkbox"> A cash drawer is plugged into this printer</label>
        <div id="prDrawerOpts">
          <div class="field"><span>Drawer wiring</span>
            <div class="seg seg-sm" id="prPin">
              <button class="seg-btn" data-pin="2" type="button">Pin 2 (most drawers)</button>
              <button class="seg-btn" data-pin="5" type="button">Pin 5</button>
            </div>
          </div>
          <label class="check"><input id="prKick" type="checkbox"> Open the drawer after a cash sale</label>
          <div class="row"><button class="btn btn-ghost" id="prDrawerTest" type="button">Test the drawer</button></div>
        </div>
      </div>

      <div class="row"><button class="btn" id="prTest" type="button">Print a test receipt</button></div>
      <p id="prMsg" class="muted" role="status"></p>
    </section>`;
}

function testDoc(storeName) {
  return receiptDoc({
    createdAt: new Date().toISOString(),
    cashier: 'Test print',
    items: [
      { name: 'Test item', quantity: 1, unitPrice: 10 },
      { name: 'A longer item name, to check the line wraps cleanly', quantity: 2, unitPrice: 2.5 },
    ],
    subtotal: 15, total: 15, tenders: [{ type: 'cash', amount: 20 }], receiptNo: 'TEST',
  }, { storeName });
}

export async function mountPrinterCard(root, { storeName = '' } = {}) {
  const card = root.querySelector('#prCard');
  if (!card) return;
  const msg = card.querySelector('#prMsg');
  let s = await getPrinterSettings();

  const say = (text, tone) => {
    msg.textContent = text || '';
    msg.className = tone === 'bad' ? 'tag-bad' : tone === 'ok' ? 'tag-ok' : 'muted';
  };

  async function save(patch) {
    s = await setPrinterSettings({ ...s, ...patch });
    paint();
  }

  function paint() {
    const mode = MODES.find((m) => m.id === s.mode);
    card.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === s.mode));
    card.querySelector('#prHelp').textContent = mode ? mode.help : '';
    card.querySelectorAll('[data-paper]').forEach((b) => b.classList.toggle('on', Number(b.dataset.paper) === s.paper));
    card.querySelectorAll('[data-page]').forEach((b) => b.classList.toggle('on', b.dataset.page === s.page));
    card.querySelectorAll('[data-pin]').forEach((b) => b.classList.toggle('on', Number(b.dataset.pin) === s.drawerPin));

    card.querySelector('#prPaperRow').hidden = s.mode === 'sheet';
    card.querySelector('#prPageRow').hidden = s.mode !== 'sheet';
    card.querySelector('#prBtRow').hidden = s.mode !== 'bluetooth';
    card.querySelector('#prDrawerRow').hidden = s.mode !== 'bluetooth';
    card.querySelector('#prDrawerOpts').hidden = s.drawer !== 'bluetooth';

    const supported = canUseBluetooth();
    card.querySelector('#prBtUnsupported').hidden = supported;
    card.querySelector('#prBtConnect').hidden = !supported;
    card.querySelector('#prBtStatus').textContent = bluetooth.connected
      ? `Connected: ${bluetooth.name}`
      : s.deviceName ? `${s.deviceName} (not connected)` : 'Not connected';
    card.querySelector('#prBtConnect').textContent = bluetooth.connected ? 'Connect a different printer' : 'Connect printer';

    card.querySelector('#prAuto').checked = s.autoPrint;
    card.querySelector('#prDrawerOn').checked = s.drawer === 'bluetooth';
    card.querySelector('#prKick').checked = s.kickOnCash;
  }

  card.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => save({ mode: b.dataset.mode })));
  card.querySelectorAll('[data-paper]').forEach((b) => b.addEventListener('click', () => save({ paper: Number(b.dataset.paper) })));
  card.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => save({ page: b.dataset.page })));
  card.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', () => save({ drawerPin: Number(b.dataset.pin) })));
  card.querySelector('#prAuto').addEventListener('change', (e) => save({ autoPrint: e.target.checked }));
  card.querySelector('#prDrawerOn').addEventListener('change', (e) => save({ drawer: e.target.checked ? 'bluetooth' : 'none' }));
  card.querySelector('#prKick').addEventListener('change', (e) => save({ kickOnCash: e.target.checked }));

  card.querySelector('#prBtConnect').addEventListener('click', async () => {
    say('Choose the printer in the list the browser shows…');
    try {
      /* requestDevice must run inside this click, or the browser refuses it. */
      const dev = await bluetooth.connect();
      await save({ deviceId: dev.id, deviceName: dev.name });
      say(`Connected to ${dev.name}.`, 'ok');
    } catch (e) {
      const text = String((e && e.message) || e);
      say(/cancel/i.test(text) || (e && e.name === 'NotFoundError')
        ? 'No printer was chosen.'
        : `Could not connect: ${text}`, /cancel/i.test(text) ? '' : 'bad');
      paint();
    }
  });

  card.querySelector('#prTest').addEventListener('click', async () => {
    say('Printing…');
    const r = await printDoc(testDoc(storeName));
    if (r.ok) say(r.method === 'raster' ? 'Sent as an image, so every symbol prints.' : 'Sent.', 'ok');
    else say(r.message, 'bad');
  });

  card.querySelector('#prDrawerTest').addEventListener('click', async () => {
    const r = await kickDrawer();
    if (r.ok) { say('Drawer pulse sent.', 'ok'); toast('Drawer pulse sent', 'ok'); } else say(r.message, 'bad');
  });

  paint();

  /* After a reload the connection is gone; get it back quietly if the browser
     still remembers this printer. */
  if (s.mode === 'bluetooth' && s.deviceId && !bluetooth.connected) {
    if (await bluetooth.reconnect(s.deviceId)) paint();
  }
}
