import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSeminarDirectory, parseSemanticSeminar, advertisedSeminarFeeds, fetchSeminarDirectory } from '../src/adapters/seminar-discovery.mjs';
import { fetchEvents, combineSourceCoverage } from '../src/adapters/index.mjs';
import { normalizeEvent } from '../src/lib/normalize.mjs';
import { openStore } from '../src/lib/store.mjs';

const directory = JSON.parse(readFileSync(new URL('./fixtures/seminar-discovery/directory.json', import.meta.url)));
const patch = JSON.parse(readFileSync(new URL('../research/remaining-10-2026-10-26/directory-real-patch.json', import.meta.url)));
const window = { windowStart: '2026-09-26', windowEnd: '2027-10-26' };
const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:official-club-repost\r\nDTSTART:20261101T170000Z\r\nSUMMARY:Student Club hosted academic seminar\r\nURL:https://club.example/event\r\nEND:VEVENT\r\nEND:VCALENDAR';
const dirPlan = (id = 'directory', rows = [['Series', 'S', 'https://series.example/']]) => ({ id, org: 'Seminar directory', url: `https://directory.example/${id}`, fetchUrl: `https://directory.example/${id}`, adapter: 'html', status: 'active', options: { format: 'scs-directory', directoryUrl: `https://directory.example/${id}.json` } });
const dataFor = rows => JSON.stringify({ success: 'true', more: '0', cols: [{ n: 'seminar-name' }, { n: 'aka' }, { n: 'web-url' }], data: rows });

/**
 * Exercise profile reconciliation through the actual directory contract.
 * @param {Object[]} previous Existing normalized narrow catalog records.
 * @param {Object[]} fresh Current normalized structural profile records.
 * @return {Promise<Object>} Combined source result.
 */
function reconcileProfile(previous, fresh) {
  const plan = dirPlan();
  plan.options.bindings = [{ name: 'Series', sourceId: 'official-catalog', profile: { format: 'semantic-seminar', layout: 'dated-table' } }];
  return fetchSeminarDirectory(plan, { sourcePlans: [], fetchText: async () => dataFor([['Series', '', 'https://series.example/']]),
    resolveSource: async () => ({ events: previous }), fetchSourcePlan: async () => ({ events: fresh }) });
}

test('a uniquely matched current speaker clock upgrades unknown time while preserving the original identity, title and existing venue', async () => {
  const previous = normalizeEvent({ uid: 'catalog-original', title: 'Seminar — Ada Researcher', start: '2026-11-03',
    url: 'https://series.example/original', location: 'Original Room' });
  const fresh = normalizeEvent({ uid: 'structural-profile', title: 'Newly supplied abstract title', start: '2026-11-03T23:30:00', end: '2026-11-04T00:00:00',
    description: 'Speaker: Ada Researcher.\nLive source text.', url: 'https://series.example/index.html', location: 'Changed Room' });
  const result = await reconcileProfile([previous], [fresh]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].uid, previous.uid);
  assert.equal(result.events[0].title, previous.title);
  assert.equal(result.events[0].url, previous.url);
  assert.equal(result.events[0].location, previous.location);
  assert.equal(result.events[0].start, '2026-11-04T04:30:00.000Z', 'match uses publisher local day, not the next UTC date');
  assert.equal(result.events[0].end, fresh.end);
  assert.equal(result.events[0].timeZone, fresh.timeZone);
  assert.equal(result.events[0].timePrecision, 'time');
  assert.equal(result.events[0].allDay, false);
  const noVenue = await reconcileProfile([{ ...previous, location: '' }], [fresh]);
  assert.equal(noVenue.events[0].location, fresh.location);
  assert.equal(result.coverage.counters.currentEvents, 1);
});

