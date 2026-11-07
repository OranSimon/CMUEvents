import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAutomaticMedia } from '../src/adapters/automatic-media.mjs';
import { fetchTextSchedule } from '../src/adapters/text-schedules.mjs';
import { parseIcs } from '../src/adapters/ics.mjs';
import { createJevClient, JEV_MODEL } from '../src/lib/jev.mjs';
import { chooseSchedule, scheduleCandidates } from '../src/lib/jev-time.mjs';
import { normalizeEvent } from '../src/lib/normalize.mjs';
import { assessSemanticMatches, occurrenceStorageKey } from '../src/lib/occurrence-merge.mjs';
import { openStore } from '../src/lib/store.mjs';
import { hasPublishedTimeConflict } from '../web/event-semantics.js';

const tz = 'America/New_York';
const posterText = 'Registration closes May 10, 2027 at 5:00 PM\nLecture: May 15, 2027, 6:00 PM to 7:30 PM';
const knownDay = { start: '2027-05-15', end: '2027-05-16' };
const timeInput = { title: 'Photonics Guest Lecture', texts: [posterText], timeZone: tz, known: knownDay };

/** Produce a well-formed fixture response for a selected option. */
function answer(question, option, probability = 1) {
  const keys = Object.keys(question.criteria);
  return { type: 'choice', choice: option, probabilities: Object.fromEntries(keys.map(key => [
    key, key === option ? probability : (1 - probability) / (keys.length - 1),
  ])) };
}

/** Match an entire source time regardless of candidate ordering. */
function selectTime({ schedule }, start, end, probability = 1) {
  const option = Object.keys(schedule.criteria).find(key => schedule.criteria[key].includes(`UTC start ${start}`)
    && schedule.criteria[key].includes(end ? `UTC end ${end}` : 'No end listed'));
  assert.ok(option, 'Both values belong to a single offered candidate');
  return { schedule: answer(schedule, option, probability) };
}

