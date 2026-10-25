import * as cheerio from 'cheerio';
import { absoluteUrl, inWindow, normalizeEvent, parseDate, plainText } from '../lib/normalize.mjs';

const LISTING = 'https://community.cmu.edu/s/events';
const QUERY = 'https://community.cmu.edu/s/sfsites/aura';
const CLOCK = 'apex://CommunityEventTileController/ACTION$getEventStartDate';
const RECORD_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

/**
 * Decode the anonymous page bootstrap without executing publisher JavaScript.
 * @param {string} source Public bootstrap script.
 * @return {Object} Minimal guest framework context for the public clock getter.
 */
export function parseAlumniBootstrap(source) {
  const marker = 'Object.assign(window.Aura.appBootstrap,';
  const offset = source.indexOf(marker);
  if (offset < 0) throw Error('Alumni public bootstrap declaration is missing');
  const first = source.indexOf('{', offset + marker.length);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let last = -1;
  for (let i = first; first >= 0 && i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) { last = i + 1; break; }
  }
  if (last < 0) throw Error('Alumni public bootstrap JSON is incomplete');
  const json = JSON.parse(source.slice(first, last));
  const context = json.context;
  const site = context?.globalValueProviders?.find(value => value.type === '$Site')?.values;
  if (json.data?.app?.attributes?.values?.authenticated !== false || site?.isGuestUser !== true
    || context?.mode !== 'PROD' || context?.app !== 'siteforce:communityApp'
    || typeof context.fwuid !== 'string' || !context.fwuid
    || !context.loaded || typeof context.loaded !== 'object' || Array.isArray(context.loaded)) {
    throw Error('Alumni bootstrap no longer describes the reviewed anonymous public page');
  }
  return { mode: context.mode, fwuid: context.fwuid, app: context.app,
    loaded: context.loaded, dn: [], globals: {}, uad: true };
}

/**
 * Read only the explicitly verified card's venue mode.
 * @param {Object} row A reviewed public card, not a broad API record.
 * @return {boolean} Whether its visible location was explicitly online.
 */
export function alumniOnlineVenue(row) { return row?.mode === 'online'; }

/**
 * Validate the complete reviewed card identity before any publisher request.
 * @param {Object} row Reviewed title, date and public registration link.
 * @return {boolean} Whether this card can authorize its public clock lookup.
 */
function reviewedCardValid(row) {
  if (!row || typeof row.id !== 'string' || !RECORD_ID.test(row.id)
    || typeof row.title !== 'string' || !plainText(row.title).trim()
    || typeof row.url !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || '')
    || parseDate(row.date) !== row.date) return false;
  try {
    const parsed = new URL(absoluteUrl(row.url, LISTING));
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      && ['www.givecampus.com', 'givecampus.com'].includes(parsed.hostname)
      && parsed.pathname.startsWith('/schools/CarnegieMellonUniversity/events/');
  } catch { return false; }
}

/**
 * Parse the same public clock response consumed by the publisher's visible tiles.
 * @param {string} text Anonymous response.
 * @return {Object} Public startDate/timeZoneVal only.
 */
function getterValue(text) {
  const json = JSON.parse(text);
  const [action] = json.actions || [];
  if (json.actions?.length !== 1 || action?.state !== 'SUCCESS' || !action.returnValue) {
    throw Error('Alumni public clock getter did not return one successful result');
  }
  return { startDate: action.returnValue.startDate, timeZoneVal: action.returnValue.timeZoneVal };
}

/**
 * Retain reviewed public dates when live clocks are missing, ambiguous or moved.
 * Snapshot title/location are the only publisher fields read; hidden descriptions,
 * registration totals and addresses from the broad listing are never imported.
 * @param {Object[]} rows Explicitly reviewed card allowlist.
 * @param {Map<string,Object>} clocks Public clock results keyed by reviewed ID.
 * @param {Object} plan Source provenance and explicit online-only option.
 * @param {Object} context Collection window.
 * @return {Object} Partial occurrences and honest discovery/clock diagnostics.
 */
