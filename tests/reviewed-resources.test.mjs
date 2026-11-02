import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceFingerprint, rawResourceFingerprint, parseReviewedResources, fetchReviewedRawResource } from '../src/adapters/reviewed-resources.mjs';
import { openStore } from '../src/lib/store.mjs';
import { createHash } from 'node:crypto';

const html = '<main><h1>Seminars</h1><p>Monthly talks; dates to be announced.</p><a href="archive.pdf">Previous talks</a></main><footer>2026</footer>';
const plan = { url: 'https://example.edu/seminars', options: { reviewedResources: [{ selector: 'main',
  ...resourceFingerprint(html, 'main'), kind: 'undated series', reason: 'The page gives no individually dated occurrences.' }] } };

test('an unchanged reviewed resource is distinct from a verified empty event calendar', () => {
  const result = parseReviewedResources(html.replace('2026</footer>', '2027</footer>'), plan);
  assert.equal(result.undated, true);
  assert.equal(result.partial, false);
  assert.match(result.warnings.join(' '), /no individually dated/);
});

test('new dates, replacement media and missing content require review', () => {
  for (const changed of [html.replace('dates to be announced', 'October 29, 2026 at 3pm'),
    html.replace('archive.pdf', 'new-schedule.pdf'), html.replace('<main>', '<section>').replace('</main>', '</section>')]) {
    const result = parseReviewedResources(changed, plan);
    assert.equal(result.undated, false);
    assert.equal(result.partial, true);
    assert.match(result.warnings.join(' '), /newly published dated schedule/);
  }
});

test('new structured event metadata cannot hide behind an unchanged resource shell', () => {
  const event = '<script type="application/ld+json">{"@type":"Event","name":"New talk","startDate":"2026-11-10"}</script>';
  for (const changed of [html.replace('</main>', `${event}</main>`), `<head>${event}</head>${html}`]) {
    const result = parseReviewedResources(changed, plan);
    assert.equal(result.partial, true);
    assert.equal(result.undated, false);
  }
});

test('an unchanged publisher date conflict remains a review item', () => {
  const conflicted = { ...plan, options: { reviewedResources: [{ ...plan.options.reviewedResources[0],
    kind: 'conflicting event dates', reason: 'The heading says 2025 while the agenda says 2026.', requiresReview: true }] } };
  const result = parseReviewedResources(html, conflicted);
  assert.equal(result.recognized, 1);
  assert.equal(result.partial, true);
  assert.equal(result.undated, false);
  assert.match(result.warnings.join(' '), /Unresolved conflicting event dates/);
});

test('resource health stays separate from empty calendars and a changed resource retains imported events', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans([{ ...plan, id: 'resource', status: 'active', adapter: 'html' }]);
  store.replaceSource('resource', [], ['No dated schedule published'], undefined, 'undated');
  assert.equal(store.status().sources.undated, 1);
  assert.equal(store.status().sources.empty, 0);
  const occurrence = { uid: 'old', title: 'A previously verified talk', start: '2026-11-01', end: '2026-11-02',
    url: 'https://example.edu/talk', summary: '', description: '', tags: [] };
  store.replaceSource('resource', [occurrence]);
  store.mergePartial('resource', [], ['Resource changed; another review required']);
  assert.equal(store.listSources()[0].state, 'error');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM occurrences').get().n, 1);
});

test('a dynamic directory monitors its published JSON data as well as its static shell', async () => {
  const data = JSON.stringify([{ name: 'Research seminar', day: 'Wednesday', url: 'https://example.edu/series' }]);
  const source = { fetchUrl: 'https://example.edu/public-directory.json', options: { reviewedRawResource: {
    sha256: createHash('sha256').update(data).digest('hex'), kind: 'series directory', reason: 'Weekdays are not occurrence dates.' } } };
  const checked = await fetchReviewedRawResource(source, { fetchText: async () => data });
  assert.equal(checked.undated, true);
  const changed = await fetchReviewedRawResource(source, { fetchText: async () => data.replace('Wednesday', 'October 28, 2026') });
  assert.equal(changed.partial, true);
  assert.equal(changed.undated, undefined);
});

test('a documented transport timestamp can change while new directory rows still trigger review', async () => {
  const data = { success: true, dt: '2026-10-25T20:41:00Z', cols: ['name', 'web-url'], data: [['Seminar', 'https://example.edu/series']] };
  const review = { jsonFields: ['success', 'cols', 'data'], kind: 'series directory', reason: 'No individual occurrence dates are published.' };
  review.sha256 = rawResourceFingerprint(JSON.stringify(data), review);
  const source = { options: { reviewedRawResource: review } };
  const run = value => fetchReviewedRawResource(source, { fetchText: async () => JSON.stringify(value) });
  assert.equal((await run({ ...data, dt: '2026-10-25T21:00:00Z' })).undated, true);
  assert.equal((await run({ ...data, data: [...data.data, ['New talk', 'https://example.edu/2026-11-10']] })).partial, true);
  assert.equal((await run({ success: true, cols: data.cols })).partial, true);
});
