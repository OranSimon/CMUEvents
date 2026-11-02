import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIcs, readableCalendarUrl } from '../src/adapters/ics.mjs';
import { parseLiveWhale, parseWordPress, parseTrumba, fetchJsonEvents } from '../src/adapters/json.mjs';
import { normalizeEvent } from '../src/lib/normalize.mjs';
import { openStore } from '../src/lib/store.mjs';
import { exportCrawlState, restoreCrawlState } from '../src/lib/crawl-state.mjs';

const plan = { id: 'public', adapter: 'ics', status: 'active', department: 'University', org: 'Public source',
  url: 'https://example.edu/calendar', options: { timezone: 'America/New_York' } };
const context = { now: '2026-10-26T12:00:00Z', windowStart: '2026-10-26T00:00:00Z', windowEnd: '2026-11-10T00:00:00Z' };

/**
 * Wrap public calendar property blocks without a network or fixture clock.
 * @param {string[]} rows Explicit VEVENT blocks.
 * @return {string} Minimal complete iCalendar document.
 */
function calendar(...rows) {
  return `BEGIN:VCALENDAR\nVERSION:2.0\n${rows.map(row => `BEGIN:VEVENT\n${row}\nEND:VEVENT`).join('\n')}\nEND:VCALENDAR`;
}

test('RFC weekly occurrences and moved exceptions retain source recurrence without moving the rule to the exception weekday', () => {
  const result = parseIcs(calendar(
    'UID:weekly-series\nDTSTART;TZID=America/New_York:20261026T110000\nDTEND;TZID=America/New_York:20261026T120000\nRRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO\nSUMMARY:Lab meeting',
    'UID:weekly-series\nRECURRENCE-ID;TZID=America/New_York:20261102T110000\nDTSTART;TZID=America/New_York:20261103T130000\nDTEND;TZID=America/New_York:20261103T140000\nSUMMARY:Moved lab meeting',
  ), plan, context);
  assert.equal(result.events.length, 3);
  assert.ok(result.events.every(event => event.eventType === 'recurring' && event.recurrence.seriesId === 'weekly-series'
    && event.recurrence.frequency === 'weekly' && event.recurrence.source === 'rrule' && event.recurrence.count === 3));
  assert.deepEqual(result.events[1].recurrence.byDay, ['MO']);
  assert.equal(result.events.find(event => event.title.startsWith('Moved')).start, '2026-11-03T18:00:00.000Z');
  assert.equal(result.events[0].recurrence.seriesStart, '2026-10-26T15:00:00.000Z');
});

test('RDATE and detached recurrence identities are recurring without guessing a weekly cadence', () => {
  const dates = parseIcs(calendar('UID:listed\nDTSTART:20261026T130000Z\nRDATE:20261028T130000Z,20261102T130000Z\nSUMMARY:Published sessions'), plan, context).events;
  assert.equal(dates.length, 3);
  assert.ok(dates.every(event => event.eventType === 'recurring' && event.recurrence.frequency === 'other' && event.recurrence.source === 'rdate'));
  const excluded = parseIcs(calendar('UID:listed\nDTSTART:20261026T130000Z\nRDATE:20261028T130000Z,20261102T130000Z\nEXDATE:20261026T130000Z\nSUMMARY:Published sessions'), plan, context).events;
  assert.equal(excluded.length, 2);
  assert.ok(excluded.every(event => event.start !== '2026-10-26T13:00:00.000Z'));
  const detached = parseIcs(calendar('UID:detached\nRECURRENCE-ID:20261028T130000Z\nDTSTART:20261028T140000Z\nSUMMARY:Explicit exception'), plan, context).events;
  assert.equal(detached[0].recurrence.source, 'recurrence-id');
});

