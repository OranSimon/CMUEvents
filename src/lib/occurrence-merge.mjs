import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const words = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const titleWords = event => words(event.title);
const precision = event => event.timePrecision || (event.allDay || event.start.length === 10 ? 'all-day' : 'time');
const body = event => words(String(event.description || '').replace(/https?:\/\/\S+/gi, '').replace(/---\s*Event Details:[\s\S]*$/i, ''));
const knownEnd = event => Date.parse(event.end) > Date.parse(event.start);
const substantial = event => body(event).length >= 80 && !/(?:abstract|talk title|bio)\s*(?::|\n)?\s*(?:coming soon|tba|tbd)/i.test(event.description || '');

/** Normalize provider detail routes without treating shared calendars as events. */
export function canonicalEventUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    const campus = ['tartanconnect.cmu.edu', 'scottyconnect.qatar.cmu.edu'].includes(url.hostname);
    if (campus && /\/(?:rsvp|rsvp_boot)$/.test(url.pathname) && /^\d+$/.test(url.searchParams.get('id') || '')) {
      const id = url.searchParams.get('id'); url.pathname = '/rsvp'; url.search = ''; url.searchParams.set('id', id);
    }
    const live = url.hostname === 'events.cmu.edu' && url.pathname.match(/\/(?:live\/events|[^/]+\/event)\/(\d+)(?:-|\/|$)/);
    if (live) { url.pathname = `/live/events/${live[1]}`; url.search = ''; }
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href.replace(/\/$/, '');
  } catch { return String(value || ''); }
}

/** Preserve distinct same-source claims before any cross-source matching. */
export function occurrenceStorageKey(event) {
  return hash(JSON.stringify([event.uid, event.start, event.end, precision(event), event.url, titleWords(event)]));
}

function origin(value) { try { return new URL(value).origin; } catch { return ''; } }
function individualLink(event) {
  if (['source-page', 'calendar-viewer'].includes(event.linkKind)) return '';
  try {
    const url = new URL(event.url);
    if (/\.ics$/i.test(url.pathname) || /\/calendar\/(?:ical|embed|render)/i.test(url.pathname)) return '';
    if (['format', 'output'].some(key => /^(?:ical|ics|icalendar)$/i.test(url.searchParams.get(key) || ''))) return '';
    const canonical = canonicalEventUrl(event.url);
    if ((event.sources || []).some(source => canonicalEventUrl(source.url) === canonical)) return '';
    return canonical;
  } catch { return ''; }
}

