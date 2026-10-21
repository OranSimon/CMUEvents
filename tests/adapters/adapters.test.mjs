import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIcs, parseHtml, parseRss, parseLiveWhale, parseWordPress, parseNewsletterText,
  parseTepper, fetchEvents, explicitTextDate } from '../../src/adapters/index.mjs';
import { parseDate } from '../../src/lib/normalize.mjs';

const plan = { id: 'test', url: 'https://example.edu/events/', fetchUrl: 'https://example.edu/calendar.ics', options: { timezone: 'America/New_York' } };
const window = { now: '2026-10-20T12:00:00Z', windowStart: '2026-10-20', windowEnd: '2026-12-01' };

test('ICS keeps wall time across DST, EXDATE, moved and sparse cancelled exceptions, and exclusive all-day end', () => {
  const result = parseIcs(readFileSync(new URL('./fixtures/recurrence.ics', import.meta.url), 'utf8'), plan, window);
  assert.deepEqual(result.warnings, []);
  const recurring = result.events.filter(event => event.uid.startsWith('weekly-talk'));
  assert.equal(recurring.length, 4);
  assert.equal(recurring[0].start, '2026-10-25T14:00:00.000Z');
  assert.equal(recurring[1].start, '2026-11-01T15:00:00.000Z');
  assert.equal(recurring[2].start, '2026-11-15T18:00:00.000Z');
  assert.equal(recurring[2].title, 'Moved seminar');
  assert.equal(recurring[2].url, 'https://example.edu/events/seminar');
  assert.match(recurring[2].uid, /2026-11-15T10:00:00/);
  assert.equal(recurring[3].status, 'cancelled');
  assert.equal(recurring[3].end, '2026-11-22T16:00:00.000Z');
  const allDay = result.events.find(event => event.uid === 'all-day');
  assert.equal(allDay.start, '2026-10-30');
  assert.equal(allDay.end, '2026-11-02');
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.timePrecision, 'all-day');
});

test('ICS does not relate exceptions across different UIDs and handles floating default explicitly', () => {
  const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:first\nDTSTART:20261022T100000\nSUMMARY:One\nEND:VEVENT\nBEGIN:VEVENT\nUID:other\nRECURRENCE-ID:20261022T100000Z\nDTSTART:20261022T120000Z\nSUMMARY:Other\nEND:VEVENT\nEND:VCALENDAR`;
  const result = parseIcs(ics, plan, window);
  assert.equal(result.events.length, 2);
  assert.equal(result.events.find(event => event.uid === 'first').start, '2026-10-22T14:00:00.000Z');
  assert.match(result.warnings.join(), /Floating/);
});

test('invalid dates and nonexistent DST wall-clock times are rejected', () => {
  assert.equal(parseDate('2026-02-31'), null);
  assert.equal(parseDate('2026-03-08T02:30:00', 'America/New_York'), null);
  assert.equal(parseDate('not a date'), null);
});

test('JSON-LD Event is extracted, markup becomes text, source publication dates are ignored', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'Article', name: 'News story', datePublished: '2026-10-22' },
    { '@type': 'Event', name: 'AI <b>Seminar</b>', startDate: '2026-10-22T10:00:00-04:00',
      endDate: '2026-10-22T11:00:00-04:00', description: '<p>Open research talk.</p><script>bad()</script>',
      url: '/events/ai', location: { name: 'Gates', address: { streetAddress: '5000 Forbes Ave', addressLocality: 'Pittsburgh' } } },
  ] }).replace(/</g, '\\u003c')}</script>`;
  const result = parseHtml(html, plan, window);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, 'AI Seminar');
  assert.equal(result.events[0].description, 'Open research talk.');
  assert.equal(result.events[0].url, 'https://example.edu/events/ai');
  assert.equal(result.events[0].start, '2026-10-22T14:00:00.000Z');
});

test('configured selectors read Slate card own data-date and HCII time', () => {
  const slate = parseHtml('<div class="event" data-date="2026-10-22T12:00:00" data-location="Zoom"><a href="/register/123">Admissions overview</a></div>',
    { ...plan, options: { eventSelector: '.event', dateSelector: '[data-date]', titleSelector: 'a', linkSelector: 'a' } }, window);
  assert.equal(slate.events[0].start, '2026-10-22T16:00:00.000Z');
  assert.equal(slate.events[0].location, 'Zoom');
  assert.equal(slate.events[0].timePrecision, 'time');
});

