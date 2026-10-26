import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataClient, publicationFreshness, queryEventsSnapshot } from '../web/data-client.js';

const generatedAt = '2026-10-25T12:00:00.000Z';

test('freshness uses successful collection time rather than a newer build time', () => {
  const now = Date.parse(generatedAt);
  assert.equal(publicationFreshness({ generatedAt, lastUpdated: '2026-10-20T12:00:00Z' }, now).stale, true);
  assert.equal(publicationFreshness({ lastUpdated: generatedAt }, now).stale, false);
  assert.equal(publicationFreshness({ generatedAt }, now).known, false);
  assert.equal(publicationFreshness({ lastUpdated: '2026-10-24T11:00:00Z', staleAfterHours: 24 }, now).stale, true);
});

/**
 * Build a complete public event fixture with source provenance.
 * @param {Object} overrides Explicit field replacements.
 * @return {Object} Normalized event fixture.
 */
function event(overrides = {}) {
  return { id: 'one', title: 'Robótica and Privacy', description: 'Systems seminar with published details.',
    summary: 'Published excerpt.', start: '2026-11-01T05:30:00Z', end: '2026-11-01T07:30:00Z', allDay: false,
    timePrecision: 'time', timeZone: 'America/New_York', departments: ['Engineering', 'SCS'], orgs: ['Robotics Lab'],
    department: 'Engineering', org: 'Robotics Lab', tags: ['Research & Talks'], mode: 'Hybrid', campus: 'Pittsburgh',
    location: 'Hall 101', status: 'scheduled', url: 'https://example.edu/event/one',
    sources: [{ id: 'source', org: 'Robotics Lab', department: 'SCS', url: 'https://example.edu/calendar', eventUrl: 'https://example.edu/event/one' }],
    ...overrides };
}

/**
 * Build the four coherent files expected from one publication.
 * @param {string} generation Publication timestamp shared by all files.
 * @param {Array<Object>} events Complete published events.
 * @return {Object} File-name to JSON payload mapping.
 */
function publication(generation = generatedAt, events = [event()]) {
  return {
    'manifest.json': { version: 1, eventSchema: 2, mode: 'static', generatedAt: generation, updateIntervalHours: 24, staleAfterHours: 48 },
    'events.json': { generatedAt: generation, events },
    'sources.json': { generatedAt: generation, sources: [{ id: 'source', url: 'https://example.edu/calendar', subscription: { kind: 'public_plus_email', emailEventsIngested: false } }] },
    'status.json': { generatedAt: generation, lastUpdated: '2026-10-24T18:00:00Z', totalEvents: events.length, sources: { total: 1, ok: 1 } },
  };
}

/**
 * Provide deterministic JSON fetch responses and inspect transport calls.
 * @param {Object} state Mutable file payloads and optional HTTP status.
 * @param {Array<Object>} calls Captured public request URLs and options.
 * @return {Function} Fetch-compatible fixture transport.
 */
function fixtureFetch(state, calls) {
  return async (url, options = {}) => {
    calls.push({ url: new URL(url), options });
    const filename = new URL(url).pathname.split('/').pop();
    const payload = state.files[filename];
    return { ok: state.status ? state.status < 400 : Boolean(payload), status: state.status || (payload ? 200 : 404), json: async () => structuredClone(payload) };
  };
}

test('static query keeps complete details and source provenance', () => {
  const complete = event({ customPublicContext: 'Registration required' });
  const result = queryEventsSnapshot({ events: [complete] }, { from: '2026-11-01' });
  assert.equal(result.total, 1);
  assert.equal(result.events[0], complete);
  assert.equal(result.events[0].description, complete.description);
  assert.equal(result.events[0].sources[0].eventUrl, complete.sources[0].eventUrl);
});

test('Unicode prefix search uses all terms and title-weighted relevance', () => {
  const descriptionMatch = event({ id: 'description', title: 'Design workshop', description: 'Robotica privacy methods' });
  const titleMatch = event({ id: 'title' });
  const events = [descriptionMatch, titleMatch, event({ id: 'missing', title: 'Robotica overview', description: 'No matching second term', orgs: ['Other'], tags: [] })];
  const result = queryEventsSnapshot({ events }, { from: '2026-10-01', query: 'RÓBOTIC priv' });
  assert.deepEqual(result.events.map(item => item.id), ['title', 'description']);
  assert.equal(queryEventsSnapshot({ events }, { from: '2026-10-01', query: 'botica' }).total, 0);
  assert.equal(queryEventsSnapshot({ events }, { from: '2026-10-01', query: '***' }).total, 3);
});

