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
