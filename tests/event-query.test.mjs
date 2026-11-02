import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchIndex, prepareSnapshotSearch, queryEventsSnapshot, normalizeEventFilters } from '../web/event-query.js';

/** Construct independent occurrences with complete public provenance. */
function event(id, changes = {}) {
  return { id, title: 'Public session', start: '2026-11-01T18:00:00Z', end: '2026-11-01T19:00:00Z',
    allDay: false, description: '', tags: [], departments: ['Engineering'], orgs: ['Office'], campus: 'Pittsburgh', mode: 'In person',
    sources: [{ id: 'official', url: 'https://example.edu/calendar', eventUrl: `https://example.edu/event/${id}` }], ...changes };
}
const date = { from: '2026-11-01', to: '2026-11-01', eventView: 'today' };
const clock = { today: '2026-11-01', now: Date.parse('2026-11-01T12:00:00Z') };
const recurring = { eventType: 'recurring', recurrence: { seriesId: 'published-series' } };

test('serialized publication and direct build queries return identical IDs, ranks, facets and original provenance', async () => {
  const rows = [event('title', { title: 'Robótica privacy seminar' }), event('body', { description: 'Robotica privacy seminar' }),
    event('host', { organizer: 'DeltaHost' }), event('location', { location: 'Robotics Laboratory' })];
  const published = structuredClone(rows);
  await prepareSnapshotSearch(published, buildSearchIndex(rows));
  for (const query of ['robotic priv', 'robotca', 'DeltaHost', 'Laboratory', 'Engineering', 'Office']) {
    const expected = queryEventsSnapshot({ events: rows }, { ...date, query }, clock);
    const actual = queryEventsSnapshot({ events: published }, { ...date, query }, clock);
    assert.deepEqual(actual, expected);
    for (const result of actual.events) assert.strictEqual(result, published.find(event => event.id === result.id));
  }
  assert.equal(queryEventsSnapshot({ events: rows }, { ...date, query: 'robotic privacy' }, clock).events[0].id, 'title');
  assert.equal(queryEventsSnapshot({ events: rows }, { ...date, query: 'DeltaHost' }, clock).total, 1);
});

test('date navigation counts follow search and filters but not the selected date', () => {
  const rows = [event('today', { tags: ['AI'] }), event('talk', { tags: ['AI'], title: 'Robotics talk', start: '2026-11-03T18:00:00Z', end: '2026-11-03T19:00:00Z' }),
    event('recital', { tags: ['Arts'], start: '2026-11-03T20:00:00Z', end: '2026-11-03T21:00:00Z' }),
    event('range', { tags: ['AI'], start: '2026-10-30', end: '2026-11-04', allDay: true, endExclusive: true }),
    event('past', { tags: ['AI'], start: '2026-10-20T18:00:00Z', end: '2026-10-20T19:00:00Z' }),
    event('deadline', { tags: ['AI'], title: 'Application deadline', start: '2026-11-03T18:00:00Z', end: '2026-11-03T19:00:00Z' })];
  const views = filters => queryEventsSnapshot({ events: rows }, filters, clock).facets.views;
  const days = [{ value: '2026-11-01', count: 1 }, { value: '2026-11-03', count: 2 }];
  assert.deepEqual(views(date), { all: 4, ongoing: 1, days });
  assert.deepEqual(views({ eventView: 'day', from: '2026-11-03', to: '2026-11-03' }), { all: 4, ongoing: 1, days });
  assert.deepEqual(views({ ...date, tag: 'Arts' }), { all: 1, ongoing: 0, days: [{ value: '2026-11-03', count: 1 }] });
  assert.deepEqual(views({ ...date, query: 'robotics' }), { all: 1, ongoing: 0, days: [{ value: '2026-11-03', count: 1 }] });
});

