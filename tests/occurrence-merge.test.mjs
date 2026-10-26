import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/lib/store.mjs';
import { normalizeEvent } from '../src/lib/normalize.mjs';
import { exportCrawlState, restoreCrawlState } from '../src/lib/crawl-state.mjs';

const publishers = [
  { id: 'alpha', org: 'Research Department', department: 'Science', status: 'active', url: 'https://alpha.example.edu/calendar' },
  { id: 'beta', org: 'University Calendar', department: 'University', status: 'active', url: 'https://beta.example.edu/calendar' },
  { id: 'gamma', org: 'Seminar Directory', department: 'Engineering', status: 'active', url: 'https://gamma.example.edu/calendar' },
];
const description = 'Dana Morgan discusses the boundary between mathematical verification and deployed cryptographic systems, with examples from an independently published research program.';
const base = {
  title: 'Cryptographic systems seminar — Dana Morgan',
  start: '2026-11-03T17:00:00Z', end: '2026-11-03T18:00:00Z',
  timeZone: 'America/New_York', location: 'Panther Hollow Conference Room, Research Center 4105',
  description, organizer: 'Security Research Seminar',
};

/**
 * Materialize independent publisher snapshots without network or disk state.
 * @param {Object} t Test cleanup handle.
 * @param {Array<Object[]>} snapshots Per-publisher source occurrences.
 * @param {Object[]} plans Source registration order, independently reversible.
 * @return {Object[]} Canonical public occurrences.
 */
function buildStore(t, snapshots, plans = publishers) {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans(plans);
  snapshots.forEach((rows, index) => {
    const plan = publishers[index];
    const normalized = rows.map((row, rowIndex) => normalizeEvent({ ...base,
      uid: `${plan.id}-${rowIndex}`, url: `https://${plan.id}.example.edu/events/${rowIndex}`, ...row }, plan));
    assert.ok(normalized.every(Boolean), 'Every fixture must have a real normalized date and URL');
    store.replaceSource(plan.id, normalized);
  });
  store.rebuildEvents(plans);
  return store;
}

/** Query a fresh isolated store through the public event-list contract. */
function materialize(t, snapshots, plans = publishers) {
  return buildStore(t, snapshots, plans).listEvents({ from: '2026-11-01', to: '2026-11-30', limit: 100 }).events;
}

/**
 * Compare complete occurrence identity and provenance independently of ordering.
 * @param {Object[]} events Materialized public occurrences.
 * @return {Object[]} Deterministically ordered facts used by readers and links.
 */
