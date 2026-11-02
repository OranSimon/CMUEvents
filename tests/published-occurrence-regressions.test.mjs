import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseHtml, fetchHtml, explicitTextDate, explicitTextEnd } from '../src/adapters/html.mjs';
import { parseNewsletterText } from '../src/adapters/newsletter.mjs';
import { publishedDateRange, publishedCalendarSchedule } from '../src/lib/published-dates.mjs';
import { normalizeEvent } from '../src/lib/normalize.mjs';
import { openStore } from '../src/lib/store.mjs';
import { exportCrawlState, restoreCrawlState } from '../src/lib/crawl-state.mjs';
import { queryEventsSnapshot } from '../web/data-client.js';
import { calendarEligibility, hasPublishedTimeConflict } from '../web/event-semantics.js';

const publisher = { id: 'arts', status: 'active', adapter: 'html', url: 'https://arts.example.edu/events',
  department: 'Arts', org: 'Arts events', options: { timezone: 'America/New_York' } };
const newsletter = { ...publisher, id: 'newsletter', adapter: 'newsletter', url: 'https://example.edu/newsletter', org: 'Public newsletter' };
const detailUrl = 'https://arts.example.edu/events/regional-print-fair';
const relatedUrl = 'https://museum.example.org/event/regional-print-fair';
const title = '2026 Regional Print Fair';
const calendar = (dates, text = title, zone = 'America/New_York') => `https://calendar.google.com/calendar/render?action=TEMPLATE&dates=${dates}&ctz=${zone}&text=${encodeURIComponent(text)}`;
const detailHtml = `<main><h1>${title}</h1><div class="date">October 31, 2026</div><div class="clock">10:00AM</div>
<div class="description"><p>A public fair runs October 31–November 1, 2026. <a href="${relatedUrl}">Fair information</a></p></div>
<a href="${calendar('20261031T100000/20261101T170000')}">Add to Calendar</a></main>`;
const detailOptions = { eventSelector: 'main', titleSelector: 'h1', dateSelector: '.date', timeSelector: '.clock', descriptionSelector: '.description', linkSelector: ':scope' };

function storeFor(t, snapshots) {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans(snapshots.map(([plan]) => plan));
  for (const [plan, events] of snapshots) store.replaceSource(plan.id, events);
  store.rebuildEvents(snapshots.map(([plan]) => plan));
  return store;
}

test('prose ranges include the last day with a year at either endpoint and preserve cross-year uncertainty', () => {
  for (const text of ['October 31, 2026 to November 1', 'October 31–November 1, 2026', 'October 31, 2026 – November 1, 2026']) {
    assert.equal(explicitTextDate(text), '2026-10-31');
    assert.equal(explicitTextEnd(text, '2026-10-31'), '2026-11-02');
  }
  assert.equal(publishedDateRange('December 30–January 2, 2027'), null);
  assert.equal(publishedDateRange('October 31 to November 1'), null);
  assert.equal(publishedDateRange('February 28–March 32, 2027'), null);
  assert.equal(publishedDateRange('November 5, 2026 1–2 PM'), null);
  assert.equal(explicitTextEnd('December 30, 2026–January 2, 2027', '2026-12-30'), '2027-01-03');
});

test('publisher calendar templates preserve the source zone across a DST transition and keep exclusive all-day ends', () => {
  const schedule = publishedCalendarSchedule(calendar('20261031T100000/20261101T170000'));
  const event = normalizeEvent({ title, url: detailUrl, ...schedule });
  assert.equal(event.start, '2026-10-31T14:00:00.000Z');
  assert.equal(event.end, '2026-11-01T22:00:00.000Z');
  assert.equal((Date.parse(event.end) - Date.parse(event.start)) / 3600000, 32);
  const days = publishedCalendarSchedule(calendar('20261031/20261102'));
  assert.equal(days.end, '2026-11-02');
  assert.equal(days.allDay, true);
  assert.equal(publishedCalendarSchedule(calendar('20261031T100000/20261031T090000')), null);
  assert.equal(publishedCalendarSchedule(calendar('20261031T100000/20261101T170000', title, 'Mars/Unknown')), null);
  assert.equal(publishedCalendarSchedule('https://attacker.example/calendar/render?dates=20261031/20261102'), null);
});

