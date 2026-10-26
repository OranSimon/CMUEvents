import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateSourceCoverage } from '../../src/lib/source-coverage.mjs';

const REPO = 'OranSimon/CMUEvents';
const BASE = 'https://oransimon.github.io/CMUEvents/';
const ZONE = 'America/New_York';
const digest = text => createHash('sha256').update(text).digest('hex');
const words = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const provenanceKey = source => JSON.stringify([source.id, source.url, source.eventUrl]);

/** Read successful public evidence without reusing a local production database. */
async function readText(url) {
  const response = await fetch(url, { cache: 'no-store' });
  assert.equal(response.status, 200, `Evidence request failed: ${url}`);
  return response.text();
}

/** Resolve an instant in the declared display/source timezone. */
function localDay(instant, timeZone = ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Retrieve every page of one immutable publication through its own query code. */
function collect(query, snapshot, filters, context) {
  const first = query(snapshot, { ...filters, limit: 100, page: 1 }, context);
  const events = [...first.events];
  for (let page = 2; page <= Math.ceil(first.total / 100); page++) {
    const result = query(snapshot, { ...filters, limit: 100, page }, context);
    assert.equal(result.total, first.total);
    events.push(...result.events);
  }
  assert.equal(events.length, first.total);
  assert.equal(new Set(events.map(event => event.id)).size, events.length);
  return events;
}

/** Find this generation's immutable crawler-state report, not a moving branch. */
async function matchingReport(generatedAt, nonce) {
  const commits = JSON.parse(await readText(`https://api.github.com/repos/${REPO}/commits?sha=codex%2Fcrawl-state&path=report.json&per_page=15&verify=${nonce}`));
  assert.ok(Array.isArray(commits));
  for (const commit of commits) {
    const text = await readText(`https://raw.githubusercontent.com/${REPO}/${commit.sha}/report.json`);
    const report = JSON.parse(text);
    if (report.manifest?.generatedAt === generatedAt) return { ref: commit.sha, sha256: digest(text), report };
  }
  throw new Error(`No immutable crawler report matches ${generatedAt}`);
}

/** Independently check original source claims before considering live examples. */
function variantGuards(events) {
  const violations = [];
  let mergedGroups = 0, variantsChecked = 0, provenanceClaims = 0;
  for (const event of events) {
    assert.ok(event.sources?.length);
    const keys = event.sources.map(provenanceKey);
    assert.equal(new Set(keys).size, keys.length, `Duplicate provenance claim: ${event.id}`);
    provenanceClaims += keys.length;
    if (!event.mergeEvidence) continue;
    mergedGroups++;
    assert.ok(event.mergeEvidence.sourceOccurrences >= 2 && event.sourceVariants?.length);
    const variants = event.sourceVariants;
    variantsChecked += variants.length;
    const timed = variants.filter(variant => variant.timePrecision === 'time');
    const starts = new Set(timed.map(variant => variant.start));
    const knownEnds = new Set(timed.filter(variant => Date.parse(variant.end) > Date.parse(variant.start)).map(variant => variant.end));
    if (starts.size > 1 || (starts.size && !starts.has(event.start))) violations.push({ id: event.id, code: 'DIFFERENT_TIMED_STARTS' });
    if (knownEnds.size > 1 || (knownEnds.size && !knownEnds.has(event.end))) violations.push({ id: event.id, code: 'DIFFERENT_KNOWN_ENDS' });
    const dates = variants.filter(variant => variant.timePrecision !== 'time');
    for (const variant of dates) {
      const day = event.start.length === 10 ? event.start : localDay(event.start, variant.timeZone || ZONE);
      if (variant.start !== day) violations.push({ id: event.id, code: 'SOURCE_LOCAL_DATE_CHANGED', sourceStart: variant.start, canonicalDay: day });
      if (event.start.length === 10 && variant.end !== event.end) violations.push({ id: event.id, code: 'DATE_RANGE_END_CHANGED' });
    }
    for (const variant of variants) {
      for (const url of variant.urls || []) assert.ok(event.sources.some(source => source.eventUrl === url), `Dropped original URL: ${url}`);
      for (const id of variant.sourceIds || []) assert.ok(event.sources.some(source => source.id === id && variant.urls.includes(source.eventUrl)), `Dropped source-specific claim: ${id}`);
    }
  }
  assert.equal(violations.length, 0, JSON.stringify(violations));
  return { mergedGroups, variantsChecked, provenanceClaims, temporalViolations: violations, allOriginalVariantUrlsRetained: true };
}

/** Audit examples through baseline URLs; missing upstream examples are explicit. */
function representativeCases(events, baseline) {
  const cases = {};
  const exact = [
    ['rolfeSchmidt', baseline.focusCases.rolfeSchmidt.records],
    ['springCarnival', baseline.focusCases.springCarnival.records],
    ['preparingToVibeCode', baseline.focusCases.preparingToVibeCode.records],
  ];
  for (const [name, originals] of exact) {
    const titles = new Set(originals.map(record => words(record.title)));
    const starts = new Set(originals.map(record => record.start));
    const expectedUrls = new Set(originals.flatMap(record => record.sources.map(source => source.eventUrl)));
    const found = events.filter(event => starts.has(event.start)
      && [event.title, ...(event.sourceVariants || []).map(variant => variant.title)].some(title => titles.has(words(title)))
      && event.sources.some(source => expectedUrls.has(source.eventUrl)));
    const retained = new Set(found.flatMap(event => event.sources.map(source => source.eventUrl)));
    const availableUrls = [...expectedUrls].filter(url => retained.has(url));
    const unavailableUrls = [...expectedUrls].filter(url => !retained.has(url));
    const knownEnds = new Set(found.filter(event => Date.parse(event.end) > Date.parse(event.start)).map(event => event.end));
    const unchangedCompleteCase = unavailableUrls.length === 0 && knownEnds.size <= 1;
    if (unchangedCompleteCase) assert.equal(found.length, 1, `${name}: known same-occurrence examples remain duplicated`);
    cases[name] = { baselineCards: originals.length, currentCards: found.length, availableOriginalUrls: availableUrls,
      unavailableOriginalUrls: unavailableUrls, expectedSingleOccurrenceAsserted: unchangedCompleteCase,
      currentIds: found.map(event => event.id), sourceVersionCounts: found.map(event => event.sourceVariants?.length || 1),
      sourceConflicts: [...new Set(found.flatMap(event => event.sourceConflicts || []))] };
    if (name === 'springCarnival' && unchangedCompleteCase) {
      const shared = baseline.focusCases.springCarnival.sharedSourceIdsWithDistinctEventLinks;
      cases[name].sharedCalendarClaims = shared.map(source => {
        const urls = found[0].sources.filter(claim => claim.id === source.sourceId).map(claim => claim.eventUrl);
        assert.ok(source.eventUrls.every(url => urls.includes(url)), 'Shared calendar lost a distinct original event URL');
        return { sourceId: source.sourceId, eventUrls: urls };
      });
    }
  }
  for (const name of ['grievingTogether', 'humanitiesHang']) {
    const original = baseline.focusCases[name];
    const groups = original.expectedSafePerOccurrenceGroups.map(group => {
      const found = events.filter(event => event.start === group.start && event.sources.some(source => group.sourceEventUrls.includes(source.eventUrl)));
      if (found.length) assert.equal(found.length, 1, `${name}: source copies still repeat on ${group.start}`);
      return { start: group.start, currentCards: found.length, id: found[0]?.id || null,
        status: found.length ? 'present-as-separate-occurrence' : 'not-currently-published-by-matching-original-urls' };
    });
    assert.equal(new Set(groups.filter(group => group.id).map(group => group.id)).size, groups.filter(group => group.id).length,
      `${name}: different weekly dates collapsed into one record`);
    cases[name] = { baselineCards: original.publishedRecords, baselineDistinctStarts: original.distinctOccurrenceStarts,
      currentlyAvailableStarts: groups.filter(group => group.id).length, groups };
  }
  const conflicting = baseline.focusCases.explicitEndConflict.records;
  const conflictUrls = new Set(conflicting.flatMap(record => record.sources.map(source => source.eventUrl)));
  const conflictStarts = new Set(conflicting.map(record => record.start));
  const currentConflict = events.filter(event => conflictStarts.has(event.start) && event.sources.some(source => conflictUrls.has(source.eventUrl)));
  const ends = [...new Set(currentConflict.filter(event => Date.parse(event.end) > Date.parse(event.start)).map(event => event.end))].sort();
  if (ends.length > 1) assert.ok(currentConflict.length > 1, 'Explicit unequal ends were silently resolved');
  cases.explicitEndConflict = { baselineCards: conflicting.length, currentCards: currentConflict.length, knownEnds: ends,
    preservedAsSeparateRecords: ends.length > 1 ? currentConflict.length > 1 : null,
    unavailableOriginalUrls: [...conflictUrls].filter(url => !currentConflict.some(event => event.sources.some(source => source.eventUrl === url))) };
  return cases;
}

/** Verify a completed deployment and write compact reproducible proof. */
async function main(args = process.argv.slice(2)) {
  const option = (name, fallback) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
  const runId = option('run-id', ''), label = option('label', 'final');
  assert.match(runId, /^\d+$/); assert.match(label, /^[a-z0-9-]+$/);
  const run = JSON.parse(await readText(`https://api.github.com/repos/${REPO}/actions/runs/${runId}`));
  const jobs = JSON.parse(await readText(`https://api.github.com/repos/${REPO}/actions/runs/${runId}/jobs`));
  assert.equal(run.conclusion, 'success');
  assert.ok(jobs.jobs?.length >= 2 && jobs.jobs.every(job => job.conclusion === 'success'));
  const nonce = Date.now();
  const files = await Promise.all(['manifest', 'events', 'sources', 'status'].map(async name => {
    const text = await readText(`${BASE}data/${name}.json?occurrence-merge-verify=${nonce}`);
    return [name, JSON.parse(text), digest(text)];
  }));
  const docs = Object.fromEntries(files.map(([name, data]) => [name, data]));
  assert.equal(new Set(files.map(([, data]) => data.generatedAt)).size, 1);
  assert.equal(docs.manifest.eventSchema, 2); assert.equal(docs.manifest.mode, 'static');
  assert.equal(docs.manifest.eventCount, docs.events.events.length); assert.equal(docs.status.totalEvents, docs.events.events.length);
  const build = jobs.jobs.find(job => job.name === 'build');
  assert.ok(Date.parse(docs.manifest.generatedAt) >= Date.parse(build.started_at) && Date.parse(docs.manifest.generatedAt) <= Date.parse(build.completed_at) + 1000,
    'The live generation does not belong to this run; use its actual successful workflow ID');
  const application = await Promise.all(['app.js', 'data-client.js', 'event-semantics.js', 'styles.css'].map(async name => {
    const [published, source] = await Promise.all([readText(`${BASE}${name}?occurrence-merge-verify=${nonce}`), readText(`https://raw.githubusercontent.com/${REPO}/${run.head_sha}/web/${name}`)]);
    assert.equal(digest(published), digest(source), `Published ${name} differs from workflow source`);
    return [name, published, digest(published)];
  }));
  const implementation = await Promise.all(['src/lib/occurrence-merge.mjs', 'src/lib/store.mjs', 'src/lib/crawl-state.mjs'].map(async path => {
    const source = await readText(`https://raw.githubusercontent.com/${REPO}/${run.head_sha}/${path}`);
    assert.equal(digest(source), digest(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8')), `Current implementation differs from deployed source: ${path}`);
    return [path, digest(source)];
  }));
  const code = Object.fromEntries(application.map(([name, source]) => [name, source]));
  const semantics = `data:text/javascript;base64,${Buffer.from(code['event-semantics.js']).toString('base64')}`;
  const client = code['data-client.js'].replace(/(["'])\.\/event-semantics\.js\1/g, JSON.stringify(semantics));
  const { calendarEligibility } = await import(semantics);
  const { queryEventsSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(client).toString('base64')}`);
  const scope = JSON.parse(await readFile(new URL('../../config/source-scope.json', import.meta.url), 'utf8'));
  const blocked = new Set(scope.blockedSourceIds);
  const plans = JSON.parse(await readFile(new URL('../../config/source-plans.json', import.meta.url), 'utf8')).plans;
  assert.equal(docs.sources.sources.length, plans.length); assert.equal(docs.manifest.sourceCount, plans.length);
  assert.ok(docs.sources.sources.every(source => !blocked.has(source.id)));
  for (const event of docs.events.events) {
    assert.ok(event.id && event.title && Number.isFinite(Date.parse(event.start)) && Date.parse(event.end) >= Date.parse(event.start));
    assert.ok(['scheduled', 'recurring'].includes(event.eventType));
    assert.equal(calendarEligibility(event).eligible, true);
    assert.ok(event.sources.every(source => !blocked.has(source.id)));
    if (event.eventType === 'recurring') assert.ok(event.recurrence?.seriesId && event.recurrence.source);
  }
  const subscriptions = docs.sources.sources.filter(source => source.subscription);
  const registry = JSON.parse(await readFile(new URL('../../config/source-subscriptions.json', import.meta.url), 'utf8'));
  assert.equal(subscriptions.length, registry.subscriptions.length);
  assert.ok(subscriptions.every(source => source.subscription.emailEventsIngested === false));
  const temporalGuards = variantGuards(docs.events.events);
  const now = Date.now(), today = localDay(now), context = { now, today, timeZone: ZONE };
  const views = Object.fromEntries(['today', 'upcoming', 'recurring', 'ongoing'].map(eventView => [eventView,
    collect(queryEventsSnapshot, docs.events, { eventView, from: today, ...(['today', 'ongoing'].includes(eventView) ? { to: today } : {}) }, context)]));
  const combinedIds = Object.values(views).flatMap(rows => rows.map(event => event.id));
  assert.equal(new Set(combinedIds).size, combinedIds.length, 'Schedule views overlap');
  const overlap = collect(queryEventsSnapshot, docs.events, { from: today }, context).filter(event => event.eventType === 'recurring'
    || (event.start.length === 10 ? event.start : localDay(event.start)) >= today || event.allDay || Date.parse(event.end) > now);
  assert.deepEqual(new Set(combinedIds), new Set(overlap.map(event => event.id)), 'Current/future occurrences disappeared from the schedule views');
  const state = await matchingReport(docs.manifest.generatedAt, nonce);
  const merges = state.report.eventMerges;
  assert.ok(merges?.version === 1 && Array.isArray(merges.groups));
  const byId = new Map(merges.groups.map(group => [group.id, group]));
  for (const event of docs.events.events.filter(event => event.mergeEvidence)) {
    const group = byId.get(event.id); assert.ok(group, `Published merge absent from audit: ${event.id}`);
    assert.equal(group.start, event.start); assert.equal(group.end, event.end);
    assert.equal(group.sourceOccurrences, event.mergeEvidence.sourceOccurrences);
  }
  assert.ok(state.report.quality.successRatio >= 0.7);
  assert.ok(state.report.quality.allowEventDrop || state.report.quality.retainedRatio === null || state.report.quality.retainedRatio >= 0.7);
  const monitor = JSON.parse(await readFile(new URL('../../config/coverage-validation.json', import.meta.url), 'utf8')).sourceIds;
  const coverage = validateSourceCoverage(docs.sources.sources, monitor, docs.status.lastRefresh.startedAt, docs.status.lastRefresh.completedAt);
  assert.equal(coverage.passed, true);
  const baseline = JSON.parse(await readFile(new URL('./baseline-audit.json', import.meta.url), 'utf8'));
  const examples = representativeCases(docs.events.events, baseline);
  const reasons = {};
  for (const group of merges.groups) for (const reason of group.reasons) reasons[reason] = (reasons[reason] || 0) + 1;
  const report = { checkedAt: new Date().toISOString(), runId, runUrl: run.html_url,
    execution: { headSha: run.head_sha, event: run.event, jobs: jobs.jobs.map(job => ({ id: job.id, name: job.name, conclusion: job.conclusion,
      startedAt: job.started_at, completedAt: job.completed_at })) }, manifest: docs.manifest, sourceStates: docs.status.sources,
    quality: state.report.quality, sourceCount: docs.sources.sources.length, subscriptionChannels: subscriptions.length,
    fileHashes: Object.fromEntries(files.map(([name, , hash]) => [name, hash])),
    applicationHashes: Object.fromEntries(application.map(([name, , hash]) => [name, hash])), implementationHashes: Object.fromEntries(implementation),
    matchingStateReport: { ref: state.ref, sha256: state.sha256 }, temporalGuards,
    eventMergeAudit: { inputOccurrences: merges.inputOccurrences, outputOccurrences: merges.outputOccurrences, mergedGroups: merges.mergedGroups,
      absorbedOccurrences: merges.absorbedOccurrences, publishedMergedGroups: temporalGuards.mergedGroups, reasonCounts: reasons },
    viewCounts: Object.fromEntries(Object.entries(views).map(([name, rows]) => [name, rows.length])),
    viewPartition: { mutuallyExclusive: true, completeCurrentFutureOverlap: true, occurrences: overlap.length }, examples,
    coverage: { passed: coverage.passed, passedSources: coverage.passedSources, sourceCount: coverage.sourceCount,
      sources: coverage.sources.map(source => ({ id: source.id, passed: source.passed, internalIssues: source.internalIssues.length,
        externalIssues: source.coverage?.externalIssues.length || 0 })) } };
  await writeFile(new URL(`./${label}-deployment.json`, import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ generatedAt: docs.manifest.generatedAt, events: docs.events.events.length, views: report.viewCounts,
    temporalGuards, eventMergeAudit: report.eventMergeAudit, coveragePassed: coverage.passedSources }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
