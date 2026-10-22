import * as cheerio from 'cheerio';
import { absoluteUrl, inWindow, normalizeEvent, plainText, summarize } from '../lib/normalize.mjs';
import { explicitTextDate, explicitTextEnd } from './html.mjs';

/**
 * Read the public CampusGroups list response using its published field order.
 * Separators and hidden member records are not public event announcements.
 * @param {Object[]} rows Anonymous mobile_events_list response.
 * @param {Object} plan Reviewed group endpoint and timezone.
 * @param {Object} context Date window.
 * @return {Object} Normalized events, provider count and diagnostics.
 */
export function parseCampusGroups(rows, plan, context = {}) {
  if (!Array.isArray(rows)) throw new Error('Unexpected CampusGroups response: expected public listing array');
  const events = [];
  const warnings = [];
  let total = 0;
  for (const row of rows) {
    if (typeof row.fields !== 'string') throw new Error('CampusGroups listing field map is missing');
    const fields = Object.fromEntries(row.fields.split(',').map((name, index) => [name, row[`p${index}`]]));
    if (!/^\d+$/.test(String(row.counter))) throw new Error('CampusGroups listing count is missing');
    total = Math.max(total, Number(row.counter));
    if (/^true$/i.test(fields.all_results_hidden || '')) {
      warnings.push('CampusGroups reports that listing results require member access');
      continue;
    }
    if (row.listingSeparator === 'true' || fields.displayType === 'separator') continue;
    const $ = cheerio.load(fields.eventDates || '');
    const paragraphs = $('p').toArray().map(element => plainText($(element).html()));
    const dates = paragraphs.filter(value => /\b20\d{2}\b/.test(value));
    const start = explicitTextDate(plainText(fields.eventDates));
    const end = dates.length > 1 ? explicitTextDate(dates.at(-1)) : explicitTextEnd(plainText(fields.eventDates), start);
    const expectedOffsets = plan.options?.expectedTimezoneLabels || [plan.options?.expectedTimezoneLabel].filter(Boolean);
    const event = expectedOffsets.length && !expectedOffsets.includes(fields.eventTimezone) ? null : normalizeEvent({
      uid: `campusgroups:${new URL(plan.fetchUrl || plan.url).host}:${fields.eventId}:${start}`,
      title: fields.eventName, start, end,
      timeZone: plan.options?.timezone,
      url: absoluteUrl(fields.eventUrlTitle || fields.eventUrl, plan.fetchUrl || plan.url),
      location: fields.eventLocation, organizer: fields.clubName,
      tags: [fields.eventCategory].filter(Boolean),
    }, plan);
    if (!/^\d+$/.test(fields.eventId || '') || !event || !fields.eventUrl) {
      warnings.push(`Skipped CampusGroups event ${fields.eventId || '(no id)'}: missing public date/link or unexpected timezone`);
    } else if (inWindow(event, context)) events.push(event);
  }
  return { events, warnings, total, ...(warnings.length ? { partial: true } : {}) };
}

/**
 * Fetch the same anonymous, group-filtered GET used by the public Events page.
 * Pagination follows the provider's range/limit contract, including hidden rows.
 * @param {Object} plan Reviewed public API URL and options.
 * @param {Object} context Fetch callback and date window.
 * @return {Promise<Object>} Bounded public events with explicit diagnostics.
 */
export async function fetchCampusGroups(plan, context) {
  const url = new URL(plan.fetchUrl || plan.url);
  const groupID = plan.options?.groupID;
  if (url.pathname !== '/mobile_ws/v17/mobile_events_list' || !/^\d+$/.test(String(groupID))
    || url.searchParams.get('filter2') !== String(groupID) || url.searchParams.has('update')) {
    throw new Error('CampusGroups requires the reviewed read-only group listing endpoint');
  }
  const limit = 40;
  const maxPages = Math.min(plan.options?.maxPages || 30, 100);
  const events = new Map();
  const warnings = [];
  let partial = false;
  let range = 0;
  let pending = true;
  for (let page = 0; page < maxPages && pending; page++) {
    url.searchParams.set('range', String(range));
    url.searchParams.set('limit', String(limit));
    const result = parseCampusGroups(JSON.parse(await context.fetchText(url.href)), plan, context);
    for (const event of result.events) events.set(event.uid, event);
    warnings.push(...result.warnings);
    partial ||= Boolean(result.partial);
    range += limit;
    pending = range < result.total;
  }
  if (pending) { partial = true; warnings.push('CampusGroups pagination limit reached; public events may be incomplete'); }
  if (plan.options?.publicDetails) for (const event of events.values()) {
    const detailURL = new URL(event.url);
    if (detailURL.origin !== url.origin || !/\/rsvp_boot$/.test(detailURL.pathname)) continue;
    try {
      const $ = cheerio.load(await context.fetchText(detailURL.href));
      if (plainText($('h1.rsvp__event-name').text()) !== event.title || !$('#event_details .card-block').length) {
        throw new Error('Public event description is unavailable or no longer matches the listing');
      }
      const details = $('#event_details .card-block').clone();
      details.find('.card-block__title,script,style').remove();
      event.description = plainText(details.html());
      event.summary = summarize(event.description);
    } catch (error) {
      partial = true;
      warnings.push(`CampusGroups public details (${event.url}): ${error.message}`);
    }
  }
  return { events: [...events.values()], warnings: [...new Set(warnings)], ...(partial ? { partial: true } : {}) };
}
