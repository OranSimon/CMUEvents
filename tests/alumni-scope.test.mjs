import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPlans } from '../src/config.mjs';
import { parseAlumniPublicCards } from '../src/adapters/alumni.mjs';
import { openStore } from '../src/lib/store.mjs';

test('the online publisher scope never inherits all in-person cards through calendar aliasing', t => {
  const plans = loadPlans();
  const all = plans.find(plan => plan.id === '8f00fc7f2c7c');
  const online = plans.find(plan => plan.id === '79e7cdffd54d');
  assert.equal(all.status, 'active');
  assert.equal(online.status, 'active');
  assert.equal(all.fetchUrl, online.fetchUrl);
  assert.notEqual(all.options.upstreamScope, online.options.upstreamScope);
  for (const plan of [all, online]) {
    assert.equal(plan.options.discovery, 'public-dom');
    assert.equal(plan.options.reviewedPublicEvents, undefined, 'active configuration contains no fixed card payload');
  }
  const context = { windowStart: '2026-10-25', windowEnd: '2027-10-25' };
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/alumni-public-dom.json', import.meta.url), 'utf8'));
  const listing = { rows: fixture.pages.flat(), partial: false };
  const details = new Map([[fixture.detail.url, fixture.detail]]);
  const allResult = parseAlumniPublicCards(listing, details, all, context);
  const onlineResult = parseAlumniPublicCards(listing, details, online, context);
  const imported = allResult.events;
  const filtered = onlineResult.events;
  assert.equal(imported.length, 23);
  assert.equal(filtered.length, 4);
  assert.ok(filtered.every(event => event.mode === 'online' && imported.some(other => other.uid === event.uid)));
  assert.ok(imported.some(event => event.mode !== 'online' && !filtered.some(other => other.uid === event.uid)));
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans([all, online]);
  store.mergePartial(all.id, imported, allResult.warnings, { singleEventUids: allResult.singleEventUids });
  store.mergePartial(online.id, filtered, onlineResult.warnings, { singleEventUids: onlineResult.singleEventUids });
  assert.equal(store.rebuildEvents([all, online]), 23, 'shared public online cards merge into the same canonical events');
  assert.equal(store.listEvents({ from: context.windowStart, org: all.org }).total, 23);
  const onlineEvents = store.listEvents({ from: context.windowStart, org: online.org });
  assert.equal(onlineEvents.total, 4);
  assert.ok(onlineEvents.events.every(event => event.mode === 'Online'
    && event.sources.some(source => source.id === all.id)
    && event.sources.some(source => source.id === online.id)));
  const allEvents = store.listEvents({ from: context.windowStart, org: all.org });
  assert.ok(allEvents.events.some(event => event.mode !== 'Online'
    && !event.sources.some(source => source.id === online.id)), 'in-person cards never gain online provenance');
});
