import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAutomaticMedia } from '../src/adapters/automatic-media.mjs';
import { fetchTextSchedule } from '../src/adapters/text-schedules.mjs';
import { createJevClient, JEV_MODEL } from '../src/lib/jev.mjs';
import { chooseSchedule, scheduleCandidates } from '../src/lib/jev-time.mjs';
import { normalizeEvent } from '../src/lib/normalize.mjs';
import { assessSemanticMatches } from '../src/lib/occurrence-merge.mjs';
import { openStore } from '../src/lib/store.mjs';

const tz = 'America/New_York';
const posterText = 'Registration closes May 10, 2027 at 5:00 PM\nLecture: May 15, 2027, 6:00 PM to 7:30 PM';
const timeInput = { title: 'Photonics Guest Lecture', texts: [posterText], timeZone: tz };

/** Produce a well-formed fixture response for a selected option. */
function answer(question, option, probability = 1) {
  const keys = Object.keys(question.criteria);
  return { type: 'choice', choice: option, probabilities: Object.fromEntries(keys.map(key => [
    key, key === option ? probability : (1 - probability) / (keys.length - 1),
  ])) };
}

/** Select a fixture endpoint by its value, independently of candidate ordering. */
function endpoint(question, value) {
  return Object.keys(question.criteria).find(key => question.criteria[key].includes(`Normalized endpoint: ${value}`));
}

/** Exercise the same selection contract for both start and end. */
function selectTime(questions, start, end) {
  return {
    scope: answer(questions.scope, 'single'),
    start: answer(questions.start, endpoint(questions.start, start)),
    end: answer(questions.end, endpoint(questions.end, end)),
  };
}

/** Create two reposts and two deliberately separate activities for one calendar. */
function sampleStore(t) {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const plans = ['department', 'university', 'library'].map(id => ({
    id, org: id, department: id, status: 'active', url: `https://${id}.example.edu/calendar`,
  }));
  store.registerPlans(plans);
  const base = {
    start: '2027-05-15T22:00:00Z', end: '2027-05-15T23:30:00Z', timeZone: tz,
    location: 'Gates Hillman Center 4401',
    description: 'Speaker: Mae Rivera\nMae Rivera presents a talk on integrated photonics and silicon waveguide design, showing how low-loss optical interconnects can improve chip-scale computing systems.',
  };
  const rows = [
    [{ title: 'Optical Interconnects Guest Seminar', url: 'https://department.example.edu/events/optical-interconnects' }],
    [
      { title: 'Mae Rivera on Silicon Photonics', url: 'https://university.example.edu/events/silicon-photonics' },
      { title: 'Mae Rivera on Silicon Photonics', url: 'https://university.example.edu/events/silicon-photonics', start: '2027-05-22T22:00:00Z', end: '2027-05-22T23:30:00Z' },
    ],
    [{ title: 'Particle Physics Roundtable', url: 'https://library.example.edu/events/particle-physics', location: 'Gates Hillman Center 4402' }],
  ];
  plans.forEach((plan, index) => store.replaceSource(plan.id, rows[index].map(row => normalizeEvent({ ...base, ...row }, plan))));
  return { store, plans };
}

test('start and end are chosen separately from dated evidence; a deadline cannot become the activity', async () => {
  const ranges = scheduleCandidates(timeInput);
  assert.deepEqual(ranges.map(({ start, end, auxiliary }) => [start, end, auxiliary]), [
    ['2027-05-10T21:00:00.000Z', null, true],
    ['2027-05-15T22:00:00.000Z', '2027-05-15T23:30:00.000Z', false],
  ]);
  const correct = await chooseSchedule(timeInput, (_, __, questions) => selectTime(questions, '2027-05-15T22', '2027-05-15T23:30'));
  assert.equal(correct.end, '2027-05-15T23:30:00.000Z');
  const mixed = await chooseSchedule(timeInput, (_, __, questions) => {
    assert.equal(endpoint(questions.start, '2027-05-10T21'), undefined);
    const selected = selectTime(questions, '2027-05-15T22', '2027-05-15T23:30');
    return { ...selected, start: { ...selected.start, choice: 'c0' } };
  });
  assert.equal(mixed, null);
});

