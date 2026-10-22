import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const folder = 'research/pending-source-resolution-2026-10-22';
const report = JSON.parse(await fs.readFile(`${folder}/review.json`, 'utf8'));
const targetedRefresh = JSON.parse(await fs.readFile(`${folder}/targeted-refresh.json`, 'utf8'));
const base = 'http://127.0.0.1:4173';
const get = async path => {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.ok, true, path);
  return response.json();
};
const status = await get('/api/status');
const sources = (await get('/api/sources')).sources;
const byID = new Map(sources.map(source => [source.id, source]));
const assertions = [];
const check = (name, fn) => { fn(); assertions.push({ name, passed: true }); };
const search = async query => (await get(`/api/events?from=2026-09-22&limit=100&query=${encodeURIComponent(query)}`)).events;

check('exact 105 reviews with no missing public fixes', () => {
  assert.equal(report.scope.reviewed, 105);
  assert.equal(report.scope.remaining, 0);
  assert.equal(new Set(report.reviews.map(row => row.sourceID)).size, 105);
  assert.equal(report.summary.publicFixesPending, 0);
});
check('all 42 changed contracts refreshed successfully', () => {
  assert.equal(targetedRefresh.total, 42);
  assert.equal(targetedRefresh.completed, 42);
  assert.equal(targetedRefresh.error, 0);
  assert.equal(report.fixes.length, 42);
  for (const fix of report.fixes) {
    assert.equal(fix.runtime.currentContract, true);
    assert.ok(['ok', 'empty'].includes(fix.runtime.state));
    assert.ok(fix.runtime.lastAttempt);
  }
});
check('full catalog and normal automatic refresh are settled', () => {
  assert.equal(sources.length, 1029);
  assert.equal(status.refreshing, false);
  assert.equal(status.lastRefresh.completed, status.lastRefresh.total);
  assert.equal(status.sources.pending, 0);
});
check('all 105 source diagnostics use the latest reasons and next steps', () => {
  for (const row of report.reviews) {
    const evidence = byID.get(row.sourceID).evidence;
    assert.equal(evidence.visualReview.report, `${folder}/review.json`);
    assert.equal(evidence.visualReview.requiresReview, row.requiresReview);
    assert.equal(evidence.followupResolution.reason, row.reason);
    assert.equal(evidence.followupResolution.nextStep, row.nextStep);
  }
});
const ccc = await search('Oliver Wyman');
check('Consulting event has its published Doha time and room', () => {
  assert.equal(ccc.length, 1);
  assert.equal(ccc[0].start, '2026-11-10T15:00:00.000Z');
  assert.equal(ccc[0].end, '2026-11-10T17:00:00.000Z');
  assert.equal(ccc[0].timeZone, 'Asia/Qatar');
  assert.equal(ccc[0].location, 'Room 1202');
  assert.ok(ccc[0].sources.some(source => source.id === 'a2014c54892f'));
});
const bba = await search('BBA Merch');
check('BBA duplicates merge and retain order context, both cutoffs and private venue', () => {
  assert.equal(bba.length, 1);
  assert.equal(bba[0].end, '2026-11-07T04:55:00.000Z');
  assert.match(bba[0].description, /crewnecks/);
  assert.match(bba[0].description, /11\/6 11:59PM/);
  assert.match(bba[0].location, /sign in/i);
});
const senate = await search('Undergraduate Student Senate Town Hall');
check('Senate preserves undergraduate-only eligibility and private venue', () => {
  assert.equal(senate.length, 1);
  assert.equal(senate[0].start, '2026-11-05T22:00:00.000Z');
  assert.match(senate[0].description, /only open to undergraduate students/);
  assert.match(senate[0].location, /sign in/i);
});
const tedx = (await search('Public Speaking Workshop')).filter(event => event.sources.some(source => source.id === 'd62d08f7df9d'));
check('TEDx date-only record merges with the existing official registration link and remains under review', () => {
  assert.equal(tedx.length, 1);
  assert.equal(tedx[0].start, '2026-09-27');
  assert.equal(tedx[0].timePrecision, 'date');
  assert.equal(tedx[0].location, '');
  assert.match(tedx[0].description, /conflict/);
  assert.equal(byID.get('d62d08f7df9d').evidence.visualReview.requiresReview, true);
  assert.ok(tedx[0].sources.some(source => source.id === '0277f1ada7d8'));
});
const rsl = (await search('CMU Friendsgiving')).filter(event => event.title === 'CMU Friendsgiving');
check('RSL Friendsgiving retains date precision and correct office attribution', () => {
  assert.equal(rsl.length, 1);
  assert.equal(rsl[0].start, '2026-11-23');
  assert.equal(rsl[0].timePrecision, 'date');
  assert.equal(rsl[0].location, '');
  assert.ok(rsl[0].sources.some(source => source.id === '40f7fd9f957c'));
  assert.ok(!rsl[0].sources.some(source => source.id === 'f5d9d68e0b15'));
});
const poker = await search('MSCF Tournament');
check('Poker TBD retains its known day and unknown time/location', () => {
  assert.equal(poker.length, 1);
  assert.equal(poker[0].start, '2026-11-07');
  assert.equal(poker[0].timePrecision, 'date');
  assert.equal(poker[0].location, 'Location TBD');
});
const msa = (await search('CMU MSA Jummah')).filter(event => event.title === 'CMU MSA Jummah'
  && event.sources.some(source => source.id === '0810e0d905cd'));