test('RSS honors xCal event start instead of publication date and skips news-only entries', () => {
  const rss = `<rss><channel><item><title>Research talk</title><link>https://example.edu/events/talk</link><pubDate>01 Oct 2026 10:00:00 GMT</pubDate><xCal:dtstart>2026-10-22T15:00:00Z</xCal:dtstart><xCal:dtend>2026-10-22T16:00:00Z</xCal:dtend><description>New research.</description></item><item><title>News article</title><link>https://example.edu/news</link><pubDate>22 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const result = parseRss(rss, plan, window);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].start, '2026-10-22T15:00:00.000Z');
  assert.match(result.warnings.join(), /publication dates are ignored/);
});

test('LiveWhale all-day date uses event timezone and recurring occurrences have distinct IDs', () => {
  const result = parseLiveWhale({ data: [
    { id: 1, title: 'Africa exhibition', date_iso: '2026-10-20T18:00:00-04:00', date_ts: 1792533600, timezone: 'Africa/Harare', is_all_day: 1, url: 'https://example.edu/events/1' },
    { id: 1, title: 'Africa exhibition', date_iso: '2026-10-21T18:00:00-04:00', date_ts: 1792620000, timezone: 'Africa/Harare', is_all_day: 1, url: 'https://example.edu/events/1' },
  ] }, plan, window);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].start, '2026-10-21');
  assert.equal(result.events[0].end, '2026-10-22');
  assert.notEqual(result.events[0].uid, result.events[1].uid);
});

test('WordPress uses explicit UTC event dates and maps source categories', () => {
  const result = parseWordPress({ events: [{ id: 8, title: 'Robotics seminar', start_date: '2026-10-22 12:00:00', start_date_utc: '2026-10-22 16:00:00', end_date_utc: '2026-10-22 17:00:00', url: 'https://example.edu/events/8', description: '<b>Robotics research.</b>', categories: [{ name: 'Seminars' }] }] }, plan, window);
  assert.equal(result.events[0].start, '2026-10-22T16:00:00.000Z');
  assert.deepEqual(result.events[0].tags, ['Seminars']);
});

test('newsletter extracts event sections using explicit issue-year context, never publication day', () => {
  const result = parseNewsletterText(`October 16, 2026 View in Browser\nHello Students!\nOIE & CMU News & Events\nCaPS Global Connections:\nInternational Student Support\nGroup\nOct. 20 from 5:30 to 6:30 p.m.\nSupport and community for international students.\n[Learn More](https://example.edu/support)\nOur Pittsburgh Picks\nSalsa Dancing on the Lawn\nOct. 16 at 8 p.m.\nDance outdoors.\nLearn More`, { ...plan, url: 'https://example.edu/issue.pdf' }, { windowStart: '2026-10-01', windowEnd: '2026-11-01' });
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].title, 'CaPS Global Connections: International Student Support Group');
  assert.equal(result.events[0].start, '2026-10-20T21:30:00.000Z');
  assert.equal(result.events[0].url, 'https://example.edu/support');
  assert.ok(!result.events.some(event => event.title === 'October 16, 2026 View in Browser'));
  assert.match(result.warnings.join(), /explicit issue header/);
  assert.equal(result.events[0].end, '2026-10-20T22:30:00.000Z');
});

test('Tepper whitelists event fields and never persists travel or coordinator metadata', () => {
  const result = parseTepper({ Data: [{ SeminarId: 3, SeminarTitle: 'Economics seminar', SeminarDate: '2026-10-22T12:00:00-04:00', SeminarEndDate: '2026-10-22T13:00:00-04:00', Abstract: 'Economics.', SeminarLocation: 'TEP', SeminarAreaList: ['Economics'], Cancelled: false, CoordinatorEmail: 'private@example.edu', SpeakerTravel: 'private travel' }], Total: 1 }, plan, window);
  assert.equal(result.events.length, 1);
  assert.ok(!JSON.stringify(result.events).includes('private'));
  assert.equal(result.events[0].url, 'https://seminartracker.tepper.cmu.edu/SeminarDetail?SeminarId=3');
});

