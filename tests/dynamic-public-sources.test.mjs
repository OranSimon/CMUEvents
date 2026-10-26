import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectAlumniCards, createPublicRenderer, publicRenderUrl, createPublicNetworkGuard } from '../src/lib/public-render.mjs';
import { fetchAlumni, parseAlumniPublicCards, parseAlumniPublicDetail } from '../src/adapters/alumni.mjs';
import { parseTextSchedule, parseConsistentEventPage, fetchTextSchedule } from '../src/adapters/text-schedules.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/alumni-public-dom.json', import.meta.url), 'utf8'));
const listingUrl = 'https://community.cmu.edu/s/events';
const plan = { url: 'https://www.cmu.edu/engage/events', options: { format: 'alumni', discovery: 'public-dom', timezone: 'America/New_York' } };

/** Create an isolated public-pagination transport double without a browser. */
function publicPage(pages) {
  let index = 0;
  return { waitForFunction: async () => {}, evaluate: async () => pages[index], locator: () => ({ count: async () => pages[index].length }),
    getByRole: () => ({ count: async () => 1, isVisible: async () => true,
      isEnabled: async () => index < pages.length - 1, click: async () => { index++; } }) };
}

test('public DOM discovery follows all23 visible cards and automatically accepts newly published later pages', async () => {
  const current = await collectAlumniCards(publicPage(fixture.pages));
  assert.equal(current.rows.length, 23);
  assert.equal(current.partial, false);
  assert.equal(current.pages, 3);
  const added = { title: 'Newly published future event', dateText: 'January 12, 2027', text: 'January 12, 2027\nNewly published future event',
    url: 'https://www.givecampus.com/schools/CarnegieMellonUniversity/events/new-future-event' };
  const future = await collectAlumniCards(publicPage([...fixture.pages, [added]]));
  assert.equal(future.rows.length, 24);
  assert.ok(future.rows.some(row => row.url === added.url));
  assert.equal(future.partial, false);
});

test('public DOM page/card caps and repeated pagination remain explicitly partial', async () => {
  const bounded = await collectAlumniCards(publicPage(fixture.pages), { maxPages: 2 });
  assert.equal(bounded.rows.length, 18);
  assert.equal(bounded.partial, true);
  assert.match(bounded.warnings.join(' '), /Next remains enabled/);
  const cardCap = await collectAlumniCards(publicPage(fixture.pages), { maxCards: 10 });
  assert.equal(cardCap.rows.length, 10);
  assert.equal(cardCap.partial, true);
  const repeated = await collectAlumniCards(publicPage([fixture.pages[0], fixture.pages[0]]));
  assert.equal(repeated.partial, true);
  assert.match(repeated.warnings.join(' '), /repeated/);
  const missingControl = publicPage([fixture.pages[0]]);
  missingControl.getByRole = () => ({ count: async () => 0 });
  assert.equal((await collectAlumniCards(missingControl)).partial, true);
});

test('live original Sydney details establish its actual instant, end and zone without reviewedDetail or a clock getter', () => {
  const detail = parseAlumniPublicDetail(fixture.detail);
  assert.equal(detail.start, '2026-10-27T21:00:00.000Z');
  assert.equal(detail.end, '2026-10-27T22:30:00.000Z');
  assert.equal(detail.timeZone, 'Australia/Sydney');
  assert.equal(detail.uncertain, false);
  const card = fixture.pages.flat().find(row => row.url === fixture.detail.url);
  const result = parseAlumniPublicCards({ rows: [card], partial: false }, new Map([[card.url, fixture.detail]]), plan);
  assert.equal(result.partial, undefined, 'the different Sydney day is explained by the same Eastern listing instant');
  assert.equal(result.events[0].start, detail.start);
});

