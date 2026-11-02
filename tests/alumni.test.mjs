import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { alumniOnlineVenue, fetchAlumni, parseAlumniBootstrap, parseAlumniEvents } from '../src/adapters/alumni.mjs';

const fixture = JSON.parse(await readFile(new URL('./adapters/fixtures/alumni-public-events.json', import.meta.url)));
const clocks = new Map(fixture.clocks.map(clock => [clock.id, clock]));
const snapshot = { listingURL: fixture.source, checkedAt: fixture.reviewedAt, records: fixture.records };
const plan = { url: 'https://www.cmu.edu/engage/events', options: { reviewedPublicEvents: snapshot, timezone: 'America/New_York' } };
const bootstrap = {
  data: { app: { attributes: { values: { authenticated: false } } } },
  context: { mode: 'PROD', app: 'siteforce:communityApp', fwuid: 'public-framework-version',
    loaded: { 'APPLICATION@markup://siteforce:communityApp': 'public-build' },
    globalValueProviders: [{ type: '$Site', values: { isGuestUser: true } }] },
};
const script = value => `window.Aura = {};Object.assign(window.Aura.appBootstrap, ${JSON.stringify(value)});`;

function publicContext(query) {
  return {
    fetchText: async url => url === fixture.source ? '<script src="/s/sfsites/l/published/bootstrap.js"></script>' : script(bootstrap),
    fetchPublicQuery: query,
  };
}

test('Alumni uses the publisher tile clock for Pacific and Hawaii events, without invented end times', () => {
  const result = parseAlumniEvents(fixture.records, clocks, plan);
  const sf = result.events.find(event => event.title.startsWith('Tepper San Francisco:'));
  const hi = result.events.find(event => event.title.startsWith('HI -'));
  assert.equal(sf.start, '2026-10-30T01:30:00.000Z');
  assert.equal(sf.timeZone, 'America/Los_Angeles');
  assert.equal(hi.start, '2026-10-31T03:00:00.000Z');
  assert.equal(hi.timeZone, 'Pacific/Honolulu');
  assert.equal(sf.end, sf.start);
  assert.equal(hi.end, hi.start);
  assert.equal(result.partial, true);
});

test('ambiguous Sydney clock preserves exactly the visually reviewed date and a visible caveat', () => {
  const result = parseAlumniEvents(fixture.records, clocks, plan);
  const event = result.events.find(event => event.title.startsWith('Sydney'));
  assert.equal(event.start, '2026-10-27');
  assert.equal(event.timePrecision, 'date');
  assert.match(event.description, /unresolved timezone ambiguity/);
  assert.ok(result.warnings.some(warning => warning.includes('timezone ambiguity')));
  assert.equal(result.partial, true);
});

test('online-only scope requires the reviewed card online mode, never incidental online registration or virtual-reality wording', () => {
  const physical = { ...fixture.records[0], title: 'Virtual reality: register online', Description__c: 'Register online to discuss virtual reality.' };
  assert.equal(alumniOnlineVenue(physical), false);
  const result = parseAlumniEvents([physical, ...fixture.records.slice(1)], clocks,
    { ...plan, options: { ...plan.options, onlineOnly: true } });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, 'Sports Betting and the Brain - October 2026');
  assert.equal(result.events[0].mode, 'online');
  assert.equal(result.events[0].uid, parseAlumniEvents(fixture.records, clocks, plan).events.find(e => e.mode === 'online').uid);
});

test('unavailable clocks still import the reviewed date with partial scope, without guessing from another timestamp', () => {
  const records = fixture.records.map(row => ({ ...row, Event_Start__c: '2099-01-01T09:00:00Z' }));
  const result = parseAlumniEvents(records, new Map(), plan);
  assert.equal(result.events.length, fixture.records.length);
  assert.ok(result.events.every(event => event.timePrecision === 'date'));
  assert.deepEqual(result.events.map(event => event.start), fixture.records.map(row => row.date));
  assert.equal(result.partial, true);
});

test('a clock moved to a different local date cannot silently replace the visually reviewed public date', () => {
  const changed = new Map(clocks);
  changed.set(fixture.records[0].id, { startDate: '2026-11-01T01:30:00Z', timeZoneVal: 'America/Los_Angeles' });
  const result = parseAlumniEvents([fixture.records[0]], changed, plan);
  assert.equal(result.events[0].start, fixture.records[0].date);
  assert.equal(result.events[0].timePrecision, 'date');
  assert.match(result.events[0].description, /different calendar date/);
  assert.ok(result.warnings.some(warning => warning.includes('different calendar date')));
});

