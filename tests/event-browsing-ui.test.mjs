import test from 'node:test';
import { normalizeEventFilters } from '../web/event-query.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as cheerio from 'cheerio';
import { EVENT_VIEWS, discoveryTags, hasPublishedTimeConflict } from '../web/event-semantics.js';

const NOW = Date.parse('2026-11-01T16:00:00Z');

/** Freeze the application clock so dated fixtures stay valid on every daily run. */
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}

/**
 * Run the actual request/render functions against a minimal document transport.
 * The model deliberately omits browser layout; CUA covers visual and focus QA.
 * @param {Function} request Asynchronous event-service transport.
 * @return {Object} Application context and observable document elements.
 */
function application(request) {
  const elements = new Map();
  const document = { documentElement: { dataset: { mode: 'static' } }, querySelectorAll: () => [], activeElement: {},
    querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 0 }) }),
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, { id, innerHTML: '', textContent: '', value: '', hidden: false,
        classList: { toggle() {} }, firstChild: { textContent: '' }, setAttribute() {}, removeAttribute() {},
        scrollIntoView() {}, focus() { document.activeElement = this; }, querySelectorAll: () => [], getBoundingClientRect: () => ({ top: 0 }) });
      return elements.get(id);
    } };
  const context = vm.createContext({ document, window: { location: { search: '', pathname: '/' } }, history: { replaceState() {} },
    URL, URLSearchParams, AbortController, Intl, Date: FixedDate, setTimeout: () => 0, clearTimeout() {},
    createDataClient: () => ({ getEvents: request }), publicationFreshness: () => ({}), EVENT_VIEWS, discoveryTags, hasPublishedTimeConflict, normalizeEventFilters });
  const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '').replaceAll('import.meta.url', '"https://example.edu/"').replace(/\ninitialize\(\);\s*$/, '');
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
  await app.run('loadEvents(true)');
  assert.equal(app.context.document.activeElement.id, 'results');
  assert.equal(app.run('state.eventView'), 'today');
  assert.deepEqual(calls.map(call => call.page), ['1', '2', '3']);
  assert.ok(calls.every(call => call.limit === '100' && call.eventView === 'today' && call.from === call.to));
  assert.equal(app.run('eventMap.size'), 205);
  assert.equal(app.elements.get('load-more').hidden, true);
  assert.match(app.elements.get('event-results').innerHTML, /Published event 205/);
  assert.match(app.elements.get('results-announcement').textContent, /complete matching list/);
});

test('Ongoing Show more appends the same date view without discarding earlier cards', async () => {
  const rows = occurrences(98);
  const calls = [];
  const app = application(async params => { calls.push(Object.fromEntries(params)); return response(rows, params); });
  app.run('state.eventView = "ongoing"');
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
  assert.ok(calls.every(call => call.eventView === 'ongoing' && call.limit === '48' && call.from === call.to));
  assert.equal(calls[0].from, app.run('today'));
});

test('a failed append keeps loaded cards and rolls back its internal cursor for retry', async () => {
  const rows = occurrences(70);
  const app = application(async params => { if (params.get('page') === '2') throw new Error('Temporary transport failure'); return response(rows, params); });
  app.run('state.eventView = "ongoing"; state.tags = ["Recurring"]');
  await app.run('loadEvents()');
  await app.run('state.page += 1; loadEvents(false, true)');
  assert.equal(app.run('eventMap.size'), 48);
  assert.equal(app.run('state.page'), 1);
  assert.match(app.elements.get('event-results').innerHTML, /Published event 1</);
  assert.equal(app.elements.get('error-notice').hidden, false);
  assert.equal(app.elements.get('show-more-events').disabled, false);
  assert.match(app.elements.get('show-more-events').textContent, /22 more events/);
});

test('multiple selected tags survive requests and each toggle removes only that tag', () => {
  const calls = [];
  const app = application(async params => { calls.push(params.getAll('tag')); return response([], params); });
  app.run('toggleTag("AI & Computing"); toggleTag("Arts & Performance"); toggleTag("Recurring")');
  assert.deepEqual(calls[2], ['AI & Computing', 'Arts & Performance', 'Recurring']);
  app.run('toggleTag("Arts & Performance")');
  assert.deepEqual(calls[3], ['AI & Computing', 'Recurring']);
});

