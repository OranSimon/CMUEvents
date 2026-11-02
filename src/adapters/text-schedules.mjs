import * as cheerio from 'cheerio';
import { normalizeEvent, inWindow, plainText, parseDate } from '../lib/normalize.mjs';
import { explicitTextDate, explicitTextEnd, clockTime } from './html.mjs';
import { extractCalendarSpans, resolveEventDateRoles } from '../lib/date-semantics.mjs';

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
 * Resolve a conference summary separately from agenda and auxiliary deadlines.
 * Agenda clock ranges do not establish the overall event start or end time.
 * @param {string} html Current public conference detail HTML.
 * @param {Object} plan Content and title selectors for that publisher layout.
 * @param {Object} context Collection window.
 * @return {Object} Dated occurrences with auditable semantic date roles.
 */
export function parseConsistentEventPage(html, plan, context = {}) {
  const $ = cheerio.load(html);
  const options = plan.options || {};
  $('script,style,noscript,nav,footer,aside,.sidebar,.related,[class*="related-"],[id*="related-"],.copyright').remove();
  $('h1,h2,h3,h4,h5,h6').each((_, node) => {
    if (!/^(?:related|recommended|more)\s+(?:news|events|articles)|^you may also\b/i.test(plainText($(node).text()))) return;
    const level = Number(node.name.slice(1));
    for (const sibling of $(node).nextAll().toArray()) {
      if (/^h[1-6]$/.test(sibling.name) && Number(sibling.name.slice(1)) <= level) break;
      $(sibling).remove();
    }
    $(node).remove();
  });
  const title = plainText($(options.detailTitleSelector).first().text());
  const content = $(options.detailContentSelector);
  const text = content.toArray().map(node => plainText($.html(node))).join('\n');
  const summary = [];
  const agenda = [];
  const sessions = [];
  const auxiliary = [];
  const auxiliaryPattern = /\b(?:hotel|booking|reservations?|discount|cut\s*-?\s*off|deadline|registration (?:closes?|ends?|due)|register by|transportation|shuttle)\b/i;
  const auxiliaryDatePattern = /\b(?:deadline|cut\s*-?\s*off|(?:registration|applications?|abstracts?|submissions?|tickets?|reservations?|bookings?)\s+(?:opens?|closes?|begins?|ends?|starts?|due)|(?:register|book|reserve)\s+by)\b/i;
  // Siblings immediately after the title are the published event synopsis. Stop
  // at the next section rather than scanning arbitrary narrative/footer dates.
  for (const node of $(options.detailTitleSelector).first().nextAll().toArray()) {
    if (/^h[1-6]$/.test(node.name) || node.name === 'table') break;
    const copy = $(node).clone();
    copy.find('h1,h2,h3,h4,h5,h6,table').remove();
    for (const line of plainText($.html(copy)).split(/\n|;\s*/).filter(Boolean)) {
      (auxiliaryDatePattern.test(line) ? auxiliary : summary).push(line);
    }
  }
  for (const node of content.find('h1,h2,h3,h4,h5,h6,table tr:first-child').toArray()) {
    const value = plainText($.html(node));
    if (value.length > 500 || !extractCalendarSpans(value).spans.length) continue;
    let section = '';
    for (let ancestor = $(node); ancestor.length && !ancestor.is(options.detailContentSelector); ancestor = ancestor.parent()) {
      const heading = ancestor.prevAll('h1,h2,h3,h4,h5,h6').first();
      if (heading.length) { section = heading.text(); break; }
    }
    if (auxiliaryPattern.test(`${section}\n${value}`)) auxiliary.push(value);
    else if (/^h[1-6]$/.test(node.name)) sessions.push(value);
    else agenda.push(value);
  }
  for (const node of content.find('p,li').toArray()) {
    const value = plainText($.html(node));
    if (auxiliaryDatePattern.test(value) && extractCalendarSpans(value).spans.length) auxiliary.push(value);
  }
  const dateAnalysis = resolveEventDateRoles({ title, summary: summary.join('\n'), agenda, sessions,
    auxiliary: [...new Set(auxiliary)], timeZone: options.timezone || 'America/New_York' });
  if (!title) { dateAnalysis.conflicts.push('The public conference title is absent'); dateAnalysis.decision = 'unresolved'; }
  if (dateAnalysis.conflicts.length) {
    return { events: [], recognized: 0, partial: true, dateAnalysis,
      warnings: [`Public conference date conflict or unresolved schedule (${plan.url}): ${dateAnalysis.conflicts.join('; ')}`] };
  }
  const occurrences = dateAnalysis.occurrences.map(occurrence => normalizeEvent({ title, start: occurrence.start,
    end: occurrence.end, url: plan.url, description: text }, plan));
  if (occurrences.some(event => !event)) return { events: [], recognized: 0, partial: true, dateAnalysis: { ...dateAnalysis, decision: 'invalid-fields' },
    warnings: [`Public conference date fields are invalid (${plan.url})`] };
  return { events: occurrences.filter(event => inWindow(event, context)), recognized: occurrences.length, warnings: [], dateAnalysis };
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
  const events = new Map();
  const warnings = [];
  const details = [];
  let partial = !links.length;
  let recognized = 0;
  if (!links.length) warnings.push('No advertised public conference detail links were found; directory structure needs review');
  for (let index = 0; index < links.length; index += 3) {
    await Promise.all(links.slice(index, index + 3).map(async url => {
      try {
        const result = parseConsistentEventPage(await context.fetchText(url), { ...plan, url }, context);
        recognized += result.recognized || 0;
        partial ||= Boolean(result.partial);
        warnings.push(...result.warnings);
        details.push({ url, status: result.partial ? result.dateAnalysis.decision === 'conflict' ? 'conflict' : 'unresolved' : 'parsed', recognized: result.recognized || 0,
          windowRecords: result.events.length, decision: result.dateAnalysis.decision, dateRoles: result.dateAnalysis.roles,
          occurrences: result.dateAnalysis.occurrences, conflicts: result.dateAnalysis.conflicts, notes: result.dateAnalysis.notes });
        for (const event of result.events) events.set(event.uid, event);
      } catch (error) { partial = true; warnings.push(`Public conference detail failed (${url}): ${error.message}`);
        const incomplete = /\b(?:budget|scan limit|detail limit|download limit|maximumBytes|timeoutMs|deadline|unprocessed|circuit)\b/i.test(error.message);
        details.push({ url, status: incomplete ? 'incomplete' : 'fetch-failed', recognized: 0, windowRecords: 0, conflicts: [error.message] }); }
    }));
  }
  details.sort((left, right) => links.indexOf(left.url) - links.indexOf(right.url));
  const processed = details.filter(detail => detail.status !== 'incomplete').length;
  const internalIssues = details.filter(detail => ['unresolved', 'incomplete'].includes(detail.status)).map(detail => ({
    code: detail.status === 'incomplete' ? 'detail-inspection-incomplete' : 'unresolved-date-semantics', url: detail.url, evidence: detail.conflicts }));
  if (!links.length) internalIssues.push({ code: 'advertised-links-not-found', url: base });
  const externalIssues = details.filter(detail => ['conflict', 'fetch-failed'].includes(detail.status)).map(detail => ({
    code: detail.status === 'conflict' ? 'publisher-date-conflict' : 'publisher-detail-fetch-failed', url: detail.url, evidence: detail.conflicts }));
  const nonBlockingIssues = details.filter(detail => detail.decision === 'explicit-series-sessions').map(detail => ({
    code: 'series-envelope-not-expanded', url: detail.url, evidence: 'Only separately advertised dated sessions are occurrences; a recurrence envelope does not invent additional sessions.' }));
  for (const detail of details) for (const note of detail.notes || []) nonBlockingIssues.push({ url: detail.url, ...note });
  return { events: [...events.values()], warnings, recognized, ...(partial ? { partial: true } : {}),
    coverage: { kind: 'semantic-linked-details', version: 1, inspectionComplete: links.length > 0 && processed === links.length && !internalIssues.length,
      internalIssues, externalIssues, nonBlockingIssues, discovered: links.length, processed, recognized,
      windowRecords: events.size, details } };
}
