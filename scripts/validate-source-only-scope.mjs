import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readConfig, loadPlans } from '../src/config.mjs';
import { openStore } from '../src/lib/store.mjs';
import { sourceAllowed } from '../src/lib/source-scope.mjs';

const folder = 'research/club-source-removal-2026-10-25';
const read = async name => JSON.parse(await fs.readFile(`${folder}/${name}`, 'utf8'));
const classification = await read('classification.json');
const access = await read('access-probes.json');
const http = await read('http-probes.json');
const refresh = await read('retained-refresh.json');
const reposts = (await read('official-reposts-to-verify.json')).events;
const catalog = JSON.parse(await fs.readFile('data/event_sources.json', 'utf8'));
const policy = JSON.parse(await fs.readFile('config/source-scope.json', 'utf8'));
const config = readConfig();
const plans = loadPlans();
const store = openStore(config.databasePath);
const sources = store.listSources();
const byID = new Map(sources.map(source => [source.id, source]));
const removed = new Set(classification.excluded.map(source => source.sourceID));
const retained = new Set(classification.retained.map(source => source.sourceID));
const assertions = [];
const check = (name, fn) => { fn(); assertions.push({ name, passed: true }); };
const base = 'http://127.0.0.1:4173';
const get = async path => {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.ok, true, path);
  return response.json();
};
const status = await get('/api/status');
const apiSources = (await get('/api/sources')).sources;
check('exact source-only partition and publishing policy', () => {
  assert.equal(removed.size, 711);
  assert.equal(retained.size, 318);
  assert.equal(removed.size + retained.size, 1029);
  assert.equal(catalog.length, 318);
  assert.equal(plans.length, 318);
  assert.equal(policy.mode, 'source-only');
  assert.equal(policy.officialRepostsRetained, true);
  assert.ok(plans.every(plan => retained.has(plan.id) && !removed.has(plan.id) && sourceAllowed(plan, config.sourceScope)));
});
const csv = (await fs.readFile('data/event_sources.csv', 'utf8')).replace(/^\uFEFF/, '');
const csvRows = [];
let row = [], field = '', quoted = false;
for (let index = 0; index < csv.length; index++) {
  const char = csv[index];
  if (char === '"') {
    if (quoted && csv[index + 1] === '"') { field += '"'; index++; }
    else quoted = !quoted;
  } else if (!quoted && (char === ',' || char === '\n')) {
    row.push(field); field = '';
    if (char === '\n') { csvRows.push(row); row = []; }
  } else if (char !== '\r' || quoted) field += char;
}
check('JSON and CSV active catalogs agree exactly', () => {
  assert.equal(csvRows.length, catalog.length + 1);
  assert.deepEqual(csvRows[0], ['Department', 'Org', 'link']);
  for (let index = 0; index < catalog.length; index++) assert.deepEqual(csvRows[index + 1],
    [catalog[index].Department, catalog[index].Org, catalog[index].link]);
});
check('runtime registry and API contain retained sources only', () => {
  assert.equal(sources.length, 318);
  assert.equal(apiSources.length, 318);
  assert.ok(sources.every(source => retained.has(source.id) && !removed.has(source.id)));
  assert.ok(apiSources.every(source => retained.has(source.id) && !removed.has(source.id)));
  assert.equal(store.db.prepare(`SELECT COUNT(*) AS count FROM occurrences WHERE source_id NOT IN (${sources.map(() => '?').join(',')})`).get(...sources.map(source => source.id)).count, 0);
});
check('all eligible retained sources were freshly checked', () => {
  assert.equal(refresh.total, 261);
  assert.equal(refresh.completed, 261);
  assert.equal(refresh.error, 4);
  assert.equal(status.refreshing, false);
  assert.equal(status.sources.pending, 0);
  assert.ok(!('excludedClubOccurrences' in status.lastRefresh));
});
const first = await get('/api/events?from=2000-01-01&limit=100&page=1');
const events = [...first.events];
for (let start = 2; start <= Math.ceil(first.total / 100); start += 6) {
  const pages = await Promise.all(Array.from({ length: Math.min(6, Math.ceil(first.total / 100) - start + 1) }, (_, offset) =>
    get(`/api/events?from=2000-01-01&limit=100&page=${start + offset}`)));
  events.push(...pages.flatMap(page => page.events));
}
check('every public event and facet uses retained publisher provenance', () => {
  assert.equal(events.length, first.total);
  assert.equal(new Set(events.map(event => event.id)).size, first.total);
  assert.equal(first.total, status.totalEvents);
  assert.ok(events.every(event => event.sources.length > 0 && event.sources.every(source => retained.has(source.id) && !removed.has(source.id))));
  const organizations = new Set(sources.map(source => source.org));
  assert.ok(first.facets.orgs.every(item => organizations.has(item.value)));
});
const raw = store.db.prepare('SELECT source_id,data FROM occurrences').all().map(row => ({ sourceID: row.source_id, event: JSON.parse(row.data) }));
const restoration = reposts.map(expected => ({ title: expected.title, uid: expected.uid,
  rawMatches: raw.filter(row => expected.sourceIDs.includes(row.sourceID) && row.event.uid === expected.uid && row.event.start === expected.start).length,
  apiMatches: events.filter(event => event.start === expected.start && event.title === expected.title
    && event.sources.some(source => expected.sourceIDs.includes(source.id))).length }));
