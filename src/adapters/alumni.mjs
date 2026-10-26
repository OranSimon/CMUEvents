import * as cheerio from 'cheerio';
import { absoluteUrl, inWindow, normalizeEvent, parseDate, plainText } from '../lib/normalize.mjs';
import { explicitTextDate, explicitTextEnd } from './html.mjs';

const LISTING = 'https://community.cmu.edu/s/events';
const QUERY = 'https://community.cmu.edu/s/sfsites/aura';
const CLOCK = 'apex://CommunityEventTileController/ACTION$getEventStartDate';
const RECORD_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const PUBLIC_ZONES = {
  AEDT: ['+11:00', 'Australia/Sydney'], AEST: ['+10:00', 'Australia/Brisbane'],
  EDT: ['-04:00', 'Etc/GMT+4'], EST: ['-05:00', 'Etc/GMT+5'],
  PDT: ['-07:00', 'Etc/GMT+7'], PST: ['-08:00', 'Etc/GMT+8'],
  HST: ['-10:00', 'Pacific/Honolulu'], JST: ['+09:00', 'Asia/Tokyo'],
  UTC: ['+00:00', 'UTC'], GMT: ['+00:00', 'UTC'],
};

/**
 * Accept only a visible card's original public CMU registration link.
 * @param {string} value Link read from the anonymous visible listing.
 * @return {string|null} Canonical public URL, or null outside that scope.
 */
function publicEventUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search
      && ['www.givecampus.com', 'givecampus.com'].includes(url.hostname)
      && /^\/schools\/CarnegieMellonUniversity\/events\/[^/]+\/?$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

/**
 * Normalize the current original Event Details card, excluding signup deadlines.
 * Only unambiguous printed zone abbreviations establish an instant; unsupported
 * zones retain date precision instead of borrowing a clock or location default.
 * @param {Object} detail Visible title, Event Details and Details-tab text.
 * @return {Object|null} Explicit public fields and clock uncertainty.
 */
export function parseAlumniPublicDetail(detail) {
  const lines = String(detail?.detailText || '').split(/\n+/).map(line => line.trim()).filter(Boolean);
  const dateIndex = lines.findIndex(line => explicitTextDate(line));
  if (dateIndex < 0) return null;
  const dateText = lines[dateIndex];
  const localStart = explicitTextDate(dateText);
  if (!localStart || !parseDate(localStart.slice(0, 10))) return null;
  const zoneLabel = dateText.match(/\b(AEDT|AEST|EDT|EST|PDT|PST|HST|JST|UTC|GMT)\b/)?.[1];
  const zone = PUBLIC_ZONES[zoneLabel];
  const localEnd = explicitTextEnd(dateText, localStart);
  const start = localStart.includes('T') && zone ? parseDate(`${localStart}${zone[0]}`) : localStart.slice(0, 10);
  const end = localEnd?.includes('T') && zone ? parseDate(`${localEnd}${zone[0]}`) : undefined;
  const location = lines.slice(dateIndex + 1).filter(line => !/^(?:Free|\$[\d,.]+(?:\s.*)?)$/i.test(line)).join(' · ');
  return { title: plainText(detail.title), start, end: end && end > start ? end : undefined,
    timeZone: zone?.[1] || 'America/New_York', location, description: plainText(detail.description || ''),
    uncertain: !start?.includes('T') || Boolean(localEnd && (!end || end <= start)) };
}

/**
 * Parse newly discovered visible public cards without fixed IDs, dates or titles.
 * @param {Object} listing Current anonymous rendered listing and completeness.
 * @param {Map<string,Object>} details Current original detail fields by public URL.
 * @param {Object} plan Source provenance and optional online-only scope.
 * @param {Object} context Collection window.
 * @return {Object} Current public occurrences and explicit partial diagnostics.
 */
