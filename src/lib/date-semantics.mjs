import { addDays, parseDate } from './normalize.mjs';

const MONTH_NAMES = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const MONTH_NUMBERS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const YEAR = '(?:19|20|21)\\d{2}';
const ZONE_OFFSETS = { UTC: 0, GMT: 0, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420, JST: 540 };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Validate explicit calendar components without normalizing impossible dates.
 * @param {number} year Published or explicitly scoped year.
 * @param {number} month Published month number.
 * @param {number} day Published day number.
 * @return {string|null} Valid ISO calendar date.
 */
function calendarDate(year, month, day) {
  if (!year || !month || !day) return null;
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return parseDate(value);
}

/**
 * Extract calendar dates and inclusive ranges from one bounded semantic field.
 * Missing years may inherit one explicit field/title year, never the current year.
 * Descending cross-year ranges require an explicit year at both endpoints.
 * @param {string} text Publisher text from a summary, agenda heading or deadline.
 * @param {Object} options Optional fallbackYear from an explicit enclosing scope.
 * @return {Object} Spans with text offsets and validation issues.
 */
export function extractCalendarSpans(text, options = {}) {
  const value = String(text || '').replace(/[\u2012-\u2014\u2212]/g, '-');
  const spans = [];
  const issues = [];
  const occupied = [];
  const range = new RegExp(`\\b(${MONTH_NAMES})\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(${YEAR}))?\\s*(?:-|to|through)\\s*(?:(${MONTH_NAMES})\\.?\\s*)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(${YEAR}))?\\b`, 'gi');
  for (const match of value.matchAll(range)) {
    const startMonth = MONTH_NUMBERS[match[1].slice(0, 3).toLowerCase()];
    const endMonth = match[4] ? MONTH_NUMBERS[match[4].slice(0, 3).toLowerCase()] : startMonth;
    const startYear = Number(match[3] || match[6] || options.fallbackYear) || null;
    const endYear = Number(match[6] || match[3] || options.fallbackYear) || null;
    const start = calendarDate(startYear, startMonth, Number(match[2]));
    const end = calendarDate(endYear, endMonth, Number(match[5]));
    const ambiguousYear = endMonth < startMonth && !(match[3] && match[6]);
    const valid = Boolean(start && end && end >= start && !ambiguousYear);
    const span = { text: match[0], index: match.index, length: match[0].length,
      start: valid ? start : null, end: valid ? end : null, range: true,
      explicitYear: Boolean(match[3] || match[6]), month: startMonth, day: Number(match[2]) };
    spans.push(span);
    occupied.push([match.index, match.index + match[0].length]);
    if (!valid) issues.push(`Invalid or ambiguous calendar range: ${match[0]}`);
  }
  const single = new RegExp(`\\b(${MONTH_NAMES})\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(${YEAR}))?\\b`, 'gi');
  for (const match of value.matchAll(single)) {
    if (occupied.some(([start, end]) => match.index >= start && match.index < end)) continue;
    const month = MONTH_NUMBERS[match[1].slice(0, 3).toLowerCase()];
    const year = Number(match[3] || options.fallbackYear) || null;
    const start = calendarDate(year, month, Number(match[2]));
    spans.push({ text: match[0], index: match.index, length: match[0].length,
      start, end: start, range: false, explicitYear: Boolean(match[3]), month, day: Number(match[2]) });
    if (year && !start) issues.push(`Invalid calendar date: ${match[0]}`);
  }
  return { spans: spans.sort((left, right) => left.index - right.index), issues };
}

/**
 * Read advertised clock intervals without treating agenda slots as event hours.
 * An AM/PM marker is required; ambiguous descending shared-marker clocks fail.
 * @param {string} text Bounded event summary text, optionally with timezone aliases.
 * @return {Object[]} Clock intervals with optional published UTC offset.
 */
