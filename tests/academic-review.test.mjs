import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHtml, fetchHtml, explicitTextDate, explicitTextEnd } from '../src/adapters/html.mjs';
import { parsePdfSchedule } from '../src/adapters/pdfschedule.mjs';
import { parseTrumba } from '../src/adapters/json.mjs';
import { fetchEvents } from '../src/adapters/index.mjs';

const plan = { id: 'academic-fixture', url: 'https://example.edu/events/', adapter: 'html' };

test('academic-year headers ground rollover without accepting footer years', () => {
  const html = '<h1>2026–2027 Lectures</h1><article><h2>Fall lecture</h2><p>September16, 5pm</p></article><article><h2>Spring lecture</h2><p>February 17, 5pm</p></article><footer>2028</footer>';
  const result = parseHtml(html, { ...plan, options: { eventSelector: 'article', dateSelector: 'p', yearSelector: 'h1', academicYearStartMonth: 8 } });
  assert.deepEqual(result.events.map(event => event.start), ['2026-09-16T21:00:00.000Z', '2027-02-17T22:00:00.000Z']);
  assert.equal(parseHtml(html, { ...plan, options: { eventSelector: 'article', dateSelector: 'p' } }).events.length, 0);
});

test('short dates require a matching printed year and preserve ordinal days', () => {
  const html = '<h1>Fall 2026</h1><ul><li>10/27/26 - Classroom discussion</li><li>10/27/25 - Old announcement</li><li>Sep 14th - Career fair</li></ul>';
  const result = parseHtml(html, { ...plan, options: { eventSelector: 'li', titleSelector: ':scope', dateSelector: ':scope', yearSelector: 'h1' } });
  assert.deepEqual(result.events.map(event => event.start), ['2026-10-27', '2026-09-14']);
});

test('scoped child schedules retain selectors and reject binary and cross-host details', async () => {
  const requests = [];
  const result = await fetchHtml({ ...plan, options: { detailLinks: true, detailLinkSelector: 'a.schedule', detailOptions: { eventSelector: 'tr', titleSelector: 'td:nth-child(2)', dateSelector: 'td:first-child', yearSelector: 'h1' } } }, {
    fetchText: async url => { requests.push(url); return url === plan.url
      ? '<a class="schedule" href="fall/">Fall</a><a class="schedule" href="poster.pdf">Poster</a><a class="schedule" href="https://other.edu/fall/">Other</a>'
      : '<h1>Fall 2026</h1><table><tr><td>10/27</td><td>Database lecture</td></tr></table>'; },
  });
  assert.deepEqual(requests, [plan.url, 'https://example.edu/events/fall/']);
  assert.equal(result.events[0].title, 'Database lecture');
  assert.equal(result.unsupported, false);
});

test('configured archive link dates validate their explicit year suffix', () => {
  const html = '<table><tr><td><a href="/SDI/2026/082726.html">Storage lecture</a></td></tr><tr><td><a href="/SDI/2026/082725.html">Conflicting link</a></td></tr></table>';
  const result = parseHtml(html, { ...plan, options: { eventSelector: 'tr', titleSelector: 'a', linkSelector: 'a', dateFromUrl: true } });
  assert.deepEqual(result.events.map(event => event.start), ['2026-08-27']);
});

test('Slate known-empty applies only to the provider widget endpoint and exact DOM notice', () => {
  const html = '<div>There are no upcoming events to display.</div>';
  assert.equal(parseHtml(html, { ...plan, fetchUrl: 'https://apply.example.edu/portal/widget/event?cmd=event_list' }).unsupported, false);
  assert.equal(parseHtml(html, plan).unsupported, true);
  assert.equal(parseHtml('<div>A user said: There are no upcoming events to display.</div>', { ...plan, fetchUrl: 'https://apply.example.edu/portal/widget/event?cmd=event_list' }).unsupported, true);
});

test('day-first calendar ranges retain the first date and exclusive last date', () => {
  const date = '17 March – 30 June 2026';
  assert.equal(explicitTextDate(date), '2026-03-17');
  assert.equal(explicitTextEnd(date, explicitTextDate(date)), '2026-07-01');
  assert.equal(explicitTextDate('19 October, 2026 at 12:00 PM'), '2026-10-19T12:00:00');
});