test('scoped HTML reads the advertised complete schedule and never borrows a different event calendar link', () => {
  const plan = { ...publisher, url: detailUrl, options: detailOptions };
  const good = parseHtml(detailHtml, plan).events[0];
  assert.equal(good.end, '2026-11-01T22:00:00.000Z');
  assert.equal(good.contentRole, 'detail');
  assert.deepEqual(good.relatedEventUrls, [relatedUrl]);
  const wrong = parseHtml(detailHtml.replace(encodeURIComponent(title), 'Different+session'), plan).events[0];
  assert.equal(wrong.end, wrong.start);
  const range = parseHtml('<article class="event"><h2>Two day fair</h2><p class="date">October 31, 2026 to November 1</p><p class="clock">10 AM</p></article>',
    { ...publisher, options: { dateSelector: '.date', timeSelector: '.clock' } }).events[0];
  assert.equal(range.timePrecision, 'date');
  assert.equal(range.end, '2026-11-02');
  const utcNight = parseHtml(detailHtml.replace('10:00AM', '10:00PM')
    .replace('20261031T100000/20261101T170000', '20261101T020000Z/20261101T030000Z'), plan).events[0];
  assert.equal(utcNight.start, '2026-11-01T02:00:00.000Z');
  assert.equal(utcNight.end, '2026-11-01T03:00:00.000Z');
  const conflicting = parseHtml(detailHtml.replace('<div class="clock">10:00AM</div>',
    '<div class="clock">10:00AM to 11:00AM</div>'), plan);
  assert.equal(conflicting.partial, true);
  assert.equal(conflicting.events[0].end, '2026-10-31T15:00:00.000Z');
});

test('listing/detail reconciliation and a linked newsletter retain one full occurrence and all original claims', async t => {
  const plan = { ...publisher, options: { ...publisher.options, detailLinks: true, eventSelector: 'article',
    titleSelector: 'h3 a', dateSelector: '.date', timeSelector: '.clock', detailOptions } };
  const listing = `<article><h3><a href="${detailUrl}">Regional Print Fair 2024</a></h3>
    <p class="date">October 31, 2026 – November 1, 2026</p><p class="clock">10 AM</p></article>`;
  const parsed = await fetchHtml(plan, { fetchText: async url => url === plan.url ? listing : detailHtml });
  const printed = parseNewsletterText(`${title}\nOct. 31, 2026 to Nov. 1\nExplore books and art. Learn More [Fair](${relatedUrl})`, newsletter);
  assert.equal(printed.events[0].end, '2026-11-02');
  const store = storeFor(t, [[plan, parsed.events], [newsletter, printed.events]]);
  const events = store.listEvents({ from: '2026-10-31', to: '2026-11-05' }).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].title, title);
  assert.equal(events[0].start, '2026-10-31T14:00:00.000Z');
  assert.equal(events[0].end, '2026-11-01T22:00:00.000Z');
  assert.deepEqual(new Set(events[0].sources.map(source => source.eventUrl)), new Set([detailUrl, relatedUrl]));
  assert.ok(events[0].sourceVariants.some(variant => variant.title === 'Regional Print Fair 2024'));
  assert.ok(events[0].sourceVariants.some(variant => variant.timePrecision === 'date' && variant.end === '2026-11-02'));
  assert.ok(events[0].sourceConflicts.includes('title'));
  const context = { today: '2026-11-01', now: Date.parse('2026-11-01T17:00:00Z') };
  assert.equal(queryEventsSnapshot({ events }, { eventView: 'ongoing', from: context.today, to: context.today }, context).total, 1);
  assert.equal(store.listEvents({ eventView: 'ongoing', from: context.today, to: context.today, ...context }).total, 1);
  const restored = openStore(':memory:'); t.after(() => restored.close());
  restored.registerPlans([plan, newsletter]);
  restoreCrawlState(restored, [plan, newsletter], exportCrawlState(store));
  assert.deepEqual(restored.listEvents({ from: '2026-10-31' }).events[0].sources, events[0].sources);
});

