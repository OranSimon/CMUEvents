import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { readConfig, loadPlans, ROOT } from '../src/config.mjs';
import { openStore } from '../src/lib/store.mjs';
import { createRefresher } from '../src/refresh.mjs';
import { createSourceSubscriptions } from '../src/lib/source-subscriptions.mjs';
import { exportCrawlState, restoreCrawlState, savedPublicationEventCount } from '../src/lib/crawl-state.mjs';
import { validateSourceCoverage } from '../src/lib/source-coverage.mjs';
import { buildStaticSite } from '../src/lib/static-site.mjs';

/**
 * Refresh on an isolated runner, validate and export Pages plus durable state.
 * @param {Array<string>} args Optional --output, --state-in/out and --allow-event-drop.
 * @return {Promise<void>} Build completion; failures never publish a new artifact.
 */
async function main(args = process.argv.slice(2)) {
  const option = (key, fallback) => args.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3) || fallback;
  const output = path.resolve(option('output', 'dist'));
  const relative = path.relative(ROOT, output).split(path.sep).join('/');
  if (!(relative === 'dist' || relative.startsWith('dist/') || relative.startsWith('.cache/'))) {
    throw new Error('Output must be dist/ or a dedicated directory inside .cache/.');
  }
  const stateIn = option('state-in', '');
  const stateOut = path.resolve(option('state-out', '.cache/crawl-state.json'));
  const config = readConfig({ ...process.env, CMUEVENTS_DATA_DIR: process.env.CMUEVENTS_BUILD_DATA_DIR || path.join(ROOT, '.cache/static-build') });
  const plans = loadPlans();
  const store = openStore(config.databasePath);
  const now = Date.now();
  const context = { windowStart: new Date(now - config.lookBackDays * 86400000).toISOString(),
    windowEnd: new Date(now + config.lookAheadDays * 86400000).toISOString() };
  store.registerPlans(plans);
  let previousEventCount = 0;
  try {
    if (stateIn) {
      if ((await stat(stateIn)).size > 64 * 1024 * 1024) throw new Error('Crawler state exceeds its 64 MB bound.');
      const snapshot = JSON.parse(await readFile(stateIn, 'utf8'));
      previousEventCount = savedPublicationEventCount(snapshot);
      const restored = restoreCrawlState(store, plans, snapshot, context);
      console.log(`[state] ${JSON.stringify(restored)}`);
    }
    const refresher = createRefresher(store, plans, config);
    const refresh = await refresher.refresh({ force: true });
    await mkdir(path.dirname(stateOut), { recursive: true });
    await writeFile(path.join(path.dirname(stateOut), 'publication-attempt.json'), `${JSON.stringify({
      checkedAt: new Date().toISOString(), refresh, previousEventCount, eventExclusions: store.getMeta('eventExclusions'), eventMerges: store.getMeta('eventMerges'),
      sources: store.listSources().map(({ id, org, url, state, eventCount, lastSuccess, error, warnings, coverage }) =>
        ({ id, org, url, state, eventCount, lastSuccess, error, warnings, coverage })),
    }, null, 2)}\n`);
    const coverageIds = JSON.parse(await readFile(path.join(ROOT, 'config/coverage-validation.json'), 'utf8')).sourceIds;
    const coverage = validateSourceCoverage(store.listSources(), coverageIds, refresh.startedAt, refresh.completedAt);
    await writeFile(path.join(path.dirname(stateOut), 'publication-coverage.json'), `${JSON.stringify(coverage, null, 2)}\n`);
    for (const source of coverage.sources) console.log(`[coverage] ${source.id} ${source.passed ? 'complete' : 'incomplete'}; ${source.eventCount ?? 0} events; ${source.internalIssues.length} internal; ${source.coverage?.externalIssues.length ?? 0} upstream${source.passed ? '' : `; ${JSON.stringify(source.internalIssues).slice(0, 4000)}`}`);
    if (!coverage.passed) throw new Error(`Publication blocked: source coverage ${coverage.passedSources}/${coverage.sourceCount}; inspect publication-coverage.json for internal omissions.`);
    const subscriptions = createSourceSubscriptions(JSON.parse(await readFile(path.join(ROOT, 'config/source-subscriptions.json'), 'utf8')));
    const report = await buildStaticSite({ store, plans, subscriptions, webRoot: path.join(ROOT, 'web'), output,
      licensePath: path.join(ROOT, 'LICENSE'), context, previousEventCount, allowEventDrop: args.includes('--allow-event-drop') });
    await writeFile(stateOut, `${JSON.stringify(exportCrawlState(store, context))}\n`);
    await writeFile(path.join(path.dirname(stateOut), 'publication-report.json'), `${JSON.stringify({ ...report, refresh, coverage, eventExclusions: store.getMeta('eventExclusions'), eventMerges: store.getMeta('eventMerges') }, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY,
      `## Daily public event publication\n\n- ${report.quality.eventCount} occurrences from ${report.quality.sourceCount} retained sources.\n- ${report.quality.completeSources}/${report.quality.checkedSources} source checks complete; other sources retain explicit diagnostics.\n- Last successful data update: ${report.manifest.lastUpdated}.\n- Published snapshot generation: ${report.manifest.generatedAt}.\n`, { flag: 'a' });
  } finally { store.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
