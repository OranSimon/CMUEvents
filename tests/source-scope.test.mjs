import test from 'node:test';
import assert from 'node:assert/strict';
import * as sourceScope from '../src/lib/source-scope.mjs';

const { createSourceScope, evaluateSourceScope, sourceAllowed } = sourceScope;
const config = {
  blockedSourceIds: ['club-owned-source'],
  blockedSourceUrls: ['https://www.cmu.edu/roboclub/', 'https://roboclub.example/',
    'https://tartanconnect.cmu.edu/ical/ical_club.ics?club_id=68000',
    'https://calendar.google.com/calendar/embed?src=robotics%40group.calendar.google.com'],
};
const scope = createSourceScope(config);

/**
 * Build an official registry plan that may contain any organizer's public events.
 * @param {Object} overrides Registry fields to change.
 * @return {Object} Official source plan.
 */
function official(overrides = {}) {
  return { id: 'official-calendar', org: 'University Calendar', adapter: 'livewhale',
    url: 'https://events.cmu.edu/', fetchUrl: 'https://events.cmu.edu/live/json/events', ...overrides };
}

test('only registry APIs are exported; no event-level exclusion API remains', () => {
  assert.deepEqual(Object.keys(sourceScope).sort(), ['createSourceScope', 'evaluateSourceScope', 'sourceAllowed']);
});

test('an independently maintained club source is excluded by its explicit source ID', () => {
  const plan = official({ id: 'club-owned-source', org: 'RoboClub' });
  assert.equal(sourceAllowed(plan, scope), false);
  assert.deepEqual(evaluateSourceScope(plan, scope), { allowed: false,
    reasons: [{ code: 'blocked_source_id', field: 'plan.id', value: 'club-owned-source', matched: 'club-owned-source' }] });
});

test('official sources retain club-hosted, cohosted and club-linked events unchanged', () => {
  const events = Object.freeze([
    Object.freeze({ uid: 'club-event', organizer: 'RoboClub', title: 'RoboClub meeting',
      url: 'https://roboclub.example/events/meeting', tags: ['ROBOCLUB'] }),
    Object.freeze({ uid: 'collaboration', organizer: 'University Libraries and RoboClub',
      title: 'A collaboration', description: 'Hosted by RoboClub', tags: ['SPS'] }),
  ]);
  const plan = Object.freeze(official({ events }));
  assert.equal(sourceAllowed(plan, scope), true);
  assert.deepEqual(evaluateSourceScope(plan, scope), { allowed: true, reasons: [] });
  assert.equal(plan.events, events);
  assert.equal(plan.events.length, 2);
  assert.equal(plan.events[0].organizer, 'RoboClub');
});

test('obsolete event-level configuration cannot affect source eligibility', () => {
  const policy = createSourceScope({ blockedOrganizations: ['RoboClub'], blockedGroupLabels: ['SPS'],
    blockedProviderClubIds: { campusgroups: ['68000'] },
    reviewedBlockedEvents: [{ uid: 'club-event', url: 'https://roboclub.example/', start: '2026-10-27' }] });
  assert.equal(sourceAllowed(official({ org: 'RoboClub', organizer: 'RoboClub', uid: 'club-event', tags: ['SPS'] }), policy), true);
  assert.equal(sourceAllowed(official({ url: 'https://tartanconnect.cmu.edu/ical/tepper/ical_club_68000.ics' }), policy), true);
});

test('club website rules use bounded source paths and do not block similarly named official paths', () => {
  for (const url of ['https://www.cmu.edu/roboclub', 'https://www.cmu.edu/roboclub/calendar/next', 'https://roboclub.example/events']) {
    assert.equal(sourceAllowed(official({ url }), scope), false, url);
  }
  for (const url of ['https://www.cmu.edu/roboclub-research', 'https://www.cmu.edu/robotics', 'https://roboclub.example.evil.test/events']) {
    assert.equal(sourceAllowed(official({ url }), scope), true, url);
  }
});

test('query parameters distinguish one club source from other calendars on a shared provider', () => {
  assert.equal(sourceAllowed(official({ url: 'https://tartanconnect.cmu.edu/ical/ical_club.ics?club_id=68000' }), scope), false);
  assert.equal(sourceAllowed(official({ url: 'https://tartanconnect.cmu.edu/ical/ical_club.ics?club_id=70000' }), scope), true);
  assert.equal(sourceAllowed(official({ url: 'https://calendar.google.com/calendar/embed?src=robotics%40group.calendar.google.com&ctz=America%2FNew_York' }), scope), false);
  assert.equal(sourceAllowed(official({ url: 'https://calendar.google.com/calendar/embed?src=office%40group.calendar.google.com' }), scope), true);
});

test('registry fetch URL rules exclude only the identified source and provide exact diagnostics', () => {
  const plan = official({ fetchUrl: 'https://roboclub.example/calendar.ics' });
  const decision = evaluateSourceScope(plan, scope);
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.reasons, [{ code: 'blocked_source_url', field: 'plan.fetchUrl',
    value: plan.fetchUrl, matched: 'https://roboclub.example/' }]);
});

test('official CampusGroups offices and whole-university calendars are eligible', () => {
  for (const url of ['https://tartanconnect.cmu.edu/hrfamilycare/events/',
    'https://tartanconnect.cmu.edu/ical/tepper/ical_tepper.ics',
    'https://scottyconnect.qatar.cmu.edu/ical/cmu/ical_cmu.ics',
    'https://tartanconnect.cmu.edu/ical/tepper/ical_club_70000.ics']) {
    assert.equal(sourceAllowed(official({ url, fetchUrl: url }), scope), true, url);
  }
});

test('unsafe shared portal URL rules cannot remove every official source', () => {
  const urls = ['https://cmu.edu/', 'https://www.cmu.edu/', 'https://events.cmu.edu/',
    'https://www.google.com/', 'https://calendar.google.com/', 'https://calendar.google.com/calendar/embed',
    'https://tartanconnect.cmu.edu/', 'https://scottyconnect.qatar.cmu.edu/events',
    'https://tartanconnect.cmu.edu/ical/tepper/ical_tepper.ics',
    'https://art.cmu.edu/wp-json/tribe/events/v1/events?per_page=50'];
  const policy = createSourceScope({ blockedSourceUrls: urls });
  assert.equal(policy.warnings.length, urls.length);
  assert.equal(sourceAllowed(official(), policy), true);
  assert.equal(sourceAllowed(official({ url: 'https://art.cmu.edu/wp-json/tribe/events/v1/events?per_page=50' }), policy), true);
  assert.equal(sourceAllowed(official({ url: 'https://scottyconnect.qatar.cmu.edu/events?group_ids=70000' }), policy), true);
});

test('registry decisions are deterministic and do not mutate frozen plan/config data', () => {
  const policy = Object.freeze({ blockedSourceIds: Object.freeze(['club-owned-source']), blockedSourceUrls: Object.freeze([]) });
  const plan = Object.freeze(official());
  assert.deepEqual(evaluateSourceScope(plan, policy), evaluateSourceScope(plan, createSourceScope(policy)));
  assert.deepEqual(scope.warnings, []);
  assert.equal(plan.id, 'official-calendar');
});
