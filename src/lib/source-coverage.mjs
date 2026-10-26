/**
 * Validate portable public coverage evidence without accepting non-JSON values.
 * @param {Object|null} value Adapter coverage record.
 * @param {string} checkedAt Optional timestamp for a newly completed inspection.
 * @return {Object|null} Detached version-one record, or null when absent.
 */
export function normalizeCoverage(value, checkedAt) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.hasOwn(value, 'toJSON') || value.version !== 1 || typeof value.kind !== 'string' || !value.kind
    || typeof value.inspectionComplete !== 'boolean'
    || ['internalIssues', 'externalIssues', 'nonBlockingIssues'].some(key => !Array.isArray(value[key]))) {
    throw new Error('Invalid adapter coverage contract');
  }
  rejectCustomJson(value);
  const serialized = JSON.stringify(value, (key, item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Non-finite coverage evidence');
    if (['function', 'symbol', 'bigint'].includes(typeof item)) throw new Error('Non-JSON coverage evidence');
    return item;
  });
  if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) throw new Error('Source coverage evidence exceeds 2 MiB');
  const result = JSON.parse(serialized);
  if (checkedAt) result.checkedAt = checkedAt;
  if (result.checkedAt && !Number.isFinite(Date.parse(result.checkedAt))) throw new Error('Invalid source coverage timestamp');
  return result;
}

/**
 * Inspect configured regression sources using this run's current adapter evidence.
 * Real upstream failures remain visible; internal omissions block publication.
 * @param {Array<Object>} sources Current source health and public evidence.
 * @param {Array<string>} sourceIds Explicitly monitored source identities.
 * @param {string} startedAt Current refresh start timestamp.
 * @param {string} completedAt Current refresh completion bound.
 * @return {Object} Complete per-source audit and publication eligibility.
 */
export function validateSourceCoverage(sources, sourceIds, startedAt, completedAt = new Date().toISOString()) {
  if (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds.some(id => typeof id !== 'string' || !id)
    || new Set(sourceIds).size !== sourceIds.length) throw new Error('Invalid monitored source coverage group');
  const byId = new Map(sources.map(source => [source.id, source]));
  const rows = sourceIds.map(id => {
    const source = byId.get(id);
    const coverage = source?.coverage;
    const current = Boolean(coverage && Date.parse(coverage.checkedAt) >= Date.parse(startedAt)
      && Date.parse(coverage.checkedAt) <= Date.parse(completedAt));
    const internalIssues = current ? [...coverage.internalIssues] : [{ code: 'NO_CURRENT_COVERAGE', reason: source?.error || 'Source was not inspected in this run' }];
    if (current && !coverage.inspectionComplete && !internalIssues.length) internalIssues.push({ code: 'INCOMPLETE_INSPECTION' });
    if (current && source.state === 'error' && !coverage.externalIssues.length && !internalIssues.length) internalIssues.push({ code: 'NONBLOCKING_NOTICE_MISCLASSIFIED_AS_ERROR', reason: source.error });
    return { id, org: source?.org, url: source?.url, state: source?.state, eventCount: source?.eventCount,
      passed: current && coverage.inspectionComplete && !internalIssues.length, internalIssues, coverage };
  });
  return { version: 1, checkedAt: new Date().toISOString(), passed: rows.every(row => row.passed),
    sourceCount: rows.length, passedSources: rows.filter(row => row.passed).length, sources: rows };
}

/**
 * Reject serialization hooks before JSON conversion can change the audit schema.
 * @param {unknown} value Nested adapter evidence.
 * @param {Set<Object>} seen Cycle detection for this record.
 * @return {void} Throws on cycles, hooks or class instances.
 */
function rejectCustomJson(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) throw new Error('Cyclic coverage evidence');
  if ((!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    || Object.hasOwn(value, 'toJSON')) throw new Error('Custom JSON coverage evidence');
  seen.add(value);
  for (const item of Object.values(value)) rejectCustomJson(item, seen);
  seen.delete(value);
}
