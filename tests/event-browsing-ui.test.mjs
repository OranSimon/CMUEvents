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

test('calendar downloads use an existing readable source alias and remain explicitly labeled when no web page exists', () => {
  const app = application(async () => ({}));
  const event = { url: 'https://example.edu/ical/calendar.ics', linkKind: 'source-page', sources: [
    { org: 'Official calendar', url: 'https://example.edu/ical/calendar.ics', eventUrl: 'https://example.edu/ical/calendar.ics' },
    { org: 'Official calendar', url: 'https://example.edu/calendar', eventUrl: 'https://example.edu/ical/calendar.ics' }
  ] };
  const links = JSON.parse(app.run(`JSON.stringify(originalLinks(${JSON.stringify(event)}))`));
  assert.deepEqual(links[0], { url: 'https://example.edu/calendar', label: 'Open source listing' });
  assert.ok(links.some(link => /Calendar feed \(download\)$/.test(link.label)));
  const feedOnly = JSON.parse(app.run(`JSON.stringify(originalLinks(${JSON.stringify({ ...event, sources: [] })}))`));
  assert.equal(feedOnly[0].label, 'Download calendar feed');
  const viewer = JSON.parse(app.run('JSON.stringify(originalLinks({url:"https://calendar.google.com/calendar/embed?src=public",linkKind:"calendar-viewer"}))'));
  assert.equal(viewer[0].label, 'Open published calendar');
  const detail = JSON.parse(app.run(`JSON.stringify(originalLinks(${JSON.stringify({ ...event, url: 'https://example.edu/event/42', linkKind: 'event-detail' })}))`));
  assert.deepEqual(detail[0], { url: 'https://example.edu/event/42', label: 'View original event' });
});

test('a merged occurrence keeps every distinct event and listing link, including several links from one publisher', () => {
  const app = application(async () => ({}));
  const event = { url: 'https://alpha.edu/event/42', linkKind: 'event-detail', sources: [
    { id: 'alpha', org: 'Alpha calendar', eventUrl: 'https://alpha.edu/event/42', url: 'https://alpha.edu/calendar' },
    { id: 'beta', org: 'Beta office', eventUrl: 'https://beta.edu/events/84', url: 'https://beta.edu/events' },
    { id: 'beta', org: 'Beta office', eventUrl: 'https://beta.edu/news/84', url: 'https://beta.edu/events', link: 'https://beta.edu/announcements' },
    { id: 'alpha', org: 'Alpha calendar', eventUrl: 'https://alpha.edu/event/42', url: 'https://alpha.edu/calendar' },
    { id: 'unsafe', org: 'Rejected unsafe links', eventUrl: 'javascript:alert(1)', url: 'data:text/html,example' }
  ] };
  const links = JSON.parse(app.run(`JSON.stringify(originalLinks(${JSON.stringify(event)}))`));
  assert.deepEqual(links[0], { url: event.url, label: 'View original event' });
  assert.deepEqual(new Set(links.map(link => link.url)), new Set([
    'https://alpha.edu/event/42', 'https://alpha.edu/calendar', 'https://beta.edu/events/84',
    'https://beta.edu/events', 'https://beta.edu/news/84', 'https://beta.edu/announcements'
  ]));
  assert.equal(links.length, 6);
  assert.equal(links.find(link => link.url === 'https://alpha.edu/calendar').label, 'Alpha calendar · Source listing');
  assert.equal(links.find(link => link.url === 'https://beta.edu/events/84').label, 'Beta office · Event details');
  assert.equal(links.find(link => link.url === 'https://beta.edu/news/84').label, 'Beta office · Event details');
});

test('readable event links outrank a download without discarding its feed or source listing', () => {
  const app = application(async () => ({}));
  const event = { url: 'https://calendar.example.edu/export?format=ical', linkKind: 'source-page', sources: [
    { id: 'shared', org: 'Official calendar', eventUrl: 'https://calendar.example.edu/export?format=ical', url: 'https://calendar.example.edu/calendar' },
    { id: 'department', org: 'Department', eventUrl: 'https://department.example.edu/talk/42', url: 'https://department.example.edu/talks' }
  ] };
  const links = JSON.parse(app.run(`JSON.stringify(originalLinks(${JSON.stringify(event)}))`));
  assert.deepEqual(links[0], { url: 'https://department.example.edu/talk/42', label: 'View original event' });
  assert.deepEqual(new Set(links.map(link => link.url)), new Set([
    event.url, 'https://calendar.example.edu/calendar', 'https://department.example.edu/talk/42', 'https://department.example.edu/talks'
  ]));
  assert.equal(links.find(link => link.url === event.url).label, 'calendar.example.edu · Calendar feed (download)');
});

