import { readFile, writeFile } from 'node:fs/promises';
import { fetchHtml } from '../../src/adapters/html.mjs';
import { createFetcher } from '../../src/lib/fetcher.mjs';
const plans = JSON.parse(await readFile('config/source-plans.json', 'utf8')).plans;
const patches = JSON.parse(await readFile('research/coverage-repair-2026-10-26/media-config-patches.json', 'utf8')).patches;
const cache = new Map();
const fetcher = createFetcher({ getCache: key => cache.get(key), putCache: (key, body, etag, modified) => cache.set(key, { body, etag, modified }), deleteCache: key => cache.delete(key) });
const now = new Date();
const context = { ...fetcher, windowStart: new Date(now.getTime() - 30 * 86400000).toISOString(), windowEnd: new Date(now.getTime() + 365 * 86400000).toISOString() };
const results = [];
const reportFile = process.env.CMU_MEDIA_VALIDATION_REPORT || 'research/coverage-repair-2026-10-26/media-real-validation.json';
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['528193392a78', '34fa7359276d', 'd861fd81e26d', '1468ddb723b2', '5ade174c3483'];
for (const id of ids) {
  const plan = structuredClone(plans.find(item => item.id === id));
  for (const patch of patches.filter(item => item.id === id)) {
    let options = plan.options;
    for (const key of patch.path) options = options[key];
    for (const key of patch.remove || []) delete options[key];
    Object.assign(options, patch.options);
  }
  const startedAt = performance.now();
  try {
    const result = await fetchHtml(plan, context);
    results.push({ id, org: plan.org, url: plan.url, elapsedMs: Math.round(performance.now() - startedAt), eventCount: result.events.length,
      partial: Boolean(result.partial), unsupported: Boolean(result.unsupported), warnings: result.warnings, coverage: result.coverage,
      events: result.events.map(({ title, start, end, timePrecision, location, url }) => ({ title, start, end, timePrecision, location, url })) });
    console.log(id, result.events.length, result.partial, result.coverage && {discovered:result.coverage.discovered,processed:result.coverage.processed,historical:result.coverage.excludedHistorical,nonEvent:result.coverage.excludedNonEvent,complete:result.coverage.inspectionComplete,internal:result.coverage.internalIssues.length,external:result.coverage.externalIssues.length});
  } catch (error) { results.push({ id, error: error.message }); console.log(id, error); }
  await writeFile(reportFile, JSON.stringify({checkedAt:new Date().toISOString(),context:{windowStart:context.windowStart,windowEnd:context.windowEnd},results},null,2)+'\n');
}
