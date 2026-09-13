import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/* Every translatable string in the app, collected from source, must exist in
   every catalogue - with the same placeholders, and with every plural form the
   language needs. This is what makes a half-translated screen fail the build
   instead of reaching a till. */

const ROOT = process.cwd();
const JS = path.join(ROOT, 'public', 'js');

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'lang') out.push(...files(p)); }
    else if (e.name.endsWith('.js') && e.name !== 'i18n.js' && e.name !== 'lang.js') out.push(p);
  }
  return out;
}

const STR = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|\x60((?:[^\x60\\$]|\\.|\$(?!\{))*)\x60`;
const unescape = (s) => s.replace(/\\(['"\x60\\])/g, '$1').replace(/\\n/g, '\n');
const pick = (m, i) => unescape(m[i] ?? m[i + 1] ?? m[i + 2]);

export function collect() {
  const plain = new Set();
  const plural = new Set();
  const where = new Map();
  const note = (k, f) => { if (!where.has(k)) where.set(k, path.relative(ROOT, f)); };

  for (const f of files(JS)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(new RegExp(String.raw`(?<![\w$])(?:\$t|N_)\(\s*(?:${STR})`, 'g'))) { const k = pick(m, 1); plain.add(k); note(k, f); }
    for (const m of src.matchAll(new RegExp(String.raw`\btIn\(\s*[^,]+,\s*(?:${STR})`, 'g'))) { const k = pick(m, 1); plain.add(k); note(k, f); }
    for (const m of src.matchAll(new RegExp(String.raw`(?<![\w$])\$tn\(\s*(?:${STR})\s*,\s*(?:${STR})`, 'g'))) { const k = pick(m, 4); plural.add(k); note(k, f); }
    for (const m of src.matchAll(new RegExp(String.raw`\btnIn\(\s*[^,]+,\s*(?:${STR})\s*,\s*(?:${STR})`, 'g'))) { const k = pick(m, 4); plural.add(k); note(k, f); }
  }

  /* Fixed server messages reach the screen through api.js, which translates
     them. Only whole literals - a message glued to a number stays English. */
  const gs = fs.readFileSync(path.join(ROOT, 'backend', 'Code.gs'), 'utf8');
  for (const m of gs.matchAll(/statusError_\(\s*\d{3}\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) {
    const k = unescape(m[1]);
    /* Machine codes (no_open_shift) and lowercase developer-facing validation
       (customerId is required) are not written for a cashier to read. */
    if (!/^[A-Z]/.test(k)) continue;
    plain.add(k);
    note(k, path.join(ROOT, 'backend', 'Code.gs'));
  }
  for (const k of plural) plain.delete(k);
  return { plain, plural, where };
}

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const { plain, plural, where } = collect();

for (const code of ['ar', 'ur']) {
  describe(`${code} catalogue`, async () => {
    const cat = (await import(`../public/js/lang/${code}.js`)).default;
    const needed = new Intl.PluralRules(code).resolvedOptions().pluralCategories;

    it('has every string on every screen', () => {
      const missing = [...plain, ...plural].filter((k) => !Object.prototype.hasOwnProperty.call(cat, k));
      assert.deepEqual(missing.map((k) => `${where.get(k)}: ${k}`), []);
    });

    it('carries nothing the app no longer uses', () => {
      const stale = Object.keys(cat).filter((k) => !plain.has(k) && !plural.has(k));
      assert.deepEqual(stale, []);
    });

    it('keeps every placeholder, so no value silently vanishes', () => {
      const bad = [];
      for (const k of plain) {
        const v = cat[k];
        if (typeof v !== 'string') { bad.push(`${k}: not a string`); continue; }
        if (placeholders(k).join() !== placeholders(v).join()) bad.push(`${k} -> ${v}`);
      }
      for (const k of plural) {
        const v = cat[k];
        if (!v || typeof v !== 'object') { bad.push(`${k}: plural needs an object`); continue; }
        const want = placeholders(k).filter((p) => p !== 'n').join();
        for (const [form, text] of Object.entries(v)) {
          if (placeholders(text).filter((p) => p !== 'n').join() !== want) bad.push(`${k} [${form}] -> ${text}`);
        }
      }
      assert.deepEqual(bad, []);
    });

    it(`gives every plural the forms ${code} needs`, () => {
      const bad = [];
      for (const k of plural) {
        const v = cat[k] || {};
        for (const form of needed) if (typeof v[form] !== 'string') bad.push(`${k}: missing ${form}`);
      }
      assert.deepEqual(bad, []);
    });

    it('is not English left untranslated', () => {
      /* Acronyms and product names read the same in every language. Anything
         else identical to its English key was simply not translated. */
      const SAME_EVERYWHERE = new Set(['CSV', 'PDF', 'WhatsApp', 'IMEI', 'SKU', 'UPC', 'PIN']);
      const same = [...plain].filter((k) => !SAME_EVERYWHERE.has(k)
        && /[A-Za-z]{3,}/.test(k.replace(/\{\w+\}/g, '')) && cat[k] === k);
      assert.deepEqual(same, []);
    });

    it('is safe to drop straight into markup', () => {
      /* Screens insert translations into templates. A translation may only use
         a markup-significant character its English key already uses. */
      const bad = [];
      const texts = (k) => (typeof cat[k] === 'string' ? [cat[k]] : Object.values(cat[k] || {}));
      for (const k of [...plain, ...plural]) {
        for (const text of texts(k)) {
          for (const ch of ['<', '>', '"']) {
            if (text.includes(ch) && !k.includes(ch)) bad.push(`${k} -> ${text}`);
          }
        }
      }
      assert.deepEqual(bad, []);
    });
  });
}

describe('source scanning', () => {
  it('finds strings in every form the app uses', () => {
    assert.ok(plain.size > 0);
  });
});

describe('translation calls cannot be shadowed', () => {
  /* 't' is a local name all over this codebase - a ticket, a transaction, a
     tender - and inside such a scope t('Cancel') would call the variable. App
     code therefore uses $t / $tn, and this keeps it that way. */
  const offenders = [];
  for (const f of files(JS)) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(?:\.\.?\/)+lang\.js'/g)) {
      const names = m[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]);
      if (names.includes('t') || names.includes('tn')) offenders.push(`${rel}: imports t/tn - use $t/$tn`);
    }
    const body = src.replace(/import\s*\{[^}]*\}\s*from[^;]+;/g, '');
    if (/(?:const|let|var)\s+\$tn?\b|[(,]\s*\$tn?\s*[,)=]/.test(body)) {
      offenders.push(`${rel}: binds a local named $t/$tn`);
    }
  }
  it('imports $t and $tn, never t or tn, and never rebinds them', () => {
    assert.deepEqual(offenders, []);
  });
});
