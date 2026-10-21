import ICAL from 'ical.js';
import { absoluteUrl, isPlaceholderTitle, normalizeEvent, inWindow, plainText, zonedToIso } from '../lib/normalize.mjs';

/**
 * Validate calendar components before JavaScript can normalize invalid dates.
 * @param {ICAL.Time} time Source calendar date/time.
 * @return {boolean} Whether its wall-clock components represent a real date.
 */
function validCalendarTime(time) {
  if (!time) return false;
  const checked = new Date(Date.UTC(time.year, time.month - 1, time.day,
    time.hour || 0, time.minute || 0, time.second || 0));
  return checked.getUTCFullYear() === time.year && checked.getUTCMonth() + 1 === time.month
    && checked.getUTCDate() === time.day && checked.getUTCHours() === (time.hour || 0)
    && checked.getUTCMinutes() === (time.minute || 0) && checked.getUTCSeconds() === (time.second || 0);
}

/**
 * Convert an ICAL wall time using its declared zone or the source default.
 * @param {ICAL.Time} time Parsed iCalendar time.
 * @param {string} declaredZone Explicit property TZID when available.
 * @param {string} fallbackZone Source default timezone for floating times.
 * @return {string|null} ISO UTC timestamp or date-only value.
 */
function timeValue(time, declaredZone, fallbackZone) {
  if (!validCalendarTime(time)) return null;
  if (time.isDate) return time.toString().slice(0, 10);
  if (time.zone?.tzid === 'UTC' || time.zone?.tzid === 'Z') return time.toJSDate().toISOString();
  const timeZone = declaredZone || (time.zone?.tzid !== 'floating' && time.zone?.tzid) || fallbackZone;
  const fromIntl = zonedToIso(time, timeZone);
  if (fromIntl) return fromIntl;
  // Vendor VTIMEZONE definitions may use non-IANA TZIDs; ICAL owns those rules.
  if (time.zone?.component) return time.toJSDate().toISOString();
  return null;
}

/**
 * Explain an invalid source time without combining unrelated failure causes.
 * @param {ICAL.Time|null} time Source calendar date/time.
 * @param {string} field Calendar property name, such as DTSTART.
 * @param {string} zone Declared or fallback timezone.
 * @return {string} Precise missing-date, invalid-date or timezone diagnostic.
 */
function timeIssue(time, field, zone) {
  if (!time) return `${field} is missing`;
  if (!validCalendarTime(time)) return `${field} has invalid calendar components: ${time.toString()}`;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return `${field}=${time.toString()} is a nonexistent local time in ${zone}`;
  } catch {
    return `${field} declares unsupported TZID "${zone}" without a usable VTIMEZONE`;
  }
}

/**
 * Explain the exact fields that prevent one calendar occurrence from rendering.
 * @param {ICAL.Event} item Source master or exception.
 * @param {ICAL.Time} start Occurrence start.
 * @param {ICAL.Time} end Occurrence end.
 * @param {Object} plan Source defaults and public URL.
 * @param {ICAL.Event} master Master used for sparse exception inheritance.
 * @return {string[]} Specific field-level validation failures.
 */
function occurrenceIssues(item, start, end, plan, master = item) {
  const issues = [];
  if (!plainText(item.summary || master.summary).trim()) issues.push('SUMMARY is missing or empty');
  const zone = item.component.getFirstProperty('dtstart')?.getParameter('tzid')
    || master.component.getFirstProperty('dtstart')?.getParameter('tzid') || plan.options?.timezone || 'America/New_York';
  const endZone = item.component.getFirstProperty('dtend')?.getParameter('tzid') || zone;
  const startValue = timeValue(start, zone, zone);
  const endValue = timeValue(end, endZone, zone);
  if (!startValue) issues.push(timeIssue(start, 'DTSTART', zone));
  if (end && !endValue) issues.push(timeIssue(end, 'DTEND', endZone));
  if (startValue && endValue && Date.parse(endValue) < Date.parse(startValue)) issues.push('DTEND precedes DTSTART');
  const rawUrl = item.component.getFirstPropertyValue('url') || master.component.getFirstPropertyValue('url');
  if (!absoluteUrl(rawUrl || plan.url, plan.fetchUrl || plan.url) && !absoluteUrl(plan.url, plan.fetchUrl || plan.url)) issues.push('Source has no public HTTP(S) fallback URL');
  return issues;
}

