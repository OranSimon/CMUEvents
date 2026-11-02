import { queryEventsSnapshot, prepareSnapshotSearch, SEARCH_SCHEMA, SEARCH_ENGINE_VERSION } from "./event-query.js";
export { queryEventsSnapshot } from "./event-query.js";

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
 * Read one coherent static publication; visitors never start collection.
 * @param {Object} options Application base URL, fetch implementation and clock.
 * @return {Object} Data methods for events, sources, status and refresh.
 */
export function createDataClient(options = {}) {
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
    if (!response.ok) throw new Error(`Published data returned ${response.status} for ${relative}.`);
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
      if (manifest.version !== 2 || manifest.eventSchema !== 2 || manifest.mode !== "static" || manifest.searchSchema !== SEARCH_SCHEMA || manifest.searchEngineVersion !== SEARCH_ENGINE_VERSION || !Number.isFinite(Date.parse(manifest.generatedAt))) throw new Error("The published manifest is invalid or uses an unsupported version.");
      lastManifestCheck = clock();
      if (snapshot && !force && snapshot.manifest.generatedAt === manifest.generatedAt) return snapshot;
      const params = new URLSearchParams({ generation: manifest.generatedAt });
      const [events, sources, status, search] = await Promise.all(["events", "sources", "status", "search"].map(name => readJson(`data/${name}.json`, { params })));
      if (!Array.isArray(events.events) || !Array.isArray(sources.sources) || !status || typeof status !== "object") throw new Error("The published snapshot is incomplete. Please reload shortly.");
      if ([events, sources, status, search].some(payload => payload.generatedAt !== manifest.generatedAt)) throw new Error("Published files are from different updates. Please reload shortly.");
      await prepareSnapshotSearch(events.events, search);
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
    const data = await withSignal(loadStatic(), request.signal);
    const status = publishedStatus(data);
    return { ...queryEventsSnapshot(data.events, params, { lastUpdated: status.lastUpdated, now: clock() }), mode: "static", generatedAt: status.generatedAt, refreshing: false };
  }

  /**
   * Read collection health and check for newly published static data.
   * @param {Object} request Optional caller cancellation signal.
   * @return {Promise<Object>} Published collection status.
   */
  async function getStatus(request = {}) {
    return publishedStatus(await withSignal(loadStatic(false, true), request.signal));
  }

  /**
   * Retrieve all source links, diagnostics and curated email channels.
   * @param {Object} request Optional caller cancellation signal.
   * @return {Promise<Object>} Complete source directory payload.
   */
  async function getSources(request = {}) {
    return (await withSignal(loadStatic(), request.signal)).sources;
  }

  /**
   * Reload published JSON without changing the collection schedule.
   * @return {Promise<Object>} Reloaded publication status.
   */
  async function refresh() {
    return publishedStatus(await loadStatic(true));
  }

  return { mode: "static", getEvents, getStatus, getSources, refresh };
}
