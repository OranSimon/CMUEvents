import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/lib/store.mjs';
import { normalizeEvent } from '../src/lib/normalize.mjs';
import { exportCrawlState, restoreCrawlState, savedPublicationEventCount } from '../src/lib/crawl-state.mjs';
import { validatePublication } from '../src/lib/static-site.mjs';

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

test('published-count guard survives changed contracts without restoring their incompatible occurrences', t => {
  const original = openStore(':memory:');
  const restored = openStore(':memory:');
  t.after(() => { original.close(); restored.close(); });
  const second = { ...plan, id: 'second', org: 'Another public office', url: 'https://example.edu/second' };
  const plans = [plan, second];
  original.registerPlans(plans);
  original.replaceSource(plan.id, Array.from({ length: 9 }, (_, index) => normalizeEvent({ uid: `event-${index}`,
    title: `Published event ${index}`, start: `2027-02-${String(index + 1).padStart(2, '0')}`,
    url: `https://example.edu/events/${index}` }, plan)));
  const remaining = normalizeEvent({ uid: 'remaining', title: 'Remaining public event', start: '2027-02-20',
    url: 'https://example.edu/remaining' }, second);
  original.replaceSource(second.id, [remaining]);
  original.rebuildEvents(plans);
  original.setMeta('lastRefresh', { totalEvents: 10 });
  const snapshot = exportCrawlState(original);
  assert.equal(snapshot.metadata.publishedEventCount, 10);
  const updated = [{ ...plan, options: { ...plan.options, format: 'changed-parser' } }, second];
  restored.registerPlans(updated);
  const baseline = savedPublicationEventCount(snapshot);
  const restoration = restoreCrawlState(restored, updated, snapshot);
  assert.deepEqual(restoration.invalidated, [plan.id]);
  assert.equal(restored.status().totalEvents, 1);
  assert.equal(restored.db.prepare('SELECT COUNT(*) AS count FROM occurrences WHERE source_id=?').get(plan.id).count, 0);
  restored.replaceSource(plan.id, []);
  restored.replaceSource(second.id, [remaining]);
  restored.rebuildEvents(updated);
  const publication = { events: restored.listEvents({ from: '2026-10-01' }).events,
    sources: restored.listSources(), expectedSources: 2, expectedRefreshSources: 2,
    refresh: { total: 2, completed: 2, ok: 1, empty: 1, undated: 0, error: 0, completedAt: '2026-10-26T12:00:00Z' },
    previousEventCount: baseline };
  assert.throws(() => validatePublication(publication), /fell from 10 to 1/);
  assert.equal(validatePublication({ ...publication, allowEventDrop: true }).retainedRatio, 0.1);
  const legacy = structuredClone(snapshot);
  delete legacy.metadata.publishedEventCount;
  assert.equal(savedPublicationEventCount(legacy), 10, 'the first deployed state preserves its prior total');
  assert.throws(() => validatePublication({ ...publication, previousEventCount: savedPublicationEventCount(legacy) }), /fell from 10 to 1/);
});

test('published count covers merged current-window events and rejects invalid saved totals', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans([plan, alias]);
  store.replaceSource(plan.id, [normalizeEvent({ title: 'Current public event', start: '2027-02-01' }, plan),
    normalizeEvent({ title: 'Expired public event', start: '2026-01-01' }, plan)]);
  store.rebuildEvents([plan, alias]);
  const snapshot = exportCrawlState(store, { windowStart: '2026-10-01' });
  assert.equal(snapshot.metadata.publishedEventCount, 1, 'covered provenance is counted once and expired events are excluded');
  assert.equal(savedPublicationEventCount({ metadata: { publishedEventCount: 0, lastRefresh: { totalEvents: 10 } } }), 0);
  assert.equal(savedPublicationEventCount({}), 0);
  for (const count of [-1, 1.5, '10', Infinity]) {
    assert.throws(() => savedPublicationEventCount({ metadata: { publishedEventCount: count } }), /Invalid saved publication/);
  }
});
