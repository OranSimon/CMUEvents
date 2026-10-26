import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore, searchExpression } from '../src/lib/store.mjs';
import { classifyEvent, inferMode, inferCampus } from '../src/classify.mjs';
import { parseDate } from '../src/lib/normalize.mjs';

const plans = [
  { id: 'a', department: 'SCS', org: 'Computer Science', url: 'https://example.edu/calendar', status: 'active', adapter: 'ics' },
  { id: 'b', department: 'Student Organizations', org: 'AI Club', url: 'https://example.edu/ai', status: 'covered', canonicalSourceId: 'a' },
  { id: 'c', department: 'SCS', org: 'Research', url: 'https://example.edu/research', status: 'active', adapter: 'html' },
];

/**
 * Create a realistic normalized source occurrence for isolated persistence tests.
 * @param {Object} overrides Fields to change for a test case.
 * @return {Object} Normalized event with an individual original link.
 */
function event(overrides = {}) {
  return { uid: 'talk-1', title: 'Robotics seminar', start: '2026-11-03T22:00:00.000Z', end: '2026-11-03T23:00:00.000Z',
    allDay: false, timeZone: 'America/New_York', description: 'An invited research talk about robot planning.', summary: 'An invited research talk.',
    location: 'Gates Hall, Pittsburgh', url: 'https://example.edu/events/robotics', status: 'scheduled', tags: [], ...overrides };
}

test('duplicate source occurrences merge while preserving covered department and org aliases', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans(plans);
  store.replaceSource('a', [event()]);
  store.replaceSource('c', [event({ description: 'A longer source description of an invited robotics research talk with an abstract.' })]);
  assert.equal(store.rebuildEvents(plans), 1);
  const result = store.listEvents({ from: '2026-11-01', org: 'AI Club' });
  assert.equal(result.total, 1);
  assert.deepEqual(result.events[0].departments, ['SCS', 'Student Organizations']);
  assert.equal(result.events[0].sources.length, 3);
  assert.match(result.events[0].description, /longer source/);
  assert.equal(result.events[0].url, 'https://example.edu/events/robotics');
});

test('CampusGroups public list and ICS links merge by exact provider event ID without merging hosts or different IDs', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans(plans);
  store.replaceSource('a', [event({ uid: 'provider-ics', url: 'https://tartanconnect.cmu.edu/rsvp?id=1938233' })]);
  store.replaceSource('c', [
    event({ uid: 'public-json', url: 'https://tartanconnect.cmu.edu/senate/rsvp_boot?id=1938233&rel=title', description: 'Only open to undergraduate students. Details and registration.' }),
    event({ uid: 'different-event', url: 'https://tartanconnect.cmu.edu/rsvp_boot?id=1938234' }),
    event({ uid: 'different-campus-provider', url: 'https://scottyconnect.qatar.cmu.edu/rsvp_boot?id=1938233' }),
  ]);
  assert.equal(store.rebuildEvents(plans), 3);
  const result = store.listEvents({ from: '2026-11-01' });
  const merged = result.events.find(row => row.sources.some(source => source.id === 'a'));
  assert.ok(merged.sources.some(source => source.id === 'c'));
  assert.match(merged.description, /Only open to undergraduate/);
});

test('retired club sources disappear while official publishers retain club-hosted activities', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const club = { ...plans[0], org: 'Example Student Club' };
  const official = plans[2];
  store.registerPlans([club, official]);
  store.replaceSource(club.id, [event({ uid: 'club-only', title: 'Private club workshop' })]);
  store.replaceSource(official.id, [event({ uid: 'syndicated', title: 'Club gathering', organizer: 'Example Student Club' }),
    event({ uid: 'official', title: 'University research seminar', organizer: 'Research Office', url: 'https://example.edu/official' })]);
  store.registerPlans([official]);
  assert.equal(store.listSources().length, 1);
  assert.equal(store.rebuildEvents([official]), 2, 'official reposts stay regardless of organizer');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM occurrences').get().count, 2);
  const repost = store.listEvents({ query: 'club', from: '2026-11-01' });
  assert.equal(repost.total, 1);
  assert.equal(repost.events[0].title, 'Club gathering');
  const result = store.listEvents({ from: '2026-11-01' });
  assert.deepEqual(result.facets.orgs.map(row => row.value), ['Research']);
});

