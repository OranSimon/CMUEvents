import { fetchIcs } from './ics.mjs';
import { fetchRss } from './rss.mjs';
import { fetchJsonEvents } from './json.mjs';
import { fetchHtml } from './html.mjs';
import { fetchNewsletter } from './newsletter.mjs';
import { fetchTepper } from './tepper.mjs';
import { sourceAllowed } from '../lib/source-scope.mjs';

const sourceRuns = new WeakMap();

/**
 * Preserve endpoint audits without making unrelated unaudited endpoints erase them.
 * @param {Object[]} endpoints Public endpoint URLs and their optional coverage.
 * @return {Object|undefined} One original audit or a transparent combined audit.
 */
export function combineSourceCoverage(endpoints) {
  const audits = endpoints.filter(endpoint => endpoint.coverage);
  if (!audits.length) return undefined;
  if (audits.length === 1) return audits[0].coverage;
  const issues = field => audits.flatMap(endpoint => (endpoint.coverage[field] || []).map(issue =>
    typeof issue === 'string' ? { endpoint: endpoint.url, reason: issue } : { endpoint: endpoint.url, ...issue }));
  return { version: 1, kind: 'source-endpoints', inspectionComplete: audits.every(endpoint => endpoint.coverage.inspectionComplete === true),
    internalIssues: issues('internalIssues'), externalIssues: issues('externalIssues'), nonBlockingIssues: issues('nonBlockingIssues'),
    series: audits.flatMap(endpoint => endpoint.coverage.series || []), counters: { endpoints: audits.length }, components: audits };
}

/**
 * Classify a caught transport exception without treating parser budgets as access failures.
 * @param {string} url Public endpoint attempted by the adapter.
 * @param {Error|string} error Caught exception, rather than concatenated parser warnings.
 * @return {Object} Explicit internal or external endpoint coverage.
 */
function failedCoverage(url, error) {
  const reason = String(error?.message || error || 'Incomplete endpoint extraction');
  const budget = /\b(?:budget|scan limit|detail limit|download limit|maximumBytes|timeoutMs|unprocessed|circuit|pagination limit)\b/i.test(reason);
  const external = !budget && /\bHTTP\s+(?:4\d\d|5\d\d)\b|\b(?:EAI_AGAIN|ENOTFOUND|ECONN\w*|ETIMEDOUT)\b|fetch failed|certificate|TLS|socket|DNS|(?:fetch|request|connection|network).*tim(?:ed?\s*out|eout)/i.test(reason);
  return { version: 1, kind: 'source-endpoint-failure', inspectionComplete: external,
    internalIssues: external ? [] : [{ url, reason }], externalIssues: external ? [{ url, reason }] : [], nonBlockingIssues: [] };
}

/**
 * Keep an unaudited partial parser from being hidden by an audited sibling.
 * Warning text cannot establish transport failure: a title may contain “HTTP 503”.
 * @param {string} url Public endpoint URL.
 * @param {Object} result Parsed source result.
 * @return {Object|undefined} Existing coverage or a conservative parser-gap audit.
 */
function endpointCoverage(url, result) {
  if (result.coverage) return result.coverage;
  if (!result.partial && !result.unsupported) return undefined;
  return { version: 1, kind: 'source-endpoint-incomplete', inspectionComplete: false,
    internalIssues: [{ url, reason: (result.warnings || []).join(' ') || 'Endpoint extraction is partial without a completed inspection' }],
    externalIssues: [], nonBlockingIssues: [] };
}

/**
 * Fetch one configured endpoint with its reusable source-family adapter.
 * @param {Object} plan Source plan with adapter, public fetchUrl and options.
 * @param {Object} context Fetch callbacks, current time and date window.
 * @return {Promise<{events:Object[],warnings:string[]}>} Normalized source result.
 */
