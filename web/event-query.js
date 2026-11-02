import MiniSearch from './minisearch.js';
import { EVENT_VIEWS, discoveryTags, matchesEventView } from './event-semantics.js';

export const SEARCH_SCHEMA = 1;
export const SEARCH_ENGINE_VERSION = '7.2.0';
const TIME_ZONE = 'America/New_York';
const indexes = new WeakMap();
const dayFormatters = new Map();
const fields = { department: 'departments', org: 'orgs', campus: 'campus', mode: 'mode' };

/**
 * Normalize Unicode words consistently in build-time and browser search.
 * @param {unknown} value Searchable text.
 * @return {string[]} Normalized Unicode words.
 */
export function searchTokens(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

/**
 * Return the single field, tokenizer and relevance contract for every index.
 * @return {Object} Shared field, tokenization and relevance options.
 */
function searchOptions() {
  return { fields: ['title', 'publisher', 'description'], tokenize: searchTokens,
    processTerm: term => term,
    searchOptions: { combineWith: 'AND', boost: { title: 8, publisher: 3, description: 1 },
      prefix: term => term.length >= 3, fuzzy: term => term.length >= 5 ? 1 : false,
      weights: { prefix: 0.5, fuzzy: 0.2 } } };
}

/**
 * Resolve distinct publisher-backed facet labels without mutating an event.
 * @param {Object} event Published event.
 * @param {string} field Scalar or array field.
 * @return {string[]} Distinct source-backed values.
 */
function valuesFor(event, field) {
  let values = event[field];
  if (field === 'departments' && !Array.isArray(values)) values = [event.department, ...(event.sources || []).map(source => source.department)];
  if (field === 'orgs' && !Array.isArray(values)) values = [event.org, ...(event.sources || []).map(source => source.org)];
  return [...new Set((Array.isArray(values) ? values : [values]).filter(value => typeof value === 'string' && value))];
}

/**
 * Normalize the attendance values accepted by URL filters.
 * @param {unknown} value Attendance label or URL alias.
 * @return {string} Canonical attendance label.
 */
function attendanceMode(value) {
  const text = String(value || '');
  return ({ online: 'Online', virtual: 'Online', 'in-person': 'In person', 'in person': 'In person', in_person: 'In person', hybrid: 'Hybrid', unspecified: 'Unspecified', unknown: 'Unspecified' })[text.toLowerCase()] || text;
}

/**
 * Validate an ISO calendar day while preserving its date precision.
 * @param {unknown} value Candidate calendar day.
 * @return {string} Valid ISO day or an empty string.
 */
function calendarDay(value) {
  const day = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === day ? day : '';
}

/**
 * Format an instant in the published interface's display zone.
 * @param {number|string|Date} value Instant to format.
 * @param {string} timeZone Display time zone.
 * @return {string} ISO calendar day.
 */
function zonedDay(value, timeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return '';
  if (!dayFormatters.has(timeZone)) dayFormatters.set(timeZone, new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  const parts = Object.fromEntries(dayFormatters.get(timeZone).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Project the same original event fields into every MiniSearch index.
 * @param {Object[]} events Published occurrences.
 * @return {Object[]} Search-only field projections.
 */
function searchDocuments(events) {
  return events.map(event => ({ id: event.id, title: event.title || '',
    publisher: [...valuesFor(event, 'departments'), ...valuesFor(event, 'orgs'), ...discoveryTags(event),
      event.location?.name || event.location || '', event.organizer || ''].join(' '),
    description: event.description || event.summary || '' }));
}

/**
 * Serialize a build-time index without copying full event records into results.
 * @param {Object[]} events Published occurrences.
 * @return {Object} Versioned serializable MiniSearch payload.
 */
export function buildSearchIndex(events) {
  const engine = new MiniSearch(searchOptions());
  engine.addAll(searchDocuments(events));
  return { schemaVersion: SEARCH_SCHEMA, engineVersion: SEARCH_ENGINE_VERSION, documentCount: events.length, index: engine.toJSON() };
}

/**
 * Load a coherent published index once, yielding between batches on browsers.
 * @param {Object[]} events Immutable published occurrences.
 * @param {Object} payload Versioned serialized search index.
 * @return {Promise<void>} Completion after membership validation.
 */
export async function prepareSnapshotSearch(events, payload) {
  if (payload?.schemaVersion !== SEARCH_SCHEMA || payload.engineVersion !== SEARCH_ENGINE_VERSION
    || payload.documentCount !== events.length || !payload.index) throw new Error('The published search index is incompatible or incomplete.');
  const engine = await MiniSearch.loadJSONAsync(JSON.stringify(payload.index), searchOptions());
  if (engine.documentCount !== events.length || events.some(event => !engine.has(event.id))) throw new Error('The published search index does not match the event snapshot.');
  indexes.set(events, { engine, entries: new Map() });
}

/**
 * Cache calendar boundaries and search for one immutable event generation.
 * @param {Object[]} events Published occurrences.
 * @param {string} timeZone Interface time zone.
 * @return {Object} Cached engine and calendar/facet entries.
 */
function indexedEvents(events, timeZone) {
  let cached = indexes.get(events);
  if (!cached) {
    const engine = new MiniSearch(searchOptions());
    engine.addAll(searchDocuments(events));
    cached = { engine, entries: new Map() };
    indexes.set(events, cached);
  }
  if (!cached.entries.has(timeZone)) cached.entries.set(timeZone, events.map(original => {
    const tags = discoveryTags(original);
    const event = tags.length === (original.tags || []).length ? original : { ...original, tags };
    const start = event.start || event.startDate || event.date;
    const allDay = event.allDay || Boolean(calendarDay(start));
    const startInstant = Date.parse(start), endInstant = Date.parse(event.end || start);
    const startDay = allDay ? calendarDay(String(start || '').slice(0, 10)) : zonedDay(start, timeZone);
    if (!startDay || !Number.isFinite(startInstant)) return null;
    const last = Number.isFinite(endInstant) && endInstant > startInstant ? endInstant - (allDay && event.endExclusive === false ? 0 : 1) : startInstant;
    const endDay = allDay ? new Date(last).toISOString().slice(0, 10) : zonedDay(last, timeZone);
    return { event, startDay, endDay, facets: { departments: valuesFor(event, 'departments'), orgs: valuesFor(event, 'orgs'),
      tags, campus: valuesFor(event, 'campus'), mode: [attendanceMode(event.mode)].filter(Boolean) } };
  }).filter(Boolean));
  return { engine: cached.engine, entries: cached.entries.get(timeZone) };
}

/**
 * Preserve repeated tag parameters and accept scalar callers used by build checks.
 * @param {Object|URLSearchParams} filters Query and filter parameters.
 * @return {Object} Normalized parameters with all selected tags.
 */
export function normalizeEventFilters(filters = {}) {
  const options = filters instanceof URLSearchParams ? Object.fromEntries(filters) : { ...filters };
  const tags = filters instanceof URLSearchParams ? filters.getAll('tag') : options.tags || options.tag || [];
  return { ...options, tags: [...new Set((Array.isArray(tags) ? tags : [tags]).filter(value => typeof value === 'string' && value))], mode: attendanceMode(options.mode) };
}

/**
 * Apply OR within topics, AND with Recurring and the other selected dimensions.
 * @param {Object} entry Indexed event and facet values.
 * @param {Object} options Normalized filters.
 * @param {string} omit Optional dimension to ignore.
 * @return {boolean} Whether the remaining conditions match.
 */
function matchesFilters(entry, options, omit = '') {
  if (!Object.entries(fields).every(([filter, field]) => omit === filter || !options[filter] || entry.facets[field].includes(options[filter]))) return false;
  const topics = options.tags.filter(tag => tag !== 'Recurring');
  return (omit === 'topic' || !topics.length || topics.some(tag => entry.facets.tags.includes(tag)))
    && (omit === 'recurring' || !options.tags.includes('Recurring') || entry.facets.tags.includes('Recurring'));
}

/**
 * Count choices with other dimensions applied, retaining zero-count choices.
 * @param {Object[]} candidates Date/search candidates.
 * @param {Object} options Active conditions.
 * @param {string} field Facet field to count.
 * @param {string} omit Dimension whose selection is ignored.
 * @return {Object[]} Contextual value/count pairs.
 */
function facetCounts(candidates, options, field, omit) {
  const counts = new Map(candidates.flatMap(entry => entry.facets[field]).map(value => [value, 0]));
  for (const entry of candidates) if (matchesFilters(entry, options, omit)) {
    for (const value of entry.facets[field]) counts.set(value, counts.get(value) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, count }));
}

/**
 * Count each date-navigation choice under the active search and filters.
 * Days use published start dates; All and Ongoing keep their own view rules.
 * @param {Object[]} entries All indexed occurrences.
 * @param {Object} options Normalized filters.
 * @param {Map|null} scores Search matches, or null without a query.
 * @param {Object} context Current New York day and epoch instant.
 * @return {Object} All-upcoming and Ongoing totals with per-day value/count pairs.
 */
function viewCounts(entries, options, scores, context) {
  const days = new Map();
  let all = 0, ongoing = 0;
  for (const entry of entries) {
    if (entry.endDay < context.today || (scores && !scores.has(entry.event.id)) || !matchesFilters(entry, options)
      || !matchesEventView(entry, {}, context)) continue;
    all += 1;
    if (entry.startDay >= context.today) days.set(entry.startDay, (days.get(entry.startDay) || 0) + 1);
    if (matchesEventView(entry, { eventView: 'ongoing' }, context)) ongoing += 1;
  }
  return { all, ongoing, days: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, count })) };
}

