import { matchesEventView } from "./event-semantics.js";

const TIME_ZONE = "America/New_York";
const eventIndexes = new WeakMap();
const dayFormatters = new Map();

/**
 * Measure data age from the actual successful collection timestamp.
 * @param {Object} status Published status with an optional freshness threshold.
 * @param {number} now Current epoch time in milliseconds.
 * @return {Object} Successful time, age, threshold and stale-data flags.
 */
export function publicationFreshness(status, now = Date.now()) {
  const lastSuccessfulUpdate = status.lastSuccessfulUpdate || status.lastUpdated || null;
  const timestamp = Date.parse(lastSuccessfulUpdate);
  const thresholdHours = Number(status.staleAfterHours) > 0 ? Number(status.staleAfterHours) : 48;
  const known = Number.isFinite(timestamp);
  const ageHours = known ? Math.max(0, (now - timestamp) / 3600000) : null;
  return { lastSuccessfulUpdate, ageHours, thresholdHours, known, stale: !known || ageHours > thresholdHours };
}

/**
 * Validate a calendar date without converting its time zone.
 * @param {unknown} value Candidate ISO calendar day.
 * @return {string} Valid ISO day, or an empty string.
 */
function calendarDay(value) {
  const day = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === day ? day : "";
}

/**
 * Format an instant in the same display zone as the local API.
 * @param {number|Date|string} value Instant to format.
 * @param {string} timeZone IANA display time zone.
 * @return {string} ISO calendar day, or an empty string for an invalid instant.
 */
