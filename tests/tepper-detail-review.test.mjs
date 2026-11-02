import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchHtml } from '../src/adapters/html.mjs';

const directory = 'https://example.edu/seminars-and-conferences';
const symposium = `${directory}/child-welfare`;
const women = `${directory}/women-economics`;
const options = {
  timezone: 'America/New_York', detailLinks: true, maxDetails: 10,
  eventSelector: '.card', titleSelector: 'h3', linkSelector: 'h3 a',
  detailLinkSelector: '.Subnav__nested a[href^="/seminars-and-conferences/"]',
  detailOptions: { detailLinks: false },
  detailOptionsByUrl: {
    [symposium]: { eventSelector: '.ContentSidebar', titleSelector: 'h1', linkSelector: 'a[data-original-event]',
      dateSelector: '.text-intro', timeSelector: 'h3 + p', descriptionSelector: '.body', locationSelector: '.venue', preserveFieldBreaks: true },
    [women]: { eventSelector: '.ContentSidebar', titleSelector: 'h1', linkSelector: 'a[data-original-event]',
      dateSelector: '.published-range', descriptionSelector: '.body', dateOnly: true },
  },
};
const plan = { adapter: 'html', url: directory, options };
const window = { windowStart: '2026-09-21T20:00:00Z', windowEnd: '2027-10-21T20:00:00Z' };
const parent = `<main><div class="Subnav__nested"><a href="/seminars-and-conferences/child-welfare">Symposium</a>
<a href="/seminars-and-conferences/women-economics">Women in Economics Theory</a></div>
<a href="/unrelated-admissions">Other navigation</a><a href="https://outside.example/other">External link</a>
<article class="card"><h3><a href="${symposium}">Child Welfare Operations Symposium</a></h3>
<p>Friday, October 23, 2026</p></article></main>`;
const symposiumBody = `<main class="ContentSidebar"><h1>Child Welfare Operations Symposium</h1><div class="body">
<p class="text-intro">Friday, October 23, 2026, for the 4th Annual Symposium.</p>
<h3>Format and Organization</h3><p>The symposium takes place over a single day, from 8 a.m. to 4 p.m. on Friday, October 23.</p>
</div><div class="venue"><p>Tepper School of Business</p><p>Room 4242</p></div></main>`;
const womenBody = `<main class="ContentSidebar"><h1>Women in Economics Theory Conference</h1><div class="body">
<p class="published-range">May 21–22, 2027<br>Carnegie Mellon University | Tepper School of Business</p>
<p>The conference will conclude by 3 p.m.</p></div></main>`;

test('exact child selector contracts discover navigation-only conferences and retain their published ranges', async () => {
  const requests = [];
  const bodies = { [directory]: parent, [symposium]: symposiumBody, [women]: womenBody };
  const result = await fetchHtml(plan, { ...window, fetchText: async url => { requests.push(url); return bodies[url]; } });
  assert.deepEqual(requests, [directory, symposium, women]);
  assert.equal(result.events.length, 2);
  assert.notEqual(result.partial, true);
  assert.equal(result.unsupported, false);
  const child = result.events.find(event => event.url === symposium);
  assert.equal(child.start, '2026-10-23T12:00:00.000Z');
  assert.equal(child.end, '2026-10-23T20:00:00.000Z');
  assert.equal(child.location, 'Tepper School of Business\nRoom 4242');
  assert.match(child.description, /Symposium\.\n+Format and Organization/);
  const conference = result.events.find(event => event.url === women);
  assert.equal(conference.start, '2027-05-21');
  assert.equal(conference.end, '2027-05-23');
  assert.equal(conference.timePrecision, 'date');
});