test('FTS prefix search combines text with dates and multi-label categorical filters', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans(plans);
  store.replaceSource('a', [event(), event({ uid: 'music', title: 'Piano recital', url: 'https://example.edu/events/music',
    description: 'An evening concert.', start: '2026-11-05', end: '2026-11-06', allDay: true })]);
  store.rebuildEvents(plans);
  const result = store.listEvents({ query: 'robot plan', from: '2026-11-03', to: '2026-11-03', department: 'SCS', tag: 'Research & Talks' });
  assert.equal(result.total, 1);
  assert.equal(result.events[0].mode, 'In person');
  assert.equal(store.listEvents({ from: '2026-11-04', to: '2026-11-04' }).total, 0);
  assert.equal(store.listEvents({ from: '2026-11-05', to: '2026-11-05', tag: 'Arts & Performance' }).total, 1);
  assert.equal(store.listEvents({ from: '2026-11-06' }).total, 0, 'exclusive all-day end must not leak to following date');
  assert.equal(store.listEvents({ query: '" OR * ; DROP TABLE events; --', from: '2026-11-01' }).total, 0);
  assert.equal(store.status().totalEvents, 2);
  assert.equal(searchExpression('robot-plan'), '"robot"* AND "plan"*');
});

test('failed refresh preserves last good events; a verified successful empty snapshot removes them', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans(plans);
  store.replaceSource('a', [event()]);
  store.failSource('a', new Error('Upstream timeout'));
  store.rebuildEvents(plans);
  assert.equal(store.status().sources.error, 1);
  assert.equal(store.status().totalEvents, 1);
  assert.ok(store.listSources().find(source => source.id === 'a').lastSuccess);
  store.replaceSource('a', []);
  store.rebuildEvents(plans);
  assert.equal(store.status().totalEvents, 0);
  assert.equal(store.status().sources.empty, 1);
});

test('classification retains uncertainty and does not infer online from incidental description', () => {
  assert.equal(inferMode(event({ description: 'Recording will be posted online.' })), 'In person');
  assert.equal(inferMode(event({ location: 'Zoom' })), 'Online');
  assert.equal(inferMode(event({ location: '' })), 'Unspecified');
  assert.equal(inferCampus(event({ location: 'Unknown building' }), []), 'Other / unspecified');
  assert.equal(inferCampus(event({ location: 'Doha, Qatar' }), []), 'Qatar');
  assert.equal(inferCampus(event({ location: 'Newell-Simon Hall 3305' }), []), 'Pittsburgh');
  assert.ok(classifyEvent({ ...event(), sources: plans }).tags.includes('Research & Talks'));
  assert.equal(parseDate('2026-02-30T12:00:00'), null);
  assert.equal(parseDate('2026-02-30T12:00:00-05:00'), null);
  assert.equal(parseDate('2026-10-20T25:00:00'), null);
});

test('changed source endpoints become due and covered aliases discard obsolete independent snapshots', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans(plans);
  store.replaceSource('a', [event()]);
  store.replaceSource('c', [event({ uid: 'obsolete', title: 'Old extraction', url: 'https://example.edu/old' })]);
  const updated = plans.map(plan => plan.id === 'a' ? { ...plan, fetchUrl: 'https://example.edu/new.ics' }
    : plan.id === 'c' ? { ...plan, status: 'covered', canonicalSourceId: 'a' } : plan);
  store.registerPlans(updated);
  assert.equal(store.listSources().find(source => source.id === 'a').lastAttempt, null);
  assert.equal(store.rebuildEvents(updated), 1);
  assert.equal(store.listEvents({ from: '2026-11-01' }).events[0].sources.length, 3);
});

test('partial extraction adds valid events without deleting prior records or claiming a complete success', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans(plans);
  store.replaceSource('a', [event()], [], '2026-10-01T00:00:00.000Z');
  store.mergePartial('a', [event({ uid: 'new', title: 'New talk', url: 'https://example.edu/new-talk' })], ['Additional endpoint timed out']);
  store.rebuildEvents(plans);
  assert.equal(store.status().totalEvents, 2);
  const source = store.listSources().find(item => item.id === 'a');
  assert.equal(source.state, 'error');
  assert.equal(source.lastSuccess, '2026-10-01T00:00:00.000Z');
  assert.match(source.error, /previous records retained/);
});

