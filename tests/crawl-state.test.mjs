import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/lib/store.mjs';
import { normalizeEvent } from '../src/lib/normalize.mjs';
import { exportCrawlState, restoreCrawlState } from '../src/lib/crawl-state.mjs';

const plan = { id: 'official', department: 'University', org: 'Public office', url: 'https://example.edu/events',
  fetchUrl: 'https://example.edu/events.ics', adapter: 'ics', status: 'active', options: { timezone: 'America/New_York' } };
const alias = { ...plan, id: 'alias', status: 'covered', canonicalSourceId: 'official', org: 'Shared office' };

test('portable crawl state restores failed-source last-good events and alias provenance without HTTP caches', t => {
  const original = openStore(':memory:');
  const restored = openStore(':memory:');
  t.after(() => { original.close(); restored.close(); });
  const plans = [plan, alias];
  original.registerPlans(plans);
  const event = normalizeEvent({ title: 'Club-hosted public talk', start: '2027-02-01', url: 'https://example.edu/talk' }, plan);
  original.replaceSource(plan.id, [event], [], '2026-10-25T12:00:00Z');
  original.failSource(plan.id, new Error('Temporary upstream failure'), '2026-10-26T12:00:00Z');
  original.putCache('https://example.edu/events.ics', Buffer.from('DO NOT EXPORT RAW RESPONSE'));
  original.setMeta('lastUpdated', '2026-10-25T12:00:00Z');
  const state = exportCrawlState(original);
  assert.ok(!JSON.stringify(state).includes('DO NOT EXPORT'));
  restored.registerPlans(plans);
  const report = restoreCrawlState(restored, plans, state);
  assert.equal(report.restoredSources, 1);
  const publicEvent = restored.listEvents().events[0];
  assert.equal(publicEvent.timePrecision, 'date');
  assert.deepEqual(publicEvent.sources.map(source => source.id).sort(), ['alias', 'official']);
  assert.equal(restored.listSources().find(source => source.id === plan.id).state, 'error');
  assert.equal(restored.getMeta('lastUpdated'), '2026-10-25T12:00:00Z');
  restored.mergePartial(plan.id, [event], ['Unrelated detail unavailable']);
  assert.equal(restored.listSources().find(source => source.id === plan.id).eventCount, 1,
    'a new partial run updates the restored occurrence rather than duplicating its storage key');
});

test('changed extraction contracts and retired sources cannot resurrect fixed snapshots', t => {
  const original = openStore(':memory:');
  const restored = openStore(':memory:');
  t.after(() => { original.close(); restored.close(); });
  original.registerPlans([plan]);
  original.replaceSource(plan.id, [normalizeEvent({ title: 'Talk', start: '2027-02-01' }, plan)]);
  const state = exportCrawlState(original);
  const changed = { ...plan, options: { ...plan.options, format: 'new-live-parser' } };
  restored.registerPlans([changed]);
  assert.deepEqual(restoreCrawlState(restored, [changed], state).invalidated, ['official']);
  assert.equal(restored.status().totalEvents, 0);
  assert.deepEqual(restoreCrawlState(restored, [], state).invalidated, ['official']);
});

test('malformed state fails before mutating snapshots and rolling windows discard expired records', t => {
  const original = openStore(':memory:');
  const restored = openStore(':memory:');
  t.after(() => { original.close(); restored.close(); });
  original.registerPlans([plan]);
  original.replaceSource(plan.id, [normalizeEvent({ title: 'Old talk', start: '2026-01-01' }, plan)]);
  const state = exportCrawlState(original);
  restored.registerPlans([plan]);
  const malformed = structuredClone(state);
  malformed.sources[0].events[0].start = '2027-02-30';
  assert.throws(() => restoreCrawlState(restored, [plan], malformed), /Invalid saved occurrence/);
  assert.equal(restored.status().totalEvents, 0);
  restoreCrawlState(restored, [plan], state, { windowStart: '2026-10-01T00:00:00Z' });
  assert.equal(restored.status().totalEvents, 0);
});