test('missing detail or an ambiguous source zone retains current public dates and never borrows hidden clocks or deadlines', () => {
  const card = fixture.pages.flat().find(row => row.url === fixture.detail.url);
  const missing = parseAlumniPublicCards({ rows: [card] }, new Map(), plan);
  assert.equal(missing.partial, true);
  assert.equal(missing.events[0].start, '2026-10-27');
  const uncertain = parseAlumniPublicDetail({ ...fixture.detail, detailText: fixture.detail.detailText.replace('AEDT', 'CST') });
  assert.equal(uncertain.start, '2026-10-28');
  assert.equal(uncertain.end, undefined);
  assert.equal(uncertain.uncertain, true);
  const conflict = parseAlumniPublicCards({ rows: [card] }, new Map([[card.url, { ...fixture.detail,
    detailText: fixture.detail.detailText.replace('AEDT', 'CST') }]]), plan);
  assert.equal(conflict.events[0].start, '2026-10-27');
  assert.match(conflict.warnings.join(' '), /conflicts with original detail date/);
  const noDate = parseAlumniPublicDetail({ ...fixture.detail, detailText: 'Event Details\nDate to be announced\nPlanar Restaurant' });
  assert.equal(noDate, null);
});

test('dynamic Alumni refresh requires visible discovered URLs and cannot fall back to a fixed card list or broad getter', async () => {
  const card = fixture.pages.flat().find(row => row.url === fixture.detail.url);
  const calls = [];
  const result = await fetchAlumni({ ...plan, options: { ...plan.options, reviewedPublicEvents: { records: [{ id: 'hidden' }] } } }, {
    renderPublic: async request => { calls.push(request); return request.kind === 'alumni' ? { rows: [card], partial: false } : fixture.detail; },
    fetchText: async () => { throw Error('Not used'); }, fetchPublicQuery: async () => { throw Error('Broad/clock APIs are not used'); },
  });
  assert.equal(result.events.length, 1);
  assert.deepEqual(calls.map(call => call.url), [listingUrl, card.url]);
  await assert.rejects(fetchAlumni(plan, {}), /CMUEVENTS_RENDER_PUBLIC/);
});

test('consecutive detail failures stop optional enrichment while all discovered public card dates remain included', async () => {
  const listing = { rows: fixture.pages.flat(), partial: false };
  const requested = [];
  const result = await fetchAlumni(plan, { renderPublic: async request => {
    if (request.kind === 'alumni') return listing;
    requested.push(request.url);
    throw new Error('Event Details timeout; public page diagnostic: {"httpStatus":403,"title":"Access unavailable"}');
  } });
  assert.equal(requested.length, 4, 'the default circuit stops after two failed two-card batches');
  assert.equal(result.events.length, 23);
  assert.equal(result.partial, true);
  assert.ok(result.events.every(event => event.timePrecision === 'date'));
  assert.match(result.warnings.join(' '), /skipped 19 remaining detail page/);
  assert.match(result.warnings.join(' '), /httpStatus.*403/);
});

test('a successful current detail resets the configurable failure circuit in deterministic card order', async () => {
  const listing = { rows: fixture.pages.flat(), partial: false };
  let calls = 0;
  const result = await fetchAlumni({ ...plan, options: { ...plan.options, maxConsecutiveDetailFailures: 2 } }, {
    renderPublic: async request => {
      if (request.kind === 'alumni') return listing;
      const index = calls++;
      if (![1, 3].includes(index)) throw new Error('Original detail temporarily unavailable');
      const row = listing.rows.find(row => row.url === request.url);
      return { title: row.title, detailText: `Event Details\n${row.dateText} 8:00AM - 9:00AM EDT\nPublished venue`, description: 'Current public details' };
    },
  });
  assert.equal(calls, 6, 'two successful details reset earlier failures, then two failures open the circuit');
  assert.equal(result.events.length, 23);
  assert.equal(result.events.filter(event => event.timePrecision === 'time').length, 2);
  assert.match(result.warnings.join(' '), /skipped 17 remaining detail page/);
});

