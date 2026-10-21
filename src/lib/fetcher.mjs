import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { dispatcherFor } from './tls.mjs';

/**
 * Wait without blocking the server event loop.
 * @param {number} milliseconds Duration in milliseconds.
 * @return {Promise<void>} Promise resolved after the delay.
 */
function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Reject loopback, private and reserved network destinations for discovered links.
 * @param {string} address Resolved IPv4 or IPv6 address.
 * @return {boolean} Whether the destination is public.
 */
export function publicAddress(address) {
  if (!isIP(address)) return false;
  if (address.includes(':')) {
    const lower = address.toLowerCase();
    if (lower.startsWith('::ffff:')) return isIP(lower.slice(7)) === 4 && publicAddress(lower.slice(7));
    return !/^(::|fc|fd|fe8|fe9|fea|feb|ff)/.test(lower) && lower !== '::1';
  }
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0))
    || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
}

/**
 * Validate public HTTP links, including every redirect destination.
 * @param {string} value Requested public URL.
 * @return {Promise<URL>} Validated URL.
 */
async function publicUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only anonymous public HTTP(S) sources are allowed.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Local network source rejected.');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('Non-public network source rejected.');
  return url;
}

/**
 * Read a bounded response body, preventing an unexpectedly large source download.
 * @param {Response} response Fetch response with a stream body.
 * @param {number} maximum Maximum accepted byte length.
 * @return {Promise<Buffer>} Full response bytes.
 */
async function readBody(response, maximum) {
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maximum) { await reader.cancel(); throw new Error(`Source exceeds ${Math.round(maximum / 1024 / 1024)} MB download limit.`); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Create a shared polite HTTP client with conditional caching and host limits.
 * @param {Object} store Persistent HTTP cache operations.
 * @param {Object} options Timeout, response-size and per-host pacing settings.
 * @return {Object} UTF-8 and binary fetch functions plus transfer statistics.
 */
export function createFetcher(store, options = {}) {
  const pending = new Map();
  const hosts = new Map();
  const stats = { requests: 0, cacheHits: 0, bytes: 0 };

  /**
   * Acquire a per-host slot with a small gap between requests.
   * @param {string} host Remote hostname.
   * @return {Promise<Function>} Release callback for the acquired slot.
   */
  async function acquire(host) {
    if (!hosts.has(host)) hosts.set(host, { active: 0, lastStarted: 0, waiters: [] });
    const state = hosts.get(host);
    if (state.active >= 2) await new Promise(resolve => state.waiters.push(resolve));
    else state.active++;
    const wait = Math.max(0, (options.spacingMs ?? 200) - (Date.now() - state.lastStarted));
    state.lastStarted = Date.now() + wait;
    if (wait) await delay(wait);
    return () => { const next = state.waiters.shift(); if (next) next(); else state.active--; };
  }

  /**
   * Fetch bytes with safe redirects, conditional requests and bounded retries.
   * @param {string} value Public source URL.
   * @param {Object} requestOptions Optional raw response caching policy.
   * @return {Promise<Buffer>} Fresh or server-revalidated body bytes.
   */
  async function download(value, requestOptions = {}) {
    const cacheable = requestOptions.cache !== false;
    if (!cacheable) store.deleteCache(value);
    const cached = cacheable ? store.getCache(value) : null;
    for (let attempt = 0; attempt < 2; attempt++) {
      let current = value;
      try {
        for (let redirect = 0; redirect < 6; redirect++) {
          const url = await publicUrl(current);
          const release = await acquire(url.host);
          try {
            const headers = { 'User-Agent': 'CMUEvents/0.1 (+https://github.com/OranSimon/CMUEvents)',
              Accept: 'text/calendar,application/json,application/rss+xml,text/html,application/pdf;q=0.8,*/*;q=0.5' };
            if (cached?.etag) headers['If-None-Match'] = cached.etag;
            if (cached?.modified) headers['If-Modified-Since'] = cached.modified;
            stats.requests++;
            const response = await fetch(url, { headers, redirect: 'manual', dispatcher: dispatcherFor(url.hostname), signal: AbortSignal.timeout(options.timeoutMs || 20000) });
            if (response.status === 304 && cached) { stats.cacheHits++; return Buffer.from(cached.body); }
            if ([301, 302, 303, 307, 308].includes(response.status)) {
              const location = response.headers.get('location');
              await response.body?.cancel();
              if (!location) throw new Error('Redirect has no public destination.');
              current = new URL(location, url).href;
              continue;
            }
            if (!response.ok) {
              await response.body?.cancel();
              const error = new Error(`HTTP ${response.status} from ${url.host}`);
              error.retryable = response.status === 429 || response.status >= 500;
              throw error;
            }
            const body = await readBody(response, options.maximumBytes || 12 * 1024 * 1024);
            if (!body.length) throw new Error('Source returned an empty response body.');
            stats.bytes += body.length;
            if (cacheable) store.putCache(value, body, response.headers.get('etag'), response.headers.get('last-modified'));
            return body;
          } finally { release(); }
        }
        throw new Error('Too many source redirects.');
      } catch (error) {
        const transient = error.retryable || ['TimeoutError', 'AbortError'].includes(error.name)
          || ['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code);
        if (attempt === 0 && transient) { await delay(1200); continue; }
        throw new Error(`${error.message}${error.cause?.message ? ` (${error.cause.message})` : ''}`);
      }
    }
  }

  /**
   * Share in-flight requests when multiple adapters use the same endpoint.
   * @param {string} url Public source URL.
   * @param {Object} requestOptions Optional raw response caching policy.
   * @return {Promise<Buffer>} Response bytes.
   */
  async function fetchBytes(url, requestOptions = {}) {
    const key = `${requestOptions.cache === false ? 'uncached:' : ''}${url}`;
    if (!pending.has(key)) pending.set(key, download(url, requestOptions).finally(() => pending.delete(key)));
    return pending.get(key);
  }

  /**
   * Decode a public textual source as UTF-8.
   * @param {string} url Public source URL.
   * @param {Object} requestOptions Optional raw response caching policy.
   * @return {Promise<string>} Text body.
   */
  async function fetchText(url, requestOptions = {}) {
    return (await fetchBytes(url, requestOptions)).toString('utf8');
  }
  return { fetchBytes, fetchText, stats };
}
