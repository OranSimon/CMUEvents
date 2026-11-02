import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs } from '../src/adapters/ics.mjs';

const plan = { url: 'https://example.edu/club/calendar/', fetchUrl: 'https://calendar.example.edu/public/basic.ics', options: { timezone: 'America/New_York' } };
const context = { now: '2026-10-21T18:00:00Z', windowStart: '2026-09-21T18:00:00Z', windowEnd: '2027-10-21T18:00:00Z' };

/**
 * Wrap source VEVENT fields in a minimal standards-shaped calendar fixture.
 * @param {string[]} events One source property block per event.
 * @return {string} Complete iCalendar text.
 */
function calendar(...events) {
  return `BEGIN:VCALENDAR\nVERSION:2.0\n${events.map(event => `BEGIN:VEVENT\n${event}\nEND:VEVENT`).join('\n')}\nEND:VCALENDAR`;
}

test('historical schedule placeholders are excluded deliberately without making a valid feed partial', () => {
  const result = parseIcs(calendar(
    'UID:past-slot\nDTSTART:20251009T133000Z\nDTEND:20251009T143000Z\nSUMMARY:No Seminar/BMES - San Diego\\, CA',
    'UID:current-talk\nDTSTART:20261023T133000Z\nDTEND:20261023T143000Z\nSUMMARY:BME Research Seminar',
  ), plan, context);
  assert.equal(result.events.length, 1);
  assert.notEqual(result.partial, true);
  assert.match(result.warnings.join(), /Ignored schedule placeholder past-slot: SUMMARY="No Seminar\/BMES - San Diego, CA"/);
});

test('a current no-seminar slot is a non-event rather than an incomplete event', () => {
  const result = parseIcs(calendar('UID:current-slot\nDTSTART:20261023T133000Z\nSUMMARY:No Seminar/Fall Break'), plan, context);
  assert.deepEqual(result.events, []);
  assert.notEqual(result.partial, true);
  assert.match(result.warnings.join(), /Ignored schedule placeholder/);
});

test('non-web Apple event URLs fall back to the original public calendar without exposing private-app schemes', () => {
  const result = parseIcs(calendar(
    'UID:message-link\nDTSTART:20261023T130000Z\nSUMMARY:Research talk\nURL:message:private-mail-reference',
    'UID:sms-link\nDTSTART:20261024T130000Z\nSUMMARY:Club meeting\nURL:sms://open?message-guid=private-reference',
    'UID:web-link\nDTSTART:20261025T130000Z\nSUMMARY:Lecture\nURL:https://example.edu/original-event',
    'UID:no-link\nDTSTART:20261026T130000Z\nSUMMARY:Public calendar meeting',
  ), plan, context);
  assert.equal(result.events.length, 4);
  assert.notEqual(result.partial, true);
  assert.equal(result.events.find(event => event.uid === 'message-link').url, plan.url);
  assert.equal(result.events.find(event => event.uid === 'sms-link').url, plan.url);
  assert.equal(result.events.find(event => event.uid === 'web-link').url, 'https://example.edu/original-event');
  assert.equal(result.events.find(event => event.uid === 'no-link').url, plan.url);
  assert.match(result.warnings.join(), /Ignored non-web URL scheme "message:"/);
  assert.ok(!JSON.stringify(result.events).includes('private-reference'));
});

test('an untitled historical non-recurring record is diagnosed without blocking current events', () => {
  const result = parseIcs(calendar(
    'UID:old-untitled\nDTSTART;VALUE=DATE:20250916\nDTEND;VALUE=DATE:20250917',
    'UID:current\nDTSTART:20261023T130000Z\nSUMMARY:Current seminar',
  ), plan, context);
  assert.equal(result.events.length, 1);
  assert.notEqual(result.partial, true);
  assert.match(result.warnings.join(), /Excluded out-of-window old-untitled: SUMMARY is missing or empty; DTSTART=2025-09-16/);
});

test('an untitled current record remains a partial extraction with a precise SUMMARY diagnostic', () => {
  const result = parseIcs(calendar('UID:current-untitled\nDTSTART:20261023T130000Z\nDTEND:20261023T140000Z'), plan, context);
  assert.equal(result.partial, true);
  assert.deepEqual(result.events, []);
  assert.match(result.warnings.join(), /Skipped current-untitled: SUMMARY is missing or empty/);
  assert.ok(!result.warnings.join().includes('missing usable title, timezone or explicit date'));
});

