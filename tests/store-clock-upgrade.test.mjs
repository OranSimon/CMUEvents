import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/lib/store.mjs';
import { normalizeEvent } from '../src/lib/normalize.mjs';

const first = { id: 'date-source', status: 'active', department: 'SCS', org: 'Date listing', url: 'https://example.edu/events' };
const second = { ...first, id: 'clock-source', org: 'Clock listing' };
const alias = { ...first, id: 'alias', status: 'covered', canonicalSourceId: first.id };
const base = { uid: 'shared', title: 'A precisely identified research talk', url: 'https://example.edu/talk', start: '2026-11-04', timeZone: 'America/New_York' };

/**
 * Materialize independent source snapshots without network or disk state.
 * @param {Object} t Test cleanup handle.
 * @param {Object[]} dates Imprecise publisher records.
 * @param {Object[]} clocks Independent current clock records.
 * @return {Object[]} Deduplicated public occurrences.
 */
function materialize(t, dates, clocks) {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans([first, second, alias]);
  store.replaceSource(first.id, dates.map(raw => normalizeEvent({ ...base, ...raw }, first)));
  store.replaceSource(second.id, clocks.map(raw => normalizeEvent({ ...base, ...raw }, second)));
  store.rebuildEvents([first, second, alias]);
  return store.listEvents({ from: '2026-11-01' }).events;
}

test('a uniquely published local-day clock enriches a matching date while retaining every source', t => {
  const events = materialize(t, [{}], [{ start: '2026-11-05T00:30:00Z', end: '2026-11-05T01:30:00Z' }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].start, '2026-11-05T00:30:00.000Z');
  assert.equal(events[0].allDay, false);
  assert.equal(events[0].timePrecision, 'time');
  assert.deepEqual(events[0].sources.map(source => source.id).sort(), ['alias', 'clock-source', 'date-source']);
});

test('explicit all-day and multiday records never absorb another occurrence clock', t => {
  for (const date of [{ allDay: true }, { end: '2026-11-06' }]) {
    const events = materialize(t, [date], [{ start: '2026-11-04T16:30:00Z' }]);
    assert.equal(events.length, 2);
    assert.ok(events.some(event => event.start === base.start));
  }
});

test('multiple clocks, multiple unknown identities and different local dates remain unresolved', t => {
  const severalClocks = materialize(t, [{}], [{ start: '2026-11-04T16:30:00Z' }, { start: '2026-11-04T19:30:00Z' }]);
  assert.equal(severalClocks.length, 3);
  assert.ok(severalClocks.some(event => event.timePrecision === 'date'));
  const severalIdentities = materialize(t, [{ uid: 'unknown-one' }, { uid: 'unknown-two' }], [{ start: '2026-11-04T16:30:00Z' }]);
  assert.equal(severalIdentities.length, 2);
  assert.ok(severalIdentities.some(event => event.timePrecision === 'date'));
  const differentDay = materialize(t, [{}], [{ start: '2026-11-04T20:30:00Z', timeZone: 'Australia/Sydney' }]);
  assert.equal(differentDay.length, 2);
  assert.ok(differentDay.some(event => event.timePrecision === 'date'));
});
