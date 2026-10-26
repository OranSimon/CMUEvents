import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/server.mjs';
import { openStore } from '../src/lib/store.mjs';
import { publicAddress } from '../src/lib/fetcher.mjs';
import { createSourceScope } from '../src/lib/source-scope.mjs';
import { createSourceSubscriptions } from '../src/lib/source-subscriptions.mjs';

test('HTTP API validates dates, combines filters, serves UI, and protects refresh mutation', async t => {
  const store = openStore(':memory:');
  const plans = [{ id: 'a', department: 'Engineering', org: 'Robotics', status: 'active', adapter: 'ics', url: 'https://example.edu/calendar' }];
  let refreshCalls = 0;
  const refresher = { isRunning: () => false, status: () => ({ ...store.status(), refreshing: false }),
    refresh: async () => { refreshCalls++; return {}; } };
  const app = createApplication({ store, plans, refresher, config: { host: '127.0.0.1', port: 0 } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  store.replaceSource('a', [{ uid: 'r1', title: 'Robot learning', description: 'A robotics seminar.', summary: 'A robotics seminar.',
    start: '2026-12-01T17:00:00.000Z', end: '2026-12-01T18:00:00.000Z', timeZone: 'America/New_York',
    location: 'Pittsburgh', url: 'https://example.edu/event/robot', status: 'scheduled', allDay: false }]);
  store.rebuildEvents(plans);
  const response = await fetch(`${base}/api/events?q=robot&from=2026-12-01&to=2026-12-01&department=Engineering`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.total, 1);
  assert.equal((await (await fetch(`${base}/api/events/${data.events[0].id}`)).json()).url, 'https://example.edu/event/robot');
  assert.equal((await fetch(`${base}/api/events?from=2026-02-30`)).status, 400);
  assert.equal((await fetch(`${base}/api/events?from=2026-12-10&to=2026-12-01`)).status, 400);
  const ui = await fetch(base);
  assert.equal(ui.status, 200);
  assert.match(ui.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await ui.text(), /CMU Events/);
  assert.equal((await fetch(`${base}/api/refresh`, { method: 'POST', headers: { Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal(refreshCalls, 0);
  assert.equal((await fetch(`${base}/api/refresh`, { method: 'POST', headers: { Origin: base } })).status, 202);
  assert.equal(refreshCalls, 1);
  assert.equal((await fetch(`${base}/data/event_sources.json`)).status, 404);
});

test('discovered links cannot target common private and local network addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.2', '172.16.4.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
    assert.equal(publicAddress(address), false, address);
  }
  assert.equal(publicAddress('128.2.42.1'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
});

test('source API exposes reviewed email access without hiding public calendar events or directory entries', async t => {
  const store = openStore(':memory:');
  const plans = [
    { id: 'public', department: 'Research', org: 'Public seminar calendar', kind: 'event_listing', status: 'active', adapter: 'html', url: 'https://example.edu/events' },
    { id: 'email', department: 'Research', org: 'Private announcement list', kind: 'mailing_list', status: 'subscription_only', adapter: 'manual', url: 'https://example.edu/list' },
    { id: 'shared', department: 'Research', org: 'Same public feed', kind: 'event_listing', status: 'covered', adapter: 'html', canonicalSourceId: 'public', url: 'https://example.edu/other-events' },
  ];
  const channel = (sourceId, kind) => ({ sourceId, kind, title: 'Publisher mailing list', url: 'https://example.edu/subscribe',
    reason: 'Email-only content is not included.', nextStep: 'Review the official subscription options.', requirements: [],
    access: { emailConfirmation: null, moderatorApproval: null, andrewOnly: null, loginRequired: null, captcha: null },
    emailEventsIngested: false, publicCalendarIncluded: kind === 'public_plus_email' });
  const sourceSubscriptions = createSourceSubscriptions({ subscriptions: [channel('email', 'subscriber_only'), channel('public', 'public_plus_email')] });
  const refresher = { isRunning: () => false, status: () => store.status(), refresh: async () => ({}) };
  const app = createApplication({ store, plans, sourceSubscriptions, refresher });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); store.close(); });
  store.replaceSource('public', [{ uid: 'published', title: 'Public research talk', start: '2026-12-01', end: '2026-12-02',
    timeZone: 'America/New_York', url: 'https://example.edu/talk', description: '', summary: '', tags: [] }]);
  store.rebuildEvents(plans);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const sources = (await (await fetch(`${base}/api/sources`)).json()).sources;
  assert.equal(sources.length, 3, 'covered and subscription-only entries remain browsable');
  assert.equal(sources.find(source => source.id === 'email').subscription.emailEventsIngested, false);
  assert.equal(sources.find(source => source.id === 'public').subscription.publicCalendarIncluded, true);
  assert.equal(sources.find(source => source.id === 'shared').subscription, undefined);
  assert.equal(sources.find(source => source.id === 'email').kind, 'mailing_list');
  const events = (await (await fetch(`${base}/api/events?from=2026-11-01`)).json()).events;
  assert.equal(events.length, 1);
  assert.ok(events[0].sources.some(source => source.id === 'shared'));
});

test('application startup removes club sources while preserving their official-calendar reposts', async t => {
  const store = openStore(':memory:');
  const official = { id: 'office', org: 'University Office', department: 'University Offices', status: 'active', adapter: 'ics', url: 'https://example.edu/calendar' };
  const club = { ...official, id: 'club', org: 'Example Club', department: 'Student Organizations' };
  store.registerPlans([official, club]);
  const common = { start: '2026-12-01', end: '2026-12-02', allDay: true, description: '', summary: '', location: '', timeZone: 'America/New_York', status: 'scheduled', tags: [] };
  store.replaceSource('club', [{ ...common, uid: 'retired', title: 'Retired club activity', url: 'https://example.edu/club' }]);
  store.replaceSource('office', [{ ...common, uid: 'syndicated', title: 'Club workshop', organizer: 'Example Club', url: 'https://example.edu/club-event' },
    { ...common, uid: 'official', title: 'Research seminar', organizer: 'University Office', url: 'https://example.edu/research' }]);
  const refresher = { isRunning: () => false, status: () => store.status(), refresh: async () => ({}) };
  const app = createApplication({ store, plans: [official], refresher, config: { sourceScope: createSourceScope({ blockedSourceIds: ['club'] }) } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await (await fetch(`${base}/api/sources`)).json()).sources.length, 1);
  const results = await (await fetch(`${base}/api/events?from=2026-11-01`)).json();
  assert.equal(results.total, 2);
  assert.deepEqual(results.events.map(event => event.title).sort(), ['Club workshop', 'Research seminar']);
  assert.ok(results.events.every(event => event.sources.every(source => source.id === 'office')));
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM occurrences').get().count, 2);
});
