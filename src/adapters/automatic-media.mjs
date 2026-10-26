import * as cheerio from 'cheerio';
import { absoluteUrl, normalizeEvent, inWindow, addDays, parseDate, plainText } from '../lib/normalize.mjs';
import { extractMedia, ocrLines } from '../lib/media-ocr.mjs';

const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_PATTERN = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Read a single explicit year; multiple distinct years are ambiguous.
 * @param {string} text Publisher heading or visible media text.
 * @return {number|null} Unambiguous printed year.
 */
function printedYear(text) {
  const years = [...new Set(String(text).match(/\b20\d{2}\b/g) || [])];
  return years.length === 1 ? +years[0] : null;
}

/**
 * Validate a calendar date without Date's overflow normalization.
 * @param {number} year Explicit printed year.
 * @param {number} month Calendar month.
 * @param {number} day Calendar day.
 * @return {string|null} ISO date-only value.
 */
function checkedDay(year, month, day) {
  if (!year || !month || !day) return null;
  return parseDate(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
}

/**
 * Extract full visible dates and verify any printed weekday and heading year.
 * @param {string} text Visible page or OCR text, preserving line boundaries.
 * @param {Object} grounding Fresh HTML year heading and context-year policy.
 * @return {Object} Date candidates and validation warnings.
 */
export function mediaDates(text, grounding = {}) {
  const dates = new Map();
  const warnings = [];
  const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/[–—−]/g, '-').replace(/([A-Za-z])(?=\d)/g, '$1 ')
      .replace(new RegExp(`\\b(${MONTH_PATTERN})[‘’'](\\d{1,2})(?=,?\\s+20\\d{2}\\b)`, 'gi'), '$1 $2');
    const english = new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*-\\s*(\\d{1,2})(?:st|nd|rd|th)?)?(?:\\s*,?\\s+(20\\d{2}))?\\b`, 'gi');
    const numeric = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g;
    const candidates = [
      ...[...line.matchAll(english)].map(match => ({ year: match[4] ? +match[4] : null, month: MONTH[match[1].slice(0, 3).toLowerCase()], day: +match[2], last: +(match[3] || match[2]), raw: match[0] })),
      ...[...line.matchAll(numeric)].map(match => ({ year: +match[3], month: +match[1], day: +match[2], last: +match[2], raw: match[0] })),
    ];
    for (const candidate of candidates) {
      const year = candidate.year || (grounding.allowContextYear ? grounding.year : null);
      if (!year) { warnings.push(`No explicit year for media date: ${candidate.raw}`); continue; }
      if (candidate.year && grounding.year && candidate.year !== grounding.year) { warnings.push('Media date conflicts with its current publisher year heading'); continue; }
      const start = checkedDay(year, candidate.month, candidate.day);
      const last = checkedDay(year, candidate.month, candidate.last);
      if (!start || !last || last < start) { warnings.push(`Invalid media date: ${candidate.raw}`); continue; }
      const weekdayText = line.match(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i)?.[0]
        || (/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?$/i.test(lines[i - 1] || '') ? lines[i - 1].replace(',', '') : null);
      if (weekdayText && WEEKDAYS[new Date(`${start}T00:00:00Z`).getUTCDay()] !== weekdayText.toLowerCase()) { warnings.push(`Printed weekday conflicts with media date: ${candidate.raw}`); continue; }
      dates.set(`${start}|${last}`, { start, end: addDays(last), line: lines[i], weekday: weekdayText || null });
    }
  }
  return { dates: [...dates.values()], warnings };
}

/**
 * Interpret an explicit 12-hour clock token without guessing AM versus PM.
 * @param {string} hour Source hour.
 * @param {string} minute Source minute.
 * @param {string} period Source AM/PM marker.
 * @return {string|null} ISO local clock.
 */
function clock(hour, minute, period) {
  const h = +hour; const m = +(minute || 0);
  if (h < 1 || h > 12 || m > 59 || !period) return null;
  return `${String(h % 12 + (/p/i.test(period) ? 12 : 0)).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * Parse one written clock range, preserving ambiguous or missing clocks.
 * @param {string} text Visible date/footer text.
 * @return {Object|null} Explicit local clock range, or null.
 */
export function mediaClock(text) {
  const clean = String(text).replace(/[–—−]/g, '-').replace(/\b([ap])\.\s*m\.?/gi, '$1m')
    .replace(/\bnoon\b/gi, '12pm').replace(/\bmidnight\b/gi, '12am');
  const range = clean.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (range) {
    let start = clock(range[1], range[2], range[3] || range[6]);
    const end = clock(range[4], range[5], range[6]);
    // Shared suffixes use the same period when forward. Across noon, the only
    // forward same-day reading under twelve hours supplies the omitted AM.
    if (!range[3] && start && end && end <= start) {
      const alternate = clock(range[1], range[2], /^p/i.test(range[6]) ? 'am' : 'pm');
      if (alternate && end > alternate && (+end.slice(0, 2) * 60 + +end.slice(3, 5)) - (+alternate.slice(0, 2) * 60 + +alternate.slice(3, 5)) < 12 * 60) start = alternate;
    }
    return start && end && end > start ? { start, end } : { ambiguous: true };
  }
  const singles = [...clean.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi)];
  return singles.length === 1 ? { start: clock(singles[0][1], singles[0][2], singles[0][3]) } : null;
}

