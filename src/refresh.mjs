import { createFetcher } from './lib/fetcher.mjs';
import { fetchEvents } from './adapters/index.mjs';
import { normalizeCoverage } from './lib/source-coverage.mjs';

/**
 * Rank broad public calendars first so a fresh installation becomes useful early.
 * @param {Object} plan Source extraction plan.
 * @return {number} Lower numbers are refreshed sooner.
 */
function priority(plan) {
  if (/ical_tepper\.ics/.test(plan.fetchUrl)) return 0;
  if (/cs\.cmu\.edu\/calendar\/export|csd\.cmu\.edu\/ical/.test(plan.fetchUrl)) return 1;
  if (plan.adapter === 'livewhale') return 2;
  if (['ics', 'trumba'].includes(plan.adapter)) return 3;
  return 4;
}

/**
 * Create a single refresh coordinator shared by API, scheduler and CLI.
 * @param {Object} store Persistent event/source storage.
 * @param {Array<Object>} plans All configured source strategies.
 * @param {Object} config Runtime concurrency and ingestion window settings.
 * @param {Object} dependencies Optional anonymous renderer factory for isolated runtimes.
 * @return {Object} Refresh, status and scheduling operations.
 */
export function createRefresher(store, plans, config, dependencies = {}) {
  let running = null;
  let stopped = false;
  let progress = null;
  const fetcher = createFetcher(store);

  /**
   * Fetch due source snapshots and incrementally publish successful event data.
   * @param {Object} options Force, selected source IDs and optional source limit.
   * @return {Promise<Object>} Final source success/failure and event counts.
   */
  async function run(options = {}) {
    const now = new Date();
    const states = new Map(store.listSources().map(source => [source.id, source]));
    let due = plans.filter(plan => ['active', 'empty'].includes(plan.status) && plan.adapter !== 'manual'
      && (!options.sourceIds || options.sourceIds.includes(plan.id))).filter(plan => {
      const state = states.get(plan.id);
      const hours = state?.state === 'error' ? 1 : (plan.refreshHours || 6);
      return options.force || !state?.lastAttempt || now - new Date(state.lastAttempt) >= hours * 3600000;
    }).sort((a, b) => priority(a) - priority(b) || a.id.localeCompare(b.id));
    if (options.limit) due = due.slice(0, options.limit);
    if (!due.length) return { startedAt: now.toISOString(), completedAt: now.toISOString(),
      total: 0, completed: 0, ok: 0, empty: 0, undated: 0, error: 0, totalEvents: store.status().totalEvents };
    progress = { startedAt: now.toISOString(), completedAt: null, total: due.length, completed: 0, ok: 0, empty: 0, undated: 0, error: 0, totalEvents: store.status().totalEvents };
    store.setMeta('lastRefresh', progress);
    const renderer = config.publicRendering
      ? (dependencies.createPublicRenderer || (await import('./lib/public-render.mjs')).createPublicRenderer)({ enabled: true }) : null;
    const context = { fetchText: fetcher.fetchText, fetchBytes: fetcher.fetchBytes, fetchPublicQuery: fetcher.fetchPublicQuery, now,
      sourcePlans: plans, sourceScope: config.sourceScope,
      ...(renderer ? { renderPublic: renderer.renderPublic } : {}),
      windowStart: new Date(now.getTime() - config.lookBackDays * 86400000).toISOString(),
      windowEnd: new Date(now.getTime() + config.lookAheadDays * 86400000).toISOString() };
    let cursor = 0;
    let lastPublish = 0;
    let successfulSincePublish = 0;

    /**
     * Publish deduplicated snapshots and refresh metadata after a useful batch.
     * @param {boolean} final Whether the full refresh has finished.
     * @return {void}
     */
    function publish(final = false) {
      if (successfulSincePublish || final) {
        progress.totalEvents = store.rebuildEvents(plans);
        if (successfulSincePublish) store.setMeta('lastUpdated', new Date().toISOString());
        successfulSincePublish = 0;
      }
      if (final) progress.completedAt = new Date().toISOString();
      store.setMeta('lastRefresh', progress);
      lastPublish = Date.now();
    }

    /**
     * Consume source jobs with bounded overall and HTTP-host concurrency.
     * @return {Promise<void>} Resolution when this worker has no jobs left.
     */
    async function worker() {
      while (cursor < due.length && !stopped) {
        const plan = due[cursor++];
        const sourceStarted = Date.now();
        let outcome = 'error';
        let parsedCount = 0;
        try {
          const result = await fetchEvents(plan, context);
          if (!result || !Array.isArray(result.events)) throw new Error('Adapter returned no event snapshot.');
          store.setMeta(`sourceCoverage:${plan.id}`, normalizeCoverage(result.coverage, new Date().toISOString()));
          if (result.unsupported) throw new Error(`Extraction needs review: ${(result.warnings || []).join(' ') || 'No recognizable event structure.'}`);
          if (result.partial && result.completeSnapshot) store.replaceSource(plan.id, result.events, result.warnings || [], undefined, result.undated ? 'undated' : 'empty', `Complete public inventory; unresolved publisher details. ${(result.warnings || []).join(' ')}`.slice(0, 1200));
          else if (result.partial) store.mergePartial(plan.id, result.events, result.warnings || [], { singleEventUids: result.singleEventUids || [] });
          else store.replaceSource(plan.id, result.events, result.warnings || [], undefined, result.undated ? 'undated' : 'empty');
          successfulSincePublish++;
          outcome = result.partial ? 'partial' : result.events.length ? 'ok' : result.undated ? 'undated' : 'empty';
          parsedCount = result.events.length;
          progress[result.partial ? 'error' : result.events.length ? 'ok' : result.undated ? 'undated' : 'empty']++;
        } catch (error) {
          if (error.coverage) store.setMeta(`sourceCoverage:${plan.id}`, normalizeCoverage(error.coverage, new Date().toISOString()));
          store.failSource(plan.id, error);
          progress.error++;
        }
        progress.completed++;
        if (config.logProgress) console.log(`[source] ${plan.id} ${outcome}; ${parsedCount} parsed; ${Date.now() - sourceStarted} ms; ${progress.completed}/${progress.total}`);
        if ((progress.completed <= 12 && Date.now() - lastPublish > 2000)
          || (successfulSincePublish >= 60 && Date.now() - lastPublish > 10000)) publish();
      }
    }
    try {
      await Promise.all(Array.from({ length: config.concurrency }, () => worker()));
      publish(true);
    } finally { await renderer?.close(); }
    console.log(`[refresh] ${progress.completed}/${progress.total} sources checked; ${progress.ok} populated, ${progress.empty} empty, ${progress.undated} undated resources, ${progress.error} need review; ${progress.totalEvents} distinct occurrences.`);
    return { ...progress, transfers: { ...fetcher.stats } };
  }

  /**
   * Start a refresh, reusing the current job if one is already running.
   * @param {Object} options Optional forced or selected-source refresh.
   * @return {Promise<Object>} Current or new refresh job.
   */
  function refresh(options = {}) {
    if (running) return running;
    running = run(options).finally(() => { running = null; });
    return running;
  }

  /**
   * Return persistence and in-memory refresh progress for API clients.
   * @return {Object} Aggregated source health and current job state.
   */
  function status() {
    return { ...store.status(), refreshing: Boolean(running), ...(running ? { lastRefresh: { ...progress } } : {}) };
  }

  /**
   * Stop scheduling new source work during application shutdown.
   * @return {void}
   */
  function stop() { stopped = true; }

  /**
   * Check whether a refresh job is currently in progress.
   * @return {boolean} Whether a shared refresh job exists.
   */
  function isRunning() { return Boolean(running); }

  return { refresh, status, stop, isRunning };
}