test('profile clocks cannot collapse explicit all-day, multi-day, ambiguous old or ambiguous fresh occurrences', async () => {
  const previous = normalizeEvent({ uid: 'old', title: 'Named seminar', start: '2026-11-03', url: 'https://series.example/original' });
  const fresh = normalizeEvent({ uid: 'fresh', title: previous.title, start: '2026-11-03T11:30:00', url: 'https://series.example/original' });
  for (const old of [{ ...previous, timePrecision: 'all-day' }, { ...previous, end: '2026-11-05' }]) {
    const result = await reconcileProfile([old], [fresh]);
    assert.equal(result.events.length, 2);
    assert.deepEqual(result.events.find(event => event.uid === old.uid).start, old.start);
  }
  const ambiguousOld = await reconcileProfile([previous, { ...previous, uid: 'other-old' }], [fresh]);
  assert.equal(ambiguousOld.events.length, 3);
  const ambiguousFresh = await reconcileProfile([previous], [fresh, { ...fresh, uid: 'second-session', start: '2026-11-03T20:00:00.000Z' }]);
  assert.equal(ambiguousFresh.events.length, 3);
  assert.equal(ambiguousFresh.events.find(event => event.uid === previous.uid).timePrecision, 'date');
});

test('upgraded directory clocks and the original catalog date collapse to one store event with both official sources', async t => {
  const previous = normalizeEvent({ uid: 'catalog-event', title: 'Exact original seminar title', start: '2026-11-03',
    url: 'https://series.example/original', description: 'Public official source.' });
  const fresh = normalizeEvent({ uid: 'profile-event', title: previous.title, start: '2026-11-03T11:30:00',
    url: 'https://series.example/index.html', description: 'Speaker: Ada Researcher.\nLive dated schedule.' });
  const result = await reconcileProfile([previous], [fresh]);
  const plans = [{ id: 'official-catalog', adapter: 'html', status: 'active', org: 'Official seminar', department: 'SCS', url: 'https://series.example/' },
    { id: 'directory', adapter: 'html', status: 'active', org: 'Official directory', department: 'SCS', url: 'https://directory.example/' }];
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans(plans);
  store.replaceSource('official-catalog', [previous]);
  store.replaceSource('directory', result.events);
  assert.equal(store.rebuildEvents(plans), 1, 'same original title/link/local day with one dated listing and one clock must not duplicate');
  const merged = store.listEvents().events[0];
  assert.equal(merged.start, fresh.start);
  assert.equal(merged.timePrecision, 'time');
  assert.equal(merged.uid, previous.uid);
  assert.deepEqual(new Set(merged.sources.map(source => source.id)), new Set(plans.map(plan => plan.id)));
});

test('published column schema parses all26 rows and automatically accepts a new27th series', () => {
  const rows = parseSeminarDirectory(directory);
  assert.equal(rows.length, 26);
  assert.equal(rows.filter(row => !row.url).length, 6);
  const reordered = { ...directory, cols: [...directory.cols].reverse(), data: directory.data.map(row => [...row].reverse()) };
  assert.deepEqual(parseSeminarDirectory(reordered), rows);
  assert.equal(parseSeminarDirectory({ ...directory, data: [...directory.data, ['New Series', 'NEW', 'https://new.example/', 'Monday', '13:00']] }).length, 27);
  assert.throws(() => parseSeminarDirectory({ success: true, cols: [], data: [] }), /columns/);
  assert.throws(() => parseSeminarDirectory(JSON.parse(dataFor([['Unsafe', '', 'https://user:secret@source.example/']]))), /anonymous/);
});

test('current complete directory configuration inspects26 rows without generating weekday recurrence', async () => {
  const production = patch.sources[0];
  const result = await fetchSeminarDirectory({ ...dirPlan(), ...production }, { ...window, sourcePlans: [],
    fetchText: async () => JSON.stringify(directory), resolveSource: async () => ({ events: [], warnings: [] }),
    fetchSourcePlan: async () => ({ events: [], warnings: [] }) });
  assert.equal(result.coverage.counters.advertised, 26);
  assert.equal(result.coverage.counters.processed, 26);
  assert.equal(result.coverage.counters.catalogReused, 19);
  assert.equal(result.coverage.series.length, 26);
  assert.deepEqual(result.coverage.internalIssues, []);
  assert.equal(result.coverage.inspectionComplete, true);
  assert.equal(result.events.length, 0, 'directory weekday/time cannot create any occurrence');
  assert.equal(result.coverage.series.filter(row => !row.url && !row.reusedSourceIds.length).every(row => row.undated), true);
});

