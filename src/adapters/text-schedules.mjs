import * as cheerio from 'cheerio';
import { normalizeEvent, inWindow, plainText, parseDate } from '../lib/normalize.mjs';
import { explicitTextDate, explicitTextEnd, clockTime } from './html.mjs';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Parse explicitly dated rows or heading sections in a publisher's live schedule.
 * Configuration describes structure, never a fixed list of event identities.
 * Published weekday defaults enrich already dated rows without recurrence.
 * @param {string} html Current anonymous public HTML.
 * @param {Object} plan Selectors, field positions and optional published defaults.
 * @param {Object} context Collection window.
 * @return {Object} Current occurrences and precise uncertainty diagnostics.
 */
export function parseTextSchedule(html, plan, context = {}) {
  const $ = cheerio.load(html);
  $('br').replaceWith(' ');
  const options = plan.options || {};
  const events = new Map();
  const warnings = [];
  let recognized = 0;
  let partial = false;
  const series = plainText($(options.seriesSelector || 'h1').first().text());
  const contextText = options.contextSelector ? plainText($(options.contextSelector).text()) : '';
  const defaults = options.defaultTimePattern ? [...contextText.matchAll(new RegExp(options.defaultTimePattern, 'gi'))] : [];
  const defaultDay = defaults.length === 1 ? defaults[0][1] : null;
  const defaultClock = defaults.length === 1 ? clockTime(defaults[0][2]) : null;
  const locationMatch = options.defaultLocationPattern ? contextText.match(new RegExp(options.defaultLocationPattern, 'i')) : null;
  let active = !options.startHeading;
  const rows = $(options.rowSelector).toArray();
  for (const element of rows) {
    const row = $(element);
    const rowText = plainText(row.text());
    if (options.startHeading && rowText === options.startHeading) { active = true; continue; }
    if (options.endHeading && rowText === options.endHeading) { active = false; continue; }
    if (!active) continue;
    const field = name => {
      const spec = options.fields?.[name];
      if (!spec) return '';
      return plainText(row.find(spec.selector).eq(spec.index || 0).text());
    };
    const following = options.followingSections ? row.nextUntil('h1,h2,h3,h4').toArray().map(node => $(node).text()).join('\n') : '';
    let title = options.followingSections ? rowText : field('title');
    const speaker = field('speaker');
    let dateText = options.followingSections ? following : field('date');
    if (!title || (!dateText && !speaker)) continue;
    // A weekday inside a bounded date field may precede an explicit exception clock.
    dateText = dateText.replace(/\b(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s*,?\s*(?=\d{1,2}:\d{2}\s*[ap])/gi, '');
    let start = explicitTextDate(dateText);
    if (!start || !parseDate(start)) {
      if (!options.followingSections) { partial = true; warnings.push(`Schedule row lacks an explicit valid full date: ${title}`); }
      continue;
    }
    if (/^(?:TBD|TBA|to be announced)$/i.test(title)) {
      if (!speaker || !series) { partial = true; warnings.push('A dated talk has neither a published topic nor a named speaker'); continue; }
      title = `${series} — ${speaker}`;
    }
    if (start.length === 10 && defaultClock && defaultDay
      && WEEKDAYS[new Date(`${start}T12:00:00Z`).getUTCDay()].toLowerCase() === defaultDay.toLowerCase()) {
      start = `${start}T${defaultClock}`;
    }
    if (start.length === 10 && options.requirePublishedClock) {
      partial = true; warnings.push(`No applicable published clock for dated talk: ${title}; retained date precision`);
    }
    let location = field('location');
    let contextApplies = !locationMatch;
    if (!location && locationMatch) {
      const term = locationMatch[2]?.match(/^([FS])(\d{2}|20\d{2})$/i);
      const year = term && Number(term[2].length === 2 ? `20${term[2]}` : term[2]);
      const month = +start.slice(5, 7);
      contextApplies = Boolean(term && +start.slice(0, 4) === year && (term[1].toUpperCase() === 'F' ? month >= 8 : month <= 6));
      if (contextApplies) location = locationMatch[1];
    }
    const streamed = contextApplies && /stream.*live via Zoom/i.test(contextText);
    if (streamed && !/\bZoom\b/i.test(location)) location = [location, 'Zoom'].filter(Boolean).join(' · ');
    const hybrid = /\bZoom\b/i.test(location) && ((contextApplies && /meet in person/i.test(contextText)) || !/^(?:Zoom|Online|Virtual)$/i.test(location));
    const description = [speaker ? `Speaker: ${speaker}${field('affiliation') ? ` (${field('affiliation')})` : ''}.` : '',
      options.followingSections ? following : rowText].filter(Boolean).join('\n');
    const event = normalizeEvent({ title, start, end: explicitTextEnd(dateText, start), url: plan.url,
      description, location, ...(hybrid ? { mode: 'hybrid' } : {}) }, plan);
    if (!event) { partial = true; warnings.push(`Published schedule fields are invalid: ${title}`); continue; }
    recognized++;
    if (inWindow(event, context)) events.set(event.uid, event);
  }
  if (!recognized) { partial = true; warnings.push('No explicitly dated schedule rows were recognized; the publisher structure or schedule needs review'); }
  return { events: [...events.values()], warnings, recognized, ...(partial ? { partial: true } : {}) };
}

/**
 * Fetch one live structurally configured public text schedule.
 * @param {Object} plan Publisher URL and text schedule selectors.
 * @param {Object} context Anonymous fetchText callback and date window.
 * @return {Promise<Object>} Current dated records without fixed event snapshots.
 */
export async function fetchTextSchedule(plan, context) {
  if (plan.options?.layout === 'linked-consistent-details') return fetchConsistentDetails(plan, context);
  return parseTextSchedule(await context.fetchText(plan.fetchUrl || plan.url), plan, context);
}

/**
 * Read a conference page only when all full event dates and its title agree.
 * Agenda clock ranges do not establish an overall event start or end time.
 * @param {string} html Current public conference detail HTML.
 * @param {Object} plan Content and title selectors for that publisher layout.
 * @param {Object} context Collection window.
 * @return {Object} One date-precision occurrence or an explicit conflict.
 */
export function parseConsistentEventPage(html, plan, context = {}) {
  const $ = cheerio.load(html);
  const options = plan.options;
  const title = plainText($(options.detailTitleSelector).first().text());
  const text = $(options.detailContentSelector).toArray().map(node => plainText($.html(node))).join('\n');
  const matches = text.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+20\d{2}\b/gi) || [];
  const dates = [...new Set(matches.map(value => explicitTextDate(value)).filter(value => value && parseDate(value)))];
  const titleYears = [...new Set(title.match(/\b20\d{2}\b/g) || [])];
  if (!title || dates.length !== 1 || titleYears.some(year => year !== dates[0].slice(0, 4))) {
    return { events: [], partial: true, warnings: [`Public conference dates conflict or lack one unambiguous full date (${plan.url}); title year(s): ${titleYears.join(', ') || 'none'}; printed dates: ${dates.join(', ') || 'none'}`] };
  }
  const event = normalizeEvent({ title, start: dates[0], url: plan.url, description: text }, plan);
  return event ? { events: inWindow(event, context) ? [event] : [], recognized: 1, warnings: [] }
    : { events: [], partial: true, warnings: [`Public conference date fields are invalid (${plan.url})`] };
}

