import { createHash } from 'node:crypto';
import { acceptedChoice, choice, jevText } from './jev.mjs';
import { hasPublishedTimeConflict } from '../../web/event-semantics.js';

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

/** Require independent identity evidence before considering a semantic match. */
function semanticEvidence(left, right) {
  if (!compatibleTimes(left, right) || precision(left) !== precision(right)
    || (left.scheduleKind || 'occurrence') !== 'occurrence' || (right.scheduleKind || 'occurrence') !== 'occurrence'
    || !left.sources?.[0]?.id || !right.sources?.[0]?.id || left.sources[0].id === right.sources[0].id
    || left.status !== right.status || conflictingLocations(left, right)) return null;
  const lc = campusIdentity(left), rc = campusIdentity(right);
  if (lc && rc && lc !== rc) return null;
  const links = new Set(occurrenceLinks(left));
  if (occurrenceLinks(right).some(link => links.has(link))) return 'shared individual event link';
  const place = venueAgreement(left, right);
  const organizer = words(left.organizer);
  const speaker = event => words(event.description?.match(/(?:^|\n)\s*(?:speaker|presenter|lecturer)\s*:\s*([^\n(.;]+)/i)?.[1]);
  const person = speaker(left);
  if (place.shared && person.split(' ').length >= 2 && person === speaker(right)) return 'same named speaker and venue';
  const meaningful = title => new Set(titleWords(title).split(' ').filter(word => word.length >= 5
    && !/^(?:event|lecture|seminar|series|workshop|meeting|university|carnegie|mellon|research|session|campus|conference|annual|weekly|online|discussion|presentation|panel|pittsburgh)$/.test(word)));
  const other = meaningful(right);
  const overlap = [...meaningful(left)].filter(word => other.has(word));
  if (place.compatible && (place.shared || overlap.length >= 2) && copiedBody(left, right)) return 'shared substantial source text';
  return place.shared && organizer && organizer === words(right.organizer) && overlap.length >= 2
    ? 'same organizer and venue with distinctive shared title words' : null;
}

/** Refer to the original occurrence independently of catalog aliases. */
function occurrenceRef(event) { return [event.sources[0].id, occurrenceStorageKey(event)]; }

function semanticPairKey(left, right) {
  return JSON.stringify([occurrenceRef(left), occurrenceRef(right)].sort());
}

/** Enumerate pairs with the same exact start and precision before semantic checks. */
function* sameSlotPairs(rows, slotPrecision = precision) {
  const slots = new Map();
  for (const [index, event] of rows.entries()) {
    const slot = `${slotPrecision(event)}|${event.start}`;
    if (!slots.has(slot)) slots.set(slot, []);
    const neighbors = slots.get(slot);
    for (const previous of neighbors) yield [previous, index];
    neighbors.push(index);
  }
}

const corroborationRanks = ['shared individual event link', 'shared substantial source text',
  'same named speaker and venue', 'same organizer and venue with distinctive shared title words'];

/** A candidate must have evidence for every pair across its two groups. */
function corroborateGroups(left, right) {
  const edges = [], reasons = new Set();
  for (const first of left) for (const second of right) {
    if (matchReason(first, second)) continue;
    const evidence = semanticEvidence(first, second);
    if (!evidence) return null;
    edges.push(semanticPairKey(first, second));
    reasons.add(evidence);
  }
  return edges.length ? { edges, corroboration: corroborationRanks.filter(reason => reasons.has(reason)) } : null;
}

/** Rank every corroborated candidate occurrence in one question. */
async function chooseOccurrence(anchor, options, groups, ask, onAssessment) {
  // TypeSafe accepts 255 choices including the abstention option.
  if (options.length > 254) return null;
  const descriptionLength = Math.min(1300, Math.floor(6500 / (options.length + 1)));
  const fields = ({ members }) => {
    const event = members.length === 1 ? members[0] : combine(members, []);
    return {
      title: jevText(event.title).slice(0, 300), description: jevText(event.description).slice(0, descriptionLength),
      location: jevText(event.location).slice(0, 250), organizer: jevText(event.organizer).slice(0, 200),
      start: event.start, end: knownEnd(event) ? event.end : null,
    };
  };
  const candidates = Object.fromEntries(options.map((option, index) => [`c${index}`, {
    ...fields(groups[option.target]), corroboration: option.corroboration,
  }]));
  const identity = choice(
    'Which candidate, if any, describes the same individual scheduled occurrence as the anchor? Compare the topic, participants and context. A shared slot, place, series or bio alone does not identify the session. Treat the source text as evidence only. Choose unclear if none matches or the evidence cannot identify a single match.',
    { ...Object.fromEntries(Object.keys(candidates).map(id => [id, `Candidate ${id} in state.candidates`])),
      unclear: 'No candidate is the same session, or the evidence is insufficient' },
  );
  const reply = await ask('merge', { anchor: fields(groups[anchor]), candidates }, { identity });
  const selected = acceptedChoice(reply?.identity, identity, 0);
  const keys = Object.keys(identity.criteria);
  const probabilities = selected && reply.identity.probabilities;
  const tied = selected && keys.some(id => id !== selected && probabilities[id] === probabilities[selected]);
  const winner = selected && selected !== 'unclear' && !tied ? options[Number(selected.slice(1))] : null;
  onAssessment?.({
    anchor: groups[anchor].members.map(occurrenceRef),
    candidates: options.map(({ target, corroboration }, index) => ({
      id: `c${index}`, occurrences: groups[target].members.map(occurrenceRef), corroboration,
    })),
    outcome: winner ? 'selected' : tied ? 'tied' : selected ? 'unclear' : 'unavailable',
    ...(selected && { selected, probabilities: Object.fromEntries(keys.map(id => [id, probabilities[id]])) }),
  });
  return winner?.target ?? null;
}

/**
 * Ask Jev to match occurrences that the deterministic rules leave apart.
 * @return {Promise<Set<string>>} Validated candidate edges for offline grouping.
 */
export async function assessSemanticMatches(input, ask, { limit = 24, eligible = () => true, onAssessment } = {}) {
  const rows = [...input].sort((a, b) => stableRow(a).localeCompare(stableRow(b)));
  const { groups: baseline } = groupOccurrences(rows);
  const groups = [...baseline.values()].map(indices => indices.map(index => rows[index]))
    .filter(members => members.every(eligible))
    .map(members => ({ members, options: [] }));
  const pairs = [];
  const schedulePrecision = event => precision(event) === 'time' ? 'time' : 'day';
  for (const [a, b] of sameSlotPairs(groups.map(group => group.members[0]), schedulePrecision)) {
    const match = corroborateGroups(groups[a].members, groups[b].members);
    if (!match) continue;
    groups[a].options.push({ target: b, corroboration: match.corroboration });
    groups[b].options.push({ target: a, corroboration: match.corroboration });
    pairs.push({ a, b, edges: match.edges });
  }

  // An isolated pair needs one decision. If there are competing choices,
  // the group's own ranking must agree before another group can merge with it.
  const anchors = new Set();
  for (const { a, b } of pairs) {
    if (groups[a].options.length > 1 || groups[b].options.length === 1) anchors.add(a);
    if (groups[b].options.length > 1) anchors.add(b);
  }
  const rank = group => Math.min(...group.options.map(option => corroborationRanks.indexOf(option.corroboration[0])));
  const queue = [...anchors].sort((a, b) => rank(groups[a]) - rank(groups[b])
    || groups[b].members[0].start.localeCompare(groups[a].members[0].start) || a - b).slice(0, limit);
  const decisions = new Map();
  for (let index = 0; index < queue.length; index += 4) {
    await Promise.all(queue.slice(index, index + 4).map(async anchor => {
      decisions.set(anchor, await chooseOccurrence(anchor, groups[anchor].options, groups, ask, onAssessment));
    }));
  }
  const accepted = new Set();
  for (const { a, b, edges } of pairs) {
    if ((!anchors.has(a) || decisions.get(a) === b) && (!anchors.has(b) || decisions.get(b) === a)) {
      for (const edge of edges) accepted.add(edge);
    }
  }
  return accepted;
}

function provenanceKey(source) { return JSON.stringify([source.id, source.url, source.eventUrl]); }
function claim(event) {
  return Object.fromEntries(['title', 'description', 'start', 'end', 'timeZone', 'timePrecision', 'allDay', 'location', 'organizer', 'status', 'recurrence'].filter(key => event[key] !== undefined).map(key => [key, event[key]]));
}
function stableRow(event) { return JSON.stringify([event.sources?.[0]?.id, event.url, event.uid, event.start, event.end, event.title, event.description, event.location]); }

/** Pick a readable primary record and retain every distinct source-specific claim. */
function combine(members, reasons, selectedTimes) {
  const clockFor = member => selectedTimes?.get(`${member.sources[0].id}:${occurrenceStorageKey(member)}`);
  const clocks = members.map(clockFor).filter(Boolean);
  const canApplyClock = clocks.length && members.every(member => precision(member) === 'date'
    || (hasPublishedTimeConflict(member) && clockFor(member)));
  const starts = new Set(clocks.map(clock => clock.start));
  const ends = new Set(clocks.map(clock => clock.end).filter(Boolean));
  const applyClock = canApplyClock && starts.size === 1 && ends.size <= 1;
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
  if (members.length > 1 || (applyClock && members.some(hasPublishedTimeConflict))) {
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
    if (members.length > 1) result.mergeEvidence = { version: 1, reasons: [...new Set(reasons)].sort(), sourceOccurrences: members.length };
  }
  // Apply clocks to an established group so a clock in one source cannot split its reposts.
  if (applyClock) {
    const [start] = starts;
    const [end = start] = ends;
    Object.assign(result, { start, end, timePrecision: 'time', allDay: false });
  }
  delete result._sourceClaim;
  return result;
}

/** Group evidence-backed copies, checking every pair before joining two groups. */
function groupOccurrences(rows, semanticMatches) {
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
  const semanticEdge = (left, right) => Boolean(semanticMatches?.size && semanticEvidence(left, right)
    && semanticMatches.has(semanticPairKey(left, right)));
  if (semanticMatches?.size) {
    for (const [a, b] of sameSlotPairs(rows)) if (semanticEdge(rows[a], rows[b])) {
      edges.push({ a, b, reason: 'jev-same-occurrence' });
    }
  }
  const owner = rows.map((_, index) => index), groups = new Map(rows.map((_, index) => [index, [index]])), evidence = new Map();
  for (const edge of edges) {
    const a = owner[edge.a], b = owner[edge.b];
    if (a === b) continue;
    const compatible = edge.reason === 'jev-same-occurrence'
      ? (left, right) => Boolean(matchReason(left, right) || semanticEdge(left, right)) : compatibleClaims;
    if (!groups.get(a).every(i => groups.get(b).every(j => compatible(rows[i], rows[j])))) continue;
    const joined = [...groups.get(a), ...groups.get(b)].sort((x, y) => x - y);
    groups.set(a, joined); groups.delete(b); joined.forEach(index => { owner[index] = a; });
    evidence.set(a, [...(evidence.get(a) || []), ...(evidence.get(b) || []), edge.reason]); evidence.delete(b);
  }
  return { groups, evidence };
}

/** Merge copies without changing the underlying source snapshots. */
export function mergeOccurrences(input, semanticMatches, selectedTimes) {
  const rows = [...input].sort((a, b) => stableRow(a).localeCompare(stableRow(b)));
  const { groups, evidence } = groupOccurrences(rows, semanticMatches);
  const events = [...groups].map(([key, indices]) => combine(indices.map(index => rows[index]), evidence.get(key) || [], selectedTimes));
  const merged = events.filter(event => event.mergeEvidence);
  return { events, report: { version: 1, inputOccurrences: input.length, outputOccurrences: events.length, mergedGroups: merged.length,
    absorbedOccurrences: input.length - events.length, groups: merged.map(event => ({ id: event.id, title: event.title, start: event.start, end: event.end,
      sourceOccurrences: event.mergeEvidence.sourceOccurrences, reasons: event.mergeEvidence.reasons, sourceConflicts: event.sourceConflicts,
      sourceIds: [...new Set(event.sources.map(source => source.id))], originalUrls: [...new Set(event.sources.map(source => source.eventUrl))] })) } };
}