async function fetchEndpoint(plan, context) {
  if (plan.options?.format === 'alumni') return (await import('./alumni.mjs')).fetchAlumni(plan, context);
  if (plan.options?.format === 'text-schedule') return (await import('./text-schedules.mjs')).fetchTextSchedule(plan, context);
  if (plan.options?.format === 'scs-directory') return (await import('./seminar-discovery.mjs')).fetchSeminarDirectory(plan, context);
  if (plan.options?.format === 'semantic-seminar') return (await import('./seminar-discovery.mjs')).fetchSeminarResource(plan, context);
  if (plan.options?.format === 'reviewed-raw-resource') return (await import('./reviewed-resources.mjs')).fetchReviewedRawResource(plan, context);
  if (plan.options?.format === 'campusgroups-json') return (await import('./campusgroups.mjs')).fetchCampusGroups(plan, context);
  if (plan.options?.format === 'wrct') return (await import('./wrct.mjs')).fetchWrct(plan, context);
  if (plan.options?.format === 'tepper') return fetchTepper(plan, context);
  if (plan.options?.format === 'chabad-public') return (await import('./chabad.mjs')).fetchChabadCalendar(plan, context);
  switch (plan.adapter) {
    case 'ics': return fetchIcs(plan, context);
    case 'trumba': return plan.options?.format === 'trumba-json' ? fetchJsonEvents(plan, context) : fetchIcs(plan, context);
    case 'rss': return fetchRss(plan, context);
    case 'livewhale': case 'wordpress': return fetchJsonEvents(plan, context);
    case 'campusgroups':
      if (/ical|\.ics(?:[?#]|$)|icalfeed/i.test(plan.fetchUrl || plan.url)) return fetchIcs(plan, context);
      return fetchHtml(plan, context);
    case 'html': return fetchHtml(plan, context);
    case 'newsletter': return fetchNewsletter(plan, context);
    case 'manual': return { events: [], warnings: [plan.reason || 'No verified reusable public event endpoint is available for this source'] };
    default: throw new Error(`Unsupported adapter: ${plan.adapter}`);
  }
}

/**
 * Fetch a source and its explicitly reviewed additional public endpoints.
 * A failed additional endpoint produces an explicit diagnostic; it does not
 * erase events already returned by another endpoint in this source.
 * @param {Object} plan One registry source plan.
 * @param {Object} context Safe fetchText/fetchBytes callbacks and date window.
 * @return {Promise<{events:Object[],warnings:string[]}>} Combined event occurrences.
 */
async function fetchSourcePlan(plan, context) {
  const endpoints = [
    ...(plan.options?.additionalFetchUrls || []).map(url => ({ url, legacy: true })),
    ...(plan.options?.additionalEndpoints || []),
  ];
  let primary;
  try { primary = await fetchEndpoint(plan, context); }
  catch (error) {
    if (!endpoints.length) { error.coverage = failedCoverage(plan.fetchUrl || plan.url, error); throw error; }
    primary = { events: [], unsupported: true, partial: true,
      coverage: failedCoverage(plan.fetchUrl || plan.url, error),
      warnings: [`Primary endpoint failed (${plan.fetchUrl || plan.url}): ${error.message}`] };
  }
  const events = new Map(primary.events.map(event => [event.uid, event]));
  const singleEventUids = new Set(primary.singleEventUids || []);
  let supported = !primary.unsupported;
  let partial = Boolean(primary.partial || primary.unsupported);
  let undated = Boolean(primary.undated);
  const warnings = [...(primary.warnings || [])];
  const coverages = [{ url: plan.fetchUrl || plan.url, coverage: endpointCoverage(plan.fetchUrl || plan.url, primary) }];
  for (const endpoint of endpoints) {
    const url = endpoint.url;
    try {
      const extraPlan = { ...plan, fetchUrl: url, url: endpoint.publicURL || (endpoint.legacy ? plan.url : url),
        adapter: endpoint.adapter || plan.adapter,
        options: { ...(endpoint.legacy ? plan.options : { timezone: plan.options?.timezone }),
          ...endpoint.options, additionalFetchUrls: [], additionalEndpoints: [] } };
      const extra = await fetchEndpoint(extraPlan, context);
      coverages.push({ url, coverage: endpointCoverage(url, extra) });
      for (const uid of extra.singleEventUids || []) singleEventUids.add(uid);
      undated &&= Boolean(extra.undated);
      if (!extra.unsupported) supported = true;
      if (extra.partial || extra.unsupported) partial = true;
      for (const event of extra.events) events.set(event.uid, event);
      warnings.push(...(extra.warnings || []));
    } catch (error) {
      partial = true;
      coverages.push({ url, coverage: failedCoverage(url, error) });
      warnings.push(`Additional endpoint failed (${url}): ${error.message}`);
    }
  }
  const coverage = combineSourceCoverage(coverages);
  return { events: [...events.values()], warnings: [...new Set(warnings)], ...(!supported ? { unsupported: true } : {}), ...(partial ? { partial: true } : {}),
    ...(coverage ? { coverage } : {}),
    ...(primary.completeSnapshot && !endpoints.length ? { completeSnapshot: true } : {}),
    ...(undated && !events.size ? { undated: true } : {}),
    ...(singleEventUids.size ? { singleEventUids: [...singleEventUids].filter(uid => events.has(uid)) } : {}) };
}

/**
 * Reuse one source result per refresh context, including directory dependencies.
 * Catalog aliases resolve to their canonical source and cycles fail explicitly.
 * Only originating source identities are checked against the registry policy;
 * syndicated event organizers and links never determine source eligibility.
 * @param {Object} plan Current catalog source or discovered public source plan.
 * @param {Object} context One refresh's callbacks, sourcePlans and sourceScope.
 * @return {Promise<Object>} Shared normalized source result.
 */
export async function fetchEvents(plan, context) {
  if (!context.sourcePlans) return fetchSourcePlan(plan, context);
  let run = sourceRuns.get(context);
  if (!run) {
    run = { pending: new Map(), texts: new Map(), dependencies: new Map(), plans: new Map(context.sourcePlans.map(source => [source.id, source])) };
    sourceRuns.set(context, run);
  }
  const invoke = (source, chain = []) => {
    if (chain.includes(source.id)) return Promise.reject(new Error(`Source discovery cycle rejected: ${[...chain, source.id].join(' -> ')}`));
    if (!sourceAllowed(source, context.sourceScope)) return Promise.resolve({ events: [], warnings: ['Discovered source excluded by registry policy'], excluded: true });
    const parent = chain.at(-1);
    if (parent) {
      const reaches = (from, target, visited = new Set()) => {
        if (from === target) return true;
        if (visited.has(from)) return false;
        visited.add(from);
        return [...(run.dependencies.get(from) || [])].some(next => reaches(next, target, visited));
      };
      if (reaches(source.id, parent)) return Promise.reject(new Error(`Concurrent source discovery cycle rejected: ${parent} -> ${source.id}`));
      if (!run.dependencies.has(parent)) run.dependencies.set(parent, new Set());
      run.dependencies.get(parent).add(source.id);
    }
    if (source.status === 'covered') {
      const canonical = run.plans.get(source.canonicalSourceId);
      return canonical ? invoke(canonical, [...chain, source.id]) : Promise.reject(new Error(`Missing canonical source ${source.canonicalSourceId}`));
    }
    if (run.pending.has(source.id)) return run.pending.get(source.id);
    const ancestry = [...chain, source.id];
    const adapted = { ...context, collectionRun: context.collectionRun || context, fetchText: (url, options) => {
      if (options?.cache === false) return context.fetchText(url, options);
      const key = JSON.stringify([url, options || {}]);
      if (!run.texts.has(key)) run.texts.set(key, Promise.resolve().then(() => context.fetchText(url, options)));
      return run.texts.get(key);
    }, resolveSource: id => {
      const target = run.plans.get(id);
      if (!target) return Promise.reject(new Error(`Unknown catalog source ${id}`));
      return invoke(target, ancestry);
    }, fetchSourcePlan: target => invoke(target, ancestry) };
    const pending = Promise.resolve().then(() => fetchSourcePlan(source, adapted));
    run.pending.set(source.id, pending);
    return pending;
  };
  return invoke(plan);
}

export { parseIcs } from './ics.mjs';
export { parseHtml, parseNewsletter, explicitTextDate } from './html.mjs';
export { parseRss } from './rss.mjs';
export { parseLiveWhale, parseWordPress, parseTrumba } from './json.mjs';
export { parseNewsletterText } from './newsletter.mjs';
export { parseTepper } from './tepper.mjs';