check('officially republished club-hosted events remain in both storage and API', () => {
  assert.equal(restoration.length, 12);
  assert.ok(restoration.every(item => item.rawMatches > 0 && item.apiMatches > 0));
  const kickoff = events.find(event => event.title === 'Hack-A-Startup: Kick-Off Weekend');
  assert.match(kickoff.description, /Graduate Entrepreneurship Club/);
  assert.ok(kickoff.sources.some(source => source.org === 'SCS Events Calendar'));
});
check('access findings are persisted without presenting authentication pages as readable content', () => {
  assert.equal(access.observations.length, 32);
  for (const observation of access.observations) {
    assert.equal(byID.get(observation.sourceID).evidence.accessReview.reason, observation.reason);
    assert.equal(apiSources.find(source => source.id === observation.sourceID).evidence.accessReview.status, observation.status);
  }
  assert.equal(access.observations.filter(row => row.status === 'subscription_and_archive_authentication_required').length, 4);
});
check('transport audit covers every retained source and configured endpoint', () => {
  assert.equal(http.scope.sourceCount, 318);
  assert.equal(http.scope.checkedURLs, 491);
  assert.equal(http.results.length, 491);
  assert.ok(http.results.every(item => item.sources.every(source => retained.has(source.sourceID))));
});
store.close();
const evidenceManifest = [];
for (const item of access.evidenceManifest || []) {
  const path = item.path.startsWith('evidence/') ? `${folder}/${item.path}` : item.path;
  const bytes = await fs.readFile(path);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (item.sha256) assert.equal(hash, item.sha256);
  evidenceManifest.push({ path, bytes: bytes.length, sha256: hash });
}
const path = `${folder}/evidence/app-official-reposts-retained.jpg`;
const screenshot = await fs.readFile(path);
evidenceManifest.push({ path, bytes: screenshot.length, sha256: createHash('sha256').update(screenshot).digest('hex') });
const testLog = await fs.readFile('.cache/club-source-removal-2026-10-25/tests.txt', 'utf8');
const tests = { passed: Number(testLog.match(/ℹ pass (\d+)/)?.[1]), failed: Number(testLog.match(/ℹ fail (\d+)/)?.[1]) };
assert.ok(tests.passed >= 139);
assert.equal(tests.failed, 0);
const validation = { checkedAt: new Date().toISOString(), policy: { mode: 'source-only', officialRepostsRetained: true },
  scope: { excludedSources: 711, retainedSources: 318 }, tests, projectCheck: 'npm run check', assertions,
  allAPIEventsInspected: events.length, officialRepostRestoration: restoration, retainedRefresh: refresh,
  transportChecks: http.summary, normalApplication: { url: base, autoRefresh: true, status }, evidenceManifest };
await fs.writeFile(`${folder}/validation.json`, `${JSON.stringify(validation, null, 2)}\n`);
console.log(JSON.stringify({ assertions: assertions.length, sources: sources.length, events: events.length,
  officialRepostIdentities: restoration.length, evidenceImages: evidenceManifest.length, tests }));