function facts(events) {
  return events.map(event => ({ id: event.id, title: event.title, start: event.start, end: event.end,
    description: event.description, location: event.location,
    sources: event.sources.map(({ id, url, eventUrl }) => ({ id, url, eventUrl })) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

test('specific same-time source copies can merge despite title punctuation, venue whitespace and abridged or absent prose', t => {
  const events = materialize(t, [
    [{}],
    [{ title: 'Cryptographic systems seminar: Dana Morgan', location: 'Panther Hollow Conference Room,\nResearch Center 4105',
      description: 'Dana Morgan discusses the boundary between mathematical verification and deployed cryptographic systems.' }],
    [{ title: 'Cryptographic systems seminar - Dana Morgan', location: 'Panther Hollow Conference Room — Research Center 4105', description: '' }],
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].description, description);
  assert.deepEqual([...new Set(events[0].sources.map(source => source.id))].sort(), ['alpha', 'beta', 'gamma']);
});

test('generic titles and matching clocks alone cannot combine unrelated rooms and organizers', t => {
  const events = materialize(t, [
    [{ title: 'Meeting', organizer: 'Research Council', description: 'The council reviews its research budget.', location: 'Research Hall 101' }],
    [{ title: 'Meeting', organizer: 'Student Film Collective', description: 'Members plan the independent film screening.', location: 'Arts Building 202' }],
  ]);
  assert.equal(events.length, 2);
});

test('a local UID reused by unrelated publisher hosts does not identify the same event', t => {
  const events = materialize(t, [
    [{ uid: '12345', title: 'Materials research presentation', description: 'Materials speakers present experimental work.', location: 'Research Hall 101' }],
    [{ uid: '12345', title: 'Community theater rehearsal', description: 'Theater members rehearse their new play.', location: 'Arts Building 202' }],
  ]);
  assert.equal(events.length, 2);
});

test('LiveWhale detail routes for one provider ID and occurrence combine without dropping either original URL', t => {
  const originals = [
    'https://events.cmu.edu/live/events/12345-cryptographic-systems-seminar',
    'https://events.cmu.edu/research/event/12345-cryptographic-systems-seminar',
  ];
  const events = materialize(t, [
    [{ uid: 'api-display', url: originals[0] }],
    [{ uid: 'department-copy', url: originals[1], description: 'A shorter published announcement.' }],
  ]);
  assert.equal(events.length, 1);
  assert.deepEqual([...new Set(events[0].sources.map(source => source.eventUrl))].sort(), originals.sort());
});

test('weekly instances sharing UID and detail URL remain separate for each published date', t => {
  const first = { uid: 'weekly-series@example.edu', url: 'https://events.cmu.edu/research/event/12345-weekly-seminar' };
  const second = { ...first, start: '2026-11-10T17:00:00Z', end: '2026-11-10T18:00:00Z' };
  const events = materialize(t, [[first, second], [first, second]]);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.start).sort(), ['2026-11-03T17:00:00.000Z', '2026-11-10T17:00:00.000Z']);
  assert.ok(events.every(event => new Set(event.sources.map(source => source.id)).size === 2));
});

test('separate clocks on one date stay distinct even when their title, body, UID and URL are identical', t => {
  const first = { uid: 'day-series@example.edu', url: 'https://example.edu/events/one-day-program' };
  const second = { ...first, start: '2026-11-03T20:00:00Z', end: '2026-11-03T21:00:00Z' };
  const events = materialize(t, [[first, second], [first, second]]);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.start).sort(), ['2026-11-03T17:00:00.000Z', '2026-11-03T20:00:00.000Z']);
});

test('a shared calendar viewer is not a per-event identity for same-time generic titles', t => {
  const shared = 'https://calendar.google.com/calendar/embed?src=public-calendar&mode=AGENDA';
  const events = materialize(t, [
    [{ url: shared, linkKind: 'calendar-viewer', title: 'Office hours', organizer: 'Mathematics Advising',
      description: 'Advising for mathematics majors.', location: 'Mathematics Hall 301' }],
    [{ url: shared, linkKind: 'calendar-viewer', title: 'Office hours', organizer: 'Film Production',
      description: 'Students discuss film editing assignments.', location: 'Arts Building 202' }],
  ]);
  assert.equal(events.length, 2);
});

test('date-only ranges with different explicit ends do not collapse through their shared start, UID or URL', t => {
  const shared = { uid: 'program-range@example.edu', url: 'https://example.edu/events/program', start: '2026-11-03', allDay: true };
  const events = materialize(t, [[{ ...shared, end: '2026-11-05' }], [{ ...shared, end: '2026-11-07' }]]);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.end).sort(), ['2026-11-05', '2026-11-07']);
});

test('a date-only announcement does not guess a clock when two independently timed sessions match', t => {
  const shared = { url: 'https://example.edu/events/program' };
  const events = materialize(t, [
    [{ ...shared, uid: 'undated-clock', start: '2026-11-03', end: '2026-11-04', allDay: false }],
    [{ ...shared, uid: 'first-clock' }, { ...shared, uid: 'second-clock', start: '2026-11-03T20:00:00Z', end: '2026-11-03T21:00:00Z' }],
  ]);
  assert.equal(events.length, 3);
  assert.equal(events.filter(event => event.timePrecision === 'date').length, 1);
});

