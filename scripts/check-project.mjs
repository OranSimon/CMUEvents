import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, loadPlans } from '../src/config.mjs';
import { createSourceScope, sourceAllowed } from '../src/lib/source-scope.mjs';
import { checkCatalogExports } from './export-catalog.mjs';
import { SEARCH_ENGINE_VERSION } from '../web/event-query.js';

/**
 * List authored JavaScript files without traversing dependency or runtime folders.
 * @param {string} directory Source directory.
 * @return {Array<string>} Recursive JavaScript file paths.
 */
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sourceFiles(path.join(directory, entry.name)) : /\.(?:mjs|js)$/.test(entry.name) ? [path.join(directory, entry.name)] : []);
}

/**
 * Keep fixed reviewed occurrence payloads out of unattended source contracts.
 * @param {unknown} value Runtime options or nested child options.
 * @param {string} location Source ID and option path for a useful failure.
 * @return {void}
 */
function assertLiveOptions(value, location) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['reviewedPublicEvents', 'reviewedImages', 'reviewedFragments'].includes(key)
      && (Array.isArray(child) ? child.length > 0 : Boolean(child))) {
      throw new Error(`Fixed reviewed event payload cannot power unattended updates: ${location}.${key}`);
    }
    assertLiveOptions(child, `${location}.${key}`);
  }
}

/**
 * Reject configuration references to disposable local investigation artifacts.
 * @param {unknown} value Configuration value or nested collection.
 * @param {string} location File and field path for a useful failure.
 * @return {void}
 */
function assertPortableInputs(value, location) {
  if (typeof value === 'string' && /^(?:\.{1,2}[/\\])*research(?:[/\\]|$)/i.test(value)) {
    throw new Error(`Configuration cannot depend on ignored research files: ${location}`);
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) assertPortableInputs(child, `${location}.${key}`);
  }
}

const catalog = JSON.parse(readFileSync(path.join(ROOT, 'data/event_sources.json'), 'utf8'));
const rows = Array.isArray(catalog) ? catalog : catalog.sources;
const packageConfig = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (packageConfig.dependencies.minisearch !== SEARCH_ENGINE_VERSION) throw new Error('MiniSearch version must match the published search contract.');
if (['start', 'dev', 'refresh'].some(command => command in packageConfig.scripts)) throw new Error('The website must not expose local application commands.');
if (!readFileSync(path.join(ROOT, 'web/index.html'), 'utf8').includes('data-mode="static"')) throw new Error('The website must use published static data.');
checkCatalogExports(ROOT);
for (const directory of ['config', 'data']) for (const file of readdirSync(path.join(ROOT, directory))) {
  if (file.endsWith('.json')) assertPortableInputs(JSON.parse(readFileSync(path.join(ROOT, directory, file), 'utf8')), `${directory}/${file}`);
}
const plans = loadPlans();
const urls = new Set(plans.map(plan => plan.url));
if (plans.length !== rows.length || urls.size !== rows.length || rows.some(row => !urls.has(row.link))) throw new Error('Source plan coverage differs from the authoritative catalog.');
const byId = new Map(plans.map(plan => [plan.id, plan]));
const scopeConfig = JSON.parse(readFileSync(path.join(ROOT, 'config/source-scope.json'), 'utf8'));
const sourceScope = createSourceScope(scopeConfig);
const excludedIDs = new Set(scopeConfig.blockedSourceIds || []);
if (byId.size !== plans.length) throw new Error('Source IDs must be unique.');
for (const plan of plans) {
  assertLiveOptions(plan.options, plan.id);
  if (excludedIDs.has(plan.id) || !sourceAllowed(plan, sourceScope)) {
    throw new Error(`Excluded club source in the active institutional catalog: ${plan.url}`);
  }
  if (!plan.department || !plan.org || typeof plan.reason !== 'string' || !plan.strategy) throw new Error(`Missing source strategy: ${plan.url}`);
  if (plan.status === 'covered' && (!byId.has(plan.canonicalSourceId) || plan.canonicalSourceId === plan.id)) throw new Error(`Invalid covered-source alias: ${plan.url}`);
}
for (const file of ['README.md', 'docs/design.md', 'LICENSE', 'config/taxonomy.json']) readFileSync(path.join(ROOT, file));
for (const directory of ['src', 'web', 'tests', 'scripts']) for (const file of sourceFiles(path.join(ROOT, directory))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status) throw new Error(result.stderr);
}
console.log(`Checked JavaScript syntax and complete strategy coverage for ${plans.length} sources.`);
