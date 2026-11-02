import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readBuildConfig, ROOT } from '../src/config.mjs';
import path from 'node:path';

test('only publication tooling remains and old local application entry points cannot return', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(['start', 'dev', 'refresh'].every(name => !(name in pkg.scripts)));
  assert.equal(existsSync(path.join(ROOT, 'src/server.mjs')), false);
  assert.equal(existsSync(path.join(ROOT, 'scripts/refresh-events.mjs')), false);
  assert.match(readFileSync(path.join(ROOT, 'web/index.html'), 'utf8'), /data-mode="static"/);
  assert.doesNotMatch(readFileSync(path.join(ROOT, 'web/data-client.js'), 'utf8'), /api\/|method:\s*["']POST/);
});

test('publication settings ignore obsolete local data and server configuration', () => {
  const config = readBuildConfig({ CMUEVENTS_DATA_DIR: '/unrelated/local-data', PORT: '3000', HOST: '0.0.0.0', CMUEVENTS_AUTO_REFRESH: '1' });
  assert.equal(config.databasePath, path.join(ROOT, '.cache/daily-build/events.sqlite'));
  assert.ok(['port', 'host', 'autoRefresh', 'refreshTickMs'].every(key => !(key in config)));
});
