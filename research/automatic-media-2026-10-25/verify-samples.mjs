import { readFile, writeFile } from 'node:fs/promises';
import { fetchAutomaticMedia } from '../../src/adapters/automatic-media.mjs';
import { createFetcher } from '../../src/lib/fetcher.mjs';
const plans = JSON.parse(await readFile('config/source-plans.json', 'utf8')).plans;
const patches = JSON.parse(await readFile('research/automatic-media-2026-10-25/config-patches.json', 'utf8')).patches;
const cache = new Map();
const fetcher = createFetcher({ getCache: key => cache.get(key), putCache: (key, body, etag, modified) => cache.set(key, { body, etag, modified }), deleteCache: key => cache.delete(key) }, { maximumBytes: 20 * 1024 * 1024 });
const results = [];
for (const id of ['528193392a78', '34fa7359276d', '1468ddb723b2', 'd861fd81e26d', '54c24d7416bb', '5ade174c3483']) {
  const patch = patches.find(item => item.id === id);
  const original = plans.find(plan => plan.id === id);
  const url = patch.path.length ? patch.path[1] : original.fetchUrl;
  const plan = { ...original, url, fetchUrl: url, options: { ...original.options, ...patch.options } };
  const result = await fetchAutomaticMedia(await fetcher.fetchText(url), plan, fetcher);
  results.push({ id, url, recognized: result.recognized, partial: result.partial, unsupported: result.unsupported, warnings: result.warnings, events: result.events.map(({ title, start, end, timePrecision, location, url }) => ({ title, start, end, timePrecision, location, url })) });
  console.log(id, result.recognized, result.events.length, result.partial, result.warnings.slice(0, 3));
  await writeFile('research/automatic-media-2026-10-25/sample-results.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n');
}