test('search without a date view covers every occurrence from today onward, keeping relevance order', () => {
  const rows = [event('past', { title: 'Robotics seminar', start: '2026-10-20T18:00:00Z', end: '2026-10-20T19:00:00Z' }),
    event('soon', { title: 'Lab tour', description: 'Includes robotics.', start: '2026-11-02T18:00:00Z', end: '2026-11-02T19:00:00Z' }),
    event('spring', { title: 'Robotics seminar', start: '2027-03-02T18:00:00Z', end: '2027-03-02T19:00:00Z' })];
  const result = queryEventsSnapshot({ events: rows }, { from: '2026-11-01', query: 'robotics' }, clock);
  assert.deepEqual(result.events.map(event => event.id), ['spring', 'soon']);
});

test('short abbreviations use whole words, long words support bounded spelling tolerance, and all query terms must match', () => {
  const rows = [event('ai', { title: 'AI workshop' }), event('air', { title: 'Air quality' }), event('robotics', { title: 'Robotics planning seminar' })];
  const search = query => queryEventsSnapshot({ events: rows }, { ...date, query }, clock).events.map(event => event.id);
  assert.deepEqual(search('AI'), ['ai']);
  assert.deepEqual(search('robotic plan'), ['robotics']);
  assert.deepEqual(search('robotcs'), ['robotics']);
  assert.deepEqual(search('robotics concert'), []);
  assert.deepEqual(search('botics'), []);
});

test('topics compose with OR while Recurring and all other dimensions remain required, without merging dates', () => {
  const rows = [event('ai', { tags: ['AI'], ...recurring }), event('arts', { tags: ['Arts'], ...recurring }),
    event('one-off', { tags: ['AI'] }), event('other-campus', { tags: ['AI'], campus: 'Qatar', ...recurring }),
    event('tomorrow', { tags: ['AI'], start: '2026-11-02T18:00:00Z', end: '2026-11-02T19:00:00Z', ...recurring })];
  const params = new URLSearchParams({ ...date, campus: 'Pittsburgh' });
  for (const tag of ['AI', 'Arts', 'Recurring']) params.append('tag', tag);
  assert.deepEqual(normalizeEventFilters(params).tags, ['AI', 'Arts', 'Recurring']);
  const result = queryEventsSnapshot({ events: rows }, params, clock);
  assert.deepEqual(result.events.map(event => event.id), ['ai', 'arts']);
  assert.deepEqual(rows[0].tags, ['AI'], 'projecting Recurring does not mutate original data');
  assert.deepEqual(result.events.flatMap(event => event.sources), rows.slice(0, 2).flatMap(event => event.sources));
});

test('facet counts apply other dimensions, ignore their own group, and distinguish Recurring from topic OR', () => {
  const rows = [event('ai', { tags: ['AI'], ...recurring }), event('arts', { tags: ['Arts'], ...recurring }),
    event('one-off', { tags: ['AI'] }), event('qatar', { tags: ['AI'], campus: 'Qatar', departments: ['Qatar'] })];
  const result = queryEventsSnapshot({ events: rows }, { ...date, tag: ['AI', 'Recurring'], campus: 'Pittsburgh' }, clock);
  const count = (field, value) => result.facets[field].find(item => item.value === value)?.count;
  assert.equal(result.total, 1);
  assert.equal(count('tags', 'AI'), 1);
  assert.equal(count('tags', 'Arts'), 1);
  assert.equal(count('tags', 'Recurring'), 1);
  assert.equal(count('campuses', 'Qatar'), 0);
  assert.equal(count('departments', 'Qatar'), 0);
  assert.equal(count('departments', 'Engineering'), 1);
});

test('a mismatched published index cannot silently search a different event generation', async () => {
  const rows = [event('one')], index = buildSearchIndex(rows);
  await assert.rejects(prepareSnapshotSearch([event('different-id')], index), /does not match/);
  await assert.rejects(prepareSnapshotSearch(rows, { ...index, schemaVersion: 99 }), /incompatible/);
});
