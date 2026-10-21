import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, loadPlans } from '../src/config.mjs';

/**
 * List authored JavaScript files without traversing dependency or runtime folders.
 * @param {string} directory Source directory.
 * @return {Array<string>} Recursive JavaScript file paths.
 */
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sourceFiles(path.join(directory, entry.name)) : /\.(?:mjs|js)$/.test(entry.name) ? [path.join(directory, entry.name)] : []);
}

const catalog = JSON.parse(readFileSync(path.join(ROOT, 'data/event_sources.json'), 'utf8'));
const rows = Array.isArray(catalog) ? catalog : catalog.sources;
const plans = loadPlans();
const urls = new Set(plans.map(plan => plan.url));
if (plans.length !== rows.length || urls.size !== rows.length || rows.some(row => !urls.has(row.link))) throw new Error('Source plan coverage differs from the authoritative catalog.');
const byId = new Map(plans.map(plan => [plan.id, plan]));
if (byId.size !== plans.length) throw new Error('Source IDs must be unique.');
for (const plan of plans) {
  if (!plan.department || !plan.org || typeof plan.reason !== 'string' || !plan.strategy) throw new Error(`Missing source strategy: ${plan.url}`);
  if (plan.status === 'covered' && (!byId.has(plan.canonicalSourceId) || plan.canonicalSourceId === plan.id)) throw new Error(`Invalid covered-source alias: ${plan.url}`);
}
for (const file of ['README.md', 'docs/design.md', 'LICENSE', 'config/taxonomy.json']) readFileSync(path.join(ROOT, file));
for (const directory of ['src', 'web', 'tests', 'scripts']) for (const file of sourceFiles(path.join(ROOT, directory))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status) throw new Error(result.stderr);
}
console.log(`Checked JavaScript syntax and complete strategy coverage for ${plans.length} sources.`);
