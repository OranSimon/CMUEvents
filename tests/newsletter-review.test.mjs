import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchNewsletter, parseNewsletterEmail } from '../src/adapters/newsletter.mjs';
import { parseWrct } from '../src/adapters/wrct.mjs';

const source = { id: 'newsletter-review', url: 'https://www.cmu.edu/news/archive.html', options: { timezone: 'America/New_York' } };

test('Piper calendar dates come from paired image labels, not its publication day', () => {
  const html = `<body><p>October 8, 2026</p><table><tr><td><img alt="October 10"><img alt="October 14"></td><td><table><tr><td><b><a href="https://cmu.edu/dance">Carnegie Classic</a></b><br>All Day, Rangos Ballroom</td></tr><tr><td><b><a href="https://cmu.edu/awards">The Andy Awards</a></b><br>Noon-1 p.m., Rangos Ballroom</td></tr></table></td></tr></table></body>`;
  const result = parseNewsletterEmail(html, { ...source, options: { ...source.options, emailLayout: 'piper' } });
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].start, '2026-10-10');
  assert.equal(result.events[0].timePrecision, 'all-day');
  assert.equal(result.events[1].start, '2026-10-14T16:00:00.000Z');
  assert.equal(result.events[1].url, 'https://cmu.edu/awards');
});

test('Piper shared town-hall date lists keep separate occurrences', () => {
  const html = `<body><p>October 2, 2026</p><table><tr><td class="camarker-inner"><div>Leadership will answer questions at two Faculty and Staff Town Halls. Both are hybrid.</div><ul><li><a href="https://cmu.edu/first">Monday, Oct. 5</a>, at noon ET</li><li><a href="https://cmu.edu/second">Wednesday, Oct. 21</a>, at 4 p.m. ET</li></ul></td></tr></table></body>`;
  const result = parseNewsletterEmail(html, { ...source, options: { ...source.options, emailLayout: 'piper' } });
  assert.deepEqual(result.events.map(event => event.start), ['2026-10-05T16:00:00.000Z', '2026-10-21T20:00:00.000Z']);
});

test('Graduate archive follows relative issue links and their actual public email', async () => {
  const pages = new Map([
    [source.url, '<a href="ay-26-27/october.html">October 2026 issue</a>'],
    ['https://www.cmu.edu/news/ay-26-27/october.html', '<h1>Graduate Student News: October 2026</h1><a href="https://conta.cc/public-issue">October issue</a>'],
    ['https://conta.cc/public-issue', '<table><tr><td class="text_content-cell"><p><strong>Practical Negotiation Strategies</strong></p><ul><li>Wednesday, October 7, 12 - 1 p.m.</li></ul></td></tr></table>'],
  ]);
  const requested = [];
  const result = await fetchNewsletter({ ...source, options: { ...source.options, issueLinkSelector: 'a[href*="ay-"]', issueContentLinkSelector: 'a[href*="conta.cc/"]', emailLayout: 'constant-contact', maxIssues: 2 } }, {
    fetchText: async url => { requested.push(url); assert.ok(pages.has(url)); return pages.get(url); },
  });
  assert.equal(requested.length, 3);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].start, '2026-10-07T16:00:00.000Z');
  assert.equal(result.unsupported, false);
});

test('a newsletter archive year heading and issue publication link cannot become an event', async () => {
  const archive = '<main><h2>2026</h2><p><a href="https://t.e2ma.net/message/public-issue">Friday, October 16, 2026</a></p></main>';
  const issue = '<body><p>October 16, 2026</p><div class="e2ma-content-block">Innovation Workshop<br>Date: October 27<br>Time: 8 PM | ET</div></body>';
  const result = await fetchNewsletter({ ...source, options: { ...source.options, emailLayout: 'emma', issueLinkSelector: 'a[href*="t.e2ma.net/message/"]' } }, { fetchText: async url => url === source.url ? archive : issue });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, 'Innovation Workshop');
  assert.equal(result.events[0].start, '2026-10-28T00:00:00.000Z');
  const missing = await fetchNewsletter({ ...source, options: { ...source.options, emailLayout: 'emma', issueLinkSelector: 'a[href*="t.e2ma.net/message/"]' } }, { fetchText: async () => '<main><h2>2026</h2><p>October 16, 2026</p></main>' });
  assert.equal(missing.unsupported, true);
  assert.equal(missing.events.length, 0);
  assert.match(missing.warnings.join(' '), /no matching public issue links/);
});