/**
 * Obtain a short title from live HTML or readable media heading text.
 * @param {Object} raw Extracted media text and positioned variants.
 * @param {Object} grounding Current HTML title and publisher series label.
 * @return {string} A source-derived title, or empty when none is reliable.
 */
function mediaTitle(raw, grounding) {
  if (grounding.title) return grounding.title;
  const variants = raw.variants || [];
  const lines = variants.flatMap(variant => ocrLines(variant.words));
  const speaker = lines.find(line => /(?:Assistant Professor|Associate Professor|Endowed Professor)/i.test(line.text)
    && line.confidence >= 70 && !/University,? Department|Sponsored/i.test(line.text)
    && /^(?:Dr\.\s+)?[A-Z][\p{L}'’.-]+\s+[A-Z][\p{L}'’.-]+/u.test(line.text));
  if (grounding.seriesTitle && speaker) {
    const name = speaker.text.split(/,|\b(?:Assistant|Associate|The Frank|Professor|Department)\b/i)[0].trim();
    if (/^(?:Dr\.\s+)?[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){1,3}$/u.test(name)) return `${grounding.seriesTitle} — ${name}`;
  }
  if (grounding.seriesTitle) return grounding.seriesTitle;
  const excluded = /sponsor|institute|presents|\b(?:am|pm)\b|\b20\d{2}\b|copyright|join us|register|https?:|www\.|^[^A-Za-z]|^University$/i;
  const headings = lines.filter(line => line.text.length >= 10 && line.text.length <= 150 && line.confidence >= 70 && !excluded.test(line.text));
  const heading = headings
    .sort((a, b) => b.height - a.height)[0];
  if (heading) {
    const following = headings.find(line => line.text !== heading.text && line.top >= heading.bottom && line.top - heading.bottom < heading.height * .7
      && line.height >= heading.height * .8 && Math.abs(line.left - heading.left) < heading.height);
    return `${heading.text}${following ? ` ${following.text}` : ''}`;
  }
  return (raw.text || '').split(/\r?\n/).map(line => line.trim()).find(line => line.length >= 10 && line.length <= 160 && !excluded.test(line)) || '';
}

/**
 * Find a printed room/location line without reading addresses from filenames.
 * @param {string} text Visible media text.
 * @return {string} Publisher location, or empty.
 */
function mediaLocation(text) {
  const location = String(text).split(/\r?\n/).map(line => line.trim())
    .find(line => /(?:\bLocation\s*:|\b(?:Hall|Room|Auditorium)\b|\bNSH\s*\d{3,4}\b)/i.test(line) && line.length < 160)
    ?.replace(/^.*?\bLocation\s*:\s*/i, '').replace(/^.*?FRIDAYS?\s*[-–:]\s*/i, '') || '';
  return location.replace(/^.*?\bat\s+([^,]+(?:Hall|Room|Auditorium)[^,]*),?\s*(?:at\s+)?\d.*$/i, '$1');
}

/**
 * Parse one event poster or first-page PDF using explicit current media dates.
 * @param {Object} raw Raw PDF/OCR variants, without approved event fields.
 * @param {Object} grounding Live HTML heading, title and series context.
 * @param {Object} plan Source normalization options.
 * @param {Object} context Collection window.
 * @return {Object} Validated events, recognized count and partial diagnostics.
 */
export function parseMediaPoster(raw, grounding, plan, context = {}) {
  const events = []; const warnings = [];
  const inputs = [{ text: grounding.alt || '', trusted: true }, { text: raw.text || '', trusted: true },
    ...(raw.variants || []).map(variant => ({ text: variant.text, variant }))].filter(input => input.text);
  const texts = inputs.map(input => input.text);
  const candidates = new Map();
  const findings = texts.map(text => mediaDates(text, grounding));
  for (let i = 0; i < findings.length; i++) {
    const found = findings[i];
    warnings.push(...found.warnings);
    for (const date of found.dates) {
      const key = `${date.start}|${date.end}`;
      if (!candidates.has(key)) candidates.set(key, { ...date, texts: [], proof: [] });
      candidates.get(key).texts.push(texts[i]);
      candidates.get(key).proof.push(inputs[i]);
    }
  }
  if (warnings.some(warning => /conflict|Invalid/.test(warning))) return { events, warnings: [...new Set(warnings)], partial: true, recognized: 0 };
  if (candidates.size !== 1) return { events, warnings: [...new Set([...warnings, candidates.size ? 'Multiple media occurrence dates require a clearer event layout' : 'No complete, unambiguous visible media occurrence date'])], partial: true, recognized: 0 };
  const date = [...candidates.values()][0];
  const reliable = date.proof.some(input => input.trusted || ocrLines(input.variant.words).some(line => {
    if (line.text !== date.line) return false;
    const critical = line.words.filter(word => /\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/i.test(word.text));
    return critical.length >= 2 && critical.every(word => word.confidence >= 75);
  }));
  if (!reliable && date.proof.length < 2) return { events, warnings: ['Media occurrence date has insufficient OCR confidence or agreement'], partial: true, recognized: 0 };
  const title = mediaTitle(raw, grounding);
  if (!title) return { events, warnings: ['Media occurrence has no reliable title'], partial: true, recognized: 0 };
  const clocks = new Map();
  const reliableClocks = new Set();
  for (const input of date.proof) {
    const value = mediaClock(input.text);
    if (value?.ambiguous) warnings.push('Media clock range is ambiguous; date-only precision retained');
    else if (value?.start) {
      const key = `${value.start}|${value.end || ''}`;
      clocks.set(key, value);
      if (input.trusted || ocrLines(input.variant.words).some(line => {
        const lineClock = mediaClock(line.text);
        const critical = line.words.filter(word => /\d/.test(word.text));
        return lineClock?.start === value.start && lineClock?.end === value.end && critical.length > 0 && critical.every(word => word.confidence >= 65);
      })) reliableClocks.add(key);
    }
  }
  if (clocks.size > 1) warnings.push('OCR clock variants disagree; date-only precision retained');
  if (clocks.size && !reliableClocks.size) warnings.push('Media clock has insufficient OCR confidence; date-only precision retained');
  const timing = clocks.size === 1 && reliableClocks.size ? [...clocks.values()][0] : null;
  const text = [...new Set(date.texts)].sort((a, b) => b.length - a.length)[0];
  const event = normalizeEvent({ title, start: timing ? `${date.start}T${timing.start}` : date.start,
    end: timing?.end ? `${date.start}T${timing.end}` : timing ? undefined : date.end,
    location: mediaLocation(text), url: grounding.url || plan.url,
    description: `Automatically extracted from the publisher's current public media.\n${text}` }, plan);
  if (!event) return { events, warnings: ['Extracted media fields failed event validation'], partial: true, recognized: 0 };
  if (inWindow(event, context)) events.push(event);
  return { events, warnings: [...new Set(warnings)], recognized: 1, partial: false };
}

