import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateSourceCoverage } from '../../src/lib/source-coverage.mjs';

const REPO = 'OranSimon/CMUEvents';
const BASE = 'https://oransimon.github.io/CMUEvents/';
const TIME_ZONE = 'America/New_York';

/**
 * Fetch public evidence with an explicit HTTP success check.
 * @param {string} url Public evidence URL.
 * @return {Promise<string>} Complete response text.
 */
async function readText(url) {
  const response = await fetch(url, { cache: 'no-store' });
  assert.equal(response.status, 200, `Evidence request failed: ${url}`);
  return response.text();
}

/**
 * Hash exact published or source bytes for artifact correspondence.
 * @param {string} text Source bytes decoded as UTF-8.
 * @return {string} SHA-256 digest.
 */
function digest(text) { return createHash('sha256').update(text).digest('hex'); }

/**
 * Format an instant in the product's display timezone.
 * @param {number|string} instant UTC epoch or ISO instant.
 * @return {string} New York ISO calendar day.
 */
function localDay(instant) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Compute independent inclusive display-day bounds, respecting exclusive ends.
 * @param {Object} event Published occurrence.
 * @return {Object} Start/end calendar days and whether the end is still future.
 */
function eventBounds(event) {
  const allDay = event.allDay || /^\d{4}-\d{2}-\d{2}$/.test(event.start);
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  const last = end > start ? end - (allDay && event.endExclusive === false ? 0 : 1) : start;
  return { startDay: allDay ? event.start.slice(0, 10) : localDay(start),
    endDay: allDay ? new Date(last).toISOString().slice(0, 10) : localDay(last) };
}

/**
 * Retrieve every page of a fixed snapshot through the exact deployed query code.
 * @param {Function} query Published queryEventsSnapshot function.
 * @param {Object} snapshot One coherent published event snapshot.
 * @param {Object} filters View and date filters.
 * @param {Object} context Fixed verification day and instant.
 * @return {Object[]} Complete matching occurrences without duplicates.
 */
function collect(query, snapshot, filters, context) {
  const first = query(snapshot, { ...filters, limit: 100, page: 1 }, context);
  const rows = [...first.events];
  for (let page = 2; page <= Math.ceil(first.total / 100); page++) {
    const next = query(snapshot, { ...filters, limit: 100, page }, context);
    assert.equal(next.total, first.total, 'Immutable publication changed within its query contract');
    rows.push(...next.events);
  }
  assert.equal(rows.length, first.total);
  assert.equal(new Set(rows.map(event => event.id)).size, rows.length, 'One view contains repeated IDs');
  return rows;
}

/**
 * Find the immutable state-branch report belonging to this public generation.
 * @param {string} generatedAt Published generation timestamp.
 * @param {number} nonce Cache-busting request identity.
 * @return {Promise<Object>} State commit and matching publication report.
 */
async function stateReport(generatedAt, nonce) {
  const commits = JSON.parse(await readText(`https://api.github.com/repos/${REPO}/commits?sha=codex%2Fcrawl-state&path=report.json&per_page=10&verify=${nonce}`));
  assert.ok(Array.isArray(commits));
  for (const commit of commits) {
    const text = await readText(`https://raw.githubusercontent.com/${REPO}/${commit.sha}/report.json`);
    const report = JSON.parse(text);
    if (report.manifest?.generatedAt === generatedAt) return { ref: commit.sha, sha256: digest(text), report };
  }
  throw new Error(`No matching state report found for ${generatedAt}`);
}

/**
 * Verify the actual deployment, artifact code, event semantics and four views.
 * @param {string[]} args Required --run-id and optional --label.
 * @return {Promise<void>} Completion after saving reproducible evidence.
 */
