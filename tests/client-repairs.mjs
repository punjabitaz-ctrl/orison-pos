import test from 'node:test';
import assert from 'node:assert/strict';
import { REPAIR_FLOW, nextStatuses, statusLabel, statusTone } from '../public/js/screens/repairs.js';

test('the flow is in the order a job actually walks', () => {
  const ids = REPAIR_FLOW.map((s) => s.id);
  assert.equal(ids[0], 'intake');
  assert.ok(ids.indexOf('diagnosed') < ids.indexOf('in_progress'));
  assert.ok(ids.indexOf('in_progress') < ids.indexOf('ready'));
  assert.ok(ids.indexOf('ready') < ids.indexOf('collected'));
});

test('every status renders a human label, never a raw key', () => {
  for (const s of REPAIR_FLOW) {
    assert.ok(s.label && s.label !== s.id, `${s.id} has no label`);
    assert.ok(!s.label.includes('_'), `${s.label} looks like a key`);
  }
  assert.equal(statusLabel('awaiting_parts'), 'Awaiting parts');
});

test('an unknown status still reads as words rather than breaking the row', () => {
  assert.equal(statusLabel('some_new_state'), 'Some new state');
  assert.equal(statusLabel(''), '');
  assert.equal(statusTone('some_new_state'), 'new');
});

test('a job can always be abandoned, from any open state', () => {
  for (const id of ['intake', 'diagnosed', 'awaiting_parts', 'in_progress', 'ready']) {
    const next = nextStatuses(id);
    assert.ok(next.includes('cancelled'), `${id} cannot be cancelled`);
    assert.ok(next.includes('unrepairable'), `${id} cannot be marked unrepairable`);
  }
});

test('a closed ticket offers nothing', () => {
  for (const id of ['collected', 'cancelled', 'unrepairable', 'voided']) {
    assert.deepEqual(nextStatuses(id), []);
  }
});

test('collected is never offered as a manual step', () => {
  // A repair is collected by invoicing it. If the status could be set by hand,
  // a job could be closed as collected without any money changing hands.
  for (const s of REPAIR_FLOW) {
    assert.ok(!nextStatuses(s.id).includes('collected'),
      `${s.id} offers collected, which must come from invoicing`);
  }
});

test('the obvious next step is offered first', () => {
  assert.equal(nextStatuses('intake')[0], 'diagnosed');
  assert.equal(nextStatuses('diagnosed')[0], 'awaiting_parts');
  assert.equal(nextStatuses('in_progress')[0], 'ready');
});

test('a status is never offered as a move to itself', () => {
  for (const id of ['intake', 'diagnosed', 'awaiting_parts', 'in_progress', 'ready']) {
    assert.ok(!nextStatuses(id).includes(id), `${id} offers itself`);
  }
});

test('voided is never reachable from the status control', () => {
  // Voiding is an admin action with its own confirmation and its own reason.
  for (const s of REPAIR_FLOW) {
    assert.ok(!nextStatuses(s.id).includes('voided'));
  }
});
