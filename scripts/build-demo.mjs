/* Build the Orison POS demo site: the app from public/, with the backend
   running in the page (demo/). Only files tracked by git are used, so a
   stray local file never ends up in the demo.

   Usage:  node scripts/build-demo.mjs [outDir]     (default dist/demo-site) */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] || 'dist/demo-site');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const tracked = execFileSync('git', ['ls-files', '-z', 'public', 'demo'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean);
if (!tracked.includes('demo/boot.js')) throw new Error('demo/ is not tracked by git yet');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
for (const f of tracked) {
  /* the production CSP forbids eval, which the in-page backend needs; the demo
     ships without it (GitHub Pages ignores _headers anyway) */
  if (f === 'public/_headers') continue;
  const dest = f.startsWith('public/') ? join(out, f.slice('public/'.length)) : join(out, f);
  copy(join(root, f), dest);
}
copy(join(root, 'backend/Code.gs'), join(out, 'demo/Code.gs.txt'));

function rewrite(file, pairs) {
  const p = join(out, file);
  let s = readFileSync(p, 'utf8');
  for (const [from, to] of pairs) {
    if (!s.includes(from)) throw new Error(`${file}: expected to find ${JSON.stringify(from)}`);
    s = s.replace(from, to);
  }
  writeFileSync(p, s);
}

rewrite('index.html', [
  ['<title>Orison POS</title>', '<title>Orison POS — Demo</title>'],
  ['<link rel="stylesheet" href="css/style.css">', '<link rel="stylesheet" href="css/style.css">\n  <link rel="stylesheet" href="demo/demo.css">'],
  ['<script type="module" src="js/app.js"></script>', '<script src="demo/boot.js"></script>\n  <script type="module" src="js/app.js"></script>'],
]);
const version = `orison-pos-v${pkg.version}`;
rewrite('sw.js', [
  [`const VERSION = '${version}';`, `const VERSION = '${version}-demo';`],
  ["const SHELL = [\n", "const SHELL = [\n  './demo/boot.js',\n  './demo/demo.css',\n  './demo/gas-emulator.js',\n  './demo/seed-demo.js',\n  './demo/Code.gs.txt',\n"],
]);
rewrite('manifest.webmanifest', [['"name": "Orison POS"', '"name": "Orison POS Demo"']]);
writeFileSync(join(out, '.nojekyll'), '');

console.log(`demo site built: ${relative(root, out)} (v${pkg.version})`);
