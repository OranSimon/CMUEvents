import test from 'node:test';
import assert from 'node:assert/strict';
import { explicitTextDate, explicitTextEnd, fetchHtml, parseHtml } from '../src/adapters/html.mjs';

const plan = { url: 'https://example.edu/events/', adapter: 'html', options: { detailLinks: true } };
const window = { windowStart: '2026-10-01', windowEnd: '2027-10-01' };

/**
 * Build a listing card with independently published title, date and original link.
 * @param {string} path Relative original event URL.
 * @param {string} date Published ISO date.
 * @param {string} title Published event title.
 * @return {string} Event card HTML.
 */
function card(path, date = '2026-10-27', title = 'Admissions information session') {
  return `<article class="event"><h2><a href="${path}">${title}</a></h2><time datetime="${date}"></time><p class="description">Meet the admissions team and learn about the program.</p></article>`;
}

test('grounded parent events survive optional registration-page parser failures', async () => {
  const requests = [];
  const result = await fetchHtml(plan, { ...window, fetchText: async url => {
    requests.push(url);
    return url === plan.url ? card('/register/session') : '<main><h1>Register for this session</h1><div id="dynamic-form"></div></main>';
  } });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].url, 'https://example.edu/register/session');
  assert.equal(result.events[0].start, '2026-10-27');
  assert.match(result.events[0].summary, /Meet the admissions team/);
  assert.notEqual(result.partial, true);
  assert.equal(result.unsupported, false);
  assert.match(result.warnings.join(' '), /Optional detail enrichment/);
  assert.equal(requests.length, 2);
});

test('a parent date outside the window still proves child enrichment is optional', async () => {
  const html = card('/register/old', '2025-10-27');
  const parsed = parseHtml(html, plan, window);
  assert.deepEqual(parsed.events, []);
  assert.deepEqual(parsed.groundedUrls, ['https://example.edu/register/old']);
  const result = await fetchHtml(plan, { ...window, fetchText: async url => {
    if (url === plan.url) return html;
    throw new Error('HTTP 404');
  } });
  assert.deepEqual(result.events, []);
  assert.equal(result.unsupported, false);
  assert.notEqual(result.partial, true);
  assert.match(result.warnings.join(' '), /Optional detail enrichment fetch failed/);
});

test('an ungrounded child remains required when another parent record is already complete', async () => {
  const html = `${card('/register/known')}<article class="event"><h2><a href="/register/unknown">Date announced on detail page</a></h2></article>`;
  const requests = [];
  const result = await fetchHtml(plan, { ...window, fetchText: async url => {
    requests.push(url);
    return url === plan.url ? html : '<main><h1>Client-rendered details</h1></main>';
  } });
  assert.equal(result.events.length, 1);
  assert.equal(result.partial, true);
  assert.equal(requests[1], 'https://example.edu/register/unknown');
  assert.match(result.warnings.join(' '), /Detail \(https:\/\/example.edu\/register\/unknown\)/);
});

test('explicit child discovery remains required even if a parent points to the same URL', async () => {
  const result = await fetchHtml({ ...plan, options: { ...plan.options, detailLinkSelector: 'h2 a' } }, { ...window,
    fetchText: async url => url === plan.url ? card('/register/required') : '<div>Unrecognized child structure</div>' });
  assert.equal(result.events.length, 1);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(' '), /Detail \(https:\/\/example.edu\/register\/required\)/);
});

test('optional-only enrichment caps do not make complete parent snapshots partial', async () => {
  const requests = [];
  const html = [1, 2, 3].map(number => card(`/register/${number}`, '2026-10-27', `Session ${number}`)).join('');
  const result = await fetchHtml({ ...plan, options: { ...plan.options, maxDetails: 1 } }, { ...window,
    fetchText: async url => { requests.push(url); return url === plan.url ? html : '<div>Registration form</div>'; } });
  assert.equal(result.events.length, 3);
  assert.notEqual(result.partial, true);
  assert.equal(requests.length, 2);
  assert.match(result.warnings.join(' '), /Optional detail enrichment limit 1 reached/);
});

