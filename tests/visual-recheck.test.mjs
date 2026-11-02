import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fetchReviewedImages } from '../src/adapters/reviewed-images.mjs';
import { parseAlumniEvents } from '../src/adapters/alumni.mjs';

test('the reviewed poster guard also accepts a publisher-advertised PDF link and rejects replacement bytes', async () => {
  const bytes = Buffer.from('%PDF-1.4 reviewed public seminar document');
  const plan = { url: 'https://example.edu/seminars.html', options: { reviewedImages: [{ selector: 'a.schedule', attribute: 'href',
    sha256: createHash('sha256').update(bytes).digest('hex'), events: [{ title: 'Reviewed seminar', start: '2026-05-07' }] }] } };
  const html = '<a class="schedule" href="docs/seminar.pdf">Slides</a>';
  const context = { fetchBytes: async url => { assert.equal(url, 'https://example.edu/docs/seminar.pdf'); return bytes; } };
  const accepted = await fetchReviewedImages(html, plan, context);
  assert.equal(accepted.events[0].start, '2026-05-07');
  assert.equal(accepted.events[0].timePrecision, 'date');
  const changed = await fetchReviewedImages(html, plan, { fetchBytes: async () => Buffer.from('replacement PDF') });
  assert.equal(changed.partial, true);
  assert.deepEqual(changed.events, []);
  assert.match(changed.warnings.join(' '), /Document changed/);
});

const card = { id: 'a7DUk000000OnpFMAS', title: 'Sydney - Alumni Coffee and Catch-Up', date: '2026-10-27',
  url: 'https://www.givecampus.com/schools/CarnegieMellonUniversity/events/sydney-alumni-coffee-and-catch-up',
  location: '', clockPolicy: 'reviewed_detail', detailReview: {
    url: 'https://www.givecampus.com/schools/CarnegieMellonUniversity/events/sydney-alumni-coffee-and-catch-up',
    checkedAt: '2026-10-26T00:45:00Z', evidence: 'public-detail.jpg',
    start: '2026-10-28T08:00:00', end: '2026-10-28T09:30:00', timeZone: 'Australia/Sydney',
    location: 'Planar Restaurant', description: 'Original event details give an explicit Sydney start and end.' } };

test('a reviewed original detail resolves local Sydney time while matching the same live UTC instant', () => {
  const clocks = new Map([[card.id, { startDate: '2026-10-27T21:00:00Z', timeZoneVal: 'America/New_York' }]]);
  const result = parseAlumniEvents([card], clocks);
  assert.equal(result.events[0].start, '2026-10-27T21:00:00.000Z');
  assert.equal(result.events[0].end, '2026-10-27T22:30:00.000Z');
  assert.equal(result.events[0].timeZone, 'Australia/Sydney');
  assert.equal(result.events[0].location, 'Planar Restaurant');
  assert.equal(result.partial, true, 'new-card discovery remains incomplete');
});

test('an original detail is not silently reused after the live clock moves', () => {
  const clocks = new Map([[card.id, { startDate: '2026-10-27T22:00:00Z', timeZoneVal: 'America/New_York' }]]);
  const result = parseAlumniEvents([card], clocks);
  assert.equal(result.events[0].start, card.date);
  assert.equal(result.events[0].timePrecision, 'date');
  assert.match(result.warnings.join(' '), /no longer agrees/);
});
