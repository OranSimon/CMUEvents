import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchHtml, explicitTextDate, explicitTextEnd } from '../src/adapters/html.mjs';
import { resourceFingerprint } from '../src/adapters/reviewed-resources.mjs';

const url = 'https://example.edu/events/';
const window = { windowStart: '2026-09-25', windowEnd: '2027-10-25' };

/**
 * Build a semantic publisher card without any organization-scope filtering.
 * @param {string} title Published event title.
 * @param {string} day Explicit published calendar date.
 * @return {string} Event card markup.
 */
function card(title, day = '2026-11-01') {
  return `<article class="event"><h2>${title}</h2><time datetime="${day}"></time></article>`;
}

test('listing pagination follows only advertised links and retains club reposts on official sources', async () => {
  const requests = [];
  const plan = { url, options: { paginationSelector: 'a[rel=next]', maxPages: 5 } };
  const result = await fetchHtml(plan, { ...window, fetchText: async endpoint => {
    requests.push(endpoint);
    return endpoint === url ? `${card('Official lecture')}<a rel="next" href="?page=1">Next</a>` : card('RoboClub public meeting');
  } });
  assert.deepEqual(requests, [url, `${url}?page=1`]);
  assert.deepEqual(result.events.map(event => event.title), ['Official lecture', 'RoboClub public meeting']);
  assert.notEqual(result.partial, true);
});

test('a disappearing pagination link never synthesizes a stale second page', async () => {
  const requests = [];
  const result = await fetchHtml({ url, options: { paginationSelector: 'a[rel=next]' } }, { ...window,
    fetchText: async endpoint => { requests.push(endpoint); return card('Only published listing page'); } });
  assert.deepEqual(requests, [url]);
  assert.equal(result.events.length, 1);
  assert.notEqual(result.partial, true);
});

test('failed, cross-origin or capped listing pages keep valid records and explicit partial diagnostics', async () => {
  for (const [next, maxPages, pattern] of [['?page=1', 5, /Listing page failed/],
    ['https://other.example/events', 5, /cross-origin/], ['?page=1', 1, /pagination limit/]]) {
    const result = await fetchHtml({ url, options: { paginationSelector: 'a[rel=next]', maxPages } }, { ...window,
      fetchText: async endpoint => { if (endpoint !== url) throw new Error('HTTP404'); return `${card('Known event')}<a rel="next" href="${next}">Next</a>`; } });
    assert.equal(result.events.length, 1);
    assert.equal(result.partial, true);
    assert.match(result.warnings.join(' '), pattern);
  }
});

test('an exact reviewed undated resource is monitored separately from an empty event calendar', async () => {
  const html = '<section id="series"><h1>Seminar series</h1><p>First Thursday, speakers to be announced.</p></section>';
  const review = { selector: '#series', ...resourceFingerprint(html, '#series'), kind: 'undated series', reason: 'No exact occurrence dates are published.' };
  const result = await fetchHtml({ url, options: { reviewedResources: [review] } }, { ...window, fetchText: async () => html });
  assert.equal(result.unsupported, false);
  assert.equal(result.undated, true);
  assert.notEqual(result.partial, true);
  assert.deepEqual(result.events, []);
  assert.match(result.warnings.join(' '), /Monitored undated series/);
});

test('known historical dated events keep empty-window precision even with undated monitored sections', async () => {
  const html = `${card('Published historical seminar', '2024-01-20')}<section id="series">Future speakers unannounced.</section>`;
  const review = { selector: '#series', ...resourceFingerprint(html, '#series'), kind: 'undated series', reason: 'No exact future occurrence dates.' };
  const result = await fetchHtml({ url, options: { reviewedResources: [review] } }, { ...window, fetchText: async () => html });
  assert.equal(result.unsupported, false);
  assert.notEqual(result.undated, true);
  assert.notEqual(result.partial, true);
  assert.deepEqual(result.events, []);
});

test('only fingerprint-matched archive blocks can suppress required child discovery', async () => {
  const html = '<div id="legacy"><a href="/events/archive">Yearless legacy archive</a></div>';
  const review = { selector: '#legacy', ...resourceFingerprint(html, '#legacy'), kind: 'legacy archive',
    reason: 'Reviewed historical summaries lack full years.', excludeDetailLinks: true };
  const plan = { url, options: { detailLinks: true, detailLinkSelector: '#legacy a', reviewedResources: [review] } };
  const requests = [];
  const unchanged = await fetchHtml(plan, { ...window, fetchText: async endpoint => { requests.push(endpoint); return html; } });
  assert.deepEqual(requests, [url]);
  assert.equal(unchanged.undated, true);
  for (const changed of [html.replace('Yearless legacy', 'New seminar in'), html.replace('/events/archive', '/events/new'), html.replace('id="legacy"', 'id="missing"')]) {
    const parsed = await fetchHtml(plan, { ...window, fetchText: async endpoint => endpoint === url ? changed : '<h1>Undated child</h1>' });
    assert.equal(parsed.partial, true);
    assert.match(parsed.warnings.join(' '), /Reviewed resource changed or is missing/);
    if (!changed.includes('id="missing"')) assert.match(parsed.warnings.join(' '), /Detail \(/);
  }
});

test('an advertised public agenda supplies its explicit date range, never the current year', async () => {
  const html = '<h1>AI and Human Decisions</h1><a class="agenda" href="https://docs.google.com/document/d/public-id/edit">Agenda</a>';
  const requests = [];
  const plan = { url, options: { linkedTextSchedule: { linkSelector: 'a.agenda', titleSelector: 'h1', dateLinePrefix: 'Date:' } } };
  const result = await fetchHtml(plan, { fetchText: async endpoint => {
    requests.push(endpoint); return endpoint === url ? html : 'AI and Human Decisions\nDate: Fri 10th – Sat 11th April 2026\nConference agenda';
  } });
  assert.deepEqual(requests, [url, 'https://docs.google.com/document/d/public-id/export?format=txt']);
  assert.equal(result.events[0].start, '2026-04-10');
  assert.equal(result.events[0].end, '2026-04-12');
  assert.equal(result.events[0].url, url);
  const missing = await fetchHtml(plan, { fetchText: async endpoint => endpoint === url ? html : 'Date: Friday April 10' });
  assert.equal(missing.partial, true);
  assert.equal(missing.events.length, 0);
});

test('adjacent-day prose lists preserve their explicit span while nonadjacent lists are not continuous events', () => {
  assert.equal(explicitTextDate('January 23rd and 24th, 2025'), '2025-01-23');
  assert.equal(explicitTextEnd('January 23rd and 24th, 2025', '2025-01-23'), '2025-01-25');
  assert.equal(explicitTextDate('January23rd and24th,2025'), '2025-01-23');
  assert.equal(explicitTextEnd('January23rd and24th,2025', '2025-01-23'), '2025-01-25');
  assert.equal(explicitTextDate('January 3 and 24, 2025'), null);
  assert.equal(explicitTextDate('Friday, Apr. 11 - Saturday Apr 12, 2025'), '2025-04-11');
  assert.equal(explicitTextEnd('Friday, Apr. 11 - Saturday Apr 12, 2025', '2025-04-11'), '2025-04-13');
});
