import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { loadPlans } from '../src/config.mjs';
import { dispatcherFor } from '../src/lib/tls.mjs';

const folder = 'research/club-source-removal-2026-10-25';
await mkdir(folder, { recursive: true });
const plans = loadPlans();
const urls = new Map();
for (const plan of plans) {
  for (const [url, role] of [[plan.url, 'source_page'], [plan.fetchUrl || plan.url, 'primary_fetch'],
    ...(plan.options?.additionalEndpoints || []).map(endpoint => [endpoint.url, 'additional_fetch']),
    ...(plan.options?.additionalFetchUrls || []).map(url => [url, 'additional_fetch'])]) {
    if (!urls.has(url)) urls.set(url, { url, sources: [] });
    urls.get(url).sources.push({ sourceID: plan.id, organization: plan.org, role });
  }
}
const queue = [...urls.values()];
const results = [];
const hosts = new Map();
async function slot(host) {
  const state = hosts.get(host) || { active: 0, waiters: [] };
  hosts.set(host, state);
  if (state.active >= 2) await new Promise(resolve => state.waiters.push(resolve));
  else state.active++;
  return () => { const next = state.waiters.shift(); if (next) next(); else state.active--; };
}
async function probe(item) {
  const release = await slot(new URL(item.url).host);
  const result = { ...item, checkedAt: new Date().toISOString() };
  try {
    const response = await fetch(item.url, { redirect: 'follow', signal: AbortSignal.timeout(18000),
      dispatcher: dispatcherFor(new URL(item.url).hostname), headers: { 'User-Agent': 'CMUEvents/0.1 source-access-review', Accept: '*/*' } });
    result.status = response.status;
    result.finalURL = response.url;
    result.contentType = response.headers.get('content-type') || '';
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    while (reader && size < 512 * 1024) {
      const part = await reader.read();
      if (part.done) break;
      chunks.push(part.value);
      size += part.value.length;
    }
    await reader?.cancel();
    const sample = Buffer.concat(chunks).subarray(0, 512 * 1024);
    result.responseSampleSHA256 = createHash('sha256').update(sample).digest('hex');
    result.sampleBytes = sample.length;
    const html = /html/i.test(result.contentType) || /^\s*<!doctype html|^\s*<html/i.test(sample.toString('utf8', 0, 200));
    const $ = html ? cheerio.load(sample.toString('utf8')) : null;
    result.title = $ ? $('title').first().text().trim().replace(/\s+/g, ' ').slice(0, 250) : '';
    const heading = $ ? $('h1').first().text().trim().replace(/\s+/g, ' ') : '';
    const text = $ ? $('body').text().replace(/\s+/g, ' ') : '';
    const destination = new URL(result.finalURL);
    result.access = !response.ok ? `http_${response.status}`
      : /\/(?:auth\/login|web_login|login|signin|sso|idp\/)/i.test(destination.pathname)
        || /^(?:sign in|login|log in|authentication|access denied|you do not have permission)/i.test(`${result.title} ${heading}`)
        || /Login is required|This page requires authentication|You need to log in to access this/i.test(text)
        ? 'authentication_required' : 'http_available';
    if (response.ok && /page is not published|unpublished page|page has been unpublished|has unpublish/i.test(text)) result.access = 'page_unpublished';
  } catch (error) {
    result.access = 'request_failed';
    result.error = [error.name, error.message, error.cause?.code, error.cause?.message].filter(Boolean).join(': ');
  } finally { release(); }
  results.push(result);
  if (results.length % 50 === 0) console.log(`[access] ${results.length}/${queue.length} URLs checked`);
}
let cursor = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (cursor < queue.length) await probe(queue[cursor++]);
}));
results.sort((left, right) => left.url.localeCompare(right.url));
const report = { generatedAt: new Date().toISOString(), scope: {
  sourceCount: plans.length, uniqueURLs: queue.length, checkedURLs: results.length,
  note: 'Anonymous fresh GET of every retained source page and configured ingestion endpoint. HTTP availability is separate from successful parsing or admission eligibility. Embedded child widgets need the separate investigation where applicable.' },
  summary: Object.fromEntries([...new Set(results.map(row => row.access))].sort().map(value => [value, results.filter(row => row.access === value).length])), results };
await writeFile(`${folder}/http-probes.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report.scope, summary: report.summary }));