test('explicit date endpoints can cross days and DST; unrelated times cannot be spliced', async () => {
  const overnight = { ...timeInput, texts: ['Starts: November 6, 2027 at 11:00 PM\nEnds: November 7, 2027 at 3:00 AM'] };
  const [range] = scheduleCandidates(overnight);
  assert.equal(range.start, '2027-11-07T03:00:00.000Z');
  assert.equal(range.end, '2027-11-07T08:00:00.000Z');
  assert.deepEqual(scheduleCandidates({ ...overnight, texts: [overnight.texts[0].replace('\n', ' and ')] }),
    [range]);
  const input = { ...timeInput, texts: ['May 15, 2027, 6:00 PM to 7:30 PM and 8:00 PM to 9:30 PM'] };
  assert.equal(await chooseSchedule(input, (_, __, questions) => selectTime(questions, '2027-05-15T22', '2027-05-16T01:30')), null);
  for (const text of ['May 15 at 6:00 PM', 'Sunday, May 15, 2027 at 6:00 PM', 'March 14, 2027 at 2:30 AM',
    'February 30, 2027 at 6:00 PM', 'March 14, 2027 1:30 AM to 2:30 AM', 'November 7, 2027 at 1:30 AM']) {
    assert.deepEqual(scheduleCandidates({ ...timeInput, texts: [text] }), [], text);
  }
  assert.equal(scheduleCandidates({ ...timeInput, texts: ['May 15, 2027 at 08:30'] })[0].precision, 'date');
  assert.equal(scheduleCandidates({ ...timeInput, texts: ['May 15, 2027, 08:30 to 14:00'] })[0].end, '2027-05-15T18:00:00.000Z');
  assert.equal(scheduleCandidates({ ...timeInput, texts: ['November 7, 2027 at 1:30 AM EST'] })[0].start, '2027-11-07T06:30:00.000Z');
  assert.equal(scheduleCandidates({ ...timeInput, texts: ['May 15, 2027, 6 p.m. to 7:30 p.m. UTC'] })[0].end, '2027-05-15T19:30:00.000Z');
  const repeated = { ...timeInput, texts: ['May 15, 2027, 6:00 PM to 7:30 PM\nMay 22, 2027, 6:00 PM to 7:30 PM'] };
  assert.equal(await chooseSchedule(repeated, (_, __, questions) => selectTime(questions, '2027-05-15T22', '2027-05-15T23:30')), null);
});

test('the real media and linked conference fetch entry points apply validated timing', async () => {
  const url = 'https://example.edu/lecture';
  const html = '<main><img src="/poster.png" title="Photonics Guest Lecture"></main>';
  const mediaPlan = { url, options: { automaticMedia: [{ selector: 'img' }] } };
  const assess = input => chooseSchedule(input, (_, __, questions) => selectTime(questions, '2027-05-15T22', '2027-05-15T23:30'));
  const mediaContext = { fetchBytes: async () => Buffer.from('poster'), extractMedia: async () => ({ text: posterText }) };
  const original = await fetchAutomaticMedia(html, mediaPlan, mediaContext);
  assert.equal(original.events.length, 0);
  const poster = await fetchAutomaticMedia(html, mediaPlan, { ...mediaContext, jevSchedule: assess });
  assert.equal(poster.events.length, 1);
  assert.equal(poster.events[0].timePrecision, 'time');
  assert.equal(poster.events[0].end, '2027-05-15T23:30:00.000Z');

  const conferencePlan = { url, options: { layout: 'linked-consistent-details', linkSelector: 'a', detailTitleSelector: 'h1', detailContentSelector: 'main' } };
  const conferenceContext = { fetchText: async value => value === url ? '<a href="/detail">Detail</a>'
    : '<main><h1>Photonics Guest Lecture</h1><p>May 15, 2027, 6:00 PM to 7:30 PM</p></main>' };
  assert.equal((await fetchTextSchedule(conferencePlan, conferenceContext)).events[0].timePrecision, 'date');
  const result = await fetchTextSchedule(conferencePlan, { ...conferenceContext, jevSchedule: assess });
  assert.equal(result.events[0].start, '2027-05-15T22:00:00.000Z');
  assert.equal(result.events[0].end, '2027-05-15T23:30:00.000Z');
  assert.equal(result.coverage.details[0].decision, 'jev-verified-schedule');
});

