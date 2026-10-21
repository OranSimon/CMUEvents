import * as cheerio from 'cheerio';
import { absoluteUrl, normalizeEvent, inWindow, plainText } from '../lib/normalize.mjs';
import { explicitTextDate, explicitTextEnd, parseNewsletter } from './html.mjs';

const SHORT_DATE = /\b((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2}(?:st|nd|rd|th)?)?)(?:\s*,?\s*(20\d{2}))?/i;

/**
 * Read an issue's year/month context without treating its publication as an event.
 * Wrapper issue pages can pass their explicit heading context to linked emails.
 * @param {Function} $ Parsed issue document.
 * @param {Object} plan Issue configuration and optional inherited issue context.
 * @return {{year:number|null,month:number|null}} Explicit issue year and month.
 */
function issueContext($, plan) {
  if (plan.options?.contextIssueYear) return { year: +plan.options.contextIssueYear, month: +plan.options.contextIssueMonth || null };
  const heading = $('h1,title').text();
  const monthYear = heading.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(20\d{2})\b/i);
  const header = ['piper', 'emma'].includes(plan.options?.emailLayout)
    ? `${heading}\n${plainText($('body').html()).slice(0, 800)}` : heading;
  const explicit = explicitTextDate(header);
  if (monthYear) return { year: +monthYear[2], month: ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(monthYear[1].toLowerCase()) + 1 };
  return { year: explicit ? +explicit.slice(0, 4) : null, month: explicit ? +explicit.slice(5, 7) : null };
}

/**
 * Resolve one event-local short date against an explicitly dated issue header.
 * @param {string} text Event-local date text, never the whole issue.
 * @param {Object} issue Explicit issue year/month context.
 * @return {string|null} Date text with a verified/contextual year, or null.
 */
function contextualDate(text, issue) {
  const clean = plainText(text).replace(/\uFEFF/g, '').replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1').replace(/\bnoon\b/gi, '12 p.m.').replace(/\bmidnight\b/gi, '12 a.m.');
  const match = clean.match(SHORT_DATE);
  if (!match) return null;
  if (match[2]) return clean.slice(match.index);
  if (!issue.year) return null;
  const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
  let year = issue.year;
  if (issue.month === 12 && month === 1) year++;
  if (issue.month === 1 && month === 12) year--;
  return `${match[1]}, ${year}${clean.slice(match.index + match[0].length)}`;
}

/**
 * Read a shared session clock only from its explicit event-local prefix line.
 * @param {string} prefix Accessible text before this card's first Date field.
 * @return {string|null} Published shared clock range and optional timezone.
 */
function sharedSessionClock(prefix) {
  return prefix.match(/(?:^|\n)[*\s]*All Sessions(?: are)?(?: Virtual| Online| In Person)?\s*[~:–-]\s*(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?\s*[-–]\s*\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?(?:\s+(?:ET|EST|EDT|PT|PST|PDT))?)[*\s]*(?:\n|$)/i)?.[1] || null;
}

/**
 * Extract dates from verified newsletter email layouts and accessible image labels.
 * Dates remain local to individual cards/list items; issue dates provide years only.
 * @param {string} html Public email issue HTML.
 * @param {Object} plan Issue source and explicit emailLayout option.
 * @param {Object} context Ingestion date window.
 * @return {Object} Normalized dated events and layout diagnostics.
 */
