import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractCalendarSpans, extractAdvertisedClocks, resolveEventDateRoles } from '../src/lib/date-semantics.mjs';
import { parseConsistentEventPage, fetchTextSchedule } from '../src/adapters/text-schedules.mjs';

const examples = JSON.parse(readFileSync(new URL('./fixtures/conference-date-roles.json', import.meta.url), 'utf8'));
const options = { layout: 'linked-consistent-details', linkSelector: 'main a', detailTitleSelector: 'h1', detailContentSelector: 'main', timezone: 'America/New_York' };

for (const example of examples) {
  test(`semantic date roles: ${example.name}`, () => {
    const result = parseConsistentEventPage(example.html, { url: example.url, options });
    assert.equal(result.dateAnalysis.decision, example.decision);
    assert.deepEqual(result.events.map(event => [event.start, event.end]), example.dates);
    assert.equal(Boolean(result.partial), example.decision === 'conflict');
    if (example.decision === 'conflict') assert.ok(result.dateAnalysis.conflicts.length);
    if (/cutoff|transportation/.test(example.name)) assert.ok(result.dateAnalysis.roles.some(role => role.role === 'auxiliary'));
  });
}

test('full endpoint years support a real year boundary while agenda days inherit only dates inside that range', () => {
  const result = resolveEventDateRoles({ title: 'Review 2027', summary: 'December 31, 2026 – January 1, 2027', agenda: ['December 31', 'January 1'] });
  assert.equal(result.decision, 'multiday-range');
  assert.deepEqual(result.occurrences.map(event => [event.start, event.end]), [['2026-12-31', '2027-01-02']]);
  assert.deepEqual(result.roles.filter(role => role.role === 'agenda').map(role => role.start), ['2026-12-31', '2027-01-01']);
});

test('ambiguous cross-year endpoints, impossible days and unbounded yearless dates never choose a year silently', () => {
  for (const text of ['December 31 – January 1, 2027', 'February 30, 2027', 'June 9', 'June 9 and July 10, 2027']) {
    const result = resolveEventDateRoles({ title: 'Review', summary: text });
    assert.equal(result.decision, 'unresolved');
    assert.equal(result.occurrences.length, 0);
  }
  assert.deepEqual(extractCalendarSpans('May18-19, 2022').spans.map(span => [span.start, span.end]), [['2022-05-18', '2022-05-19']]);
});

test('an agenda day without a unique eligible year is not silently discarded at a year boundary', () => {
  const result = resolveEventDateRoles({ title: 'Review 2027', summary: 'December 31, 2026 – January 1, 2027', agenda: ['July 1'] });
  assert.equal(result.decision, 'conflict');
  assert.equal(result.occurrences.length, 0);
  assert.match(result.conflicts.join(' '), /unique valid scoped year/);
});

test('genuine agenda dates outside the event envelope remain a conflict', () => {
  const result = resolveEventDateRoles({ title: 'Review 2027', summary: 'May 18–19, 2027', agenda: ['May 20, 2027'] });
  assert.equal(result.decision, 'conflict');
  assert.equal(result.occurrences.length, 0);
  assert.match(result.conflicts.join(' '), /2027-05-20/);
});

test('a hotel location is not a hotel deadline and separately dated registration fields remain auxiliary', () => {
  const html = '<main><h1>Research Conference 2027</h1><p>June 9, 2027 at the University Hotel</p><p>Registration opens May 1, 2027; Registration closes June 1, 2027</p><h2>Agenda</h2><table><tr><th>June 9, 2027</th></tr></table></main>';
  const result = parseConsistentEventPage(html, { url: 'https://example.edu/review', options });
  assert.equal(result.recognized, 1);
  assert.equal(result.events[0].start, '2027-06-09');
  assert.equal(result.dateAnalysis.roles.filter(role => role.role === 'auxiliary').length, 2);
});

test('a mismatched weekday inside an otherwise explicit multiday envelope is disclosed without rewriting its day', () => {
  const result = resolveEventDateRoles({ title: 'Review 2018', summary: 'October 4–5, 2018', agenda: ['Thursday, October 4', 'Friday, October 4'] });
  assert.equal(result.decision, 'multiday-range');
  assert.equal(result.occurrences[0].start, '2018-10-04');
  assert.equal(result.occurrences[0].end, '2018-10-06');
  assert.deepEqual(result.notes.map(note => note.code), ['publisher-weekday-date-mismatch']);
  assert.equal(result.notes[0].date, '2018-10-04');
});