test('a later application deadline never supplies an event time', () => {
  const html = '<table><tr><td class="text_content-cell"><p><strong>Postdoc Talk Competition</strong></p><p>Give a presentation on November 13 and meet faculty. Apply by October 15, 2026, at 11:59 p.m.</p></td></tr></table>';
  const plan = { ...source, options: { ...source.options, emailLayout: 'constant-contact', contextIssueYear: 2026, contextIssueMonth: 10 } };
  const result = parseNewsletterEmail(html, plan);
  assert.equal(result.events[0].start, '2026-11-13');
  assert.equal(result.events[0].timePrecision, 'date');
  assert.equal(parseNewsletterEmail(html, { ...source, options: { ...source.options, emailLayout: 'constant-contact' } }).events.length, 0);
});

test('Constant Contact date lists retain a registration link outside the list item', () => {
  const html = '<table><tr><td class="text_content-cell"><p><strong>Research Tools Workshop</strong></p><ul><li>Tuesday, October 20, noon</li></ul><p><a href="https://www.cmu.edu/register/workshop">Register</a></p></td></tr></table>';
  const result = parseNewsletterEmail(html, { ...source, options: { ...source.options, emailLayout: 'constant-contact', contextIssueYear: 2026, contextIssueMonth: 10 } });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].url, 'https://www.cmu.edu/register/workshop');
});

test('Constant Contact event paragraphs isolate their dates from earlier application deadlines', () => {
  const html = '<table><tr><td class="text_content-cell"><p><strong>Graduate Leadership Series</strong></p><p>The first GradPRO event is on Thursday, September 10, at noon on Zoom.</p></td><td class="text_content-cell"><p><strong>Graduate Fellows Applications</strong></p><p>The application deadline is October 4, at 11:59 p.m.</p><p>Info Session: Learn more about the program and hear from current Fellows at an info session on Wednesday, September 9, 12:30 p.m. ET. <a href="https://www.cmu.edu/session">Register here</a>.</p></td></tr></table>';
  const result = parseNewsletterEmail(html, { ...source, options: { ...source.options, emailLayout: 'constant-contact', contextIssueYear: 2026, contextIssueMonth: 9 } });
  assert.deepEqual(result.events.map(event => event.start), ['2026-09-10T16:00:00.000Z', '2026-09-09T16:30:00.000Z']);
  assert.equal(result.events[1].url, 'https://www.cmu.edu/session');
});

test('Emma event cards preserve PM clocks and explicit Pacific event time', () => {
  const html = '<body><p>October 16, 2026</p><div class="e2ma-content-block">Innovation Webinar<br>Date: Tuesday, October 27<br>Time: 8:00 PM | ET</div><div class="e2ma-content-block">Evening of Entrepreneurship<br>Date: November 4<br>Time: 4-7 PM | PST</div></body>';
  const result = parseNewsletterEmail(html, { ...source, options: { ...source.options, emailLayout: 'emma' } });
  assert.deepEqual(result.events.map(event => event.start), ['2026-10-28T00:00:00.000Z', '2026-11-05T00:00:00.000Z']);
  assert.equal(result.events[1].timeZone, 'America/Los_Angeles');
});

test('Emma inherits an explicitly shared session clock from its own local prefix', () => {
  const html = '<body><p>October 9, 2026</p><div class="e2ma-content-block">START SMART LEGAL SEMINAR<br>**All Sessions are Virtual ~ 5:00-6:15 PM ET**<br><ul><li>Date: Tuesday, October 13</li></ul>Starting a Business on an F-1 Student Visa</div><div class="e2ma-content-block">START SMART LEGAL SEMINAR<br>*All Sessions are Virtual ~ 5:00-6:15 PM ET*<br>Date: Tuesday, October 27<br>How to Handle Intellectual Property</div></body>';
  const result = parseNewsletterEmail(html, { ...source, options: { ...source.options, emailLayout: 'emma' } });
  assert.deepEqual(result.events.map(event => [event.start, event.end, event.timePrecision]), [
    ['2026-10-13T21:00:00.000Z', '2026-10-13T22:15:00.000Z', 'time'],
    ['2026-10-27T21:00:00.000Z', '2026-10-27T22:15:00.000Z', 'time'],
  ]);
});

