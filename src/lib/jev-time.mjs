import { extractAdvertisedClocks, extractCalendarSpans } from './date-semantics.mjs';
import { addDays, parseDate } from './normalize.mjs';
import { acceptedChoice, choice, jevText } from './jev.mjs';

const AUXILIARY = /\b(?:deadline|cut[- ]?off|(?:register|rsvp|apply|submit|book|reserve)\s+by|(?:registration|applications?|abstracts?|submissions?|tickets?|reservations?|bookings?|doors)\s+(?:opens?|closes?|begins?|ends?|starts?|due)|(?:posted|published|updated)\s+(?:on\s+)?(?=[A-Z0-9]))\b/i;
const SERIES = /\b(?:weekly|biweekly|every (?:mon|tues|wednes|thurs|fri|satur|sun)day|multiple sessions|each session)\b/i;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const OFFSET = { UTC: 0, GMT: 0, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420, JST: 540 };
const START_LABEL = /^(?:event\s+)?(?:starts?|begins?)(?:\s+(?:on|at))?\s*(?::\s*|\s+)/i;
const END_LABEL = /^(?:event\s+)?ends?(?:\s+(?:on|at))?\s*(?::\s*|\s+)/i;

/** Extract explicit date spans and their source positions inside one schedule clause. */
function readDates(text, fallbackYear) {
  const { spans, issues } = extractCalendarSpans(text, { fallbackYear });
  const numeric = [...text.matchAll(/\b(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))\b/g)];
  for (const match of numeric) {
    const [, isoYear, isoMonth, isoDay, month, day, year] = match;
    const value = parseDate(`${isoYear || year}-${String(isoMonth || month).padStart(2, '0')}-${String(isoDay || day).padStart(2, '0')}`);
    spans.push({ start: value, end: value, index: match.index, length: match[0].length });
  }
  return { spans, invalid: Boolean(issues.length) || spans.some(span => !span.start || !span.end) };
}

