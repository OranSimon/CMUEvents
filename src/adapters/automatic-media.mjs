import * as cheerio from 'cheerio';
import { absoluteUrl, normalizeEvent, inWindow, addDays, parseDate } from '../lib/normalize.mjs';
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
    const line = lines[i].replace(/[–—−]/g, '-');
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
  const clean = String(text).replace(/[–—−]/g, '-').replace(/\b([ap])\.\s*m\.?/gi, '$1m');
  const range = clean.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (range) {
    // A shared suffix is safe only for an increasing range in the same period.
    if (!range[3] && +range[1] > +range[4]) return { ambiguous: true };
    const start = clock(range[1], range[2], range[3] || range[6]);
    const end = clock(range[4], range[5], range[6]);
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
  return { events, warnings: [...new Set(warnings)], recognized: 1, partial: warnings.length > 0 };
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
  const events = []; const warnings = [];
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
    if (!columns.every(column => column.some(row => row.date === anchor.date))) { warnings.push(`OCR date treatments disagree for ${anchor.text}`); continue; }
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
    if (!timing) warnings.push(`No unambiguous printed ${kind} clock range for ${anchor.date}; date-only precision retained`);
    const nameSafe = first.confidence >= 80 && /^(?:[A-Z][\p{L}'’.-]+\s+){1,3}[A-Z][\p{L}'’.-]+$/u.test(first.text);
    const title = social ? first.text : `${grounding.seriesTitle || 'Colloquium'}${nameSafe ? ` — ${first.text}` : ''}`;
    if (!social && !nameSafe) warnings.push(`Speaker text is uncertain for ${anchor.date}; publisher series title retained`);
    const event = normalizeEvent({ title, start: timing ? `${anchor.date}T${timing.start}` : anchor.date,
      end: timing ? `${anchor.date}T${timing.end}` : undefined, location, url: grounding.url || plan.url,
      description: `Automatically extracted from the publisher's current schedule.\n${grounding.heading || ''}\n${anchor.text}\n${rowLines.filter(line => line !== first || social || nameSafe).map(line => line.text).join('\n')}${!social && !nameSafe ? '\nSpeaker text could not be read reliably.' : ''}\n${location}\n${variants[0].text.split(/\r?\n/).filter(line => /\b(?:SOCIAL|COLLOQUIUM)\b/.test(line)).join('\n')}` }, plan);
    if (!event) { warnings.push(`Invalid event fields for schedule row ${anchor.text}`); continue; }
    recognized++;
    if (inWindow(event, context)) events.push(event);
  }
  const allDates = new Set(columns.flatMap(column => column.map(row => row.date)));
  if (recognized !== allDates.size) warnings.push('Some printed media schedule rows could not be published safely');
  return { events, warnings: [...new Set(warnings)], recognized, partial: warnings.length > 0 };
}

/**
 * Collect context from the current DOM; filenames and runtime year are ignored.
 * @param {Function} $ Cheerio document.
 * @param {Object} node Selected media element.
 * @param {Object} rule Reusable selector/profile options.
 * @param {Object} plan Public source plan.
 * @return {Object} Live year, label, title, alt and original page URL.
 */
function mediaGrounding($, node, rule, plan) {
  const element = $(node);
  const scope = rule.contextSelector ? element.closest(rule.contextSelector) : null;
  const all = $('h1,h2,h3,h4,img,a').toArray();
  const position = all.indexOf(node);
  const pattern = rule.yearHeadingPattern ? new RegExp(rule.yearHeadingPattern, 'i') : /\b(?:Fall|Spring|Summer|Winter)\s+20\d{2}\b/i;
  const heading = (scope?.length ? scope.find('h1,h2,h3,h4').toArray() : all.slice(0, position).filter(item => /^h[1-4]$/i.test(item.tagName || item.name || '')).reverse())
    .map(item => $(item).text().trim()).find(text => pattern.test(text)) || '';
  const container = rule.containerSelector ? element.closest(rule.containerSelector) : element.parent();
  const title = rule.titleSelector ? container.find(rule.titleSelector).first().text().replace(/\s+/g, ' ').trim() : '';
  const alt = element.attr('alt') || '';
  const altTitle = /^(?:Photo|Poster) of .+? (?:on|at) \d/i.test(alt) ? alt.replace(/^(?:Photo|Poster) of /i, '').split(/\s+on\s+\d/i)[0] : '';
  return { heading, year: printedYear(heading), allowContextYear: Boolean(heading), title: title ? `${rule.seriesTitle ? `${rule.seriesTitle} — ` : ''}${title}` : altTitle,
    seriesTitle: rule.seriesTitle || '', alt, url: plan.url };
}

