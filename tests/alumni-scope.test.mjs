import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlans } from '../src/config.mjs';
import { parseAlumniEvents } from '../src/adapters/alumni.mjs';

test('the online publisher scope never inherits all in-person cards through calendar aliasing', () => {
  const plans = loadPlans();
  const all = plans.find(plan => plan.id === '8f00fc7f2c7c');
  const online = plans.find(plan => plan.id === '79e7cdffd54d');
  assert.equal(all.status, 'active');
  assert.equal(online.status, 'active');
  assert.equal(all.fetchUrl, online.fetchUrl);
  assert.notEqual(all.options.upstreamScope, online.options.upstreamScope);
  const context = { windowStart: '2026-10-25', windowEnd: '2027-10-25' };
  const cards = all.options.reviewedPublicEvents.records;
  const imported = parseAlumniEvents(cards, new Map(), all, context).events;
  const filtered = parseAlumniEvents(cards, new Map(), online, context).events;
  assert.equal(imported.length, 23);
  assert.equal(filtered.length, 4);
  assert.ok(filtered.every(event => event.mode === 'online' && imported.some(other => other.uid === event.uid)));
  assert.ok(imported.some(event => event.mode !== 'online' && !filtered.some(other => other.uid === event.uid)));
});