async function main(args = process.argv.slice(2)) {
  const option = (name, fallback) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
  const runId = option('run-id', '');
  const label = option('label', 'deployed');
  assert.match(runId, /^\d+$/, 'A real workflow run ID is required');
  assert.match(label, /^[a-z0-9-]+$/);
  const run = JSON.parse(await readText(`https://api.github.com/repos/${REPO}/actions/runs/${runId}`));
  const jobs = JSON.parse(await readText(`https://api.github.com/repos/${REPO}/actions/runs/${runId}/jobs`));
  assert.equal(run.conclusion, 'success');
  assert.match(run.head_sha, /^[a-f0-9]{40}$/);
  assert.ok(jobs.jobs?.length >= 2 && jobs.jobs.every(job => job.conclusion === 'success'));
  const nonce = Date.now();
  const files = await Promise.all(['manifest', 'events', 'sources', 'status'].map(async name => {
    const text = await readText(`${BASE}data/${name}.json?event-model-verify=${nonce}`);
    return [name, JSON.parse(text), digest(text)];
  }));
  const docs = Object.fromEntries(files.map(([name, data]) => [name, data]));
  assert.equal(new Set(files.map(([, data]) => data.generatedAt)).size, 1);
  assert.equal(docs.manifest.eventSchema, 2);
  assert.equal(docs.manifest.mode, 'static');
  assert.equal(docs.manifest.eventCount, docs.events.events.length);
  assert.equal(docs.status.totalEvents, docs.events.events.length);
  const plans = JSON.parse(await readFile(new URL('../../config/source-plans.json', import.meta.url), 'utf8')).plans;
  assert.equal(docs.sources.sources.length, plans.length);
  assert.equal(docs.manifest.sourceCount, 318);
  const registry = JSON.parse(await readFile(new URL('../../config/source-subscriptions.json', import.meta.url), 'utf8'));
  const subscriptions = docs.sources.sources.filter(source => source.subscription);
  assert.equal(subscriptions.length, registry.subscriptions.length);
  assert.equal(subscriptions.length, 6);
  assert.ok(subscriptions.every(source => source.subscription.emailEventsIngested === false));
  const scope = JSON.parse(await readFile(new URL('../../config/source-scope.json', import.meta.url), 'utf8'));
  const blocked = new Set(scope.blockedSourceIds);
  assert.ok(docs.sources.sources.every(source => !blocked.has(source.id)));
  assert.ok(docs.events.events.every(event => event.sources?.length && event.sources.every(source => !blocked.has(source.id))));
  const appFiles = await Promise.all(['app.js', 'data-client.js', 'event-semantics.js'].map(async name => {
    const [published, source] = await Promise.all([readText(`${BASE}${name}?event-model-verify=${nonce}`),
      readText(`https://raw.githubusercontent.com/${REPO}/${run.head_sha}/web/${name}`)]);
    assert.equal(digest(published), digest(source), `Published ${name} differs from the exact workflow source`);
    return [name, published, digest(published)];
  }));
  const code = Object.fromEntries(appFiles.map(([name, source]) => [name, source]));
  const semanticsUrl = `data:text/javascript;base64,${Buffer.from(code['event-semantics.js']).toString('base64')}`;
  const clientSource = code['data-client.js'].replaceAll('"./event-semantics.js"', JSON.stringify(semanticsUrl));
  const { calendarEligibility } = await import(semanticsUrl);
  const { queryEventsSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(clientSource).toString('base64')}`);
  assert.ok(!/id=["'](?:next-page|previous-page)["']/.test(await readText(`${BASE}?event-model-verify=${nonce}`)));
  for (const event of docs.events.events) {
    assert.ok(event.id && event.title?.trim() && Number.isFinite(Date.parse(event.start)) && Number.isFinite(Date.parse(event.end)));
    assert.ok(Date.parse(event.end) >= Date.parse(event.start));
    assert.equal(calendarEligibility(event).eligible, true, `Ineligible notice entered the public event artifact: ${event.title}`);
    assert.ok(['scheduled', 'recurring'].includes(event.eventType));
    assert.ok(!['registration-window', 'date-window'].includes(event.scheduleKind));
    if (event.eventType === 'recurring') {
      const recurring = event.recurrence;
      assert.ok(recurring?.seriesId && recurring.source);
      assert.ok(['daily', 'weekly', 'monthly', 'yearly', 'other'].includes(recurring.frequency));
      assert.ok(Number.isSafeInteger(recurring.interval) && recurring.interval >= 1);
    }
    if (event.linkKind === 'calendar-viewer') assert.ok(!/\/calendar\/ical\//i.test(event.url), 'A raw calendar download is not a readable event destination');
  }
  const now = Date.now();
  const today = localDay(now);
  const tomorrow = new Date(`${today}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const context = { today, now, timeZone: TIME_ZONE };
  const views = Object.fromEntries(['today', 'upcoming', 'recurring', 'ongoing'].map(eventView => [eventView,
    collect(queryEventsSnapshot, docs.events, { eventView, from: eventView === 'upcoming' ? tomorrow.toISOString().slice(0, 10) : today,
      ...(['today', 'ongoing'].includes(eventView) ? { to: today } : {}) }, context)]));
  const allIds = Object.values(views).flatMap(rows => rows.map(event => event.id));
  assert.equal(new Set(allIds).size, allIds.length, 'Four browsing views overlap');
  assert.ok(views.today.every(event => event.eventType !== 'recurring' && eventBounds(event).startDay === today));
  assert.ok(views.upcoming.every(event => event.eventType !== 'recurring' && eventBounds(event).startDay > today));
  assert.ok(views.recurring.every(event => event.eventType === 'recurring' && event.recurrence));
  assert.ok(views.ongoing.every(event => {
    const bounds = eventBounds(event);
    return event.eventType !== 'recurring' && bounds.startDay < today && bounds.endDay >= today
      && (event.allDay || Date.parse(event.end) > now);
  }));
  const futureOverlap = collect(queryEventsSnapshot, docs.events, { from: today }, context).filter(event =>
    event.eventType === 'recurring' || eventBounds(event).startDay >= today || event.allDay || Date.parse(event.end) > now);
  const assigned = new Set(allIds);
  const missing = futureOverlap.filter(event => !assigned.has(event.id));
  assert.equal(missing.length, 0, `Future-overlap activities are missing from all four views: ${JSON.stringify(missing.map(event => ({ title: event.title, start: event.start, end: event.end, kind: event.scheduleKind })))}`);
  assert.equal(assigned.size, futureOverlap.length);
  const template = docs.events.events.filter(event => event.recurrence?.frequency === 'daily'
    && /INTRA_CREATE/i.test(event.title) && !event.description?.trim() && !event.location?.trim() && !event.recurrence.hasOriginalUrl);
  assert.equal(template.length, 0, 'The old low-information daily template returned');
  const ids = JSON.parse(await readFile(new URL('../../config/coverage-validation.json', import.meta.url), 'utf8')).sourceIds;
  const coverage = validateSourceCoverage(docs.sources.sources, ids, docs.status.lastRefresh.startedAt, docs.status.lastRefresh.completedAt);
  assert.equal(coverage.passed, true);
  const state = await stateReport(docs.manifest.generatedAt, nonce);
  const exclusions = state.report.eventExclusions;
  assert.ok(Array.isArray(exclusions?.records));
  const reasonCounts = {};
  exclusions.records.forEach(row => { reasonCounts[row.code] = (reasonCounts[row.code] || 0) + 1; });
  const report = { checkedAt: new Date().toISOString(), fixedNow: { instant: new Date(now).toISOString(), today, timeZone: TIME_ZONE },
    runId, runUrl: run.html_url, execution: { headSha: run.head_sha, event: run.event, startedAt: run.run_started_at,
      jobs: jobs.jobs.map(job => ({ id: job.id, name: job.name, startedAt: job.started_at, completedAt: job.completed_at,
        elapsedSeconds: (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000, conclusion: job.conclusion })) },
    manifest: docs.manifest, refresh: docs.status.lastRefresh, sourceStates: docs.status.sources, subscriptionChannels: subscriptions.length,
    viewCounts: Object.fromEntries(Object.entries(views).map(([name, rows]) => [name, rows.length])),
    recurringByFrequency: Object.fromEntries(['daily', 'weekly', 'monthly', 'yearly', 'other'].map(frequency => [frequency, views.recurring.filter(event => event.recurrence.frequency === frequency).length])),
    partition: { mutuallyExclusive: true, completeFutureOverlap: true, futureOverlapCount: futureOverlap.length, missing: 0 },
    ongoingPeriods: views.ongoing.map(({ id, title, start, end, scheduleKind, dateEvidence, sources, url }) => ({ id, title, start, end,
      scheduleKind, dateEvidence, url, sourceIds: sources.map(source => source.id), note: 'Published period, not a guarantee the venue is open at verification time' })),
    templateRegression: { lowInformationDailyIntraCount: template.length, originalExpandedPhantomCount: 395 },
    exclusions: { matchingReportRef: state.ref, matchingReportSha256: state.sha256, count: exclusions.count, reasonCounts, records: exclusions.records,
      parserWarnings: docs.sources.sources.flatMap(source => (source.warnings || []).filter(warning => /Excluded stale low-information|Ignored schedule placeholder/.test(warning)).map(warning => ({ sourceId: source.id, warning }))) },
    coverage, fileHashes: Object.fromEntries(files.map(([name, , hash]) => [name, hash])),
    applicationHashes: Object.fromEntries(appFiles.map(([name, , hash]) => [name, hash])) };
  await writeFile(new URL(`./${label}-deployment.json`, import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ generatedAt: report.manifest.generatedAt, eventSchema: 2, events: report.manifest.eventCount,
    sources: report.manifest.sourceCount, subscriptionChannels: subscriptions.length, views: report.viewCounts,
    partition: report.partition, excludedNotices: exclusions.count, coveragePassed: coverage.passedSources }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