test('only direct published scheduling prose classifies independent provider rows; titles and incidental weekly references cannot', () => {
  const rows = [
    'UID:first\nDTSTART:20261026T130000Z\nORGANIZER;CN=Public Lab:mailto:lab@example.edu\nSUMMARY:Training hours\nDESCRIPTION:Our weekly training hours welcome new members.',
    'UID:second\nDTSTART:20261102T130000Z\nORGANIZER;CN=Public Lab:mailto:lab@example.edu\nSUMMARY:Training hours\nDESCRIPTION:Our weekly training hours welcome new members.',
    'UID:other-organizer\nDTSTART:20261103T130000Z\nORGANIZER;CN=Other Lab:mailto:other@example.edu\nSUMMARY:Training hours\nDESCRIPTION:Our weekly training hours welcome new members.',
    'UID:title-only\nDTSTART:20261104T130000Z\nSUMMARY:Weekly statistics newsletter launch\nDESCRIPTION:A one-time launch event.',
    'UID:incidental\nDTSTART:20261105T130000Z\nSUMMARY:Research workshop\nDESCRIPTION:Participants learn how to write weekly reports in this one-time workshop.',
    'UID:explicit-day\nDTSTART:20261106T130000Z\nSUMMARY:Research discussion\nDESCRIPTION:The group will meet every Friday at 8am.',
  ];
  const events = parseIcs(calendar(...rows), plan, context).events;
  assert.equal(events.length, 6, 'classification never creates additional appointments');
  assert.equal(events[0].recurrence.seriesId, events[1].recurrence.seriesId);
  assert.notEqual(events[0].recurrence.seriesId, events[2].recurrence.seriesId);
  assert.ok(events.slice(3, 5).every(event => event.eventType === 'scheduled' && !event.recurrence));
  assert.deepEqual(events[5].recurrence.byDay, ['FR']);
  assert.equal(events[5].recurrence.source, 'published-schedule');
});

test('old unbounded daily templates lacking event information are isolated while bounded, detailed and weekly records survive', () => {
  const sparse = 'UID:sparse\nDTSTART:20100101T130000Z\nDTEND:20100101T140000Z\nRRULE:FREQ=DAILY\nSUMMARY:Calendar placeholder';
  const result = parseIcs(calendar(sparse, 'UID:sparse\nRECURRENCE-ID:20100102T130000Z\nDTSTART:20100102T130000Z\nDTEND:20100102T140000Z\nSUMMARY:Past sparse exception'), plan, context);
  assert.deepEqual(result.events, []);
  assert.equal(result.exclusionCounts.staleDailyTemplates, 1);
  assert.notEqual(result.partial, true);
  assert.match(result.warnings.join(' '), /unbounded daily template/);
  for (const replacement of ['RRULE:FREQ=WEEKLY', 'RRULE:FREQ=DAILY;UNTIL=20271101T130000Z', 'RRULE:FREQ=DAILY\nDESCRIPTION:Documented program', 'RRULE:FREQ=DAILY\nURL:https://example.edu/original']) {
    const kept = parseIcs(calendar(sparse.replace('RRULE:FREQ=DAILY', replacement)), plan, context);
    assert.ok(kept.events.length > 0);
    assert.equal(kept.exclusionCounts, undefined);
  }
});

test('only advertised public Google feed identities produce readable occurrence-window viewers; explicit event URLs win', () => {
  const feed = 'https://calendar.google.com/calendar/ical/public_calendar%40group.calendar.google.com/public/basic.ics';
  const source = { ...plan, url: feed, fetchUrl: feed };
  const viewer = new URL(readableCalendarUrl(source, '2026-10-27T01:00:00Z', 'America/New_York'));
  assert.equal(viewer.pathname, '/calendar/embed');
  assert.equal(viewer.searchParams.get('src'), 'public_calendar@group.calendar.google.com');
  assert.equal(viewer.searchParams.get('mode'), 'AGENDA');
  assert.equal(viewer.searchParams.get('dates'), '20261026/20261027');
  assert.equal(readableCalendarUrl({ url: feed.replace('/public/', '/private-key/') }, '2026-10-26'), null);
  const events = parseIcs(calendar('UID:source-only\nDTSTART:20261027T010000Z\nSUMMARY:Public meeting',
    'UID:original\nDTSTART:20261027T130000Z\nSUMMARY:Original meeting\nURL:https://example.edu/original'), source, context).events;
  assert.equal(events[0].linkKind, 'calendar-viewer');
  assert.ok(events[0].url.startsWith('https://calendar.google.com/calendar/embed?'));
  assert.equal(events[1].url, 'https://example.edu/original');
  assert.equal(events[1].linkKind, 'event-detail');
});

