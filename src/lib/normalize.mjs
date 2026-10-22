import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';

/**
 * Convert source HTML into safe, readable plain text.
 * @param {unknown} value Source text or markup.
 * @return {string} Whitespace-normalized text without scripts or style rules.
 */
export function plainText(value) {
  if (value === undefined || value === null) return '';
  const $ = cheerio.load(String(value));
  $('script,style,noscript,svg').remove();
  $('br,p,div,li,h1,h2,h3,h4,tr').each((_, element) => $(element).append('\n'));
  return $.root().text().replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Resolve and validate an original public source link.
 * @param {unknown} value Absolute or relative link.
 * @param {string} base Listing or feed URL.
 * @return {string} HTTP(S) URL, or an empty string for unsafe links.
 */
export function absoluteUrl(value, base) {
  try {
    const url = new URL(String(value || ''), base);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

/**
 * Interpret wall-clock components in an IANA zone using the runtime tz database.
 * @param {Object} parts Year, month, day, hour, minute and second components.
 * @param {string} timeZone Source IANA time-zone identifier.
 * @return {string|null} UTC ISO instant, or null when the zone/date is invalid.
 */
export function zonedToIso(parts, timeZone = 'America/New_York') {
  try {
    const desired = Date.UTC(parts.year, parts.month - 1, parts.day,
      parts.hour || 0, parts.minute || 0, parts.second || 0);
    const calendar = new Date(desired);
    if (calendar.getUTCFullYear() !== parts.year || calendar.getUTCMonth() + 1 !== parts.month
      || calendar.getUTCDate() !== parts.day || calendar.getUTCHours() !== (parts.hour || 0)
      || calendar.getUTCMinutes() !== (parts.minute || 0) || calendar.getUTCSeconds() !== (parts.second || 0)) return null;
    const checked = new Date(desired);
    if (checked.getUTCFullYear() !== +parts.year || checked.getUTCMonth() !== +parts.month - 1
      || checked.getUTCDate() !== +parts.day || checked.getUTCHours() !== +(parts.hour || 0)
      || checked.getUTCMinutes() !== +(parts.minute || 0) || checked.getUTCSeconds() !== +(parts.second || 0)) return null;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    let instant = desired;
    for (let attempt = 0; attempt < 4; attempt++) {
      const rendered = Object.fromEntries(formatter.formatToParts(instant)
        .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
      const displayed = Date.UTC(rendered.year, rendered.month - 1, rendered.day,
        rendered.hour, rendered.minute, rendered.second);
      const delta = desired - displayed;
      instant += delta;
      if (delta === 0) return new Date(instant).toISOString();
    }
    // Nonexistent local times during a DST jump must not silently move events.
    return null;
  } catch { return null; }
}

/**
 * Parse an explicit source date while preserving date-only precision.
 * @param {unknown} value ISO date, offset datetime or epoch timestamp.
 * @param {string} timeZone Source timezone for local ISO timestamps.
 * @return {string|null} Date-only value or ISO UTC timestamp.
 */
export function parseDate(value, timeZone = 'America/New_York') {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d{10,13}$/.test(String(value))) {
    const number = Number(value);
    const timestamp = number < 1e12 ? number * 1000 : number;
    const instant = new Date(timestamp);
    return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
  }
  const text = String(value).trim();
  const datePrefix = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (datePrefix) {
    const checked = new Date(`${datePrefix[1]}T00:00:00Z`);
    if (!Number.isFinite(checked.getTime()) || !checked.toISOString().startsWith(datePrefix[1])) return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().startsWith(text) ? text : null;
  }
  const local = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) return zonedToIso({ year: +local[1], month: +local[2], day: +local[3],
    hour: +local[4], minute: +local[5], second: +(local[6] || 0) }, timeZone);
  // Require a year and explicit timezone for non-ISO strings; Date.parse alone
  // would otherwise invent the execution host's local timezone.
  if (!/\d{4}/.test(text) || !/(?:Z|[+-]\d{2}:?\d{2}|\bGMT\b|\bUTC\b)$/i.test(text)) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

/**
 * Add days to an ISO date without applying local timezone conversion.
 * @param {string} date ISO date-only string.
 * @param {number} days Calendar-day count.
 * @return {string} Date-only string.
 */
export function addDays(date, days = 1) {
  const result = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/**
 * Build a concise deterministic excerpt, without claiming AI summarization.
 * @param {unknown} description Source event description.
 * @return {string} Plain-text excerpt limited to 320 characters.
 */
export function summarize(description) {
  const text = plainText(description).replace(/\s+/g, ' ');
  if (text.length <= 320) return text;
  const prefix = text.slice(0, 317);
  return `${prefix.slice(0, Math.max(prefix.lastIndexOf(' '), 260)).trim()}…`;
}

/**
 * Identify explicitly empty schedule slots instead of treating them as events.
 * @param {unknown} value Source event title or schedule-slot label.
 * @return {boolean} Whether the title states that no talk/seminar is scheduled.
 */
export function isPlaceholderTitle(value) {
  return /^(?:[-–—]+|no (?:talk|seminar)(?:\b.*)?|tbd|tba)$/i.test(plainText(value).replace(/\s+/g, ' '));
}

/**
 * Enforce the shared event contract and reject invented or missing dates.
 * @param {Object} input Adapter event fields.
 * @param {Object} plan Source provenance and adapter options.
 * @return {Object|null} Normalized event, or null when title/date/link is absent.
 */
export function normalizeEvent(input, plan = {}) {
  const timeZone = input.timeZone || plan.options?.timezone || 'America/New_York';
  let start = parseDate(input.start, timeZone);
  const title = plainText(input.title).replace(/\s+/g, ' ');
  const url = absoluteUrl(input.url || plan.url, plan.fetchUrl || plan.url);
  if (!start || !title || !url || isPlaceholderTitle(title)) return null;
  const allDay = input.allDay === true || start.length === 10;
  const timePrecision = start.length === 10 ? (input.allDay === true ? 'all-day' : 'date') : input.allDay === true ? 'all-day' : 'time';
  let end = parseDate(input.end, timeZone);
  if (allDay) {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
      if (start.length > 10) start = formatter.format(new Date(start));
      if (end?.length > 10) end = formatter.format(new Date(end));
    } catch { return null; }
  }
  if (!end) end = allDay ? addDays(start) : start;
  if (end < start || (allDay && end === start)) end = allDay ? addDays(start) : start;
  const description = plainText([input.description, plan.options?.eventContext].filter(Boolean).join('\n'));
  const uid = String(input.uid || createHash('sha256').update(`${url}|${start}|${title}`).digest('hex').slice(0, 24));
  return {
    uid, title, description, summary: summarize(input.summary || description),
    start, end, allDay, timePrecision, timeZone, location: plainText(input.location), url,
    organizer: plainText(input.organizer),
    status: /cancel/i.test(input.status || '') ? 'cancelled' : /postpon/i.test(input.status || '') ? 'postponed' : 'scheduled',
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.campus ? { campus: input.campus } : {}),
    tags: Array.isArray(input.tags) ? input.tags.map(plainText).filter(Boolean) : [],
  };
}

/**
 * Keep events that overlap the requested ingestion window.
 * @param {Object} event Normalized event.
 * @param {Object} context Optional windowStart/windowEnd bounds.
 * @return {boolean} Whether the event intersects the requested window.
 */
export function inWindow(event, context = {}) {
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  const lower = context.windowStart ? Date.parse(context.windowStart) : -Infinity;
  const upper = context.windowEnd ? Date.parse(context.windowEnd) : Infinity;
  return start < upper && (end > lower || (start === end && start >= lower));
}
