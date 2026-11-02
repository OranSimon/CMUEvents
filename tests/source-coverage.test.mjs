import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCoverage, validateSourceCoverage } from '../src/lib/source-coverage.mjs';
import { openStore } from '../src/lib/store.mjs';
import { exportCrawlState, restoreCrawlState } from '../src/lib/crawl-state.mjs';
import { publicSource } from '../src/lib/static-site.mjs';

const checkedAt = '2026-10-26T12:00:00Z';
const audit = { version: 1, kind: 'complete-discovery', inspectionComplete: true,
  internalIssues: [], externalIssues: [], nonBlockingIssues: [] };
const plan = { id: 'publisher', adapter: 'html', status: 'active', org: 'Publisher', url: 'https://example.edu/events',
  fetchUrl: 'https://example.edu/events', options: {} };

test('coverage gates distinguish current upstream limitations, our omissions and stale successful evidence', () => {
  const source = { ...plan, state: 'empty', coverage: normalizeCoverage(audit, checkedAt) };
  const validate = value => validateSourceCoverage([value], [plan.id], checkedAt, checkedAt);
  assert.equal(validate(source).passed, true);
  assert.equal(validate({ ...source, state: 'error', error: 'Partial details', coverage: { ...source.coverage,
    externalIssues: [{ code: 'HTTP_403' }] } }).passed, true);
  assert.equal(validate({ ...source, coverage: { ...source.coverage, internalIssues: [{ code: 'UNSCANNED' }] } }).passed, false);
  assert.equal(validate({ ...source, coverage: { ...source.coverage, inspectionComplete: false } }).passed, false);
  assert.equal(validate({ ...source, state: 'error', error: 'An OCR name notice', coverage: { ...source.coverage,
    nonBlockingIssues: [{ code: 'SPEAKER_CONFIDENCE' }] } }).passed, false);
  assert.equal(validate({ ...source, coverage: { ...source.coverage, checkedAt: '2026-10-25T12:00:00Z' } }).passed, false);
  assert.equal(validate({ ...source, coverage: { ...source.coverage, checkedAt: '2030-01-01T00:00:00Z' } }).passed, false);
  assert.equal(validateSourceCoverage([], [plan.id], checkedAt, checkedAt).passed, false);
  for (const ids of [[], null, ['publisher', 'publisher'], [1]]) assert.throws(() => validateSourceCoverage([], ids, checkedAt, checkedAt));
});

test('coverage contract is detached and rejects malformed or unbounded evidence', () => {
  const copied = normalizeCoverage(audit, checkedAt);
  copied.internalIssues.push('changed copy');
  assert.equal(audit.internalIssues.length, 0);
  assert.equal(normalizeCoverage(null), null);
  assert.throws(() => normalizeCoverage(Object.assign([], audit), checkedAt));
  for (const patch of [{ version: 2 }, { kind: '' }, { inspectionComplete: 1 }, { internalIssues: null }, { count: NaN }, { unsafe: () => {} }, { toJSON: () => [] }, { nested: new Date() }, { text: 'x'.repeat(2 * 1024 * 1024) }]) {
    assert.throws(() => normalizeCoverage({ ...audit, ...patch }, checkedAt));
  }
});

test('coverage survives compatible daily restore and public export, then invalidates with extraction changes', t => {
  const original = openStore(':memory:');
  const restored = openStore(':memory:');
  t.after(() => { original.close(); restored.close(); });
  original.registerPlans([plan]);
  original.setMeta(`sourceCoverage:${plan.id}`, normalizeCoverage(audit, checkedAt));
  original.replaceSource(plan.id, [], [], checkedAt);
  const saved = exportCrawlState(original);
  restored.registerPlans([plan]);
  restoreCrawlState(restored, [plan], saved);
  assert.deepEqual(publicSource(restored.listSources()[0]).coverage, saved.sources[0].coverage);
  const malformed = structuredClone(saved);
  malformed.sources[0].coverage.internalIssues = null;
  assert.throws(() => restoreCrawlState(restored, [plan], malformed), /coverage contract/);
  const changed = { ...plan, options: { layout: 'new' } };
  restored.registerPlans([changed]);
  assert.equal(restored.listSources()[0].coverage, null);
  assert.deepEqual(restoreCrawlState(restored, [changed], saved).invalidated, [plan.id]);
  assert.equal(restored.listSources()[0].coverage, null);
});

test('coordinator persists current endpoint failure audits while retaining last-good records', async t => {
  const { createRefresher } = await import('../src/refresh.mjs');
  const store = openStore(':memory:');
  const originalFetch = globalThis.fetch;
  let requests = 0;
  t.after(() => { globalThis.fetch = originalFetch; store.close(); });
  globalThis.fetch = async () => { requests++; return new Response('Service unavailable', { status: 503 }); };
  const source = { ...plan, url: 'https://8.8.8.8/events', fetchUrl: 'https://8.8.8.8/events' };
  store.registerPlans([source]);
  const refresher = createRefresher(store, [source], { concurrency: 1, lookBackDays: 30, lookAheadDays: 365 });
  const refresh = await refresher.refresh({ force: true });
  const result = store.listSources()[0];
  assert.equal(requests, 2, 'the real fetcher performs its bounded upstream retry');
  assert.equal(result.state, 'error');
  assert.equal(result.coverage.inspectionComplete, true);
  assert.equal(result.coverage.internalIssues.length, 0);
  assert.equal(result.coverage.externalIssues.length, 1);
  assert.equal(validateSourceCoverage([result], [source.id], refresh.startedAt, refresh.completedAt).passed, true);
});
