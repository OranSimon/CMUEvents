import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJsonEvents, parseWordPress } from '../src/adapters/json.mjs';

const sessionDates = {
  titlePattern: '^Open Figure Drawing Sessions$',
  yearSelector: 'h2',
  dateSelector: 'p:has(strong)',
  timeSelector: 'p:contains("All sessions take place")',
};
const plan = {
  adapter: 'wordpress', url: 'https://art.cmu.edu/events/exhibitions/',
  fetchUrl: 'https://art.cmu.edu/wp-json/tribe/events/v1/events?per_page=50&categories=33',
  options: { timezone: 'America/New_York', sessionDates },
};
const window = { windowStart: '2026-09-21T20:00:00Z', windowEnd: '2027-10-21T20:00:00Z' };
// The published description, including explicit non-session dates, is the only
// recurrence evidence. The provider's September-to-December range is a container.
const description = `<h2><strong>Fall 2026 Sessions</strong></h2>
<p>All sessions take place from 6:00 to 8:30 PM in the College of Fine Arts room 308.</p>
<p><strong>September 6<br />September 13<br />September 20<br />September 27<br />October 4<br />October 11<br />
<em>No Session:</em> October 18<br />October 25<br />November 1<br />November 8<br />November 15<br />November 22<br /></strong>
<strong><em>No Session:</em> November 29</strong><br /><strong>December 6</strong></p>`;
const series = {
  id: 19384, global_id: 'art.cmu.edu?id=19384', title: 'Open Figure Drawing Sessions', description,
  start_date: '2026-09-06 18:00:00', end_date: '2026-12-06 20:30:00',
  utc_start_date: '2026-09-06 22:00:00', utc_end_date: '2026-12-07 01:30:00', timezone: 'UTC-5',
  url: 'https://art.cmu.edu/event/open-figure-drawing-sessions-fall-2026/',
  venue: { venue: 'CFA Room 308' }, categories: [{ name: 'Exhibitions' }],
};

test('WordPress requests overlapping ongoing events rather than relying on the upcoming-start default', async () => {
  const requests = [];
  const result = await fetchJsonEvents({ ...plan, options: { timezone: 'America/New_York' } }, {
    ...window, fetchText: async value => {
      const url = new URL(value);
      requests.push(url);
      return JSON.stringify({ events: url.searchParams.has('ends_after') && url.searchParams.has('starts_before') ? [series] : [] });
    },
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].start, '2026-09-06T22:00:00.000Z');
  assert.equal(result.events[0].end, '2026-12-07T01:30:00.000Z');
  assert.equal(requests[0].searchParams.get('categories'), '33');
  assert.equal(requests[0].searchParams.get('per_page'), '50');
  assert.equal(requests[0].searchParams.get('ends_after'), '2026-09-21');
  assert.equal(requests[0].searchParams.get('starts_before'), '2027-10-21');
  assert.equal(requests[0].searchParams.has('start_date'), false);
});

test('WordPress overlap query dates follow the source timezone and retain explicit source bounds', async () => {
  const requests = [];
  await fetchJsonEvents({ ...plan, fetchUrl: `${plan.fetchUrl}&ends_after=2026-08-01`, options: { timezone: 'America/New_York' } }, {
    windowStart: '2026-09-21T01:00:00Z', windowEnd: '2027-10-21T01:00:00Z',
    fetchText: async url => { requests.push(new URL(url)); return '{"events":[]}'; },
  });
  assert.equal(requests[0].searchParams.get('ends_after'), '2026-08-01');
  assert.equal(requests[0].searchParams.get('starts_before'), '2027-10-20');
});

test('a reviewed series produces only its twelve explicitly listed sessions with DST-aware clocks', () => {
  const result = parseWordPress({ events: [series] }, plan);
  assert.deepEqual(result.warnings, []);
  assert.notEqual(result.partial, true);
  assert.deepEqual(result.events.map(event => event.uid.split('::')[1]), [
    '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11',
    '2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-12-06',
  ]);
  const october = result.events.find(event => event.uid.endsWith('2026-10-25'));
  const november = result.events.find(event => event.uid.endsWith('2026-11-01'));
  assert.equal(october.start, '2026-10-25T22:00:00.000Z');
  assert.equal(october.end, '2026-10-26T00:30:00.000Z');
  assert.equal(november.start, '2026-11-01T23:00:00.000Z');
  assert.equal(november.end, '2026-11-02T01:30:00.000Z');
  assert.equal(november.timeZone, 'America/New_York');
  assert.equal(november.url, series.url);
  assert.equal(november.location, 'CFA Room 308');
  assert.equal(november.allDay, false);
});

test('session filtering preserves nine window records and six future Sundays without adding cancelled Sundays', () => {
  const result = parseWordPress({ events: [series] }, plan, window);
  assert.equal(result.events.length, 9);
  const future = result.events.filter(event => event.start > '2026-10-21T20:00:00Z');
  assert.deepEqual(future.map(event => event.uid.split('::')[1]), ['2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-12-06']);
});

test('the all-events and category feeds give shared sessions identical provider identities', () => {
  const category = parseWordPress({ events: [series] }, plan, window).events;
  const allEvents = parseWordPress({ events: [series] }, { ...plan,
    url: 'https://art.cmu.edu/events/?ical=1', fetchUrl: 'https://art.cmu.edu/wp-json/tribe/events/v1/events?per_page=50' }, window).events;
  assert.deepEqual(allEvents.map(event => [event.uid, event.start]), category.map(event => [event.uid, event.start]));
});

test('ordinary exhibitions retain their published range and unmatched titles are not expanded', () => {
  const row = { ...series, title: 'Fall exhibition', description: '<p>An exhibition open through December 6.</p>' };
  const result = parseWordPress({ events: [row] }, plan, window);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].uid, series.global_id);
  assert.equal(result.events[0].start, '2026-09-06T22:00:00.000Z');
  assert.equal(result.events[0].end, '2026-12-07T01:30:00.000Z');
  assert.deepEqual(result.warnings, []);
});

test('missing or ambiguous year and clock evidence produces a partial diagnostic instead of a continuous series', () => {
  for (const [changed, pattern] of [
    [description.replace('Fall 2026 Sessions', 'Fall Sessions'), /session year/],
    [description.replace('Fall 2026 Sessions', 'Fall 2026 and 2027 Sessions'), /session year/],
    [description.replace('6:00 to 8:30 PM', 'an announced time'), /shared start\/end clock/],
    [description.replace('All sessions take place', 'Dates are listed below'), /one selected paragraph/],
  ]) {
    const result = parseWordPress({ events: [{ ...series, description: changed }] }, plan, window);
    assert.equal(result.events.length, 0);
    assert.equal(result.partial, true);
    assert.match(result.warnings.join(' '), pattern);
  }
});

test('a malformed explicit date preserves valid sessions and marks the snapshot partial', () => {
  const result = parseWordPress({ events: [{ ...series, description: description.replace('October 25', 'October 32') }] }, plan, window);
  assert.equal(result.events.length, 8);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(' '), /October 32/);
});
