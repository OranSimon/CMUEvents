import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fetchTextSchedule } from '../../src/adapters/text-schedules.mjs';

const plans = JSON.parse(await readFile(new URL('../../config/source-plans.json', import.meta.url), 'utf8'));
const source = plans.plans.find(plan => plan.id === '31aa89be167d');
if (!source) throw new Error('The configured DSSC source is missing');
const requests = [];

/**
 * Fetch one current anonymous public page and retain transport audit metadata.
 * @param {string} url Current configured directory or advertised detail URL.
 * @return {Promise<string>} Publisher HTML; no cached content fallback.
 */
async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'CMUEvents source validation (public event calendar)' } });
  const text = await response.text();
  requests.push({ url, finalUrl: response.url, status: response.status, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (new URL(response.url).origin !== new URL(source.url).origin) throw new Error('Publisher redirected to a different origin');
  return text;
}

const window = { windowStart: '2026-09-25T00:00:00-04:00', windowEnd: '2027-10-25T00:00:00-04:00' };
const result = await fetchTextSchedule(source, { fetchText, ...window });
const report = { checkedAt: new Date().toISOString(), sourceId: source.id, sourceUrl: source.url,
  method: 'Fresh anonymous HTTP from the local Node runtime; no browser rendering, content snapshots, credentials or fallback event lists.',
  window, requests, recognized: result.recognized, windowRecords: result.events.length,
  partial: Boolean(result.partial), warnings: result.warnings, coverage: result.coverage };
await writeFile(new URL('./live-validation.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ checkedAt: report.checkedAt, requests: requests.length,
  discovered: result.coverage.discovered, processed: result.coverage.processed, recognized: result.recognized,
  windowRecords: result.events.length, inspectionComplete: result.coverage.inspectionComplete,
  internalIssues: result.coverage.internalIssues.length, externalIssues: result.coverage.externalIssues.length }));