export function parseAlumniEvents(rows, clocks, plan = {}, context = {}) {
  if (!Array.isArray(rows)) throw Error('Alumni reviewed public cards must be an array');
  const events = new Map();
  const warnings = ['Alumni coverage is limited to explicitly reviewed public cards. New events, title/venue changes and full calendar discovery require another public review.'];
  for (const row of rows) {
    if (plan.options?.onlineOnly && !alumniOnlineVenue(row)) continue;
    const id = row?.id;
    if (!reviewedCardValid(row)) {
      warnings.push(`Skipped Alumni card ${id || '(no id)'}: reviewed public identity/date/link is invalid`);
      continue;
    }
    const url = absoluteUrl(row.url, LISTING);
    const clock = clocks.get(id);
    let timeZone = clock?.timeZoneVal;
    let instant = null;
    let clockDay = null;
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
      if (typeof timeZone === 'string' && typeof clock?.startDate === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(clock.startDate)) {
        instant = parseDate(clock.startDate, timeZone);
        if (instant) clockDay = formatter.format(new Date(instant));
      }
    } catch { /* Invalid public clock remains unknown. */ }
    const trustedClock = instant && clockDay === row.date && row.clockPolicy !== 'date_only';
    const start = trustedClock ? instant : row.date;
    let note = '';
    if (!trustedClock) {
      const reason = row.clockPolicy === 'date_only' ? 'the reviewed public clock has an unresolved timezone ambiguity'
        : clockDay && clockDay !== row.date ? 'the live clock now falls on a different calendar date'
          : 'a reliable public clock is unavailable';
      note = `Only the publicly reviewed date is shown because ${reason}. Confirm current details on the original event page.`;
      warnings.push(`Alumni card ${id}: ${reason}; retained reviewed date ${row.date} without a clock`);
      timeZone = plan.options?.timezone || 'America/New_York';
    }
    const event = normalizeEvent({ uid: `alumni:${id}`, title: row.title, start, timeZone,
      description: note, url, location: row.location,
      organizer: 'Carnegie Mellon University Alumni Association',
      ...(alumniOnlineVenue(row) ? { mode: 'online' } : {}),
    }, plan);
    if (event && inWindow(event, context)) events.set(event.uid, event);
  }
  return { events: [...events.values()], warnings, partial: true };
}

/**
 * Refresh clocks only for individually verified public cards, without invoking
 * the broad getEvents getter. Automatic discovery of new cards is still pending.
 * @param {Object} plan Explicit reviewedPublicEvents snapshot and scope.
 * @param {Object} context Safe public GET and allowlisted clock-query callbacks.
 * @return {Promise<Object>} Always-partial reviewed occurrences.
 */
export async function fetchAlumni(plan, context) {
  const snapshot = plan.options?.reviewedPublicEvents;
  if (snapshot?.listingURL !== LISTING || !Number.isFinite(Date.parse(snapshot?.checkedAt))
    || !Array.isArray(snapshot.records) || !snapshot.records.length || snapshot.records.length > 200
    || snapshot.records.some(row => !reviewedCardValid(row))
    || new Set(snapshot.records.map(row => row.id)).size !== snapshot.records.length) {
    throw Error('Alumni requires an explicitly reviewed public-card allowlist');
  }
  const html = await context.fetchText(LISTING, { cache: false });
  const $ = cheerio.load(html);
  const scripts = $('script[src]').toArray().map(element => new URL($(element).attr('src'), LISTING))
    .filter(url => url.origin === new URL(LISTING).origin && /^\/s\/sfsites\/l\//.test(url.pathname) && /\/bootstrap\.js$/.test(url.pathname));
  if (scripts.length !== 1) throw Error('Alumni public bootstrap script is missing or ambiguous');
  const auraContext = parseAlumniBootstrap(await context.fetchText(scripts[0].href, { cache: false }));
  const eligible = snapshot.records.filter(row => !plan.options?.onlineOnly || alumniOnlineVenue(row));
  const clocks = new Map();
  const warnings = [];
  for (let i = 0; i < eligible.length; i += 2) {
    await Promise.all(eligible.slice(i, i + 2).map(async row => {
      if (!RECORD_ID.test(row.id || '')) return;
      try {
        const body = new URLSearchParams({ message: JSON.stringify({ actions: [{ id: '1;a', descriptor: CLOCK,
          callingDescriptor: 'markup://c:Community_Event_Tile', params: { eventId: row.id } }] }),
        'aura.context': JSON.stringify(auraContext), 'aura.pageURI': '/s/events', 'aura.token': 'null' });
        if (typeof context.fetchPublicQuery !== 'function') throw Error('Anonymous clock-query callback is unavailable');
        clocks.set(row.id, getterValue(await context.fetchPublicQuery(QUERY, body.toString())));
      } catch (error) { warnings.push(`Alumni public tile clock (${row.id}): ${error.message}`); }
    }));
  }
  const result = parseAlumniEvents(snapshot.records, clocks, plan, context);
  return { ...result, warnings: [`Alumni public-card snapshot verified ${snapshot.checkedAt}.`, ...result.warnings, ...warnings] };
}