test('online-only scope uses current visible location and does not classify incidental event-title words', async () => {
  const listing = { rows: fixture.pages.flat() };
  const result = parseAlumniPublicCards(listing, new Map(), { ...plan, options: { ...plan.options, onlineOnly: true } });
  assert.equal(result.events.length, 4);
  const fake = { ...listing.rows[0], title: 'Online reality research in Pittsburgh', text: 'October 26, 2026 | Pittsburgh, PA\nOnline reality research in Pittsburgh' };
  assert.equal(parseAlumniPublicCards({ rows: [fake] }, new Map(), { options: { onlineOnly: true } }).events.length, 0);
});

test('renderer rejects other schools, credentials and unrelated pages before browser launch', async () => {
  let launched = 0;
  const renderer = createPublicRenderer({ enabled: true, launch: async () => { launched++; } });
  for (const url of ['http://community.cmu.edu/s/events', 'https://user:secret@community.cmu.edu/s/events',
    'https://www.givecampus.com/schools/OtherSchool/events/example', 'https://www.givecampus.com/schools/CarnegieMellonUniversity']) {
    await assert.rejects(renderer.renderPublic({ url, kind: 'event-detail' }));
  }
  assert.equal(launched, 0);
  assert.equal(publicRenderUrl({ url: fixture.detail.url, kind: 'event-detail' }), fixture.detail.url);
  await assert.rejects(createPublicRenderer().renderPublic({ url: listingUrl, kind: 'alumni' }), /disabled/);
});

test('all browser network destinations reject private DNS, mixed answers, credentials and local redirects', async () => {
  let lookups = 0;
  const guard = createPublicNetworkGuard({ lookup: async host => {
    lookups++;
    return host === 'mixed.example' ? [{ address: '93.184.216.34' }, { address: '10.0.0.1' }] : [{ address: '93.184.216.34' }];
  } });
  await guard('https://public.example/script.js');
  await guard('https://public.example/style.css');
  assert.equal(lookups, 1, 'per-render DNS validation is memoized');
  for (const url of ['https://127.0.0.1/', 'https://10.0.0.1/', 'https://169.254.169.254/latest/meta-data',
    'https://[::1]/', 'https://[fe80::1]/', 'https://localhost/', 'https://a.local/',
    'https://mixed.example/script.js', 'https://user:secret@public.example/', 'http://public.example/', 'https://public.example:8443/']) {
    await assert.rejects(guard(url), /Non-public/);
  }
});

test('renderer uses a fresh context, blocks downloads/workers and validates subresources and main-frame redirects', async () => {
  const contexts = [];
  let closed = 0;
  let browserClosed = 0;
  const frame = {};
  const renderer = createPublicRenderer({ enabled: true, lookup: async () => [{ address: '93.184.216.34' }], launch: async () => ({
    newContext: async options => {
      const state = { options };
      contexts.push(state);
      const page = { setDefaultTimeout() {}, mainFrame: () => frame, goto: async () => {},
        getByRole: (_, options) => options.level ? { first: () => ({ innerText: async () => fixture.detail.title }) }
          : { waitFor: async () => {}, evaluate: async () => fixture.detail.detailText },
        locator: selector => { assert.equal(selector, '#event-tabpanel'); return { isVisible: async () => true, innerText: async () => fixture.detail.description }; } };
      return { newPage: async () => page, close: async () => { closed++; },
        route: async (_, handler) => { state.route = handler; }, routeWebSocket: async (_, handler) => { state.webSocket = handler; } };
    }, close: async () => { browserClosed++; },
  }) });
  await renderer.renderPublic({ url: fixture.detail.url, kind: 'event-detail' });
  assert.equal(closed, 1);
  assert.equal(contexts[0].options.acceptDownloads, false);
  assert.equal(contexts[0].options.serviceWorkers, 'block');
  for (const [url, mainFrame, expected] of [['https://127.0.0.1/secret', false, 'blocked'],
    ['https://public.example/redirect', true, 'blocked'], ['https://public.example/script.js', false, 'allowed']]) {
    let result;
    await contexts[0].route({ request: () => ({ url: () => url, isNavigationRequest: () => mainFrame, frame: () => frame }),
      continue: async () => { result = 'allowed'; }, abort: async () => { result = 'blocked'; } });
    assert.equal(result, expected);
  }
  await renderer.renderPublic({ url: fixture.detail.url, kind: 'event-detail' });
  assert.equal(contexts.length, 2, 'no browser context or cookies are reused');
  await renderer.close();
  assert.equal(browserClosed, 1);
});