test('a historical recurring start cannot hide a malformed potentially current series', () => {
  const result = parseIcs(calendar('UID:untitled-series\nDTSTART:20151023T130000Z\nRRULE:FREQ=YEARLY;COUNT=100'), plan, context);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(), /SUMMARY is missing or empty/);
  assert.match(result.warnings.join(), /recurrence present/);
  assert.ok(!result.warnings.join().includes('Excluded out-of-window'));
});

test('a future exception prevents a malformed historical master from being dismissed as out-of-window', () => {
  const result = parseIcs(calendar(
    'UID:master\nDTSTART:20200101T130000Z',
    'UID:master\nRECURRENCE-ID:20261023T130000Z\nDTSTART:20261023T140000Z',
  ), plan, context);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(), /Skipped master: SUMMARY is missing or empty/);
});

test('missing current UID stays partial while an exactly dated historical UID-less record is excluded safely', () => {
  const current = parseIcs(calendar('DTSTART:20261023T130000Z\nSUMMARY:Current meeting'), plan, context);
  assert.equal(current.partial, true);
  assert.match(current.warnings.join(), /UID is missing/);
  const historical = parseIcs(calendar('DTSTART:20150101T130000Z\nSUMMARY:Old meeting'), plan, context);
  assert.notEqual(historical.partial, true);
  assert.match(historical.warnings.join(), /Excluded out-of-window VEVENT: UID is missing/);
});

test('unsupported timezones have a specific TZID diagnostic and are never silently dropped as old', () => {
  const result = parseIcs(calendar('UID:unknown-zone\nDTSTART;TZID=Mars/Olympus:20261023T100000\nSUMMARY:Meeting'), plan, context);
  assert.equal(result.partial, true);
  assert.deepEqual(result.events, []);
  assert.match(result.warnings.join(), /DTSTART declares unsupported TZID "Mars\/Olympus" without a usable VTIMEZONE/);
});

test('nonexistent local wall time has a specific DST-gap diagnostic', () => {
  const result = parseIcs(calendar('UID:dst-gap\nDTSTART;TZID=America/New_York:20270314T023000\nSUMMARY:Meeting'), plan, context);
  assert.equal(result.partial, true);
  assert.deepEqual(result.events, []);
  assert.match(result.warnings.join(), /DTSTART=2027-03-14T02:30:00 is a nonexistent local time in America\/New_York/);
});

test('embedded custom VTIMEZONE remains supported when the TZID is not in Intl', () => {
  const text = 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VTIMEZONE\nTZID:CMU/Custom\nBEGIN:STANDARD\nDTSTART:19700101T000000\nTZOFFSETFROM:-0500\nTZOFFSETTO:-0500\nEND:STANDARD\nEND:VTIMEZONE\nBEGIN:VEVENT\nUID:custom\nDTSTART;TZID=CMU/Custom:20261023T100000\nSUMMARY:Custom timezone meeting\nEND:VEVENT\nEND:VCALENDAR';
  const result = parseIcs(text, plan, context);
  assert.notEqual(result.partial, true);
  assert.equal(result.events[0].start, '2026-10-23T15:00:00.000Z');
});

test('a backwards DTEND cannot make a malformed current event appear safely historical', () => {
  const result = parseIcs(calendar('UID:backwards\nDTSTART:20261023T130000Z\nDTEND:20150101T140000Z'), plan, context);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(), /SUMMARY is missing or empty; DTEND precedes DTSTART/);
  assert.ok(!result.warnings.join().includes('Excluded out-of-window'));
});

test('an event may use different explicit DTSTART and DTEND timezones', () => {
  const result = parseIcs(calendar('UID:mixed-zones\nDTSTART;TZID=America/New_York:20261023T100000\nDTEND;TZID=America/Chicago:20261023T103000\nSUMMARY:Travel seminar'), plan, context);
  assert.notEqual(result.partial, true);
  assert.equal(result.events[0].start, '2026-10-23T14:00:00.000Z');
  assert.equal(result.events[0].end, '2026-10-23T15:30:00.000Z');
});