test('date overlap respects exclusive all-day ends and midnight timed ends', () => {
  const allDay = event({ id: 'all-day', start: '2026-10-31', end: '2026-11-03', allDay: true, endExclusive: true, timePrecision: 'date' });
  const midnight = event({ id: 'midnight', start: '2026-10-30T23:00:00Z', end: '2026-10-31T04:00:00Z' });
  const instant = event({ id: 'instant', start: '2026-10-31T04:00:00Z', end: '2026-10-31T04:00:00Z' });
  const events = [allDay, midnight, instant];
  assert.deepEqual(queryEventsSnapshot({ events }, { from: '2026-10-31', to: '2026-10-31' }).events.map(item => item.id).sort(), ['all-day', 'instant']);
  assert.deepEqual(queryEventsSnapshot({ events }, { from: '2026-11-02', to: '2026-11-02' }).events.map(item => item.id), ['all-day']);
  assert.equal(queryEventsSnapshot({ events }, { from: '2026-11-03' }).total, 0);
});

test('DST days and international timestamps use New York display boundaries', () => {
  const events = [event({ id: 'fall-back' }), event({ id: 'late', start: '2026-11-02T00:15:00+09:00', end: '2026-11-02T01:00:00+09:00' })];
  assert.equal(queryEventsSnapshot({ events }, { from: '2026-11-01', to: '2026-11-01' }).total, 2);
  assert.equal(queryEventsSnapshot({ events }, { from: '2026-11-02', to: '2026-11-02' }).total, 0);
});

test('categorical filters compose while facets retain date/search candidate counts', () => {
  const events = [event(), event({ id: 'two', departments: ['Design'], department: 'Design', orgs: ['Studio'], tags: ['Arts'], campus: 'Qatar', mode: 'Online' })];
  const result = queryEventsSnapshot({ events }, { from: '2026-11-01', department: 'SCS', org: 'Robotics Lab', tag: 'Research & Talks', campus: 'Pittsburgh', mode: 'hybrid' });
  assert.equal(result.total, 1);
  assert.deepEqual(result.facets.departments.map(item => item.value), ['Design', 'Engineering', 'SCS']);
  assert.equal(result.facets.campuses.length, 2);
  assert.equal(queryEventsSnapshot({ events }, { from: '2026-11-01', mode: 'virtual' }).events[0].id, 'two');
});

test('static paging is deterministic, bounded and validates calendar ranges', () => {
  const events = Array.from({ length: 105 }, (_, index) => event({ id: String(index).padStart(3, '0') }));
  const result = queryEventsSnapshot({ events }, new URLSearchParams({ from: '2026-11-01', limit: '10', page: '2' }));
  assert.equal(result.total, 105);
  assert.equal(result.pageSize, 10);
  assert.equal(result.events[0].id, '010');
  assert.equal(queryEventsSnapshot({ events }, { from: '2026-11-01', limit: 500 }).events.length, 100);
  assert.throws(() => queryEventsSnapshot({ events }, { from: '2026-02-30' }), /YYYY-MM-DD/);
  assert.throws(() => queryEventsSnapshot({ events }, { from: '2026-11-02', to: '2026-11-01' }), /end date/);
});

test('all static files resolve below a repository base and concurrent readers share one load', async () => {
  const state = { files: publication() };
  const calls = [];
  const client = createDataClient({ mode: 'static', baseUrl: 'https://example.github.io/CMUEvents/', fetchImpl: fixtureFetch(state, calls) });
  const [events, sources, status] = await Promise.all([client.getEvents({ from: '2026-10-01' }), client.getSources(), client.getStatus()]);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.url.pathname.startsWith('/CMUEvents/data/')));
  assert.ok(calls.every(call => call.options.method === 'GET'));
  assert.equal(events.events.length, 1);
  assert.equal(sources.sources[0].subscription.emailEventsIngested, false);
  assert.equal(status.lastSuccessfulUpdate, '2026-10-24T18:00:00Z');
  assert.equal(status.generatedAt, generatedAt);
  assert.equal(status.refreshing, false);
});

