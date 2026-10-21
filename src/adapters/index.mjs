import { fetchIcs } from './ics.mjs';
import { fetchRss } from './rss.mjs';
import { fetchJsonEvents } from './json.mjs';
import { fetchHtml } from './html.mjs';
import { fetchNewsletter } from './newsletter.mjs';
import { fetchTepper } from './tepper.mjs';

/**
 * Fetch one configured endpoint with its reusable source-family adapter.
 * @param {Object} plan Source plan with adapter, public fetchUrl and options.
 * @param {Object} context Fetch callbacks, current time and date window.
 * @return {Promise<{events:Object[],warnings:string[]}>} Normalized source result.
 */
async function fetchEndpoint(plan, context) {
  if (plan.options?.format === 'wrct') return (await import('./wrct.mjs')).fetchWrct(plan, context);
  if (plan.options?.format === 'tepper') return fetchTepper(plan, context);
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
 * Fetch a source and any verified additional widgets using the same adapter.
 * A failed additional endpoint produces an explicit diagnostic; it does not
 * erase events already returned by another endpoint in this source.
 * @param {Object} plan One registry source plan.
 * @param {Object} context Safe fetchText/fetchBytes callbacks and date window.
 * @return {Promise<{events:Object[],warnings:string[]}>} Combined event occurrences.
 */
export async function fetchEvents(plan, context) {
  const primary = await fetchEndpoint(plan, context);
  const events = new Map(primary.events.map(event => [event.uid, event]));
  let supported = !primary.unsupported;
  let partial = Boolean(primary.partial);
  const warnings = primary.warnings || [];
  for (const url of plan.options?.additionalFetchUrls || []) {
    try {
      const extra = await fetchEndpoint({ ...plan, fetchUrl: url, options: { ...plan.options, additionalFetchUrls: [] } }, context);
      if (!extra.unsupported) supported = true;
      if (extra.partial || extra.unsupported) partial = true;
      for (const event of extra.events) events.set(event.uid, event);
      warnings.push(...(extra.warnings || []));
    } catch (error) { partial = true; warnings.push(`Additional endpoint failed (${url}): ${error.message}`); }
  }
  return { events: [...events.values()], warnings: [...new Set(warnings)], ...(!supported ? { unsupported: true } : {}), ...(partial ? { partial: true } : {}) };
}

export { parseIcs } from './ics.mjs';
export { parseHtml, parseNewsletter, explicitTextDate } from './html.mjs';
export { parseRss } from './rss.mjs';
export { parseLiveWhale, parseWordPress, parseTrumba } from './json.mjs';
export { parseNewsletterText } from './newsletter.mjs';
export { parseTepper } from './tepper.mjs';