/**
 * Discover current media through semantic selectors and automatically re-extract.
 * No per-event title/date/hash is accepted from configuration. OCR failures are
 * partial source coverage and never fall back to manually approved stale fields.
 * @param {string} html Publisher's current anonymous public HTML.
 * @param {Object} plan Source options containing automaticMedia rules.
 * @param {Object} context Fetch callback, optional extractor and date window.
 * @return {Promise<Object>} Validated current events and explicit coverage gaps.
 */
export async function fetchAutomaticMedia(html, plan, context) {
  const $ = cheerio.load(html); const events = new Map(); const warnings = [];
  let recognized = 0; let partial = false;
  for (const rule of plan.options?.automaticMedia || []) {
    let nodes = $(rule.selector).toArray();
    if (rule.minAspectRatio) nodes = nodes.filter(node => {
      const width = +$(node).attr('width'); const height = +$(node).attr('height');
      // Undeclared dimensions remain candidates so a new publisher image is read.
      return !(width > 0 && height > 0) || width / height >= rule.minAspectRatio;
    });
    if (!nodes.length) { warnings.push(`Automatic media selector found no advertised assets: ${rule.selector}`); partial = true; continue; }
    if (rule.fromEnd) nodes.reverse();
    const maxAssets = Math.max(1, Math.min(40, rule.maxAssets || 12));
    if (nodes.length > maxAssets) { warnings.push(`Media discovery is bounded to ${maxAssets} of ${nodes.length} advertised assets; remaining archive coverage is incomplete`); partial = true; }
    const seen = new Set();
    for (const node of nodes.slice(0, maxAssets)) {
      const attribute = rule.attribute || 'src';
      const url = ['src', 'href'].includes(attribute) ? absoluteUrl($(node).attr(attribute), plan.fetchUrl || plan.url) : '';
      if (!url) { warnings.push('Automatic media element has no safe public asset URL'); partial = true; continue; }
      if (seen.has(url)) continue;
      seen.add(url);
      const grounding = mediaGrounding($, node, rule, plan);
      try {
        // Rich publisher alt text can supply an accessible equivalent directly.
        let parsed;
        if (grounding.alt && grounding.title && mediaDates(grounding.alt, grounding).dates.length === 1) {
          parsed = parseMediaPoster({ variants: [] }, grounding, plan, context);
        } else {
          const bytes = await context.fetchBytes(url);
          const raw = await (context.extractMedia || extractMedia)(bytes, { cacheDir: context.mediaCacheDir });
          parsed = rule.profile === 'table' ? parseMediaTable(raw, grounding, plan, context) : parseMediaPoster(raw, grounding, plan, context);
        }
        recognized += parsed.recognized;
        partial ||= parsed.partial;
        warnings.push(...parsed.warnings.map(warning => `${warning} (${url})`));
        for (const event of parsed.events) {
          const key = `${event.start}|${event.end}|${event.title}`;
          events.set(key, event);
        }
      } catch (error) { partial = true; warnings.push(`Automatic media extraction failed (${url}): ${error.message}`); }
    }
  }
  return { events: [...events.values()], warnings: [...new Set(warnings)], recognized, partial, unsupported: recognized === 0 };
}