test('clearing filters retains the current date view', async () => {
  const app = application(async params => response([], params));
  app.run('state.eventView = "ongoing"; state.tags = ["Recurring"]; state.query = "talk"; resetFilters()');
  assert.equal(app.run('state.eventView'), 'ongoing');
  assert.equal(app.run('state.tags.length'), 0);
  assert.equal(app.run('state.query'), '');
});

test('a chosen day loads its complete list and reads by time of day', async () => {
  const rows = occurrences(150);
  const calls = [];
  const app = application(async params => { calls.push(Object.fromEntries(params)); return response(rows, params); });
  app.run('state.eventView = "day"; state.day = "2027-01-12"');
  await app.run('loadEvents()');
  assert.ok(calls.every(call => call.eventView === 'day' && call.from === '2027-01-12' && call.to === '2027-01-12' && call.limit === '100'));
  assert.equal(app.run('eventMap.size'), 150);
  assert.equal(app.elements.get('load-more').hidden, true);
  assert.match(app.elements.get('event-results').innerHTML, /<h3 class="date-group-heading">Afternoon /);
  assert.match(app.elements.get('results-announcement').textContent, /day’s complete matching list/);
});

test('All pages through every date from today and groups rows by day', async () => {
  const rows = occurrences(60);
  const calls = [];
  const app = application(async params => { calls.push(Object.fromEntries(params)); return response(rows, params); });
  app.run('state.eventView = "all"');
  await app.run('loadEvents()');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].eventView, undefined);
  assert.equal(calls[0].from, app.run('today'));
  assert.equal(calls[0].to, undefined);
  assert.equal(app.run('eventMap.size'), 48);
  assert.equal(app.elements.get('load-more').hidden, false);
  assert.match(app.elements.get('event-results').innerHTML, /Tuesday, January 12, 2027/);
});

test('a new search widens to every upcoming date and clearing it restores the browsed day', () => {
  const calls = [];
  const app = application(async params => { calls.push(Object.fromEntries(params)); return response([], params); });
  app.run('state.eventView = "day"; state.day = "2027-01-12"; applySearch("concert")');
  assert.deepEqual([app.run('state.eventView'), calls[0].query, calls[0].eventView, calls[0].to], ['all', 'concert', undefined, undefined]);
  app.run('applySearch("concert hall")');
  assert.equal(app.run('state.eventView'), 'all');
  app.run('applySearch("")');
  assert.deepEqual([app.run('state.eventView'), app.run('state.day'), calls.at(-1).from], ['day', '2027-01-12', '2027-01-12']);
});

test('choosing a date narrows a search and stays chosen after the search clears', () => {
  const calls = [];
  const app = application(async params => { calls.push(Object.fromEntries(params)); return response([], params); });
  app.run('applySearch("concert"); selectView("day", "2027-01-12")');
  assert.deepEqual([calls.at(-1).query, calls.at(-1).eventView, calls.at(-1).from], ['concert', 'day', '2027-01-12']);
  app.run('applySearch("")');
  assert.deepEqual([app.run('state.eventView'), app.run('state.day')], ['day', '2027-01-12']);
  app.run('selectView("day", today)');
  assert.deepEqual([app.run('state.eventView'), app.run('state.day')], ['today', '']);
});

test('an empty date offers the next matching day, then every upcoming match', () => {
  const app = application(async () => ({}));
  const views = { all: 4, ongoing: 0, days: [{ value: '2027-01-12', count: 1 }, { value: '2027-01-14', count: 3 }] };
  app.run('state.eventView = "day"; state.day = "2027-01-12"');
  assert.equal(app.run(`JSON.stringify(nextMatch(${JSON.stringify(views)}))`), JSON.stringify({ view: 'day', day: '2027-01-14', label: 'See Thu, Jan 14 (3)' }));
  app.run('state.day = "2027-01-14"');
  assert.equal(app.run(`JSON.stringify(nextMatch(${JSON.stringify(views)}))`), JSON.stringify({ view: 'all', day: '', label: 'See all 4 upcoming' }));
});