test('a date-only multiday range never selects between several published clocks or absorbs explicit all-day data', t => {
  const base = { title, url: detailUrl, timeZone: 'America/New_York' };
  const dates = [normalizeEvent({ ...base, start: '2026-10-31', end: '2026-11-02' }, publisher)];
  const clocks = ['10:00', '12:00'].map(time => normalizeEvent({ ...base, start: `2026-10-31T${time}:00`, end: '2026-11-01T17:00:00' }, newsletter));
  const store = storeFor(t, [[publisher, dates], [newsletter, clocks]]);
  assert.equal(store.listEvents({ from: '2026-10-31' }).total, 3);
  const explicit = storeFor(t, [[publisher, [normalizeEvent({ ...base, start: '2026-10-31', end: '2026-11-02', allDay: true }, publisher)]], [newsletter, [clocks[0]]]]);
  assert.equal(explicit.listEvents({ from: '2026-10-31' }).total, 2);
  const sameDay = storeFor(t, [[publisher, [normalizeEvent({ ...base, start: '2026-10-31' }, publisher)]],
    [newsletter, ['11:00', '12:00'].map(end => normalizeEvent({ ...base, start: '2026-10-31T10:00:00', end: `2026-10-31T${end}:00` }, newsletter))]]);
  assert.equal(sameDay.listEvents({ from: '2026-10-31' }).total, 3);
});

test('university acronyms merge only with a specific shared title suffix, exact clock and independent venue evidence', t => {
  const plans = [publisher, newsletter].map(plan => ({ ...plan, url: `https://${plan.id}.ebu.edu/calendar` }));
  const long = { title: 'Elm Bay Orchestra: Autumn at Founders Hall', description: 'A concert featuring chamber musicians and a varied program for campus visitors.',
    start: '2026-10-31T18:00:00Z', location: 'Founders Hall for the Performing Arts', url: 'https://events.ebu.edu/events/autumn-concert' };
  const short = { ...long, title: 'EBU Orchestra: Autumn at Founders Hall', location: '', url: 'https://news.ebu.edu/events/concert-copy',
    description: 'EBU Orchestra: Autumn at Founders Hall\n2 p.m., Founders Hall, 100 Campus Drive\nFree and open to the public; tickets required.' };
  const build = (a, b) => storeFor(t, [[plans[0], [normalizeEvent(a, plans[0])]], [plans[1], [normalizeEvent(b, plans[1])]]]).listEvents({ from: '2026-10-31' }).events;
  const events = build(long, short);
  assert.equal(events.length, 1);
  assert.equal(events[0].sources.length, 2);
  assert.ok(events[0].sourceVariants.some(variant => (variant.description
    || (variant.descriptionMatchesCanonical ? events[0].description : '')).includes('tickets required')));
  assert.equal(build(long, { ...short, start: '2026-11-01T18:00:00Z' }).length, 2);
  assert.equal(build({ ...long, end: '2026-10-31T19:00:00Z' }, { ...short, end: '2026-10-31T20:00:00Z' }).length, 2);
  assert.equal(build(long, { ...short, title: 'ABC Orchestra: Autumn at Founders Hall' }).length, 2);
});

test('shared links do not merge different dates, conflicting ends or unrelated titles after a listing year changes', t => {
  const base = { title: 'Regional Print Fair 2024', url: detailUrl, start: '2026-10-31T14:00:00Z', end: '2026-10-31T17:00:00Z' };
  for (const change of [{ start: '2026-11-01T14:00:00Z', end: '2026-11-01T17:00:00Z' },
    { end: '2026-10-31T18:00:00Z' }, { title: 'Regional Poetry Reading 2026' }]) {
    const store = storeFor(t, [[publisher, [normalizeEvent(base, publisher)]],
      [newsletter, [normalizeEvent({ ...base, title: '2026 Regional Print Fair', ...change }, newsletter)]]]);
    assert.equal(store.listEvents({ from: '2026-10-31' }).total, 2);
  }
});

