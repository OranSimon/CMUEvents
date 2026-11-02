import { normalizeEvent, inWindow, addDays } from '../lib/normalize.mjs';

/**
 * Read the same anonymous monthly calendar used by the public Chabad SPA.
 * Only public RSVP event fields are retained, without enrollment/user metadata.
 * @param {Object} plan Verified public API URL, slug and public calendar URL.
 * @param {Object} context Safe fetchText and bounded collection window.
 * @return {Promise<Object>} Public occurrences and partial month diagnostics.
 */
export async function fetchChabadCalendar(plan, context) {
  const now = new Date(context.now || Date.now());
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: plan.options?.timezone || 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit' });
  const localDay = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : formatter.format(new Date(value));
  const lower = localDay(context.windowStart || new Date(now - 30 * 864e5));
  const upper = localDay(context.windowEnd || new Date(+now + 365 * 864e5));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lower) || !/^\d{4}-\d{2}-\d{2}$/.test(upper) || upper < lower) throw new Error('Invalid public calendar window');
  const endpoint = new URL(plan.fetchUrl);
  if (endpoint.origin !== 'https://api.chabadoncampus.org' || endpoint.pathname !== '/api/1.0/chabadHouses/public/calendar') throw new Error('Unverified Chabad public calendar endpoint');
  const events = new Map();
  const warnings = [];
  let cursor = `${lower.slice(0, 7)}-01`;
  let months = 0;
  let completed = 0;
  while (cursor <= upper && months++ < 15) {
    const next = new Date(`${cursor}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const nextMonth = next.toISOString().slice(0, 10);
    const url = new URL(endpoint);
    url.searchParams.set('startDate', cursor < lower ? lower : cursor);
    url.searchParams.set('endDate', addDays(nextMonth, -1) > upper ? upper : addDays(nextMonth, -1));
    url.searchParams.set('myEventsOnly', 'false');
    try {
      const json = JSON.parse(await context.fetchText(url.href));
      if (!Array.isArray(json.payload)) throw new Error('Public calendar payload is not an array');
      completed++;
      for (const item of json.payload) {
        if (item.type !== 'RsvpEvent') continue;
        if (!Number.isSafeInteger(item.rsvpEventScheduleID) || item.rsvpEventScheduleID < 0) {
          warnings.push(`Public RSVP event without a valid schedule ID (${cursor})`); continue;
        }
        const event = normalizeEvent({ uid: item.rsvpEventScheduleID ? `chabad-rsvp-${item.rsvpEventScheduleID}` : undefined, title: item.name,
          start: item.dateTime, location: item.location,
          url: item.rsvpEventScheduleID ? new URL(`rsvp/events/${item.rsvpEventScheduleID}`, plan.url.replace(/calendar\/?$/, '')).href : plan.url,
          description: item.isRsvpEventEligibilityRestricted ? 'The organizer marks registration eligibility as restricted. Check the public event page for requirements.'
            : 'Check the event page for registration and audience requirements. End time is not listed.' }, plan);
        if (!event) warnings.push(`Public RSVP event ${item.rsvpEventScheduleID} has an invalid title/date`);
        else if (inWindow(event, context)) events.set(event.uid, event);
      }
    } catch (error) { warnings.push(`Public calendar month ${cursor} failed: ${error.message}`); }
    cursor = nextMonth;
  }
  if (cursor <= upper) warnings.push('Public calendar month limit reached; remaining dates need review');
  if (!completed) throw new Error(warnings.join(' ') || 'No public calendar months could be read');
  return { events: [...events.values()], warnings, ...(warnings.length ? { partial: true } : {}) };
}
