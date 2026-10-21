import ICAL from 'ical.js';
import { normalizeEvent, inWindow, zonedToIso } from '../lib/normalize.mjs';

/**
 * Convert an ICAL wall time using its declared zone or the source default.
 * @param {ICAL.Time} time Parsed iCalendar time.
 * @param {string} declaredZone Explicit property TZID when available.
 * @param {string} fallbackZone Source default timezone for floating times.
 * @return {string|null} ISO UTC timestamp or date-only value.
 */
function timeValue(time, declaredZone, fallbackZone) {
  if (!time) return null;
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
  const fallback = plan.options?.timezone || 'America/New_York';
  const categories = component.getAllProperties('categories').flatMap(property => property.getValues());
  const rawUrl = component.getFirstPropertyValue('url') || master.component.getFirstPropertyValue('url');
  return normalizeEvent({
    uid: recurrenceKey ? `${master.uid}::${recurrenceKey}` : master.uid,
    title: item.summary || master.summary,
    description: item.description || master.description,
    start: timeValue(start, zone, fallback), end: timeValue(end, zone, fallback),
    allDay: start?.isDate, timeZone: zone || fallback,
    location: item.location || master.location, url: rawUrl || plan.url,
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
  // ICAL resolves embedded VTIMEZONE definitions through this component tree.
  const records = new Map();
  for (const component of components) {
    const uid = component.getFirstPropertyValue('uid');
    if (!uid) { partial = true; warnings.push('Skipped VEVENT with no UID'); continue; }
    if (!records.has(uid)) records.set(uid, { masters: [], exceptions: [] });
    records.get(uid)[component.hasProperty('recurrence-id') ? 'exceptions' : 'masters'].push(component);
  }
  const now = new Date(context.now || Date.now());
  const upper = Date.parse(context.windowEnd || new Date(now.getTime() + 370 * 864e5).toISOString());
  const lower = context.windowStart || new Date(now.getTime() - 31 * 864e5).toISOString();
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
          else { partial = true; warnings.push(`Skipped detached exception ${uid}: missing usable event fields`); }
        } catch (error) { partial = true; warnings.push(`Skipped detached exception ${uid}: ${error.message}`); }
      }
      continue;
    }
    try {
      const master = new ICAL.Event(masterComponent, { strictExceptions: true, exceptions: [] });
      if (!master.startDate) { partial = true; warnings.push(`Skipped ${uid}: missing DTSTART`); continue; }
      if (!occurrence(master, master.startDate, master.endDate, '', plan)) {
        partial = true;
        warnings.push(`Skipped ${uid}: missing usable title, timezone or explicit date`);
        continue;
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
