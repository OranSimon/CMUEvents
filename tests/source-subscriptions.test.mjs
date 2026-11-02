import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSourceSubscriptions } from '../src/lib/source-subscriptions.mjs';

const registry = JSON.parse(readFileSync(new URL('../config/source-subscriptions.json', import.meta.url), 'utf8'));
const plans = JSON.parse(readFileSync(new URL('../config/source-plans.json', import.meta.url), 'utf8')).plans;

test('every curated email channel is retained and public-plus-email sources preserve public calendar coverage', () => {
  const subscriptions = createSourceSubscriptions(registry);
  const listed = subscriptions.list(plans);
  assert.equal(listed.length, registry.subscriptions.length);
  assert.equal(listed.filter(source => source.subscription.kind === 'subscriber_only').length, 4);
  for (const id of ['45f983439757', 'caabdfa76cb4']) {
    const source = listed.find(source => source.id === id);
    assert.equal(source.subscription.kind, 'public_plus_email');
    assert.equal(source.subscription.publicCalendarIncluded, true);
    assert.equal(source.subscription.emailEventsIngested, false);
    assert.equal(source.status, plans.find(plan => plan.id === id).status);
  }
  assert.equal(subscriptions.forSource('45f983439757').access.andrewOnly, true);
  assert.equal(subscriptions.forSource('45f983439757').access.emailConfirmation, null);
  assert.equal(subscriptions.forSource('caabdfa76cb4').access.andrewOnly, null, 'guest eligibility is not guessed');
  assert.equal(subscriptions.forSource('caabdfa76cb4').url, 'https://tartanconnect.cmu.edu/Nexus/club_signup');
});

test('public newsletter archives, optional reminders and membership-only pages are not labeled email-restricted', () => {
  const subscriptions = createSourceSubscriptions(registry);
  const ids = ['d462caea15c2', 'b1fe0b546c9f', '44f25df140c0', 'bb2366ae0871', '6d8e99a55dac',
    '5a47a3eb65bf', '74ef2bc806ae', 'c1587a0b2819', '42c864cad300'];
  for (const id of ids) {
    const plan = plans.find(plan => plan.id === id);
    assert.ok(plan, id);
    assert.equal(subscriptions.forSource(id), null);
    assert.equal(subscriptions.attach(plan).subscription, undefined);
  }
  assert.equal(subscriptions.attach({ id: 'unreviewed', org: 'Subscribe to our members-only newsletter', state: 'subscription_only' }).subscription,
    undefined, 'neither keywords nor runtime state create a subscription rule');
});

test('the panel is limited to current source IDs and lookups do not mutate source or registry objects', () => {
  const input = structuredClone(registry);
  const subscriptions = createSourceSubscriptions(input);
  input.subscriptions[0].reason = 'Changed after compilation';
  const id = registry.subscriptions[0].sourceId;
  const metadata = subscriptions.forSource(id);
  metadata.requirements.push('Injected requirement');
  metadata.access.andrewOnly = true;
  assert.deepEqual(subscriptions.forSource(id).requirements, registry.subscriptions[0].requirements);
  assert.equal(subscriptions.forSource(id).access.andrewOnly, null);
  const source = { id, org: 'Original publisher', eventCount: 8, state: 'ok' };
  const attached = subscriptions.attach(source);
  assert.equal(source.subscription, undefined);
  assert.equal(attached.eventCount, 8);
  assert.equal(attached.state, 'ok');
  assert.deepEqual(subscriptions.list([source]).map(item => item.id), [id], 'retired entries are not added back to the panel');
  assert.deepEqual(subscriptions.list([]), []);
  assert.deepEqual(subscriptions.attach({ id: 'other', subscription: { kind: 'subscriber_only' } }), { id: 'other' },
    'stale unreviewed metadata is not trusted');
});

test('invalid curated links, identities and misleading coverage fail registry validation', () => {
  for (const change of [
    row => { row.url = 'javascript:alert(1)'; },
    row => { row.url = 'https://user:password@example.edu/list'; },
    row => { row.sourceId = ''; },
    row => { row.kind = 'membership_only'; },
    row => { row.publicCalendarIncluded = true; },
    row => { row.emailEventsIngested = true; },
    row => { row.access.andrewOnly = 'probably'; },
  ]) {
    const copy = structuredClone(registry);
    change(copy.subscriptions[0]);
    assert.throws(() => createSourceSubscriptions(copy), /Invalid|unique/);
  }
  const duplicate = structuredClone(registry);
  duplicate.subscriptions.push(duplicate.subscriptions[0]);
  assert.throws(() => createSourceSubscriptions(duplicate), /unique/);
});
