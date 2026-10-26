import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchEvents } from '../src/adapters/index.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/alumni-public-dom.json', import.meta.url), 'utf8'));
const plans = [
  { id: 'alumni-all', adapter: 'html', status: 'active', url: 'https://www.cmu.edu/engage/events',
    options: { format: 'alumni', discovery: 'public-dom', timezone: 'America/New_York' } },
  { id: 'alumni-online', adapter: 'html', status: 'active', url: 'https://www.cmu.edu/engage/online-events',
    options: { format: 'alumni', discovery: 'public-dom', timezone: 'America/New_York', onlineOnly: true } },
];

test('adapter index preserves one collection identity across Alumni scope wrappers and expires all shared renders on the next run', async () => {
  const listing = { rows: fixture.pages.flat(), pages: fixture.pages.length, partial: false };
  const deniedUrl = listing.rows.find(row => /\|\s*VIRTUAL WEBINAR,\s*ONLINE\b/i.test(row.text)).url;
  const calls = new Map();
  let runNumber = 1;
  const renderPublic = async request => {
    const key = `${request.kind}:${request.url}`;
    calls.set(key, (calls.get(key) || 0) + 1);
    if (request.kind === 'alumni') return listing;
    if (runNumber === 1 && request.url === deniedUrl) {
      throw Object.assign(new Error('The current original returned HTTP403'), {
        publicRenderDiagnostic: { httpStatus: 403, title: 'Access unavailable' },
      });
    }
    const row = listing.rows.find(row => row.url === request.url);
    assert.ok(row, 'the real index can request only currently advertised originals');
    return { title: row.title, detailText: `Event Details\n${row.dateText} 8:00AM - 9:00AM EDT\nPublished venue`, description: 'Current public details' };
  };
  const currentContext = { sourcePlans: plans, renderPublic,
    fetchText: async () => { throw new Error('The public DOM flow must not fetch broad hidden APIs'); } };
  const [all, online] = await Promise.all(plans.map(plan => fetchEvents(plan, currentContext)));
  assert.equal(all.events.length, 23);
  assert.equal(online.events.length, 4);
  assert.equal(all.coverage.inspectedDetails.length, 23);
  assert.equal(online.coverage.inspectedDetails.length, 4);
  assert.equal(all.coverage.inspectionComplete, true);
  assert.equal(online.coverage.inspectionComplete, true);
  assert.deepEqual(all.coverage.internalIssues, []);
  assert.deepEqual(online.coverage.internalIssues, []);
  assert.equal(all.coverage.externalIssues.length, 1);
  assert.equal(online.coverage.externalIssues.length, 1);
  assert.equal(all.coverage.externalIssues[0].url, deniedUrl);
  assert.equal(online.coverage.externalIssues[0].diagnostic.httpStatus, 403);
  assert.equal(calls.size, 24, 'distinct scope wrappers render one listing and23 originals total');
  assert.ok([...calls.values()].every(count => count === 1), 'successful and rejected shared promises must survive index wrappers');
  assert.strictEqual(await fetchEvents(plans[0], currentContext), all, 'one source result is reused within the same index run');
  assert.ok([...calls.values()].every(count => count === 1));

  runNumber = 2;
  const nextContext = { ...currentContext };
  const [nextAll, nextOnline] = await Promise.all(plans.map(plan => fetchEvents(plan, nextContext)));
  assert.equal(nextAll.events.filter(event => event.timePrecision === 'time').length, 23);
  assert.equal(nextOnline.events.filter(event => event.timePrecision === 'time').length, 4);
  assert.deepEqual(nextAll.coverage.externalIssues, []);
  assert.deepEqual(nextOnline.coverage.externalIssues, []);
  assert.equal(nextAll.coverage.inspectionComplete, true);
  assert.equal(nextOnline.coverage.inspectionComplete, true);
  assert.ok([...calls.values()].every(count => count === 2), 'new refresh objects retry all originals, including the previous rejected promise');
});
