import { absoluteUrl, addDays, normalizeEvent, inWindow, plainText, parseDate } from '../lib/normalize.mjs';
import { parseIcs } from './ics.mjs';
import * as cheerio from 'cheerio';
import { explicitTextDate, explicitTextEnd, clockTime } from './html.mjs';

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
 * Split a reviewed WordPress series only from its explicitly published dates.
 * Uniform clock times and the year must be printed in selected source sections;
 * a container's start/end range never implies daily or weekly meetings.
 * @param {Object} input Shared normalized-input fields for the series container.
 * @param {Object} plan Source options with an explicit sessionDates contract.
 * @return {Object|null} Session inputs and diagnostics, or null for ordinary events.
 */
function explicitWordPressSessions(input, plan) {
  const options = plan.options?.sessionDates;
  if (!options || !new RegExp(options.titlePattern, 'i').test(plainText(input.title))) return null;
  const $ = cheerio.load(input.description || '');
  const years = [...new Set($(options.yearSelector).text().match(/\b20\d{2}\b/g) || [])];
  const label = `WordPress series ${input.uid || plainText(input.title)}`;
  if (years.length !== 1) return { inputs: [], warnings: [`${label}: session year is not unambiguously printed in the selected heading`] };
  const timeBlocks = $(options.timeSelector).toArray();
  if (timeBlocks.length !== 1) return { inputs: [], warnings: [`${label}: expected one selected paragraph with the shared session clock`] };
  const timeText = $(timeBlocks[0]).text();
  const lines = $(options.dateSelector).toArray().map(element => plainText($(element).html())).join('\n').split('\n').map(line => line.trim()).filter(Boolean);
  const inputs = [];
  const warnings = [];
  const dates = new Set();
  for (const line of lines) {
    if (/\b(?:no sessions?|cancelled|canceled)\b/i.test(line)) continue;
    if (!/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d/i.test(line)) continue;
    const day = explicitTextDate(/\b20\d{2}\b/.test(line) ? line : `${line}, ${years[0]}`);
    const clock = clockTime(timeText);
    const start = day && clock ? `${day.slice(0, 10)}T${clock}` : null;
    const end = start && explicitTextEnd(timeText, start);
    if (!day || day.length !== 10 || !parseDate(day) || !start || start.length === 10 || !end || end.length === 10) {
      warnings.push(`${label}: an explicit session date or shared start/end clock could not be parsed: ${line}`);
      continue;
    }
    if (dates.has(day)) continue;
    dates.add(day);
    inputs.push({ ...input, uid: `${input.uid || input.url}::${day}`, start, end, allDay: false,
      timeZone: plan.options?.timezone || 'America/New_York' });
  }
  if (!inputs.length && !warnings.length) warnings.push(`${label}: the selected date list contains no independently dated sessions`);
  return { inputs, warnings };
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
    const input = {
      uid: row.global_id || (row.id === undefined ? undefined : `wordpress:${new URL(plan.url).host}:${row.id}`),
      title: typeof row.title === 'object' ? row.title.rendered : row.title,
      description: typeof row.description === 'object' ? row.description.rendered : row.description || row.content?.rendered,
      summary: row.excerpt?.rendered || row.excerpt, start, end, allDay,
      timeZone: row.timezone || plan.options?.timezone || 'America/New_York',
      url: row.url || row.link, location: [venue.venue || venue.name, venue.address, venue.city].filter(Boolean).join(', '),
      organizer: [].concat(row.organizer || []).map(item => item.organizer || item.name || '').filter(Boolean).join(', '),
      status: row.event_status || row.status, tags: [].concat(row.categories || [], row.tags || []).map(tag => tag.name || tag.slug || tag),
    };
    const sessions = explicitWordPressSessions(input, plan);
    if (sessions) warnings.push(...sessions.warnings);
    for (const candidate of sessions ? sessions.inputs : [input]) {
      const event = normalizeEvent(candidate, plan);
      if (event && inWindow(event, context)) events.push(event);
      else if (!event) warnings.push(`Skipped WordPress event ${row.id || '(no id)'}: invalid title, URL or explicit start date`);
    }
  }
  return { events, warnings, next: json.next_rest_url || json.next || null, ...(warnings.length ? { partial: true } : {}) };
}