/**
 * Follow the current publisher-advertised conference directory, including new links.
 * @param {Object} plan Same-origin detail link and content selectors.
 * @param {Object} context Anonymous HTTP callbacks and collection window.
 * @return {Promise<Object>} Verified live date records and conflict diagnostics.
 */
async function fetchConsistentDetails(plan, context) {
  const base = plan.fetchUrl || plan.url;
  const $ = cheerio.load(await context.fetchText(base));
  const origin = new URL(base).origin;
  const links = [...new Set($(plan.options.linkSelector).toArray().map(node => {
    try { const url = new URL($(node).attr('href'), base); return url.origin === origin ? url.href : null; }
    catch { return null; }
  }).filter(Boolean))];
  const maximum = Math.max(1, Math.min(100, Number(plan.options.maxDetails) || 40));
  const events = new Map();
  const warnings = [];
  let partial = links.length > maximum || !links.length;
  let recognized = 0;
  if (!links.length) warnings.push('No advertised public conference detail links were found; directory structure needs review');
  if (links.length > maximum) warnings.push(`Conference detail limit ${maximum} reached; advertised links remain`);
  for (let index = 0; index < Math.min(links.length, maximum); index += 3) {
    await Promise.all(links.slice(index, Math.min(index + 3, maximum)).map(async url => {
      try {
        const result = parseConsistentEventPage(await context.fetchText(url), { ...plan, url }, context);
        recognized += result.recognized || 0;
        partial ||= Boolean(result.partial);
        warnings.push(...result.warnings);
        for (const event of result.events) events.set(event.uid, event);
      } catch (error) { partial = true; warnings.push(`Public conference detail failed (${url}): ${error.message}`); }
    }));
  }
  return { events: [...events.values()], warnings, recognized, ...(partial ? { partial: true } : {}) };
}