export function parseAlumniPublicCards(listing, details, plan = {}, context = {}) {
  const events = new Map();
  const warnings = [...(listing.warnings || [])];
  let partial = Boolean(listing.partial);
  for (const row of listing.rows || []) {
    const url = publicEventUrl(row.url);
    const date = explicitTextDate(row.dateText || '')?.slice(0, 10);
    if (!url || !date || !parseDate(date) || !plainText(row.title)) {
      partial = true; warnings.push('A visible Alumni card has no valid public URL, title or explicit full date'); continue;
    }
    const locationText = row.text?.split('|').slice(1).join('|').split('\n')[0].trim() || '';
    const online = /^(?:virtual webinar,?\s*)?online$/i.test(locationText);
    if (plan.options?.onlineOnly && !online) continue;
    const detail = parseAlumniPublicDetail(details.get(url));
    let start = detail?.start || date;
    if (!detail) { partial = true; warnings.push(`Original public event details unavailable (${url}); only its current visible listing date is included`); }
    if (detail?.uncertain) { partial = true; warnings.push(`Original public event clock or zone needs review (${url}); no unsupported clock or end was inferred`); }
    if (detail?.start?.includes('T')) {
      const easternDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(detail.start));
      if (easternDay !== date) { partial = true; warnings.push(`Public listing date ${date} differs from the current original event instant (${url}); original detail fields are shown`); }
    } else if (detail?.start && detail.start !== date) {
      partial = true;
      warnings.push(`Public listing date ${date} conflicts with original detail date ${detail.start} without a verified source clock (${url}); retained the current listing date`);
      start = date;
    }
    const event = normalizeEvent({ uid: `alumni:${url}`, title: detail?.title || row.title, url,
      start, end: detail?.end, timeZone: detail?.timeZone || 'America/New_York',
      description: detail?.description || '', location: detail?.location || locationText,
      organizer: 'Carnegie Mellon University Alumni Association', ...(online ? { mode: 'online' } : {}) }, plan);
    if (!event) { partial = true; warnings.push(`Current public Alumni event fields are invalid (${url})`); }
    else if (inWindow(event, context)) events.set(event.uid, event);
  }
  return { events: [...events.values()], warnings, ...(partial ? { partial: true } : {}), singleEventUids: [...events.keys()] };
}

/**
 * Discover all currently visible public Alumni cards and fetch their originals.
 * @param {Object} plan Source with discovery='public-dom'; no snapshot required.
 * @param {Object} context Explicit anonymous renderer and collection window.
 * @return {Promise<Object>} Dynamically discovered public event snapshot.
 */
async function fetchAlumniPublic(plan, context) {
  if (typeof context.renderPublic !== 'function') throw new Error('Alumni public DOM discovery requires CMUEVENTS_RENDER_PUBLIC=1; fixed reviewed-card snapshots are not a live fallback');
  const listing = await sharedPublicRender(context, { url: LISTING, kind: 'alumni' });
  if (!Array.isArray(listing.rows)) throw new Error('Public Alumni renderer returned no visible-card collection');
  const details = new Map();
  const warnings = [];
  const audit = { version: 1, kind: 'public-dom-pagination-and-details', inspectionComplete: !listing.partial,
    pages: listing.pages, listingCards: listing.rows.length, inspectedDetails: [],
    internalIssues: [], externalIssues: [], nonBlockingIssues: [] };
  if (listing.partial) audit.internalIssues.push({ code: 'INCOMPLETE_PUBLIC_PAGINATION', warnings: listing.warnings || [] });
  const eligible = listing.rows.filter(row => publicEventUrl(row.url)
    && (!plan.options?.onlineOnly || /\b(?:virtual webinar,?\s*)?online\s*(?:\n|$)/i.test(row.text?.split('|').slice(1).join('|') || '')));
  for (const row of listing.rows) {
    if (!publicEventUrl(row.url) || !explicitTextDate(row.dateText || '') || !plainText(row.title)) {
      audit.internalIssues.push({ code: 'UNPARSED_VISIBLE_CARD', url: row.url || '', dateText: row.dateText || '' });
    }
  }
  for (let index = 0; index < eligible.length; index += 2) {
    const outcomes = await Promise.all(eligible.slice(index, index + 2).map(async row => {
      try {
        const detail = await sharedPublicRender(context, { url: row.url, kind: 'event-detail' });
        if (!parseAlumniPublicDetail(detail)) throw Object.assign(new Error('Current visible Event Details has no explicit valid full date'), { code: 'UNPARSED_EVENT_DETAILS' });
        return { url: row.url, detail };
      } catch (error) { return { url: row.url, error }; }
    }));
    for (const outcome of outcomes) {
      if (outcome.error) {
        const diagnostic = outcome.error.publicRenderDiagnostic;
        const issue = { code: diagnostic?.httpStatus >= 400 ? 'PUBLIC_DETAIL_ACCESS_FAILURE' : 'UNPARSED_EVENT_DETAILS',
          url: outcome.url, reason: outcome.error.message, ...(diagnostic ? { diagnostic } : {}) };
        (diagnostic?.httpStatus >= 400 ? audit.externalIssues : audit.internalIssues).push(issue);
        audit.inspectedDetails.push({ url: outcome.url, outcome: issue.code });
        warnings.push(`Public original event detail failed (${outcome.url}): ${outcome.error.message}`);
      } else {
        const parsed = parseAlumniPublicDetail(outcome.detail);
        details.set(outcome.url, outcome.detail);
        audit.inspectedDetails.push({ url: outcome.url, outcome: 'parsed' });
        if (parsed.uncertain) audit.externalIssues.push({ code: 'UNSUPPORTED_PUBLISHED_CLOCK', url: outcome.url });
      }
    }
  }
  audit.inspectionComplete &&= audit.internalIssues.length === 0 && audit.inspectedDetails.length === eligible.length;
  const result = parseAlumniPublicCards(listing, details, plan, context);
  return { ...result, coverage: audit, completeSnapshot: audit.inspectionComplete, warnings: [...result.warnings, ...warnings] };
}

