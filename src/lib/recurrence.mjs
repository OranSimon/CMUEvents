import { createHash } from 'node:crypto';

const FREQUENCIES = new Set(['daily', 'weekly', 'monthly', 'yearly', 'other']);
const SOURCES = new Set(['rrule', 'rdate', 'recurrence-id', 'provider', 'published-schedule']);
const WEEKDAYS = { monday: 'MO', tuesday: 'TU', wednesday: 'WE', thursday: 'TH', friday: 'FR', saturday: 'SA', sunday: 'SU' };
const ACTIVITY = '(?:[a-z-]+\\s+){0,4}(?:meetings?|practice|training|hours|sessions?|events?|conversations?|opportunity|bible study|study group|workshops?|seminars?|classes|class|gatherings?)';

/**
 * Preserve only explicit, portable recurrence metadata supplied by an adapter.
 * @param {unknown} input Candidate recurrence proof.
 * @return {Object|null} Validated recurrence descriptor or null without proof.
 */
export function normalizeRecurrence(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !SOURCES.has(input.source)
    || typeof input.seriesId !== 'string' || !input.seriesId.trim() || input.seriesId.length > 512
    || !FREQUENCIES.has(input.frequency) || !Number.isSafeInteger(input.interval) || input.interval < 1) return null;
  const result = { seriesId: input.seriesId.trim(), frequency: input.frequency, interval: input.interval, source: input.source };
  if (Array.isArray(input.byDay)) {
    const days = [...new Set(input.byDay.filter(day => typeof day === 'string' && /^(?:[+-]?(?:[1-9]|[1-4]\d|5[0-3]))?(?:MO|TU|WE|TH|FR|SA|SU)$/.test(day)))];
    if (days.length) result.byDay = days;
  }
  for (const field of ['seriesStart', 'until', 'updatedAt']) {
    if (typeof input[field] === 'string' && Number.isFinite(Date.parse(input[field]))) result[field] = input[field];
  }
  if (Number.isSafeInteger(input.count) && input.count >= 1) result.count = input.count;
  if (typeof input.hasOriginalUrl === 'boolean') result.hasOriginalUrl = input.hasOriginalUrl;
  if (typeof input.evidence === 'string' && input.evidence.trim()) result.evidence = input.evidence.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 320);
  return result;
}

/**
 * Build a stable series identity from a publisher, organizer and event label.
 * An unknown organizer keeps a per-record identity instead of combining clubs.
 * @param {Object} input Published event title, organizer, URL and optional UID.
 * @param {Object} plan Source publisher identity.
 * @return {string} Namespaced non-secret recurring-series identifier.
 */
export function publishedSeriesId(input, plan = {}) {
  let origin = '';
  try { origin = new URL(input.url || plan.url).origin; } catch { origin = plan.id || ''; }
  const organizer = String(input.organizer || '').trim().toLowerCase();
  const label = String(input.title || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const identity = organizer ? `${origin}|${organizer}|${label}` : `${origin}|${input.uid || input.url || plan.id}|${label}`;
  return `published:${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

/**
 * Read a direct publisher scheduling declaration without expanding appointments.
 * Titles and observed cadence cannot establish recurrence on their own.
 * @param {Object} input Plain published description and event identity fields.
 * @param {Object} plan Source publisher identity.
 * @return {Object|null} Recurrence evidence or null for an ordinary occurrence.
 */
export function publishedSchedule(input, plan = {}) {
  const text = String(input.description || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const leading = new RegExp(`^(?:(?:our|the|your|a)\\s+|join(?:\\s+(?:us|the\\s+[^.!?]{1,70}))?(?:\\s+for\\s+(?:our|the|their|a))?\\s+)?(daily|weekly|monthly|yearly)\\s+(?:on\\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?\\s*[,;:]?\\s+|${ACTIVITY})`, 'i');
  let match = text.match(leading);
  let frequency = match?.[1]?.toLowerCase();
  let interval = 1;
  let evidence = match ? text.slice(0, Math.min(320, (text.match(/[.!?](?:\s|$)/)?.index ?? 319) + 1)) : '';
  if (!match) {
    match = text.match(/\b(?:(?:this|the|our)\s+(?:group|event|class|session|meeting|seminar|workshop|series)|we)\s+(?:(?:will|regularly)\s+)?(?:meet(?:s)?|run(?:s)?|occur(?:s)?|take(?:s)?\s+place|is\s+held)\b[^.!?]{0,100}?\b(?:every\s+(?:(other)\s+)?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|on\s+(Mondays|Tuesdays|Wednesdays|Thursdays|Fridays|Saturdays|Sundays))\b/i);
    if (!match) match = text.match(/^every\s+(?:(other)\s+)?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b[^.!?]{0,160}/i);
    if (match) { frequency = 'weekly'; interval = match[1] ? 2 : 1; evidence = match[0]; }
  }
  if (!frequency) return null;
  const byDay = [...new Set([...evidence.matchAll(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)s?\b/gi)].map(day => WEEKDAYS[day[1].toLowerCase()]))];
  return normalizeRecurrence({ seriesId: publishedSeriesId(input, plan), frequency, interval, source: 'published-schedule', evidence,
    ...(byDay.length ? { byDay } : {}) });
}

/**
 * Read a provider's explicit frequency flag without treating range bounds as rules.
 * @param {Object} input Event fields plus a provider frequency and series identity.
 * @param {Object} plan Source publisher identity.
 * @return {Object|null} Provider-backed recurrence or description-backed fallback.
 */
export function providerRecurrence(input, plan = {}) {
  const value = String(input.frequency || '').trim().toLowerCase();
  const declared = publishedSchedule(input, plan);
  if (!FREQUENCIES.has(value) && declared) return normalizeRecurrence({ ...declared, ...(input.seriesId ? { seriesId: String(input.seriesId) } : {}) });
  const frequency = FREQUENCIES.has(value) ? value : input.isRecurring === true ? 'other' : null;
  if (!frequency) return publishedSchedule(input, plan);
  return normalizeRecurrence({ seriesId: String(input.seriesId || publishedSeriesId(input, plan)), frequency,
    interval: Number.isSafeInteger(input.interval) && input.interval >= 1 ? input.interval : 1, source: 'provider',
    evidence: input.frequency ? `Publisher recurrence frequency: ${value}` : 'Publisher marks this occurrence as recurring',
    ...(input.seriesStart ? { seriesStart: input.seriesStart } : {}), ...(input.until ? { until: input.until } : {}) });
}
