import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/lib/store.mjs';
import { normalizeEvent } from '../src/lib/normalize.mjs';
import { queryEventsSnapshot } from '../web/data-client.js';
import { EVENT_VIEWS, calendarEligibility } from '../web/event-semantics.js';

const today = '2026-10-26';
const now = Date.parse('2026-10-26T15:00:00Z');
const plan = { id: 'official', status: 'active', org: 'Official calendar', department: 'University', url: 'https://example.edu/calendar' };
const raw = [
  { uid: 'today', title: 'Dated talk', start: '2026-10-26T17:00:00Z', end: '2026-10-26T18:00:00Z' },
  { uid: 'tomorrow', title: 'Tomorrow workshop', start: '2026-10-27T17:00:00Z' },
  { uid: 'date-only', title: 'Named speaker with date and no clock', start: '2026-10-26' },
  { uid: 'camp', title: 'Multiday camp', start: '2026-10-25', end: '2026-10-30', allDay: true,
    recurrence: { seriesId: 'annual-camp', frequency: 'yearly', interval: 1, source: 'rrule' } },
  { uid: 'ended', title: 'Overnight activity that finished', start: '2026-10-25T23:00:00Z', end: '2026-10-26T05:00:00Z' },
  { uid: 'merch', title: 'Student organization merchandise', description: 'Order a crewneck; choose your size and RSVP for pickup.', start: '2026-09-04T13:00:00Z', end: '2027-03-31T04:00:00Z' },
  { uid: 'hold', title: 'HOLD for campus calendar', description: 'DO NOT SCHEDULE CLUB EVENTS DURING THIS TIME.', start: '2026-10-26T13:00:00Z' },
];

/**
 * Build a deterministic store and browser snapshot from the same public records.
 * @param {Object} t Cleanup handle.
 * @return {Object} Independent API/static query functions and public event data.
 */
function fixture(t) {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans([plan]);
  const inputs = raw.map(row => normalizeEvent({ ...row, url: `${plan.url}/${row.uid}` }, plan));
  inputs.push({ ...normalizeEvent({ uid: 'period', title: 'Published exhibition period', start: '2025-12-02', end: '2027-01-01', allDay: true, url: `${plan.url}/period` }, plan), scheduleKind: 'continuous' });
  inputs.push({ ...normalizeEvent({ uid: 'registration', title: 'Two-day training registration window', start: '2026-09-01', end: '2026-12-19', allDay: true, url: `${plan.url}/registration` }, plan), scheduleKind: 'registration-window' });
  for (const frequency of ['weekly', 'daily']) inputs.push({ ...normalizeEvent({ uid: frequency, title: `Published repeating ${frequency} schedule`, start: '2026-10-26T19:00:00Z', description: 'A real session with published room and clock.', location: 'Hall 101', url: `${plan.url}/${frequency}` }, plan),
    eventType: 'recurring', recurrence: { seriesId: frequency, frequency, interval: 1, source: 'rrule' } });
  store.replaceSource(plan.id, inputs);
  store.rebuildEvents([plan]);
  const events = store.db.prepare('SELECT data FROM events').all().map(row => JSON.parse(row.data));
  const filters = { from: today, to: '2026-11-30', limit: 100 };
  return { store, events, stored: options => store.listEvents({ ...filters, ...options, today, now }),
    static: options => queryEventsSnapshot({ events }, { ...filters, ...options }, { today, now }) };
}

test('the current-day views agree between stored and published data and include recurring occurrences on their actual dates', t => {
  const data = fixture(t);
  assert.deepEqual(EVENT_VIEWS, ['today', 'ongoing', 'day']);
  for (const [eventView, ids] of [['today', ['date-only', 'today', 'daily', 'weekly']], ['ongoing', ['camp', 'period']]]) {
    const api = data.stored({ eventView });
    const browser = data.static({ eventView });
    assert.deepEqual(api.events.map(event => event.uid).sort(), ids.sort());
    assert.deepEqual(browser.events.map(event => event.id), api.events.map(event => event.id));
    assert.equal(browser.total, api.total);
  }
  assert.equal(data.stored({ eventView: 'today' }).events.find(event => event.uid === 'date-only').timePrecision, 'date');
  assert.ok(data.events.some(event => event.uid === 'tomorrow'), 'future source occurrences remain stored for their own date');
  for (const eventView of ['upcoming', 'recurring']) {
    assert.throws(() => data.stored({ eventView }), /Unknown event browsing view/);
    assert.throws(() => data.static({ eventView }), /Unknown event browsing view/);
  }
});