test('corroborated deadlines and long merchandise claim windows are excluded while real sessions survive', t => {
  const date = { start: '2026-10-31T18:00:00Z', end: '2026-10-31T19:00:00Z' };
  const rows = [
    { title: 'Autumn Research Awards Applications Due', description: 'Applications are due October 31. Start your application now.' },
    { title: 'Research Grant Application Deadline', description: 'Apply by October 31, 2026, at 11:59 PM.' },
    { title: 'Application deadline: Graduate Fellows program', description: '' },
    { title: 'Investing Competition - Registration Deadline', description: 'TBD' },
    { title: 'Semester Withdrawal Deadline', description: 'Today is the last day to withdraw from a course.' },
    { title: 'Course Drop Deadline; Grade Assigned After This Date', description: 'The deadline to drop a course is today.' },
    { title: 'Venture Competition: Deadline to receive a coach', description: 'Register for the competition and include your team members by December 1.' },
    { title: 'Benefit T-Shirts: Reserve Your Size', description: 'Make a donation to claim a shirt. Reserve your size; quantities are limited. Pickup day will be announced.', end: '2026-11-07T19:00:00Z' },
  ];
  for (const row of rows) assert.equal(calendarEligibility({ ...date, ...row }).eligible, false);
  const sessions = [
    { title: 'Awards Application Workshop', description: 'Join our workshop at 2 PM; applications are due next month.' },
    { title: 'Application Deadline Clinic', description: 'An information session to help prepare your submission.' },
    { title: 'Application Deadline: Writing Workshop', description: 'Join us for a workshop; applications are due next month.' },
    { title: 'Writing Before the Deadline', description: 'Join us for a writing workshop. The application deadline is next week.' },
    { title: 'Benefit T-Shirts Pickup Session', description: 'Choose your size and pick up your shirt at this published session.' },
    { title: 'Community fundraiser', description: 'Join our benefit performance. Donations support local services.' },
  ];
  for (const row of sessions) assert.equal(calendarEligibility({ ...date, ...row }).eligible, true);
  const store = storeFor(t, [[publisher, [...rows, ...sessions].map((row, index) => normalizeEvent({ ...date, url: `${detailUrl}/${index}`, ...row }, publisher))]]);
  assert.equal(store.status().totalEvents, sessions.length);
  assert.equal(store.getMeta('eventExclusions').count, rows.length);
});

test('changed HTML/newsletter contracts reject old truncated snapshots without invalidating unrelated ICS feeds', t => {
  for (const plan of [publisher, newsletter, { ...publisher, adapter: 'ics' }]) {
    const original = storeFor(t, [[plan, [normalizeEvent({ title, start: '2026-10-31', url: detailUrl }, plan)]]]);
    const state = exportCrawlState(original);
    state.sources[0].contract = createHash('sha256').update(JSON.stringify({ eventSchema: 2, adapter: plan.adapter, fetchUrl: plan.fetchUrl,
      status: plan.status, canonicalSourceId: plan.canonicalSourceId, options: plan.options || {} })).digest('hex');
    const restored = openStore(':memory:'); t.after(() => restored.close()); restored.registerPlans([plan]);
    const result = restoreCrawlState(restored, [plan], state);
    assert.equal(result.invalidated.length, plan.adapter === 'ics' ? 0 : 1);
  }
});

test('an explicit all-day feed with a short published clock is flagged without inventing an instant', () => {
  const event = normalizeEvent({ title: 'Visiting swim meet', start: '2026-10-31', allDay: true,
    description: 'Visiting swim meet, 1:00 p.m.', url: detailUrl }, publisher);
  assert.equal(hasPublishedTimeConflict(event), true);
  assert.equal(event.start, '2026-10-31');
  assert.equal(event.timePrecision, 'all-day');
  assert.equal(hasPublishedTimeConflict({ ...event, description: 'All-day campus open house' }), false);
  assert.equal(hasPublishedTimeConflict({ ...event, timePrecision: 'date' }), false);
  assert.equal(hasPublishedTimeConflict({ ...event, timePrecision: 'time', allDay: false }), false);
  assert.equal(hasPublishedTimeConflict({ ...event, description: 'A long exhibition description. '.repeat(20) + 'A separate lecture is at 1 PM.' }), false);
});