function zonedDay(value, timeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "";
  if (!dayFormatters.has(timeZone)) dayFormatters.set(timeZone, new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }));
  const parts = Object.fromEntries(dayFormatters.get(timeZone).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Tokenize Unicode text using case and accent insensitive word boundaries.
 * @param {unknown} value Searchable text.
 * @return {Array<string>} Normalized word tokens.
 */
function tokens(value) {
  return String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

/**
 * Resolve source-backed scalar or array values without changing event records.
 * @param {Object} event Complete published event.
 * @param {string} field Facet property name.
 * @return {Array<string>} Distinct nonempty facet values.
 */
function valuesFor(event, field) {
  let values = event[field];
  if (field === "departments" && !Array.isArray(values)) values = [event.department, ...(event.sources || []).map(source => source.department)];
  if (field === "orgs" && !Array.isArray(values)) values = [event.org || event.organizer, ...(event.sources || []).map(source => source.org)];
  return [...new Set((Array.isArray(values) ? values : [values]).filter(value => typeof value === "string" && value))];
}

/**
 * Normalize attendance labels accepted by the API and event controls.
 * @param {unknown} value Attendance format.
 * @return {string} Canonical format label.
 */
function attendanceMode(value) {
  const text = String(value || "");
  return ({ online: "Online", virtual: "Online", "in-person": "In person", "in person": "In person", in_person: "In person", hybrid: "Hybrid", unspecified: "Unspecified", unknown: "Unspecified" })[text.toLowerCase()] || text;
}

/**
 * Cache searchable fields and date bounds for an immutable event snapshot.
 * @param {Array<Object>} events Complete published events.
 * @param {string} timeZone Display zone used for timed overlap boundaries.
 * @return {Array<Object>} Indexed events retaining their original public fields.
 */
function indexEvents(events, timeZone) {
  const cached = eventIndexes.get(events);
  if (cached?.timeZone === timeZone) return cached.entries;
  const entries = events.map(event => {
    if (!event || typeof event !== "object") return null;
    const start = event.start || event.startDate || event.date;
    const allDay = event.allDay || Boolean(calendarDay(start));
    const startInstant = Date.parse(start);
    const endInstant = Date.parse(event.end || start);
    const startDay = allDay ? calendarDay(String(start || "").slice(0, 10)) : zonedDay(start, timeZone);
    if (!startDay || !Number.isFinite(startInstant)) return null;
    const lastInstant = Number.isFinite(endInstant) && endInstant > startInstant ? endInstant - (allDay && event.endExclusive === false ? 0 : 1) : startInstant;
    const endDay = allDay ? new Date(lastInstant).toISOString().slice(0, 10) : zonedDay(lastInstant, timeZone);
    const facets = Object.fromEntries(["departments", "orgs", "tags", "campus", "mode"].map(field => [field, field === "mode" ? [attendanceMode(event.mode)].filter(Boolean) : valuesFor(event, field)]));
    const title = tokens(event.title);
    const publisher = tokens([...facets.departments, ...facets.orgs, ...facets.tags, event.location?.name || event.location || "", event.organizer || ""].join(" "));
    const description = tokens(event.description || event.summary);
    return { event, startDay, endDay, facets, title, publisher, description, words: [...new Set([...title, ...publisher, ...description])] };
  }).filter(Boolean);
  eventIndexes.set(events, { timeZone, entries });
  return entries;
}

/**
 * Count facets in date and search candidates before categorical filtering.
 * @param {Array<Object>} entries Indexed candidate events.
 * @param {string} field Indexed facet field.
 * @return {Array<Object>} Alphabetical value and count pairs.
 */
function facetCounts(entries, field) {
  const counts = new Map();
  entries.forEach(entry => entry.facets[field].forEach(value => counts.set(value, (counts.get(value) || 0) + 1)));
  return [...counts].sort(([left], [right]) => left.localeCompare(right)).map(([value, count]) => ({ value, count }));
}

/**
 * Rank title and publisher matches above description-only matches.
 * @param {Object} entry Indexed event.
 * @param {Array<string>} terms Prefix terms from the search query.
 * @return {number} Deterministic relevance weight.
 */
function relevance(entry, terms) {
  return terms.reduce((score, term) => score + [[entry.title, 8], [entry.publisher, 3], [entry.description, 1]].reduce((weight, [words, multiplier]) => weight + words.filter(word => word.startsWith(term)).length * multiplier, 0), 0);
}

/**
 * Search a complete static snapshot using the local calendar filter contract.
 * @param {Object} snapshot Published event payload with an events array.
 * @param {Object|URLSearchParams} filters Search, overlap, category and page options.
 * @param {Object} context Optional today, timeZone and lastUpdated values.
 * @return {Object} Paged complete events and date/query-scoped facet counts.
 */
export function queryEventsSnapshot(snapshot, filters = {}, context = {}) {
  if (!Array.isArray(snapshot?.events)) throw new Error("The published snapshot has no events array.");
  const options = filters instanceof URLSearchParams ? Object.fromEntries(filters) : filters;
  const timeZone = context.timeZone || TIME_ZONE;
  const from = options.from ? calendarDay(options.from) : context.today || zonedDay(context.now ?? Date.now(), timeZone);
  const to = options.to ? calendarDay(options.to) : "";
  if (!from || (options.to && !to)) throw new Error("Dates must use a valid YYYY-MM-DD value.");
  if (to && to < from) throw new Error("The end date must be on or after the start date.");
  const terms = tokens(options.query || options.q).slice(0, 16);
  const today = context.today || zonedDay(context.now ?? Date.now(), timeZone);
  const candidates = indexEvents(snapshot.events, timeZone).filter(entry => entry.endDay >= from && (!to || entry.startDay <= to)
    && matchesEventView(entry, { ...options, from, to }, { today, now: context.now })
    && terms.every(term => entry.words.some(word => word.startsWith(term))));
  const fields = { department: "departments", org: "orgs", tag: "tags", campus: "campus", mode: "mode" };
  const matching = candidates.filter(entry => Object.entries(fields).every(([filter, field]) => !options[filter] || entry.facets[field].includes(filter === "mode" ? attendanceMode(options[filter]) : options[filter])));
  const scores = terms.length ? new Map(matching.map(entry => [entry, relevance(entry, terms)])) : null;
  matching.sort((left, right) => (scores ? scores.get(right) - scores.get(left) : 0) || String(left.event.start).localeCompare(String(right.event.start)) || String(left.event.id || "").localeCompare(String(right.event.id || "")));
  const requestedSize = Number(options.limit);
  const requestedPage = Number(options.page);
  const pageSize = Number.isFinite(requestedSize) ? Math.max(1, Math.min(100, Math.floor(requestedSize) || 30)) : 30;
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage) || 1) : 1;
  return { events: matching.slice((page - 1) * pageSize, page * pageSize).map(entry => entry.event), total: matching.length, page, pageSize,
    facets: { departments: facetCounts(candidates, "departments"), orgs: facetCounts(candidates, "orgs"), tags: facetCounts(candidates, "tags"), campuses: facetCounts(candidates, "campus"), modes: facetCounts(candidates, "mode") },
    lastUpdated: context.lastUpdated || snapshot.lastUpdated || null };
}

/**
 * Await a shared fetch without letting one cancelled view abort other readers.
 * @param {Promise<Object>} promise Shared snapshot request.
 * @param {AbortSignal|undefined} signal Optional caller cancellation signal.
 * @return {Promise<Object>} Shared result unless this caller is cancelled.
 */
function withSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("The request was cancelled.", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("The request was cancelled.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

/**
 * Select the API or read-only published JSON transport for the same interface.
 * @param {Object} options Mode, application base URL, fetch implementation and clock.
 * @return {Object} Data methods for events, sources, status and refresh.
 */
export function createDataClient(options = {}) {
  const mode = options.mode === "static" ? "static" : "api";
  const baseUrl = new URL(options.baseUrl || "./", import.meta.url);
  const fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
  const clock = options.clock || Date.now;
  let snapshot = null;
  let inFlight = null;
  let lastManifestCheck = 0;

  /**
   * Retrieve same-application JSON using an optional generation cache key.
   * @param {string} relative Application-relative resource path.
   * @param {Object} request Fetch options and optional query parameters.
   * @return {Promise<Object>} Parsed JSON payload or a readable transport error.
   */
  async function readJson(relative, request = {}) {
    const url = new URL(relative, baseUrl);
    if (request.params) url.search = String(request.params);
    const response = await fetchImpl(url.href, { method: request.method || "GET", headers: { Accept: "application/json" }, cache: "no-store", ...(request.signal ? { signal: request.signal } : {}) });
    if (!response.ok) throw new Error(`${mode === "static" ? "Published data" : "Event service"} returned ${response.status} for ${relative}.`);
    return response.json();
  }

  /**
   * Load one complete publication before replacing the previous usable snapshot.
   * @param {boolean} force Whether to reload unchanged published files.
   * @param {boolean} check Whether to check for a new manifest after the cache interval.
   * @return {Promise<Object>} Coherent published manifest, events, sources and status.
   */
  async function loadStatic(force = false, check = false) {
    if (inFlight) return inFlight;
    if (snapshot && !force && (!check || clock() - lastManifestCheck < 60000)) return snapshot;
    inFlight = (async () => {
      const manifest = await readJson("data/manifest.json", { params: new URLSearchParams({ check: String(clock()) }) });
      if (manifest.version !== 1 || manifest.eventSchema !== 2 || manifest.mode !== "static" || !Number.isFinite(Date.parse(manifest.generatedAt))) throw new Error("The published manifest is invalid or uses an unsupported version.");
      lastManifestCheck = clock();
      if (snapshot && !force && snapshot.manifest.generatedAt === manifest.generatedAt) return snapshot;
      const params = new URLSearchParams({ generation: manifest.generatedAt });
      const [events, sources, status] = await Promise.all(["events", "sources", "status"].map(name => readJson(`data/${name}.json`, { params })));
      if (!Array.isArray(events.events) || !Array.isArray(sources.sources) || !status || typeof status !== "object") throw new Error("The published snapshot is incomplete. Please reload shortly.");
      if ([events, sources, status].some(payload => payload.generatedAt !== manifest.generatedAt)) throw new Error("Published files are from different updates. Please reload shortly.");
      snapshot = { manifest, events, sources, status };
      return snapshot;
    })();
    try { return await inFlight; }
    finally { inFlight = null; }
  }

  /**
   * Attach publication timing while retaining the actual last successful refresh.
   * @param {Object} data Complete coherent published snapshot.
   * @return {Object} Status fields for static refresh and freshness messaging.
   */
  function publishedStatus(data) {
    return { ...data.status, mode: "static", generatedAt: data.manifest.generatedAt,
      lastUpdated: data.status.lastUpdated || data.manifest.lastUpdated || null,
      lastSuccessfulUpdate: data.status.lastSuccessfulUpdate || data.status.lastUpdated || data.manifest.lastUpdated || null,
      updateIntervalHours: Number(data.manifest.updateIntervalHours) > 0 ? Number(data.manifest.updateIntervalHours) : 24,
      staleAfterHours: Number(data.manifest.staleAfterHours) > 0 ? Number(data.manifest.staleAfterHours) : 48,
      refreshing: false };
  }

  /**
   * Query events through the selected transport without losing detail fields.
   * @param {Object|URLSearchParams} params Calendar query parameters.
   * @param {Object} request Optional caller cancellation signal.
   * @return {Promise<Object>} Paginated event and facet response.
   */
  async function getEvents(params = {}, request = {}) {
    if (mode === "api") return readJson("api/events", { params: params instanceof URLSearchParams ? params : new URLSearchParams(params), signal: request.signal });
    const data = await withSignal(loadStatic(), request.signal);
    const status = publishedStatus(data);
    return { ...queryEventsSnapshot(data.events, params, { lastUpdated: status.lastUpdated, now: clock() }), mode, generatedAt: status.generatedAt, refreshing: false };
  }

  /**
   * Read collection health and check for newly published static data.
   * @param {Object} request Optional caller cancellation signal.
   * @return {Promise<Object>} API status or static publication status.
   */
  async function getStatus(request = {}) {
    if (mode === "api") return readJson("api/status", { signal: request.signal });
    return publishedStatus(await withSignal(loadStatic(false, true), request.signal));
  }

  /**
   * Retrieve all source links, diagnostics and curated email channels.
   * @param {Object} request Optional caller cancellation signal.
   * @return {Promise<Object>} Complete source directory payload.
   */
  async function getSources(request = {}) {
    if (mode === "api") return readJson("api/sources", { signal: request.signal });
    return (await withSignal(loadStatic(), request.signal)).sources;
  }

  /**
   * Reload published static JSON or request the local server refresh explicitly.
   * @return {Promise<Object>} Reloaded publication status or local refresh acceptance.
   */
  async function refresh() {
    return mode === "api" ? readJson("api/refresh", { method: "POST" }) : publishedStatus(await loadStatic(true));
  }

  return { mode, getEvents, getStatus, getSources, refresh };
}
