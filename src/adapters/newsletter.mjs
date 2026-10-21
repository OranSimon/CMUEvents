import * as cheerio from 'cheerio';
import { absoluteUrl, normalizeEvent, inWindow, plainText } from '../lib/normalize.mjs';
import { explicitTextDate, explicitTextEnd, parseNewsletter } from './html.mjs';

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
 * @return {Promise<Object>} Parsed issue result.
 */
async function fetchIssue(url, plan, context) {
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
  const initial = parseNewsletter(html, plan, context);
  const $ = cheerio.load(html);
  const selector = plan.options?.issueLinkSelector;
  if (!selector) return initial;
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
