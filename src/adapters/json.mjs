import { absoluteUrl, addDays, normalizeEvent, inWindow } from '../lib/normalize.mjs';
import { parseIcs } from './ics.mjs';

/**
 * Format a timestamp as its calendar date in the event's own timezone.
 * @param {unknown} timestamp Unix seconds or an ISO datetime.
 * @param {string} timeZone Event timezone.
 * @return {string|null} YYYY-MM-DD date.
 */
function localDate(timestamp, timeZone) {
  try {
    const instant = typeof timestamp === 'number' || /^\d{10}$/.test(String(timestamp)) ? Number(timestamp) * 1000 : timestamp;
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
  } catch { return null; }
}

/**
 * Read a LiveWhale API page or documented widget preload event array.
 * @param {Object|Object[]} json API response.
 * @param {Object} plan Source options and provenance.
 * @param {Object} context Date window.
 * @return {{events:Object[],warnings:string[],next:string|null}} Event page and next-page link.
 */
export function parseLiveWhale(json, plan = {}, context = {}) {
  const rows = Array.isArray(json) ? json : json.data || json.events || [];
  if (!Array.isArray(rows)) throw new Error('Unexpected LiveWhale response: expected data/events array');
  const events = [];
  const warnings = [];
  for (const row of rows) {
    const timeZone = row.timezone || row.tz || plan.options?.timezone || 'America/New_York';
    const allDay = row.is_all_day === 1 || row.is_all_day === '1' || row.is_all_day === true;
    const start = allDay ? localDate(row.date_ts || row.ts_start || row.date_iso, timeZone)
      : row.date_iso || row.ts_start || row.date_ts || (row.date_utc ? `${row.date_utc.replace(' ', 'T')}Z` : null);
    const rawEnd = row.date2_iso || row.ts_end || row.date2_ts;
    const endDate = rawEnd ? localDate(row.date2_ts || row.ts_end || rawEnd, timeZone) : null;
    const end = allDay ? endDate ? addDays(endDate) : start ? addDays(start) : null
      : rawEnd || (row.date2_utc ? `${row.date2_utc.replace(' ', 'T')}Z` : null);
    const event = normalizeEvent({
      uid: row.id === undefined ? undefined : `livewhale:${row.id}:${start}`, title: row.title, description: row.description || row.summary,
      summary: row.summary, start, end, allDay, timeZone,
      url: row.url || row.href || row.external_url,
      location: typeof row.location === 'object' ? row.location?.title || row.location?.name : row.location,
      organizer: row.group_title, status: [true, 1, '1'].includes(row.is_canceled) ? 'cancelled' : row.status,
      mode: [true, 1, '1'].includes(row.is_online) ? row.online_type === 'hybrid' ? 'hybrid' : 'online' : undefined,
      tags: [].concat(row.tags || row.categories || row.event_types || []).map(tag => typeof tag === 'object' ? tag.title || tag.name : tag),
    }, plan);
    if (event && inWindow(event, context)) events.push(event);
    else if (!event) warnings.push(`Skipped LiveWhale event ${row.id || '(no id)'}: invalid title, URL or explicit start date`);
  }
  return { events, warnings, next: json.links?.next || null, ...(warnings.length ? { partial: true } : {}) };
}

/**
 * Read a WordPress The Events Calendar REST API page.
 * @param {Object} json WordPress response with an events collection.
 * @param {Object} plan Source configuration.
 * @param {Object} context Date window.
 * @return {{events:Object[],warnings:string[],next:string|null}} Parsed event page.
 */
export function parseWordPress(json, plan = {}, context = {}) {
  const rows = Array.isArray(json) ? json : json.events;
  if (!Array.isArray(rows)) throw new Error('Unexpected WordPress response: expected events array');
  const events = [];
  const warnings = [];
  for (const row of rows) {
    const allDay = row.all_day === true || row.all_day === 'true';
    const start = allDay ? row.start_date?.slice(0, 10) : row.utc_start_date || row.start_date_utc
      ? `${(row.utc_start_date || row.start_date_utc).replace(' ', 'T').replace(/Z$/, '')}Z` : row.start_date;
    const end = allDay ? addDays(row.end_date?.slice(0, 10) || start) : row.utc_end_date || row.end_date_utc
      ? `${(row.utc_end_date || row.end_date_utc).replace(' ', 'T').replace(/Z$/, '')}Z` : row.end_date;
    const venue = row.venue || {};
    const event = normalizeEvent({
      uid: row.global_id || (row.id === undefined ? undefined : `wordpress:${new URL(plan.url).host}:${row.id}`),
      title: typeof row.title === 'object' ? row.title.rendered : row.title,
      description: typeof row.description === 'object' ? row.description.rendered : row.description || row.content?.rendered,
      summary: row.excerpt?.rendered || row.excerpt, start, end, allDay,
      timeZone: row.timezone || plan.options?.timezone || 'America/New_York',
      url: row.url || row.link, location: [venue.venue || venue.name, venue.address, venue.city].filter(Boolean).join(', '),
      organizer: [].concat(row.organizer || []).map(item => item.organizer || item.name || '').filter(Boolean).join(', '),
      status: row.event_status || row.status, tags: [].concat(row.categories || [], row.tags || []).map(tag => tag.name || tag.slug || tag),
    }, plan);
    if (event && inWindow(event, context)) events.push(event);
    else if (!event) warnings.push(`Skipped WordPress event ${row.id || '(no id)'}: invalid title, URL or explicit start date`);
  }
  return { events, warnings, next: json.next_rest_url || json.next || null, ...(warnings.length ? { partial: true } : {}) };
}

/**
 * Fetch paginated public JSON, restricting next-page links to the same origin.
 * @param {Object} plan LiveWhale or WordPress source endpoint.
 * @param {Object} context Fetch callback and date window.
 * @return {Promise<Object>} Complete bounded event collection and diagnostics.
 */
export async function fetchJsonEvents(plan, context) {
  const initial = plan.fetchUrl || plan.url;
  const origin = new URL(initial).origin;
  const maxPages = Math.min(plan.options?.maxPages || 30, 100);
  const events = new Map();
  const warnings = [];
  let partial = false;
  const visited = new Set();
  let url = initial;
  while (url && visited.size < maxPages) {
    if (visited.has(url)) { partial = true; warnings.push('Repeated pagination link; stopped to prevent a loop'); break; }
    visited.add(url);
    const text = await context.fetchText(url);
    if (/^\s*BEGIN:VCALENDAR/im.test(text)) {
      const result = parseIcs(text, plan, context);
      for (const event of result.events) events.set(event.uid, event);
      warnings.push(...result.warnings);
      if (result.partial) partial = true;
      url = null;
      break;
    }
    const result = (plan.adapter === 'wordpress' ? parseWordPress : parseLiveWhale)(JSON.parse(text), plan, context);
    for (const event of result.events) events.set(event.uid, event);
    warnings.push(...result.warnings);
    if (result.partial) partial = true;
    const next = result.next ? absoluteUrl(result.next, url) : null;
    if (next && new URL(next).origin !== origin) { partial = true; warnings.push('Rejected cross-origin pagination link'); break; }
    url = next;
  }
  if (url && visited.size >= maxPages) { partial = true; warnings.push(`Pagination limit ${maxPages} reached; some events were not retrieved`); }
  return { events: [...events.values()], warnings: [...new Set(warnings)], ...(partial ? { partial: true } : {}) };
}