/** Include only publisher-advertised individual pages, never general calendars. */
export function occurrenceLinks(event) {
  return [...new Set([individualLink(event), ...(event.relatedEventUrls || []).map(url => {
    try { return /\/events?\/[^/?#]{8,}/i.test(new URL(url).pathname) ? individualLink({ ...event, url, linkKind: 'event-detail' }) : ''; }
    catch { return ''; }
  })].filter(Boolean))];
}

/** Compare a verified single-page heading with its stale list label. */
export function sharedLinkTitle(left, right) {
  const a = titleWords(left), b = titleWords(right);
  const withoutYear = text => text.replace(/\b(?:19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim();
  return a === b || (Math.min(a.length, b.length) >= 20 && (a.startsWith(`${b} `) || b.startsWith(`${a} `)))
    || (withoutYear(a).length >= 16 && withoutYear(a).split(' ').length >= 3 && withoutYear(a) === withoutYear(b));
}

/** Match a university-domain abbreviation only with a substantial shared suffix. */
function institutionTitle(left, right) {
  const a = titleWords(left).split(' '), b = titleWords(right).split(' ');
  let common = 0;
  while (common < Math.min(a.length, b.length) && a[a.length - 1 - common] === b[b.length - 1 - common]) common++;
  if (common < 4 || a.slice(-common).join(' ').length < 20) return false;
  const prefixA = a.slice(0, -common), prefixB = b.slice(0, -common);
  const domains = event => new Set([event.url, ...(event.sources || []).map(source => source.url)].map(url => {
    try { return new URL(url).hostname.match(/(?:^|\.)([a-z]+)\.edu$/)?.[1] || ''; } catch { return ''; }
  }).filter(Boolean));
  const da = domains(left), db = domains(right);
  const match = (short, long) => short.length === 1 && short[0].length >= 2 && long.length >= 2 && long.length <= 5
    && da.has(short[0]) && db.has(short[0]) && [long.map(word => word[0]).join(''), `${long.map(word => word[0]).join('')}u`].includes(short[0]);
  return match(prefixA, prefixB) || match(prefixB, prefixA);
}
function uidIdentity(event) {
  if (!event.uid) return '';
  const scope = /@|^https?:\/\//i.test(event.uid) ? 'global' : origin(event.sources?.[0]?.url || event.url);
  return `${scope}|${event.uid}|${titleWords(event)}`;
}
function campusIdentity(event) {
  try {
    const url = new URL(event.url);
    return ['tartanconnect.cmu.edu', 'scottyconnect.qatar.cmu.edu'].includes(url.hostname)
      && /\/(?:rsvp|rsvp_boot)$/.test(url.pathname) && url.searchParams.has('id') ? `${url.hostname}|${url.searchParams.get('id')}` : '';
  } catch { return ''; }
}
function venue(event) {
  const text = words(event.location).replace(/^(?:zoom|online|virtual|remote|webex) (?:and|or) /, '');
  return !text || /^(?:sign in|tba|tbd|unknown|not specified|to be announced|https|zoom|online|virtual|remote|webex|teams meeting)\b/.test(text) ? '' : text;
}
function venueAgreement(left, right) {
  const a = venue(left), b = venue(right);
  if (!a || !b) {
    const location = a || b, other = a ? right : left;
    const text = body(other).replace(titleWords(other), '');
    const tokens = location.split(' ');
    const shared = tokens.length >= 2 && tokens.some(token => token.length >= 4
      && !/^(?:hall|room|building|university|center|conference|library|office|campus|main|floor|performing|arts)$/.test(token))
      && [2, 3, 4].some(size => tokens.length >= size && ` ${text} `.includes(` ${tokens.slice(0, size).join(' ')} `));
    return { compatible: true, shared: Boolean(shared) };
  }
  const tokens = text => new Set(text.split(' ').filter(token => token.length > 1 && !/^\d+$/.test(token)
    && !/^(?:room|hall|building|university|carnegie|mellon|cmu|center|conference|and|the|library|office|offices)$/.test(token)));
  const at = tokens(a), bt = tokens(b);
  const shared = [...at].filter(token => bt.has(token)).length;
  return { compatible: a === b || shared >= 2, shared: (a === b && shared >= 1) || shared >= 2 };
}
function conflictingLocations(left, right) {
  const a = venue(left), b = venue(right);
  if (!a || !b || a.includes(b) || b.includes(a)) return false;
  const numbers = text => new Set(text.match(/\b\d{2,5}[a-z]?\b/g) || []);
  const na = numbers(a), nb = numbers(b);
  if ([...na].some(value => !nb.has(value)) && [...nb].some(value => !na.has(value))) return true;
  return !venueAgreement(left, right).compatible;
}
function copiedBody(left, right) {
  const a = body(left), b = body(right), short = a.length < b.length ? a : b, long = a.length < b.length ? b : a;
  if (!short) return false;
  if (short.length >= 80 && long.includes(short)) return true;
  if (a === b && a.length >= 24 && titleWords(left).split(' ').length >= 2 && a.includes(titleWords(left))) return true;
  if (short.length < 120) return false;
  const shingles = text => { const tokens = text.split(' '); return new Set(tokens.slice(0, -4).map((_, index) => tokens.slice(index, index + 5).join(' '))); };
  const sa = shingles(a), sb = shingles(b);
  const overlap = [...sa].filter(part => sb.has(part)).length;
  return overlap >= 12 && overlap / Math.min(sa.size, sb.size) >= 0.65;
}

/** Dates, precision, starts and known ends are hard barriers for every pair. */
function compatibleTimes(left, right) {
  const lp = precision(left), rp = precision(right);
  return (lp === 'time') === (rp === 'time') && left.start === right.start
    && (lp === 'time' ? !(knownEnd(left) && knownEnd(right) && left.end !== right.end) : left.end === right.end);
}
function matchReason(left, right) {
  if (!compatibleTimes(left, right)) return null;
  const lt = titleWords(left), rt = titleWords(right);
  const links = new Set(occurrenceLinks(left));
  if (occurrenceLinks(right).some(link => links.has(link)) && sharedLinkTitle(left, right)) return 'shared-event-link';
  const lu = uidIdentity(left), ru = uidIdentity(right);
  if (lu && lu === ru) return 'scoped-uid';
  if (lt !== rt && !institutionTitle(left, right)) return null;
  const lc = campusIdentity(left), rc = campusIdentity(right);
  if (lc && rc && lc !== rc) return null;
  const place = venueAgreement(left, right);
  if (!place.compatible) return null;
  const generic = lt.split(' ').every(token => /^(?:meeting|meetings|club|general|body|office|hours|weekly|monthly|daily|regular|seminar|research|workshop|session|practice|team|group|staff|faculty|department|online|virtual|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+)$/.test(token));
  if (generic && !place.shared && !(left.organizer && words(left.organizer) === words(right.organizer))) return null;
  const copied = copiedBody(left, right);
  if (copied) return 'copied-description';
  if (institutionTitle(left, right) && place.shared && !conflictingLocations(left, right)
    && Math.min(body(left).length, body(right).length) <= 240) return 'specific-title-and-venue';
  if (substantial(left) && substantial(right)) return null;
  if (conflictingLocations(left, right)) {
    const pending = /(?:abstract|talk title|bio)\s*(?::|\n)?\s*(?:coming soon|tba|tbd)/i;
    const sharedTitle = lt.split(' ').filter(token => token.length >= 3 && body(left).split(' ').includes(token) && body(right).split(' ').includes(token));
    if (!(substantial(left) || substantial(right)) || !(pending.test(left.description || '') || pending.test(right.description || '')) || sharedTitle.length < 2) return null;
  }
  const specific = lt.length >= 20 && lt.split(' ').length >= 4;
  if (specific && place.shared) return 'specific-title-and-venue';
  return null;
}

/** Sparse copies can join through a supported copy, but never bridge contradictions. */
function compatibleClaims(left, right) {
  if (!compatibleTimes(left, right)) return false;
  if (matchReason(left, right)) return true;
  if (titleWords(left) !== titleWords(right)) return false;
  const lc = campusIdentity(left), rc = campusIdentity(right);
  if (lc && rc && lc !== rc) return false;
  return venueAgreement(left, right).compatible && !(substantial(left) && substantial(right) && !copiedBody(left, right));
}

function provenanceKey(source) { return JSON.stringify([source.id, source.url, source.eventUrl]); }
function claim(event) {
  return Object.fromEntries(['title', 'description', 'start', 'end', 'timeZone', 'timePrecision', 'allDay', 'location', 'organizer', 'status', 'recurrence'].filter(key => event[key] !== undefined).map(key => [key, event[key]]));
}
function stableRow(event) { return JSON.stringify([event.sources?.[0]?.id, event.url, event.uid, event.start, event.end, event.title, event.description, event.location]); }

/** Pick a readable primary record and retain every distinct source-specific claim. */
function combine(members, reasons) {
  const score = event => Number(Boolean(individualLink(event))) * 100 + Number(knownEnd(event)) * 10
    + Number(event.contentRole === 'detail') * 5 + Math.min(String(event.description || '').length / 10000, 1);
  const ordered = [...members].sort((a, b) => score(b) - score(a) || stableRow(a).localeCompare(stableRow(b)));
  const result = { ...ordered[0] };
  const rich = [...members].sort((a, b) => (b.description || '').length - (a.description || '').length || stableRow(a).localeCompare(stableRow(b)))[0];
  result.description = rich.description; result.summary = rich.summary;
  if (!knownEnd(result)) result.end = ordered.find(knownEnd)?.end || result.end;
  if (!venue(result)) result.location = ordered.find(event => venue(event))?.location || result.location;
  if (!result.organizer) result.organizer = ordered.find(event => event.organizer)?.organizer || '';
  const cancelled = members.find(event => event.status === 'cancelled');
  if (cancelled) result.status = 'cancelled';
  const recurring = ordered.find(event => event.eventType === 'recurring' && event.recurrence);
  if (recurring) { result.eventType = 'recurring'; result.recurrence = recurring.recurrence; }
  const period = ordered.find(event => event.scheduleKind === 'continuous');
  if (period) { result.scheduleKind = 'continuous'; result.dateEvidence = period.dateEvidence; }
  result.tags = [...new Set(members.flatMap(event => event.tags || []))].sort();
  result.relatedEventUrls = [...new Set(members.flatMap(event => event.relatedEventUrls || []))].sort();
  result.sources = [...new Map(members.flatMap(event => event.sources || []).map(source => [provenanceKey(source), source])).values()]
    .sort((a, b) => provenanceKey(a).localeCompare(provenanceKey(b)));
  result.id = hash(JSON.stringify([result.start, result.end, titleWords(result), individualLink(result) || uidIdentity(result) || stableRow(result)]));
  if (members.length > 1) {
    const variants = new Map();
    for (const member of members) {
      const value = claim(member._sourceClaim || member);
      const key = JSON.stringify(value);
      if (!variants.has(key)) variants.set(key, { ...value, endExclusive: Boolean(value.allDay), sourceIds: [], urls: [] });
      const variant = variants.get(key);
      variant.sourceIds = [...new Set([...variant.sourceIds, ...member.sources.map(source => source.id)])].sort();
      variant.urls = [...new Set([...variant.urls, member.url])].sort();
    }
    result.sourceVariants = [...variants.values()].map(variant => {
      const descriptionMatchesCanonical = variant.description === result.description;
      if (descriptionMatchesCanonical) delete variant.description;
      return { ...variant, descriptionMatchesCanonical };
    });
    result.sourceConflicts = [
      ...(members.some(member => titleWords(member) !== titleWords(result)
        && sharedLinkTitle(member, result) && /\b(?:19|20)\d{2}\b/.test(member.title)) ? ['title'] : []),
      ...(members.some((member, index) => members.slice(index + 1).some(other => conflictingLocations(member, other))) ? ['location'] : []),
      ...(new Set(members.map(event => event.status).filter(Boolean)).size > 1 ? ['status'] : []),
    ];
    result.mergeEvidence = { version: 1, reasons: [...new Set(reasons)].sort(), sourceOccurrences: members.length };
  }
  delete result._sourceClaim;
  return result;
}

/**
 * Merge only evidence-backed copies of one occurrence. Complete-link checks stop
 * missing facts from connecting incompatible sessions through a transitive chain.
 * Source snapshots remain untouched so a later daily rebuild can reconsider them.
 */
export function mergeOccurrences(input) {
  const rows = [...input].sort((a, b) => stableRow(a).localeCompare(stableRow(b)));
  const buckets = new Map(), pairs = new Set();
  rows.forEach((event, index) => {
    const day = `${precision(event) === 'time' ? 'time' : 'day'}|${event.start}`;
    const keys = [`title:${titleWords(event)}`, `title-tail:${titleWords(event).split(' ').slice(-5).join(' ')}`,
      ...occurrenceLinks(event).map(link => `link:${link}`), ...(uidIdentity(event) ? [`uid:${uidIdentity(event)}`] : [])];
    for (const key of keys) {
      const bucket = `${day}|${key}`;
      for (const previous of buckets.get(bucket) || []) pairs.add(`${previous}:${index}`);
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket).push(index);
    }
  });
  const ranks = ['shared-event-link', 'scoped-uid', 'copied-description', 'specific-title-and-venue'];
  const edges = [...pairs].map(pair => { const [a, b] = pair.split(':').map(Number); return { a, b, reason: matchReason(rows[a], rows[b]) }; })
    .filter(edge => edge.reason).sort((a, b) => ranks.indexOf(a.reason) - ranks.indexOf(b.reason) || a.a - b.a || a.b - b.b);
  const owner = rows.map((_, index) => index), groups = new Map(rows.map((_, index) => [index, [index]])), evidence = new Map();
  for (const edge of edges) {
    const a = owner[edge.a], b = owner[edge.b];
    if (a === b) continue;
    if (!groups.get(a).every(i => groups.get(b).every(j => compatibleClaims(rows[i], rows[j])))) continue;
    const joined = [...groups.get(a), ...groups.get(b)].sort((x, y) => x - y);
    groups.set(a, joined); groups.delete(b); joined.forEach(index => { owner[index] = a; });
    evidence.set(a, [...(evidence.get(a) || []), ...(evidence.get(b) || []), edge.reason]); evidence.delete(b);
  }
  const events = [...groups].map(([key, indices]) => combine(indices.map(index => rows[index]), evidence.get(key) || []));
  const merged = events.filter(event => event.mergeEvidence);
  return { events, report: { version: 1, inputOccurrences: input.length, outputOccurrences: events.length, mergedGroups: merged.length,
    absorbedOccurrences: input.length - events.length, groups: merged.map(event => ({ id: event.id, title: event.title, start: event.start, end: event.end,
      sourceOccurrences: event.mergeEvidence.sourceOccurrences, reasons: event.mergeEvidence.reasons, sourceConflicts: event.sourceConflicts,
      sourceIds: [...new Set(event.sources.map(source => source.id))], originalUrls: [...new Set(event.sources.map(source => source.eventUrl))] })) } };
}
