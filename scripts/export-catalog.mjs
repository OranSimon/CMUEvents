import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fields = ['Department', 'Org', 'link'];

/**
 * Derive portable catalog exports from the maintained JSON without discovery or fetching.
 * @param {Object[]} rows Authoritative source records in their maintained order.
 * @return {Object<string, string>} Relative export paths and their deterministic contents.
 */
export function catalogExports(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('The source catalog must be a nonempty array.');
  const urls = new Set();
  for (const row of rows) {
    if (!row || fields.some(key => typeof row[key] !== 'string' || !row[key].trim())
      || typeof row.source_kind !== 'string' || !row.source_kind.trim()) throw new Error('Catalog records require Department, Org, link and source_kind.');
    const url = new URL(row.link);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error(`Invalid public source URL: ${row.link}`);
    if (urls.has(row.link)) throw new Error(`Duplicate catalog URL: ${row.link}`);
    urls.add(row.link);
  }
  const counts = key => Object.fromEntries([...new Set(rows.map(row => row[key]))].sort()
    .map(value => [value, rows.filter(row => row[key] === value).length]));
  const csvField = value => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return {
    'data/event_sources.csv': `\uFEFF${[fields, ...rows.map(row => fields.map(key => row[key]))]
      .map(row => row.map(csvField).join(',')).join('\n')}\n`,
    'data/summary.json': `${JSON.stringify({ catalog_entries: rows.length,
      source_kinds: counts('source_kind'), departments: counts('Department') }, null, 2)}\n`,
  };
}

/**
 * Verify checked-in exports are derived from the current authoritative source catalog.
 * @param {string} directory Repository root, including data/event_sources.json.
 * @return {void}
 */
export function checkCatalogExports(directory = root) {
  const rows = JSON.parse(readFileSync(path.join(directory, 'data/event_sources.json'), 'utf8'));
  for (const [file, expected] of Object.entries(catalogExports(rows))) {
    if (readFileSync(path.join(directory, file), 'utf8') !== expected) {
      throw new Error(`Catalog export is stale: ${file}. Run npm run catalog.`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: npm run catalog [-- --check]');
  if (process.argv.includes('--check')) checkCatalogExports();
  else {
    const rows = JSON.parse(readFileSync(path.join(root, 'data/event_sources.json'), 'utf8'));
    for (const [file, content] of Object.entries(catalogExports(rows))) writeFileSync(path.join(root, file), content);
  }
  console.log('Catalog CSV and summary agree with data/event_sources.json.');
}
