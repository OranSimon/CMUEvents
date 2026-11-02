import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchEvents } from '../src/adapters/index.mjs';
import { fetchHtml, parseHtml } from '../src/adapters/html.mjs';

const plans = JSON.parse(readFileSync(new URL('../config/source-plans.json', import.meta.url))).plans;
const base = 'https://example.edu/events/';
const options = { monthlyNavigation: { selector: '.calendar', monthSelector: 'h3', headingSelector: 'h2', navigationSelector: '.pagination' } };

/**
 * Build a synthetic publisher month view with explicit advertised destinations.
 * @param {string} label Printed month heading.
 * @param {string} links Navigation anchor markup.
 * @param {string} content Optional occurrence or unknown content.
 * @return {string} Minimal calendar document.
 */
function month(label, links, content = '') {
  return `<section class="calendar"><h2>Events</h2><h3>${label}</h3>${content}<div class="pagination">${links}</div></section>`;
}

test('typed event cards survive a status change while dated news and recordings remain excluded', () => {
  const plan = plans.find(plan => plan.id === '523bea4a0d5b');
  const card = (type, title) => `<div class="anm-card" data-type="${type}"><span class="anm-timestamp">December 4–5, 2028</span><a class="anm-title" href="/${type}">${title}</a><p class="anm-desc">Published summary.</p></div>`;
  const result = parseHtml(card('event', 'New workshop') + card('past', 'Previous workshop')
    + card('video-past', 'Recorded webinar') + card('news', 'Award announcement') + card('video', 'Video publication'), plan);
  assert.equal(result.unsupported, false);
  assert.deepEqual(result.events.map(event => event.title), ['New workshop', 'Previous workshop', 'Recorded webinar']);
  assert.ok(result.events.every(event => event.start === '2028-12-04' && event.end === '2028-12-06'));
  assert.equal(plan.options.detailOptions.dateSelector, ':scope');
});

test('monthly navigation crosses years and follows advertised months only within the window', async () => {
  const pages = {
    [base]: month('December 2028', '<a href="nov">November 2028</a><a href="jan">January 2029</a>'),
    [`${base}nov`]: month('November 2028', '<a href="oct">October 2028</a><a href="./">December 2028</a>'),
    [`${base}jan`]: month('January 2029', '<a href="./">December 2028</a><a href="feb">February 2029</a>'),
  };
  const requests = [];
  const result = await fetchHtml({ url: base, options }, { windowStart: '2028-11-03', windowEnd: '2029-01-25',
    fetchText: async url => { requests.push(url); assert.ok(pages[url], `unadvertised or out-of-window URL ${url}`); return pages[url]; } });
  assert.deepEqual(requests, Object.keys(pages));
  assert.equal(result.unsupported, false);
  assert.equal(result.undated, true);
  assert.notEqual(result.partial, true);
  assert.equal(result.coverage.inspectionComplete, true);
  assert.equal(result.coverage.assets.length, 3);
  assert.deepEqual(result.events, []);
});

test('new content, missing headings and changed navigation require review rather than becoming healthy zero', async () => {
  for (const html of [
    month('December 2028', '<a href="jan">January 2029</a>', '<p>A newly announced seminar awaits its schedule</p>'),
    month('December 2028', '<a href="jan">January 2029</a>', '<iframe src="/new-calendar"></iframe>'),
    month('December 2028', '<a href="bad">March 2029</a>'),
    month('December 2028', '<a href="https://other.edu/events">January 2029</a>'),
    '<section class="calendar"><h3>December</h3></section>',
  ]) {
    const result = await fetchHtml({ url: base, options }, { windowStart: '2028-12-01', windowEnd: '2028-12-31', fetchText: async () => html });
    assert.equal(result.partial, true);
    assert.notEqual(result.undated, true);
    assert.equal(result.coverage.inspectionComplete, false);
    assert.ok(result.coverage.internalIssues.length);
  }
});

test('pagination retains current audits and distinguishes upstream failure from a scan cap', async () => {
  const html = month('December 2028', '<a href="jan">January 2029</a>');
  const context = { windowStart: '2028-12-01', windowEnd: '2029-01-31', fetchText: async url => {
    if (url !== base) throw new Error('HTTP 404 from example.edu'); return html;
  } };
  const failed = await fetchHtml({ url: base, options }, context);
  assert.equal(failed.partial, true);
  assert.equal(failed.coverage.inspectionComplete, true);
  assert.equal(failed.coverage.externalIssues.length, 1);
  assert.deepEqual(failed.coverage.internalIssues, []);
  const capped = await fetchHtml({ url: base, options: { ...options, maxPages: 1 } }, context);
  assert.equal(capped.coverage.inspectionComplete, false);
  assert.match(capped.coverage.internalIssues.join(' '), /pagination limit/);
});

test('an explicit terminal navigation marker ends traversal without synthesizing another month', async () => {
  const result = await fetchHtml({ url: base, options: { monthlyNavigation: { ...options.monthlyNavigation,
    terminalSelector: 'a[href="#"]', terminalPattern: '^No Upcoming Events$' } } }, {
    windowStart: '2028-12-01', windowEnd: '2029-12-31', fetchText: async url => {
      assert.equal(url, base);
      return month('December 2028', '<a href="nov">November 2028</a><a href="#">No Upcoming Events</a>');
    } });
  assert.equal(result.undated, true);
  assert.notEqual(result.partial, true);
});

test('a healthy later page cannot hide an unrecognized first listing page', async () => {
  const result = await fetchHtml({ url: base, options: { paginationSelector: 'a[rel=next]' } }, {
    fetchText: async url => url === base ? '<h1>Changed listing</h1><a rel="next" href="page2">Next</a>'
      : '<article class="event"><h2>New lecture</h2><time datetime="2028-12-04"></time></article>',
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.coverage.inspectionComplete, false);
  assert.match(result.coverage.internalIssues.join(' '), /initial listing/);
});

test('a successful ordinary HTML endpoint records current coverage for publication validation', async () => {
  const result = await fetchEvents({ url: base, adapter: 'html' }, { fetchText: async () =>
    '<article class="event"><h2>New lecture</h2><time datetime="2028-12-04"></time></article>' });
  assert.equal(result.events.length, 1);
  assert.equal(result.coverage.inspectionComplete, true);
  assert.deepEqual(result.coverage.internalIssues, []);
});
