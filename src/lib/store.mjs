import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { classifyEvent } from '../classify.mjs';
import { localDay } from '../config.mjs';

/**
 * Build a short stable identifier for an event occurrence.
 * @param {string} value Canonical identity string.
 * @return {string} Stable hexadecimal identifier.
 */
function identifier(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

/**
 * Normalize links for duplicate matching without discarding meaningful query IDs.
 * @param {string} value Original event link.
 * @return {string} URL without fragment and known tracking parameters.
 */
function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href.replace(/\/$/, '');
  } catch { return value || ''; }
}

/**
 * Generate evidence-based duplicate keys for one occurrence.
 * @param {Object} event Normalized event.
 * @return {Array<string>} UID and source-link keys including the occurrence start.
 */
function occurrenceKeys(event) {
  const title = event.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const keys = [`url:${canonicalUrl(event.url)}|${event.start}|${title}`];
  if (event.uid) keys.unshift(`uid:${event.uid}|${event.start}`);
  return keys;
}

/**
 * Combine duplicate occurrences and retain the richest source description.
 * @param {Object} target Existing canonical event.
 * @param {Object} incoming Additional occurrence and provenance.
 * @return {Object} Mutated target with combined sources.
 */
function mergeEvent(target, incoming) {
  if ((incoming.description || '').length > (target.description || '').length) {
    target.description = incoming.description;
    target.summary = incoming.summary;
  }
  if (!target.location && incoming.location) target.location = incoming.location;
  if (!target.organizer && incoming.organizer) target.organizer = incoming.organizer;
  if (incoming.status === 'cancelled') target.status = 'cancelled';
  const sourceIds = new Set(target.sources.map(source => source.id));
  for (const source of incoming.sources) if (!sourceIds.has(source.id)) {
    target.sources.push(source);
    sourceIds.add(source.id);
  }
  target.tags = [...new Set([...(target.tags || []), ...(incoming.tags || [])])];
  return target;
}

/**
 * Convert user search into quoted prefix terms accepted by SQLite FTS5.
 * @param {string} query Untrusted user search string.
 * @return {string} Safe all-terms prefix expression, or empty for no usable terms.
 */
export function searchExpression(query) {
  return (String(query || '').match(/[\p{L}\p{N}]+/gu) || []).slice(0, 16)
    .map(term => `"${term.replaceAll('"', '""')}"*`).join(' AND ');
}

/**
 * Count array or scalar facet labels for a set of event documents.
 * @param {Array<Object>} events Matching events before categorical filters.
 * @param {string} property Event field to count.
 * @return {Array<Object>} Alphabetical value/count pairs.
 */
