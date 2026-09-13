'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { ACTION_GROUPS, actionLabel } = await import('../public/js/screens/audit.js');

const CODE = fs.readFileSync(path.join(import.meta.dirname, '..', 'backend', 'Code.gs'), 'utf8');

function serverActions() {
  const out = new Set();
  /* The first argument can itself hold commas ({ uid: …, role: … }), so take
     the first quoted action-shaped literal after the call instead. */
  for (const m of CODE.matchAll(/(?:logAudit_|auditRow_)\([^']{0,160}?'([a-z]+\.[a-z_]+)'/g)) out.add(m[1]);
  const kinds = CODE.match(/var AUDITED_PUSH_KINDS_ = \{([^}]*)\}/);
  if (kinds) for (const m of kinds[1].matchAll(/:\s*'([a-z_.]+)'/g)) out.add(m[1]);
  return out;
}

describe('audit screen (v1.36.0)', () => {
  const offered = new Set(ACTION_GROUPS.flatMap((g) => g.actions.map((a) => a.id)));

  it('offers a filter for every action the server writes', () => {
    const actions = serverActions();
    assert.ok(actions.size >= 30, `found only ${actions.size} server actions — the scan is broken`);
    const missing = [...actions].filter((a) => !offered.has(a)).sort();
    assert.deepEqual(missing, [], 'server audit actions with no label on the audit screen');
  });

  it('does not offer a filter nothing can match', () => {
    const actions = serverActions();
    const stale = [...offered].filter((a) => !actions.has(a)).sort();
    assert.deepEqual(stale, []);
  });

  it('lists each action once', () => {
    const all = ACTION_GROUPS.flatMap((g) => g.actions.map((a) => a.id));
    assert.equal(all.length, new Set(all).size);
  });

  it('shows a readable name, and the raw id for anything unknown', () => {
    assert.equal(actionLabel('stock.adjust'), 'Stock adjustments');
    assert.equal(actionLabel('something.new'), 'something.new');
  });
});