test('rows lead with the published clock and leave out filler and location noise', () => {
  const app = application(async () => ({}));
  const base = { id: 'talk', title: 'Published talk', start: '2027-01-12T18:00:00Z', end: '2027-01-12T19:30:00Z', timePrecision: 'time', description: '',
    location: 'Olmsted Room, Cyert Hall, 5000 Forbes Ave, Pittsburgh, PA 15213', organizer: 'Physics Department', org: 'Physics calendar (all public events)' };
  const card = event => cheerio.load(app.run(`eventCard(${JSON.stringify(event)}, 0)`));
  const $ = card(base);
  assert.equal($('.event-when-main').text(), '1:00 PM');
  assert.equal($('.event-when-sub').text(), 'to 2:30 PM');
  assert.equal($('.event-location').text(), 'Olmsted Room, Cyert Hall');
  assert.equal($('.event-organizer').text(), 'Physics Department');
  assert.equal($('.event-summary').length, 0);
  assert.equal(card({ ...base, location: 'Sign in to download the location' })('.event-location').length, 0);
  assert.equal(card({ ...base, location: 'Private Location (sign in to display)' })('.event-location').length, 0);
  assert.equal(card({ ...base, organizer: '' })('.event-organizer').text(), 'Physics calendar');
  const dateOnly = card({ ...base, start: '2027-01-12', end: '2027-01-13', allDay: true, endExclusive: true, timePrecision: 'date' });
  assert.equal(dateOnly('.event-when-main').text(), 'Time not listed');
  assert.equal(dateOnly('.event-when-sub').length, 0);
  const span = card({ ...base, start: '2027-01-12', end: '2027-01-15', allDay: true, endExclusive: true, timePrecision: 'all-day' });
  assert.equal(span('.event-when-sub').text(), 'through Jan 14');
});

test('rows name the date where days mix and show ranges already underway as ongoing', () => {
  const app = application(async () => ({}));
  const when = event => JSON.parse(app.run(`JSON.stringify(eventWhen(${JSON.stringify(event)}))`));
  const talk = { title: 'Published talk', start: '2027-01-12T18:00:00Z', end: '2027-01-12T19:00:00Z', timePrecision: 'time' };
  app.run('state.eventView = "all"; state.query = "talk"');
  assert.deepEqual(when(talk), { main: 'Tue, Jan 12, 2027', sub: '1:00 PM' });
  assert.deepEqual(when({ ...talk, start: '2025-12-02', end: '2027-01-01', allDay: true, endExclusive: true, timePrecision: 'all-day' }), { main: 'Until Dec 31', sub: 'Since Dec 2' });
});

test('a long day lists every section up front and links to it', () => {
  const app = application(async () => ({}));
  app.run('state.eventView = "day"; state.day = "2027-01-12"');
  const rows = [{ id: 'morning', title: 'Morning talk', start: '2027-01-12T15:00:00Z', timePrecision: 'time' }, { id: 'evening', title: 'Evening recital', start: '2027-01-13T00:30:00Z', timePrecision: 'time' },
    { id: 'all-day', title: 'All-day fair', start: '2027-01-12', end: '2027-01-13', allDay: true, endExclusive: true, timePrecision: 'all-day' }];
  app.run(`renderEvents(${JSON.stringify({ events: rows, total: 3 })})`);
  const $ = cheerio.load(app.elements.get('event-results').innerHTML);
  assert.deepEqual($('.section-jump').toArray().map(node => $(node).attr('data-section')), ['morning', 'evening', 'untimed']);
  assert.deepEqual($('.date-group').toArray().map(node => $(node).attr('id')), ['section-morning', 'section-evening', 'section-untimed']);
  app.run(`renderEvents(${JSON.stringify({ events: rows.slice(0, 1), total: 1 })})`);
  assert.equal(cheerio.load(app.elements.get('event-results').innerHTML)('.section-jumps').length, 0);
});

test('Ongoing reads by time left and shows each published period', () => {
  const app = application(async () => ({}));
  app.run('state.eventView = "ongoing"');
  const day = offset => app.run(`shiftDate(today, ${offset})`);
  const period = (id, from, through) => ({ id, title: `Period ${id}`, start: day(from), end: day(through + 1), allDay: true, endExclusive: true, timePrecision: 'all-day' });
  const rows = [period('long', -30, 90), period('week', -2, 3), period('today', -5, 0), period('month', -1, 20)];
  app.run(`renderEvents(${JSON.stringify({ events: rows, total: 4 })})`);
  const $ = cheerio.load(app.elements.get('event-results').innerHTML);
  assert.deepEqual($('.date-group-heading').toArray().map(node => $(node).text().trim()), ['Ends today 1', 'Ends within a week 1', 'Ends within a month 1', 'Running for a while 1']);
  assert.deepEqual($('.event-when-main').toArray().map(node => $(node).text()), ['Ends today', '3 days left', '3 weeks left', '3 months left']);
  const bar = $('.event-card').eq(1).find('progress');
  assert.equal(bar.attr('value'), '2');
  assert.equal(bar.attr('max'), '5');
  assert.equal($('.section-jumps').length, 0);
});

