'use strict';

/* The till's languages.

   Every string a person reads goes through $t(), keyed by its English text:
     $t('New sale')                       a plain string
     $t('Hello, {name}', { name })        with a placeholder
     $tn('{n} item', '{n} items', count)  a plural, by Intl.PluralRules
     N_('Booked in')                      marks text that lives in data (a
                                          status list, a nav tile) so the
                                          completeness test can find it;
                                          render it later with $t(label)

   English needs no catalogue - the key is the text. Arabic and Urdu are ES
   modules, loaded through literal import() calls so the offline precache
   picks them up. tests/client-lang.mjs fails the build if any key lacks a
   translation, because a half-translated screen is worse than an English one.

   Two different languages are in play, deliberately:
   - the SCREEN follows this terminal's choice (the cashier's), and
   - RECEIPTS and the customer display follow the STORE's language (the
     customer's), via tIn(). */

export const LANGUAGES = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'ar', name: 'العربية', dir: 'rtl' },
  { code: 'ur', name: 'اردو', dir: 'rtl' },
];

const LOADERS = {
  ar: () => import('./lang/ar.js'),
  ur: () => import('./lang/ur.js'),
};

const catalogues = { en: {} };
let current = 'en';
let storeLang = 'en';
const listeners = new Set();

export const N_ = (text) => text;

export function dirOf(code) {
  const hit = LANGUAGES.find((l) => l.code === code);
  return hit ? hit.dir : 'ltr';
}

export function language() {
  return current;
}

/* "From → to" in the reading direction of the screen. The arrow character is
   bidi-neutral, so it has to be chosen rather than mirrored. */
export function arrow() {
  return dirOf(current) === 'rtl' ? '←' : '→';
}

/* Dates and times on screen follow the screen language. Digits stay Latin so a
   date reads the same way as the money figures next to it. */
const DATE_LOCALES = { en: 'en-US', ar: 'ar-u-nu-latn', ur: 'ur-u-nu-latn' };
export function dateLocale() {
  return DATE_LOCALES[current] || 'en-US';
}

/* Receipts and the customer display speak the store's language, not the
   cashier's. Set at boot and on sign-in. */
export function storeLanguage() {
  return storeLang;
}

export async function setStoreLanguage(code) {
  const target = LANGUAGES.some((l) => l.code === code) ? code : 'en';
  if (await ensureLoaded(target)) storeLang = target;
  return storeLang;
}

function interpolate(str, params) {
  if (!params) return str;
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k])));
}

function lookup(code, key) {
  const cat = catalogues[code];
  return cat && Object.prototype.hasOwnProperty.call(cat, key) ? cat[key] : undefined;
}

function pluralForm(code, n) {
  try { return new Intl.PluralRules(code).select(Number(n)); } catch (_) { return Number(n) === 1 ? 'one' : 'other'; }
}

export function tIn(code, key, params) {
  const hit = lookup(code, key);
  if (hit === undefined) return interpolate(key, params);
  if (typeof hit === 'object') return interpolate(hit.other || key, params);
  return interpolate(hit, params);
}

export function t(key, params) {
  return tIn(current, key, params);
}

export function tnIn(code, one, other, n, params) {
  const p = { n, ...(params || {}) };
  const hit = lookup(code, other);
  if (hit && typeof hit === 'object') {
    const form = pluralForm(code, n);
    return interpolate(hit[form] !== undefined ? hit[form] : hit.other, p);
  }
  if (typeof hit === 'string') return interpolate(hit, p);
  return interpolate(pluralForm('en', n) === 'one' ? one : other, p);
}

export function tn(one, other, n, params) {
  return tnIn(current, one, other, n, params);
}

/* App code calls these. 't' is used as a local name all over the codebase
   (a ticket, a transaction, a tender), where t('...') would call the
   variable instead of translating - so screens import $t and $tn, a name
   nothing else binds. A test enforces it. */
export const $t = t;
export const $tn = tn;

/* The terminal's language: an explicit choice wins; 'store' or nothing means
   the store's language when there is a catalogue for it; otherwise English. */
export function resolveLanguage(choice, storeLocale) {
  const supported = (c) => LANGUAGES.some((l) => l.code === c);
  if (choice && choice !== 'store' && supported(choice)) return choice;
  const storeLang = String(storeLocale || '').split('-')[0];
  return supported(storeLang) ? storeLang : 'en';
}

export async function ensureLoaded(code) {
  if (catalogues[code]) return true;
  const load = LOADERS[code];
  if (!load) return false;
  try {
    const mod = await load();
    catalogues[code] = mod.default || {};
    return true;
  } catch (_) {
    return false;
  }
}

function applyDocument(code) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  document.documentElement.lang = code;
  document.documentElement.dir = dirOf(code);
}

export async function setLanguage(code) {
  const target = LANGUAGES.some((l) => l.code === code) ? code : 'en';
  if (!(await ensureLoaded(target))) return false;
  current = target;
  applyDocument(target);
  for (const fn of listeners) { try { fn(target); } catch (_) { /* a listener must not block the switch */ } }
  return true;
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* Terminal choice persists in IndexedDB meta/lang: 'store', 'en', 'ar' or 'ur'. */
export async function loadChoice(idb) {
  try { return String((await idb.get('meta', 'lang')) || 'store'); } catch (_) { return 'store'; }
}

export async function saveChoice(idb, choice) {
  await idb.put('meta', String(choice || 'store'), 'lang');
}

/* test hook */
export function __setCatalogue(code, cat, { activate = true } = {}) {
  catalogues[code] = cat || {};
  if (activate) { current = code; applyDocument(code); }
}