/**
 * Prove a non-recurring record is outside the requested ingestion window.
 * Unknown dates/zones or recurrence rules remain unproven and cannot suppress
 * an extraction error for a potentially current event.
 * @param {ICAL.Component} component Source VEVENT.
 * @param {Object} plan Source timezone defaults.
 * @param {Object} bounds Explicit ingestion-window bounds.
 * @return {boolean} Whether the entire non-recurring event is outside the window.
 */
function outsideWindow(component, plan, bounds) {
  if (component.hasProperty('rrule') || component.hasProperty('rdate')) return false;
  try {
    const item = new ICAL.Event(component, { exceptions: [] });
    const zone = component.getFirstProperty('dtstart')?.getParameter('tzid') || plan.options?.timezone || 'America/New_York';
    const start = timeValue(item.startDate, zone, zone);
    const end = timeValue(item.endDate, component.getFirstProperty('dtend')?.getParameter('tzid') || zone, zone);
    return Boolean(start && end && Date.parse(end) >= Date.parse(start) && !inWindow({ start, end }, bounds));
  } catch { return false; }
}

/**
 * Describe source dates for an excluded-record diagnostic.
 * @param {ICAL.Component} component Source VEVENT.
 * @return {string} DTSTART/DTEND values and recurrence presence.
 */
function dateEvidence(component) {
  const start = component.getFirstPropertyValue('dtstart');
  const end = component.getFirstPropertyValue('dtend');
  return `DTSTART=${start?.toString() || '(missing)'}; DTEND=${end?.toString() || '(not specified)'}; ${component.hasProperty('rrule') || component.hasProperty('rdate') ? 'recurrence present' : 'no RRULE/RDATE'}`;
}

/**
 * Read the organizer display name while avoiding mailto-only UI labels.
 * @param {ICAL.Component} component VEVENT component.
 * @return {string} Organizer common name or source value.
 */
function organizerValue(component) {
  const property = component.getFirstProperty('organizer');
  return property?.getParameter('cn') || String(property?.getFirstValue() || '').replace(/^mailto:/i, '');
}

/**
 * Extract one occurrence while retaining its stable recurrence identity.
 * @param {ICAL.Event} item Master or exception event.
 * @param {ICAL.Time} start Occurrence start.
 * @param {ICAL.Time} end Occurrence end (exclusive for date-only events).
 * @param {string} recurrenceKey Original recurrence start identifier.
 * @param {Object} plan Source configuration.
 * @param {ICAL.Event} master Master fields used by sparse exceptions.
 * @return {Object|null} Event normalized to the ingestion contract.
 */
function occurrence(item, start, end, recurrenceKey, plan, master = item) {
  const component = item.component;
  const zone = component.getFirstProperty('dtstart')?.getParameter('tzid')
    || master.component.getFirstProperty('dtstart')?.getParameter('tzid');
  const endZone = component.getFirstProperty('dtend')?.getParameter('tzid') || zone;
  const fallback = plan.options?.timezone || 'America/New_York';
  const categories = component.getAllProperties('categories').flatMap(property => property.getValues());
  const rawUrl = component.getFirstPropertyValue('url') || master.component.getFirstPropertyValue('url');
  return normalizeEvent({
    uid: recurrenceKey ? `${master.uid}::${recurrenceKey}` : master.uid,
    title: item.summary || master.summary,
    description: item.description || master.description,
    start: timeValue(start, zone, fallback), end: timeValue(end, endZone, fallback),
    allDay: start?.isDate, timeZone: zone || fallback,
    location: item.location || master.location, url: rawUrl ? absoluteUrl(rawUrl, plan.fetchUrl || plan.url) || plan.url : plan.url,
    organizer: organizerValue(component) || organizerValue(master.component),
    status: component.getFirstPropertyValue('status') || master.component.getFirstPropertyValue('status'),
    tags: categories,
  }, plan);
}

