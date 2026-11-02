import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogExports, checkCatalogExports } from '../scripts/export-catalog.mjs';

const row = { Department: 'Department', Org: 'Office', link: 'https://example.edu/events', source_kind: 'event_listing' };

test('catalog exports preserve Unicode, quoted multiline labels, order and current counts without inventing verification claims', () => {
  const rows = [{ ...row, Org: 'Ciné, "Talks"\nSeries' }, { ...row, link: 'https://example.edu/calendar', source_kind: 'ical_feed' }];
  const files = catalogExports(rows);
  assert.equal(files['data/event_sources.csv'], '\uFEFFDepartment,Org,link\nDepartment,"Ciné, ""Talks""\nSeries",https://example.edu/events\nDepartment,Office,https://example.edu/calendar\n');
  assert.deepEqual(JSON.parse(files['data/summary.json']), { catalog_entries: 2,
    source_kinds: { event_listing: 1, ical_feed: 1 }, departments: { Department: 2 } });
  assert.deepEqual(catalogExports(rows), files);
});

test('invalid or duplicate records cannot overwrite the maintained catalog exports', () => {
  for (const rows of [[], [row, row], [{ ...row, Org: '' }], [{ ...row, source_kind: null }],
    [{ ...row, link: 'file:///tmp/events' }], [{ ...row, link: 'https://user:password@example.edu/events' }]]) {
    assert.throws(() => catalogExports(rows));
  }
});

test('checked-in CSV and summary match the authoritative current catalog', () => {
  checkCatalogExports();
});
