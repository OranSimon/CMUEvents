import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseGeneratedCalendar } from '../src/adapters/generated-calendar.mjs';
import { fetchEvents } from '../src/adapters/index.mjs';
import { parseCampusGroups, fetchCampusGroups } from '../src/adapters/campusgroups.mjs';
import { parseHtml } from '../src/adapters/html.mjs';
import { plainText } from '../src/lib/normalize.mjs';

const html = await readFile(new URL('./adapters/fixtures/msa-calendar.html', import.meta.url), 'utf8');
const blockStart = "document.getElementById('jummah-ics-btn')?.addEventListener('click', () => {";
const blockEnd = '// --- Dynamic Prayer Times API Logic ---';
const block = html.slice(html.indexOf(blockStart), html.indexOf(blockEnd)).trim();
const plan = { url: 'https://cmumsa.org/', adapter: 'html', options: { timezone: 'America/New_York',
  generatedCalendar: { buttonSelector: '#jummah-ics-btn', blockStart, blockEnd,
    sha256: createHash('sha256').update(block).digest('hex'), event: {
      weekday: 5, clock: '131500', duration: 'PT1H', rrule: 'FREQ=WEEKLY;BYDAY=FR',
      uidPrefix: 'cmu-msa-jummah-', uidSuffix: '@cmumsa.org', title: 'CMU MSA Jummah',
      location: 'CMU University Center, Danforth Conference Room',
      description: 'Check the MSA WhatsApp for weekly room changes.',
    } } } };
const qatarRows = JSON.parse(await readFile(new URL('./adapters/fixtures/qatar-campusgroups.json', import.meta.url)));
const qatarPlan = { url: 'https://scottyconnect.qatar.cmu.edu/events?group_ids=35446',
  fetchUrl: 'https://scottyconnect.qatar.cmu.edu/mobile_ws/v17/mobile_events_list?filter2=35446',
  adapter: 'campusgroups', options: { format: 'campusgroups-json', groupID: '35446', timezone: 'Asia/Qatar', expectedTimezoneLabel: '(GMT+3)' } };

test('Poker homepage session dates retain published years and clocks while TBD stays date-only', async () => {
  const html = await readFile(new URL('./adapters/fixtures/poker-sessions.html', import.meta.url), 'utf8');
  const result = parseHtml(html, { url: 'https://cmupokerclub.com/index.html', options: {
    timezone: 'America/New_York', eventSelector: 'article.event[data-date]', dateSelector: ':scope', dateAttribute: 'data-date',
    titleSelector: '.event__tag', titleFromPage: 'title', linkSelector: '.event__permalink', timeSelector: '.event__time', locationSelector: '.event__place',
  } }, { windowStart: '2026-09-22', windowEnd: '2027-10-22' });
  assert.equal(result.events.length, 8);
  const tournament = result.events.find(e => e.title === 'MSCF Tournament');
  assert.equal(tournament.start, '2026-11-07');
  assert.equal(tournament.timePrecision, 'date');
  assert.equal(tournament.location, 'Location TBD');
  assert.equal(result.events.find(e => e.start.startsWith('2026-11-21')).start, '2026-11-21T19:00:00.000Z');
  assert.equal(result.events.find(e => e.start.startsWith('2026-10-31')).end, '2026-11-01T03:00:00.000Z');
});

test('review-only conflict resolution cannot also import an unreviewed clock or fall back after the source changes', async () => {
  const fragment = await readFile(new URL('./adapters/fixtures/tedx-reviewed.html', import.meta.url), 'utf8');
  const html = fragment + '<article class="event"><h2>Public Speaking Workshop</h2><time datetime="2026-09-27T17:00:00"></time></article>';
  const source = { url: 'https://tedxcmu.org/events.html', adapter: 'html', options: { timezone: 'America/New_York',
    reviewedFragmentsOnly: true, reviewedFragments: [{ selector: '.event-content', expectedCount: 1,
      sha256: createHash('sha256').update(plainText(fragment)).digest('hex'),
      events: [{ title: 'Public Speaking Workshop', start: '2026-09-27', location: '', description: 'Published clocks and venues conflict; confirm with organizer.' }] }] } };
  const result = await fetchEvents(source, { fetchText: async () => html });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].timePrecision, 'date');
  assert.equal(result.events[0].location, '');
  const changed = await fetchEvents(source, { fetchText: async () => html.replace('5:00 PM', '6:00 PM') });
  assert.equal(changed.events.length, 0);
  assert.equal(changed.partial, true);
});

test('anonymous Qatar list recovers the visually confirmed event with explicit 2026 date and Doha time', () => {
  const result = parseCampusGroups(qatarRows, qatarPlan);
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.warnings, []);
  const [event] = result.events;
  assert.equal(event.start, '2026-11-10T15:00:00.000Z');
  assert.equal(event.end, '2026-11-10T17:00:00.000Z');
  assert.equal(event.location, 'Room 1202');
  assert.equal(event.organizer, 'Carnegie Consulting');
  assert.equal(event.url, 'https://scottyconnect.qatar.cmu.edu/rsvp_boot?id=375467&rel=title');
});