test('footer, recommended news and nested related cards cannot contribute conference dates', () => {
  const html = '<main><h1>Review 2027</h1><p>June 9, 2027</p><h2>Agenda</h2><table><tr><th>June 9, 2027</th></tr><tr><td>9:00-9:20 Welcome</td></tr></table><aside><h2>August 8, 2028 — Other conference</h2></aside><div class="related-news"><h2>August 8, 2029</h2></div><h2>Related News</h2><h3>September 1, 2030 — New research</h3><p>Read our latest news.</p><footer>Copyright 2031. Updated May 20, 2031</footer></main>';
  const result = parseConsistentEventPage(html, { url: 'https://example.edu/review', options });
  assert.equal(result.recognized, 1);
  assert.equal(result.events[0].start, '2027-06-09');
  assert.equal(result.events[0].timePrecision, 'date');
  assert.equal(result.dateAnalysis.roles.length, 2);
});

test('clock parsing preserves noon, distinct repeats and equivalent advertised source zones', () => {
  assert.deepEqual(extractAdvertisedClocks('12-2PM EDT & 8-10PM EDT').map(clock => [clock.startMinutes, clock.endMinutes]), [[720, 840], [1200, 1320]]);
  assert.equal(extractAdvertisedClocks('May 18-19, 2022').length, 0);
  assert.equal(extractAdvertisedClocks('10-12PM PST').length, 0, 'shared marker must not invent a morning start');
  const result = resolveEventDateRoles({ title: 'Review 2027', summary: 'May 19, 2027: 9-11AM PDT (12-2PM EDT)' });
  assert.equal(result.occurrences.length, 1, 'equivalent timezone renderings describe one session');
  assert.equal(result.occurrences[0].start, '2027-05-19T16:00:00.000Z');
});

test('a recurring envelope is not expanded into unadvertised sessions', () => {
  const result = resolveEventDateRoles({ title: 'Review 2027', summary: 'Tuesdays 9-11AM PDT, May 19 - June 30, 2027' });
  assert.equal(result.decision, 'unresolved');
  assert.equal(result.occurrences.length, 0);
  assert.match(result.conflicts.join(' '), /recurrence was not invented/);
});

test('all advertised detail links are inspected beyond obsolete scan limits and expose audit coverage', async () => {
  const source = { url: 'https://example.edu/reviews', options: { ...options, maxDetails: 2 } };
  const result = await fetchTextSchedule(source, { fetchText: async url => url === source.url
    ? `<main>${Array.from({ length: 43 }, (_, index) => `<a href="/review-${index}">Review</a>`).join('')}</main>`
    : '<main><h1>Review 2027</h1><p>June 9, 2027</p></main>' });
  assert.equal(result.events.length, 43);
  assert.equal(result.coverage.discovered, 43);
  assert.equal(result.coverage.processed, 43);
  assert.equal(result.coverage.inspectionComplete, true);
  assert.deepEqual(result.coverage.internalIssues, []);
  assert.deepEqual(result.coverage.externalIssues, []);
  assert.equal(result.coverage.details.length, 43);
});

test('coverage distinguishes true upstream conflicts from unresolved extraction or public fetch failure', async () => {
  const source = { url: 'https://example.edu/reviews', options };
  const result = await fetchTextSchedule(source, { fetchText: async url => {
    if (url === source.url) return '<main><a href="/conflict">Review</a><a href="/failed">Review</a></main>';
    if (url.endsWith('/failed')) throw new Error('HTTP 503');
    return '<main><h1>Review 2027</h1><p>June 9, 2026</p></main>';
  } });
  assert.equal(result.coverage.inspectionComplete, true);
  assert.deepEqual(result.coverage.internalIssues, []);
  assert.deepEqual(result.coverage.externalIssues.map(issue => issue.code), ['publisher-date-conflict', 'publisher-detail-fetch-failed']);
  assert.equal(result.partial, true);
});

test('an internal transfer or inspection budget cannot be mislabeled as a completed upstream failure', async () => {
  const source = { url: 'https://example.edu/reviews', options };
  const result = await fetchTextSchedule(source, { fetchText: async url => {
    if (url === source.url) return '<main><a href="/large">Review</a><a href="/good">Review</a></main>';
    if (url.endsWith('/large')) throw new Error('Source exceeds 6 MB download limit.');
    return '<main><h1>Review 2027</h1><p>June 9, 2027</p></main>';
  } });
  assert.equal(result.coverage.inspectionComplete, false);
  assert.equal(result.coverage.discovered, 2);
  assert.equal(result.coverage.processed, 1);
  assert.equal(result.coverage.internalIssues[0].code, 'detail-inspection-incomplete');
  assert.deepEqual(result.coverage.externalIssues, []);
});
