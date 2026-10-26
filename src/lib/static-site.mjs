import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { inWindow } from './normalize.mjs';

const SOURCE_FIELDS = ['id', 'department', 'org', 'url', 'kind', 'state', 'status', 'eventCount',
  'lastAttempt', 'lastSuccess', 'error', 'warnings', 'reason', 'strategy', 'canonicalSourceId'];

/**
 * Reject incomplete or implausibly destructive refreshes before publication.
 * @param {Object} input Events, sources, current refresh and previous event total.
 * @return {Object} Publication quality summary or a thrown blocking error.
 */
export function validatePublication({ events, sources, expectedSources, expectedRefreshSources, refresh, previousEventCount = 0, allowEventDrop = false }) {
  if (!events.length) throw new Error('Publication blocked: no current public event occurrences.');
  if (sources.length !== expectedSources || new Set(sources.map(source => source.id)).size !== expectedSources) {
    throw new Error('Publication blocked: source directory is incomplete or duplicated.');
  }
  if (!refresh || !refresh.completedAt || refresh.completed !== refresh.total || refresh.total < 1) {
    throw new Error('Publication blocked: a complete source refresh is required.');
  }
  if (expectedRefreshSources !== undefined && refresh.total !== expectedRefreshSources) {
    throw new Error('Publication blocked: not every scheduled source was checked.');
  }
  const complete = Number(refresh.ok || 0) + Number(refresh.empty || 0) + Number(refresh.undated || 0);
  const successRatio = complete / refresh.total;
  if (successRatio < 0.7) throw new Error(`Publication blocked: only ${(successRatio * 100).toFixed(1)}% of source checks completed successfully.`);
  const retainedRatio = previousEventCount ? events.length / previousEventCount : null;
  if (retainedRatio !== null && retainedRatio < 0.7 && !allowEventDrop) {
    throw new Error(`Publication blocked: event count fell from ${previousEventCount} to ${events.length}; review the report before allowing this decrease.`);
  }
  if (events.some(event => !event.id || !event.title || !Number.isFinite(Date.parse(event.start)) || !event.sources?.length)) {
    throw new Error('Publication blocked: invalid public event contract.');
  }
  return { eventCount: events.length, sourceCount: sources.length, checkedSources: refresh.total,
    completeSources: complete, successRatio, previousEventCount, retainedRatio, allowEventDrop };
}

/**
 * Select public source diagnostics without exposing crawler configuration/cache.
 * @param {Object} source Source descriptor with curated subscription metadata.
 * @return {Object} Source directory document used by the static browser client.
 */
export function publicSource(source) {
  const result = Object.fromEntries(SOURCE_FIELDS.filter(field => source[field] !== undefined).map(field => [field, source[field]]));
  if (source.evidence) result.evidence = Object.fromEntries(['accessReview', 'visualReview', 'followupResolution']
    .filter(field => source.evidence[field] !== undefined).map(field => [field, source.evidence[field]]));
  if (source.subscription) result.subscription = source.subscription;
  return result;
}

/**
 * Build one self-contained Pages artifact from validated public snapshots.
 * @param {Object} options Store, plans, subscription registry and output paths.
 * @return {Promise<Object>} Manifest and quality summary for CI logs.
 */
export async function buildStaticSite({ store, plans, subscriptions, webRoot, output, licensePath,
  context = {}, previousEventCount = 0, allowEventDrop = false, generatedAt = new Date().toISOString() }) {
  const events = store.db.prepare('SELECT data FROM events ORDER BY start,id').all()
    .map(row => JSON.parse(row.data)).filter(event => inWindow(event, context));
  const sources = store.listSources().map(source => publicSource(subscriptions.attach(source)));
  const status = store.status();
  if (!Number.isFinite(Date.parse(status.lastUpdated))) throw new Error('Publication blocked: no successful data-update timestamp.');
  const quality = validatePublication({ events, sources, expectedSources: plans.length, refresh: status.lastRefresh,
    expectedRefreshSources: plans.filter(plan => ['active', 'empty'].includes(plan.status) && plan.adapter !== 'manual').length,
    previousEventCount, allowEventDrop });
  const manifest = { version: 1, mode: 'static', generatedAt, lastUpdated: status.lastUpdated,
    updateIntervalHours: 24, staleAfterHours: 48, eventCount: events.length, sourceCount: sources.length,
    sourceRepository: 'https://github.com/OranSimon/CMUEvents',
    workflowUrl: 'https://github.com/OranSimon/CMUEvents/actions/workflows/daily-pages.yml' };
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, 'data'), { recursive: true });
  await cp(webRoot, output, { recursive: true, filter: file => !path.basename(file).startsWith('.') });
  let html = await readFile(path.join(output, 'index.html'), 'utf8');
  if (!html.includes('data-mode="api"')) throw new Error('Static build requires the explicit API-mode HTML marker.');
  html = html.replace('data-mode="api"', 'data-mode="static"').replace('<head>',
    '<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; img-src \'self\' data:; connect-src \'self\'; font-src \'self\'; object-src \'none\'; base-uri \'self\'" />');
  await writeFile(path.join(output, 'index.html'), html);
  await cp(licensePath, path.join(output, 'LICENSE'));
  await writeFile(path.join(output, '.nojekyll'), '');
  const documents = { manifest, events: { generatedAt, lastUpdated: status.lastUpdated, events }, sources: { generatedAt, sources },
    status: { ...status, generatedAt, totalEvents: events.length, refreshing: false, lastSuccessfulUpdate: status.lastUpdated,
      updateIntervalHours: 24, staleAfterHours: 48 } };
  for (const [name, document] of Object.entries(documents)) {
    await writeFile(path.join(output, 'data', `${name}.json`), `${JSON.stringify(document)}\n`);
  }
  return { manifest, quality };
}