test('render failures report response status, final path, document title and visible h1 without body or Guest List reads', async () => {
  let closed = 0;
  let headingWaits = 0;
  const inspected = [];
  const page = { setDefaultTimeout() {}, mainFrame: () => ({}),
    goto: async () => ({ status: () => 403 }), url: () => `${fixture.detail.url}?ephemeral=do-not-persist`,
    title: async () => 'Public access unavailable',
    getByRole: () => ({ waitFor: async () => { headingWaits++; throw new Error('Event Details heading timed out'); } }),
    locator: selector => { inspected.push(selector); assert.equal(selector, 'h1:visible');
      return { first: () => ({ count: async () => 1, innerText: async () => 'Request could not be completed' }) }; },
  };
  const renderer = createPublicRenderer({ enabled: true, launch: async () => ({
    newContext: async () => ({ newPage: async () => page, route: async () => {}, close: async () => { closed++; } }), close: async () => {},
  }) });
  await assert.rejects(renderer.renderPublic({ url: fixture.detail.url, kind: 'event-detail' }), error => {
    assert.deepEqual(error.publicRenderDiagnostic, { httpStatus: 403, finalUrl: fixture.detail.url,
      title: 'Public access unavailable', firstVisibleH1: 'Request could not be completed' });
    assert.equal(error.code, 'PUBLIC_RENDER_HTTP_ERROR');
    assert.match(error.message, /Public page returned HTTP 403.*httpStatus.*403/);
    assert.ok(!error.message.includes('ephemeral'));
    return true;
  });
  assert.equal(closed, 1);
  assert.equal(headingWaits, 0, 'an explicit HTTP failure never waits for a missing Event Details heading');
  assert.deepEqual(inspected, ['h1:visible']);
  await renderer.close();
});

const tablePlan = { url: 'https://example.edu/seminars', options: { format: 'text-schedule', rowSelector: 'tbody tr', seriesSelector: 'h1',
  fields: { date: { selector: 'td', index: 0 }, location: { selector: 'td', index: 1 }, speaker: { selector: 'td', index: 2 },
    affiliation: { selector: 'td', index: 3 }, title: { selector: 'td', index: 4 } } } };

test('live table schedules discover new rows and preserve named talks whose topic is pending', () => {
  const html = '<h1>Current Econ-CS Series</h1><table><tbody><tr><td>January 12, 2027<br>2:00 PM</td><td>GHC 8102<br>Zoom</td><td>New Speaker</td><td>CMU</td><td>TBD</td></tr></tbody></table>';
  const result = parseTextSchedule(html, tablePlan);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, 'Current Econ-CS Series — New Speaker');
  assert.equal(result.events[0].start, '2027-01-12T19:00:00.000Z');
  assert.equal(result.events[0].mode, 'hybrid');
  assert.equal(result.partial, undefined);
  assert.equal(parseTextSchedule(html.replace('January 12, 2027', 'January 12'), tablePlan).partial, true);
});

const sectionPlan = { url: 'https://example.edu/crypto', options: { rowSelector: 'section', startHeading: 'Coming Talks', endHeading: 'Previous Talks',
  seriesSelector: 'h1', contextSelector: 'section:first', requirePublishedClock: true,
  defaultTimePattern: 'meets every (Thursday) at (.+?) ET', defaultLocationPattern: 'meet in person at (.+?) for the (F\\d{2}) semester',
  fields: { title: { selector: 'p', index: 0 }, speaker: { selector: 'p', index: 1 }, date: { selector: 'p', index: 2 } } } };