test('a publisher can contribute multiple original links to one merged occurrence', t => {
  const urls = ['https://alpha.example.edu/events/original', 'https://alpha.example.edu/reposts/original'];
  const events = materialize(t, [[{ uid: 'original', url: urls[0] }, { uid: 'repost', url: urls[1] }], [{}]]);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].sources.filter(source => source.id === 'alpha').map(source => source.eventUrl).sort(), urls.sort());
});

test('a missing end cannot transitively bridge two known conflicting session ends', t => {
  const events = materialize(t, [
    [{ uid: 'first-end', end: '2026-11-03T18:00:00Z' }],
    [{ uid: 'missing-end', end: undefined }],
    [{ uid: 'second-end', end: '2026-11-03T19:00:00Z' }],
  ]);
  assert.ok(events.length >= 2);
  assert.ok(events.every(event => {
    const ids = new Set(event.sources.map(source => source.id));
    return !(ids.has('alpha') && ids.has('gamma'));
  }));
});

test('canonical occurrences and all provenance links are deterministic under source and record insertion permutations', t => {
  const snapshots = [
    [{ uid: 'alpha-original', url: 'https://alpha.example.edu/events/original' },
      { uid: 'alpha-copy', url: 'https://alpha.example.edu/reposts/original' }],
    [{ uid: 'beta-copy', description: `${description} Questions will follow the presentation.` }],
    [{ uid: 'gamma-copy', description: '' }],
  ];
  const forward = materialize(t, snapshots);
  const reversed = materialize(t, snapshots.map(rows => [...rows].reverse()), [...publishers].reverse());
  assert.deepEqual(facts(reversed), facts(forward));
});

test('same-source reused UIDs preserve distinct known ends, date ranges and unrelated title or URL claims before matching', t => {
  const uid = 'reused-local-identity';
  const range = { uid, url: 'https://alpha.example.edu/events/range', start: '2026-11-04', allDay: true };
  const store = buildStore(t, [[
    { uid, url: 'https://alpha.example.edu/events/original' },
    { uid, url: 'https://alpha.example.edu/events/original', end: '2026-11-03T19:00:00Z' },
    { uid, url: 'https://alpha.example.edu/events/theater', title: 'Community theater rehearsal' },
    { ...range, end: '2026-11-06' },
    { ...range, end: '2026-11-08' },
  ]]);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM occurrences WHERE source_id=?').get('alpha').count, 5);
  const events = store.listEvents({ from: '2026-11-01', to: '2026-11-30', limit: 100 }).events;
  assert.equal(events.length, 5);
  assert.deepEqual(events.filter(event => event.allDay).map(event => event.end).sort(), ['2026-11-06', '2026-11-08']);
  assert.ok(events.some(event => event.title === 'Community theater rehearsal'));
});

test('three sparse copies join through supported body and venue evidence without requiring invented missing facts', t => {
  const events = materialize(t, [
    [{}],
    [{ location: 'To be announced', description: 'Dana Morgan discusses the boundary between mathematical verification and deployed cryptographic systems.' }],
    [{ description: '' }],
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].description, description);
  assert.deepEqual([...new Set(events[0].sources.map(source => source.id))].sort(), ['alpha', 'beta', 'gamma']);
  assert.ok(events[0].sourceVariants.some(variant => variant.location === 'To be announced'));
  assert.ok(events[0].sourceVariants.some(variant => variant.description === ''));
});

