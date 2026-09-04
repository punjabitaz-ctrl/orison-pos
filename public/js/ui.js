'use strict';

/* Shared UI helpers: money formatting, dom builder, toasts, modals, sheets,
   scan beeps, and camera barcode reading (BarcodeDetector when available). */

export function fmt(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function fmtQty(n) {
  return String(Number(n) || 0);
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let _ac = null;
export function beep(kind = 'ok') {
  try {
    if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
    if (_ac.state === 'suspended') _ac.resume();
    const ctx = _ac;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    if (kind === 'ok') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1320, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now); osc.stop(now + 0.13);
    } else {
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now); osc.stop(now + 0.26);
    }
  } catch (_) { /* audio unavailable */ }
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const TOAST_TYPES = { info: '', ok: 't-ok', warn: 't-warn', err: 't-err' };
export function toast(msg, type = 'info', ms = 3200) {
  const wrap = document.getElementById('toasts');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (TOAST_TYPES[type] || '');
  el.textContent = msg;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

export function openModal(html) {
  const root = document.getElementById('modal');
  root.innerHTML = `<div class="modal-backdrop" data-close><div class="modal" role="dialog">${html}</div></div>`;
  root.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target === el) closeModal();
  }));
  return root.querySelector('.modal');
}

export function closeModal() {
  document.getElementById('modal').innerHTML = '';
}

export function openSheet(html) {
  const root = document.getElementById('sheet');
  root.innerHTML = `<div class="sheet-backdrop" data-close><div class="sheet" role="dialog">${html}</div></div>`;
  root.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target === el) closeSheet();
  }));
  return root.querySelector('.sheet');
}

export function closeSheet() {
  document.getElementById('sheet').innerHTML = '';
}

export function hasBarcodeDetector() {
  return 'BarcodeDetector' in window;
}

/* Camera barcode/IMEI reader. Returns a promise that resolves the decoded
   string or rejects with a friendly message. */
export function scanFromCamera() {
  return new Promise((resolve, reject) => {
    if (!hasBarcodeDetector()) {
      reject(new Error('Camera scanning unsupported on this device — use the search bar with a handheld scanner.'));
      return;
    }
    const detector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
    });

    const modal = openModal(`
      <div class="scan-stage">
        <video id="scanVideo" autoplay playsinline muted></video>
        <div class="scan-frame"></div>
        <p class="scan-hint">Point the camera at the barcode or IMEI label</p>
        <div class="scan-actions">
          <button class="btn btn-ghost" data-close>Cancel</button>
        </div>
      </div>
    `);
    const video = modal.querySelector('#scanVideo');
    let stream = null;
    let done = false;
    let raf = 0;

    function finish(value, err) {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      closeModal();
      if (err) reject(err); else resolve(value);
    }

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
    }).then((s) => {
      stream = s;
      video.srcObject = s;
      video.play().catch(() => {});
      const tick = async () => {
        if (done) return;
        try {
          const codes = await detector.detect(video);
          if (codes && codes.length) {
            finish(codes[0].rawValue, null);
            return;
          }
        } catch (_) { /* detection hiccup */ }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }).catch((e) => {
      finish(null, new Error('Camera unavailable: ' + (e && e.message ? e.message : 'permission denied')));
    });

    const closeBtn = modal.querySelector('[data-close]');
    if (closeBtn) closeBtn.addEventListener('click', () => finish(null, new Error('Scan cancelled')));
  });
}

/* Build a DOM element tree from a template string. */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}