/**
 * Query a generation using shared search, date, multi-tag, facet and paging rules.
 * @param {Object} snapshot Complete published events and optional freshness time.
 * @param {Object|URLSearchParams} filters User query and selected dimensions.
 * @param {Object} context Optional current clock, date and display zone.
 * @return {Object} Original events, totals and context-sensitive facet counts.
 */
export function queryEventsSnapshot(snapshot, filters = {}, context = {}) {
  if (!Array.isArray(snapshot?.events)) throw new Error('The published snapshot has no events array.');
  const options = normalizeEventFilters(filters);
  if (options.eventView && !EVENT_VIEWS.includes(options.eventView)) throw new Error('Unknown event browsing view');
  const timeZone = context.timeZone || TIME_ZONE;
  const today = context.today || zonedDay(context.now ?? Date.now(), timeZone);
  const from = options.from ? calendarDay(options.from) : today;
  const to = options.to ? calendarDay(options.to) : '';
  if (!from || (options.to && !to)) throw new Error('Dates must use a valid YYYY-MM-DD value.');
  if (to && to < from) throw new Error('The end date must be on or after the start date.');
  const { engine, entries } = indexedEvents(snapshot.events, timeZone);
  const terms = searchTokens(options.query || options.q).slice(0, 16);
  const scores = terms.length ? new Map(engine.search(terms.join(' ')).map(result => [result.id, result.score])) : null;
  const candidates = entries.filter(entry => entry.endDay >= from && (!to || entry.startDay <= to)
    && matchesEventView(entry, { ...options, from, to }, { today, now: context.now })
    && (!scores || scores.has(entry.event.id)));
  const matching = candidates.filter(entry => matchesFilters(entry, options));
  matching.sort((a, b) => (scores ? scores.get(b.event.id) - scores.get(a.event.id) : 0)
    || String(a.event.start).localeCompare(String(b.event.start)) || String(a.event.id).localeCompare(String(b.event.id)));
  const tags = facetCounts(candidates, options, 'tags', 'topic').filter(tag => tag.value !== 'Recurring');
  const recurring = facetCounts(candidates, options, 'tags', 'recurring').find(tag => tag.value === 'Recurring');
  if (recurring) tags.push(recurring);
  tags.sort((a, b) => a.value.localeCompare(b.value));
  const requestedSize = Number(options.limit), requestedPage = Number(options.page);
  const pageSize = Number.isFinite(requestedSize) ? Math.max(1, Math.min(100, Math.floor(requestedSize) || 30)) : 30;
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage) || 1) : 1;
  return { events: matching.slice((page - 1) * pageSize, page * pageSize).map(entry => entry.event), total: matching.length, page, pageSize,
    facets: { departments: facetCounts(candidates, options, 'departments', 'department'), orgs: facetCounts(candidates, options, 'orgs', 'org'),
      tags, campuses: facetCounts(candidates, options, 'campus', 'campus'), modes: facetCounts(candidates, options, 'mode', 'mode'),
      views: viewCounts(entries, options, scores, { today, now: context.now }) },
    lastUpdated: context.lastUpdated || snapshot.lastUpdated || null };
}