/** Create reposts and deliberately separate activities for one calendar. */
function sampleStore(t, { alternatives = false, mirror = false } = {}) {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const plans = ['department', 'university', 'library', ...(mirror ? ['mirror'] : [])].map(id => ({
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
  if (alternatives) {
    // The real repost retains the abstract. The competing activity shares a speaker and room.
    rows[1][0].description = base.description.split('\n')[1];
    rows[2].push({ title: 'Community Astronomy Discussion', url: 'https://library.example.edu/events/astronomy',
      description: 'Speaker: Mae Rivera\nA roundtable on backyard telescopes and how to observe the moons of Jupiter.' });
  }
  if (mirror) rows.push([{ ...rows[1][0], url: 'https://mirror.example.edu/events/silicon-photonics' }]);
  plans.forEach((plan, index) => store.replaceSource(plan.id, rows[index].map(row => normalizeEvent({ ...base, ...row }, plan))));
  return { store, plans };
}

test('one Jev Choice ranks all matching times, including unclear', async () => {
  const ranges = scheduleCandidates(timeInput);
  assert.deepEqual(ranges.map(({ start, end, auxiliary }) => [start, end, auxiliary]), [
    ['2027-05-10T21:00:00.000Z', null, true],
    ['2027-05-15T22:00:00.000Z', '2027-05-15T23:30:00.000Z', false],
  ]);
  const alternatives = { ...timeInput, texts: [`${posterText}\nMay 15, 2027, 8:00 PM to 9:30 PM\nMay 22, 2027, 10:00 PM`] };
  let assessment;
  const correct = await chooseSchedule(alternatives, (_, __, questions) => {
    assert.deepEqual(Object.keys(questions), ['schedule']);
    const options = Object.values(questions.schedule.criteria);
    assert.equal(options.length, 3);
    assert.ok(options.every(option => !/UTC start 2027-05-(?:10|22)/.test(option)));
    return selectTime(questions, '2027-05-16T00', '2027-05-16T01:30', 0.4);
  }, result => { assessment = result; });
  assert.equal(correct.end, '2027-05-16T01:30:00.000Z');
  assert.equal(assessment.probabilities[assessment.selected], 0.4);
  assert.equal(await chooseSchedule(alternatives, (_, __, { schedule }) => ({
    schedule: answer(schedule, 'unclear', 0.4),
  })), null);
  assert.equal(await chooseSchedule(timeInput, (_, __, { schedule }) => ({
    schedule: answer(schedule, 'c0', 0.5),
  })), null, 'a tie with unclear preserves the untimed event');
  const startOnly = await chooseSchedule({ ...timeInput, texts: ['Lecture starts at 6 PM'] }, (_, __, questions) => {
    return selectTime(questions, '2027-05-15T22', null);
  });
  assert.equal(startOnly.end, null);
  assert.equal(await chooseSchedule({ ...timeInput, texts: ['May 15, 2027'] }, () => assert.fail('no clock candidate to rank')), null);
  for (const heading of ['Time', timeInput.title]) {
    const scheduleRows = `Date\n\nSaturday, May 15, 2027\n\n${heading}\n\n6:00-7:30 PM`;
    const texts = [`Long introduction. ${'Workshop description. '.repeat(200)}\n\n${scheduleRows}`];
    const range = await chooseSchedule({ ...timeInput, texts },
      (_, __, questions) => selectTime(questions, '2027-05-15T22', '2027-05-15T23:30'));
    assert.equal(range.end, '2027-05-15T23:30:00.000Z');
  }
});

test('explicit date endpoints can cross days and DST; unrelated times cannot be spliced', async () => {
  const overnight = { ...timeInput, known: { start: '2027-11-06', end: '2027-11-07' },
    texts: ['Starts: November 6, 2027 at 11:00 PM\nEnds: November 7, 2027 at 3:00 AM'] };
  const [range] = scheduleCandidates(overnight);
  assert.equal(range.start, '2027-11-07T03:00:00.000Z');
  assert.equal(range.end, '2027-11-07T08:00:00.000Z');
  assert.deepEqual(scheduleCandidates({ ...overnight, texts: [overnight.texts[0].replace('\n', ' and ')] }),
    [range]);
  assert.deepEqual(await chooseSchedule(overnight, (_, __, questions) => selectTime(questions, range.start, range.end)), range);
  const input = { ...timeInput, texts: ['May 15, 2027, 6:00 PM to 7:30 PM and 8:00 PM to 9:30 PM'] };
  await chooseSchedule(input, (_, __, { schedule }) => {
    assert.ok(!Object.values(schedule.criteria).some(option => option.includes('UTC start 2027-05-15T22')
      && option.includes('UTC end 2027-05-16T01:30')));
    return { schedule: answer(schedule, 'unclear') };
  });
  for (const text of ['May 15 at 6:00 PM', 'Sunday, May 15, 2027 at 6:00 PM', 'March 14, 2027 at 2:30 AM',
    'February 30, 2027 at 6:00 PM', 'March 14, 2027 1:30 AM to 2:30 AM', 'November 7, 2027 at 1:30 AM']) {
    assert.deepEqual(scheduleCandidates({ ...timeInput, texts: [text] }), [], text);
  }
  assert.equal(scheduleCandidates({ ...timeInput, texts: ['May 15, 2027 at 08:30'] })[0].precision, 'date');
  assert.equal(scheduleCandidates({ ...timeInput, texts: ['May 15, 2027, 08:30 to 14:00'] })[0].end, '2027-05-15T18:00:00.000Z');
  assert.equal(scheduleCandidates({ ...timeInput, texts: ['November 7, 2027 at 1:30 AM EST'] })[0].start, '2027-11-07T06:30:00.000Z');
  assert.equal(scheduleCandidates({ ...timeInput, texts: ['May 15, 2027, 6 p.m. to 7:30 p.m. UTC'] })[0].end, '2027-05-15T19:30:00.000Z');
});

test('a clock conflicting with an all-day feed can be ranked and applied while preserving the original claim', async t => {
  const plan = { id: 'calendar', status: 'active', department: 'Public events', org: 'Public calendar',
    url: 'https://example.edu/calendar', options: { timezone: tz } };
  const feed = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:clock-conflict',
    'DTSTART;VALUE=DATE:20270515', 'SUMMARY:Community competition',
    'DESCRIPTION:Community competition\\, 1:00 p.m.', 'URL:https://example.edu/competition',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const { events } = parseIcs(feed, plan, { now: '2027-05-01T12:00:00Z' });
  assert.equal(events.length, 1);
  const original = events[0];
  assert.equal(original.timePrecision, 'all-day');
  assert.ok(hasPublishedTimeConflict(original));
  const input = { title: original.title, timeZone: original.timeZone, texts: [original.description],
    known: { start: original.start, end: original.end, timePrecision: original.timePrecision } };
  const range = await chooseSchedule(input, (_, state, questions) => {
    assert.equal(state.calendarTimePrecision, 'all-day');
    return selectTime(questions, '2027-05-15T17', null);
  });
  assert.equal(range.start, '2027-05-15T17:00:00.000Z');
  assert.equal(range.end, null);
  assert.equal(await chooseSchedule(input, (_, __, { schedule }) => ({ schedule: answer(schedule, 'unclear') })), null);
  assert.equal(await chooseSchedule(input, () => null), null);
  assert.equal(await chooseSchedule({ ...input, texts: ['Registration closes at 5 PM'] },
    () => assert.fail('a deadline cannot supply an event clock')), null);
  assert.equal(await chooseSchedule({ ...input, texts: ['A full-day exhibition.'] },
    () => assert.fail('a genuine all-day event has no conflicting clock')), null);

  const store = openStore(':memory:');
  t.after(() => store.close());
  store.registerPlans([plan]);
  store.replaceSource(plan.id, events);
  const key = `${plan.id}:${occurrenceStorageKey(original)}`;
  store.rebuildEvents([plan], undefined, new Map([[key, range]]));
  const [resolved] = store.listEvents({ from: '2027-05-15', to: '2027-05-15' }).events;
  assert.equal(resolved.timePrecision, 'time');
  assert.equal(resolved.allDay, false);
  assert.equal(resolved.start, range.start);
  assert.equal(resolved.end, resolved.start, 'an absent end remains unknown');
  assert.equal(resolved.sources[0].eventUrl, original.url);
  assert.equal(resolved.sourceVariants.length, 1);
  assert.equal(resolved.sourceVariants[0].timePrecision, 'all-day');
  assert.equal(resolved.sourceVariants[0].start, original.start);
  assert.equal(store.prepareOccurrences([plan])[0].timePrecision, 'all-day');
  store.rebuildEvents([plan]);
  assert.ok(hasPublishedTimeConflict(store.listEvents({ from: '2027-05-15', to: '2027-05-15' }).events[0]));

  const copy = { ...plan, id: 'copy', org: 'Other calendar', url: 'https://other.example.edu/calendar' };
  const plans = [plan, copy];
  store.registerPlans(plans);
  store.replaceSource(copy.id, events);
  const choices = new Map([[key, range]]);
  store.rebuildEvents(plans, undefined, choices);
  assert.ok(hasPublishedTimeConflict(store.listEvents({ from: '2027-05-15', to: '2027-05-15' }).events[0]),
    'every conflicting all-day copy needs an accepted assessment');
  choices.set(`${copy.id}:${occurrenceStorageKey(original)}`, range);
  assert.equal(store.rebuildEvents(plans, undefined, choices), 1);
  const [joined] = store.listEvents({ from: '2027-05-15', to: '2027-05-15' }).events;
  assert.equal(joined.timePrecision, 'time');
  assert.deepEqual(new Set(joined.sources.map(source => source.id)), new Set([plan.id, copy.id]));
  choices.set(`${copy.id}:${occurrenceStorageKey(original)}`, { ...range, start: '2027-05-15T18:00:00.000Z' });
  store.rebuildEvents(plans, undefined, choices);
  assert.ok(hasPublishedTimeConflict(store.listEvents({ from: '2027-05-15', to: '2027-05-15' }).events[0]));

  const realAllDay = { ...original, description: 'A full-day exhibition.' };
  store.replaceSource(plan.id, [realAllDay]);
  store.rebuildEvents([plan], undefined, new Map([[key, range]]));
  assert.equal(store.listEvents({ from: '2027-05-15', to: '2027-05-15' }).events[0].timePrecision, 'all-day');
});

test('media and conference evidence supplies a calendar time without rewriting the source snapshot', async t => {
  const url = 'https://example.edu/lecture';
  const html = '<main><img src="/poster.png" title="Photonics Guest Lecture"></main>';
  const basePlan = { url, status: 'active', org: 'Fixture', department: 'Fixture' };
  const mediaPlan = { ...basePlan, id: 'media', options: { automaticMedia: [{ selector: 'img' }] } };
  const evidence = new Map();
  const recordScheduleEvidence = (id, event, texts) => evidence.set(`${id}:${occurrenceStorageKey(event)}`, texts);
  const mediaContext = { fetchBytes: async () => Buffer.from('poster'),
    extractMedia: async () => ({ text: 'May 15, 2027, 6:00 PM to 7:30 PM' }), recordScheduleEvidence };
  const poster = await fetchAutomaticMedia(html, mediaPlan, mediaContext);
  const conferencePlan = { ...basePlan, id: 'conference',
    options: { layout: 'linked-consistent-details', linkSelector: 'a', detailTitleSelector: 'h1', detailContentSelector: 'main' } };
  const conferenceContext = { fetchText: async value => value === url ? '<a href="/detail">Detail</a>'
    : '<main><h1>Photonics Guest Lecture</h1><p>May 15, 2027, 6:00 PM to 7:30 PM</p></main>', recordScheduleEvidence };
  const conference = await fetchTextSchedule(conferencePlan, conferenceContext);
  const store = openStore(':memory:');
  t.after(() => store.close());
  const plans = [mediaPlan, conferencePlan];
  store.registerPlans(plans);
  store.replaceSource('media', poster.events);
  store.replaceSource('conference', conference.events);
  const selectedTimes = new Map();
  for (const event of store.prepareOccurrences(plans)) {
    assert.equal(event.timePrecision, 'date');
    const key = `${event.sources[0].id}:${occurrenceStorageKey(event)}`;
    const range = await chooseSchedule({ ...timeInput, texts: evidence.get(key) },
      (_, __, questions) => selectTime(questions, '2027-05-15T22', '2027-05-15T23:30'));
    assert.ok(range);
    selectedTimes.set(key, range);
  }
  assert.equal(selectedTimes.size, 2);
  store.rebuildEvents(plans, undefined, selectedTimes);
  const result = store.listEvents({ from: knownDay.start, to: knownDay.start }).events;
  assert.ok(result.length > 0 && result.every(event => event.timePrecision === 'time' && event.end === '2027-05-15T23:30:00.000Z'));
  store.rebuildEvents(plans);
  assert.ok(store.prepareOccurrences(plans).every(event => event.timePrecision === 'date'));

  // A repost without a clock still belongs to the same calendar card.
  const [original] = poster.events;
  store.replaceSource('conference', [original]);
  assert.equal(store.rebuildEvents(plans, undefined, selectedTimes), 1);
  const [merged] = store.listEvents({ from: knownDay.start, to: knownDay.start }).events;
  assert.equal(merged.timePrecision, 'time');
  assert.deepEqual(new Set(merged.sources.map(source => source.id)), new Set(['conference', 'media']));
  assert.equal(merged.sourceVariants[0].timePrecision, 'date');
});

test('only an independently corroborated compatible occurrence merges, retaining both source versions', async t => {
  const { store, plans } = sampleStore(t);
  assert.equal(store.rebuildEvents(plans), 4);
  const matches = await assessSemanticMatches(store.prepareOccurrences(plans), (_, state, questions) => {
    assert.equal(state.anchor.start, state.candidates.c0.start);
    assert.equal(state.anchor.location, state.candidates.c0.location);
    return { identity: answer(questions.identity, 'c0') };
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

test('one Jev Choice ranks every screened occurrence and keeps all copies of the winning candidate', async t => {
  const { store, plans } = sampleStore(t, { alternatives: true, mirror: true });
  const rows = store.prepareOccurrences(plans);
  const choose = (scores, selected) => async (_, state, { identity }) => {
    assert.equal(state.anchor.title, 'Optical Interconnects Guest Seminar');
    assert.deepEqual(Object.keys(identity.criteria), ['c0', 'c1', 'unclear']);
    assert.deepEqual(Object.values(state.candidates).map(candidate => candidate.title).sort(),
      ['Community Astronomy Discussion', 'Mae Rivera on Silicon Photonics']);
    const real = Object.keys(state.candidates).find(id => state.candidates[id].title.includes('Photonics'));
    const other = real === 'c0' ? 'c1' : 'c0';
    return { identity: { type: 'choice', choice: { real, other, unclear: 'unclear' }[selected],
      probabilities: { [real]: scores[0], [other]: scores[1], unclear: scores[2] } } };
  };
  const assessments = [];
  const matches = await assessSemanticMatches(rows, choose([0.4, 0.35, 0.25], 'real'),
    { onAssessment: assessment => assessments.push(assessment) });
  assert.equal(assessments.length, 1);
  assert.equal(assessments[0].probabilities[assessments[0].selected], 0.4);
  assert.equal(matches.size, 2);
  assert.equal(store.rebuildEvents(plans, matches), 4);
  const { events } = store.listEvents({ from: '2027-05-15', to: '2027-05-22', limit: 10 });
  const merged = events.find(event => event.mergeEvidence?.reasons.includes('jev-same-occurrence'));
  assert.deepEqual(merged.sources.map(source => source.id).sort(), ['department', 'mirror', 'university']);
  assert.equal(merged.sources.length, new Set(merged.sources.map(source => source.eventUrl)).size);
  assert.ok(events.some(event => event.title === 'Community Astronomy Discussion'));
  assert.ok(events.some(event => event.start === '2027-05-22T22:00:00.000Z' && event.sources.length === 1));
  assert.equal((await assessSemanticMatches(rows, choose([0.3, 0.25, 0.45], 'unclear'))).size, 0);
  assert.equal((await assessSemanticMatches(rows, choose([0.45, 0.45, 0.1], 'real'))).size, 0);
  assert.equal((await assessSemanticMatches(rows, choose([0.4, 0.5, 0.1], 'real'))).size, 0);
});

test('competing rankings cannot attach a losing candidate through a different anchor', async t => {
  const { store, plans } = sampleStore(t, { alternatives: true });
  const rows = store.prepareOccurrences(plans);
  const repost = rows.find(event => event.title === 'Mae Rivera on Silicon Photonics');
  repost.description = `Speaker: Mae Rivera\n${repost.description}`;
  const titles = ['Optical Interconnects Guest Seminar', 'Mae Rivera on Silicon Photonics', 'Community Astronomy Discussion'];
  const rank = (picks) => (_, { anchor, candidates }, { identity }) => {
    assert.equal(Object.keys(candidates).length, 2);
    const choice = Object.keys(candidates).find(id => candidates[id].title === picks[titles.indexOf(anchor.title)]);
    return { identity: answer(identity, choice) };
  };
  const compatible = await assessSemanticMatches(rows, rank([titles[1], titles[0], titles[0]]));
  assert.equal(compatible.size, 1);
  assert.equal(store.rebuildEvents(plans, compatible), 4);
  const { events } = store.listEvents({ from: '2027-05-15', to: '2027-05-15', limit: 10 });
  assert.deepEqual(events.find(event => event.sources.length === 2).sources.map(source => source.id).sort(),
    ['department', 'university']);
  const conflict = await assessSemanticMatches(rows, rank([titles[1], titles[2], titles[0]]));
  assert.equal(conflict.size, 0);
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
  assert.equal(await chooseSchedule(timeInput, (_, __, { schedule }) => ({
    schedule: answer(schedule, 'c0', 0.4),
  })), null, 'the selected label must match the score ordering');
});

test('configured Jev service returns typed responses for both decision paths', {
  skip: process.env.CMUEVENTS_JEV_LIVE !== '1',
}, async t => {
  assert.ok(process.env.TYPESAFE_API_KEY, 'Configure the TYPESAFE_API_KEY environment secret');
  const jev = createJevClient({ apiKey: process.env.TYPESAFE_API_KEY, maxPerKind: 1 });
  const { store, plans } = sampleStore(t, { alternatives: true });
  let timeAssessment, identity, candidateIds;
  const [range, matches] = await Promise.all([
    chooseSchedule(timeInput, jev.ask, assessment => { timeAssessment = assessment; }),
    assessSemanticMatches(store.prepareOccurrences(plans), async (kind, state, questions) => {
      const reply = await jev.ask(kind, state, questions);
      identity = reply?.identity;
      candidateIds = Object.keys(state.candidates);
      return reply;
    }),
  ]);
  console.log(`[jev smoke] ${JSON.stringify({ ...jev.stats, timeAssessment, identity, candidateIds, mergeAccepted: matches.size })}`);
  assert.equal(jev.stats.time.succeeded, 1);
  assert.equal(jev.stats.merge.succeeded, 1);
  assert.ok(Number.isFinite(timeAssessment?.probabilities?.[timeAssessment.selected]));
  assert.equal(identity?.type, 'choice');
  assert.equal(candidateIds.length, 2);
  assert.ok([...candidateIds, 'unclear'].every(id => Number.isFinite(identity.probabilities?.[id])));
  if (range) {
    assert.equal(range.start, '2027-05-15T22:00:00.000Z');
    assert.equal(range.end, '2027-05-15T23:30:00.000Z');
  }
  assert.equal(store.rebuildEvents(plans, matches), 5 - matches.size);
  if (matches.size) {
    const merged = store.listEvents({ from: '2027-05-15', to: '2027-05-15', limit: 10 }).events.find(event => event.sources.length === 2);
    assert.deepEqual(merged?.sources.map(source => source.id).sort(), ['department', 'university']);
    assert.equal(merged.sourceVariants.length, 2);
  }
});
