import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fetchEvents, parseHtml, explicitTextDate } from '../src/adapters/index.mjs';

const base = { id: 'source', url: 'https://example.edu/events', adapter: 'html', options: { timezone: 'America/New_York' } };
const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:public-event\r\nDTSTART:20261023T130000Z\r\nSUMMARY:Club session [members only]\r\nEND:VEVENT\r\nEND:VCALENDAR';

test('independent verified endpoint contracts retain original feed and survive a primary outage', async () => {
  const plan = { ...base, options: { ...base.options, eventSelector: '.old-card',
    additionalEndpoints: [{ url: 'https://calendar.google.com/public.ics', adapter: 'ics', publicURL: 'https://example.edu/calendar', options: {} }] } };
  const requested = [];
  const result = await fetchEvents(plan, { fetchText: async url => { requested.push(url); if (url === base.url) throw Error('upstream unavailable'); return ics; } });
  assert.deepEqual(requested, [base.url, 'https://calendar.google.com/public.ics']);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].url, 'https://example.edu/calendar');
  assert.match(result.events[0].title, /members only/);
  assert.equal(result.partial, true);
  assert.equal(result.unsupported, undefined);
});

test('failed additional endpoint preserves a good primary snapshot and reports partial coverage', async () => {
  const plan = { ...base, options: { ...base.options, additionalEndpoints: [{ url: 'https://example.edu/missing', adapter: 'html' }] } };
  const result = await fetchEvents(plan, { fetchText: async url => {
    if (url.endsWith('/missing')) throw Error('404');
    return '<script type="application/ld+json">{"@type":"Event","name":"A talk","startDate":"2026-10-23"}</script>';
  } });
  assert.equal(result.events.length, 1);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(' '), /Additional endpoint failed/);
});

test('poster fields require the advertised image content hash, with changed/missing assets retained for review', async () => {
  const bytes = Buffer.from('reviewed poster bytes');
  const plan = { ...base, options: { ...base.options, reviewedImages: [{ selector: '#fall', sha256: createHash('sha256').update(bytes).digest('hex'), reviewedAt: '2026-10-21',
    events: [{ title: 'Concert', start: '2026-11-15T16:30:00', location: 'Music Hall', description: 'Free admission.' }] }] } };
  const context = { fetchText: async () => '<img id="fall" src="/poster.png">', fetchBytes: async () => bytes };
  const accepted = await fetchEvents(plan, context);
  assert.equal(accepted.events[0].start, '2026-11-15T21:30:00.000Z');
  assert.equal(accepted.events[0].end, accepted.events[0].start);
  assert.equal(accepted.events[0].description, 'Free admission.');
  assert.equal(accepted.unsupported, undefined);
  const changed = await fetchEvents(plan, { ...context, fetchBytes: async () => Buffer.from('new poster') });
  assert.equal(changed.events.length, 0);
  assert.equal(changed.partial, true);
  assert.match(changed.warnings.join(' '), /Poster changed/);
  const missing = await fetchEvents(plan, { ...context, fetchText: async () => '<main>No poster</main>' });
  assert.equal(missing.partial, true);
  assert.match(missing.warnings.join(' '), /found 0/);
});

test('human clock text after ISO dates preserves PM and does not become a timezone offset', () => {
  assert.equal(explicitTextDate('2026-10-02 8:00–10:00 PM'), '2026-10-02T20:00:00');
  assert.equal(explicitTextDate('2026-12-14 10:00 PM'), '2026-12-14T22:00:00');
  assert.equal(explicitTextDate('October 23, 2026 (7:00 - 9:00 PM)'), '2026-10-23T19:00:00');
  assert.equal(explicitTextDate('2026-10-02T20:00:00-04:00'), '2026-10-02T20:00:00-04:00');
});

test('uncertain clocks retain dates and printed caveats, while a consecutive date list retains its full range', () => {
  const plan = { ...base, options: { ...base.options, eventSelector: '.row', titleSelector: 'h2', dateSelector: 'p', yearSelector: 'h1', dateOnlyPattern: '\\*|TBD|Apple Picking', descriptionSelector: 'p' } };
  const result = parseHtml('<h1>Fall 2026</h1><div class="row"><h2>Sharing</h2><p>November 20 (7:30*–9:00*PM)</p></div><div class="row"><h2>Large Group</h2><p>October 23 (7:00–9:00PM)</p></div>', plan);
  assert.equal(result.events[0].start, '2026-11-20');
  assert.equal(result.events[0].timePrecision, 'date');
  assert.match(result.events[0].description, /7:30\*/);
  assert.equal(result.events[1].start, '2026-10-23T23:00:00.000Z');
  const reunion = parseHtml('<div class="row"><h2>Reunion 2027</h2><p>Reunion 2027 will be May 20, 21 &amp; 22!</p></div>', { ...plan,
    options: { ...plan.options, yearSelector: undefined, yearWithinCardSelector: 'h2', consecutiveDateList: true } });
  assert.equal(reunion.events[0].start, '2027-05-20');
  assert.equal(reunion.events[0].end, '2027-05-23');
});

