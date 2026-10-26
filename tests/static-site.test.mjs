import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/lib/store.mjs';
import { normalizeEvent } from '../src/lib/normalize.mjs';
import { createSourceSubscriptions } from '../src/lib/source-subscriptions.mjs';
import { validatePublication, publicSource, buildStaticSite } from '../src/lib/static-site.mjs';

const refresh = { total: 10, completed: 10, ok: 8, empty: 1, undated: 0, error: 1, completedAt: '2026-10-25T12:00:00Z' };
const example = { id: 'a', title: 'Talk', start: '2027-01-01', sources: [{ id: 'official' }] };

test('publication guards block incomplete, broad-failure, empty and unexplained destructive snapshots', () => {
  const input = { events: [example], sources: [{ id: 'official' }], expectedSources: 1, refresh };
  assert.equal(validatePublication(input).successRatio, 0.9);
  assert.throws(() => validatePublication({ ...input, events: [] }), /no current public/);
  assert.throws(() => validatePublication({ ...input, sources: [] }), /incomplete/);
  assert.throws(() => validatePublication({ ...input, refresh: { ...refresh, completed: 9 } }), /complete source refresh/);
  assert.throws(() => validatePublication({ ...input, expectedRefreshSources: 11 }), /every scheduled source/);
  assert.throws(() => validatePublication({ ...input, refresh: { ...refresh, ok: 0, empty: 0 } }), /successfully/);
  assert.throws(() => validatePublication({ ...input, previousEventCount: 10 }), /fell from 10 to 1/);
  assert.equal(validatePublication({ ...input, previousEventCount: 10, allowEventDrop: true }).allowEventDrop, true);
  assert.throws(() => validatePublication({ ...input, events: [{ ...example, sources: [] }] }), /invalid public/);
});

test('public source documents omit parser payloads and retain coverage and email boundaries', () => {
  const source = publicSource({ id: 's', url: 'https://example.edu', kind: 'event_listing', state: 'error', eventCount: 3,
    options: { secret: 'never publish parser options' }, fetchUrl: 'https://example.edu/internal',
    evidence: { rawPayload: 'not a public directory field', visualReview: { note: 'Public check' } },
    subscription: { emailEventsIngested: false, publicCalendarIncluded: true } });
  assert.equal(source.options, undefined);
  assert.equal(source.fetchUrl, undefined);
  assert.equal(source.evidence.rawPayload, undefined);
  assert.equal(source.eventCount, 3);
  assert.equal(source.subscription.publicCalendarIncluded, true);
});

test('static artifact has one generation, public events, relative frontend assets and a source-only directory', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cmuevents-pages-'));
  const store = openStore(':memory:');
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const plan = { id: 'official', org: 'Office', department: 'University', status: 'active', kind: 'ical_feed',
    adapter: 'ics', url: 'https://example.edu/calendar', fetchUrl: 'https://example.edu/public.ics', options: { privateParserConfiguration: true } };
  store.registerPlans([plan]);
  store.replaceSource(plan.id, [normalizeEvent({ title: 'Public talk', start: '2027-01-01' }, plan)]);
  store.rebuildEvents([plan]);
  store.setMeta('lastRefresh', { ...refresh, total: 1, completed: 1, ok: 1, empty: 0, error: 0 });
  store.setMeta('lastUpdated', '2026-10-25T12:00:00Z');
  await mkdir(path.join(root, 'web'));
  await writeFile(path.join(root, 'web/index.html'), '<!doctype html><html data-mode="api"><head><script type="module" src="./app.js"></script></head><body></body></html>');
  await writeFile(path.join(root, 'web/app.js'), 'export const mode = "static";');
  await writeFile(path.join(root, 'LICENSE'), 'AGPL-3.0-only');
  const generatedAt = '2026-10-25T13:00:00.000Z';
  const output = path.join(root, 'dist');
  const result = await buildStaticSite({ store, plans: [plan], subscriptions: createSourceSubscriptions(),
    webRoot: path.join(root, 'web'), output, licensePath: path.join(root, 'LICENSE'), generatedAt });
  assert.equal(result.manifest.eventCount, 1);
  for (const file of ['manifest', 'events', 'sources', 'status']) {
    const data = JSON.parse(await readFile(path.join(output, 'data', `${file}.json`), 'utf8'));
    assert.equal(data.generatedAt, generatedAt);
  }
  const html = await readFile(path.join(output, 'index.html'), 'utf8');
  assert.match(html, /data-mode="static"/);
  assert.match(html, /Content-Security-Policy/);
  const directory = await readFile(path.join(output, 'data/sources.json'), 'utf8');
  assert.ok(!directory.includes('privateParserConfiguration'));
  const status = JSON.parse(await readFile(path.join(output, 'data/status.json'), 'utf8'));
  assert.equal(status.lastSuccessfulUpdate, '2026-10-25T12:00:00Z', 'packaging does not reset the real data freshness clock');
  store.setMeta('lastRefresh', { ...refresh, total: 1, completed: 1, ok: 0, empty: 0, error: 1 });
  await assert.rejects(() => buildStaticSite({ store, plans: [plan], subscriptions: createSourceSubscriptions(),
    webRoot: path.join(root, 'web'), output, licensePath: path.join(root, 'LICENSE') }), /Publication blocked/);
  assert.equal(JSON.parse(await readFile(path.join(output, 'data/manifest.json'), 'utf8')).generatedAt, generatedAt,
    'failed validation preserves the last artifact');
});