test('shared session clocks never come from a different card or a deadline', () => {
  const html = '<body><p>October 9, 2026</p><div class="e2ma-content-block">Legal Workshop<br>All Sessions are Virtual ~ 5:00-6:15 PM ET<br>Date: October 13</div><div class="e2ma-content-block">Undated-clock Workshop<br>Date: October 14<br>Apply by October 12 at 11:59 PM.</div><div class="e2ma-content-block">Registration Workshop<br>Registration deadline ~ 5:00-6:15 PM ET<br>Date: October 15</div><div class="e2ma-content-block">Explicit-clock Workshop<br>All Sessions are Virtual ~ 5:00-6:15 PM ET<br>Date: October 16<br>Time: 1:00-2:00 PM ET</div></body>';
  const result = parseNewsletterEmail(html, { ...source, options: { ...source.options, emailLayout: 'emma' } });
  assert.deepEqual(result.events.map(event => event.start), ['2026-10-13T21:00:00.000Z', '2026-10-14', '2026-10-15', '2026-10-16T17:00:00.000Z']);
  assert.deepEqual(result.events.slice(1,3).map(event => event.timePrecision), ['date', 'date']);
});

test('newsletter same-month date ranges retain the published inclusive last day', () => {
  for (const date of ['October 27–29', 'October 27-29, 2026', 'October 27th–29th']) {
    const html = `<body><p>October 16, 2026</p><div class="e2ma-content-block">Innovation Conference<br>Date: ${date}</div></body>`;
    const result = parseNewsletterEmail(html, { ...source, options: { ...source.options, emailLayout: 'emma' } });
    assert.equal(result.events[0].start, '2026-10-27');
    assert.equal(result.events[0].end, '2026-10-30');
  }
});

test('newsletter cross-month ranges are diagnosed without collapsing their dates', () => {
  const html = '<body><p>October 16, 2026</p><div class="e2ma-content-block">Innovation Conference<br>Date: October 27–November 3</div></body>';
  const result = parseNewsletterEmail(html, { ...source, options: { ...source.options, emailLayout: 'emma' } });
  assert.equal(result.events.length, 0);
  assert.match(result.warnings.join(' '), /cross-month/);
});

test('newsletter layouts do not turn undated newsletter news into events', () => {
  for (const emailLayout of ['piper', 'emma', 'constant-contact']) {
    const result = parseNewsletterEmail('<body><h1>October 2026 newsletter</h1><p>Important research news and resources for our community.</p></body>', { ...source, options: { ...source.options, emailLayout } });
    assert.equal(result.events.length, 0);
    assert.equal(result.unsupported, true);
  }
});

test('WRCT music date groups apply to every following performance row', () => {
  const html = '<table><tr><td colspan="3">Sat 10-24-26</td></tr><tr><td>7:30pm</td><td>Bantha Tea Bar</td><td>Raphael Roginski</td></tr><tr><td>9:00pm</td><td>Gooski’s</td><td>Rated Eye</td></tr><tr><td colspan="3">Mon 10-26-26</td></tr><tr><td>8:00pm</td><td>The Rock Room</td><td>Nature Boys</td></tr></table>';
  const result = parseWrct(html, { ...source, fetchUrl: 'https://www.wrct.org/events/music-calendar/', options: { ...source.options, yearCentury: 2000 } });
  assert.deepEqual(result.events.map(event => event.start), ['2026-10-24T23:30:00.000Z', '2026-10-25T01:00:00.000Z', '2026-10-27T00:00:00.000Z']);
  assert.equal(result.events[1].location, 'Gooski’s');
});

test('WRCT radio uses update year as context and excludes undated ongoing notices', () => {
  const html = '<p>Updated: 10/21/2026</p><p><strong>CURRENT COMMUNITY EVENTS</strong></p><h4>FILM FESTIVAL</h4><p>The festival returns November 4th to 15th. <a href="https://example.org/festival">Details</a></p><p><strong>ONGOING COMMUNITY EVENTS</strong></p><h4>MONTHLY DANCE</h4><p>First Friday of every month.</p>';
  const result = parseWrct(html, { ...source, fetchUrl: 'https://www.wrct.org/events/radio-calendar/' });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].start, '2026-11-04');
  assert.equal(result.events[0].end, '2026-11-16');
  assert.equal(result.events[0].timePrecision, 'date');
});
