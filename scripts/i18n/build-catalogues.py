"""Merge parts/<lang>_*.json into public/js/lang/<lang>.js, and report gaps.

usage:
  node scripts/i18n/collect-keys.mjs . scripts/i18n/keys.json   # what the app asks for
  python scripts/i18n/build-catalogues.py ar                    # report only
  python scripts/i18n/build-catalogues.py ar --write            # write the catalogue

A new release's strings go in a NEW parts file (parts/ar_18.json, ur_18.json,
then 19, ...); the parts are merged in file order, so nothing is edited twice.
The report names keys the app no longer uses (delete them from their part) and
keys not yet translated. `npm run test:client` fails on either.
"""
import glob
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SP = os.path.join(HERE, 'parts')
ROOT = os.path.dirname(os.path.dirname(HERE))
lang = sys.argv[1]
write = '--write' in sys.argv

keys = json.load(io.open(os.path.join(HERE, 'keys.json'), encoding='utf-8'))
plain = set(keys['plain'])
plural = {p['other'] for p in keys['plural']}
wanted = plain | plural

merged = {}
dupes = []
for part in sorted(glob.glob(os.path.join(SP, '%s_*.json' % lang))):
    data = json.load(io.open(part, encoding='utf-8'))
    for k, v in data.items():
        if k in merged:
            dupes.append(k)
        merged[k] = v

extra = sorted(k for k in merged if k not in wanted)
missing = sorted(k for k in wanted if k not in merged)
wrong_shape = sorted(k for k in merged if (k in plural) != isinstance(merged[k], dict))

out = io.open(os.path.join(HERE, 'report_%s.txt' % lang), 'w', encoding='utf-8')
out.write('merged %d, wanted %d\n' % (len(merged), len(wanted)))
out.write('EXTRA (not used by the app - check spelling):\n  ' + '\n  '.join(extra) + '\n')
out.write('DUPLICATES across parts:\n  ' + '\n  '.join(dupes) + '\n')
out.write('WRONG SHAPE (plural vs plain):\n  ' + '\n  '.join(wrong_shape) + '\n')
out.write('MISSING (%d):\n  ' % len(missing) + '\n  '.join(missing) + '\n')
out.close()
print('%s: merged %d / wanted %d | extra %d | dupes %d | wrong shape %d | missing %d'
      % (lang, len(merged), len(wanted), len(extra), len(dupes), len(wrong_shape), len(missing)))

if write:
    names = {'ar': 'Arabic', 'ur': 'Urdu'}
    lines = ["'use strict';", '',
             '/* %s. Keys are the English text; see public/js/lang.js.' % names.get(lang, lang),
             '   Generated from reviewed translation tables. Needs a native speaker\'s',
             '   review before go-live. */', '', 'export default {']
    for k in sorted(k for k in merged if k in wanted):
        lines.append('  %s: %s,' % (json.dumps(k, ensure_ascii=False), json.dumps(merged[k], ensure_ascii=False)))
    lines.append('};')
    lines.append('')
    target = os.path.join(ROOT, 'public', 'js', 'lang', '%s.js' % lang)
    io.open(target, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
    print('wrote', target)