export function parseNewsletterEmail(html, plan = {}, context = {}) {
  const $ = cheerio.load(html);
  const issue = issueContext($, plan);
  const events = new Map();
  const warnings = [];
  let recognized = 0;
  let contextualYears = 0;

  /**
   * Normalize a verified local event block, retaining date-only precision.
   * @param {string} title Published event title or a readable source-text excerpt.
   * @param {string} dateText Local date/time text.
   * @param {string} description Published event description.
   * @param {string} url Original event/issue link.
   * @param {Object} extra Explicit event fields and a verified shared session clock.
   * @return {void}
   */
  function add(title, dateText, description, url, extra = {}) {
    const { sharedClock, ...eventFields } = extra;
    if (/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?\s*(?:to|[-–])\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2}/i.test(dateText)) {
      warnings.push('A newsletter event has a cross-month range outside the verified date contract; it was not collapsed to one day');
      return;
    }
    let resolved = contextualDate(dateText, issue);
    if (!resolved || !title || title.length < 5) return;
    const firstDate = resolved.match(SHORT_DATE);
    const afterDate = firstDate.index + firstDate[0].length;
    const followingDate = resolved.slice(afterDate).match(SHORT_DATE);
    if (followingDate) resolved = resolved.slice(0, afterDate + followingDate.index);
    const start = explicitTextDate(resolved);
    if (!start) return;
    if (!SHORT_DATE.exec(dateText)?.[2]) contextualYears++;
    const timeText = resolved.match(/\bProgram:\s*([^\n]+)/i)?.[1] || resolved.match(/\bTime:\s*([^\n]+)/i)?.[1] || resolved.match(/\bLunch:\s*([^\n]+)/i)?.[1] || sharedClock;
    const dayRange = /\d\s*[-–]\s*\d/.test(firstDate[1]);
    const timedStart = dayRange ? start.slice(0, 10) : timeText ? explicitTextDate(`${start.slice(0, 10)} at ${timeText}`) : start;
    const timezone = /\bP[SD]?T\b/.test(`${resolved}\n${sharedClock || ''}`) ? 'America/Los_Angeles' : plan.options?.timezone;
    const event = normalizeEvent({ title, start: timedStart, end: explicitTextEnd(dayRange ? resolved : timeText || resolved, timedStart), description, url: url || plan.url, ...eventFields },
      { ...plan, options: { ...plan.options, timezone } });
    if (!event) return;
    recognized++;
    if (inWindow(event, context)) events.set(event.uid, event);
  }

  if (plan.options?.emailLayout === 'piper') {
    $('img[alt]').each((_, image) => {
      const date = $(image).attr('alt') || '';
      if (!new RegExp(`^${SHORT_DATE.source}$`, 'i').test(date.trim())) return;
      const row = $(image).parents('tr').toArray().find(element => {
        const scope = $(element);
        const images = scope.find('img[alt]').toArray().filter(node => SHORT_DATE.test($(node).attr('alt') || ''));
        return images.length && images.length === scope.find('b a[href],strong a[href]').length;
      });
      if (!row) return;
      const scope = $(row);
      const images = scope.find('img[alt]').toArray().filter(node => SHORT_DATE.test($(node).attr('alt') || ''));
      const link = scope.find('b a[href],strong a[href]').eq(images.indexOf(image));
      const body = plainText(link.closest('td').html());
      const title = link.text().trim();
      const lines = body.split('\n').map(line => line.trim()).filter(Boolean);
      const clock = lines.find(line => /^(?:All Day|Noon|Midnight|\d{1,2}(?::\d{2})?\s*(?:[-–]|[ap]\.?m))/i.test(line)) || '';
      add(title, `${date} ${clock}`, body, absoluteUrl(link.attr('href'), plan.url), { allDay: /^all day/i.test(clock) });
    });
    $('td.camarker-inner').each((_, element) => {
      const scope = $(element);
      const intro = plainText(scope.children('div').first().html());
      if (!/town halls?|workshops?|sessions?/i.test(intro)) return;
      scope.find('li').each((__, item) => {
        const link = $(item).find('a[href]').first();
        const date = plainText($(item).html());
        if (!SHORT_DATE.test(date)) return;
        const title = intro.match(/\b(Faculty and Staff Town Halls?)\b/i)?.[1] || intro.split(/(?<=[.!?])\s/)[0].slice(0, 180);
        add(title, date, `${intro}\n${date}`, absoluteUrl(link.attr('href'), plan.url));
      });
    });
  }

  if (plan.options?.emailLayout === 'constant-contact') {
    $('td.text_content-cell').each((_, element) => {
      const scope = $(element);
      const first = scope.find('p').first();
      const bold = first.find('strong,b,span[style*="font-weight: bold"]').first().text().trim();
      const title = bold || first.text().trim().split(/(?<=[.!?])\s/)[0];
      const body = plainText(scope.html());
      const link = absoluteUrl(scope.find('a[href]').first().attr('href'), plan.url);
      let listed = false;
      scope.find('li').each((__, item) => {
        const text = plainText($(item).html()).replace(/\uFEFF/g, '');
        if (/^(?:registration|submission|application)?\s*deadline/i.test(text)) return;
        if (!/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*[, ]+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|^(?:Information Session|IronViz Hackathon):/i.test(text)) return;
        const prefix = text.match(/^([^:]+):\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i)?.[1];
        const href = $(item).find('a[href]').first().attr('href');
        add(prefix ? `${title}: ${prefix}` : title, text, body, href ? absoluteUrl(href, plan.url) : link);
        listed = true;
      });
      if (!listed) scope.find('p').each((__, paragraph) => {
        const text = plainText($(paragraph).html());
        if (!/^(?:The first .{0,80} event is on\b|Info Session:)/i.test(text)) return;
        const paragraphTitle = /^Info Session:/i.test(text) ? text.split(/\bat an info session on\b/i)[0].trim() : title;
        const href = $(paragraph).find('a[href]').first().attr('href');
        add(paragraphTitle, text, body, href ? absoluteUrl(href, plan.url) : link);
        listed = true;
      });
      if (!listed && /\b(?:talk|competition|workshop|lecture|seminar|webinar|celebration)\b/i.test(title || '') && /\bon\s+(?:Mon\w*[, ]+|Tue\w*[, ]+|Wed\w*[, ]+|Thu\w*[, ]+|Fri\w*[, ]+|Sat\w*[, ]+|Sun\w*[, ]+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d/i.test(body)) {
        add(title, body, body, link);
      }
    });
  }

  if (plan.options?.emailLayout === 'emma') {
    $('.e2ma-content-block').each((_, element) => {
      const scope = $(element);
      const body = plainText(scope.html());
      const dateIndex = body.search(/\bDate:\s*/i);
      if (dateIndex < 0) return;
      const prefix = body.slice(0, dateIndex).trim();
      const lines = body.slice(dateIndex).split('\n').map(line => line.trim()).filter(Boolean);
      const excerpt = lines.find(line => !/^(?:Date|Time|Program|Lunch|Location):|^Register$|^ET$|^PST$/i.test(line));
      const title = prefix || excerpt?.slice(0, 180).replace(/\s+\S*$/, '');
      if (!prefix && /\b(?:Interest Form|Application Deadline|Register by)\b/i.test(title || '')) {
        warnings.push('A dated event uses an image-only title and only a separate application form is readable; no title was invented');
        return;
      }
      if (!title) { warnings.push('An email event poster has no accessible text title; its dated block was retained for review rather than inventing a title'); return; }
      const outer = scope.closest('table.e2ma-block-outer');
      const registration = outer.nextAll('table.e2ma-block-outer').first().find('a[href]').first();
      const link = scope.find('a[href]').first();
      add(title, lines.join('\n'), body, absoluteUrl(registration.attr('href') || link.attr('href'), plan.url), { sharedClock: sharedSessionClock(prefix) });
    });
  }
  if (!recognized) warnings.push('No separately dated event sections were recognized in the verified public email layout; its publication date was not substituted');
  if (contextualYears) warnings.push(`${contextualYears} event year(s) resolved from an explicit issue heading/header; the publication day was not used as an event date`);
  return { events: [...events.values()], warnings, recognized, unsupported: recognized === 0 };
}