test('required discovery is prioritized and missing required pages still make the snapshot partial', async () => {
  const html = `${card('/register/optional')}<article class="event"><h2><a href="/register/required-one">Required session one</a></h2></article><article class="event"><h2><a href="/register/required-two">Required session two</a></h2></article>`;
  const requests = [];
  const result = await fetchHtml({ ...plan, options: { ...plan.options, maxDetails: 1 } }, { ...window,
    fetchText: async url => { requests.push(url); return url === plan.url ? html : card('/register/required-one', '2026-10-28', 'Required session one'); } });
  assert.equal(requests[1], 'https://example.edu/register/required-one');
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(' '), /1 required child page\(s\) remain/);
});

test('fully written date ranges preserve inclusive end dates across months and years', () => {
  for (const [text, start, end] of [
    ['February 25, 2027–February 28, 2027', '2027-02-25', '2027-03-01'],
    ['February 25, 2027 – March 2, 2027', '2027-02-25', '2027-03-03'],
    ['December 30, 2026 to January 2, 2027', '2026-12-30', '2027-01-03'],
  ]) {
    assert.equal(explicitTextDate(text), start);
    assert.equal(explicitTextEnd(text, start), end);
  }
  assert.equal(explicitTextEnd('February 25, 2027–February 31, 2027', '2027-02-25'), null);
  assert.equal(explicitTextEnd('First event February 1, 2027; other event February 25, 2027–February 28, 2027', '2027-02-01'), null);
});

test('explicit image-alt dates require their selected year header rather than a footer year', () => {
  const html = '<h1>Spring 2026 workshops</h1><article><h2>Research workshop four</h2><img alt="Join us on January 28 from 10-11:30am for workshop 4!"></article><footer>2027</footer>';
  const options = { eventSelector: 'article', titleSelector: 'h2', dateSelector: 'img', dateAttribute: 'alt', yearSelector: 'h1' };
  const parsed = parseHtml(html, { ...plan, options });
  assert.equal(parsed.events[0].start, '2026-01-28T15:00:00.000Z');
  assert.equal(parsed.events[0].end, '2026-01-28T16:30:00.000Z');
  assert.equal(parseHtml(html, { ...plan, options: { ...options, yearSelector: undefined } }).events.length, 0);
});

test('a clock immediately after source date punctuation remains grounded to that date', () => {
  assert.equal(explicitTextDate('September17,2026. 9:00 a.m -6:45 p.m'), '2026-09-17T09:00:00');
  assert.equal(explicitTextDate('Oct 22, 2026 · 1:30-2:30PM (ET)'), '2026-10-22T13:30:00');
  assert.equal(explicitTextDate('2026-10-22T13:30:00-04:00'), '2026-10-22T13:30:00-04:00');
});

test('month-first cross-month ranges retain their first date and decline a missing cross-year start year', () => {
  const text = 'Nov 30-Dec 2, 2027';
  assert.equal(explicitTextDate(text), '2027-11-30');
  assert.equal(explicitTextEnd(text, '2027-11-30'), '2027-12-03');
  assert.equal(explicitTextDate('Dec 30-Jan 2, 2027'), null);
  assert.equal(explicitTextDate('Feb 28-Mar 32, 2027'), null);
});

test('academic-year archive pruning uses only a consecutive printed URL year pair', async () => {
  const requests = [];
  const source = { ...plan, options: { detailLinks: true, detailLinkSelector: 'a', detailSemesterWindow: true } };
  const result = await fetchHtml(source, { ...window, fetchText: async url => {
    requests.push(url);
    if (url === plan.url) return '<a href="/2025-26/spring/old.html">Old</a><a href="/2026-27/fall/current.html">Fall</a><a href="/2026-27/spring/next.html">Spring</a><a href="/2026-28/fall/unknown.html">Unrecognized pair</a>';
    return card(url, '2026-10-27', 'Grounded lecture');
  } });
  assert.deepEqual(requests, [plan.url, 'https://example.edu/2026-27/fall/current.html', 'https://example.edu/2026-27/spring/next.html', 'https://example.edu/2026-28/fall/unknown.html']);
  assert.notEqual(result.partial, true);
});
