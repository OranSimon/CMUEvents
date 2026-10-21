import { readConfig, loadPlans } from '../src/config.mjs';
import { openStore } from '../src/lib/store.mjs';
import { createRefresher } from '../src/refresh.mjs';

/**
 * Refresh configured public sources once, useful for maintenance and first setup.
 * @param {Array<string>} args CLI flags: --force, --limit=N and --source=ID.
 * @return {Promise<void>} Resolution when the refresh and persistence finish.
 */
async function main(args = process.argv.slice(2)) {
  const config = readConfig();
  const plans = loadPlans();
  const store = openStore(config.databasePath);
  store.registerPlans(plans);
  try {
    const options = { force: args.includes('--force') };
    const limit = args.find(arg => arg.startsWith('--limit='));
    const source = args.find(arg => arg.startsWith('--source='));
    if (limit) options.limit = Math.max(1, Number(limit.split('=')[1]) || 1);
    if (source) options.sourceIds = source.slice('--source='.length).split(',');
    const result = await createRefresher(store, plans, config).refresh(options);
    console.log(JSON.stringify(result, null, 2));
    if (result.error && !result.ok && !result.empty) process.exitCode = 1;
  } finally { store.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