/**
 * Read a semester schedule's date column and corresponding geometric row bands.
 * Dates require a fresh printed year and agreement across OCR variants; printed
 * weekday and clock labels are validated rather than expanded into recurrence.
 * @param {Object} raw Positioned OCR from the current advertised schedule.
 * @param {Object} grounding Current semester heading and series title.
 * @param {Object} plan Source normalization options.
 * @param {Object} context Collection window.
 * @return {Object} Explicit schedule rows and partial diagnostics.
 */
export function parseMediaTable(raw, grounding, plan, context = {}) {
  const events = []; const warnings = []; const notices = [];
  if (!grounding.year) return { events, warnings: ['Media schedule requires an unambiguous current publisher year heading'], recognized: 0, partial: true };
  const variants = (raw.variants || []).map(variant => ({ ...variant, lines: ocrLines(variant.words) }));
  const printedYears = new Set(variants.flatMap(variant => variant.text.match(/\b20\d{2}\b/g) || []).map(Number));
  if ([...printedYears].some(year => year !== grounding.year)) return { events, warnings: ['Printed media schedule year conflicts with its current publisher heading'], recognized: 0, partial: true };
  if (variants.length < 2) return { events, warnings: ['Media table requires two OCR treatments for date-column agreement'], recognized: 0, partial: true };
  const datePattern = new RegExp(`^(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})$`, 'i');
  const columns = variants.map(variant => variant.lines.flatMap(line => {
    if (!datePattern.test(line.text)) return [];
    const found = mediaDates(line.text, { year: grounding.year, allowContextYear: true });
    return found.dates.length === 1 ? [{ ...line, date: found.dates[0].start }] : [];
  }));
  const primary = columns.reduce((a, b) => a.length >= b.length ? a : b, []);
  if (!primary.length) return { events, warnings: ['No explicit media date-column rows were recognized'], recognized: 0, partial: true };
  const weekdays = [...new Set(variants.flatMap(variant => variant.text.match(/\b(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)S?\b/gi) || []).map(word => word.toLowerCase().replace(/s$/, '')))];
  const reference = variants[columns.indexOf(primary)] || variants[0];
  const fullText = variants.map(variant => variant.text).join('\n');
  const location = mediaLocation(fullText);
  const allClocks = new Map();
  for (const variant of variants) for (const line of variant.lines) {
    const kind = /\bCOLLOQUIUM\b/i.test(line.text) ? 'colloquium' : /\bSOCIAL\b/i.test(line.text) ? 'social' : null;
    if (!kind) continue;
    const value = mediaClock(line.text);
    if (value?.start && value.end && !value.ambiguous) {
      if (!allClocks.has(kind)) allClocks.set(kind, new Map());
      allClocks.get(kind).set(`${value.start}|${value.end}`, value);
    }
  }
  let recognized = 0;
  for (let i = 0; i < primary.length; i++) {
    const anchor = primary[i];
    if (columns.filter(column => column.some(row => row.date === anchor.date)).length < 2) { warnings.push(`OCR date treatments disagree for ${anchor.text}`); continue; }
    if (weekdays.length !== 1 || WEEKDAYS[new Date(`${anchor.date}T00:00:00Z`).getUTCDay()] !== weekdays[0]) { warnings.push(`Printed schedule weekday is missing, ambiguous or conflicts with ${anchor.date}`); continue; }
    const top = i ? (primary[i - 1].top + anchor.top) / 2 : anchor.top - (primary[1]?.top - anchor.top || 120) / 2;
    const bottom = i + 1 < primary.length ? (anchor.top + primary[i + 1].top) / 2 : anchor.bottom + (anchor.top - primary[i - 1]?.top || 100) / 2;
    const rowLines = reference.lines.filter(line => line.left > anchor.right + 20 && line.top >= top && line.top < bottom);
    const first = rowLines[0];
    if (!first) { warnings.push(`No schedule subject beside ${anchor.date}`); continue; }
    const social = /\bsocial\b/i.test(first.text);
    const kind = social ? 'social' : 'colloquium';
    const ranges = allClocks.get(kind);
    const timing = ranges?.size === 1 ? [...ranges.values()][0] : null;
    if (!timing) notices.push(`No unambiguous printed ${kind} clock range for ${anchor.date}; date-only precision retained`);
    const nameSafe = first.confidence >= 80 && /^(?:[A-Z][\p{L}'’.-]+\s+){1,3}[A-Z][\p{L}'’.-]+$/u.test(first.text);
    const title = social ? first.text : `${grounding.seriesTitle || 'Colloquium'}${nameSafe ? ` — ${first.text}` : ''}`;
    if (!social && !nameSafe) notices.push(`Speaker text is uncertain for ${anchor.date}; publisher series title retained`);
    const event = normalizeEvent({ title, start: timing ? `${anchor.date}T${timing.start}` : anchor.date,
      end: timing ? `${anchor.date}T${timing.end}` : undefined, location, url: grounding.url || plan.url,
      description: `Automatically extracted from the publisher's current schedule.\n${grounding.heading || ''}\n${anchor.text}\n${rowLines.filter(line => line !== first || social || nameSafe).map(line => line.text).join('\n')}${!social && !nameSafe ? '\nSpeaker text could not be read reliably.' : ''}\n${location}\n${variants[0].text.split(/\r?\n/).filter(line => /\b(?:SOCIAL|COLLOQUIUM)\b/.test(line)).join('\n')}` }, plan);
    if (!event) { warnings.push(`Invalid event fields for schedule row ${anchor.text}`); continue; }
    recognized++;
    if (inWindow(event, context)) events.push(event);
  }
  const allDates = new Set(columns.flatMap(column => column.map(row => row.date)));
  if (recognized !== allDates.size) warnings.push('Some printed media schedule rows could not be published safely');
  return { events, warnings: [...new Set([...warnings, ...notices])], recognized, partial: warnings.length > 0 };
}

/**
 * Derive conservative calendar bounds from explicit semester/month-year text.
 * These bounds only exclude historical resources; they never create events.
 * @param {string} text Current publisher heading or visible document cover.
 * @param {boolean} includeMonth Whether document publication months are allowed.
 * @return {Object|null} Earliest/latest possible dates from the printed period.
 */
export function mediaPeriod(text, includeMonth = false) {
  const periods = [];
  text = String(text).replace(/\b(20\d{2})\s+(Spring|Summer|Fall|Autumn|Winter)\b/gi, '$2 $1');
  for (const match of String(text).matchAll(/\b(Spring|Summer|Fall|Autumn|Winter)\s*(20\d{2})\b/gi)) {
    const months = { spring: [1, 7], summer: [5, 10], fall: [7, 13], autumn: [7, 13], winter: [1, 13] }[match[1].toLowerCase()];
    periods.push({ start: `${match[2]}-${String(months[0]).padStart(2, '0')}-01`, end: months[1] === 13 ? `${+match[2] + 1}-01-01` : `${match[2]}-${String(months[1]).padStart(2, '0')}-01` });
  }
  if (!periods.length && includeMonth) for (const match of String(text).matchAll(new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s+(20\\d{2})\\b`, 'gi'))) {
    const month = MONTH[match[1].slice(0, 3).toLowerCase()];
    periods.push({ start: `${match[2]}-${String(month).padStart(2, '0')}-01`, end: month === 12 ? `${+match[2] + 1}-01-01` : `${match[2]}-${String(month + 1).padStart(2, '0')}-01` });
  }
  return periods.length ? { start: periods.map(period => period.start).sort()[0], end: periods.map(period => period.end).sort().at(-1) } : null;
}

/**
 * Test whether explicit date/period bounds are wholly outside the source window.
 * @param {Object|null} period Explicit inclusive start and exclusive end.
 * @param {Object} context Current collection window.
 * @return {boolean} Whether the period cannot overlap the requested window.
 */
function periodOutside(period, context) {
  return Boolean(period && ((context.windowStart && Date.parse(period.end) <= Date.parse(context.windowStart))
    || (context.windowEnd && Date.parse(period.start) >= Date.parse(context.windowEnd))));
}

/**
 * Read nearby explicit date prose without crossing another image or heading.
 * Only an immediately preceding event-date block can ground a portrait's event.
 * @param {Function} $ Current Cheerio document.
 * @param {Object} element Selected media element.
 * @return {string} Associated publisher date prose or an empty string.
 */
function precedingDateText($, element) {
  const block = element.closest('p,h1,h2,h3,h4,figure');
  if (!block.length) return '';
  const own = plainText($.html(block));
  if (mediaDates(own).dates.length === 1 && own.length < 500) return own;
  let previous = block.prev();
  while (previous.length) {
    if (previous.find('img').length || previous.is('img,hr,h1,h2,h3,h4')) break;
    const text = plainText($.html(previous));
    if (!text) { previous = previous.prev(); continue; }
    return /^(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(text)
      && mediaDates(text).dates.length === 1 ? text : '';
  }
  return '';
}

/**
 * Collect current DOM context and semantic portrait evidence without filenames.
 * @param {Function} $ Cheerio document.
 * @param {Object} node Selected media element.
 * @param {Object} rule Reusable selector/profile options.
 * @param {Object} plan Public source plan.
 * @return {Object} Live year, label, date prose and media-role evidence.
 */
function mediaGrounding($, node, rule, plan) {
  const element = $(node);
  const scope = rule.contextSelector ? element.closest(rule.contextSelector) : null;
  const all = $('h1,h2,h3,h4,img,a').toArray();
  const position = all.indexOf(node);
  const pattern = rule.yearHeadingPattern ? new RegExp(rule.yearHeadingPattern, 'i') : /\b(?:(?:Fall|Spring|Summer|Winter)\s+20\d{2}|20\d{2}\s+(?:Fall|Spring|Summer|Winter))\b/i;
  const heading = (scope?.length ? scope.find('h1,h2,h3,h4').toArray() : all.slice(0, position).filter(item => /^h[1-4]$/i.test(item.tagName || item.name || '')).reverse())
    .map(item => $(item).text().trim()).find(text => pattern.test(text)) || '';
  const container = rule.containerSelector ? element.closest(rule.containerSelector) : element.parent();
  const title = rule.titleSelector ? container.find(rule.titleSelector).first().text().replace(/\s+/g, ' ').trim() : element.attr('title') || '';
  const alt = element.attr('alt') || '';
  const altTitle = /^(?:Photo|Poster) of .+? (?:on|at) \d/i.test(alt) ? alt.replace(/^(?:Photo|Poster) of /i, '').split(/\s+on\s+\d/i)[0] : '';
  const nearby = precedingDateText($, element);
  const paragraph = element.closest('p');
  const ownText = plainText($.html(paragraph));
  const biography = `${ownText}\n${plainText($.html(paragraph.nextAll('p').first()))}`;
  const content = element.closest('.content,main,article');
  const headline = content.find('h1').first().text().trim();
  const bodyText = plainText($.html(content));
  const personName = alt.replace(/^(?:Poet(?:\s+and\s+Translator)?|Translator|Author|Professor|Dr\.?)\s+/i, '');
  const namedPortrait = personName !== alt && /^[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){1,3}$/u.test(personName)
    && bodyText.includes(`${personName} is `) && /\b(?:author|professor|poet|translator)\b/i.test(bodyText);
  const editorialCaption = alt !== headline && !/\.(?:png|jpe?g|gif|webp)$/i.test(alt) && !/\b(?:poster|schedule|agenda|flyer|lecture|seminar|workshop|event|talk|join)\b/i.test(alt)
    && (/\b(?:photograph|portrait|headshot|stock photo|cityscape|landscape|sunset|cover of (?:the )?book)\b/i.test(alt)
      || (/\b(?:with|at|into|over|under)\b/i.test(alt) && titleTerms(alt).length >= 2 && headline.length > 0));
  const portrait = !mediaDates(alt).dates.length && (/\b(?:headshot|portrait)\b/i.test(alt)
    || (element.is('.floatleft,.floatright') && +element.attr('width') <= 600 && +element.attr('height') <= 650
      && (ownText.length > 160 || (biography.length > 160 && /\b(?:professor|author|director|received|research|scholar)\b/i.test(biography))))
    || (ownText.length > 160 && +element.attr('width') <= 600 && +element.attr('height') <= 650
      && biography.length > 160 && /\b(?:professor|received|author|director|Ph\.?D|born|research|scholar|published|book)\b/i.test(biography)));
  return { heading, year: printedYear(heading), allowContextYear: Boolean(heading), title: title ? `${rule.seriesTitle && rule.titleSelector ? `${rule.seriesTitle} — ` : ''}${title}` : altTitle,
    seriesTitle: rule.seriesTitle || '', alt, nearby, portrait: portrait || namedPortrait, editorialCaption, headline, url: plan.url };
}

/**
 * Tokenize an official event title for unique, content-based cross-reference.
 * @param {string} title Published title text.
 * @return {string[]} Meaningful lowercase title tokens.
 */
function titleTerms(title) {
  return [...new Set(String(title).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z0-9]+/g) || [])]
    .filter(word => word.length > 2 && !['the', 'and', 'for', 'with', 'from', 'this', 'that'].includes(word));
}

/**
 * Read all dated cards from explicitly configured related official listings.
 * @param {Object} rule Media rule with public date-index selectors.
 * @param {Object} context Safe anonymous text fetch callback.
 * @return {Promise<Object[]>} Source-bound official title/date evidence.
 */
async function officialDateIndex(rule, context) {
  const index = [];
  for (const source of rule.dateIndexes || []) {
    const $ = cheerio.load(await context.fetchText(source.url));
    $(source.selector).each((_, node) => {
      const title = $(node).find(source.titleSelector).first().text().trim();
      const text = $(node).find(source.dateSelector).first().text().trim();
      const found = mediaDates(text);
      if (title && found.dates.length === 1 && !found.warnings.length) index.push({ title, date: found.dates[0], terms: titleTerms(title), url: source.url,
        detailUrl: absoluteUrl($(node).find(source.linkSelector || 'a[href]').first().attr('href'), source.url), associationPattern: source.associationPattern });
    });
  }
  return index;
}

/**
 * Ground a missing poster year only through unique official title/month-day proof.
 * A current semester heading or explicit poster year always outranks an archive.
 * @param {Object} raw Current media text and OCR.
 * @param {Object} grounding Fresh publisher context.
 * @param {Object[]} index Dated related official cards.
 * @return {Object} Context with additional year/evidence only when unambiguous.
 */
async function indexedGrounding(raw, grounding, index, context) {
  if (grounding.year) return grounding;
  const text = [raw.text || '', ...(raw.variants || []).map(variant => variant.text)].join('\n');
  if (/\b20\d{2}\b/.test(text)) return grounding;
  const textTerms = new Set(titleTerms(text));
  const matches = index.filter(item => item.terms.length >= 3 && item.terms.every(term => textTerms.has(term))
    && mediaDates(text, { year: +item.date.start.slice(0, 4), allowContextYear: true }).dates.some(date => date.start === item.date.start));
  const identities = new Set(matches.map(item => `${item.title.toLowerCase()}|${item.date.start}`));
  if (identities.size !== 1) return grounding;
  const matched = matches[0];
  if (matched.associationPattern) {
    if (!matched.detailUrl) return grounding;
    const detailText = plainText(await context.fetchText(matched.detailUrl));
    if (!new RegExp(matched.associationPattern, 'i').test(detailText)) return grounding;
  }
  return { ...grounding, year: +matched.date.start.slice(0, 4), allowContextYear: true,
    title: matched.title, dateEvidence: { title: matched.title, date: matched.date.start, url: matched.url, detailUrl: matched.detailUrl,
      ...(matched.associationPattern ? { associationVerified: true } : {}) } };
}

/**
 * Parse a PDF cover or clearly labelled later agenda page, ignoring slide dates.
 * @param {Object} raw All text/OCR pages and resumable extraction progress.
 * @param {Object} grounding Live source title/year.
 * @param {Object} plan Source normalization options.
 * @param {Object} context Current collection window.
 * @return {Object} Grounded events and unresolved document diagnostics.
 */
export function parseMediaDocument(raw, grounding, plan, context = {}) {
  const pages = raw.pages?.length ? raw.pages : [{ number: 1, text: raw.text || '', variants: raw.variants || [] }];
  const first = parseMediaPoster(pages[0], grounding, plan, context);
  if (first.recognized) return { ...first, datePage: 1 };
  const events = new Map(); const warnings = []; let recognized = 0; let publishedDateCandidates = 0;
  for (const page of pages) {
    const text = [page.text || '', ...(page.variants || []).map(variant => variant.text)].join('\n');
    const headings = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 3);
    if (!headings.some(line => line.length <= 140 && /\b(?:agenda|schedule|programme?)\b/i.test(line) && !/references|bibliography/i.test(line))) continue;
    const textVariants = [page.text || '', ...(page.variants || []).map(variant => variant.text)].filter(Boolean);
    const selectedText = textVariants.sort((first, second) => mediaDates(second, grounding).dates.length - mediaDates(first, grounding).dates.length)[0] || '';
    const dates = mediaDates(selectedText, grounding).dates;
    publishedDateCandidates += dates.length;
    if (dates.length > 1) {
      const lines = selectedText.split(/\r?\n/).map(line => line.trim());
      for (let i = 0; i < dates.length; i++) {
        const start = lines.indexOf(dates[i].line);
        const end = i + 1 < dates.length ? lines.indexOf(dates[i + 1].line, start + 1) : lines.length;
        const section = lines.slice(start, end).join('\n');
        // Each printed date is retained even when a detailed session grid is
        // not expressible as a single start/end clock for the whole programme.
        const selectedVariant = page.variants?.find(variant => variant.text === selectedText);
        const sectionRaw = selectedText === page.text ? { text: section, variants: [] } : { variants: [{ ...selectedVariant, text: section }] };
        const parsed = parseMediaPoster(sectionRaw, grounding, plan, context);
        recognized += parsed.recognized;
        warnings.push(...parsed.warnings);
        for (const event of parsed.events) events.set(event.uid, event);
      }
      continue;
    }
    const parsed = parseMediaPoster(page, grounding, plan, context);
    if (!parsed.recognized) continue;
    recognized += parsed.recognized;
    warnings.push(...parsed.warnings);
    for (const event of parsed.events) events.set(event.uid, event);
  }
  return recognized ? { events: [...events.values()], warnings, recognized, publishedDateCandidates, partial: false }
    : { events: [], warnings: ['No complete occurrence date was established on the document cover or labelled agenda pages'], recognized: 0, publishedDateCandidates, partial: true };
}

/**
 * Extract dated announcement prose that accompanies non-event portraits.
 * @param {Function} $ Current publisher DOM.
 * @param {Object} rule Semantic media/announcement options.
 * @param {Object} plan Source normalization options.
 * @param {Object} context Current collection window.
 * @return {Object} Explicit HTML event dates and normalized occurrences.
 */
function inlineAnnouncements($, rule, plan, context) {
  const events = []; let recognized = 0;
  if (!rule.announcementSelector) return { events, recognized };
  $(rule.announcementSelector).each((_, node) => {
    const text = plainText($.html(node));
    if (!/^(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(text)
      || !/(?:Location:|Schedule of events|\d[ :].*\b[ap]m\b)/i.test(text) || mediaDates(text).dates.length !== 1) return;
    const date = mediaDates(text).dates[0];
    const ranges = text.split(/\r?\n/).map(line => mediaClock(line)).filter(value => value?.start && value.end && !value.ambiguous);
    const startClock = ranges.map(value => value.start).sort()[0];
    const endClock = ranges.map(value => value.end).sort().at(-1);
    const event = normalizeEvent({ title: rule.seriesTitle, start: startClock ? `${date.start}T${startClock}` : date.start,
      end: endClock ? `${date.start}T${endClock}` : date.end, location: mediaLocation(text), url: plan.url, description: text }, plan);
    if (event) { recognized++; if (inWindow(event, context)) events.push(event); }
  });
  return { events, recognized };
}

/**
 * Discover all semantic media candidates, with auditable historical/role pruning.
 * Resource protections checkpoint PDF OCR progress rather than truncating assets.
 * @param {string} html Publisher's current anonymous public HTML.
 * @param {Object} plan Source options containing automaticMedia rules.
 * @param {Object} context Fetch callbacks, extractor, cache and date window.
 * @return {Promise<Object>} Current events, detailed coverage and blocking gaps.
 */
export async function fetchAutomaticMedia(html, plan, context) {
  const $ = cheerio.load(html); const events = new Map(); const warnings = [];
  const coverage = { version: 1, kind: 'automatic-media', inspectionComplete: false, discovered: 0, processed: 0, excludedHistorical: 0, excludedNonEvent: 0, unresolved: 0,
    internalIssues: [], externalIssues: [], nonBlockingIssues: [], assets: [] };
  let recognized = 0; let datedRecognized = false;
  const seen = new Set();
  for (const rule of plan.options?.automaticMedia || []) {
    const nodes = $(rule.selector).toArray();
    if (!nodes.length) { if (!rule.optional) coverage.internalIssues.push(`Automatic media selector found no assets: ${rule.selector}`); continue; }
    const announcements = inlineAnnouncements($, rule, plan, context);
    recognized += announcements.recognized;
    datedRecognized ||= announcements.recognized > 0;
    for (const event of announcements.events) events.set(`${event.start}|${event.end}|${event.title}`, event);
    let index = [];
    try { index = await officialDateIndex(rule, context); }
    catch (error) { coverage.nonBlockingIssues.push(`Related official date index unavailable: ${error.message}`); }
    for (const node of rule.fromEnd ? nodes.reverse() : nodes) {
      const attribute = rule.attribute || 'src';
      const url = ['src', 'href'].includes(attribute) ? absoluteUrl($(node).attr(attribute), plan.fetchUrl || plan.url) : '';
      if (seen.has(url)) continue;
      seen.add(url);
      const asset = { url, classification: 'unresolved' };
      coverage.assets.push(asset); coverage.discovered++;
      if (!url) { coverage.internalIssues.push('Media element has no public asset URL'); coverage.unresolved++; continue; }
      let grounding = mediaGrounding($, node, rule, plan);
      const pageSpans = rule.singleEventDocument ? (context.pageDateSpans || []).filter(span => span.url === plan.url) : [];
      if (pageSpans.length) {
        const outside = pageSpans.every(span => !inWindow(span, context));
        Object.assign(asset, { classification: outside ? 'excluded-historical' : 'covered-by-html',
          reason: 'This single-event document already publishes its occurrence date in HTML; its media is supplementary to the same occurrence', dateEvidence: pageSpans });
        if (outside) coverage.excludedHistorical++;
        else coverage.coveredByHtml = (coverage.coveredByHtml || 0) + 1;
        recognized++; datedRecognized = true; continue;
      }
      const dates = mediaDates([grounding.alt, grounding.nearby].filter(Boolean).join('\n'), grounding);
      const period = dates.dates.length === 1 ? dates.dates[0] : mediaPeriod(grounding.heading);
      if (periodOutside(period, context)) {
        Object.assign(asset, { classification: 'excluded-historical', period, evidence: grounding.alt || grounding.nearby || grounding.heading });
        coverage.excludedHistorical++; recognized++; datedRecognized = true; continue;
      }
      const width = +$(node).attr('width'); const height = +$(node).attr('height');
      if (grounding.portrait || (rule.minAspectRatio && width > 0 && height > 0 && width / height < rule.minAspectRatio)) {
        Object.assign(asset, { classification: 'excluded-non-event', reason: grounding.portrait ? 'Publisher marks a headshot/portrait or embeds the floated image in biography prose; dated announcement HTML is parsed separately' : 'Image dimensions are outside the configured banner role' });
        coverage.excludedNonEvent++; recognized++; continue;
      }
      try {
        let parsed; let raw;
        if (grounding.alt && grounding.title && dates.dates.length === 1) parsed = parseMediaPoster({ variants: [] }, grounding, plan, context);
        else {
          const bytes = await context.fetchBytes(url, { maximumBytes: 128 * 1024 * 1024, timeoutMs: 60_000 });
          const pdf = Buffer.from(bytes).subarray(0, 5).toString() === '%PDF-';
          const extract = context.extractMedia || extractMedia;
          raw = await extract(bytes, { cacheDir: context.mediaCacheDir, ...(pdf ? { ocrBudgetMs: 0 } : {}) });
          if (!pdf && rule.classifyIllustrations) {
            const text = (raw.variants || []).map(variant => variant.text).join('\n');
            const dateLike = new RegExp(`\\b(?:${MONTH_PATTERN})\\.?\\s*\\d{1,2}\\b`, 'i').test(text);
            if (grounding.editorialCaption && !dateLike && !mediaClock(text)) {
              Object.assign(asset, { classification: 'excluded-non-event', reason: 'Publisher alt describes a distinct editorial photograph/illustration rather than the event headline; its associated event prose is checked separately',
                roleEvidence: { alt: grounding.alt, headline: grounding.headline }, inspectedTreatments: raw.variants?.length || 0 });
              coverage.excludedNonEvent++; recognized++; continue;
            }
          }
          const cover = pdf ? raw.pages?.[0] || raw : raw;
          const coverText = [cover.text || '', ...(cover.variants || []).map(variant => variant.text)].join('\n');
          const coverDates = mediaDates(coverText, grounding);
          const coverPeriod = coverDates.dates.length === 1 ? coverDates.dates[0] : rule.documentArchive ? mediaPeriod(coverText, true) : null;
          if (periodOutside(coverPeriod, context)) {
            Object.assign(asset, { classification: 'excluded-historical', period: coverPeriod, evidence: 'Visible current document cover date/publication period', totalPages: raw.totalPages });
            coverage.excludedHistorical++; recognized++; datedRecognized = true; continue;
          }
          if (pdf && raw.complete === false) raw = await extract(bytes, { cacheDir: context.mediaCacheDir,
            ...(rule.documentArchive ? { stopOcrWhen: state => {
              const first = state.pages?.[0];
              const text = [first?.text || '', ...(first?.variants || []).map(variant => variant.text)].join('\n');
              return mediaDates(text, grounding).dates.length === 1 || periodOutside(mediaPeriod(text, true), context);
            } } : {}) });
          grounding = await indexedGrounding(raw, grounding, index, context);
          parsed = rule.profile === 'table' ? parseMediaTable(raw, grounding, plan, context)
            : pdf ? parseMediaDocument(raw, grounding, plan, context) : parseMediaPoster(raw, grounding, plan, context);
        }
        coverage.processed++;
        recognized += parsed.recognized;
        datedRecognized ||= parsed.recognized > 0;
        Object.assign(asset, { classification: parsed.recognized ? 'processed' : 'unresolved', recognized: parsed.recognized,
          ...(grounding.dateEvidence ? { dateEvidence: grounding.dateEvidence } : {}),
          ...(raw?.totalPages ? { totalPages: raw.totalPages, pendingPages: raw.pendingPages || [], ocrPagesCompleted: raw.ocrPagesCompleted || 0 } : {}) });
        const coverResolved = rule.documentArchive && parsed.recognized > 0 && parsed.datePage === 1;
        if (raw?.complete === false && !coverResolved) {
          coverage.internalIssues.push(`PDF OCR will resume pending pages ${(raw.pendingPages || []).join(',')} (${url})`); coverage.unresolved++;
        } else if (!parsed.recognized && !parsed.publishedDateCandidates && rule.documentArchive && raw?.kind === 'pdf') {
          asset.classification = 'undated-resource'; recognized++;
          coverage.nonBlockingIssues.push(`Presentation archive document has no complete occurrence date on its cover/agenda (${url})`);
        } else if (parsed.partial) {
          coverage.unresolved++;
          const errors = parsed.warnings.map(warning => `${warning} (${url})`);
          // A failed OCR read is an extraction gap, never proof that the source
          // omitted the field. Only verified printed conflicts are external.
          if (errors.some(error => /Printed weekday conflicts|date conflicts/.test(error))) coverage.externalIssues.push(...errors);
          else coverage.internalIssues.push(...errors);
        } else coverage.nonBlockingIssues.push(...parsed.warnings.map(warning => `${warning} (${url})`));
        if (coverResolved && raw?.pendingPages?.length) asset.reason = 'The explicitly dated presentation cover resolves this single seminar; every text page was inspected and later slide-image OCR is unnecessary';
        for (const event of parsed.events) events.set(`${event.start}|${event.end}|${event.title}`, event);
      } catch (error) {
        coverage.unresolved++; asset.error = error.message;
        const message = `Media extraction failed (${url}): ${error.message}`;
        if (/HTTP (?:4|5)\d\d|certificate|ENOTFOUND|ECONNREFUSED/i.test(error.message)) coverage.externalIssues.push(message);
        else coverage.internalIssues.push(message);
      }
    }
  }
  coverage.inspectionComplete = coverage.internalIssues.length === 0;
  warnings.push(...coverage.internalIssues, ...coverage.externalIssues, ...coverage.nonBlockingIssues);
  return { events: [...events.values()], warnings: [...new Set(warnings)], recognized, datedRecognized,
    partial: coverage.internalIssues.length > 0 || coverage.externalIssues.length > 0, unsupported: recognized === 0 && coverage.unresolved > 0, coverage };
}