test('live seminar sections read their advertised clock and per-date exceptions without generating recurrence', () => {
  const html = '<h1>Crypto Seminar</h1><section>The seminar meets every Thursday at 4:30 pm ET. We will meet in person at GHC 7501 for the F26 semester, and stream the talks live via Zoom.</section><section>Coming Talks</section><section><p>TBD</p><p>Qi Pang</p><p>Oct. 28, 2026 (Wed, 1:30 pm)</p></section><section><p>New Topic</p><p>New Speaker</p><p>Nov. 5, 2026</p></section><section>Previous Talks</section><section><p>Old talk</p><p>Past Speaker</p><p>Nov. 1, 2025</p></section>';
  const result = parseTextSchedule(html, sectionPlan);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].start, '2026-10-28T17:30:00.000Z');
  assert.equal(result.events[1].start, '2026-11-05T21:30:00.000Z');
  assert.equal(result.events[1].location, 'GHC 7501 · Zoom');
  assert.equal(result.partial, undefined);
  const changed = parseTextSchedule(html.replace('Nov. 5, 2026', 'Nov. 6, 2026'), sectionPlan);
  assert.equal(changed.events[1].timePrecision, 'date', 'Thursday default is not borrowed for a Friday');
  assert.equal(changed.partial, true);
  const laterTerm = parseTextSchedule(html.replace('Nov. 5, 2026', 'Nov. 4, 2027'), sectionPlan);
  assert.equal(laterTerm.events[1].location, '', 'old semester room/stream promises do not carry into a newly posted year');
});

test('heading announcements read a new published year/date rather than preserving a reviewed fixed date', () => {
  const source = { url: 'https://example.edu/wellness', options: { rowSelector: 'main h3', followingSections: true } };
  const result = parseTextSchedule('<main><h3>Friendsgiving</h3><p>Save the Date! November 22, 2027, in the evening.</p><h3>Spirituality Month</h3><p>Every February.</p></main>', source);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].start, '2027-11-22');
  assert.equal(result.events[0].timePrecision, 'date');
});

test('conference discovery follows newly advertised links while date conflicts never select a year silently', async () => {
  const source = { url: 'https://example.edu/reviews', options: { layout: 'linked-consistent-details', linkSelector: 'main a',
    detailTitleSelector: 'h1', detailContentSelector: 'main' } };
  const good = '<main><h1>Review 2027</h1><p>June 9, 2027</p><table><tr><td>June 9, 2027</td><td>9:00-10:00 Welcome</td></tr></table></main>';
  const conflict = good.replace('<p>June 9, 2027</p>', '<p>June 9, 2026</p>');
  assert.equal(parseConsistentEventPage(conflict, source).partial, true);
  const result = await fetchTextSchedule(source, { fetchText: async url => url === source.url
    ? '<main><a href="/new-review">Review 2027</a><a href="/conflict">Conflicting review</a></main>' : url.endsWith('new-review') ? good : conflict });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].start, '2027-06-09');
  assert.equal(result.events[0].timePrecision, 'date', 'agenda times do not become the whole event clock');
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(' '), /conflict/);
});

test('Alumni dynamic configurations keep all-events and online discovery distinct during source-plan deduplication', () => {
  const patch = JSON.parse(readFileSync(new URL('../research/long-term-dynamic-sources-2026-10-25/config-patch-nonimage.json', import.meta.url), 'utf8'));
  const alumni = patch.sources.filter(source => ['8f00fc7f2c7c', '79e7cdffd54d'].includes(source.sourceId));
  assert.equal(alumni.length, 2);
  assert.equal(new Set(alumni.map(source => source.options.upstreamScope)).size, 2);
  for (const source of alumni) {
    assert.match(source.options.upstreamScope, /^public-dom-(?:all|online)$/);
    assert.equal(source.options.preferFeed, false);
    assert.equal(source.options.discovery, 'public-dom');
    assert.equal(source.options.reviewedPublicEvents, undefined);
  }
});
