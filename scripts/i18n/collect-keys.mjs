// Standalone copy of the collector in tests/client-lang-catalogues.mjs.
// usage: node keys.mjs <repoRoot> <outJson>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2];
const OUT = process.argv[3];
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

const plain = new Set();
const plural = new Map(); // other -> one
for (const f of files(JS)) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(new RegExp(String.raw`(?<![\w$])(?:\$t|N_)\(\s*(?:${STR})`, 'g'))) plain.add(pick(m, 1));
  for (const m of src.matchAll(new RegExp(String.raw`\btIn\(\s*[^,]+,\s*(?:${STR})`, 'g'))) plain.add(pick(m, 1));
  for (const m of src.matchAll(new RegExp(String.raw`(?<![\w$])\$tn\(\s*(?:${STR})\s*,\s*(?:${STR})`, 'g'))) plural.set(pick(m, 4), pick(m, 1));
  for (const m of src.matchAll(new RegExp(String.raw`\btnIn\(\s*[^,]+,\s*(?:${STR})\s*,\s*(?:${STR})`, 'g'))) plural.set(pick(m, 4), pick(m, 1));
}
const gs = fs.readFileSync(path.join(ROOT, 'backend', 'Code.gs'), 'utf8');
for (const m of gs.matchAll(/statusError_\(\s*\d{3}\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) {
  const k = unescape(m[1]);
  if (/^[A-Z]/.test(k)) plain.add(k);
}
for (const k of plural.keys()) plain.delete(k);
const out = { plain: [...plain].sort(), plural: [...plural.entries()].sort().map(([other, one]) => ({ one, other })) };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('plain', out.plain.length, 'plural', out.plural.length);