test('CampusGroups field order is decoded dynamically; missing years and timezone changes remain partial', () => {
  const event = qatarRows[1];
  const fields = event.fields.split(',');
  const reordered = { ...event, fields: [...fields].reverse().join(',') };
  fields.forEach((_, i) => { reordered[`p${fields.length - 1 - i}`] = event[`p${i}`]; });
  assert.equal(parseCampusGroups([reordered], qatarPlan).events.length, 1);
  for (const patch of [{ p4: event.p4.replaceAll(', 2026', '') }, { p28: '(GMT+4)' }, { p32: 'True' }]) {
    const result = parseCampusGroups([{ ...event, ...patch }], qatarPlan);
    assert.equal(result.events.length, 0);
    assert.equal(result.partial, true);
  }
});

test('CampusGroups pagination counts provider ranges instead of visible public cards and preserves multiday dates', async () => {
  const event = { ...qatarRows[1], counter: '41' };
  const second = { ...event, counter: '41', p4: '<p>Thu, Oct 29, 2026 9:00 AM – </p><p>Sat, Oct 31, 2026 7:30 PM</p>' };
  const calls = [];
  const result = await fetchCampusGroups(qatarPlan, { fetchText: async value => {
    const url = new URL(value); calls.push(url.searchParams.get('range'));
    return JSON.stringify(calls.length === 1 ? [event] : [second]);
  } });
  assert.deepEqual(calls, ['0', '40']);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[1].start, '2026-10-29T06:00:00.000Z');
  assert.equal(result.events[1].end, '2026-10-31T16:30:00.000Z');
  assert.notEqual(result.partial, true);
  const limited = await fetchCampusGroups({ ...qatarPlan, options: { ...qatarPlan.options, maxPages: 1 } },
    { fetchText: async () => JSON.stringify([event]) });
  assert.equal(limited.partial, true);
  await assert.rejects(fetchCampusGroups({ ...qatarPlan, fetchUrl: qatarPlan.fetchUrl.replace('35446', '35447') }, {}), /reviewed read-only/);
});

test('public CampusGroups details preserve admission restrictions, while unavailable details remain partial', async () => {
  const title = qatarRows[1].p3;
  const detail = `<h1 class="rsvp__event-name">${title}</h1><div id="event_details"><div class="card-block"><div class="card-block__title">Details</div>Only open to undergraduate students.</div></div>`;
  const plan = { ...qatarPlan, options: { ...qatarPlan.options, publicDetails: true } };
  const run = html => fetchCampusGroups(plan, { fetchText: async url => url.includes('/mobile_ws/') ? JSON.stringify(qatarRows) : html });
  const result = await run(detail);
  assert.equal(result.events[0].description, 'Only open to undergraduate students.');
  assert.notEqual(result.partial, true);
  const unavailable = await run('<h1>Login required</h1>');
  assert.equal(unavailable.events.length, 1);
  assert.equal(unavailable.partial, true);
});

test('publisher-created weekly ICS keeps source wall clock across DST and does not invent other Friday activities', () => {
  const result = parseGeneratedCalendar(html, plan, { now: '2026-10-29T12:00:00Z', windowStart: '2026-10-22', windowEnd: '2026-11-08' });
  assert.equal(result.recognized, true);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.events.map(e => e.start), ['2026-10-30T17:15:00.000Z', '2026-11-06T18:15:00.000Z']);
  assert.deepEqual(result.events.map(e => e.end), ['2026-10-30T18:15:00.000Z', '2026-11-06T19:15:00.000Z']);
  assert.ok(result.events.every(e => e.title === 'CMU MSA Jummah' && e.description.includes('weekly room changes')));
});

test('publisher algorithm includes today when Friday, using source-local day rather than UTC day', () => {
  const result = parseGeneratedCalendar(html, plan, { now: '2026-10-31T00:30:00Z', windowStart: '2026-10-30', windowEnd: '2026-11-01' });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].start, '2026-10-30T17:15:00.000Z');
});

test('missing, ambiguous or changed generator cannot publish reviewed fields from stale source code', () => {
  for (const changed of [html.replace('T131500', 'T141500'), html.replace('id="jummah-ics-btn"', 'id="old"'),
    html + '<button id="jummah-ics-btn">Duplicate</button>']) {
    const result = parseGeneratedCalendar(changed, plan, { now: '2026-10-22T12:00:00Z' });
    assert.equal(result.events.length, 0);
    assert.equal(result.partial, true);
    assert.equal(result.recognized, false);
  }
});

test('verified generated download can populate an empty feed while a changed download stays partial', async () => {
  const source = { ...plan, url: 'https://example.edu/original.ics', adapter: 'ics',
    options: { timezone: 'America/New_York', additionalEndpoints: [{ url: plan.url, adapter: 'html', options: plan.options }] } };
  const context = { now: '2026-10-22T12:00:00Z', windowStart: '2026-10-22', windowEnd: '2026-11-01',
    fetchText: async url => url.endsWith('.ics') ? 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR' : html };
  const result = await fetchEvents(source, context);
  assert.equal(result.events.length, 2);
  assert.notEqual(result.partial, true);
  const changed = await fetchEvents(source, { ...context, fetchText: async url => url.endsWith('.ics')
    ? 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR' : html.replace('T131500', 'T141500') });
  assert.equal(changed.partial, true);
  assert.equal(changed.events.length, 0);
});