export function extractAdvertisedClocks(text) {
  const marker = '[ap](?:\\.?m\\.?)?';
  const pattern = new RegExp(`(?<![\\d:/])([0-2]?\\d)(?::([0-5]\\d))?\\s*(${marker})?\\s*[-–—]\\s*([0-2]?\\d)(?::([0-5]\\d))?\\s*(${marker})\\b(?:\\s*(UTC|GMT|[ECMP][SD]T|JST)\\b)?`, 'gi');
  const clocks = [];
  for (const match of String(text || '').matchAll(pattern)) {
    const startMarker = (match[3] || match[6]).toLowerCase()[0];
    const endMarker = match[6].toLowerCase()[0];
    const startHour = Number(match[1]);
    const endHour = Number(match[4]);
    if (startHour < 1 || startHour > 12 || endHour < 1 || endHour > 12) continue;
    const startMinutes = (startHour % 12 + (startMarker === 'p' ? 12 : 0)) * 60 + Number(match[2] || 0);
    const endMinutes = (endHour % 12 + (endMarker === 'p' ? 12 : 0)) * 60 + Number(match[5] || 0);
    if (endMinutes <= startMinutes) continue;
    clocks.push({ startMinutes, endMinutes, offset: match[7] ? ZONE_OFFSETS[match[7].toUpperCase()] : null, text: match[0] });
  }
  return clocks;
}

/**
 * Convert a dated advertised clock using its explicit offset or source timezone.
 * @param {string} date ISO calendar date.
 * @param {number} minutes Wall-clock minutes since midnight.
 * @param {number|null} offset Published UTC offset in minutes, when available.
 * @param {string} timeZone Configured source IANA timezone.
 * @return {string|null} UTC datetime with a validated source date.
 */
function datedClock(date, minutes, offset, timeZone) {
  if (offset !== null) return new Date(Date.parse(`${date}T00:00:00Z`) + (minutes - offset) * 60_000).toISOString();
  return parseDate(`${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`, timeZone);
}

/**
 * Resolve main event dates, repeated occurrences, series sessions and agenda dates.
 * Only explicitly supplied semantic scopes participate in consistency decisions.
 * @param {Object} fields Title, summary text, dated agenda/session headings and timezone.
 * @return {Object} Occurrences, date roles, resolution decision and real conflicts.
 */