test('equal deadline clocks retain their published day while earlier ends cross midnight', () => {
  assert.equal(explicitTextEnd('11:59 PM–11:59 PM', '2026-10-31T23:59:00'), '2026-10-31T23:59:00');
  assert.equal(explicitTextEnd('11:00 PM–1:00 AM', '2026-10-31T23:00:00'), '2026-11-01T01:00:00');
});

test('scoped Trumba JSON preserves offset, original calendar link and scope', async () => {
  const url = 'https://www.cs.cmu.edu/calendar/api?filter2=_Distinguished%20Lectures_';
  const scoped = { ...plan, adapter: 'trumba', fetchUrl: url, options: { format: 'trumba-json' } };
  const row = { eventID: 123, title: 'Scoped lecture', description: '<p>Research abstract</p>', startDateTime: '2026-10-26T17:00:00', endDateTime: '2026-10-26T18:30:00', startTimeZoneOffset: '-0400', endTimeZoneOffset: '-0400', customFields: [{ label: 'Building', value: 'Rashid Auditorium' }] };
  const parsed = parseTrumba([row], scoped);
  assert.equal(parsed.events[0].start, '2026-10-26T21:00:00.000Z');
  assert.equal(parsed.events[0].url, 'https://www.cs.cmu.edu/calendar/123');
  assert.equal(parsed.events[0].description, 'Research abstract');
  const requested = [];
  const result = await fetchEvents(scoped, { fetchText: async target => { requested.push(target); return JSON.stringify([row]); } });
  assert.deepEqual(requested, [url]);
  assert.equal(result.events.length, 1);
  await assert.rejects(fetchEvents(scoped, { fetchText: async () => 'BEGIN:VCALENDAR\nEND:VCALENDAR' }), /filters may be ignored/);
});

test('PDF recital sections split clock lists using printed seasonal years and ignore class grids', () => {
  const text = 'Saturdays Fall 2026\n9/5/26 9/12/26\nSaturdays Spring 2027\n1/9/27\nFall Piano Recitals\nSaturday, Dec. 12, 4pm, 6pm\nSpring String Recitals\nSunday, May 2, 1pm, 3pm\nNo Summer String Recitals';
  const schedule = { ...plan, options: { pdfSectionPattern: '^(Fall|Spring|Summer) (?:Piano|String) Recitals$' } };
  const result = parsePdfSchedule(text, schedule);
  assert.deepEqual(result.events.map(event => event.start), ['2026-12-12T21:00:00.000Z', '2026-12-12T23:00:00.000Z', '2027-05-02T17:00:00.000Z', '2027-05-02T19:00:00.000Z']);
  assert.equal(parsePdfSchedule('Fall Piano Recitals\nSaturday, Dec. 12, 4pm', schedule).events.length, 0);
});

test('semester pruning keeps potentially current archives and unknown URL forms', async () => {
  const requests = [];
  const source = { ...plan, options: { detailLinks: true, detailLinkSelector: 'a', detailSemesterWindow: true, maxDetails: 4, detailOptions: { eventSelector: 'article', titleSelector: 'h2', dateSelector: 'p' } } };
  const result = await fetchHtml(source, { windowStart: '2026-09-21', windowEnd: '2027-10-22', fetchText: async url => {
    requests.push(url);
    return url === plan.url ? '<a href="spring-2026.html">Spring</a><a href="fall-2026.html">Fall</a><a href="fall-2025.html">Old</a><a href="schedule/">Unknown</a>' : '<article><h2>Current talk</h2><p>October 26, 2026</p></article>';
  } });
  assert.deepEqual(requests, [plan.url, 'https://example.edu/events/fall-2026.html', 'https://example.edu/events/schedule/']);
  assert.equal(result.unsupported, false);
  assert.ok(!result.warnings.some(warning => /limit/.test(warning)));
});

test('contextual multi-day dates retain the complete range and reject unrelated end ranges', () => {
  const source = { ...plan, options: { eventSelector: 'article', titleSelector: 'h2', dateSelector: 'p', yearWithinCardSelector: 'h2' } };
  const result = parseHtml('<article><h2>Conference 2025</h2><p>June 24–26, Lisbon</p></article>', source);
  assert.equal(result.events[0].start, '2025-06-24');
  assert.equal(result.events[0].end, '2025-06-27');
  assert.equal(explicitTextEnd('October 7, 2026. Other event: October 21–23, 2026.', '2026-10-07'), null);
});