/**
 * Parse the scoped Trumba JSON served by the SCS calendar API.
 * The provider's numeric UTC offsets qualify its local timestamps explicitly.
 * @param {Object[]} json Scoped calendar event array.
 * @param {Object} plan Source endpoint and timezone.
 * @param {Object} context Optional ingestion date window.
 * @return {Object} Normalized public events with validation diagnostics.
 */
export function parseTrumba(json, plan = {}, context = {}) {
  if (!Array.isArray(json)) throw new Error('Unexpected Trumba response: expected event array');
  const events = [];
  const warnings = [];
  for (const row of json) {
    const allDay = row.allDay === true;
    const qualify = (value, offset) => {
      if (!value) return null;
      if (allDay) return value.slice(0, 10);
      if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return value;
      return /^[+-]\d{4}$/.test(offset || '') ? `${value}${offset.slice(0, 3)}:${offset.slice(3)}` : value;
    };
    const fields = Object.fromEntries((row.customFields || []).map(field => [field.label, field.value]));
    const event = normalizeEvent({ uid: new URL(`/calendar/${encodeURIComponent(row.eventID)}`, plan.fetchUrl || plan.url).href, title: row.title,
      description: row.description, start: qualify(row.startDateTime, row.startTimeZoneOffset),
      end: allDay ? addDays(row.endDateTime?.slice(0, 10) || row.startDateTime?.slice(0, 10)) : qualify(row.endDateTime, row.endTimeZoneOffset),
      allDay, url: row.permaLinkUrl || new URL(`/calendar/${encodeURIComponent(row.eventID)}`, plan.fetchUrl || plan.url).href,
      location: row.location || [fields.Building, fields['Room Number']].filter(Boolean).join(', '),
      organizer: fields['Organization(s)'], tags: [].concat(fields['Event Type'] || []).filter(Boolean),
      status: row.canceled ? 'cancelled' : 'scheduled' }, plan);
    if (event && inWindow(event, context)) events.push(event);
    else if (!event) warnings.push(`Skipped Trumba event ${row.eventID || '(no id)'}: invalid title, URL or explicit start date`);
  }
  return { events, warnings, next: null, ...(warnings.length ? { partial: true } : {}) };
}

/**
 * Fetch paginated public JSON, restricting next-page links to the same origin.
 * @param {Object} plan LiveWhale or WordPress source endpoint.
 * @param {Object} context Fetch callback and date window.
 * @return {Promise<Object>} Complete bounded event collection and diagnostics.
 */
export async function fetchJsonEvents(plan, context) {
  let initial = plan.fetchUrl || plan.url;
  if (plan.adapter === 'wordpress') {
    const url = new URL(initial);
    const zone = plan.options?.timezone || 'America/New_York';
    // The Events Calendar defaults to events starting now. Explicit end/start
    // overlap bounds also retrieve ongoing events that began before the window.
    if (context.windowStart && !url.searchParams.has('ends_after')) {
      const date = localDate(context.windowStart, zone);
      if (!date) throw new Error('Invalid WordPress ingestion window start or source timezone');
      url.searchParams.set('ends_after', date);
    }
    if (context.windowEnd && !url.searchParams.has('starts_before')) {
      const date = localDate(context.windowEnd, zone);
      if (!date) throw new Error('Invalid WordPress ingestion window end or source timezone');
      url.searchParams.set('starts_before', date);
    }
    initial = url.href;
  }
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
      if (plan.options?.format === 'trumba-json') throw new Error('Scoped Trumba JSON endpoint returned ICS; rejected because export filters may be ignored');
      const result = parseIcs(text, plan, context);
      for (const event of result.events) events.set(event.uid, event);
      warnings.push(...result.warnings);
      if (result.partial) partial = true;
      url = null;
      break;
    }
    const parser = plan.options?.format === 'trumba-json' ? parseTrumba : plan.adapter === 'wordpress' ? parseWordPress : parseLiveWhale;
    const result = parser(JSON.parse(text), plan, context);
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
