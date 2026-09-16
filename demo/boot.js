/* Orison POS demo: boot.

   Loaded before the app in the demo build only. It points the app at a
   backend that lives in this page (the real Code.gs on an emulator of the
   Google services, see gas-emulator.js), seeds a sample shop the first time,
   and adds the demo guide: who to sign in as, what to try, and a reset. */

(function () {
  'use strict';

  var SCRIPT = document.currentScript && document.currentScript.src;
  var here = function (file) { return new URL(file, SCRIPT || location.href).href; };
  var DEMO_URL = 'https://demo.orison-pos.invalid/exec';
  var STATE_KEY = 'orison-demo-state-v1';
  var WIPE_KEY = 'orison-demo-wipe';
  var SIGNIN_KEY = 'orison-demo-signin';
  var WELCOME_KEY = 'orison-demo-welcomed';

  window.ORISON_DEMO = { serverUrl: DEMO_URL, appToken: 'orison-demo' };

  /* A reset asked for on the previous page: wipe before the app opens its database. */
  try {
    if (localStorage.getItem(WIPE_KEY) === '1') {
      localStorage.removeItem(WIPE_KEY);
      localStorage.removeItem(STATE_KEY);
      localStorage.removeItem(WELCOME_KEY);
      indexedDB.deleteDatabase('orison-pos');
    }
  } catch (_) {}

  var mods = null;
  var runtime = null;
  function load() {
    if (!mods) {
      mods = Promise.all([
        import(here('gas-emulator.js')),
        import(here('seed-demo.js')),
        fetch(here('Code.gs.txt')).then(function (r) { return r.text(); }),
      ]).then(function (m) {
        var emu = m[0], seed = m[1];
        var storage = emu.localStorageAdapter(STATE_KEY);
        var fresh = !storage.load();
        runtime = emu.createGasRuntime({ source: m[2], storage: storage, appToken: 'orison-demo' });
        if (fresh) seed.seedDemo(runtime);
        return { rt: runtime, accounts: seed.DEMO_ACCOUNTS };
      });
    }
    return mods;
  }
  window.ORISON_DEMO.ready = load;

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url);
    if (url !== DEMO_URL) return realFetch(input, init);
    return load().then(function (d) {
      var envelope = JSON.parse((init && init.body) || '{}');
      var out;
      try { out = d.rt.handle(envelope); } catch (err) {
        out = { ok: false, status: 500, error: 'Demo backend error: ' + (err && err.message) };
      }
      /* a touch of latency, so loading states are seen as they would be */
      return new Promise(function (res) {
        setTimeout(function () {
          res(new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } }));
        }, 80);
      });
    });
  };

  /* ---------- the demo guide ---------- */

  var ROLE_NOTES = {
    admin: 'Everything: the books (Accounts), audit log, staff, store settings, marketplace sheet.',
    manager: 'Runs the floor: reports, cash out, refunds, purchasing, approvals, team tools.',
    cashier: 'The counter: sell, repairs, trade-ins and refunds with a manager’s approval.',
  };

  var TRY = [
    ['Cashier', 'Sell a phone with a case: scan or search, take card or cash, and print or send the receipt.'],
    ['Cashier', 'Give a 20% discount. A cashier can only give 10%, so a manager approves it on your screen with their own email and PIN.'],
    ['Cashier', 'Book in a repair, take a deposit, then collect the ready battery job (James Okafor).'],
    ['Cashier', 'Take a trade-in: seller, ID checked, IMEI and condition. A manager approves the amount.'],
    ['Manager', 'Refund part of a sale from History. Services cannot be refunded.'],
    ['Manager', 'Record paid out, a cash pick-up or a staff expense, then close the till shift and count the drawer.'],
    ['Manager', 'Receive the purchase order that is on its way (Purchases).'],
    ['Manager', 'Take a payment from Liberty Phone Repair, who buy on account.'],
    ['Admin', 'Settings → Marketplace orders → Import now. Three orders wait in the demo sheet.'],
    ['Admin', 'Accounts: profit and loss, trial balance and journal for the month.'],
    ['Anyone', 'Switch the language to Arabic or Urdu on the sign-in screen.'],
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clearSession() {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () { if (!done) { done = true; resolve(); } };
      setTimeout(finish, 1500);
      try {
        var open = indexedDB.open('orison-pos');
        open.onsuccess = function () {
          var db = open.result;
          if (!db.objectStoreNames.contains('meta')) { db.close(); finish(); return; }
          var tx = db.transaction('meta', 'readwrite');
          var store = tx.objectStore('meta');
          var get = store.get('config');
          get.onsuccess = function () {
            var v = get.result;
            if (v) { delete v.token; delete v.user; if (store.keyPath) store.put(v); else store.put(v, 'config'); }
          };
          tx.oncomplete = function () { db.close(); finish(); };
          tx.onerror = function () { db.close(); finish(); };
        };
        open.onerror = finish;
      } catch (_) { finish(); }
    });
  }

  function signInAs(acct) {
    try { sessionStorage.setItem(SIGNIN_KEY, JSON.stringify({ email: acct.email, pin: acct.pin })); } catch (_) {}
    clearSession().then(function () { location.reload(); });
  }

  function finishPendingSignIn() {
    var pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(SIGNIN_KEY) || 'null'); } catch (_) {}
    if (!pending) return;
    var tries = 0;
    var timer = setInterval(function () {
      var email = document.getElementById('loginEmail');
      var pin = document.getElementById('loginPin');
      var btn = document.getElementById('loginBtn');
      if (email && pin && btn) {
        clearInterval(timer);
        try { sessionStorage.removeItem(SIGNIN_KEY); } catch (_) {}
        email.value = pending.email;
        email.dispatchEvent(new Event('input', { bubbles: true }));
        String(pending.pin).split('').forEach(function (d) {
          pin.dispatchEvent(new KeyboardEvent('keydown', { key: d, bubbles: true, cancelable: true }));
        });
        setTimeout(function () { if (!btn.disabled) btn.click(); }, 50);
      } else if (++tries > 100) {
        clearInterval(timer);
        try { sessionStorage.removeItem(SIGNIN_KEY); } catch (_) {}
      }
    }, 100);
  }

  function sheetTable(grid) {
    if (!grid || !grid.length) return '<p class="odemo-muted">Empty.</p>';
    return '<div class="odemo-scroll"><table class="odemo-table"><thead><tr>' +
      grid[0].map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      grid.slice(1).map(function (r) {
        return '<tr>' + grid[0].map(function (_, i) { return '<td>' + esc(r[i]) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function openGuide(view) {
    load().then(function (d) {
      var root = document.getElementById('odemo-panel');
      if (!root) {
        root = document.createElement('div');
        root.id = 'odemo-panel';
        document.body.appendChild(root);
      }
      var st = d.rt.state();
      var bookId = st.props.MARKETPLACE_SHEET_ID;
      var book = bookId && st.books[bookId];
      var body;
      if (view === 'sheet') {
        body =
          '<p class="odemo-muted">In a real install this is the shop’s own Google Sheet. Here it lives in the demo. ' +
          'Import from Settings → Marketplace orders and watch the Status column fill in.</p>' +
          '<h3>Orders</h3>' + sheetTable(book && book.sheets.Orders) +
          '<h3>Stock</h3>' + sheetTable(book && book.sheets.Stock) +
          '<div class="odemo-row"><button type="button" class="odemo-btn odemo-ghost" data-view="home">Back</button></div>';
      } else {
        body =
          '<p>This is the real Orison POS with a sample shop, <b>Orison Electronics – Main Street</b>. ' +
          'It runs entirely in this browser: nothing is sent anywhere, and nothing here touches the real store. ' +
          'What you do is kept in this browser until you reset.</p>' +
          '<h3>Sign in as</h3>' +
          '<div class="odemo-scroll"><table class="odemo-table odemo-accounts"><thead><tr><th>Role</th><th>Name</th><th>Email</th><th>PIN</th><th></th></tr></thead><tbody>' +
          d.accounts.map(function (a, i) {
            return '<tr><td><span class="odemo-role odemo-' + a.role + '">' + esc(a.role) + '</span></td><td>' + esc(a.name) +
              '</td><td><code>' + esc(a.email) + '</code></td><td><code>' + esc(a.pin) + '</code></td>' +
              '<td><button type="button" class="odemo-btn" data-acct="' + i + '">Sign in</button></td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<p class="odemo-muted">' + ['admin', 'manager', 'cashier'].map(function (r) { return '<b>' + r + '</b>: ' + esc(ROLE_NOTES[r]); }).join('<br>') + '</p>' +
          '<h3>Things to try</h3><ul class="odemo-try">' +
          TRY.map(function (t) { return '<li><span class="odemo-tag">' + esc(t[0]) + '</span> ' + esc(t[1]) + '</li>'; }).join('') + '</ul>' +
          '<h3>Different in the demo</h3><ul class="odemo-try odemo-muted">' +
          '<li>Google Drive export opens the CSV in a new tab instead of saving to Drive. Scheduled report emails are not sent.</li>' +
          '<li>The marketplace Google Sheet is built in: <button type="button" class="odemo-link" data-view="sheet">view the demo sheet</button>.</li>' +
          '<li>Receipt printers and cash drawers need the real hardware; the standard print dialog works.</li>' +
          '</ul>' +
          '<div class="odemo-row"><button type="button" class="odemo-btn odemo-danger" id="odemo-reset">Reset demo data</button>' +
          '<button type="button" class="odemo-btn odemo-ghost" id="odemo-close">Close</button></div>';
      }
      root.innerHTML =
        '<div class="odemo-backdrop" data-close="1"><div class="odemo-card" role="dialog" aria-modal="true" aria-labelledby="odemo-title">' +
        '<div class="odemo-head"><h2 id="odemo-title">Orison POS demo</h2><button type="button" class="odemo-x" aria-label="Close" data-close="1">×</button></div>' +
        body + '</div></div>';
      root.hidden = false;
      root.onclick = function (e) {
        var t = e.target;
        if (t.getAttribute('data-close') === '1' || t.id === 'odemo-close') { root.hidden = true; return; }
        if (t.hasAttribute('data-acct')) { signInAs(d.accounts[Number(t.getAttribute('data-acct'))]); return; }
        if (t.hasAttribute('data-view')) { openGuide(t.getAttribute('data-view')); return; }
        if (t.id === 'odemo-reset') {
          if (!window.confirm('Reset the demo? Every sale, customer and change made in this browser goes, and the sample shop comes back.')) return;
          try { localStorage.setItem(WIPE_KEY, '1'); sessionStorage.removeItem(SIGNIN_KEY); } catch (_) {}
          clearSession().then(function () { location.reload(); });
        }
      };
      try { localStorage.setItem(WELCOME_KEY, '1'); } catch (_) {}
    });
  }
  window.ORISON_DEMO.openGuide = openGuide;

  function mountRibbon() {
    var pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'odemo-pill';
    pill.innerHTML = '<b>DEMO</b><span>sample shop · guide & sign-ins</span>';
    pill.addEventListener('click', function () { openGuide('home'); });
    document.body.appendChild(pill);
    document.documentElement.classList.add('odemo-on');
    var welcomed = false;
    try { welcomed = localStorage.getItem(WELCOME_KEY) === '1'; } catch (_) {}
    var pending = false;
    try { pending = !!sessionStorage.getItem(SIGNIN_KEY); } catch (_) {}
    if (!welcomed && !pending) openGuide('home');
    finishPendingSignIn();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountRibbon);
  else mountRibbon();
})();