test('per-run catalog reuse preserves aliases/provenance and official club reposts, and retries in a new run', async () => {
  const feed = { id: 'feed', adapter: 'ics', status: 'active', url: 'https://series.example/feed.ics', options: {} };
  const alias = { ...feed, id: 'alias', status: 'covered', canonicalSourceId: 'feed' };
  const parent = dirPlan(); parent.options.bindings = [{ name: 'Series', sourceId: 'alias' }];
  let calls = 0;
  const context = { ...window, sourcePlans: [parent, feed, alias], sourceScope: { blockedSourceUrls: ['https://club.example/'] },
    fetchText: async url => { if (url.endsWith('.json')) return dataFor([['Series', 'S', 'https://series.example/']]); calls++; return ics; } };
  const [a, b] = await Promise.all([fetchEvents(parent, context), fetchEvents(feed, context)]);
  assert.equal(calls, 1);
  assert.equal(a.events.length, 1);
  assert.equal(b.events[0].uid, a.events[0].uid);
  assert.ok(a.events[0].tags.includes('Series'));
  assert.equal(a.events[0].url, 'https://club.example/event', 'policy excludes source owners, never reposted event links');
  assert.deepEqual(a.coverage.series[0].reusedCanonicalSourceIds, ['feed']);
  assert.strictEqual(await fetchEvents(parent, context), a);
  await fetchEvents(parent, { ...context });
  assert.equal(calls, 2);
});

test('concurrent source discovery cycles resolve explicitly instead of awaiting each other forever', async () => {
  const a = dirPlan('a'), b = dirPlan('b');
  a.options.fallbackSourceId = b.id; b.options.fallbackSourceId = a.id;
  const context = { sourcePlans: [a, b], fetchText: async () => dataFor([['No website', '', '']]) };
  let timer;
  try {
    const results = await Promise.race([Promise.all([fetchEvents(a, context), fetchEvents(b, context)]), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('deadlock')), 1000); })]);
    assert.ok(results.every(result => result.partial));
    assert.ok(results.every(result => result.coverage.internalIssues.some(issue => /cycle/.test(JSON.stringify(issue)))));
  } finally { clearTimeout(timer); }
});

test('new unknown directory URLs are policy checked before discovery requests; self-reference remains an internal issue', async () => {
  const parent = dirPlan(); const requests = [];
  const context = { sourcePlans: [parent], sourceScope: { blockedSourceUrls: ['https://blocked.example/club'] },
    fetchText: async url => { requests.push(url); if (url.endsWith('.json')) return dataFor([['Blocked club', '', 'https://blocked.example/club']]); throw Error('Blocked source must never be fetched'); } };
  const result = await fetchEvents(parent, context);
  assert.equal(requests.length, 1);
  assert.equal(result.coverage.nonBlockingIssues[0].code, 'SOURCE_POLICY_EXCLUSION');
  const self = await fetchEvents(parent, { ...context, fetchText: async () => dataFor([['Self', '', parent.url]]) });
  assert.equal(self.coverage.inspectionComplete, false);
  assert.match(JSON.stringify(self.coverage.internalIssues), /itself/);
});

test('new publisher series dynamically discovers its advertised ICS and exact RI categories keep unrelated broad-feed events out', async () => {
  const parent = dirPlan();
  const context = { ...window, sourcePlans: [parent], fetchText: async url => url.endsWith('.json') ? dataFor([['New Series', '', 'https://new.example/']])
    : url.endsWith('.ics') ? ics : '<main><a href="/upcoming.ics">Subscribe</a></main>' };
  const discovered = await fetchEvents(parent, context);
  assert.equal(discovered.events.length, 1);
  assert.equal(discovered.coverage.inspectionComplete, true);
  const scoped = { ...parent, options: { ...parent.options, bindings: [{ name: 'RI Seminar', sourceId: 'broad', matchTags: ['RI Seminar'] }, { name: 'VASC Seminar', sourceId: 'broad', matchTags: ['VASC Seminar'] }] } };
  const result = await fetchSeminarDirectory(scoped, { fetchText: async () => dataFor([['RI Seminar', '', ''], ['VASC Seminar', '', '']]), resolveSource: async () => ({ events: [
    { uid: 'ri', title: 'A topic', start: '2026-11-01', tags: ['RI Seminar'] },
    { uid: 'vasc', title: 'A different topic', start: '2026-11-02', tags: ['VASC Seminar'] },
    { uid: 'meeting', title: 'Faculty meeting', start: '2026-11-03', tags: ['Seminar'] },
  ] }) });
  assert.deepEqual(result.events.map(event => event.uid), ['ri', 'vasc']);
  assert.deepEqual(result.events.find(event => event.uid === 'ri').tags, ['RI Seminar']);
});