/**
 * Extract individually dated event blocks from a newsletter's plain PDF text.
 * Missing event years are resolved only from an explicit issue-header year.
 * @param {string} text Extracted PDF text, optionally containing Markdown links.
 * @param {Object} plan Source issue URL and timezone options.
 * @param {Object} context Date window.
 * @return {{events:Object[],warnings:string[]}} Section events and contextual-year diagnostics.
 */
export function parseNewsletterText(text, plan = {}, context = {}) {
  const lines = text.replace(/\u0000/g, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const header = lines.slice(0, 6).join(' ');
  const issueDate = explicitTextDate(header);
  const issueYear = issueDate?.slice(0, 4);
  const issueMonth = issueDate ? +issueDate.slice(5, 7) : null;
  const events = [];
  const warnings = [];
  let contextualYears = 0;
  let recognized = 0;
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    if (!/^(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)?[, ]*\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2}\b/i.test(line)) continue;
    let datedLine = line;
    if (!/\b20\d{2}\b/.test(line) && issueYear) {
      const datePart = line.match(/^((?:\w+[, ]+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?)/i);
      if (!datePart) continue;
      let year = +issueYear;
      const monthIndex = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(datePart[1].match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i)[0].toLowerCase()) + 1;
      if (issueMonth === 12 && monthIndex === 1) year++;
      if (issueMonth === 1 && monthIndex === 12) year--;
      datedLine = `${datePart[1]}, ${year}${line.slice(datePart[0].length)}`;
      contextualYears++;
    }
    const start = explicitTextDate(datedLine);
    if (!start) continue;
    // The immediately preceding short heading is event-local. Collect wrapped
    // heading lines, stopping at a prior link, date, sentence or section heading.
    const titleLines = [];
    for (let previous = index - 1; previous >= Math.max(0, index - 3); previous--) {
      const candidate = lines[previous];
      if (/Learn More|View in Browser|https?:|News & Events|Our Pittsburgh Picks|[.!?]$|^--|^Have an announcement/i.test(candidate)
        || explicitTextDate(candidate) || candidate.length > 90) break;
      titleLines.unshift(candidate);
      if (candidate.endsWith(':')) break;
    }
    const title = titleLines.join(' ').trim();
    if (title.length < 5 || /friday greetings|hello|view in browser/i.test(title)) continue;
    const body = [];
    for (let following = index + 1; following < Math.min(lines.length, index + 18); following++) {
      const candidate = lines[following];
      if (/Learn More|Have an announcement|^--|Our Pittsburgh Picks|News & Events/.test(candidate)) { body.push(candidate); break; }
      if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d/i.test(candidate)) break;
      body.push(candidate);
    }
    const combined = body.join(' ');
    const link = combined.match(/\]\((https?:\/\/[^)]+)\)/)?.[1] || combined.match(/https?:\/\/\S+/)?.[0] || plan.url;
    const event = normalizeEvent({ title, start, end: explicitTextEnd(datedLine, start),
      description: `${datedLine}\n${combined.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')}`, url: link }, plan);
    if (event) {
      recognized++;
      if (inWindow(event, context)) events.push(event);
    }
  }
  if (contextualYears) warnings.push(`${contextualYears} newsletter event year(s) resolved from the explicit issue header; publication day was not used as an event date`);
  if (!recognized) warnings.push('No individually dated event blocks could be safely extracted from the PDF newsletter');
  return { events, warnings, unsupported: recognized === 0 };
}