const rangeFixture = JSON.parse(readFileSync(new URL('./fixtures/livewhale-range-clones.json', import.meta.url), 'utf8'));

test('LiveWhale range-display copies become one original interval and distinguish exhibitions from registration windows', () => {
  const outputs = rangeFixture.groups.map(group => ({ group, result: parseLiveWhale(group.rows, { ...plan, adapter: 'livewhale' }, context) }));
  for (const { result } of outputs) assert.equal(result.events.length, 1);
  const cohort = outputs[0].result.events[0];
  assert.equal(cohort.scheduleKind, 'registration-window');
  assert.equal(cohort.start, '2026-09-01'); assert.equal(cohort.end, '2026-12-19');
  const exhibition = outputs[1].result.events[0];
  assert.equal(exhibition.scheduleKind, 'continuous');
  assert.equal(exhibition.start, '2025-12-02'); assert.equal(exhibition.end, '2027-01-01');
  assert.equal(exhibition.dateEvidence.kind, 'range-window');
  assert.equal(exhibition.eventType, 'scheduled');
  assert.match(exhibition.description, /Monday, closed/);
  const weekly = outputs[2].result.events[0];
  assert.equal(weekly.eventType, 'recurring'); assert.equal(weekly.recurrence.frequency, 'weekly');
  const enrollment = outputs[3].result.events[0];
  assert.equal(enrollment.scheduleKind, 'registration-window');
  assert.equal(enrollment.start, '2026-10-26T10:00:00.000Z');
  assert.equal(enrollment.end, '2026-11-16T22:00:00.000Z');
  assert.equal(enrollment.allDay, false, 'middle display rows cannot erase explicit original timed bounds');
});

test('range clones on different API pages share one range identity without guessing unknown periods as continuous', async () => {
  const rows = rangeFixture.groups[0].rows;
  const initial = 'https://example.edu/events';
  const result = await fetchJsonEvents({ ...plan, adapter: 'livewhale', fetchUrl: initial }, { ...context,
    fetchText: async url => JSON.stringify({ data: [rows[url === initial ? 0 : 1]], links: { next: url === initial ? `${initial}?page=2` : null } }) });
  assert.equal(result.events.length, 1);
  const unknown = parseLiveWhale([{ ...rows[0], summary: 'Public program information', description: '' }], plan, context).events[0];
  assert.equal(unknown.scheduleKind, 'date-window');
  assert.equal(unknown.recurrence, undefined);
});

test('WordPress and Trumba recurrence use actual provider flags or explicit body declarations, never title alone', () => {
  const wordpress = parseWordPress({ events: [{ id: 1, title: 'Regular lab session', start_date: '2026-10-27 10:00:00', end_date: '2026-10-27 11:00:00',
    description: 'Members discuss the current program.', is_recurring: true, url: 'https://example.edu/session' }] }, plan, context).events[0];
  assert.equal(wordpress.eventType, 'recurring');
  assert.equal(wordpress.recurrence.frequency, 'other', 'explicit provider flag alone does not invent a frequency');
  const trumba = parseTrumba([{ eventID: 2, title: 'Tuesday program', startDateTime: '2026-10-27T10:00:00', endDateTime: '2026-10-27T11:00:00',
    startTimeZoneOffset: '-0400', endTimeZoneOffset: '-0400', repeatFrequency: 'weekly' }], plan, context).events[0];
  assert.equal(trumba.eventType, 'recurring'); assert.equal(trumba.recurrence.source, 'provider');
});