test('a mixed online venue and sparse announcement preserve both conflicting physical rooms when other occurrence evidence agrees', t => {
  const title = 'Security seminar — Elena Rossi';
  const placeholder = 'Speaker: Elena Rossi. Talk title coming soon. Abstract coming soon. Details will follow in the official announcement.';
  const rich = 'Elena Rossi presents a research talk on verification of deployed security systems. The presentation compares cryptographic models with concrete implementations and discusses practical engineering evidence.';
  const events = materialize(t, [
    [{ title, location: 'Zoom and North Meadow Conference Room, Innovation Center 4501', description: placeholder }],
    [{ title, location: 'North Meadow Conference Room, Innovation Center 4105', description: rich }],
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].description, rich);
  assert.ok(events[0].sourceConflicts.includes('location'));
  assert.deepEqual(events[0].sourceVariants.map(variant => variant.location).sort(), [
    'North Meadow Conference Room, Innovation Center 4105', 'Zoom and North Meadow Conference Room, Innovation Center 4501',
  ]);
  assert.ok(events[0].sourceVariants.some(variant => variant.description === placeholder));
  assert.ok(events[0].sourceVariants.some(variant => variant.descriptionMatchesCanonical === true));
});

test('portable crawl-state restoration reconstructs source versions, all links and distinct weekly occurrences', t => {
  const row = { uid: 'portable-weekly@example.edu', title: 'Security seminar — Elena Rossi' };
  const later = { ...row, start: '2026-11-10T17:00:00Z', end: '2026-11-10T18:00:00Z' };
  const snapshots = [
    [{ ...row, location: 'Zoom and North Meadow Conference Room, Innovation Center 4501', description: 'Talk title coming soon. Abstract coming soon.' },
      { ...later, location: 'Zoom and North Meadow Conference Room, Innovation Center 4501', description: 'Talk title coming soon. Abstract coming soon.' }],
    [{ ...row, location: 'North Meadow Conference Room, Innovation Center 4105' },
      { ...later, location: 'North Meadow Conference Room, Innovation Center 4105' }],
  ];
  const original = buildStore(t, snapshots);
  const options = { from: '2026-11-01', to: '2026-11-30', limit: 100 };
  const before = original.listEvents(options).events;
  assert.equal(before.length, 2);
  const state = exportCrawlState(original, { windowStart: '2026-11-01', windowEnd: '2026-12-01' });
  const restored = openStore(':memory:');
  t.after(() => restored.close());
  restored.registerPlans(publishers);
  const result = restoreCrawlState(restored, publishers, JSON.parse(JSON.stringify(state)), { windowStart: '2026-11-01', windowEnd: '2026-12-01' });
  assert.equal(result.restoredEvents, 4);
  assert.deepEqual(result.invalidated, []);
  const after = restored.listEvents(options).events;
  assert.deepEqual(facts(after), facts(before));
  assert.deepEqual(after.map(event => event.sourceVariants), before.map(event => event.sourceVariants));
  assert.deepEqual(after.map(event => event.sourceConflicts), before.map(event => event.sourceConflicts));
  assert.deepEqual(after.map(event => event.start).sort(), ['2026-11-03T17:00:00.000Z', '2026-11-10T17:00:00.000Z']);
});

test('a catalog listing mislabeled as an event detail cannot identify different same-time activities', t => {
  const url = 'https://directory.example.edu/calendar';
  const plans = publishers.map(plan => ({ ...plan, url }));
  const events = materialize(t, [
    [{ title: 'Club meeting', url, description: 'The research committee reviews its budget.', location: 'Research Hall 101', organizer: 'Research Committee' }],
    [{ title: 'Club meeting', url, description: 'The film collective plans a rehearsal.', location: 'Arts Building 202', organizer: 'Film Collective' }],
  ], plans);
  assert.equal(events.length, 2);
});

test('sparse course announcements in distinct rooms cannot merge just from their shared building and title', t => {
  const title = 'Introduction to Python programming';
  const events = materialize(t, [
    [{ title, description: '', location: 'Green River Conference Center Room 201', organizer: 'Alpha Learning Group' }],
    [{ title, description: '', location: 'Green River Conference Center Room 202', organizer: 'Beta Learning Group' }],
  ]);
  assert.equal(events.length, 2);
});