test('an occurrence is only called current when the source publishes its end', () => {
  const app = application(async () => ({}));
  const talk = { start: '2027-01-12T18:00:00Z', end: '2027-01-12T19:00:00Z', timePrecision: 'time' };
  const phase = (event, at) => app.run(`eventPhase(${JSON.stringify(event)}, Date.parse("${at}"))`);
  assert.equal(phase(talk, '2027-01-12T17:59:00Z'), '');
  assert.equal(phase(talk, '2027-01-12T18:30:00Z'), 'now');
  assert.equal(phase(talk, '2027-01-12T19:30:00Z'), 'past');
  assert.equal(phase({ ...talk, end: undefined }, '2027-01-12T18:30:00Z'), 'past');
  assert.equal(phase({ start: '2027-01-12', end: '2027-01-13', allDay: true, timePrecision: 'all-day' }, '2027-01-12T18:30:00Z'), '');
});

test('the markup offers explicit schedule tabs and no global Previous or Next controls', () => {
  const $ = cheerio.load(readFileSync(new URL('../web/index.html', import.meta.url), 'utf8'));
  assert.deepEqual($('#event-browser [role="tab"]').toArray().map(node => $(node).attr('data-event-view')), ['all', 'ongoing', 'today']);
  assert.equal($('#date-window-filter,#date-presets').length, 0);
  assert.equal($('#event-view-today').attr('aria-selected'), 'true');
  assert.equal($('#previous-page,#next-page,#pagination').length, 0);
  assert.equal($('#show-more-events').length, 1);
  assert.equal($('#sources-dialog,#subscriptions-dialog').length, 2);
  assert.equal($('.brand-note,.results-eyebrow,.source-note,.dialog-toolbar .eyebrow,.empty-state .eyebrow').length, 0);
  assert.match($('.results-footnote').text(), /America\/New_York.*registration and access requirements/);
  assert.equal($('#refresh-button,.search-shortcut,.live-label,#toast').length, 0);
  assert.equal($('#subscriptions-button').text(), 'Mailing lists');
  assert.match($('.more-by-email').text(), /only share events on their mailing lists/);
});

test('recurring occurrences expose a filter tag while ordinary cards and cancellation status retain their meaning', () => {
  const app = application(async () => ({}));
  const base = { id: 'session', title: 'Published session', start: '2026-10-31T18:00:00Z', tags: ['Research & Talks'],
    eventType: 'recurring', recurrence: { seriesId: 'published-series', frequency: 'weekly' } };
  const card = event => cheerio.load(app.run(`eventCard(${JSON.stringify(event)}, 0)`));
  const $ = card(base);
  assert.equal($('button[data-tag="Recurring"]').text(), 'Recurring');
  assert.equal($('.event-status').length, 0);
  assert.equal(card({ ...base, eventType: 'scheduled', recurrence: undefined })('[data-tag="Recurring"]').length, 0);
  assert.equal(card({ ...base, status: 'cancelled' })('.event-status').text(), 'Cancelled');
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

test('related-page aliases do not repeat original source links or discard additional publisher links', () => {
  const app = application(async () => ({}));
  const event = { url: 'https://arts.edu/event/42', relatedEventUrls: ['https://museum.org/event/fair', 'https://arts.edu/event/42', 'https://venue.org/event/fair'],
    sources: [{ id: 'museum', org: 'Museum', eventUrl: 'https://museum.org/event/fair/', url: 'https://museum.org/calendar' }] };
  const links = JSON.parse(app.run(`JSON.stringify(originalLinks(${JSON.stringify(event)}))`));
  assert.equal(links.length, 4);
  assert.ok(links.some(link => link.url === 'https://museum.org/event/fair/'));
  assert.ok(!links.some(link => link.url === 'https://museum.org/event/fair'));
  assert.ok(links.some(link => link.url === 'https://venue.org/event/fair'));
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
  app.run('state.eventView = "ongoing"');
  await app.run('loadEvents()');
  release();
  await previous;
  assert.equal(calls.length, 2);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(app.run('eventMap.size'), 1);
  assert.equal(app.run('state.eventView'), 'ongoing');
});