/**
 * Parse RFC 5545 events, including recurrence exclusions and moved occurrences.
 * Expansion is bounded by a requested window and a safety limit. Floating times
 * explicitly use the plan's timezone (CMU Pittsburgh defaults to America/New_York).
 * @param {string} text Raw iCalendar document.
 * @param {Object} plan Source provenance and options.
 * @param {Object} context Window bounds and current instant.
 * @return {{events:Object[],warnings:string[]}} Normalized occurrences and diagnostics.
 */
export function parseIcs(text, plan = {}, context = {}) {
  if (!/^\s*BEGIN:VCALENDAR/im.test(text)) throw new Error('Response is not an iCalendar document');
  const calendar = new ICAL.Component(ICAL.parse(text));
  const warnings = [];
  let partial = false;
  const components = calendar.getAllSubcomponents('vevent');
  const now = new Date(context.now || Date.now());
  const upper = Date.parse(context.windowEnd || new Date(now.getTime() + 370 * 864e5).toISOString());
  const lower = context.windowStart || new Date(now.getTime() - 31 * 864e5).toISOString();
  const bounds = { windowStart: lower, windowEnd: new Date(upper).toISOString() };
  // ICAL resolves embedded VTIMEZONE definitions through this component tree.
  const records = new Map();
  for (const component of components) {
    const uid = component.getFirstPropertyValue('uid');
    if (!uid) {
      const outside = outsideWindow(component, plan, bounds);
      if (!outside) partial = true;
      warnings.push(`${outside ? 'Excluded out-of-window' : 'Skipped'} VEVENT: UID is missing; ${dateEvidence(component)}`);
      continue;
    }
    if (!records.has(uid)) records.set(uid, { masters: [], exceptions: [] });
    records.get(uid)[component.hasProperty('recurrence-id') ? 'exceptions' : 'masters'].push(component);
  }
  const events = new Map();
  const add = (event) => { if (event && inWindow(event, { windowStart: lower, windowEnd: new Date(upper).toISOString() })) events.set(event.uid, event); };
  for (const [uid, group] of records) {
    // Latest SEQUENCE wins when an export repeats revisions of one master.
    group.masters.sort((a, b) => +(b.getFirstPropertyValue('sequence') || 0) - +(a.getFirstPropertyValue('sequence') || 0));
    const masterComponent = group.masters[0];
    if (!masterComponent) {
      for (const component of group.exceptions) {
        try {
          const item = new ICAL.Event(component);
          const event = item.startDate ? occurrence(item, item.startDate, item.endDate, item.recurrenceId.toString(), plan) : null;
          if (event) add(event);
          else {
            const outside = outsideWindow(component, plan, bounds);
            if (!outside) partial = true;
            const issues = occurrenceIssues(item, item.startDate, item.endDate, plan);
            warnings.push(`${outside ? 'Excluded out-of-window' : 'Skipped'} detached exception ${uid}: ${issues.join('; ') || 'event normalization rejected the source record'}; ${dateEvidence(component)}`);
          }
        } catch (error) { partial = true; warnings.push(`Skipped detached exception ${uid}: ${error.message}`); }
      }
      continue;
    }
    try {
      const master = new ICAL.Event(masterComponent, { strictExceptions: true, exceptions: [] });
      if (!master.startDate) { partial = true; warnings.push(`Skipped ${uid}: missing DTSTART`); continue; }
      if (isPlaceholderTitle(master.summary)) {
        warnings.push(`Ignored schedule placeholder ${uid}: SUMMARY="${plainText(master.summary)}"; ${dateEvidence(masterComponent)}`);
        continue;
      }
      const issues = occurrenceIssues(master, master.startDate, master.endDate, plan);
      if (issues.length || !occurrence(master, master.startDate, master.endDate, '', plan)) {
        const outside = outsideWindow(masterComponent, plan, bounds)
          && group.exceptions.every(component => outsideWindow(component, plan, bounds));
        if (!outside) partial = true;
        warnings.push(`${outside ? 'Excluded out-of-window' : 'Skipped'} ${uid}: ${issues.join('; ') || 'event normalization rejected the source record'}; ${dateEvidence(masterComponent)}`);
        continue;
      }
      const rawUrl = masterComponent.getFirstPropertyValue('url');
      if (rawUrl && !absoluteUrl(rawUrl, plan.fetchUrl || plan.url)) {
        const scheme = String(rawUrl).match(/^([a-z][a-z\d+.-]*):/i)?.[1] || 'invalid';
        warnings.push(`Ignored non-web URL scheme "${scheme}:" for ${uid}; public source URL used instead; ${dateEvidence(masterComponent)}`);
      }
      const exceptions = new Map();
      for (const component of group.exceptions) {
        const exception = new ICAL.Event(component);
        exceptions.set(exception.recurrenceId.toString(), exception);
        // Sparse cancelled exceptions can omit DTSTART; handle those separately.
        if (exception.startDate && component.getFirstPropertyValue('status') !== 'CANCELLED') master.relateException(exception);
      }
      if (!master.isRecurring()) {
        add(occurrence(master, master.startDate, master.endDate, '', plan));
        continue;
      }
      const iterator = master.iterator();
      let next;
      let count = 0;
      const limit = Math.min(plan.options?.maxOccurrences || 100000, 250000);
      while (count++ < limit && (next = iterator.next())) {
        const key = next.toString();
        const nominal = timeValue(next, masterComponent.getFirstProperty('dtstart')?.getParameter('tzid'), plan.options?.timezone || 'America/New_York');
        // A moved exception can be inside the window even if its original date is
        // outside; explicit exceptions are also visited after this bounded loop.
        if (nominal && Date.parse(nominal) >= upper) break;
        const exception = exceptions.get(key);
        if (exception?.component.getFirstPropertyValue('status') === 'CANCELLED') {
          const end = next.clone();
          end.addDuration(master.duration);
          add(occurrence(exception, exception.startDate || next, exception.startDate ? exception.endDate : end, key, plan, master));
          continue;
        }
        const details = master.getOccurrenceDetails(next);
        add(occurrence(details.item, details.startDate, details.endDate, key, plan, master));
      }
      if (count >= limit) { partial = true; warnings.push(`Recurrence limit ${limit} reached for ${uid}; narrow the window or inspect the feed`); }
      for (const [key, exception] of exceptions) {
        if (exception.startDate) add(occurrence(exception, exception.startDate, exception.endDate, key, plan, master));
      }
    } catch (error) { partial = true; warnings.push(`Skipped ${uid}: ${error.message}`); }
  }
  if (components.some(component => component.getFirstProperty('dtstart') && !component.getFirstProperty('dtstart').getParameter('tzid')
    && !component.getFirstPropertyValue('dtstart').isDate && component.getFirstPropertyValue('dtstart').zone.tzid === 'floating')) {
    warnings.push(`Floating event times interpreted in ${plan.options?.timezone || 'America/New_York'}`);
  }
  return { events: [...events.values()], warnings: [...new Set(warnings)], ...(partial ? { partial: true } : {}) };
}

/**
 * Fetch an ICS source; Trumba, CampusGroups and Google exports share this parser.
 * @param {Object} plan Source endpoint configuration.
 * @param {Object} context Fetch function and ingestion time window.
 * @return {Promise<Object>} Parsed event result.
 */
export async function fetchIcs(plan, context) {
  return parseIcs(await context.fetchText(plan.fetchUrl || plan.url), plan, context);
}