const publicRenderRuns = new WeakMap();

/**
 * Share current anonymous listing/detail results between equivalent source scopes.
 * Rejected promises remain shared only for this refresh; tomorrow retries all URLs.
 * @param {Object} context Refresh-scoped renderer context.
 * @param {Object} request Validated public render request.
 * @return {Promise<Object>} Current visible document extraction.
 */
function sharedPublicRender(context, request) {
  const run = context.collectionRun || context;
  if (!publicRenderRuns.has(run)) publicRenderRuns.set(run, new Map());
  const cache = publicRenderRuns.get(run);
  const key = `${request.kind}:${request.url}`;
  if (!cache.has(key)) cache.set(key, context.renderPublic(request));
  return cache.get(key);
}

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
      && parsed.pathname.startsWith('/schools/CarnegieMellonUniversity/events/')
      && (!row.detailReview || Boolean(reviewedDetail(row)));
  } catch { return false; }
}

/**
 * Normalize independently reviewed public registration-page fields.
 * The live publisher clock must still agree before these fields are reused.
 * @param {Object} row Public card with an optional dated detail review.
 * @return {Object|null} Verified instants and source zone, or invalid review.
 */
function reviewedDetail(row) {
  const review = row.detailReview;
  if (!review || review.url !== row.url || !Number.isFinite(Date.parse(review.checkedAt))
    || typeof review.timeZone !== 'string' || !review.timeZone || !review.evidence) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: review.timeZone }).format(0);
    const start = parseDate(review.start, review.timeZone);
    const end = review.end ? parseDate(review.end, review.timeZone) : null;
    if (!start?.includes('T') || (review.end && (!end?.includes('T') || end <= start))) return null;
    return { ...review, start, end };
  } catch { return null; }
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
    const detail = row.detailReview ? reviewedDetail(row) : null;
    const matchedDetail = detail && instant === detail.start;
    const start = detail ? matchedDetail ? detail.start : row.date : trustedClock ? instant : row.date;
    let note = '';
    let end;
    let location = row.location;
    if (matchedDetail) {
      timeZone = detail.timeZone;
      end = detail.end || undefined;
      location = detail.location || location;
      note = detail.description || '';
    } else if (detail || !trustedClock) {
      const reason = detail ? 'the live publisher clock no longer agrees with the reviewed original event page'
        : row.clockPolicy === 'date_only' ? 'the reviewed public clock has an unresolved timezone ambiguity'
        : clockDay && clockDay !== row.date ? 'the live clock now falls on a different calendar date'
          : 'a reliable public clock is unavailable';
      note = `Only the publicly reviewed date is shown because ${reason}. Confirm current details on the original event page.`;
      warnings.push(`Alumni card ${id}: ${reason}; retained reviewed date ${row.date} without a clock`);
      timeZone = plan.options?.timezone || 'America/New_York';
    }
    const event = normalizeEvent({ uid: `alumni:${id}`, title: row.title, start, end, timeZone,
      description: note, url, location,
      organizer: 'Carnegie Mellon University Alumni Association',
      ...(alumniOnlineVenue(row) ? { mode: 'online' } : {}),
    }, plan);
    if (event && inWindow(event, context)) events.set(event.uid, event);
  }
  return { events: [...events.values()], warnings, partial: true, singleEventUids: [...events.keys()] };
}

/**
 * Refresh clocks only for individually verified public cards, without invoking
 * the broad getEvents getter. Automatic discovery of new cards is still pending.
 * @param {Object} plan Explicit reviewedPublicEvents snapshot and scope.
 * @param {Object} context Safe public GET and allowlisted clock-query callbacks.
 * @return {Promise<Object>} Always-partial reviewed occurrences.
 */
export async function fetchAlumni(plan, context) {
  if (plan.options?.discovery === 'public-dom') return fetchAlumniPublic(plan, context);
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