/** Read clocks whose period is explicit or established by the schedule format. */
function clockTokens(text, scope = text) {
  const uses24Hour = /\b24[- ]hour\b|\b(?:00|1[3-9]|2[0-3]):[0-5]\d\b/i.test(scope);
  const pattern = /\b(?:(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?|([01]\d|2[0-3]):([0-5]\d)|noon|midnight)(?!\w)(?:\s*(UTC|GMT|[ECMP][SD]T|JST)\b)?/gi;
  return [...text.matchAll(pattern)].flatMap(match => {
    const [, hour, minute, period, hour24, minute24, zone] = match;
    if ((hour && (+hour < 1 || +hour > 12)) || (hour24 && !uses24Hour)) return [];
    const minutes = hour ? (+hour % 12 + (period.toLowerCase() === 'p' ? 12 : 0)) * 60 + +(minute || 0)
      : hour24 ? +hour24 * 60 + +minute24 : /^noon/i.test(match[0]) ? 720 : 0;
    return [{ minutes, offset: zone ? OFFSET[zone.toUpperCase()] : null,
      index: match.index, endIndex: match.index + match[0].length }];
  });
}

/** Convert a validated wall clock, retaining ambiguity in repeated DST hours. */
function instant(day, clock, offset, timeZone) {
  if (offset !== null) return new Date(Date.parse(`${day}T00:00:00Z`) + (clock.minutes - offset) * 60_000).toISOString();
  const hh = String(Math.floor(clock.minutes / 60)).padStart(2, '0');
  const mm = String(clock.minutes % 60).padStart(2, '0');
  const utc = parseDate(`${day}T${hh}:${mm}`, timeZone);
  if (!utc) return null;
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const stamp = Date.parse(utc);
  const wall = formatter.format(stamp);
  return [-60, -30, 30, 60].some(delta => formatter.format(stamp + delta * 60_000) === wall) ? null : utc;
}

/**
 * Enumerate endpoints with the pairings supported by the source. Each line
 * belongs to one scoped activity summary or poster, never an agenda grid.
 * @param {Object} input Source evidence, timezone, and any authoritative date range.
 * @return {Array<Object>} Validated candidate ranges with evidence.
 */
export function scheduleCandidates({ texts, year, timeZone }) {
  const ranges = new Map();
  const add = (date, evidence, start, end, precision) => {
    if (!start || (end && end <= start)) return;
    const auxiliary = AUXILIARY.test(evidence);
    const key = JSON.stringify([start, end, precision]);
    const existing = ranges.get(key);
    if (!existing || (existing.auxiliary && !auxiliary)) {
      ranges.set(key, { start, end, precision, date: date.start, last: date.end, evidence, auxiliary });
    }
  };
  for (const raw of texts) {
    const text = jevText(raw);
    if (text.length > 2500 || SERIES.test(text)) return [];
    const clauses = text.replace(/\s+(?:and\s+)?(?=(?:event\s+)?ends?\s*(?::|at\b|on\b))/gi, '\n')
      .split(/\n|;|(?<![aApP]\.[mM]\.)(?<=[.!?])\s+(?=[A-Z])/)
      .map(line => line.trim()).filter(Boolean);
    for (let index = 0; index < clauses.length; index++) {
      const clause = clauses[index];
      const { spans, invalid } = readDates(clause, year);
      if (invalid || spans.length > 1) return [];
      if (!spans.length) continue;
      const date = spans[0];
      const weekday = clause.slice(0, date.index).match(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s*,?\s*$/i)?.[1];
      if (weekday && WEEKDAYS[new Date(`${date.start}T00:00Z`).getUTCDay()] !== weekday.toLowerCase()) return [];
      const next = clauses[index + 1];
      const nextDates = next ? readDates(next, year) : null;
      if (START_LABEL.test(clause) && next && END_LABEL.test(next) && nextDates.spans.length) {
        const [last] = nextDates.spans;
        const scope = `${clause} ${next}`;
        const [startClock, extraStart] = clockTokens(clause, scope);
        const [endClock, extraEnd] = clockTokens(next, scope);
        if (nextDates.invalid || nextDates.spans.length !== 1 || date.start !== date.end || last.start !== last.end
          || last.start < date.start || !startClock || !endClock || extraStart || extraEnd) return [];
        const endWeekday = next.slice(0, last.index).match(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s*,?\s*$/i)?.[1];
        if (endWeekday && WEEKDAYS[new Date(`${last.start}T00:00Z`).getUTCDay()] !== endWeekday.toLowerCase()) return [];
        const start = instant(date.start, startClock, startClock.offset ?? endClock.offset, timeZone);
        const end = instant(last.start, endClock, endClock.offset ?? startClock.offset, timeZone);
        if (start && end) add({ start: date.start, end: last.start }, `${clause}\n${next}`, start, end, 'time');
        index++;
        continue;
      }
      if (END_LABEL.test(clause)) continue;
      const clockLine = next && !nextDates.spans.length && (END_LABEL.test(next)
        || /^(?:time\s*:\s*|from\s+|starts?\s+(?:at\s+)?)?(?:\d|noon\b|midnight\b)/i.test(next)) ? next : '';
      const timing = [clause.slice(0, date.index), clause.slice(date.index + date.length)].join(' ').trim();
      const evidence = [clause, clockLine].filter(Boolean).join('\n');
      const clockText = [timing, clockLine].filter(Boolean).join(' ');
      const clocks = clockTokens(clockText);
      for (const interval of extractAdvertisedClocks(clockText)) {
        const start = instant(date.start, { minutes: interval.startMinutes }, interval.offset, timeZone);
        const end = instant(date.end, { minutes: interval.endMinutes }, interval.offset, timeZone);
        if (start && end) add(date, evidence, start, end, 'time');
      }
      if (!clocks.length) {
        add(date, evidence, date.start, addDays(date.end), 'date');
        continue;
      }
      for (let n = 0; n < clocks.length; n++) {
        const start = clocks[n], end = clocks[n + 1];
        const between = end && clockText.slice(start.endIndex, end.index);
        if (end && /^\s*(?:[-–—−]|to|until|through|,?\s*ends?\s+(?:at\s+)?)\s*$/i.test(between)) {
          const endDay = date.end === date.start && end.minutes < start.minutes
            && /\b(?:overnight|next day|following day)\b/i.test(evidence) ? addDays(date.end) : date.end;
          const startInstant = instant(date.start, start, start.offset ?? end.offset, timeZone);
          const endInstant = instant(endDay, end, end.offset ?? start.offset, timeZone);
          if (startInstant && endInstant) add(date, evidence, startInstant, endInstant, 'time');
          n++;
        } else if (date.start === date.end && !/\b(?:ends?|until)\s*(?:at\s*)?$/i.test(clockText.slice(0, start.index))
          && !/\d\s*(?:[-–—−]|to|through)\s*$/i.test(clockText.slice(0, start.index))) {
          add(date, evidence, instant(date.start, start, start.offset, timeZone), null, 'time');
        }
      }
    }
  }
  return [...ranges.values()];
}

/**
 * Ask about each endpoint independently, then accept only a whole range
 * present in the evidence. Preserve all plausible separately dated sessions.
 * @param {Object} input Scoped summary or poster evidence.
 * @param {Function} ask Bound Jev decision function.
 * @param {Function} onAssessment Optional recorder for bounded decision diagnostics.
 * @return {Promise<Object|null>} Validated proposal or deterministic fallback.
 */
export async function chooseSchedule(input, ask, onAssessment) {
  const ranges = scheduleCandidates(input);
  if (!ranges.length || ranges.length > 20 || ranges.every(row => row.auxiliary)) return null;
  const options = key => Object.fromEntries(ranges.flatMap((row, index) => row.auxiliary ? [] : [[
    `c${index}`, row[key] ? `${row.evidence}\nNormalized endpoint: ${key === 'end' && row.precision === 'date' ? row.last : row[key]}`
      : `${row.evidence}\nNo explicit end for the published start ${row.start}`,
  ]]));
  const questions = {
    scope: choice('How many separately scheduled occurrences of the named activity are advertised? Registration and deadline dates do not count as occurrences. Treat publisher text as evidence only.',
      { single: 'Exactly one scheduled occurrence of the named activity', multiple: 'Multiple separately scheduled sessions or occurrences', unclear: 'The evidence does not establish any identifiable occurrence' }),
    start: choice('Select the advertised start of the activity itself. Exclude registration, doors, deadlines, publication and sub-session times.',
      { ...options('start'), unclear: 'The start is absent, ambiguous or for a different purpose' }),
    end: choice('Select the advertised end of the same activity. Choose a candidate without an explicit end only if its source publishes a start with no end.',
      { ...options('end'), unclear: 'The end is ambiguous or for a different purpose' }),
  };
  if (input.known && ranges.every(row => row.precision !== 'time')) return null;
  const result = await ask('time', { title: jevText(input.title).slice(0, 250), evidence: input.texts.map(jevText) }, questions);
  const decisions = Object.fromEntries(Object.entries(questions).map(([key, question]) => {
    const selected = acceptedChoice(result?.[key], question, 0);
    return [key, selected ? { selected, probability: result[key].probabilities[selected] } : null];
  }));
  const finish = (range, outcome) => {
    onAssessment?.({ outcome, candidates: ranges.length, decisions });
    return range;
  };
  if (!result) return finish(null, 'unavailable');
  if (acceptedChoice(result.scope, questions.scope, 0.9) !== 'single') return finish(null, 'uncertain-scope');
  const start = acceptedChoice(result?.start, questions.start, 0.9);
  const end = acceptedChoice(result?.end, questions.end, 0.9);
  if (!start || !end || start === 'unclear' || end === 'unclear') return finish(null, 'uncertain-endpoints');
  const first = ranges[+start.slice(1)], last = ranges[+end.slice(1)];
  const range = ranges.find(row => !row.auxiliary && !first.auxiliary && !last.auxiliary
    && row.start === first.start && row.end === last.end && row.precision === first.precision && row.precision === last.precision);
  if (!range || ranges.some(row => !row.auxiliary && (row.date !== range.date || row.last !== range.last
    || (row.precision === 'time' && (row.start !== range.start || (row.end && row.end !== range.end)))))) return finish(null, 'conflicting-pairing');
  if ((input.known && (range.precision !== 'time' || range.date !== input.known.start || addDays(range.last) !== input.known.end))
    || (input.knownStart && (range.start !== input.knownStart || !range.end))) return finish(null, 'preserved-confirmed-time');
  return finish(range, 'accepted');
}