test('Chabad public monthly calendar whitelists RSVP fields and keeps valid unassigned schedule slots', async () => {
  const { fetchChabadCalendar } = await import('../src/adapters/chabad.mjs');
  const plan = { ...base, url: 'https://student.chabadoncampus.org/chabad-of-cmu/calendar',
    fetchUrl: 'https://api.chabadoncampus.org/api/1.0/chabadHouses/public/calendar?chabadHouseSlug=chabad-of-cmu' };
  const result = await fetchChabadCalendar(plan, { windowStart: '2026-10-21', windowEnd: '2026-11-02', fetchText: async url => {
    if (new URL(url).searchParams.get('startDate') === '2026-11-01') throw Error('month unavailable');
    return JSON.stringify({ payload: [{ type: 'JewishHoliday', name: 'Holiday', dateTime: '2026-10-22T00:00:00' },
      { type: 'RsvpEvent', name: 'Cooking Club', dateTime: '2026-10-22T20:30:00', location: 'Chabad House', rsvpEventScheduleID: 55175, isStudentRegistered: true, secret: 'never retain' },
      { type: 'RsvpEvent', name: 'Shabbat Dinner', dateTime: '2026-10-30T19:00:00', rsvpEventScheduleID: 0, isRsvpEventEligibilityRestricted: true }] });
  } });
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].start, '2026-10-23T00:30:00.000Z');
  assert.equal(result.events[0].url, 'https://student.chabadoncampus.org/chabad-of-cmu/rsvp/events/55175');
  assert.equal(result.events[1].url, plan.url);
  assert.match(result.events[1].description, /eligibility.*restricted/);
  assert.doesNotMatch(JSON.stringify(result.events), /isStudentRegistered|never retain/);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(' '), /month.*failed/);
});

test('an unrecognized primary page remains partial when a secondary endpoint succeeds', async () => {
  const plan = { ...base, options: { ...base.options,
    additionalEndpoints: [{ url: 'https://example.edu/calendar.ics', adapter: 'ics' }] } };
  const result = await fetchEvents(plan, { fetchText: async url => url.endsWith('.ics') ? ics : '<main>The event page structure changed</main>' });
  assert.equal(result.events.length, 1);
  assert.equal(result.partial, true);
  assert.equal(result.unsupported, undefined);
});

test('reviewed public announcement dates cannot be reused after the selected text changes', async () => {
  const { parseReviewedFragments } = await import('../src/adapters/reviewed-images.mjs');
  const html = '<div id="notice">Sunday juggling at 3:30 PM</div>';
  const plan = { ...base, options: { ...base.options, reviewedFragments: [{ selector: '#notice', expectedCount: 1,
    sha256: createHash('sha256').update('Sunday juggling at 3:30 PM').digest('hex'), reviewedAt: '2026-10-21',
    events: [{ title: 'Sunday Juggling', start: '2026-10-18T15:30:00' }] }] } };
  assert.equal(parseReviewedFragments(html, plan, {}).events.length, 1);
  const changed = parseReviewedFragments(html.replace('3:30', '4:30'), plan, {});
  assert.equal(changed.events.length, 0);
  assert.equal(changed.partial, true);
});

test('Chabad API query dates include the source-local day at both UTC window boundaries', async () => {
  const { fetchChabadCalendar } = await import('../src/adapters/chabad.mjs');
  const urls = [];
  const result = await fetchChabadCalendar({ ...base, url: 'https://student.chabadoncampus.org/chabad-of-cmu/calendar',
    fetchUrl: 'https://api.chabadoncampus.org/api/1.0/chabadHouses/public/calendar?chabadHouseSlug=chabad-of-cmu' },
  { windowStart: '2026-09-22T01:00:00Z', windowEnd: '2026-09-23T01:00:00Z', fetchText: async url => {
    urls.push(new URL(url)); return JSON.stringify({ payload: [{ type: 'RsvpEvent', name: 'Evening session', dateTime: '2026-09-21T22:30:00', rsvpEventScheduleID: 1 }] });
  } });
  assert.equal(urls[0].searchParams.get('startDate'), '2026-09-21');
  assert.equal(urls[0].searchParams.get('endDate'), '2026-09-22');
  assert.equal(result.events.length, 1);
});

test('an explicit ISO timestamp outranks later doors/check-in clock text', () => {
  assert.equal(explicitTextDate('2026-10-02T20:00:00-04:00, doors at 7 PM'), '2026-10-02T20:00:00-04:00');
  assert.equal(explicitTextDate('2026-10-02 20:00:00-04:00, doors at 7 PM'), '2026-10-02T20:00:00-04:00');
  assert.equal(explicitTextDate('2026-10-02 doors at 7 PM'), '2026-10-02');
});