test('partial timed enrichment replaces only a unique same-link same-title unknown-time day', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans(plans);
  const date = event({ uid: 'listing', start: '2026-11-03', end: '2026-11-04', allDay: true, timePrecision: 'date' });
  const timed = event({ uid: 'detail', start: '2026-11-04T01:00:00.000Z', end: '2026-11-04T02:00:00.000Z', timePrecision: 'time' });
  store.replaceSource('a', [date], [], '2026-10-01T00:00:00.000Z');
  store.mergePartial('a', [timed], ['A separate child remains undated']);
  assert.equal(store.rebuildEvents(plans), 1);
  assert.equal(store.listEvents({ from: '2026-11-03' }).events[0].uid, 'detail');
  assert.equal(store.listSources().find(item => item.id === 'a').state, 'error');
  assert.equal(store.listSources().find(item => item.id === 'a').lastSuccess, '2026-10-01T00:00:00.000Z');
  for (const [old, fresh, count] of [
    [{ ...date, timePrecision: 'all-day' }, [timed], 2],
    [date, [timed, { ...timed, uid: 'second-session', start: '2026-11-03T22:00:00.000Z' }], 3],
    [date, [{ ...timed, url: 'https://example.edu/another' }], 2],
    [date, [{ ...timed, title: 'A separate seminar' }], 2],
    [date, [{ ...timed, start: '2026-11-05T01:00:00.000Z' }], 2],
    [{ ...date, end: '2026-11-06' }, [timed], 2],
  ]) {
    store.replaceSource('a', [old]);
    store.mergePartial('a', fresh, ['Other child unavailable']);
    assert.equal(store.rebuildEvents(plans), count);
  }
  store.replaceSource('a', [date, { ...date, uid: 'ambiguous-prior' }]);
  store.mergePartial('a', [timed], ['Other child unavailable']);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM occurrences WHERE source_id=?').get('a').count, 3);
});

test('declared single-event UIDs atomically replace date-only snapshots across source time zones', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans(plans);
  const old = event({ uid: 'alumni:sydney', title: 'Sydney alumni coffee', start: '2026-10-27', end: '2026-10-28',
    timePrecision: 'date', allDay: true, url: 'https://example.edu/alumni/sydney' });
  const timed = { ...old, start: '2026-10-27T21:00:00.000Z', end: '2026-10-27T22:30:00.000Z',
    timeZone: 'Australia/Sydney', timePrecision: 'time', allDay: false };
  const unrelated = event({ uid: 'another', url: 'https://example.edu/another' });
  store.replaceSource('a', [old, unrelated], [], '2026-10-01T00:00:00.000Z');
  store.replaceSource('c', [old]);
  store.mergePartial('a', [timed], ['Public listing discovery is incomplete'], { singleEventUids: [timed.uid] });
  const records = store.db.prepare('SELECT data FROM occurrences WHERE source_id=?').all('a').map(row => JSON.parse(row.data));
  assert.equal(records.length, 2);
  assert.deepEqual(records.find(row => row.uid === timed.uid), timed);
  assert.deepEqual(records.find(row => row.uid === unrelated.uid), unrelated);
  assert.equal(JSON.parse(store.db.prepare('SELECT data FROM occurrences WHERE source_id=?').get('c').data).start, old.start,
    'the same provider identity in a different source is untouched');
  const source = store.listSources().find(row => row.id === 'a');
  assert.equal(source.state, 'error');
  assert.equal(source.lastSuccess, '2026-10-01T00:00:00.000Z');
  assert.equal(source.eventCount, 2);
});