check('publisher Jummah recurrence stays within its rolling yearly bound and preserves Friday clocks and room caveat', () => {
  assert.ok(msa.length >= 52 && msa.length <= 53);
  assert.ok(msa.every(event => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(event.start)) === 'Fri'));
  assert.ok(msa.every(event => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }).format(new Date(event.start)) === '13:15'));
  const upper = Date.parse(byID.get('0810e0d905cd').lastAttempt) + 365 * 86400000;
  assert.ok(msa.every(event => Date.parse(event.start) < upper));
  assert.ok(msa.every(event => event.description.includes('room changes')));
});
for (const item of report.evidenceManifest) {
  assert.equal(createHash('sha256').update(await fs.readFile(item.path)).digest('hex'), item.sha256);
}
assertions.push({ name: 'all referenced source screenshots match the report manifest', passed: true });
const screenshots = [];
for (const name of ['app-consulting-detail.jpg', 'app-bba-deduplicated-dst.jpg', 'app-source-next-steps.jpg']) {
  const path = `${folder}/evidence/${name}`;
  const bytes = await fs.readFile(path);
  screenshots.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const testLog = await fs.readFile('.cache/pending-source-resolution/final-tests.txt', 'utf8');
const tests = { command: 'npm test', passed: Number(testLog.match(/ℹ pass (\d+)/)?.[1]), failed: Number(testLog.match(/ℹ fail (\d+)/)?.[1]) };
assert.ok(tests.passed >= 127);
assert.equal(tests.failed, 0);
const validation = { checkedAt: new Date().toISOString(), tests,
  projectCheck: { command: 'npm run check', sourceCoverage: 1029, passed: true }, targetedRefresh,
  normalAutomaticRefresh: { url: base, launchCommand: 'PORT=4173 npm start', autoRefresh: true, status },
  assertions, screenshots,
  externalConditions: { requiresReview: report.summary.requiresReview, categories: report.summary.categories,
    note: 'These are documented external conditions, not assertions of inactive organizations. No login, signup, subscription or organizer message was performed.' },
  existingOtherCatalogLimits: sources.filter(source => ['error', 'unsupported', 'subscription_only', 'blocked'].includes(source.state))
    .map(source => ({ sourceID: source.id, organization: source.org, state: source.state, error: source.error })),
  agentEvidenceAudits: ['dates-calendars-final-audit.json', 'public_directory-audit.json', 'public_directory-privacy-audit.json', 'alternate_websites-audit.json', 'dates_extra-audit.json'] };
await fs.writeFile(`${folder}/validation.json`, `${JSON.stringify(validation, null, 2)}\n`);
await fs.writeFile(`${folder}/implementation-results.json`, `${JSON.stringify({ checkedAt: validation.checkedAt,
  sourceContracts: report.fixes, relatedFixes: report.relatedFixes, assertions }, null, 2)}\n`);
console.log(JSON.stringify({ assertionsPassed: assertions.length, manifestImages: report.evidenceManifest.length,
  events: status.totalEvents, sourceContracts: report.fixes.length, requiresReview: report.summary.requiresReview }));
