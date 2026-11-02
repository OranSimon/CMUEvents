import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/lib/store.mjs';
import { createRefresher } from '../src/refresh.mjs';

const plan = { id: 'public-list', adapter: 'html', status: 'active', org: 'Public list', department: 'University',
  url: 'https://www.cmu.edu/engage/events', options: { format: 'alumni', discovery: 'public-dom' } };

test('complete public inventory removes withdrawn cards despite detail403, while incomplete discovery preserves last-good cards', async t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans([plan]);
  const date = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const rows = ['withdrawn', 'current'].map(name => ({ title: `Published ${name} talk`, dateText: date,
    text: `${date} | Pittsburgh, PA`, url: `https://www.givecampus.com/schools/CarnegieMellonUniversity/events/${name}-talk` }));
  let generation = 1;
  let closed = 0;
  const refresher = createRefresher(store, [plan], { concurrency: 1, publicRendering: true, lookBackDays: 30, lookAheadDays: 365 }, {
    createPublicRenderer: () => ({ close: async () => { closed++; }, renderPublic: async request => {
      if (request.kind === 'alumni') return { rows: generation === 1 ? rows : rows.slice(1), pages: 1,
        partial: generation === 3, warnings: generation === 3 ? ['Visible pagination could not finish'] : [] };
      throw Object.assign(new Error('Public original returned HTTP403'), { publicRenderDiagnostic: { httpStatus: 403, title: 'Access unavailable' } });
    } }),
  });
  await refresher.refresh({ force: true });
  const initial = store.db.prepare('SELECT data FROM occurrences').all().map(row => JSON.parse(row.data));
  assert.equal(initial.length, 2);
  generation = 2;
  await refresher.refresh({ force: true });
  assert.equal(store.listSources()[0].eventCount, 1, 'withdrawn future card cannot survive an authoritative complete inventory');
  assert.equal(store.listSources()[0].state, 'error', 'upstream detail limitations remain visible');
  assert.equal(store.listSources()[0].coverage.inspectionComplete, true);
  assert.ok(store.listSources()[0].lastSuccess, 'successful public inventory check has its own current success');
  assert.equal(store.listEvents().events[0].title, 'Published current talk');
  assert.equal(store.listEvents().events[0].timePrecision, 'date', 'inaccessible current originals cannot invent clocks');
  store.replaceSource(plan.id, initial);
  generation = 3;
  await refresher.refresh({ force: true });
  assert.equal(store.listSources()[0].eventCount, 2, 'incomplete discovery cannot authorize deleting an absent card');
  assert.equal(store.listSources()[0].coverage.inspectionComplete, false);
  assert.equal(closed, 3, 'each production-shaped refresh closes its anonymous renderer');
});