function facet(events, property) {
  const counts = new Map();
  for (const event of events) {
    const values = Array.isArray(event[property]) ? event[property] : [event[property]];
    for (const value of new Set(values.filter(Boolean))) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, count }));
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
    CREATE VIRTUAL TABLE IF NOT EXISTS event_search USING fts5(id UNINDEXED, title, publisher, description,
      tokenize='unicode61 remove_diacritics 2', prefix='2 3 4');
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
   * @return {void}
   */
  function replaceSource(sourceId, events, warnings = [], now = new Date().toISOString()) {
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM occurrences WHERE source_id=?').run(sourceId);
      const insert = db.prepare('INSERT OR REPLACE INTO occurrences VALUES (?,?,?)');
      for (const event of events) insert.run(sourceId, identifier(occurrenceKeys(event)[0]), JSON.stringify(event));
      db.prepare('UPDATE sources SET state=?,last_attempt=?,last_success=?,error=NULL,warnings=?,event_count=? WHERE id=?')
        .run(events.length ? 'ok' : 'empty', now, now, JSON.stringify(warnings), events.length, sourceId);
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
   * @return {void}
   */
  function mergePartial(sourceId, events, warnings = []) {
    db.exec('BEGIN');
    try {
      const insert = db.prepare('INSERT OR REPLACE INTO occurrences VALUES (?,?,?)');
      for (const event of events) insert.run(sourceId, identifier(occurrenceKeys(event)[0]), JSON.stringify(event));
      const count = db.prepare('SELECT COUNT(*) AS count FROM occurrences WHERE source_id=?').get(sourceId).count;
      db.prepare('UPDATE sources SET state=\'error\',last_attempt=?,error=?,warnings=?,event_count=? WHERE id=?')
        .run(new Date().toISOString(), `Incomplete extraction; previous records retained. ${warnings.join(' ')}`.slice(0, 1200), JSON.stringify(warnings), count, sourceId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  /**
   * Rebuild deduplicated events and search from successful source snapshots.
   * @param {Array<Object>} plans Source definitions including covered aliases.
   * @return {number} Number of distinct event occurrences.
   */
  function rebuildEvents(plans) {
    const byId = new Map(plans.map(plan => [plan.id, plan]));
    const aliases = new Map();
    for (const plan of plans) if (plan.status === 'covered' && plan.canonicalSourceId) {
      const list = aliases.get(plan.canonicalSourceId) || [];
      list.push(plan);
      aliases.set(plan.canonicalSourceId, list);
    }
    const merged = new Map();
    const keyMap = new Map();
    for (const row of db.prepare('SELECT source_id,data FROM occurrences ORDER BY source_id,occurrence_key').all()) {
      const plan = byId.get(row.source_id);
      if (!plan || plan.status === 'covered') continue;
      const event = JSON.parse(row.data);
      event.sources = [plan, ...(aliases.get(plan.id) || [])].map(source => ({
        id: source.id, department: source.department, org: source.org, url: source.url, eventUrl: event.url,
      }));
      const keys = occurrenceKeys(event);
      const matches = [...new Set(keys.map(key => keyMap.get(key)).filter(Boolean))];
      const id = matches[0] || identifier(keys[0]);
      if (!merged.has(id)) merged.set(id, { ...event, id });
      else mergeEvent(merged.get(id), event);
      for (const extraId of matches.slice(1)) {
        mergeEvent(merged.get(id), merged.get(extraId));
        merged.delete(extraId);
        for (const [key, value] of keyMap) if (value === extraId) keyMap.set(key, id);
      }
      for (const key of keys) keyMap.set(key, id);
    }
    db.exec('BEGIN');
    try {
      db.exec('DELETE FROM events; DELETE FROM event_search;');
      const insert = db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?)');
      const search = db.prepare('INSERT INTO event_search VALUES (?,?,?,?)');
      for (const raw of merged.values()) {
        const sources = raw.sources.sort((a, b) => a.department.localeCompare(b.department) || a.org.localeCompare(b.org));
        const departments = [...new Set(sources.map(source => source.department))];
        const orgs = [...new Set(sources.map(source => source.org))];
        const event = classifyEvent({ ...raw, sources, departments, orgs, department: departments[0], org: orgs[0],
          timezone: raw.timeZone, endExclusive: raw.allDay });
        const startDay = event.allDay ? event.start.slice(0, 10) : localDay(event.start);
        const exclusiveEnd = Date.parse(event.end) > Date.parse(event.start) ? Date.parse(event.end) - 1 : Date.parse(event.start);
        const endDay = event.allDay ? new Date(exclusiveEnd).toISOString().slice(0, 10) : localDay(exclusiveEnd);
        insert.run(event.id, event.start, event.end, startDay, endDay, JSON.stringify(event));
        search.run(event.id, event.title, [...departments, ...orgs, ...event.tags, event.location].join(' '), event.description);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return merged.size;
  }

  /**
   * Search text/date candidates, apply categorical filters and calculate facets.
   * @param {Object} options Search, date, categorical and pagination parameters.
   * @return {Object} Paged events, totals and date/query-scoped facet counts.
   */
  function listEvents(options = {}) {
    const query = searchExpression(options.query || options.q);
    const conditions = [];
    const args = [];
    if (options.from) { conditions.push('e.end_day>=?'); args.push(options.from); }
    if (options.to) { conditions.push('e.start_day<=?'); args.push(options.to); }
    let sql = 'SELECT e.data FROM events e';
    if (query) { sql += ' JOIN event_search f ON f.id=e.id'; conditions.push('event_search MATCH ?'); args.push(query); }
    if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
    sql += query ? ' ORDER BY bm25(event_search,0,8,3,1),e.start,e.id' : ' ORDER BY e.start,e.id';
    const candidates = db.prepare(sql).all(...args).map(row => JSON.parse(row.data));
    const fields = { department: 'departments', org: 'orgs', tag: 'tags', campus: 'campus', mode: 'mode' };
    const matching = candidates.filter(event => Object.entries(fields).every(([filter, field]) => !options[filter]
      || (Array.isArray(event[field]) ? event[field].includes(options[filter]) : event[field] === options[filter])));
    const requestedSize = Number(options.limit);
    const requestedPage = Number(options.page);
    const pageSize = Number.isFinite(requestedSize) ? Math.max(1, Math.min(100, Math.floor(requestedSize) || 30)) : 30;
    const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage) || 1) : 1;
    return { events: matching.slice((page - 1) * pageSize, page * pageSize), total: matching.length, page, pageSize,
      facets: { departments: facet(candidates, 'departments'), orgs: facet(candidates, 'orgs'), tags: facet(candidates, 'tags'),
        campuses: facet(candidates, 'campus'), modes: facet(candidates, 'mode') }, lastUpdated: getMeta('lastUpdated') };
  }

  /**
   * Retrieve source health, including honest unsupported and subscription states.
   * @return {Array<Object>} Source plans enriched with persisted refresh health.
   */
  function listSources() {
    return db.prepare('SELECT * FROM sources ORDER BY id').all().map(row => ({ ...JSON.parse(row.plan),
      state: row.state, lastAttempt: row.last_attempt, lastSuccess: row.last_success, error: row.error,
      warnings: JSON.parse(row.warnings || '[]'), eventCount: row.event_count }));
  }

  /**
   * Return aggregate ingestion health for the interface.
   * @return {Object} Event count, source-state counts and latest refresh metadata.
   */
  function status() {
    const counts = { total: 0, ok: 0, empty: 0, error: 0, covered: 0, unsupported: 0, subscription_only: 0, blocked: 0, pending: 0 };
    for (const row of db.prepare('SELECT state,COUNT(*) AS count FROM sources GROUP BY state').all()) {
      counts.total += row.count;
      counts[row.state] = row.count;
    }
    return { lastUpdated: getMeta('lastUpdated'), totalEvents: db.prepare('SELECT COUNT(*) AS count FROM events').get().count,
      sources: counts, lastRefresh: getMeta('lastRefresh') };
  }

  /**
   * Retrieve a canonical event by its stable occurrence ID.
   * @param {string} id Event identifier.
   * @return {Object|null} Full event or null when absent.
   */
  function getEvent(id) {
    const row = db.prepare('SELECT data FROM events WHERE id=?').get(id);
    return row ? JSON.parse(row.data) : null;
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

  return { db, registerPlans, replaceSource, mergePartial, failSource, rebuildEvents, listEvents, listSources, status, getMeta, setMeta,
    getEvent, getCache, putCache, deleteCache, close };
}