export function resolveEventDateRoles(fields) {
  const titleYears = [...new Set(String(fields.title || '').match(/\b(?:19|20|21)\d{2}\b/g) || [])].map(Number);
  const summary = extractCalendarSpans(fields.summary, { fallbackYear: titleYears.length === 1 ? titleYears[0] : undefined });
  const conflicts = [...summary.issues];
  const notes = [];
  const primary = summary.spans.filter(span => span.start);
  const unresolvedSummary = summary.spans.some(span => !span.start);
  if (unresolvedSummary && !summary.issues.length) conflicts.push('A main event date lacks an explicitly scoped valid year');
  const roles = primary.map(span => ({ role: 'main', start: span.start, end: span.end, text: span.text }));
  const agenda = [];
  const sessions = [];
  const mainYears = [...new Set(primary.flatMap(span => [Number(span.start.slice(0, 4)), Number(span.end.slice(0, 4))]))];
  for (const [role, texts] of [['agenda', fields.agenda || []], ['session', fields.sessions || []], ['auxiliary', fields.auxiliary || []]]) {
    for (const text of texts) {
      const read = extractCalendarSpans(text, { fallbackYear: mainYears.length === 1 ? mainYears[0] : undefined });
      if (role !== 'auxiliary') conflicts.push(...read.issues);
      for (const span of read.spans) {
        // A yearless agenda day across a declared year boundary must fit exactly
        // one explicit main interval; a footer year is never an eligible fallback.
        if (!span.start && !span.explicitYear && !span.range && mainYears.length > 1) {
          const eligible = mainYears.map(year => calendarDate(year, span.month, span.day))
            .filter(date => date && primary.some(main => date >= main.start && date <= main.end));
          if (eligible.length === 1) span.start = span.end = eligible[0];
        }
        roles.push({ role, start: span.start, end: span.end, text: span.text });
        if (!span.start && role !== 'auxiliary' && !read.issues.length) conflicts.push(`Agenda/session date lacks a unique valid scoped year: ${span.text}`);
        if (!span.start || role === 'auxiliary') continue;
        const weekday = String(text).slice(Math.max(0, span.index - 18), span.index).match(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s*,?\s*$/i);
        const actualWeekday = WEEKDAYS[new Date(`${span.start}T12:00:00Z`).getUTCDay()];
        if (weekday && weekday[1].toLowerCase() !== actualWeekday.toLowerCase()) {
          notes.push({ code: 'publisher-weekday-date-mismatch', role, date: span.start,
            publishedWeekday: weekday[1], calendarWeekday: actualWeekday, evidence: text });
        }
        if (role === 'agenda') agenda.push(span);
        if (role === 'session') sessions.push(span);
      }
    }
  }
  if (!primary.length) conflicts.push('No valid explicit main event date in the event summary');
  if (titleYears.length && primary.some(span => !titleYears.some(year => year >= Number(span.start.slice(0, 4)) && year <= Number(span.end.slice(0, 4))))) {
    conflicts.push(`Title year(s) ${titleYears.join(', ')} conflict with the main event date`);
  }
  for (const span of [...agenda, ...sessions]) {
    if (!primary.some(main => span.start >= main.start && span.end <= main.end)) {
      conflicts.push(`Agenda/session date ${span.start}${span.end !== span.start ? `–${span.end}` : ''} conflicts with the main event date`);
    }
  }
  const series = primary.some(span => span.range) && /\b(?:series|alternating|weekly|biweekly|every|(?:Mondays|Tuesdays|Wednesdays|Thursdays|Fridays|Saturdays|Sundays))\b/i.test(fields.summary || '');
  if (series && !sessions.length) conflicts.push('A recurring series envelope has no explicitly dated session headings; recurrence was not invented');
  const selected = series ? sessions : primary;
  const occurrences = new Map();
  for (const span of selected) {
    let clockText = fields.summary || '';
    if (!series) {
      const position = summary.spans.indexOf(span);
      clockText = String(fields.summary || '').slice(span.index + span.length, summary.spans[position + 1]?.index);
      if (primary.length === 1 && !extractAdvertisedClocks(clockText).length) clockText = fields.summary || '';
    }
    const clocks = span.range ? [] : extractAdvertisedClocks(clockText);
    if (!clocks.length) {
      const occurrence = { start: span.start, end: addDays(span.end), precision: 'date' };
      occurrences.set(`${occurrence.start}|${occurrence.end}`, occurrence);
    } else {
      for (const clock of clocks) {
        const start = datedClock(span.start, clock.startMinutes, clock.offset, fields.timeZone);
        const end = datedClock(span.end, clock.endMinutes, clock.offset, fields.timeZone);
        if (!start || !end) { conflicts.push(`Invalid advertised clock on ${span.start}: ${clock.text}`); continue; }
        occurrences.set(`${start}|${end}`, { start, end, precision: 'time' });
      }
    }
  }
  return { occurrences: conflicts.length ? [] : [...occurrences.values()],
    roles: [...new Map(roles.map(role => [`${role.role}|${role.start}|${role.end}|${role.text}`, role])).values()], notes,
    decision: conflicts.length ? !primary.length || unresolvedSummary || (series && !sessions.length) ? 'unresolved' : 'conflict' : series ? 'explicit-series-sessions' : primary.length > 1 || occurrences.size > 1 ? 'repeated-occurrences' : primary[0]?.range ? 'multiday-range' : 'single-occurrence',
    conflicts: [...new Set(conflicts)] };
}
