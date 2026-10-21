import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHtml } from '../src/adapters/html.mjs';

test('explicit dated pending sessions can use their printed series heading without inventing a talk title', () => {
  const html = '<main><h1>2026 Fall Seminar Series</h1><p>All seminars are held Thursdays from 9:30–10:30 AM in Doherty Hall 2315.</p><table>'
    + '<tr><td>Thursday, October 22, 2026</td></tr><tr><td>TBD</td><td><strong>TBD</strong></td></tr>'
    + '<tr><td>Thursday, October 29, 2026</td></tr><tr><td>Break</td><td><strong>No Seminar</strong></td></tr></table></main>';
  const plan = { url: 'https://example.edu/seminars/', options: { timezone: 'America/New_York', eventSelector: 'tr:has(td:nth-child(2))', titleSelector: 'strong', dateFromPreviousRow: true,
    pendingTitleSelector: 'h1', contextTimeSelector: 'h1 + p', contextDescriptionSelector: 'h1 + p' } };
  const result = parseHtml(html, plan);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, '2026 Fall Seminar Series — Details TBD');
  assert.equal(result.events[0].start, '2026-10-22T13:30:00.000Z');
  assert.equal(result.events[0].end, '2026-10-22T14:30:00.000Z');
  assert.match(result.events[0].description, /TBD/);
  assert.match(result.events[0].description, /Doherty Hall 2315/);
  assert.equal(parseHtml(html, { ...plan, options: { ...plan.options, pendingTitleSelector: undefined } }).events.length, 0);
  assert.equal(parseHtml(html.replace('October 22, 2026', 'October 22'), plan).events.length, 0);
});
