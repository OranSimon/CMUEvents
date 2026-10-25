import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { fetchEvents } from '../src/adapters/index.mjs';

const root = new URL('../research/remaining-19-2026-10-25/', import.meta.url);
const report = JSON.parse(await readFile(new URL('academic.json', root), 'utf8'));
const reviews = new Map(report.recommendedOverrides.map(review => [review.id, review]));
const images = new Map([
  ['colloquium-series-fall-2026.png', 'lti-fall-2026.png'],
  ['screenshot-2026-08-21-at-2.18.58pm.png', 'socialist-fall-1.png'],
  ['screenshot-2026-08-21-at-2.19.02pm.png', 'socialist-fall-2.png'],
  ['screenshot-2026-08-21-at-2.19.05pm.png', 'socialist-fall-3.png'],
  ['speakerposter2.27.11x17.png', 'cause-augustus.png'],
]);

/**
 * Replay one reviewed public source without fetching the network or changing data.
 * @param {string} id Stable source identity.
 * @param {Object} changes Optional HTML transform and collection window.
 * @return {Promise<Object>} Adapter events and diagnostics.
 */
async function replay(id, changes = {}) {
  const review = reviews.get(id);
  const plan = { id, url: review.url, ...review.override };
  const html = await readFile(new URL(`evidence/academic-${id}.html`, root), 'utf8');
  return fetchEvents(plan, {
    ...report.testWindow,
    ...changes.window,
    fetchText: async url => {
      assert.equal(url, plan.fetchUrl);
      return changes.html ? changes.html(html) : html;
    },
    fetchBytes: async url => {
      const file = images.get(new URL(url).pathname.split('/').pop());
      assert.ok(file, `Unexpected image request: ${url}`);
      return readFile(new URL(`evidence/${file}`, root));
    },
  });
}

test('reviewed LTI rows preserve speaker pairing, explicit socials and DST clocks', async () => {
  const result = await replay('528193392a78');
  assert.equal(result.events.length, 10);
  const byTitle = new Map(result.events.map(event => [event.title, event]));
  const potts = byTitle.get('LTI Colloquium — Chris Potts');
  assert.equal(potts.start, '2026-10-30T19:30:00.000Z');
  assert.equal(potts.end, '2026-10-30T21:00:00.000Z');
  assert.equal(byTitle.get('LTI Colloquium — Jocelyn Shen').start, '2026-11-13T20:30:00.000Z');
  assert.equal(byTitle.get('LTI Colloquium — Mohit Iyyer').start, '2026-11-20T20:30:00.000Z');
  assert.equal(result.events.find(event => event.uid === 'lti-social-2026-11-06').start, '2026-11-06T20:00:00.000Z');
  assert.equal(result.partial, undefined);
});

test('a reused LTI image cannot silently inherit a changed semester year', async () => {
  const result = await replay('528193392a78', {
    html: html => html.replace('Fall 2026 Schedule</h1>', 'Fall 2027 Schedule</h1>'),
  });
  assert.equal(result.events.length, 0);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(' '), /expected one image/);
});

test('reviewed Socialist Studies posters retain their different times and precise venue', async () => {
  const result = await replay('34fa7359276d');
  assert.equal(result.events.length, 2);
  const dumitru = result.events.find(event => event.title.endsWith('Diana Dumitru'));
  const muller = result.events.find(event => event.title.endsWith('Anna Muller'));
  assert.equal(dumitru.start, '2026-10-09T20:00:00.000Z');
  assert.equal(dumitru.end, '2026-10-09T21:30:00.000Z');
  assert.equal(muller.start, '2026-11-20T21:00:00.000Z');
  assert.equal(muller.end, '2026-11-20T22:30:00.000Z');
  assert.match(muller.location, /246A/);
  assert.equal(result.partial, undefined);
});

test('CAUSE recognizes its historical poster without inventing a current occurrence', async () => {
  const current = await replay('d861fd81e26d');
  assert.equal(current.events.length, 0);
  assert.equal(current.undated, undefined);
  assert.equal(current.unsupported, undefined);
  assert.equal(current.partial, undefined);
  const historical = await replay('d861fd81e26d', { window: { windowStart: '2026-01-01' } });
  assert.equal(historical.events.length, 1);
  assert.equal(historical.events[0].start, '2026-02-27T21:30:00.000Z');
  assert.equal(historical.events[0].end, '2026-02-27T23:45:00.000Z');
});

test('a new CAUSE announcement raises review even while the old poster remains', async () => {
  const result = await replay('d861fd81e26d', {
    html: html => html.replace('Previous Events', 'Upcoming lecture: November 27, 2026. Previous Events'),
  });
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(' '), /resource changed/);
});

test('recording archives remain undated resources and new links trigger review', async () => {
  for (const id of ['5ade174c3483', 'b453fc62eac4']) {
    const current = await replay(id);
    assert.equal(current.events.length, 0);
    assert.equal(current.undated, true);
    assert.equal(current.unsupported, undefined);
    assert.equal(current.partial, undefined);
    const changed = await replay(id, {
      html: html => {
        const $ = cheerio.load(html);
        $(reviews.get(id).override.options.reviewedResources[0].selector)
          .append('<a href="new-scheduled-seminar.html">New seminar</a>');
        return $.html();
      },
    });
    assert.equal(changed.partial, true);
    assert.equal(changed.undated, undefined);
  }
});