test('single-event clock loss retains the accepted timed record without inserting a date-only duplicate', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans(plans);
  const accepted = event({ uid: 'alumni:sydney', title: 'Sydney alumni coffee', start: '2026-10-27T21:00:00.000Z',
    end: '2026-10-27T22:30:00.000Z', timeZone: 'Australia/Sydney', timePrecision: 'time',
    url: 'https://example.edu/alumni/sydney' });
  const fallback = { ...accepted, start: '2026-10-27', end: '2026-10-28', timeZone: 'America/New_York',
    timePrecision: 'date', allDay: true };
  store.replaceSource('a', [accepted, fallback], [], '2026-10-01T00:00:00.000Z');
  const warnings = ['Live clock is unavailable'];
  store.mergePartial('a', [fallback], warnings, { singleEventUids: [accepted.uid] });
  const records = store.db.prepare('SELECT data FROM occurrences WHERE source_id=?').all('a').map(row => JSON.parse(row.data));
  assert.deepEqual(records, [accepted]);
  const source = store.listSources().find(row => row.id === 'a');
  assert.equal(source.state, 'error');
  assert.equal(source.lastSuccess, '2026-10-01T00:00:00.000Z');
  assert.match(source.warnings.join(' '), /Retained the last accepted clock/);
  assert.deepEqual(warnings, ['Live clock is unavailable'], 'caller diagnostics are not mutated');
});

test('single-event date-only updates replace earlier dates when no accepted clock exists', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans(plans);
  const old = event({ uid: 'alumni:unknown-clock', start: '2026-10-27', end: '2026-10-28', timePrecision: 'date', allDay: true });
  const fresh = { ...old, start: '2026-10-28', end: '2026-10-29' };
  store.replaceSource('a', [old]);
  store.mergePartial('a', [fresh], ['Clock not published'], { singleEventUids: [fresh.uid] });
  const records = store.db.prepare('SELECT data FROM occurrences WHERE source_id=?').all('a').map(row => JSON.parse(row.data));
  assert.deepEqual(records, [fresh]);
});

test('single-event reconciliation leaves unmentioned identities and multi-occurrence series intact', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans(plans);
  const oldRecurring = event({ uid: 'weekly-series', start: '2026-11-01T22:00:00.000Z', end: '2026-11-01T23:00:00.000Z', timePrecision: 'time' });
  const freshRecurring = [event({ uid: oldRecurring.uid, timePrecision: 'time' }), event({ uid: oldRecurring.uid,
    start: '2026-11-10T22:00:00.000Z', end: '2026-11-10T23:00:00.000Z', timePrecision: 'time' })];
  const unmentioned = event({ uid: 'unmentioned', title: 'An unrelated event', url: 'https://example.edu/unmentioned',
    start: '2026-10-27', end: '2026-10-28', timePrecision: 'date', allDay: true });
  store.replaceSource('a', [oldRecurring, unmentioned]);
  store.mergePartial('a', freshRecurring, ['Another endpoint failed'], { singleEventUids: [oldRecurring.uid] });
  let records = store.db.prepare('SELECT data FROM occurrences WHERE source_id=?').all('a').map(row => JSON.parse(row.data));
  assert.equal(records.filter(row => row.uid === oldRecurring.uid).length, 3, 'a multi-occurrence UID bypasses replacement');
  assert.deepEqual(records.find(row => row.uid === unmentioned.uid), unmentioned);
  const singleFresh = { ...unmentioned, start: '2026-10-28T01:00:00.000Z', end: '2026-10-28T02:00:00.000Z', timePrecision: 'time', allDay: false };
  store.mergePartial('a', [singleFresh], ['Another endpoint failed']);
  records = store.db.prepare('SELECT data FROM occurrences WHERE source_id=?').all('a').map(row => JSON.parse(row.data));
  assert.equal(records.filter(row => row.uid === oldRecurring.uid).length, 3);
  assert.equal(records.find(row => row.uid === unmentioned.uid).start, singleFresh.start,
    'the existing independent same-day enrichment rule remains available without a single-event declaration');
});

test('syndicated copies merge only with identical substantial descriptions, titles, times and physical venues', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans(plans);
  const original = event({ title: '2026 Teaching and Learning Summit',
    description: 'Learn about the teaching and learning strategies your CMU colleagues are using in their classrooms. Share evidence and discuss new approaches.',
    location: 'Rangos Ballroom, Cohon University Center' });
  store.replaceSource('a', [original]);
  store.replaceSource('c', [{ ...original, uid: 'syndicated-copy', url: 'https://example.edu/copy' },
    { ...original, uid: 'distinct', url: 'https://example.edu/other', description: 'A distinct event using the same title and venue, with a separate program, audience, speakers and organizers.' }]);
  assert.equal(store.rebuildEvents(plans), 2);
  assert.equal(store.listEvents({ from: '2026-11-01' }).events.find(item => item.description === original.description).sources.length, 3);
});