test('semantic LCS parsing survives unrelated body changes and recognizes new full-date sections without biography-year guesses', () => {
  const options = { format: 'semantic-seminar', layout: 'speaker-sections' };
  const html = '<h1>Learning and Control Seminar</h1><section><h2>Next upcoming seminar</h2><p>TBD</p></section><section><h2>Ada Scientist</h2><h3>May 1, 2024</h3><h4>Historical Talk</h4><p>PhD 2023, publication in 2026</p></section><footer>Updated website navigation</footer>';
  const before = parseSemanticSeminar(html, { url: 'https://lcs.example/', options }, window);
  assert.equal(before.internalGap, false);
  assert.equal(before.upcomingUndated, true);
  assert.equal(before.recognized, 1);
  assert.equal(before.events.length, 0);
  assert.equal(before.undated, false, 'valid historical records outside the window establish a supported empty window');
  const current = parseSemanticSeminar(html.replace('<p>TBD</p>', '<h3>November 3, 2026</h3><h4>Live New Talk</h4>'), { url: 'https://lcs.example/', options }, window);
  assert.equal(current.events[0].title, 'Live New Talk');
  assert.equal(current.events[0].start, '2026-11-03');
  assert.equal(current.internalGap, false);
  const changed = parseSemanticSeminar(html.replace('<p>TBD</p>', '<p>New speaker forthcoming</p>'), { url: 'https://lcs.example/', options }, window);
  assert.equal(changed.internalGap, true);
});

test('grouped-table dates come from visible headings and never a contradictory HTML filename', () => {
  const html = '<table><tr><td><b class="date">June 11, 2026</b></td></tr><tr><td>Speaker One</td><td><a href="/2030/010130.shtml#one">Talk One</a></td></tr><tr><td>Speaker Two</td><td><a href="/not-a-date.shtml">Talk Two</a></td></tr></table>';
  const result = parseSemanticSeminar(html, { url: 'https://pdl.example/', options: { layout: 'grouped-table', tableSelector: 'table', dateSelector: 'b.date', titleSelector: 'td:nth-child(2)>a', speakerSelector: 'td:first-child' } }, { windowStart: '2026-01-01', windowEnd: '2027-01-01' });
  assert.equal(result.events.length, 2);
  assert.ok(result.events.every(event => event.start === '2026-06-11'));
  assert.equal(result.internalGap, false);
});

test('dated cards use explicit semester headers and named pending topics; table placeholders do not become events', () => {
  const card = '<h1>ACO Seminar</h1><h2>Fall 2026</h2><div class="talk"><span class="head">October 29</span>, 3:00pm, Wean 8220<br><span class="head">Zeyu Zheng</span><br><a href="/abstract">TBA</a></div>';
  const aco = parseSemanticSeminar(card, { url: 'https://aco.example/', options: patch.sources[0].options.bindings.find(b => b.name.startsWith('Algorithms')).profile }, window);
  assert.equal(aco.events[0].start, '2026-10-29T19:00:00.000Z');
  assert.match(aco.events[0].title, /Zeyu Zheng/);
  assert.equal(aco.events[0].location, 'Wean 8220');
  const table = '<main><p>Location: Room A</p><li>Time: 11:30am; arrive 11:25am</li><table><tr><td>November 6, 2026</td><td><strong>Named Speaker</strong></td><td>Host</td><td></td></tr><tr><td>November 13, 2026</td><td><strong>NO SEMINAR</strong></td><td></td><td></td></tr><tr><td>November 20, 2026</td><td></td><td></td><td></td></tr></table></main>';
  const profile = patch.sources[0].options.bindings.find(b => b.name.startsWith('Joint')).profile;
  const cpcb = parseSemanticSeminar(table, { url: 'https://cpcb.example/', options: { ...profile, contextSelector: 'main' } }, window);
  assert.equal(cpcb.events.length, 1);
  assert.equal(cpcb.events[0].start, '2026-11-06T16:30:00.000Z');
  assert.equal(cpcb.events[0].title, 'CPCB Seminar Series — Named Speaker');
  assert.equal(cpcb.pendingSlots, 1);
});

