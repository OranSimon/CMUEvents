import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateSourceCoverage } from '../../src/lib/source-coverage.mjs';

/**
 * Verify the actual public deployment and save compact reproducible evidence.
 * @param {string[]} args Optional run ID and evidence label.
 * @return {Promise<void>} Completion after all deployed-data assertions pass.
 */
async function main(args = process.argv.slice(2)) {
  const option = (name, fallback) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
  const label = option('label', 'deployed');
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid evidence label');
  const runId = option('run-id', '');
  let execution = null;
  if (runId) {
    if (!/^\d+$/.test(runId)) throw new Error('Invalid workflow run ID');
    const run = await (await fetch(`https://api.github.com/repos/OranSimon/CMUEvents/actions/runs/${runId}`)).json();
    const jobs = await (await fetch(`https://api.github.com/repos/OranSimon/CMUEvents/actions/runs/${runId}/jobs`)).json();
    assert.equal(run.conclusion, 'success');
    assert.ok(jobs.jobs?.length >= 2 && jobs.jobs.every(job => job.conclusion === 'success'));
    execution = { headSha: run.head_sha, event: run.event, startedAt: run.run_started_at,
      jobs: jobs.jobs.map(job => ({ id: job.id, name: job.name, startedAt: job.started_at, completedAt: job.completed_at,
        elapsedSeconds: (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000, conclusion: job.conclusion })) };
  }
  const base = 'https://oransimon.github.io/CMUEvents/';
  const nonce = Date.now();
  const files = await Promise.all(['manifest', 'events', 'sources', 'status'].map(async name => {
    const response = await fetch(`${base}data/${name}.json?coverage-audit=${nonce}`);
    assert.equal(response.status, 200);
    const text = await response.text();
    return [name, JSON.parse(text), createHash('sha256').update(text).digest('hex')];
  }));
  const docs = Object.fromEntries(files.map(([name, value]) => [name, value]));
  assert.equal(new Set(files.map(([, value]) => value.generatedAt)).size, 1, 'public documents must share one generation');
  const ids = JSON.parse(await readFile(new URL('../../config/coverage-validation.json', import.meta.url), 'utf8')).sourceIds;
  const plans = JSON.parse(await readFile(new URL('../../config/source-plans.json', import.meta.url), 'utf8')).plans;
  assert.equal(docs.sources.sources.length, plans.length);
  assert.equal(docs.manifest.eventCount, docs.events.events.length);
  assert.equal(docs.status.totalEvents, docs.events.events.length);
  const coverage = validateSourceCoverage(docs.sources.sources, ids, docs.status.lastRefresh.startedAt, docs.status.lastRefresh.completedAt);
  assert.equal(coverage.passed, true, JSON.stringify(coverage.sources.filter(source => !source.passed)));
  const scope = JSON.parse(await readFile(new URL('../../config/source-scope.json', import.meta.url), 'utf8'));
  const blocked = new Set(scope.blockedSourceIds);
  assert.ok(docs.sources.sources.every(source => !blocked.has(source.id)));
  assert.ok(docs.events.events.every(event => event.sources.every(source => !blocked.has(source.id))));
  const registry = JSON.parse(await readFile(new URL('../../config/source-subscriptions.json', import.meta.url), 'utf8'));
  const subscriptions = docs.sources.sources.filter(source => source.subscription);
  assert.equal(subscriptions.length, registry.subscriptions.length);
  assert.ok(subscriptions.every(source => source.subscription.emailEventsIngested === false));
  const deployedApp = await (await fetch(`${base}app.js?coverage-audit=${nonce}`)).text();
  const currentApp = execution ? await (await fetch(`https://raw.githubusercontent.com/OranSimon/CMUEvents/${execution.headSha}/web/app.js`)).text()
    : await readFile(new URL('../../web/app.js', import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(deployedApp).digest('hex'), createHash('sha256').update(currentApp).digest('hex'));
  const report = { checkedAt: new Date().toISOString(), runId, runUrl: runId ? `https://github.com/OranSimon/CMUEvents/actions/runs/${runId}` : null,
    execution, manifest: docs.manifest, refresh: docs.status.lastRefresh, sourceStates: docs.status.sources,
    subscriptionChannels: subscriptions.length, coverage,
    fileHashes: Object.fromEntries(files.map(([name, , hash]) => [name, hash])), appSha256: createHash('sha256').update(deployedApp).digest('hex') };
  await writeFile(new URL(`./${label}-deployment.json`, import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ generatedAt: report.manifest.generatedAt, events: report.manifest.eventCount, sources: report.manifest.sourceCount,
    coveragePassed: coverage.passedSources, checks: coverage.sourceCount, subscriptionChannels: subscriptions.length }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