test('snapshot parser ignores hidden API descriptions, postal codes and registration totals, and respects collection bounds', () => {
  const input = { ...fixture.records[3], Description__c: 'Unreviewed private dinner address', Venue_Postal_Code__c: '00000', Total_Registrants__c: 123 };
  const result = parseAlumniEvents([input], clocks, plan, { windowStart: '2026-10-28', windowEnd: '2026-10-29' });
  assert.equal(result.events.length, 1);
  assert.doesNotMatch(JSON.stringify(result.events), /Unreviewed private|Total_Registrants|Venue_Postal/);
  assert.doesNotMatch(result.events[0].location, /00000/);
  assert.equal(result.events[0].location, fixture.records[3].location);
  assert.equal(parseAlumniEvents([input], clocks, plan, { windowStart: '2027-01-01' }).events.length, 0);
});

test('bootstrap decoding is non-executing, guest-only and excludes unrelated framework data', () => {
  const value = { ...bootstrap, unused: 'a string with } and \\" braces' };
  const parsed = parseAlumniBootstrap(script(value));
  assert.equal(parsed.fwuid, 'public-framework-version');
  assert.deepEqual(Object.keys(parsed).sort(), ['app', 'dn', 'fwuid', 'globals', 'loaded', 'mode', 'uad']);
  assert.throws(() => parseAlumniBootstrap(script({ ...bootstrap, data: { app: { attributes: { values: { authenticated: true } } } } })), /anonymous public page/);
  assert.throws(() => parseAlumniBootstrap('Object.assign(window.Aura.appBootstrap,{broken'), /incomplete/);
});

test('fetch only queries clock IDs in the reviewed eligible allowlist, never the broad getEvents getter', async () => {
  const calls = [];
  const context = publicContext(async (url, body) => {
    assert.equal(url, 'https://community.cmu.edu/s/sfsites/aura');
    const form = new URLSearchParams(body);
    assert.equal(form.get('aura.token'), 'null');
    assert.equal(form.get('aura.pageURI'), '/s/events');
    const [action] = JSON.parse(form.get('message')).actions;
    calls.push(action);
    assert.equal(action.descriptor, 'apex://CommunityEventTileController/ACTION$getEventStartDate');
    assert.ok(fixture.records.some(row => row.id === action.params.eventId));
    return JSON.stringify({ actions: [{ state: 'SUCCESS', returnValue: clocks.get(action.params.eventId) }] });
  });
  await assert.rejects(fetchAlumni({ ...plan, options: {} }, context), /reviewed public-card allowlist/);
  assert.equal(calls.length, 0);
  const result = await fetchAlumni({ ...plan, options: { ...plan.options, onlineOnly: true } }, context);
  assert.equal(result.events.length, 1);
  assert.equal(result.partial, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.eventId, fixture.records[3].id);
});

test('clock getter errors preserve only reviewed dates and cannot become successful empty snapshots', async () => {
  const result = await fetchAlumni(plan, publicContext(async () => JSON.stringify({ actions: [{ state: 'ERROR' }] })));
  assert.equal(result.events.length, fixture.records.length);
  assert.ok(result.events.every(event => event.timePrecision === 'date'));
  assert.equal(result.partial, true);
  assert.ok(result.warnings.some(warning => warning.includes('one successful result')));
  await assert.rejects(fetchAlumni(plan, { fetchText: async () => '<script src="https://unreviewed.example/bootstrap.js"></script>' }), /missing or ambiguous/);
});

test('malformed reviewed identities are rejected before any page or clock request', async () => {
  let requests = 0;
  const context = { fetchText: async () => { requests++; throw Error('Unexpected page request'); },
    fetchPublicQuery: async () => { requests++; throw Error('Unexpected clock request'); } };
  for (const patch of [{ url: 'https://unreviewed.example/event' }, { date: '2026-02-30' }, { title: '  ' }, { id: 'not-a-record-id' }]) {
    const invalid = { ...snapshot, records: [{ ...fixture.records[0], ...patch }] };
    await assert.rejects(fetchAlumni({ ...plan, options: { reviewedPublicEvents: invalid } }, context), /reviewed public-card allowlist/);
  }
  assert.equal(requests, 0);
});