test('normalization rejects unproven category labels and portable state restores valid recurrence and range evidence', t => {
  assert.equal(normalizeEvent({ title: 'Weekly title', start: '2026-10-27', eventType: 'recurring' }, plan).eventType, 'scheduled');
  assert.equal(normalizeEvent({ title: 'Unproven rule', start: '2026-10-27', recurrence: { seriesId: 'fake', frequency: 'weekly', source: 'title', interval: 1 } }, plan).eventType, 'scheduled');
  const original = openStore(':memory:'); const restored = openStore(':memory:');
  t.after(() => { original.close(); restored.close(); });
  const series = parseIcs(calendar('UID:persisted\nDTSTART:20261027T130000Z\nRRULE:FREQ=WEEKLY;COUNT=2\nSUMMARY:Lab'), plan, context).events;
  const range = parseLiveWhale(rangeFixture.groups[1].rows, plan, context).events;
  original.registerPlans([plan]); original.replaceSource(plan.id, [...series, ...range]);
  const saved = exportCrawlState(original, context);
  restored.registerPlans([plan]); restoreCrawlState(restored, [plan], saved, context);
  const records = restored.db.prepare('SELECT data FROM occurrences').all().map(row => JSON.parse(row.data));
  assert.equal(records.filter(event => event.eventType === 'recurring').length, 2);
  assert.equal(records.find(event => event.scheduleKind === 'continuous').dateEvidence.kind, 'range-window');
  assert.deepEqual(records.find(event => event.uid === series[0].uid).recurrence, series[0].recurrence);
});

test('explicit WordPress session lists are one recurring program while an actual exhibition keeps one continuous range', () => {
  const source = { ...plan, options: { ...plan.options, sessionDates: { titlePattern: '^Published drawing program$', yearSelector: 'h2', dateSelector: 'p:has(strong)', timeSelector: 'p:contains("All sessions")' } } };
  const row = { id: 1, title: 'Published drawing program', global_id: 'published-program', url: 'https://example.edu/program',
    start_date: '2026-10-27 18:00:00', end_date: '2026-12-01 20:00:00', timezone: 'America/New_York', categories: [{ name: 'Exhibitions' }],
    description: '<h2>Fall 2026 Sessions</h2><p>All sessions take place from 6:00 to 8:00 PM.</p><p><strong>October 27<br>November 3<br>December 1</strong></p>' };
  const sessions = parseWordPress({ events: [row] }, source).events;
  assert.equal(sessions.length, 3);
  assert.ok(sessions.every(event => event.eventType === 'recurring' && event.recurrence.seriesId === 'published-program'
    && event.recurrence.frequency === 'other' && event.scheduleKind === 'occurrence'));
  const exhibition = parseWordPress({ events: [{ ...row, title: 'Current exhibition', description: 'This exhibition is on view throughout the published period.' }] }, source).events;
  assert.equal(exhibition.length, 1);
  assert.equal(exhibition[0].scheduleKind, 'continuous');
  assert.equal(exhibition[0].eventType, 'scheduled');
});

test('same-local-day LiveWhale bounds do not turn one-time clocked appointments into date windows', () => {
  const row = { id: 123, title: 'One-time research seminar', url: 'https://example.edu/talk', timezone: 'America/New_York',
    date_iso: '2026-10-28T10:00:00-04:00', date2_iso: '2026-10-28T11:00:00-04:00',
    repeats: null, repeats_start: '2026-10-28 14:00:00', repeats_end: '2026-10-28 15:00:00',
    summary: 'A single published research talk.', location: 'Hall 101' };
  const event = parseLiveWhale([row], plan, context).events[0];
  assert.equal(event.start, '2026-10-28T14:00:00.000Z');
  assert.equal(event.end, '2026-10-28T15:00:00.000Z');
  assert.equal(event.scheduleKind, 'occurrence');
  assert.equal(event.dateEvidence, undefined);
  assert.equal(event.eventType, 'scheduled');
});