test('a precise child replaces only the parent record for the same original URL, title and local day', async () => {
  const extra = `<article class="card"><h3><a href="${symposium}">Different symposium</a></h3><time datetime="2026-10-23"></time></article>
    <article class="card"><h3><a href="${symposium}">Child Welfare Operations Symposium</a></h3><time datetime="2026-10-24"></time></article>`;
  const result = await fetchHtml(plan, { ...window, fetchText: async url => url === directory ? parent + extra : url === symposium ? symposiumBody : womenBody });
  assert.equal(result.events.length, 4);
  assert.equal(result.events.filter(event => event.url === symposium && event.start === '2026-10-23').length, 1);
  assert.equal(result.events.find(event => event.start === '2026-10-23').title, 'Different symposium');
  assert.equal(result.events.filter(event => event.url === symposium && event.title === 'Child Welfare Operations Symposium').length, 2);
});

test('parent replacement compares the source local day when the child starts after UTC midnight', async () => {
  const late = symposiumBody.replace('8 a.m. to 4 p.m.', '9 p.m. to 10 p.m.');
  const result = await fetchHtml(plan, { ...window, fetchText: async url => url === directory ? parent : url === symposium ? late : womenBody });
  assert.equal(result.events.length, 2);
  assert.equal(result.events.find(event => event.url === symposium).start, '2026-10-24T01:00:00.000Z');
});

test('multiple timed children on the same local day do not guess which occurrence a parent represented', async () => {
  const repeated = symposiumBody + symposiumBody.replace('8 a.m. to 4 p.m.', '5 p.m. to 6 p.m.');
  const result = await fetchHtml(plan, { ...window, fetchText: async url => url === directory ? parent : url === symposium ? repeated : womenBody });
  assert.equal(result.events.length, 4);
  assert.equal(result.events.filter(event => event.url === symposium).length, 3);
  assert.ok(result.events.some(event => event.url === symposium && event.start === '2026-10-23'));
});

test('a published multi-day parent range cannot be collapsed into one timed child session', async () => {
  const multiDay = parent.replace('Friday, October 23, 2026', 'October 23–24, 2026');
  const result = await fetchHtml(plan, { ...window, fetchText: async url => url === directory ? multiDay : url === symposium ? symposiumBody : womenBody });
  assert.equal(result.events.length, 3);
  const retained = result.events.find(event => event.url === symposium && event.timePrecision === 'date');
  assert.equal(retained.start, '2026-10-23');
  assert.equal(retained.end, '2026-10-25');
});

test('ambiguous old date-only candidates are retained rather than choosing one for child enrichment', async () => {
  const ambiguous = parent + `<article class="card"><h3><a href="${symposium}">CHILD WELFARE OPERATIONS SYMPOSIUM</a></h3><time datetime="2026-10-23"></time></article>`;
  const result = await fetchHtml(plan, { ...window, fetchText: async url => url === directory ? ambiguous : url === symposium ? symposiumBody : womenBody });
  assert.equal(result.events.length, 4);
  assert.equal(result.events.filter(event => event.url === symposium && event.timePrecision === 'date').length, 2);
});

test('missing year on one required child remains partial while the dated conference is imported', async () => {
  const result = await fetchHtml(plan, { ...window, fetchText: async url => url === directory ? parent
    : url === symposium ? symposiumBody : womenBody.replace('May 21–22, 2027', 'May 21–22') });
  assert.equal(result.events.length, 1);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(' '), /Detail \(https:\/\/example.edu\/seminars-and-conferences\/women-economics\)/);
});

test('an override is exact-URL scoped and does not expand unconfigured children using another schedule', async () => {
  const unknown = `${directory}/unconfigured`;
  const result = await fetchHtml(plan, { ...window, fetchText: async url => url === directory
    ? parent + '<div class="Subnav__nested"><a href="/seminars-and-conferences/unconfigured">Another conference</a></div>'
    : url === symposium ? symposiumBody : url === women ? womenBody : '<main><h1>Another conference</h1><p>Dates to be announced.</p></main>' });
  assert.equal(result.events.length, 2);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(' '), new RegExp(unknown));
});
