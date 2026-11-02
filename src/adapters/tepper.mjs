import { normalizeEvent, inWindow } from '../lib/normalize.mjs';

/**
 * Whitelist public seminar fields from the Tepper seminar tracker response.
 * Unrelated personnel, coordinator and travel data are never copied.
 * @param {Object} json Public Kendo event-list response.
 * @param {Object} plan Source options and provenance.
 * @param {Object} context Date window.
 * @return {{events:Object[],total:number,warnings:string[]}} Whitelisted event page.
 */
export function parseTepper(json, plan = {}, context = {}) {
  if (!Array.isArray(json.Data)) throw new Error('Unexpected Tepper response: expected Data array');
  const events = [];
  const warnings = [];
  for (const row of json.Data) {
    if (row.SeminarId === undefined || row.SeminarId === null) { warnings.push('Skipped Tepper seminar with no public SeminarId'); continue; }
    const event = normalizeEvent({
      uid: `tepper:${row.SeminarId}`, title: row.SeminarTitle,
      start: row.SeminarDate, end: row.SeminarEndDate, description: row.Abstract,
      location: row.SeminarLocation, status: row.Cancelled ? 'cancelled' : 'scheduled',
      url: `https://seminartracker.tepper.cmu.edu/SeminarDetail?SeminarId=${encodeURIComponent(row.SeminarId)}`,
      tags: row.SeminarAreaList || [],
    }, plan);
    if (event && inWindow(event, context)) events.push(event);
    else if (!event) warnings.push(`Skipped Tepper seminar ${row.SeminarId}: missing explicit title or date`);
  }
  return { events, total: +json.Total || json.Data.length, warnings };
}

/**
 * Fetch bounded Kendo pages from the public Tepper seminar tracker endpoint.
 * @param {Object} plan Exact public endpoint and page-limit options.
 * @param {Object} context Safe fetch callback and date window.
 * @return {Promise<Object>} Whitelisted normalized seminar events and diagnostics.
 */
export async function fetchTepper(plan, context) {
  const events = new Map();
  const warnings = [];
  let partial = false;
  const seenRows = new Set();
  const limit = Math.min(plan.options?.maxPages || 20, 100);
  const size = 100;
  for (let page = 1; page <= limit; page++) {
    const url = new URL(plan.fetchUrl || plan.url);
    url.searchParams.set('pageSize', String(size));
    url.searchParams.set('page', String(page));
    url.searchParams.set('skip', String((page - 1) * size));
    url.searchParams.set('take', String(size));
    const json = JSON.parse(await context.fetchText(url.href, { cache: false }));
    const result = parseTepper(json, plan, context);
    const rowIds = json.Data.map(row => String(row.SeminarId));
    const repeatedPage = page > 1 && rowIds.length > 0 && rowIds.every(id => seenRows.has(id));
    for (const id of rowIds) seenRows.add(id);
    for (const event of result.events) events.set(event.uid, event);
    warnings.push(...result.warnings);
    if (result.warnings.length) partial = true;
    if (page * size >= result.total || !json.Data.length) break;
    if (repeatedPage) { partial = true; warnings.push('Tepper pagination returned a repeated page; stopped to avoid a loop'); break; }
    if (page === limit) { partial = true; warnings.push(`Tepper pagination limit ${limit} reached`); }
  }
  return { events: [...events.values()], warnings, ...(partial ? { partial: true } : {}) };
}