test('short explicitly typed multi-day programs retain one real occurrence while unsupported periods remain date windows', () => {
  const program = { id: 124, title: 'Published community program', url: 'https://example.edu/program', timezone: 'America/New_York',
    date_iso: '2026-10-27T00:00:00-04:00', is_all_day: 1, repeats: null,
    repeats_start: '2026-10-26 04:00:00', repeats_end: '2026-10-28 04:00:00',
    description: 'Participants will gather for invited presentations, small-group discussions and collaborative exercises throughout the published program.',
    location: { title: 'University Center' } };
  for (const change of [{ event_types: [{ title: 'Conference' }] }, { event_types: [{ name: 'Workshops' }], location: null, is_online: 1 }, { title: 'Community Homecoming' }]) {
    const result = parseLiveWhale([{ ...program, ...change }, { ...program, ...change, date_iso: '2026-10-28T00:00:00-04:00' }], plan, context).events;
    assert.equal(result.length, 1);
    assert.equal(result[0].scheduleKind, 'occurrence');
    assert.equal(result[0].start, '2026-10-26');
    assert.equal(result[0].end, '2026-10-29');
  }
  const unknown = parseLiveWhale([{ ...program, title: 'Calendar period', url: undefined, description: 'Dates for a public program.' }], plan, context).events[0];
  assert.equal(unknown.scheduleKind, 'date-window');
  const enrollment = parseLiveWhale([{ ...program, title: 'Public workshop', description: 'Registration is open throughout the published window. Participants register for separately scheduled sessions and attendance details follow later.' }], plan, context).events[0];
  assert.equal(enrollment.scheduleKind, 'registration-window');
});

const shortProgramFixture = JSON.parse(readFileSync(new URL('./fixtures/livewhale-short-programs.json', import.meta.url), 'utf8'));

test('published short conference, carnival and program ranges remain real activities even without venue or rich prose', () => {
  const reviewWindow = { windowStart: '2026-10-26T00:00:00Z', windowEnd: '2027-10-26T00:00:00Z' };
  for (const record of shortProgramFixture.records) {
    const event = parseLiveWhale([record.row], plan, reviewWindow).events[0];
    assert.ok(event, `the publisher supplied an explicit range for ${record.row.title}`);
    assert.equal(event.scheduleKind, 'occurrence');
    assert.equal(event.eventType, 'scheduled');
    assert.equal(event.dateEvidence?.kind, 'provider-date-range');
    assert.ok(Date.parse(event.end) > Date.parse(event.start));
    assert.equal(event.url, record.row.url);
  }
  const sparseConference = shortProgramFixture.records.find(record => /conference/i.test(record.row.title)).row;
  assert.equal(sparseConference.location, null);
  const sparseCarnival = shortProgramFixture.records.find(record => /carnival/i.test(record.row.title)).row;
  assert.ok(String(sparseCarnival.summary || '').length < 80);
});

test('positive program labels do not override an explicitly stated registration window or justify an unknown long range', () => {
  const first = shortProgramFixture.records[1].row;
  const registration = parseLiveWhale([{ ...first, description: 'The registration period is open throughout this window; the conference session dates will be announced separately.' }], plan, { windowStart: '2026-10-26', windowEnd: '2027-10-26' }).events[0];
  assert.equal(registration.scheduleKind, 'registration-window');
  const broadPeriod = parseLiveWhale([{ ...first, repeats_start: '2027-04-01 04:00:00', repeats_end: '2027-05-30 04:00:00' }], plan, { windowStart: '2026-10-26', windowEnd: '2027-10-26' }).events[0];
  assert.equal(broadPeriod.scheduleKind, 'date-window');
});
