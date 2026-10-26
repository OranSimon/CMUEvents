import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/lib/store.mjs';
import { normalizeEvent } from '../src/lib/normalize.mjs';
import { queryEventsSnapshot } from '../web/data-client.js';
import { calendarEligibility } from '../web/event-semantics.js';

const today = '2026-10-26';
const now = Date.parse('2026-10-26T15:00:00Z');
const plan = { id: 'official', status: 'active', org: 'Official calendar', department: 'University', url: 'https://example.edu/calendar' };
const raw = [
  { uid: 'today', title: 'Dated talk', start: '2026-10-26T17:00:00Z', end: '2026-10-26T18:00:00Z' },
  { uid: 'tomorrow', title: 'Tomorrow workshop', start: '2026-10-27T17:00:00Z' },
  { uid: 'date-only', title: 'Named speaker with date and no clock', start: '2026-10-26' },
  { uid: 'camp', title: 'Multiday camp', start: '2026-10-25', end: '2026-10-30', allDay: true },
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
  return { store, events, api: options => store.listEvents({ ...filters, ...options, today, now }),
    static: options => queryEventsSnapshot({ events }, { ...filters, ...options }, { today, now }) };
}

test('four event views agree between API and static data and do not mix historical starts with Today', t => {
  const data = fixture(t);
  for (const [eventView, ids] of [['today', ['date-only', 'today']], ['upcoming', ['tomorrow']], ['ongoing', ['camp', 'period']], ['recurring', ['daily', 'weekly']]]) {
    const api = data.api({ eventView });
    const browser = data.static({ eventView });
    assert.deepEqual(api.events.map(event => event.uid).sort(), ids.sort());
    assert.deepEqual(browser.events.map(event => event.id), api.events.map(event => event.id));
    assert.equal(browser.total, api.total);
  }
  assert.deepEqual(data.static({ eventView: 'recurring', recurrenceFrequency: 'weekly' }).events.map(event => event.uid), ['weekly']);
  assert.equal(data.api({ eventView: 'today' }).events.find(event => event.uid === 'date-only').timePrecision, 'date');
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
  assert.ok(!data.api({ eventView: 'ongoing' }).events.some(event => event.uid === 'ended'));
  const period = { ...data.events.find(event => event.uid === 'period'), id: 'future', start: '2026-10-27', end: '2026-11-15' };
  assert.equal(queryEventsSnapshot({ events: [period] }, { eventView: 'ongoing', from: today }, { today, now }).total, 0);
  assert.equal(queryEventsSnapshot({ events: [period] }, { eventView: 'upcoming', from: today }, { today, now }).total, 1);
  assert.equal(queryEventsSnapshot({ events: [period] }, { eventView: 'today', from: '2026-10-27' }, { today: '2026-10-27', now }).total, 1);
});


test('explicit scheduling prose survives normalization from HTML and provider-specific adapters', () => {
  const event = normalizeEvent({ title: 'Training session', start: '2026-10-26T18:00:00Z', description: 'Our weekly training hours are open to current members.', location: 'Published hall' }, plan);
  assert.equal(event.eventType, 'recurring');
  assert.equal(event.recurrence.frequency, 'weekly');
  const titleOnly = normalizeEvent({ title: 'Weekly research conference', start: '2026-10-26T18:00:00Z', description: 'A discussion of weekly statistical estimates.' }, plan);
  assert.equal(titleOnly.eventType, 'scheduled');
});