test('merged event details expose differing source claims and retain a shorter access note safely', () => {
  const app = application(async () => ({}));
  app.run('openDialog = () => {}');
  const description = 'A detailed published research presentation with a substantial abstract and speaker biography.';
  const sources = [
    { id: 'department', org: 'Department calendar', url: 'https://department.edu/calendar', eventUrl: 'https://department.edu/talk/42' },
    { id: 'center', org: 'Center & research office', url: 'https://center.edu/events', eventUrl: 'https://center.edu/event/84' }
  ];
  const event = { title: 'Research seminar', summary: 'Published seminar summary.', description, start: '2026-10-26T16:00:00Z', end: '2026-10-26T17:00:00Z',
    timePrecision: 'time', timeZone: 'America/New_York', location: 'Conference Room 4105', status: 'scheduled', url: sources[0].eventUrl,
    orgs: ['Department calendar', 'Center & research office'], sources, sourceConflicts: ['location', 'end', 'status', 'internal-code'], sourceVariants: [
      { title: 'Research Seminar: Visiting Speaker', start: '2026-10-26T16:00:00Z', end: '2026-10-26T17:00:00Z', timeZone: 'America/New_York', timePrecision: 'time', allDay: false,
        location: 'Conference Room 4105', organizer: 'Academic office', status: 'scheduled', descriptionMatchesCanonical: true, sourceIds: ['department'], urls: [sources[0].eventUrl] },
      { title: 'Research seminar <speaker>', start: '2026-10-26T16:00:00Z', end: '2026-10-26T17:30:00Z', timeZone: 'America/New_York', timePrecision: 'time', allDay: false,
        location: 'Conference Room 4501', status: 'postponed', description: 'Members only; confirm access before attending. <img src=x onerror=alert(1)>', sourceIds: ['center'], urls: [sources[1].eventUrl] }
    ] };
  app.run(`openEvent(${JSON.stringify(event)})`);
  const $ = cheerio.load(app.elements.get('detail-content').innerHTML);
  assert.match($('.notice').text(), /Source listings differ on location, end time, event status/);
  assert.doesNotMatch($('.notice').text(), /internal-code/);
  assert.equal($('.source-versions summary').text(), 'Source versions (2)');
  assert.equal($('.source-version').length, 2);
  const first = $('.source-version').eq(0).text();
  const second = $('.source-version').eq(1).text();
  assert.match(first, /Research Seminar: Visiting Speaker/);
  assert.match(first, /Department calendar/);
  assert.match(first, /Monday, October 26, 2026/);
  assert.match(first, /12:00 PM – 1:00 PM EDT/);
  assert.match(first, /Conference Room 4105/);
  assert.match(first, /Status: Scheduled/);
  assert.match(first, /substantial abstract and speaker biography/);
  assert.match(second, /Center & research office/);
  assert.match(second, /12:00 PM – 1:30 PM EDT/);
  assert.match(second, /Conference Room 4501/);
  assert.match(second, /Status: Postponed/);
  assert.match(second, /Members only; confirm access before attending/);
  assert.match(second, /Research seminar <speaker>/);
  assert.equal($('img,script,speaker').length, 0);
  assert.deepEqual(new Set($('a').toArray().map(node => $(node).attr('href'))), new Set(sources.flatMap(source => [source.url, source.eventUrl])));
});

test('source date-only claims respect exclusive ends without inventing a clock or a conflict notice', () => {
  const app = application(async () => ({}));
  app.run('openDialog = () => {}');
  const event = { title: 'Dated program', description: '', start: '2027-04-15', end: '2027-04-18', allDay: true, endExclusive: true, timePrecision: 'date',
    sources: [{ id: 'calendar', org: 'Official calendar', url: 'https://example.edu/calendar' }], sourceVariants: [
      { title: 'Dated program', start: '2027-04-15', end: '2027-04-18', allDay: true, timePrecision: 'date', status: 'scheduled',
        sourceIds: ['calendar'], descriptionMatchesCanonical: true }
    ] };
  app.run(`openEvent(${JSON.stringify(event)})`);
  const $ = cheerio.load(app.elements.get('detail-content').innerHTML);
  assert.equal($('.notice').length, 0);
  assert.match($('.source-version').text(), /April 15, 2027 – April 17, 2027/);
  assert.match($('.source-version').text(), /Time not listed/);
  assert.doesNotMatch($('.source-version').text(), /April 18/);
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