test('REAL semantic example schedule stays undated, follows newly advertised public calendars, and reports concrete404 externally', async () => {
  const plan = { id: 'real', adapter: 'html', status: 'active', url: 'https://real.example/', options: { format: 'semantic-seminar', layout: 'series-landing', contentSelector: 'main' } };
  const id = 'published-calendar@group.calendar.google.com';
  const html = `<main><h1>Seminars</h1><p>Biweekly discussions. Example schedule: 10am–3pm.</p><a href="https://calendar.google.com/calendar/u/0/r?cid=${Buffer.from(id).toString('base64')}">Calendar</a></main>`;
  assert.equal(advertisedSeminarFeeds(html, plan.url)[0].url, `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`);
  const result = await fetchEvents(plan, { sourcePlans: [plan], fetchText: async url => { if (url.endsWith('.ics')) throw Error('HTTP 404 from calendar.google.com'); return html; } });
  assert.equal(result.events.length, 0);
  assert.equal(result.partial, true);
  assert.equal(result.coverage.inspectionComplete, true);
  assert.equal(result.coverage.externalIssues.length, 1);
  assert.deepEqual(result.coverage.internalIssues, []);
});

test('endpoint coverage preserves string issues, mixed parser warnings stay internal, and failed siblings cannot be hidden', async () => {
  const audit = { version: 1, kind: 'test', inspectionComplete: true, internalIssues: [], externalIssues: ['public404'], nonBlockingIssues: [] };
  const combined = combineSourceCoverage([{ url: 'https://a.example', coverage: audit }, { url: 'https://b.example', coverage: audit }]);
  assert.deepEqual(combined.externalIssues[0], { endpoint: 'https://a.example', reason: 'public404' });
  const plan = { id: 'partial', adapter: 'html', url: 'https://a.example', options: { format: 'text-schedule', rowSelector: 'tr', fields: { title: { selector: 'td', index: 0 }, date: { selector: 'td', index: 1 } }, additionalEndpoints: [{ url: 'https://b.example', adapter: 'html', options: { format: 'semantic-seminar', layout: 'series-landing', contentSelector: 'main' } }] } };
  const result = await fetchEvents(plan, { fetchText: async url => url === plan.url ? '<tr><td>HTTP 503 Training</td><td>Date not announced</td></tr>' : '<main><h1>Workshop</h1><p>Example schedule</p></main>' });
  assert.equal(result.coverage.inspectionComplete, false);
  assert.equal(result.coverage.internalIssues.length, 1);
  assert.equal(result.coverage.externalIssues.length, 0);
  const failure = await fetchEvents(plan, { fetchText: async url => { if (url === plan.url) throw Error('HTTP 403 from a.example'); return '<main><h1>Workshop</h1><p>Example schedule</p></main>'; } });
  assert.equal(failure.coverage.inspectionComplete, true);
  assert.equal(failure.coverage.externalIssues.length, 1);
  const budget = await fetchEvents(plan, { fetchText: async url => { if (url === plan.url) throw Error('scan budget exhausted after request timeout'); return '<main><h1>Workshop</h1><p>Example schedule</p></main>'; } });
  assert.equal(budget.coverage.inspectionComplete, false);
  assert.equal(budget.coverage.internalIssues.length, 1);
});
