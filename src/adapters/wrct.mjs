import * as cheerio from 'cheerio';
import { absoluteUrl, inWindow, normalizeEvent, plainText } from '../lib/normalize.mjs';
import { explicitTextDate, explicitTextEnd } from './html.mjs';

/**
 * Parse WRCT's public music date-group tables and current radio announcements.
 * The music table writes its event year explicitly as YY; radio short dates use
 * only the separately printed Updated MM/DD/YYYY year, never its update day.
 * @param {string} html Public WRCT calendar page.
 * @param {Object} plan Source URL, local timezone and explicit century contract.
 * @param {Object} context Optional ingestion window.
 * @return {Object} Individually dated schedule records and diagnostics.
 */
export function parseWrct(html, plan = {}, context = {}) {
  const $ = cheerio.load(html);
  const events = new Map();
  const warnings = [];
  let recognized = 0;

  /**
   * Add a safely dated event while retaining its original calendar page.
   * @param {Object} input Event-local title, date, time and published venue.
   * @return {void}
   */
  function add(input) {
    const event = normalizeEvent({ ...input, url: input.url || plan.fetchUrl || plan.url }, plan);
    if (!event) return;
    recognized++;
    if (inWindow(event, context)) events.set(event.uid, event);
  }

  if (/music-calendar/.test(plan.fetchUrl || plan.url || '')) {
    let date = null;
    $('table tr').each((_, element) => {
      const row = $(element);
      const cells = row.children('td');
      const header = cells.length === 1 ? row.text().match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{2})-(\d{2})-(\d{2}|20\d{2})\b/i) : null;
      if (header) {
        const year = header[3].length === 4 ? header[3] : String((plan.options?.yearCentury || 2000) + +header[3]);
        date = `${year}-${header[1]}-${header[2]}`;
      } else if (date && cells.length === 3 && /^\d{1,2}:\d{2}\s*[ap]m$/i.test(cells.eq(0).text().trim())) {
        add({ title: cells.eq(2).text(), start: explicitTextDate(`${date} at ${cells.eq(0).text()}`), location: cells.eq(1).text(), description: plainText(row.html()) });
      }
    });
  } else {
    const updated = $('body').text().match(/Updated:\s*\d{1,2}\/\d{1,2}\/(20\d{2})/i);
    const year = updated?.[1];
    let currentSection = false;
    $('h3,h4,p:has(> strong),p:has(> b)').each((_, element) => {
      const heading = $(element);
      const title = heading.text().trim();
      if (/CURRENT COMMUNITY EVENTS/.test(title)) { currentSection = true; return; }
      if (/ONGOING COMMUNITY EVENTS|FREE MUSEUMS/.test(title)) { currentSection = false; return; }
      if (!heading.is('h4') || !currentSection || !title || !year) return;
      const blocks = heading.nextUntil('h3,h4').filter('p');
      blocks.each((__, paragraph) => {
        const text = plainText($(paragraph).html());
        const pattern = /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:to|[-–])\s*(\d{1,2})(?:st|nd|rd|th)?)?/gi;
        for (const match of text.matchAll(pattern)) {
          const tail = text.slice(match.index + match[0].length);
          const dated = `${match[1]} ${match[2]}${match[3] ? `–${match[3]}` : ''}, ${year}${tail}`;
          const start = explicitTextDate(dated);
          const venue = text.match(/\bat\s+(.+?)(?:\.(?=\s+(?:That|It|The)|$)|\s+from\s+\d)/i)?.[1] || '';
          const label = /BLOOD DRIVES/.test(title) && venue ? `${title} — ${venue}` : title;
          add({ title: label, start, end: explicitTextEnd(dated, start), description: text, location: venue,
            url: absoluteUrl($(paragraph).find('a[href]').first().attr('href'), plan.fetchUrl || plan.url) });
        }
      });
    });
    if (!year) warnings.push('Radio calendar does not print an Updated year; short event dates were not assigned a guessed year');
  }
  if (!recognized) warnings.push('The verified WRCT calendar layout contains no independently dated entries');
  return { events: [...events.values()], warnings, recognized, unsupported: recognized === 0 };
}

/**
 * Fetch one verified WRCT radio/music calendar through the shared safe client.
 * @param {Object} plan Public calendar URL and layout options.
 * @param {Object} context Safe fetchText callback and ingestion window.
 * @return {Promise<Object>} Parsed dated public schedule.
 */
export async function fetchWrct(plan, context) {
  return parseWrct(await context.fetchText(plan.fetchUrl || plan.url), plan, context);
}
