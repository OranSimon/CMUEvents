import { createHash } from 'node:crypto';
import { normalizeEvent, inWindow } from './normalize.mjs';
import { normalizeCoverage } from './source-coverage.mjs';

/**
 * Identify the extraction contract, excluding editorial evidence and timestamps.
 * @param {Object} plan Current source plan.
 * @return {string} Stable SHA-256 for snapshot compatibility.
 */
export function extractionSignature(plan) {
  return createHash('sha256').update(JSON.stringify({ eventSchema: 2, adapter: plan.adapter, fetchUrl: plan.fetchUrl,
    status: plan.status, canonicalSourceId: plan.canonicalSourceId, options: plan.options || {} })).digest('hex');
}

/**
 * Read the previous published count independently of compatible-source restore.
 * Version-one legacy states recorded this total in lastRefresh instead.
 * @param {Object} snapshot Previously published portable crawler state.
 * @return {number} Nonnegative published count, or zero when no baseline exists.
 */
export function savedPublicationEventCount(snapshot) {
  const count = snapshot?.metadata?.publishedEventCount ?? snapshot?.metadata?.lastRefresh?.totalEvents;
  if (count === undefined || count === null) return 0;
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid saved publication event count.');
  return count;
}

/**
 * Save normalized source snapshots without raw HTTP caches or credentials.
 * @param {Object} store Open event store.
 * @param {Object} context Optional rolling-window bounds.
 * @return {Object} Portable state for the next isolated Actions runner.
 */
export function exportCrawlState(store, context = {}) {
  const occurrences = new Map();
  for (const row of store.db.prepare('SELECT source_id,data FROM occurrences ORDER BY source_id,occurrence_key').all()) {
    const event = JSON.parse(row.data);
    if (!inWindow(event, context)) continue;
    if (!occurrences.has(row.source_id)) occurrences.set(row.source_id, []);
    occurrences.get(row.source_id).push(event);
  }
  const publishedEventCount = store.db.prepare('SELECT data FROM events').all()
    .reduce((count, row) => count + Number(inWindow(JSON.parse(row.data), context)), 0);
  return { version: 1, generatedAt: new Date().toISOString(),
    metadata: { lastUpdated: store.getMeta('lastUpdated'), lastRefresh: store.getMeta('lastRefresh'), publishedEventCount },
    sources: store.listSources().filter(source => !['covered', 'subscription_only', 'unsupported', 'blocked'].includes(source.status))
      .map(source => ({ id: source.id, contract: extractionSignature(source), state: source.state,
        lastAttempt: source.lastAttempt, lastSuccess: source.lastSuccess, error: source.error,
        warnings: source.warnings, coverage: source.coverage, events: occurrences.get(source.id) || [] })) };
}

/**
 * Restore only current compatible sources after validating the complete input.
 * @param {Object} store Fresh initialized event store.
 * @param {Array<Object>} plans Current authoritative source plans.
 * @param {Object} snapshot Previously published crawler state.
 * @param {Object} context Optional rolling-window bounds.
 * @return {Object} Restored source/event counts and invalidated contract IDs.
 */
export function restoreCrawlState(store, plans, snapshot, context = {}) {
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.sources) || snapshot.sources.length > 5000) {
    throw new Error('Invalid crawler state version or source list.');
  }
  const byId = new Map(plans.map(plan => [plan.id, plan]));
  const seen = new Set();
  const invalidated = [];
  const staged = [];
  let total = 0;
  for (const row of snapshot.sources) {
    if (!row || typeof row.id !== 'string' || seen.has(row.id) || !Array.isArray(row.events)
      || !Array.isArray(row.warnings) || row.warnings.some(value => typeof value !== 'string')) throw new Error('Malformed crawler source snapshot.');
    seen.add(row.id);
    const plan = byId.get(row.id);
    if (!plan || !['active', 'empty'].includes(plan.status) || row.contract !== extractionSignature(plan)) {
      invalidated.push(row.id);
      continue;
    }
    if (!['ok', 'empty', 'undated', 'error', 'pending'].includes(row.state)) throw new Error('Invalid crawler source health.');
    for (const field of ['lastAttempt', 'lastSuccess']) {
      if (row[field] !== null && row[field] !== undefined && !Number.isFinite(Date.parse(row[field]))) throw new Error('Invalid crawler source timestamp.');
    }
    const events = row.events.map(event => {
      if (++total > 100000 || !event || typeof event !== 'object') throw new Error('Crawler state exceeds its event bound.');
      const normalized = normalizeEvent({ ...event, allDay: event.timePrecision === 'all-day' },
        { ...plan, options: { timezone: plan.options?.timezone } });
      if (!normalized || normalized.start !== event.start || normalized.end !== event.end
        || normalized.uid !== event.uid || normalized.title !== event.title) throw new Error(`Invalid saved occurrence for ${row.id}.`);
      return normalized;
    }).filter(event => inWindow(event, context));
    staged.push({ ...row, coverage: normalizeCoverage(row.coverage), events });
  }
  const insert = store.db.prepare('INSERT OR REPLACE INTO occurrences VALUES (?,?,?)');
  const update = store.db.prepare('UPDATE sources SET state=?,last_attempt=?,last_success=?,error=?,warnings=?,event_count=? WHERE id=?');
  store.db.exec('BEGIN');
  try {
    for (const row of staged) {
      store.setMeta(`sourceCoverage:${row.id}`, row.coverage);
      store.db.prepare('DELETE FROM occurrences WHERE source_id=?').run(row.id);
      for (const event of row.events) {
        const key = createHash('sha256').update(`uid:${event.uid}|${event.start}`).digest('hex').slice(0, 24);
        insert.run(row.id, key, JSON.stringify(event));
      }
      update.run(row.state, row.lastAttempt || null, row.lastSuccess || null,
        typeof row.error === 'string' ? row.error : null, JSON.stringify(row.warnings), row.events.length, row.id);
    }
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  for (const key of ['lastUpdated', 'lastRefresh']) if (snapshot.metadata?.[key]) store.setMeta(key, snapshot.metadata[key]);
  store.rebuildEvents(plans);
  return { restoredSources: staged.length, restoredEvents: staged.reduce((sum, row) => sum + row.events.length, 0), invalidated };
}