test('child parser failures remain partial and cannot erase a previously supported child', async () => {
  const source = { ...plan, options: { detailLinks: true, detailLinkSelector: 'a', detailOptions: { eventSelector: 'article', titleSelector: 'h2', dateSelector: 'p' } } };
  const result = await fetchHtml(source, { fetchText: async url => url === plan.url
    ? '<a href="good/">Good</a><a href="client-only/">Unknown</a>' : url.endsWith('good/')
      ? '<article><h2>Grounded event</h2><p>October 26, 2026</p></article>' : '<div id="client-calendar"></div>' });
  assert.equal(result.events.length, 1);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(' '), /Detail .*client-only/);
  const oldIndex = await fetchHtml({ ...plan, options: { detailLinks: true, detailLinkSelector: 'a', detailSemesterWindow: true } }, {
    windowStart: '2026-09-21', windowEnd: '2027-10-22', fetchText: async () => '<a href="spring-2026.html">Spring 2026</a>',
  });
  assert.equal(oldIndex.unsupported, false);
  assert.ok(!oldIndex.partial);
});

test('ordinal ranges and source-local date-only mode do not invent timezone precision', () => {
  const source = { ...plan, options: { eventSelector: 'article', titleSelector: 'h2', dateSelector: 'p', yearSelector: 'h1', dateOnly: true } };
  const range = parseHtml('<h1>Fall 2026</h1><article><h2>Career fair</h2><p>September 15th–17th</p></article>', source).events[0];
  assert.equal(range.start, '2026-09-15'); assert.equal(range.end, '2026-09-18');
  const local = parseHtml('<article><h2>Community event</h2><p>October 26, 2026, 5pm</p></article>', source).events[0];
  assert.equal(local.start, '2026-10-26'); assert.equal(local.timePrecision, 'date');
});

test('configured Google embeds discover exact public calendar identities and propagate failure', async () => {
  const source = { ...plan, options: { embeddedGoogleCalendarSelector: 'iframe' } };
  const html = '<iframe src="https://calendar.google.com/calendar/embed?src=c3RhbXBzLmNtdUBnbWFpbC5jb20"></iframe>';
  const requested = [];
  const result = await fetchHtml(source, { fetchText: async url => { requested.push(url); return url === plan.url ? html : 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//fixture//EN\r\nEND:VCALENDAR'; } });
  assert.deepEqual(requested, [plan.url, 'https://calendar.google.com/calendar/ical/stamps.cmu%40gmail.com/public/basic.ics']);
  assert.equal(result.unsupported, false); assert.ok(!result.partial);
  const failed = await fetchHtml(source, { fetchText: async url => { if (url === plan.url) return html; throw Error('HTTP 404'); } });
  assert.equal(failed.partial, true); assert.match(failed.warnings.join(' '), /Embedded calendar failed/);
});

test('reverse ordinal day ranges retain the first day rather than the last day', () => {
  const start = explicitTextDate('2–6th March 2026');
  assert.equal(start, '2026-03-02');
  assert.equal(explicitTextEnd('2–6th March 2026', start), '2026-03-07');
  const event = parseTrumba([{ eventID: 123, title: 'Lecture', startDateTime: '2026-10-26T17:00:00', startTimeZoneOffset: '-0400' }], { ...plan, fetchUrl: 'https://www.cs.cmu.edu/calendar/api' }).events[0];
  assert.equal(event.uid, 'https://www.cs.cmu.edu/calendar/123');
});

test('same-day events sharing a listing URL remain distinct through HTML aggregation', async () => {
  const source = { ...plan, options: { eventSelector: 'article', titleSelector: 'h2', dateSelector: 'p', detailLinks: true, detailLinkSelector: 'a.detail', detailOptions: { eventSelector: 'article', titleSelector: 'h2', dateSelector: 'p' } } };
  const result = await fetchHtml(source, { fetchText: async url => url === plan.url
    ? '<article><h2>Tepper Meetup</h2><p>September 14, 2026</p></article><article><h2>Tartan2Professional</h2><p>September 14, 2026</p></article><a class="detail" href="child/">Child schedule</a>'
    : '<article><h2>Morning workshop</h2><p>September 15, 2026</p></article><article><h2>Afternoon workshop</h2><p>September 15, 2026</p></article>' });
  assert.deepEqual(result.events.map(event => event.title), ['Tepper Meetup', 'Tartan2Professional', 'Morning workshop', 'Afternoon workshop']);
  assert.equal(new Set(result.events.map(event => event.uid)).size, 4);
});