test('a day view lists starts on that day in stored and published data, leaving earlier ranges to Ongoing', t => {
  const data = fixture(t);
  const day = { eventView: 'day', from: '2026-10-27', to: '2026-10-27' };
  assert.deepEqual(data.static(day).events.map(event => event.uid), ['tomorrow']);
  assert.deepEqual(data.stored(day).events.map(event => event.id), data.static(day).events.map(event => event.id));
});

test('the Recurring tag filters either date view and is projected for older static snapshots without changing source data', t => {
  const data = fixture(t);
  for (const [eventView, expected] of [['today', ['daily', 'weekly']], ['ongoing', ['camp']]]) {
    const api = data.stored({ eventView, tag: 'Recurring' });
    const browser = data.static({ eventView, tag: 'Recurring' });
    assert.deepEqual(api.events.map(event => event.uid).sort(), expected);
    assert.deepEqual(browser.events.map(event => event.id), api.events.map(event => event.id));
    assert.equal(browser.facets.tags.find(tag => tag.value === 'Recurring').count, expected.length);
  }
  const older = data.events.map(event => ({ ...event, tags: event.tags.filter(tag => tag !== 'Recurring') }));
  const result = queryEventsSnapshot({ events: older }, { eventView: 'today', tag: 'Recurring', from: today }, { today, now });
  assert.deepEqual(result.events.map(event => event.uid).sort(), ['daily', 'weekly']);
  assert.ok(older.every(event => !event.tags.includes('Recurring')));
  assert.equal(data.static({ eventView: 'today', query: 'Recurring' }).total, 2);
});

test('notices and reservation blocks are excluded before topic classification, not merely hidden by a view', t => {
  const data = fixture(t);
  assert.ok(data.events.every(event => !['merch', 'hold', 'registration'].includes(event.uid)));
  assert.equal(data.store.status().totalEvents, 8);
  const report = data.store.getMeta('eventExclusions');
  assert.equal(report.count, 3);
  assert.deepEqual(report.records.map(row => row.code).sort(), ['administrative-hold', 'registration-window', 'sales-window']);
  assert.equal(calendarEligibility({ title: 'Public sale and design workshop', description: 'Workshop on design.', start: '2026-10-26T12:00Z', end: '2026-10-26T13:00Z' }).eligible, true);
});

test('ongoing uses real exclusive ends and the current clock, and future periods first appear on their start date', t => {
  const data = fixture(t);
  assert.ok(!data.stored({ eventView: 'ongoing' }).events.some(event => event.uid === 'ended'));
  const period = { ...data.events.find(event => event.uid === 'period'), id: 'future', start: '2026-10-27', end: '2026-11-15' };
  assert.equal(queryEventsSnapshot({ events: [period] }, { eventView: 'ongoing', from: today }, { today, now }).total, 0);
  assert.equal(queryEventsSnapshot({ events: [period] }, { eventView: 'today', from: today }, { today, now }).total, 0);
  assert.equal(queryEventsSnapshot({ events: [period] }, { eventView: 'today', from: '2026-10-27' }, { today: '2026-10-27', now }).total, 1);
});


test('explicit scheduling prose survives normalization from HTML and provider-specific adapters', () => {
  const event = normalizeEvent({ title: 'Training session', start: '2026-10-26T18:00:00Z', description: 'Our weekly training hours are open to current members.', location: 'Published hall' }, plan);
  assert.equal(event.eventType, 'recurring');
  assert.equal(event.recurrence.frequency, 'weekly');
  const titleOnly = normalizeEvent({ title: 'Weekly research conference', start: '2026-10-26T18:00:00Z', description: 'A discussion of weekly statistical estimates.' }, plan);
  assert.equal(titleOnly.eventType, 'scheduled');
});
