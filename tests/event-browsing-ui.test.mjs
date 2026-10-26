import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as cheerio from 'cheerio';

/**
 * Run the actual request/render functions against a minimal document transport.
 * The model deliberately omits browser layout; CUA covers visual and focus QA.
 * @param {Function} request Asynchronous event-service transport.
 * @return {Object} Application context and observable document elements.
 */
function application(request) {
  const elements = new Map();
  const document = { documentElement: { dataset: { mode: 'api' } }, querySelectorAll: () => [], activeElement: {},
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, { id, innerHTML: '', textContent: '', value: '', hidden: false,
        classList: { toggle() {} }, firstChild: { textContent: '' }, setAttribute() {}, removeAttribute() {},
        scrollIntoView() {}, querySelectorAll: () => [] });
      return elements.get(id);
    } };
  const context = vm.createContext({ document, window: { location: { search: '', pathname: '/' } }, history: { replaceState() {} },
    URL, URLSearchParams, AbortController, Intl, Date, setTimeout: () => 0, clearTimeout() {},
    createDataClient: () => ({ getEvents: request }), publicationFreshness: () => ({}) });
  const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
    .replace(/^import .*\n/, '').replaceAll('import.meta.url', '"https://example.edu/"').replace(/\ninitialize\(\);\s*$/, '');
  vm.runInContext(source, context);
  vm.runInContext('syncControls = () => {}; updateUrl = () => {}; updateStatus = () => {}; renderFacets = () => {};', context);
  return { context, elements, run: code => vm.runInContext(code, context) };
}

/**
 * Return deterministic dated occurrences for loader pagination contracts.
 * @param {number} total Number of real response records.
 * @return {Object[]} Complete normalized fixture list.
 */
function occurrences(total) {
  return Array.from({ length: total }, (_, index) => ({ id: `event-${index + 1}`, title: `Published event ${index + 1}`,
    start: '2027-01-12T18:00:00Z', end: '2027-01-12T19:00:00Z', timePrecision: 'time',
    description: 'Current event details from the publisher.', org: 'Public office', location: 'Published room' }));
}

/**
 * Page a fixed snapshot using the same response contract as the real client.
 * @param {Object[]} events Full response population.
 * @param {URLSearchParams} params Actual application query.
 * @return {Object} One source response page.
 */
function response(events, params) {
  const page = Number(params.get('page'));
  const pageSize = Number(params.get('limit'));
  return { events: events.slice((page - 1) * pageSize, page * pageSize), total: events.length, page, pageSize, facets: {} };
}

test('Today fetches every internal response page and exposes one complete list without a next page', async () => {
  const rows = occurrences(205);
  const calls = [];
  const app = application(async params => { calls.push(Object.fromEntries(params)); return response(rows, params); });
  await app.run('loadEvents()');
  assert.equal(app.run('state.eventView'), 'today');
  assert.deepEqual(calls.map(call => call.page), ['1', '2', '3']);
  assert.ok(calls.every(call => call.limit === '100' && call.eventView === 'today' && call.from === call.to));
  assert.equal(app.run('eventMap.size'), 205);
  assert.equal(app.elements.get('load-more').hidden, true);
  assert.match(app.elements.get('event-results').innerHTML, /Published event 205/);
  assert.match(app.elements.get('results-announcement').textContent, /complete matching list/);
});

test('Upcoming Show more appends the same view and date sequence without discarding earlier cards', async () => {
  const rows = occurrences(98);
  const calls = [];
  const app = application(async params => { calls.push(Object.fromEntries(params)); return response(rows, params); });
  app.run('state.eventView = "upcoming"');
  await app.run('loadEvents()');
  assert.equal(app.run('eventMap.size'), 48);
  await app.run('state.page += 1; loadEvents(false, true)');
  assert.equal(app.run('eventMap.size'), 96);
  assert.match(app.elements.get('event-results').innerHTML, /Published event 1</);
  assert.match(app.elements.get('event-results').innerHTML, /Published event 96</);
  await app.run('state.page += 1; loadEvents(false, true)');
  assert.equal(app.run('eventMap.size'), 98);
  assert.equal(app.elements.get('load-more').hidden, true);
  assert.deepEqual(calls.map(call => call.page), ['1', '2', '3']);
  assert.ok(calls.every(call => call.eventView === 'upcoming' && call.limit === '48' && call.from === calls[0].from && call.to === calls[0].to));
  assert.equal(calls[0].from, app.run('shiftDate(today, 1)'));
});

test('a failed append keeps loaded cards and rolls back its internal cursor for retry', async () => {
  const rows = occurrences(70);
  const app = application(async params => { if (params.get('page') === '2') throw new Error('Temporary transport failure'); return response(rows, params); });
  app.run('state.eventView = "recurring"');
  await app.run('loadEvents()');
  await app.run('state.page += 1; loadEvents(false, true)');
  assert.equal(app.run('eventMap.size'), 48);
  assert.equal(app.run('state.page'), 1);
  assert.match(app.elements.get('event-results').innerHTML, /Published event 1</);
  assert.equal(app.elements.get('error-notice').hidden, false);
  assert.equal(app.elements.get('show-more-events').disabled, false);
  assert.match(app.elements.get('show-more-events').textContent, /22 more occurrences/);
});

test('the markup offers explicit schedule tabs and no global Previous or Next controls', () => {
  const $ = cheerio.load(readFileSync(new URL('../web/index.html', import.meta.url), 'utf8'));
  assert.deepEqual($('#event-browser [role="tab"]').toArray().map(node => $(node).attr('data-event-view')), ['today', 'upcoming', 'recurring', 'ongoing']);
  assert.equal($('#event-view-today').attr('aria-selected'), 'true');
  assert.equal($('#previous-page,#next-page,#pagination').length, 0);
  assert.equal($('#show-more-events').length, 1);
  assert.equal($('#sources-dialog,#subscriptions-dialog').length, 2);
});

test('switching views cancels a pending complete-Today fetch before it requests hidden later pages', async () => {
  const rows = occurrences(205);
  const calls = [];
  let release;
  const app = application(async (params, options) => {
    calls.push({ params: new URLSearchParams(params), signal: options.signal });
    if (calls.length === 1) return new Promise(resolve => { release = () => resolve(response(rows, params)); });
    return response(rows.slice(0, 1), params);
  });
  const previous = app.run('loadEvents()');
  app.run('state.eventView = "upcoming"');
  await app.run('loadEvents()');
  release();
  await previous;
  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(app.run('eventMap.size'), 1);
  assert.equal(app.run('state.eventView'), 'upcoming');
});