test('LiveWhale pagination and additional widgets reuse normalized parser', async () => {
  const pages = {
    'https://example.edu/json': { data: [{ id: 1, title: 'One', date_iso: '2026-10-22T10:00:00Z', url: '/one' }], links: { next: '/json?page=2' } },
    'https://example.edu/json?page=2': { data: [{ id: 2, title: 'Two', date_iso: '2026-10-23T10:00:00Z', url: '/two' }] },
    'https://example.edu/widget': { data: [{ id: 3, title: 'Three', date_iso: '2026-10-24T10:00:00Z', url: '/three' }] },
  };
  const result = await fetchEvents({ ...plan, adapter: 'livewhale', fetchUrl: 'https://example.edu/json', options: { additionalFetchUrls: ['https://example.edu/widget'] } }, { ...window, fetchText: async url => JSON.stringify(pages[url]) });
  assert.equal(result.events.length, 3);
  assert.deepEqual(result.warnings, []);
});

test('explicit prose parser does not invent a missing year and handles compact date text', () => {
  assert.equal(explicitTextDate('Oct. 20 at 5pm'), null);
  assert.equal(explicitTextDate('Wednesday October21 2026 at 5:30 p.m.'), '2026-10-21T17:30:00');
  assert.equal(explicitTextDate('2026/09/08'), '2026-09-08');
});

test('CampusGroups recognized empty event list succeeds while unknown HTML remains unsupported', () => {
  const empty = '<div class="section-cont__content-events--featured"><h3 class="cg_dynamic_msg">There are no upcoming events.</h3><a href="/events">Discover more events</a></div>';
  const campusPlan = { adapter: 'campusgroups', url: 'https://tartanconnect.cmu.edu/club/events/' };
  const result = parseHtml(empty, campusPlan, window);
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.unsupported, false);
  assert.equal(parseHtml(empty.replace('events--featured', 'events--large'), campusPlan, window).unsupported, false);
  assert.equal(parseHtml('<h1>Events</h1><div id="app"></div>', campusPlan, window).unsupported, true);
  assert.equal(parseHtml(empty, { ...plan, adapter: 'html' }, window).unsupported, true);
  assert.equal(parseHtml('<p>There are no upcoming events.</p>', campusPlan, window).unsupported, true);
});

test('valid past-only HTML parsing produces a successful empty window instead of parser mismatch', async () => {
  const html = `<script type="application/ld+json">{"@type":"Event","name":"Past seminar","startDate":"2025-09-01T10:00:00Z","url":"https://example.edu/past"}</script>`;
  const result = parseHtml(html, plan, window);
  assert.deepEqual(result.events, []);
  assert.equal(result.recognized, 1);
  assert.equal(result.unsupported, false);
  assert.deepEqual(result.warnings, []);
  const fetched = await fetchEvents({ ...plan, adapter: 'html' }, { ...window, fetchText: async () => html });
  assert.notEqual(fetched.unsupported, true);
  assert.deepEqual(fetched.events, []);
});

test('explicitly reviewed source empty selector/pattern recognizes only its matching empty state', () => {
  const configured = { ...plan, adapter: 'html', options: { emptySelector: '#Upcoming', emptyPattern: 'Stay tuned for future announcements' } };
  assert.equal(parseHtml('<div id="Upcoming">Upcoming Stay tuned for future announcements!</div>', configured, window).unsupported, false);
  assert.equal(parseHtml('<div id="Upcoming">Loading events...</div>', configured, window).unsupported, true);
});

test('heading sections use event registration links and preserve date-only precision', async () => {
  const html = '<div id="content"><h2>Founders Workshop</h2><p>October 22, 2026</p><p><a href="https://linkedin.com/speaker">Speaker bio</a></p><p>Build a business.</p><p><a class="btn" href="/register/workshop">Register</a></p></div>';
  const result = await fetchEvents({ ...plan, adapter: 'html', options: { headingSections: true } }, { ...window, fetchText: async () => html });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].url, 'https://example.edu/register/workshop');
  assert.equal(result.events[0].timePrecision, 'date');
});

