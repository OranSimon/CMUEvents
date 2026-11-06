import { DatabaseSync } from 'node:sqlite';
import { classifyEvent } from '../classify.mjs';
import { localDay } from '../config.mjs';
import { calendarEligibility } from '../../web/event-semantics.js';
import { canonicalEventUrl as canonicalUrl, occurrenceStorageKey, mergeOccurrences, occurrenceLinks, sharedLinkTitle } from './occurrence-merge.mjs';
import { addDays } from './normalize.mjs';
import { queryEventsSnapshot } from '../../web/event-query.js';

/**
 * Match a date-only listing to a timed detail on the same published local day.
 * @param {Object} event Normalized source occurrence.
 * @return {string|null} Exact title/link/day identity, or null for invalid data.
 */
function detailDayKey(event) {
  try {
    const day = event.start.length === 10 ? event.start : new Intl.DateTimeFormat('en-CA', {
      timeZone: event.timeZone || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(event.start));
    return `${canonicalUrl(event.url)}|${event.title.trim().replace(/\s+/g, ' ').toLocaleLowerCase()}|${day}`;
  } catch { return null; }
}

/**
 * Match one imprecise single-day occurrence to a unique current published clock.
 * Exact URL, title and local day are required. Multiple clocks, different unknown
 * identities and explicit all-day records remain separate. Multiday enrichment
 * additionally requires an exact full local span and shared individual identity.
 * @param {Object[]} events Current normalized source snapshots.
 * @return {Map<string,Object>} Safe title/link/day clock upgrades.
 */
function timedDayUpgrades(events) {
  const dayInZone = (value, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const groups = new Map();
  for (const event of events) {
    const key = detailDayKey(event);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  const upgrades = new Map();
  for (const [key, group] of groups) {
    if (group.some(event => event.timePrecision === 'all-day'
      || (event.timePrecision === 'date' && Date.parse(event.end) - Date.parse(event.start) !== 86400000))) continue;
    const dates = group.filter(event => event.timePrecision === 'date');
    const clocks = group.filter(event => event.timePrecision === 'time');
    if (!dates.length || !clocks.length || new Set(dates.map(event => event.uid || `${event.url}|${event.start}`)).size !== 1
      || new Set(clocks.map(event => event.start)).size !== 1
      || new Set(clocks.filter(event => Date.parse(event.end) > Date.parse(event.start)).map(event => event.end)).size > 1) continue;
    upgrades.set(key, clocks.find(event => Date.parse(event.end) > Date.parse(event.start)) || clocks[0]);
  }
  // An imprecise multi-day span needs a shared individual page and an exactly
  // matching local date span. Several clocks/ranges remain unresolved.
  for (const event of events.filter(event => event.timePrecision === 'date' && Date.parse(event.end) - Date.parse(event.start) > 86400000)) {
    const links = new Set(occurrenceLinks(event));
    const matches = events.filter(clock => clock.timePrecision === 'time' && Date.parse(clock.end) > Date.parse(clock.start)
      && sharedLinkTitle(event, clock) && occurrenceLinks(clock).some(link => links.has(link))
      && dayInZone(clock.start, event.timeZone) === event.start
      && addDays(dayInZone(Date.parse(clock.end) - 1, event.timeZone)) === event.end);
    const ranges = new Map(matches.map(clock => [`${clock.start}|${clock.end}`, clock]));
    if (ranges.size === 1) upgrades.set(detailDayKey(event), [...ranges.values()][0]);
  }
  return upgrades;
}

/**
 * Open the persistent event store and initialize its small SQLite schema.
 * @param {string} filename Database path, or :memory: for isolated tests.
 * @return {Object} Persistence, search and source-health operations.
 */
export function openStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY, plan TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
      last_attempt TEXT, last_success TEXT, error TEXT, warnings TEXT, event_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS occurrences (
      source_id TEXT NOT NULL, occurrence_key TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY(source_id, occurrence_key)
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, start TEXT NOT NULL, end TEXT NOT NULL,
      start_day TEXT NOT NULL, end_day TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS event_days ON events(start_day, end_day);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS http_cache (
      url TEXT PRIMARY KEY, etag TEXT, modified TEXT, body BLOB NOT NULL, fetched_at TEXT NOT NULL
    );`);

  /**
   * Load a JSON metadata value.
   * @param {string} key Metadata key.
   * @param {unknown} fallback Value used when the key is absent.
   * @return {unknown} Stored JSON value or fallback.
   */
  function getMeta(key, fallback = null) {
    const row = db.prepare('SELECT value FROM metadata WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  }

  /**
   * Persist a JSON metadata value.
   * @param {string} key Metadata key.
   * @param {unknown} value Serializable value.
   * @return {void}
   */
  function setMeta(key, value) {
    db.prepare('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  }

  /**
   * Synchronize source definitions while retaining successful snapshots and health.
   * @param {Array<Object>} plans Complete source catalog strategy mapping.
   * @return {void}
   */
  function registerPlans(plans) {
    const insert = db.prepare('INSERT INTO sources(id,plan,state) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET plan=excluded.plan');
    db.exec('BEGIN');
    try {
      for (const plan of plans) {
        const state = ['covered', 'subscription_only', 'unsupported', 'blocked'].includes(plan.status) ? plan.status : 'pending';
        const previousRow = db.prepare('SELECT plan FROM sources WHERE id=?').get(plan.id);
        const previous = previousRow ? JSON.parse(previousRow.plan) : null;
        const changed = previous && (previous.adapter !== plan.adapter || previous.fetchUrl !== plan.fetchUrl
          || previous.status !== plan.status || JSON.stringify(previous.options) !== JSON.stringify(plan.options));
        insert.run(plan.id, JSON.stringify(plan), state);
        if (changed || state !== 'pending') db.prepare('DELETE FROM metadata WHERE key=?').run(`sourceCoverage:${plan.id}`);
        if (state !== 'pending') db.prepare('UPDATE sources SET state=?,error=NULL,warnings=NULL WHERE id=?').run(state, plan.id);
        else if (changed) db.prepare('UPDATE sources SET state=\'pending\',last_attempt=NULL,error=NULL WHERE id=?').run(plan.id);
        if (state === 'covered') {
          db.prepare('DELETE FROM occurrences WHERE source_id=?').run(plan.id);
          db.prepare('UPDATE sources SET event_count=0 WHERE id=?').run(plan.id);
        }
      }
      const active = new Set(plans.map(plan => plan.id));
      for (const { id } of db.prepare('SELECT id FROM sources').all()) if (!active.has(id)) {
        db.prepare('DELETE FROM sources WHERE id=?').run(id);
        db.prepare('DELETE FROM metadata WHERE key=?').run(`sourceCoverage:${id}`);
        db.prepare('DELETE FROM occurrences WHERE source_id=?').run(id);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  /**
   * Replace a source snapshot only after a complete successful adapter response.
   * @param {string} sourceId Source identifier.
   * @param {Array<Object>} events Normalized source occurrences.
   * @param {Array<string>} warnings Extraction limitations.
   * @param {string} now ISO refresh timestamp.
   * @param {string} zeroState Distinguish a reviewed undated resource from an empty calendar.
   * @param {string|null} partialError Detail-only limitation after an exhaustive inventory.
   * @return {void}
   */
  function replaceSource(sourceId, events, warnings = [], now = new Date().toISOString(), zeroState = 'empty', partialError = null) {
    if (!['empty', 'undated'].includes(zeroState)) throw new Error('Invalid zero-record source state');
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM occurrences WHERE source_id=?').run(sourceId);
      const insert = db.prepare('INSERT OR REPLACE INTO occurrences VALUES (?,?,?)');
      for (const event of events) insert.run(sourceId, occurrenceStorageKey(event), JSON.stringify(event));
      db.prepare('UPDATE sources SET state=?,last_attempt=?,last_success=?,error=?,warnings=?,event_count=? WHERE id=?')
        .run(partialError ? 'error' : events.length ? 'ok' : zeroState, now, now, partialError, JSON.stringify(warnings), events.length, sourceId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  /**
   * Record a refresh failure without removing the last successful event snapshot.
   * @param {string} sourceId Source identifier.
   * @param {Error|string} error Failure diagnostic.
   * @param {string} now ISO timestamp.
   * @return {void}
   */
  function failSource(sourceId, error, now = new Date().toISOString()) {
    db.prepare('UPDATE sources SET state=\'error\',last_attempt=?,error=? WHERE id=?').run(now, String(error.message || error).slice(0, 1200), sourceId);
  }

  /**
   * Add safely parsed partial results while retaining the last complete snapshot.
   * @param {string} sourceId Source identifier.
   * @param {Array<Object>} events Valid records from an incomplete extraction.
   * @param {Array<string>} warnings Reasons the snapshot is incomplete.
   * @param {Object} options Explicit nonrecurring provider identities to reconcile.
   * @param {Array<string>} options.singleEventUids UIDs that identify one event, never a recurring series.
   * @return {void}
   */
  function mergePartial(sourceId, events, warnings = [], options = {}) {
    db.exec('BEGIN');
    try {
      const previous = db.prepare('SELECT occurrence_key,data FROM occurrences WHERE source_id=?').all(sourceId)
        .map(row => ({ key: row.occurrence_key, event: JSON.parse(row.data) }));
      const singleEventUids = new Set(Array.isArray(options.singleEventUids)
        ? options.singleEventUids.filter(uid => typeof uid === 'string' && uid.trim()) : []);
      const freshByUid = new Map();
      const previousByUid = new Map();
      for (const event of events) if (singleEventUids.has(event.uid)) {
        freshByUid.set(event.uid, [...(freshByUid.get(event.uid) || []), event]);
      }
      for (const row of previous) if (singleEventUids.has(row.event.uid)) {
        previousByUid.set(row.event.uid, [...(previousByUid.get(row.event.uid) || []), row]);
      }
      const timed = event => typeof event.start === 'string' && event.start.includes('T')
        && Number.isFinite(Date.parse(event.start));
      const dateOnly = event => typeof event.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(event.start);
      const removeKeys = new Set();
      const handledUids = new Set();
      const skippedEvents = new Set();
      const effectiveWarnings = [...warnings];
      for (const [uid, fresh] of freshByUid) {
        // A UID shared by multiple fresh occurrences may describe recurrence.
        if (fresh.length !== 1) continue;
        const old = previousByUid.get(uid) || [];
        if (timed(fresh[0])) {
          handledUids.add(uid);
          for (const row of old) removeKeys.add(row.key);
        } else if (dateOnly(fresh[0])) {
          handledUids.add(uid);
          if (old.some(row => timed(row.event))) {
            skippedEvents.add(fresh[0]);
            effectiveWarnings.push(`Retained the last accepted clock for ${uid}; the partial response supplies only a date.`);
          }
          // Retain accepted clocks if current verification failed, but discard
          // superseded date-only versions of this explicitly single event.
          for (const row of old) if (dateOnly(row.event)) removeKeys.add(row.key);
        }
      }
      const acceptedEvents = events.filter(event => !skippedEvents.has(event));
      const freshByDay = new Map();
      const previousByDay = new Map();
      for (const event of acceptedEvents) {
        if (handledUids.has(event.uid)) continue;
        const key = detailDayKey(event);
        if (key) freshByDay.set(key, [...(freshByDay.get(key) || []), event]);
      }
      for (const row of previous) {
        if (removeKeys.has(row.key) || handledUids.has(row.event.uid)) continue;
        const key = detailDayKey(row.event);
        if (key) previousByDay.set(key, [...(previousByDay.get(key) || []), row]);
      }
      // A uniquely matched timed detail can enrich a prior unknown-time record
      // even when another child failed. Explicit all-day and ambiguous records stay.
      const remove = db.prepare('DELETE FROM occurrences WHERE source_id=? AND occurrence_key=?');
      for (const [key, fresh] of freshByDay) {
        const old = previousByDay.get(key);
        if (fresh.length !== 1 || old?.length !== 1) continue;
        if (fresh[0].timePrecision !== 'time' || old[0].event.timePrecision !== 'date') continue;
        if (Date.parse(old[0].event.end) - Date.parse(old[0].event.start) !== 86400000) continue;
        removeKeys.add(old[0].key);
      }
      for (const key of removeKeys) remove.run(sourceId, key);
      const insert = db.prepare('INSERT OR REPLACE INTO occurrences VALUES (?,?,?)');
      for (const event of acceptedEvents) insert.run(sourceId, occurrenceStorageKey(event), JSON.stringify(event));
      const count = db.prepare('SELECT COUNT(*) AS count FROM occurrences WHERE source_id=?').get(sourceId).count;
      db.prepare('UPDATE sources SET state=\'error\',last_attempt=?,error=?,warnings=?,event_count=? WHERE id=?')
        .run(new Date().toISOString(), `Incomplete extraction; previous records retained. ${effectiveWarnings.join(' ')}`.slice(0, 1200), JSON.stringify(effectiveWarnings), count, sourceId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  /**
   * Prepare source claims with aliases and independently verified clock upgrades.
   * @param {Array<Object>} plans Source definitions including covered aliases.
   * @return {Object[]} Occurrences before cross-source deduplication.
   */
  function prepareOccurrences(plans) {
    const byId = new Map(plans.map(plan => [plan.id, plan]));
    const aliases = new Map();
    for (const plan of plans) if (plan.status === 'covered' && plan.canonicalSourceId) {
      const list = aliases.get(plan.canonicalSourceId) || [];
      list.push(plan);
      aliases.set(plan.canonicalSourceId, list);
    }
    const prepared = [];
    const rows = db.prepare('SELECT source_id,data FROM occurrences ORDER BY source_id,occurrence_key').all()
      .filter(row => byId.has(row.source_id) && byId.get(row.source_id).status !== 'covered')
      .map(row => ({ ...row, event: JSON.parse(row.data) }));
    const upgrades = timedDayUpgrades(rows.map(row => ({ ...row.event, sources: [byId.get(row.source_id)] })));
    for (const row of rows) {
      const plan = byId.get(row.source_id);
      if (!plan || plan.status === 'covered') continue;
      let event = row.event;
      const clock = event.timePrecision === 'date' ? upgrades.get(detailDayKey(event)) : null;
      if (clock) event = { ...event, _sourceClaim: { ...event }, start: clock.start, end: clock.end, timeZone: clock.timeZone,
        timePrecision: 'time', allDay: false,
        // The unique matching detail also supplies the explicitly linked identity.
        // Keep the original date claim while carrying that evidence into every
        // pairwise check; a stale list heading must not block its linked copy.
        relatedEventUrls: [...new Set([...(event.relatedEventUrls || []), ...occurrenceLinks(clock)])] };
      event.sources = [plan, ...(aliases.get(plan.id) || [])].map(source => ({
        id: source.id, department: source.department, org: source.org, url: source.url, eventUrl: event.url,
      }));
      prepared.push(event);
    }
    return prepared;
  }

  /**
   * Rebuild events from source snapshots and optional corroborated semantic edges.
   * @param {Array<Object>} plans Source definitions including covered aliases.
   * @param {Set<string>} semanticMatches Accepted Jev pairs, if enabled.
   * @param {Map<string,Object>} selectedTimes Temporary clock choices keyed by source and occurrence.
   * @return {number} Number of distinct eligible occurrences.
   */
  function rebuildEvents(plans, semanticMatches, selectedTimes) {
    const { events: merged, report: mergeReport } = mergeOccurrences(prepareOccurrences(plans), semanticMatches, selectedTimes);
    db.exec('BEGIN');
    try {
      db.exec('DELETE FROM events;');
      const insert = db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?)');
      let publishedCount = 0;
      const exclusions = [];
      for (const raw of merged) {
        const eligibility = calendarEligibility(raw);
        if (!eligibility.eligible) { exclusions.push({ uid: raw.uid, title: raw.title, url: raw.url, sourceIds: raw.sources.map(source => source.id), code: eligibility.code, reason: eligibility.reason }); continue; }
        publishedCount++;
        const sources = raw.sources.sort((a, b) => a.department.localeCompare(b.department) || a.org.localeCompare(b.org));
        const departments = [...new Set(sources.map(source => source.department))];
        const orgs = [...new Set(sources.map(source => source.org))];
        const event = classifyEvent({ ...raw, sources, departments, orgs, department: departments[0], org: orgs[0],
          timezone: raw.timeZone, endExclusive: raw.allDay });
        const startDay = event.allDay ? event.start.slice(0, 10) : localDay(event.start);
        const exclusiveEnd = Date.parse(event.end) > Date.parse(event.start) ? Date.parse(event.end) - 1 : Date.parse(event.start);
        const endDay = event.allDay ? new Date(exclusiveEnd).toISOString().slice(0, 10) : localDay(exclusiveEnd);
        insert.run(event.id, event.start, event.end, startDay, endDay, JSON.stringify(event));
      }
      setMeta('eventMerges', { ...mergeReport, checkedAt: new Date().toISOString() });
      setMeta('eventExclusions', { checkedAt: new Date().toISOString(), count: exclusions.length, records: exclusions });
      db.exec('COMMIT');
      return publishedCount;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  /**
   * Inspect built occurrences through the same query rules used by the published site.
   * @param {Object} options Search, date, categorical and pagination parameters.
   * @return {Object} Paged events, totals and date/query-scoped facet counts.
   */
  function listEvents(options = {}) {
    const events = db.prepare('SELECT data FROM events ORDER BY start,id').all().map(row => JSON.parse(row.data));
    return queryEventsSnapshot({ events, lastUpdated: getMeta('lastUpdated') }, { ...options, from: options.from || '0001-01-01' },
      { today: options.today, now: options.now });
  }

  /**
   * Retrieve source health, including honest unsupported and subscription states.
   * @return {Array<Object>} Source plans enriched with persisted refresh health.
   */
  function listSources() {
    const excluded = new Map();
    for (const record of getMeta('eventExclusions', { records: [] }).records || []) for (const id of record.sourceIds || []) {
      const counts = excluded.get(id) || {};
      counts[record.code] = (counts[record.code] || 0) + 1;
      excluded.set(id, counts);
    }
    return db.prepare('SELECT * FROM sources ORDER BY id').all().map(row => ({ ...JSON.parse(row.plan),
      state: row.state, lastAttempt: row.last_attempt, lastSuccess: row.last_success, error: row.error,
      warnings: JSON.parse(row.warnings || '[]'),
      eventCount: Math.max(0, row.event_count - Object.values(excluded.get(row.id) || {}).reduce((sum, count) => sum + count, 0)),
      excludedCount: Object.values(excluded.get(row.id) || {}).reduce((sum, count) => sum + count, 0), exclusionReasons: excluded.get(row.id) || {}, coverage: getMeta(`sourceCoverage:${row.id}`) }));
  }

  /**
   * Return aggregate ingestion health for the interface.
   * @return {Object} Event count, source-state counts and latest refresh metadata.
   */
  function status() {
    const counts = { total: 0, ok: 0, empty: 0, undated: 0, error: 0, covered: 0, unsupported: 0, subscription_only: 0, blocked: 0, pending: 0 };
    for (const row of db.prepare('SELECT state,COUNT(*) AS count FROM sources GROUP BY state').all()) {
      counts.total += row.count;
      counts[row.state] = row.count;
    }
    return { lastUpdated: getMeta('lastUpdated'), totalEvents: db.prepare('SELECT COUNT(*) AS count FROM events').get().count,
      sources: counts, lastRefresh: getMeta('lastRefresh') };
  }


  /**
   * Retrieve anonymous HTTP cache metadata and bytes.
   * @param {string} url Original fetch URL.
   * @return {Object|undefined} Cached body and validators, if available.
   */
  function getCache(url) {
    return db.prepare('SELECT * FROM http_cache WHERE url=?').get(url);
  }

  /**
   * Remove a raw response when a source adapter permits only whitelisted fields.
   * @param {string} url Original fetch URL.
   * @return {void}
   */
  function deleteCache(url) { db.prepare('DELETE FROM http_cache WHERE url=?').run(url); }

  /**
   * Store a successful anonymous public response and its HTTP validators.
   * @param {string} url Original fetch URL.
   * @param {Uint8Array} body Complete bounded response bytes.
   * @param {string|null} etag Server ETag.
   * @param {string|null} modified Server Last-Modified timestamp.
   * @return {void}
   */
  function putCache(url, body, etag, modified) {
    db.prepare('INSERT INTO http_cache VALUES (?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET etag=excluded.etag,modified=excluded.modified,body=excluded.body,fetched_at=excluded.fetched_at')
      .run(url, etag || null, modified || null, body, new Date().toISOString());
  }

  /**
   * Close this SQLite connection after pending work has stopped.
   * @return {void}
   */
  function close() { db.close(); }

  return { db, registerPlans, replaceSource, mergePartial, failSource, prepareOccurrences, rebuildEvents, listEvents, listSources, status, getMeta, setMeta,
    getCache, putCache, deleteCache, close };
}
