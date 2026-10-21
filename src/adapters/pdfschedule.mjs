import * as cheerio from 'cheerio';
import { PDFParse } from 'pdf-parse';
import { absoluteUrl, normalizeEvent, inWindow } from '../lib/normalize.mjs';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Read dated recital sections and individual clock times from a public calendar.
 * Seasonal years must be printed in the document; class grids and colored
 * cancellation cells are excluded rather than interpreted from text alone.
 * @param {string} text Extracted PDF text.
 * @param {Object} plan Source with an explicit pdfSectionPattern allowlist.
 * @param {Object} context Optional ingestion date window.
 * @return {Object} Normalized recital starts and extraction diagnostics.
 */
export function parsePdfSchedule(text, plan, context = {}) {
  const pattern = plan.options?.pdfSectionPattern;
  if (!pattern) throw new Error('PDF schedule requires an explicit section pattern');
  const seasonalYears = new Map();
  for (const match of text.matchAll(/\b(Fall|Spring|Summer|Winter)\s+(20\d{2})\b/gi)) {
    const key = match[1].toLowerCase();
    const previous = seasonalYears.get(key);
    seasonalYears.set(key, seasonalYears.has(key) && previous !== match[2] ? null : match[2]);
  }
  const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const events = [];
  const warnings = [];
  let section = null;
  let recognized = 0;
  for (const line of lines) {
    const heading = line.match(new RegExp(pattern, 'i'));
    if (heading) { section = { title: line, year: seasonalYears.get(heading[1]?.toLowerCase()) }; continue; }
    if (/\bRecitals?\b/i.test(line)) { section = null; continue; }
    if (!section) continue;
    const date = line.match(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s*(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(.*)$/i);
    if (!date) continue;
    if (!section.year) { warnings.push(`No unambiguous printed year for ${section.title}`); continue; }
    const day = `${section.year}-${String(MONTHS[date[1].slice(0, 3).toLowerCase()]).padStart(2, '0')}-${date[2].padStart(2, '0')}`;
    for (const clock of date[3].matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi)) {
      if (+clock[1] < 1 || +clock[1] > 12 || +(clock[2] || 0) > 59) continue;
      const hour = +clock[1] % 12 + (clock[3].toLowerCase() === 'pm' ? 12 : 0);
      const event = normalizeEvent({ title: section.title, start: `${day}T${String(hour).padStart(2, '0')}:${clock[2] || '00'}:00`,
        url: plan.fetchUrl || plan.url, description: `${section.title}\n${line}` }, plan);
      if (!event) continue;
      recognized++;
      if (inWindow(event, context)) events.push(event);
    }
  }
  if (!recognized) warnings.push('No recital sections with printed season-year, date and clock time were found');
  return { events, warnings, recognized, unsupported: !recognized, ...(warnings.length ? { partial: true } : {}) };
}

/**
 * Discover the currently advertised public PDF and read its allowed sections.
 * @param {string} html Source calendar landing page.
 * @param {Object} plan HTML source containing pdfLinkSelector and section pattern.
 * @param {Object} context Safe fetchBytes callback and date window.
 * @return {Promise<Object>} Grounded calendar events and diagnostics.
 */
export async function fetchPdfSchedule(html, plan, context) {
  const $ = cheerio.load(html);
  const href = $(plan.options.pdfLinkSelector).first().attr('href');
  const url = href && absoluteUrl(href, plan.fetchUrl || plan.url);
  if (!url || !/\.pdf(?:[?#]|$)/i.test(url)) return { events: [], warnings: ['Advertised schedule PDF link was not found'], unsupported: true };
  const parser = new PDFParse({ data: new Uint8Array(await context.fetchBytes(url)) });
  try {
    const { text } = await parser.getText();
    return parsePdfSchedule(text, { ...plan, fetchUrl: url }, context);
  } finally { await parser.destroy(); }
}