test('valid newsletter event blocks outside the requested window remain a recognized parser result', () => {
  const result = parseNewsletterText('October 16, 2025\nNews & Events\nSupport group\nOct. 20 at 5 p.m.\nA welcoming discussion.\nLearn More',
    { ...plan, url: 'https://example.edu/issue.pdf' }, window);
  assert.deepEqual(result.events, []);
  assert.equal(result.unsupported, false);
  assert.ok(!result.warnings.some(warning => warning.startsWith('No individually')));
});

test('failed additional widgets mark the complete source snapshot as partial', async () => {
  const result = await fetchEvents({ ...plan, adapter: 'livewhale', fetchUrl: 'https://example.edu/json', options: { additionalFetchUrls: ['https://example.edu/broken'] } },
    { ...window, fetchText: async url => { if (url.endsWith('broken')) throw new Error('HTTP 503'); return JSON.stringify({ data: [{ id: 1, title: 'Talk', date_iso: '2026-10-22T10:00:00Z', url: '/talk' }] }); } });
  assert.equal(result.events.length, 1);
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(), /Additional endpoint failed/);
});

test('malformed ICS records are partial while valid empty or past-only calendars are successful', () => {
  const invalid = parseIcs('BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:broken\nSUMMARY:Missing date\nEND:VEVENT\nEND:VCALENDAR', plan, window);
  assert.equal(invalid.partial, true);
  assert.deepEqual(invalid.events, []);
  const empty = parseIcs('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR', plan, window);
  assert.notEqual(empty.partial, true);
  const old = parseIcs('BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:old\nSUMMARY:Past event\nDTSTART:20250101T120000Z\nEND:VEVENT\nEND:VCALENDAR', plan, window);
  assert.deepEqual(old.events, []);
  assert.notEqual(old.partial, true);
});

test('truncated JSON pagination is explicitly partial', async () => {
  const result = await fetchEvents({ ...plan, adapter: 'livewhale', options: { maxPages: 1 } }, { ...window,
    fetchText: async () => JSON.stringify({ data: [{ id: 1, title: 'Talk', date_iso: '2026-10-22T10:00:00Z', url: '/talk' }], links: { next: '/page2' } }) });
  assert.equal(result.partial, true);
  assert.match(result.warnings.join(), /Pagination limit/);
});

test('Tepper dispatch returns a complete whitelisted snapshot', async () => {
  const result = await fetchEvents({ ...plan, adapter: 'html', options: { format: 'tepper' } }, { ...window,
    fetchText: async (url, options) => {
      assert.equal(options.cache, false, 'raw responses containing unrelated metadata must not be cached');
      return JSON.stringify({ Data: [{ SeminarId: 2, SeminarTitle: 'Seminar', SeminarDate: '2026-10-22T12:00:00-04:00' }], Total: 1 });
    } });
  assert.equal(result.events.length, 1);
  assert.notEqual(result.partial, true);
});

test('HTML detail crawling rejects binary posters/documents and follows actual event pages', async () => {
  const listing = '<main><h1>Events</h1><a href="/events/poster.PNG?download=1">Event poster</a><a href="/events/program.pdf">Event program</a><a href="/events/calendar.ics">Event calendar</a><a href="/events/slides.pptx">Event slides</a><a href="/events/real-talk">Research seminar details</a></main>';
  const urls = [];
  const result = await fetchEvents({ ...plan, adapter: 'html', fetchUrl: 'https://example.edu/events/', options: { detailLinks: true } },
    { ...window, fetchText: async url => {
      urls.push(url);
      if (url.endsWith('/events/')) return listing;
      return '<script type="application/ld+json">{"@type":"Event","name":"Research seminar","startDate":"2026-10-22T10:00:00Z","url":"https://example.edu/events/real-talk"}</script>';
    } });
  assert.deepEqual(urls, ['https://example.edu/events/', 'https://example.edu/events/real-talk']);
  assert.equal(result.events.length, 1);
  assert.notEqual(result.partial, true);
});

test('legacy CampusGroups announcements with no year are not reported as empty or assigned footer year', () => {
  const html = '<h1>Events</h1><h2>First Meeting</h2><p>Our first meeting is on Thursday, September 15th from 5-7pm in UC McKenna.</p><footer>© 2026 Chess Club</footer>';
  const result = parseHtml(html, { adapter: 'campusgroups', url: 'https://tartanconnect.cmu.edu/Chess/events/' }, window);
  assert.deepEqual(result.events, []);
  assert.equal(result.unsupported, true);
});