test('only an independently corroborated compatible occurrence merges, retaining both source versions', async t => {
  const { store, plans } = sampleStore(t);
  assert.equal(store.rebuildEvents(plans), 4);
  const matches = await assessSemanticMatches(store.prepareOccurrences(plans), (_, state, questions) => {
    assert.equal(state.left.start, state.right.start);
    assert.equal(state.left.location, state.right.location);
    return { identity: answer(questions.identity, 'same') };
  });
  assert.equal(matches.size, 1);
  assert.equal(store.rebuildEvents(plans, matches), 3);
  const day = store.listEvents({ from: '2027-05-15', to: '2027-05-15', limit: 10 });
  assert.equal(day.events.length, 2);
  const merged = day.events.find(event => event.mergeEvidence?.reasons.includes('jev-same-occurrence'));
  assert.deepEqual(merged.sources.map(source => source.eventUrl).sort(), [
    'https://department.example.edu/events/optical-interconnects', 'https://university.example.edu/events/silicon-photonics',
  ]);
  assert.equal(merged.sourceVariants.length, 2);
  assert.equal(store.rebuildEvents(plans), 4, 'source snapshots can be rebuilt without Jev');
});

test('missing or rejected API responses fall back and the client bounds actual HTTP calls', async () => {
  const unavailable = createJevClient({ apiKey: 'fixture', fetchImpl: async () => new Response(null, { status: 402 }) });
  assert.equal(await chooseSchedule(timeInput, unavailable.ask), null);
  assert.equal(await chooseSchedule(timeInput, unavailable.ask), null);
  assert.equal(unavailable.stats.time.attempted, 1);
  assert.equal(unavailable.stats.time.skipped, 1);
  const missing = createJevClient({ fetchImpl: () => assert.fail('no network without a key') });
  assert.equal(await chooseSchedule(timeInput, missing.ask), null);
  const malformed = createJevClient({ apiKey: 'fixture', fetchImpl: async () => Response.json({ model: JEV_MODEL, answers: {} }) });
  assert.equal(await chooseSchedule(timeInput, malformed.ask), null);
  assert.equal(await chooseSchedule(timeInput, (_, __, questions) => {
    const result = selectTime(questions, '2027-05-15T22', '2027-05-15T23:30');
    result.start = answer(questions.start, result.start.choice, 0.7);
    return result;
  }), null);
});

test('configured Jev service accepts both request shapes and builds the expected result', {
  skip: process.env.CMUEVENTS_JEV_LIVE !== '1',
}, async t => {
  assert.ok(process.env.TYPESAFE_API_KEY, 'Configure the TYPESAFE_API_KEY environment secret');
  const jev = createJevClient({ apiKey: process.env.TYPESAFE_API_KEY, maxPerKind: 1 });
  const { store, plans } = sampleStore(t);
  const [range, matches] = await Promise.all([
    chooseSchedule({ ...timeInput, texts: ['Photonics Guest Lecture: May 15, 2027, 6:00 PM to 7:30 PM.'] }, jev.ask),
    assessSemanticMatches(store.prepareOccurrences(plans), jev.ask),
  ]);
  console.log(`[jev smoke] ${JSON.stringify(jev.stats)}`);
  assert.equal(range?.start, '2027-05-15T22:00:00.000Z');
  assert.equal(range?.end, '2027-05-15T23:30:00.000Z');
  assert.equal(matches.size, 1);
  assert.equal(store.rebuildEvents(plans, matches), 3);
  const merged = store.listEvents({ from: '2027-05-15', to: '2027-05-15', limit: 10 }).events.find(event => event.sources.length === 2);
  assert.ok(merged?.sourceVariants.length === 2);
});