test('static manual reload only performs GETs and publication checks reuse unchanged files', async () => {
  let time = Date.parse(generatedAt);
  const state = { files: publication() };
  const calls = [];
  const client = createDataClient({ mode: 'static', baseUrl: 'https://example.github.io/CMUEvents/', fetchImpl: fixtureFetch(state, calls), clock: () => time });
  await client.getStatus();
  time += 61000;
  await client.getStatus();
  assert.equal(calls.length, 5);
  await client.refresh();
  assert.equal(calls.length, 9);
  assert.ok(calls.every(call => call.options.method === 'GET'));
});

test('new manifest replaces the coherent cached snapshot and preserves actual refresh age', async () => {
  let time = Date.parse(generatedAt);
  const state = { files: publication() };
  const client = createDataClient({ mode: 'static', baseUrl: 'https://example.github.io/CMUEvents/', fetchImpl: fixtureFetch(state, []), clock: () => time });
  await client.getStatus();
  const nextGeneration = '2026-10-26T12:00:00.000Z';
  state.files = publication(nextGeneration, [event(), event({ id: 'new' })]);
  time += 86400000;
  const status = await client.getStatus();
  assert.equal(status.generatedAt, nextGeneration);
  assert.equal(status.lastSuccessfulUpdate, '2026-10-24T18:00:00Z');
  assert.equal((await client.getEvents({ from: '2026-10-01' })).total, 2);
});

test('mixed published generations fail closed while retaining the prior usable data', async () => {
  const state = { files: publication() };
  const client = createDataClient({ mode: 'static', baseUrl: 'https://example.github.io/CMUEvents/', fetchImpl: fixtureFetch(state, []) });
  await client.getSources();
  state.files = publication('2026-10-26T12:00:00.000Z', [event({ id: 'new' })]);
  state.files['events.json'].generatedAt = generatedAt;
  await assert.rejects(client.refresh(), /different updates/);
  assert.equal((await client.getEvents({ from: '2026-10-01' })).events[0].id, 'one');
});

test('invalid manifest versions and incomplete payloads do not publish a cache', async () => {
  const state = { files: publication() };
  state.files['manifest.json'].version = 2;
  const client = createDataClient({ mode: 'static', baseUrl: 'https://example.github.io/CMUEvents/', fetchImpl: fixtureFetch(state, []) });
  await assert.rejects(client.getStatus(), /unsupported version/);
  state.files = publication();
  delete state.files['events.json'].events;
  await assert.rejects(client.getStatus(), /incomplete/);
  state.files = publication();
  assert.equal((await client.getSources()).sources.length, 1);
});

test('cancelling one reader does not cancel the shared published-data load', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const state = { files: publication() };
  const calls = [];
  const fetchFixture = fixtureFetch(state, calls);
  const client = createDataClient({ mode: 'static', baseUrl: 'https://example.github.io/CMUEvents/', fetchImpl: async (...args) => { await waiting; return fetchFixture(...args); } });
  const controller = new AbortController();
  const cancelled = client.getEvents({ from: '2026-10-01' }, { signal: controller.signal });
  const surviving = client.getSources();
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  release();
  assert.equal((await surviving).sources.length, 1);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => !call.options.signal));
});

test('API mode preserves local endpoints and uses POST only for explicit refresh', async () => {
  const calls = [];
  const client = createDataClient({ mode: 'api', baseUrl: 'http://127.0.0.1:4173/', fetchImpl: async (url, options) => { calls.push({ url: new URL(url), options }); return { ok: true, json: async () => ({ events: [], sources: [] }) }; } });
  await client.getEvents(new URLSearchParams({ query: 'robot', page: '2' }));
  await client.getSources();
  await client.getStatus();
  await client.refresh();
  assert.deepEqual(calls.map(call => call.url.pathname), ['/api/events', '/api/sources', '/api/status', '/api/refresh']);
  assert.equal(calls[0].url.searchParams.get('query'), 'robot');
  assert.deepEqual(calls.map(call => call.options.method), ['GET', 'GET', 'GET', 'POST']);
});


test('legacy published data without recurrence/range semantics cannot enter the new activity views', async () => {
  const state = { files: publication() };
  delete state.files['manifest.json'].eventSchema;
  const client = createDataClient({ mode: 'static', baseUrl: 'https://example.github.io/CMUEvents/', fetchImpl: fixtureFetch(state, []) });
  await assert.rejects(client.getEvents({ eventView: 'today' }), /unsupported version/);
});
