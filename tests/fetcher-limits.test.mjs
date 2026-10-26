import test from 'node:test';
import assert from 'node:assert/strict';
import { createFetcher, downloadLimits } from '../src/lib/fetcher.mjs';

/**
 * Create an isolated anonymous byte-cache fixture.
 * @return {Object} Cache methods used by the public HTTP client.
 */
function cacheStore() {
  const records = new Map();
  return { records, getCache: url => records.get(url), deleteCache: url => records.delete(url),
    putCache: (url, body, etag, modified) => records.set(url, { body, etag, modified }) };
}

test('media transfer limits are explicit and bounded while ordinary sources keep their defaults', () => {
  assert.deepEqual(downloadLimits(), { maximumBytes: 12 * 1024 * 1024, timeoutMs: 20000 });
  assert.deepEqual(downloadLimits({}, { maximumBytes: 128 * 1024 * 1024, timeoutMs: 60000 }),
    { maximumBytes: 128 * 1024 * 1024, timeoutMs: 60000 });
  for (const options of [{ maximumBytes: 0 }, { maximumBytes: Infinity }, { maximumBytes: 129 * 1024 * 1024 },
    { maximumBytes: 1.2 }, { timeoutMs: -1 }, { timeoutMs: 120001 }]) assert.throws(() => downloadLimits({}, options), /Download/);
});

test('a media request can read a larger public body without widening other requests', async () => {
  const cache = cacheStore();
  const fetcher = createFetcher(cache, { maximumBytes: 4, spacingMs: 0,
    fetch: async () => new Response('12345678', { headers: { ETag: 'v1' } }) });
  const url = 'https://8.8.8.8/public.pdf';
  assert.equal((await fetcher.fetchBytes(url, { maximumBytes: 8, timeoutMs: 60000 })).toString(), '12345678');
  await assert.rejects(fetcher.fetchBytes(url), /download limit/);
});

test('stricter callers neither inherit a permissive in-flight response nor an oversized conditional cache', async () => {
  const cache = cacheStore();
  const seen = [];
  const fetcher = createFetcher(cache, { spacingMs: 0, fetch: async (_url, request) => {
    seen.push(request.headers);
    await new Promise(resolve => setTimeout(resolve, 10));
    return new Response('12345678', { headers: { ETag: 'v1' } });
  } });
  const url = 'https://8.8.8.8/shared.pdf';
  const [large, small] = await Promise.allSettled([
    fetcher.fetchBytes(url, { maximumBytes: 8 }), fetcher.fetchBytes(url, { maximumBytes: 4 }),
  ]);
  assert.equal(large.status, 'fulfilled');
  assert.equal(small.status, 'rejected');
  assert.equal(seen.length, 2);
  await assert.rejects(fetcher.fetchBytes(url, { maximumBytes: 4 }), /download limit/);
  assert.equal(seen.at(-1)['If-None-Match'], undefined, 'a smaller changed file is fetched unconditionally rather than reviving oversized bytes');
});

test('equivalent requests still share one transfer and server-revalidated bytes', async () => {
  const cache = cacheStore();
  let calls = 0;
  const fetcher = createFetcher(cache, { spacingMs: 0, fetch: async (_url, request) => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 10));
    return request.headers['If-None-Match'] ? new Response(null, { status: 304 }) : new Response('ok', { headers: { ETag: 'same' } });
  } });
  const url = 'https://8.8.8.8/shared.txt';
  const values = await Promise.all([fetcher.fetchText(url), fetcher.fetchText(url)]);
  assert.deepEqual(values, ['ok', 'ok']);
  assert.equal(calls, 1);
  assert.equal(await fetcher.fetchText(url), 'ok');
  assert.equal(fetcher.stats.cacheHits, 1);
});