/**
 * Fetch a newsletter issue; PDF extraction uses only already fetched bytes.
 * @param {string} url Public issue URL.
 * @param {Object} plan Newsletter source configuration.
 * @param {Object} context Safe text/byte fetch callbacks and date window.
 * @param {number} depth Number of public issue-wrapper links already followed.
 * @return {Promise<Object>} Parsed issue result.
 */
async function fetchIssue(url, plan, context, depth = 0) {
  const issuePlan = { ...plan, url, fetchUrl: url };
  if (/\.pdf(?:[?#]|$)/i.test(url) || plan.options?.issueFormat === 'pdf') {
    if (!context.fetchBytes) return { events: [], warnings: ['PDF newsletter requires the fetchBytes callback'], unsupported: true };
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(await context.fetchBytes(url)) });
    try {
      const result = await parser.getText({ parseHyperlinks: true });
      return parseNewsletterText(result.text, issuePlan, context);
    } finally { await parser.destroy(); }
  }
  const html = await context.fetchText(url);
  if (plan.options?.issueContentLinkSelector && depth < 1) {
    const $ = cheerio.load(html);
    const target = absoluteUrl($(plan.options.issueContentLinkSelector).first().attr('href'), url);
    if (target && target !== url) {
      const issue = issueContext($, issuePlan);
      return fetchIssue(target, { ...issuePlan, options: { ...issuePlan.options, contextIssueYear: issue.year, contextIssueMonth: issue.month } }, context, depth + 1);
    }
  }
  if (plan.options?.emailLayout) return parseNewsletterEmail(html, issuePlan, context);
  const result = parseNewsletter(html, issuePlan, context);
  if (!result.unsupported) return result;
  const $ = cheerio.load(html);
  $('a[href]').each((_, element) => {
    const link = absoluteUrl($(element).attr('href'), url);
    if (link) $(element).replaceWith(`[${$(element).text()}](${link})`);
  });
  const fallback = parseNewsletterText(plainText($.html()), issuePlan, context);
  return !fallback.unsupported ? fallback : result;
}

/**
 * Discover recent public newsletter issues and extract their separate events.
 * @param {Object} plan Archive URL and issue discovery selector.
 * @param {Object} context Safe fetch callbacks and date window.
 * @return {Promise<Object>} Normalized events and issue-specific diagnostics.
 */
export async function fetchNewsletter(plan, context) {
  if (/\.pdf(?:[?#]|$)/i.test(plan.fetchUrl || plan.url)) return fetchIssue(plan.fetchUrl || plan.url, plan, context);
  const html = await context.fetchText(plan.fetchUrl || plan.url);
  const selector = plan.options?.issueLinkSelector;
  if (!selector) return parseNewsletter(html, plan, context);
  // A configured archive is only an issue index. Its year headings and issue
  // publication links are never interpreted as event sections.
  const initial = { events: [], unsupported: true };
  const $ = cheerio.load(html);
  const links = [];
  $(selector).each((_, element) => {
    const url = absoluteUrl($(element).attr('href'), plan.fetchUrl || plan.url);
    if (url && !links.includes(url)) links.push(url);
  });
  const maxIssues = Math.min(plan.options?.maxIssues || 2, 12);
  const events = new Map(initial.events.map(event => [event.uid, event]));
  let supported = !initial.unsupported;
  let partial = false;
  const warnings = [];
  if (!links.length) warnings.push('Newsletter archive has no matching public issue links');
  // CMU archives are newest-first; plans may explicitly reverse oldest-first lists.
  const recent = (plan.options?.issuesOldestFirst ? links.reverse() : links).slice(0, maxIssues);
  for (const url of recent) {
    try {
      const result = await fetchIssue(url, plan, context);
      if (!result.unsupported) supported = true;
      if (result.unsupported || result.partial) partial = true;
      for (const event of result.events) events.set(event.uid, event);
      warnings.push(...result.warnings.map(warning => `${url}: ${warning}`));
    } catch (error) { partial = true; warnings.push(`Newsletter issue failed (${url}): ${error.message}`); }
  }
  return { events: [...events.values()], warnings, unsupported: !supported, ...(partial ? { partial: true } : {}) };
}
