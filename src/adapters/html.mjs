import * as cheerio from 'cheerio';
import { absoluteUrl, normalizeEvent, inWindow, plainText, addDays, parseDate } from '../lib/normalize.mjs';
import { fetchIcs } from './ics.mjs';
import { fetchPdfSchedule } from './pdfschedule.mjs';
import { fetchReviewedImages, parseReviewedFragments } from './reviewed-images.mjs';
import { parseGeneratedCalendar } from './generated-calendar.mjs';
import { parseReviewedResources } from './reviewed-resources.mjs';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Canonicalize adjacent-day prose ranges without creating intermediate meetings.
 * Nonadjacent date lists remain unsupported instead of becoming a continuous span.
 * @param {string} text Published date text.
 * @return {string} Equivalent bounded date-range text.
 */
function normalizeDateLists(text) {
  return text.replace(/(?<!\d)([A-Za-z])(?=\d)/g, '$1 ')
    .replace(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?)\s+(\d{1,2})(?:st|nd|rd|th)?\s+and\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/gi,
    (match, month, first, last, year) => +last === +first + 1 ? `${month} ${first}–${last}, ${year}` : match)
    .replace(/([-–])\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(?=(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d)/gi, '$1 ');
}

/**
 * Exclude binary assets from HTML detail crawling; newsletters own their PDF path.
 * @param {string} value Resolved public candidate URL.
 * @return {boolean} Whether the URL can plausibly contain an HTML event page.
 */
function htmlDetailUrl(value) {
  try {
    const pathname = decodeURIComponent(new URL(value).pathname);
    return !/\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp|pdf|ics|ical|zip|gz|tar|rar|7z|docx?|xlsx?|pptx?|odt|ods|odp|csv|mp[34]|mov|webm|wav|ogg|woff2?|ttf|eot)$/i.test(pathname);
  } catch { return false; }
}

/**
 * Read a source-local clock time, including a range with a shared AM/PM marker.
 * @param {string} value Text after an explicit calendar date.
 * @return {string|null} Local HH:MM:SS value.
 */
export function clockTime(value) {
  const marker = '(a\\.?m\\.?|p\\.?m\\.?)';
  const range = value.match(new RegExp(`(?:\\bat\\s+|\\bfrom\\s+|[,|]\\s*|^\\s*)(\\d{1,2})(?::(\\d{2}))?\\s*${marker}?\\s*(?:to|[-–])\\s*\\d{1,2}(?::\\d{2})?\\s*${marker}`, 'i'));
  const single = value.match(new RegExp(`(?:\\bat\\s+|\\bfrom\\s+|[,|]\\s*|^\\s*)(\\d{1,2})(?::(\\d{2}))?\\s*${marker}`, 'i'));
  const time = range || single;
  if (!time || +time[1] < 1 || +time[1] > 12) return null;
  const ampm = range ? time[3] || time[4] : time[3];
  const hour = +time[1] % 12 + (/^p/i.test(ampm) ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${time[2] || '00'}:00`;
}

/**
 * Find an explicitly written calendar date, refusing to infer missing years.
 * A time is used only when present; date-only events retain that precision.
 * @param {string} value Event-local text.
 * @return {string|null} ISO date or local ISO datetime for later zone conversion.
 */
export function explicitTextDate(value) {
  const text = normalizeDateLists(plainText(value).replace(/\s+/g, ' ').replace(/(?<!\d)([A-Za-z])(?=\d)/g, '$1 ')
    .replace(/,\s*(?=20\d{2}\b)/g, ', '));
  const iso = text.match(/\b(20\d{2}[-/]\d{2}[-/]\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?)?\b/);
  if (iso) {
    const date = iso[1].replaceAll('/', '-');
    const humanPrefix = text.slice(iso.index + iso[1].length).replace(/^[\s(.;·]+/, '')
      .match(/^(?:at\s+|from\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?(?:\s*(?:to|[-–])\s*\d{1,2}(?::\d{2})?\s*)?(?:a\.?m\.?|p\.?m\.?)(?!\w)/i);
    const humanClock = humanPrefix ? clockTime(humanPrefix[0]) : null;
    if (humanClock) return `${date}T${humanClock}`;
    if (iso[2]) return `${date}T${iso[2].padStart(2, '0')}:${iso[3]}:${iso[4] || '00'}${iso[5] || ''}`;
    return date;
  }
  const crossRange = text.match(/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s*[-–]\s*\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(20\d{2})\b/i);
  if (crossRange) return `${crossRange[3]}-${String(MONTHS[crossRange[2].slice(0, 3).toLowerCase()]).padStart(2, '0')}-${crossRange[1].padStart(2, '0')}`;
  const dayRange = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*[-–]\s*\d{1,2}(?:st|nd|rd|th)?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?[,]?\s+(20\d{2})\b/i);
  if (dayRange) return `${dayRange[3]}-${String(MONTHS[dayRange[2].slice(0, 3).toLowerCase()]).padStart(2, '0')}-${dayRange[1].padStart(2, '0')}`;
  const monthRange = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*[-–]\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/i);
  if (monthRange) {
    const first = `${monthRange[5]}-${String(MONTHS[monthRange[1].toLowerCase()]).padStart(2, '0')}-${monthRange[2].padStart(2, '0')}`;
    const last = `${monthRange[5]}-${String(MONTHS[monthRange[3].toLowerCase()]).padStart(2, '0')}-${monthRange[4].padStart(2, '0')}`;
    return parseDate(first) && parseDate(last) && first <= last ? first : null;
  }
  const month = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2}(?:st|nd|rd|th)?)?[,]?\s+(20\d{2})\b/i);
  const dayFirst = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?[,]?\s+(20\d{2})\b/i);
  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (!month && !numeric && !dayFirst) return null;
  const matched = month || dayFirst || numeric;
  const year = matched[3];
  const monthNumber = month ? MONTHS[month[1].slice(0, 3).toLowerCase()] : dayFirst ? MONTHS[dayFirst[2].slice(0, 3).toLowerCase()] : +numeric[1];
  const day = month ? month[2] : dayFirst ? dayFirst[1] : numeric[2];
  const date = `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const tail = text.slice(matched.index + matched[0].length).replace(/^[\s(.;·]+/, '');
  const clock = clockTime(tail);
  return clock ? `${date}T${clock}` : date;
}

/**
 * Read an explicit same-month day range or same-day clock range from source text.
 * Date ranges are inclusive in prose and converted to an exclusive all-day end.
 * @param {string} value Event-local date text with an explicit/contextual year.
 * @param {string} start Parsed start date or local datetime.
 * @return {string|null} Exclusive date-only end or local datetime end.
 */
export function explicitTextEnd(value, start) {
  if (!start) return null;
  const text = normalizeDateLists(plainText(value).replace(/\s+/g, ' ').replace(/,\s*(?=20\d{2}\b)/g, ', '));
  if (start.length === 10) {
    const writtenRange = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\s*(?:[-–]|to)\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/i);
    if (writtenRange) {
      const firstDay = `${writtenRange[3]}-${String(MONTHS[writtenRange[1].toLowerCase()]).padStart(2, '0')}-${writtenRange[2].padStart(2, '0')}`;
      const lastDay = `${writtenRange[6]}-${String(MONTHS[writtenRange[4].toLowerCase()]).padStart(2, '0')}-${writtenRange[5].padStart(2, '0')}`;
      return firstDay === start && parseDate(lastDay) && lastDay >= start ? addDays(lastDay) : null;
    }
    const monthRange = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*[-–]\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/i);
    if (monthRange) {
      const firstDay = `${monthRange[5]}-${String(MONTHS[monthRange[1].toLowerCase()]).padStart(2, '0')}-${monthRange[2].padStart(2, '0')}`;
      const lastDay = `${monthRange[5]}-${String(MONTHS[monthRange[3].toLowerCase()]).padStart(2, '0')}-${monthRange[4].padStart(2, '0')}`;
      return firstDay === start && parseDate(lastDay) && lastDay >= start ? addDays(lastDay) : null;
    }
    const crossRange = text.match(/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s*[-–]\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(20\d{2})\b/i);
    if (crossRange) return addDays(`${crossRange[3]}-${String(MONTHS[crossRange[2].toLowerCase()]).padStart(2, '0')}-${crossRange[1].padStart(2, '0')}`);
    const dayRange = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*[-–]\s*(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?[,]?\s+(20\d{2})\b/i);
    if (dayRange && +dayRange[1] === +start.slice(8, 10) && MONTHS[dayRange[3].toLowerCase()] === +start.slice(5, 7) && dayRange[4] === start.slice(0, 4) && +dayRange[2] >= +dayRange[1] && +dayRange[2] <= 31) return addDays(`${start.slice(0, 8)}${dayRange[2].padStart(2, '0')}`);
    const range = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*[-–]\s*(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(20\d{2})\b/i);
    if (range && +range[2] === +start.slice(8, 10) && MONTHS[range[1].toLowerCase()] === +start.slice(5, 7) && range[4] === start.slice(0, 4) && +range[3] >= +range[2] && +range[3] <= 31) {
      const lastDay = `${start.slice(0, 8)}${range[3].padStart(2, '0')}`;
      return addDays(lastDay);
    }
    return null;
  }
  const endTime = text.match(/\bto\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)|[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i);
  if (!endTime) return null;
  const hour = endTime[1] || endTime[4];
  const minute = endTime[2] || endTime[5] || '00';
  const marker = endTime[3] || endTime[6];
  const clock = clockTime(`${hour}:${minute} ${marker}`);
  if (!clock) return null;
  const date = `${start.slice(0, 10)}T${clock}`;
  return date < start ? `${addDays(start.slice(0, 10))}T${clock}` : date;
}

/**
 * Select descendants or the explicitly configured container itself.
 * @param {Object} item Cheerio event container.
 * @param {string} selector Configured selector.
 * @return {Object} Matching Cheerio nodes.
 */
function within(item, selector) {
  return selector === ':scope' ? item : item.find(selector);
}

/**
 * Expand abbreviated dates only using the page's selected explicit year header.
 * @param {string} value Event-local text.
 * @param {Object} options Source selector options.
 * @param {Function} $ Cheerio document.
 * @return {string} Text with a grounded calendar year, if available.
 */
function contextualDate(value, options, $, item) {
  let text = value.replace(/([A-Za-z])(?=\d)/g, '$1 ');
  if (options.consecutiveDateList) {
    text = text.replace(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?)\s+(\d{1,2})\s*,\s*(\d{1,2})\s*&\s*(\d{1,2})\b/gi,
      (original, month, first, second, last) => +second === +first + 1 && +last === +second + 1 ? `${month} ${first}–${last}` : original);
  }
  if ((!options.yearSelector && !options.yearWithinCardSelector) || explicitTextDate(text)) return text;
  let header = options.yearWithinCardSelector ? within(item, options.yearWithinCardSelector).toArray().map(element => $(element).text() || $(element).attr('alt') || '').join(' ') : $(options.yearSelector).first().text();
  header = header.replace(/\b(20\d{2})\s*[-–]\s*(\d{2})\b/g, (_, first, last) => `${first}-${first.slice(0, 2)}${last}`);
  const years = header.match(/\b20\d{2}\b/g) || [];
  if (!years.length) return text;
  let year = years[0];
  const month = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2}(?:st|nd|rd|th)?)?/i);
  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}))?\b/);
  const monthNumber = month ? MONTHS[month[1].toLowerCase()] : numeric ? +numeric[1] : null;
  if (options.academicYearStartMonth && years.length === 2 && +years[1] === +years[0] + 1 && monthNumber) {
    year = monthNumber < options.academicYearStartMonth ? years[1] : years[0];
  }
  if (numeric && (!numeric[3] || numeric[3] === year.slice(2))) {
    return text.replace(numeric[0], `${numeric[1]}/${numeric[2]}/${year}`);
  }
  if (month) text = text.replace(month[0], `${month[0]}, ${year}`);
  return text;
}

/**
 * Read a date encoded in an explicitly selected event link, without footer years.
 * @param {string} url Original event URL.
 * @return {string|null} Explicit ISO date or validated year/MMDDYY archive date.
 */
function linkedDate(url) {
  const path = new URL(url).pathname;
  const iso = path.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const archive = path.match(/\/(20\d{2})\/(\d{2})(\d{2})(\d{2})\.(?:s?html?)$/i);
  return archive && archive[1].slice(2) === archive[4] ? `${archive[1]}-${archive[2]}-${archive[3]}` : null;
}

/**
 * Flatten JSON-LD graph/list wrappers to find typed Event objects.
 * @param {unknown} value Parsed JSON-LD document.
 * @param {Object[]} output Accumulated event nodes.
 * @return {Object[]} Event nodes with their source fields intact.
 */
function schemaEvents(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) { for (const item of value) schemaEvents(item, output); return output; }
  const types = [].concat(value['@type'] || []);
  if (types.some(type => /(?:^|\/)(?:Event|[A-Za-z]+Event)$/.test(type))) output.push(value);
  for (const [key, child] of Object.entries(value)) if (!['@context', '@type'].includes(key)) schemaEvents(child, output);
  return output;
}

/**
 * Render a schema.org Place, PostalAddress or VirtualLocation as plain text.
 * @param {unknown} value Schema location data.
 * @return {string} Display-ready location.
 */
function schemaLocation(value) {
  if (Array.isArray(value)) return value.map(schemaLocation).filter(Boolean).join(' · ');
  if (!value || typeof value !== 'object') return String(value || '');
  const address = value.address;
  const addressText = typeof address === 'string' ? address : address
    ? [address.streetAddress, address.addressLocality, address.addressRegion].filter(Boolean).join(', ') : '';
  return [value.name, addressText, value['@type'] === 'VirtualLocation' ? value.url : ''].filter(Boolean).join(' · ');
}

/**
 * Extract structured Event JSON-LD and microdata from a single HTML document.
 * @param {string} html HTML response body.
 * @param {Object} plan Source URL and selector options.
 * @param {Object} context Optional date window.
 * @return {{events:Object[],warnings:string[],detailLinks:string[],groundedUrls:string[]}} Extracted events and URLs grounded before window filtering.
 */
export function parseHtml(html, plan = {}, context = {}) {
  const $ = cheerio.load(html);
  $('br').replaceWith(' ');
  const events = new Map();
  const groundedUrls = new Set();
  const warnings = [];
  let recognized = 0;
  const base = plan.fetchUrl || plan.url;
  const add = (input) => {
    if (plan.options?.dateOnly) input = { ...input, start: String(input.start || '').slice(0, 10),
      end: input.end ? String(input.end).slice(0, 10) : undefined, allDay: undefined };
    const event = normalizeEvent(input, plan);
    if (!event) return;
    recognized++;
    groundedUrls.add(event.url);
    if (inWindow(event, context)) events.set(`${event.url}|${event.start}|${event.title}`, event);
  };
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      for (const item of schemaEvents(JSON.parse($(element).text()))) {
        add({ uid: item['@id'], title: item.name, description: item.description,
          start: item.startDate, end: item.endDate, location: schemaLocation(item.location),
          url: item.url || (item.mainEntityOfPage?.['@id']) || plan.url,
          organizer: typeof item.organizer === 'string' ? item.organizer : item.organizer?.name,
          status: item.eventStatus, mode: /OnlineEventAttendanceMode/.test(item.eventAttendanceMode || '') ? 'online'
            : /MixedEventAttendanceMode/.test(item.eventAttendanceMode || '') ? 'hybrid' : undefined,
          tags: Array.isArray(item.keywords) ? item.keywords : String(item.keywords || '').split(',').filter(Boolean) });
      }
    } catch (error) { warnings.push(`Invalid Event JSON-LD: ${error.message}`); }
  });
  $('[itemscope][itemtype*="Event"]').each((_, element) => {
    const scope = $(element);
    const prop = name => { const item = scope.find(`[itemprop="${name}"]`).first(); return item.attr('content') || item.attr('datetime') || item.text(); };
    add({ title: prop('name'), description: prop('description'), start: prop('startDate'),
      end: prop('endDate'), location: prop('location'), url: scope.find('[itemprop="url"]').attr('href') || plan.url });
  });
  const options = plan.options || {};
  let containers = options.eventSelector ? $(options.eventSelector).toArray() : [];
  if (!containers.length) {
    const found = new Set();
    $('time[datetime],[data-start-date],[data-start],.event,.event-item,.event-card,.event-block,.tribe-events-calendar-list__event').each((_, element) => {
      const node = $(element);
      const container = node.is('time') ? node.closest('article,li,tr,.event,.event-item,.event-card,.event-block,.views-row') : node;
      if (container.length) found.add(container[0]);
    });
    containers = [...found];
  }
  const detailLinks = new Set();
  for (const element of containers) {
    const item = $(element);
    const dateNode = within(item, options.dateSelector || 'time[datetime],[data-start-date],[data-start],[itemprop="startDate"],.event-date,.date').first();
    if (/datePublished|dateModified/i.test(dateNode.attr('itemprop') || '')
      || (!options.dateSelector && /published|modified|updated/i.test(dateNode.attr('class') || ''))) continue;
    const titleNode = within(item, options.titleSelector || 'h1,h2,h3,h4,.event-title,.title,[itemprop="name"]').first();
    const linkNode = options.linkSelector ? within(item, options.linkSelector).first() : titleNode.is('a') ? titleNode : titleNode.find('a[href]').first().length ? titleNode.find('a[href]').first() : item.find('a[href]').first();
    const url = absoluteUrl(linkNode.attr('href') || item.attr('href') || plan.url, base);
    const titleCopy = titleNode.clone();
    if (options.titleRemoveSelector) titleCopy.find(options.titleRemoveSelector).remove();
    let title = (options.titlePattern ? item.text().match(new RegExp(options.titlePattern, 'i'))?.[1] : null)
      || (options.titleAttribute ? titleNode.attr(options.titleAttribute) : '') || titleCopy.text().trim() || linkNode.text().trim() || (options.titleFromPage ? $(options.titleFromPage).first().text().trim() : '');
    if (/^(?:TBD|TBA)$/i.test(plainText(title)) && options.pendingTitleSelector) {
      const series = $(options.pendingTitleSelector).first().text().trim();
      if (series) title = `${series} — Details ${plainText(title).toUpperCase()}`;
    }
    let dateText = (options.dateAttribute ? dateNode.attr(options.dateAttribute) : dateNode.text())
      || (options.dateFromPreviousRow ? item.prev('tr').text() : item.text());
    dateText = contextualDate(dateText, options, $, item);
    let start = dateNode.attr('datetime') || dateNode.attr('content') || dateNode.attr('data-start-date')
      || dateNode.attr('data-start') || dateNode.attr('data-date') || item.attr('data-start-date') || item.attr('data-start') || item.attr('data-date')
      || explicitTextDate(dateText) || (options.dateFromUrl && url ? linkedDate(url) : null);
    const timeText = options.timeSelector ? within(item, options.timeSelector).text() : options.contextTimeSelector ? $(options.contextTimeSelector).first().text() : '';
    if (start && start.length === 10 && timeText) {
      const clock = clockTime(timeText);
      if (clock) start = `${start}T${clock}`;
    }
    const dateOnly = options.dateOnly || (options.dateOnlyPattern && new RegExp(options.dateOnlyPattern, 'i').test(item.text()));
    if (dateOnly && start) start = start.slice(0, 10);
    const endNode = item.find('[itemprop="endDate"]').first().length
      ? item.find('[itemprop="endDate"]').first() : item.find('time[datetime]').eq(1);
    if (start && title) {
      const endText = `${dateText} ${timeText}`;
      let end = endNode.attr('datetime') || endNode.attr('content') || explicitTextEnd(endText, start);
      if (dateOnly && end) end = end.slice(0, 10);
      const fieldText = selector => options.preserveFieldBreaks
        ? item.find(selector).toArray().map(element => plainText($(element).html())).join('\n')
        : item.find(selector).text();
      add({ title, start, end, url,
        description: [fieldText(options.descriptionSelector || '.event-description,.description,.summary,.field--name-body') || item.text(),
          options.contextDescriptionSelector ? $(options.contextDescriptionSelector).first().text() : ''].filter(Boolean).join('\n'),
        location: item.attr(options.locationAttribute || 'data-location') || fieldText(options.locationSelector || '.location,.event-location,[itemprop="location"]'),
        status: options.cancelledPattern && new RegExp(options.cancelledPattern, 'i').test(item.text()) ? 'cancelled' : undefined,
        mode: item.attr('data-online') === 'true' || item.attr('data-online') === '1' ? 'online' : undefined });
    }
    if (url && url !== base && title && htmlDetailUrl(url)) detailLinks.add(url);
  }
  if (options.detailLinkSelector) {
    detailLinks.clear();
    $(options.detailLinkSelector).each((_, element) => {
      const href = absoluteUrl($(element).attr('href'), base);
      if (href && htmlDetailUrl(href) && new URL(href).origin === new URL(base).origin) detailLinks.add(href);
    });
  }
  if (options.detailLinks && !options.detailLinkSelector && !detailLinks.size) {
    $('main a[href],article a[href],#main a[href]').each((_, element) => {
      const href = absoluteUrl($(element).attr('href'), base);
      if (href && htmlDetailUrl(href) && /\/(?:event|events|calendar|seminar|seminars)\/(?!$)[^?#]+/i.test(new URL(href).pathname)
        && plainText($(element).text()).length > 8 && new URL(href).origin === new URL(base).origin) detailLinks.add(href);
    });
  }
  // A detail page with an explicit semantic time is safe even when it has no card.
  if (!containers.length && !$('[itemtype*="Event"]').length && $('main time[datetime],article time[datetime]').length === 1) {
    const main = $('main,article').first();
    const time = main.find('time[datetime]').first();
    const heading = main.find('h1').first().text();
    if (/event|calendar|seminar/i.test(new URL(base).pathname) && !/datePublished|dateModified/i.test(time.attr('itemprop') || '')) add({ title: heading, start: time.attr('datetime'), url: plan.url,
      description: main.find('.event-description,.field--name-body,.description').text() || main.text() });
  }
  const campusGroupsEmpty = plan.adapter === 'campusgroups'
    && /(?:^|\.)tartanconnect\.cmu\.edu$/i.test(new URL(base).hostname)
    && $('[class*="section-cont__content-events"] .cg_dynamic_msg').toArray()
      .some(element => /^(?:There are\s+)?no upcoming events\.?$/i.test($(element).text().trim()));
  const slateUrl = new URL(base);
  const slateEmpty = /\/portal\/widget\/event$/.test(slateUrl.pathname) && slateUrl.searchParams.get('cmd') === 'event_list'
    && $('body > div').toArray().some(element => /^There are no upcoming events to display\.$/.test($(element).text().trim()));
  const configuredEmpty = options.emptySelector && options.emptyPattern
    && $(options.emptySelector).toArray().some(element => new RegExp(options.emptyPattern, 'i').test($(element).text()));
  const unsupported = recognized === 0 && !campusGroupsEmpty && !slateEmpty && !configuredEmpty;
  if (unsupported) warnings.push('No events with explicit title, date and public URL were found; the page may require a source-specific selector or render client-side');
  const paginationLinks = options.paginationSelector ? [...new Set($(options.paginationSelector).toArray()
    .map(element => absoluteUrl($(element).attr('href'), base)).filter(Boolean))] : [];
  return { events: [...events.values()], warnings, detailLinks: [...detailLinks], paginationLinks, groundedUrls: [...groundedUrls], unsupported, recognized,
    ...(warnings.some(warning => warning.startsWith('Invalid Event JSON-LD')) ? { partial: true } : {}) };
}

/**
 * Parse newsletter sections individually; never use issue publication as event time.
 * @param {string} html Newsletter issue HTML.
 * @param {Object} plan Newsletter source configuration.
 * @param {Object} context Optional date window.
 * @return {{events:Object[],warnings:string[]}} Explicitly dated section events.
 */
export function parseNewsletter(html, plan = {}, context = {}) {
  const structured = parseHtml(html, plan, context);
  const $ = cheerio.load(html);
  $('br').replaceWith(' ');
  const events = new Map(structured.events.map(event => [event.uid, event]));
  const groundedUrls = new Set(structured.groundedUrls || []);
  let recognized = structured.recognized || 0;
  const headerText = $('h1,title').text();
  const issueYear = headerText.match(/\b20\d{2}\b/)?.[0];
  const scope = $('main,article,#main-content,.main-content,#content').first().length ? $('main,article,#main-content,.main-content,#content').first() : $('body');
  scope.find('h2,h3,h4').each((_, heading) => {
    const node = $(heading);
    const section = node.nextUntil('h1,h2,h3,h4');
    const title = node.text().trim();
    const text = section.toArray().map(element => $(element).text()).join('\n');
    let dateText = `${title}\n${text}`;
    if (!explicitTextDate(dateText) && issueYear) {
      dateText = dateText.replace(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?)(?![\d, ]*20\d{2})/i, `$1, ${issueYear}`);
    }
    const start = explicitTextDate(dateText);
    const anchor = plan.options?.headingSections
      ? section.find(plan.options.sectionLinkSelector || 'a.btn,a.ghost,a[href*="register"],a[href*="registration"],a[href*="eventbrite"]').first()
      : node.find('a[href]').first().length ? node.find('a[href]').first() : section.find('a[href]').first();
    const url = absoluteUrl(anchor.attr('href') || (plan.options?.headingSections ? plan.url : ''), plan.fetchUrl || plan.url);
    if (!start || !title || !url || /^(?:contents|in this issue|announcements|events?)$/i.test(title)) return;
    const event = normalizeEvent({ title, description: text, start, end: explicitTextEnd(dateText, start), url }, plan);
    if (event) {
      recognized++;
      groundedUrls.add(event.url);
      if (inWindow(event, context)) events.set(event.uid, event);
    }
  });
  return { events: [...events.values()], warnings: recognized ? structured.warnings.filter(warning => !warning.startsWith('No events'))
    : ['Newsletter has no individually linked sections with explicit event dates; publication dates are not event dates'], unsupported: recognized === 0, recognized, groundedUrls: [...groundedUrls],
    ...(structured.partial ? { partial: true } : {}) };
}

/**
 * Parse HTML and optionally reuse ICS for explicitly selected Google embeds.
 * Calendar identities come from advertised iframe src parameters on every fetch.
 * @param {string} html Public document HTML.
 * @param {Object} plan Reviewed source selectors.
 * @param {Object} context Shared safe fetcher and date window.
 * @return {Promise<Object>} Combined events and complete/partial diagnostics.
 */
async function parseDocument(html, plan, context) {
  const result = plan.options?.reviewedFragmentsOnly ? { events: [], warnings: [], unsupported: true }
    : plan.adapter === 'newsletter' || plan.options?.headingSections
    ? parseNewsletter(html, plan, context) : parseHtml(html, plan, context);
  result.datedRecognized = Boolean(result.recognized || result.events.length);
  if (plan.options?.generatedCalendar) {
    const calendar = parseGeneratedCalendar(html, plan, context);
    result.events.push(...calendar.events);
    result.warnings.push(...calendar.warnings);
    if (calendar.recognized) result.unsupported = false;
    if (calendar.recognized) result.datedRecognized = true;
    if (calendar.partial) result.partial = true;
    if (!result.unsupported) result.warnings = result.warnings.filter(warning => !warning.startsWith('No events'));
  }
  if (plan.options?.reviewedFragments?.length) {
    const reviewed = parseReviewedFragments(html, plan, context);
    result.events.push(...reviewed.events);
    result.warnings.push(...reviewed.warnings);
    if (reviewed.recognized) result.unsupported = false;
    if (reviewed.recognized && plan.options.reviewedFragments.some(item => item.events?.length)) result.datedRecognized = true;
    if (reviewed.partial) result.partial = true;
    if (!result.unsupported) result.warnings = result.warnings.filter(warning => !warning.startsWith('No events'));
  }
  if (plan.options?.reviewedImages?.length) {
    const images = await fetchReviewedImages(html, plan, context);
    result.events.push(...images.events);
    result.warnings.push(...images.warnings);
    if (images.recognized) result.unsupported = false;
    if (images.recognized && plan.options.reviewedImages.some(item => item.events?.length)) result.datedRecognized = true;
    if (images.partial) result.partial = true;
    if (!result.unsupported) result.warnings = result.warnings.filter(warning => !warning.startsWith('No events'));
  }
  if (plan.options?.linkedTextSchedule && !result.datedRecognized) {
    const linked = await parseLinkedTextSchedule(html, plan, context);
    result.events.push(...linked.events);
    result.warnings.push(...linked.warnings);
    if (linked.recognized) { result.unsupported = false; result.datedRecognized = true; }
    if (linked.partial) result.partial = true;
    if (!result.unsupported) result.warnings = result.warnings.filter(warning => !warning.startsWith('No events'));
  }
  if (plan.options?.reviewedResources?.length) {
    const resources = parseReviewedResources(html, plan);
    result.warnings.push(...resources.warnings);
    if (resources.recognized) result.unsupported = false;
    if (resources.partial) result.partial = true;
    if (!result.datedRecognized && !result.events.length && resources.undated) result.undated = true;
    const $ = cheerio.load(html);
    const excluded = new Set();
    for (const review of plan.options.reviewedResources.filter(item => item.excludeDetailLinks === true)) {
      const checked = parseReviewedResources(html, { ...plan, options: { reviewedResources: [review] } });
      if (!checked.recognized || checked.partial) continue;
      $(review.selector).find('a[href]').addBack('a[href]').each((_, element) => {
        const url = absoluteUrl($(element).attr('href'), plan.fetchUrl || plan.url);
        if (url) excluded.add(url);
      });
    }
    if (result.detailLinks) result.detailLinks = result.detailLinks.filter(url => !excluded.has(url));
    if (!result.unsupported) result.warnings = result.warnings.filter(warning => !warning.startsWith('No events'));
  }
  if (!plan.options?.embeddedGoogleCalendarSelector) return result;
  const $ = cheerio.load(html);
  const feeds = new Set();
  $(plan.options.embeddedGoogleCalendarSelector).each((_, element) => {
    try {
      const frame = new URL($(element).attr('src'), plan.fetchUrl || plan.url);
      if (!['calendar.google.com', 'www.google.com'].includes(frame.hostname) || !/^\/calendar\/embed$/.test(frame.pathname)) return;
      for (const value of frame.searchParams.getAll('src')) {
        const id = value.includes('@') ? value : Buffer.from(value, 'base64').toString('utf8');
        if (/^[^\s@]+@[^\s@]+$/.test(id)) feeds.add(`https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`);
      }
    } catch { /* Unrecognized embeds cannot establish a public event feed. */ }
  });
  const events = new Map(result.events.map(event => [event.uid, event]));
  for (const url of feeds) {
    try {
      const feed = await fetchIcs({ ...plan, fetchUrl: url }, context);
      if (feed.partial || feed.unsupported) result.partial = true;
      if (!feed.unsupported) result.unsupported = false;
      for (const warning of feed.warnings || []) result.warnings.push(`Embedded calendar (${url}): ${warning}`);
      for (const event of feed.events) {
        const titleKey = value => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        const duplicate = [...events.values()].find(candidate => candidate.start === event.start
          && titleKey(candidate.title) === titleKey(event.title));
        if (duplicate) events.delete(duplicate.uid);
        events.set(event.uid, duplicate && duplicate.description.length > event.description.length
          ? { ...event, description: duplicate.description, summary: duplicate.summary } : event);
      }
    } catch (error) { result.partial = true; result.warnings.push(`Embedded calendar failed (${url}): ${error.message}`); }
  }
  if (!result.unsupported) result.warnings = result.warnings.filter(warning => !warning.startsWith('No events'));
  return { ...result, events: [...events.values()] };
}

/**
 * Read one explicitly advertised public Google document as a conference agenda.
 * Only its selected Date: line grounds the occurrence; document publication,
 * hotel booking dates and the current year never provide occurrence dates.
 * @param {string} html Public conference landing page.
 * @param {Object} plan Reviewed link/title selectors and date-line prefix.
 * @param {Object} context Safe text fetcher and requested collection window.
 * @return {Promise<Object>} One dated conference range or a precise diagnostic.
 */
async function parseLinkedTextSchedule(html, plan, context) {
  const options = plan.options.linkedTextSchedule;
  const $ = cheerio.load(html);
  const links = [...new Set($(options.linkSelector).toArray().map(element => absoluteUrl($(element).attr('href'), plan.url)).filter(Boolean))];
  if (links.length !== 1) return { events: [], warnings: ['Linked agenda needs review: expected one advertised public document'], partial: true };
  try {
    const document = new URL(links[0]);
    const id = document.pathname.match(/^\/document\/d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1];
    if (document.hostname !== 'docs.google.com' || !id) throw new Error('expected an advertised Google document URL');
    const text = await context.fetchText(`https://docs.google.com/document/d/${id}/export?format=txt`);
    if (/^\s*</.test(text)) throw new Error('public text export returned HTML rather than an agenda');
    const prefix = options.dateLinePrefix || 'Date:';
    const dates = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith(prefix));
    if (dates.length !== 1) throw new Error('the selected date line is missing or ambiguous');
    const dateText = dates[0].slice(prefix.length).replace(/\b(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b/gi, ' ');
    const start = explicitTextDate(dateText);
    const event = normalizeEvent({ title: $(options.titleSelector || 'h1').first().text(), start,
      end: explicitTextEnd(dateText, start), description: text, url: plan.url }, plan);
    if (!event) throw new Error('the agenda date line lacks a valid explicit year/date or landing-page title');
    return { events: inWindow(event, context) ? [event] : [], warnings: [], recognized: 1 };
  } catch (error) { return { events: [], warnings: [`Linked agenda needs review: ${error.message}`], partial: true }; }
}

/**
 * Conservatively prune explicitly named semester archives outside the window.
 * Bounds deliberately overlap neighboring seasons so edge dates remain eligible.
 * Unrecognized URL formats are always retained.
 * @param {string} url Advertised semester schedule URL.
 * @param {Object} context Ingestion date window.
 * @return {boolean} Whether the archive could overlap the requested window.
 */
function semesterMayOverlap(url, context) {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\b(spring|summer|fall)[-_]?(20\d{2})\b/i);
  const academic = pathname.match(/\/(20\d{2})-(\d{2}|20\d{2})\/(fall|spring|summer)(?:\/|$)/i);
  let year;
  let season;
  if (match) { year = +match[2]; season = match[1].toLowerCase(); }
  else if (academic) {
    const first = +academic[1];
    const second = +(academic[2].length === 2 ? `${academic[1].slice(0, 2)}${academic[2]}` : academic[2]);
    if (second !== first + 1) return true;
    season = academic[3].toLowerCase();
    year = season === 'fall' ? first : second;
  } else return true;
  const start = season === 'spring' ? `${year - 1}-11-01` : season === 'summer' ? `${year}-03-01` : `${year}-05-01`;
  const end = season === 'spring' ? `${year}-09-01` : season === 'summer' ? `${year}-11-01` : `${year + 1}-03-01`;
  return (!context.windowStart || Date.parse(end) > Date.parse(context.windowStart))
    && (!context.windowEnd || Date.parse(start) < Date.parse(context.windowEnd));
}

/**
 * Replace an imprecise parent card only when its child proves the same occurrence.
 * Explicit all-day events and distinct titles, URLs or local days remain separate.
 * @param {Map<string,Object>} events Existing source events keyed by identity.
 * @param {Object[]} detailEvents Independently normalized child events.
 * @return {void}
 */
function mergeDetailEvents(events, detailEvents) {
  const timedKeys = new Map();
  const previousKeys = new Map();
  for (const event of detailEvents.filter(candidate => candidate.timePrecision === 'time')) {
    try {
      const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: event.timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(event.start));
      const key = `${event.url}\0${event.title.toLowerCase()}\0${localDay}`;
      timedKeys.set(key, (timedKeys.get(key) || 0) + 1);
    } catch { /* An invalid zone cannot prove a shared local day. */ }
  }
  for (const [uid, candidate] of events) {
    if (candidate.timePrecision !== 'date') continue;
    const key = `${candidate.url}\0${candidate.title.toLowerCase()}\0${candidate.start}`;
    if (!previousKeys.has(key)) previousKeys.set(key, []);
    previousKeys.get(key).push({ uid, candidate });
  }
  for (const [key, matches] of previousKeys) {
    if (matches.length !== 1 || timedKeys.get(key) !== 1) continue;
    const { uid, candidate } = matches[0];
    if (candidate.end === addDays(candidate.start)) events.delete(uid);
  }
  for (const event of detailEvents) events.set(event.uid, event);
}

/**
 * Fetch a listing and bounded same-origin details, prioritizing required discovery.
 * Independently dated parent records remain usable if optional enrichment fails;
 * explicit child selectors and ungrounded links require complete child extraction.
 * @param {Object} plan HTML source configuration.
 * @param {Object} context Fetch callback and date window.
 * @return {Promise<Object>} Normalized events with parsing/fetch diagnostics.
 */
async function fetchHtmlPage(plan, context) {
  const text = await context.fetchText(plan.fetchUrl || plan.url);
  if (plan.options?.pdfLinkSelector) return fetchPdfSchedule(text, plan, context);
  const result = await parseDocument(text, plan, context);
  const events = new Map(result.events.map(event => [event.uid, event]));
  let supported = !result.unsupported;
  let partial = Boolean(result.partial);
  let datedRecognized = Boolean(result.datedRecognized);
  let undated = Boolean(result.undated);
  if (plan.options?.detailLinks && result.detailLinks) {
    const maxDetails = Math.min(plan.options.maxDetails || 12, 50);
    const origin = new URL(plan.fetchUrl || plan.url).origin;
    const eligibleLinks = result.detailLinks.filter(url => new URL(url).origin === origin && htmlDetailUrl(url)
      && (!plan.options.detailSemesterWindow || semesterMayOverlap(url, context)));
    const groundedUrls = new Set(result.groundedUrls || []);
    const requiredLinks = eligibleLinks.filter(url => plan.options.detailLinkSelector || !groundedUrls.has(url));
    const optionalLinks = eligibleLinks.filter(url => !requiredLinks.includes(url));
    const required = new Set(requiredLinks);
    const selectedLinks = [...requiredLinks, ...optionalLinks].slice(0, maxDetails);
    if (plan.options.detailSemesterWindow && result.detailLinks.length && !eligibleLinks.length) supported = true;
    for (const link of selectedLinks) {
      const isRequired = required.has(link);
      const label = isRequired ? 'Detail' : 'Optional detail enrichment';
      try {
        const detailPlan = { ...plan, url: link, fetchUrl: link, options: { timezone: plan.options?.timezone,
          ...plan.options?.detailOptions, ...plan.options?.detailOptionsByUrl?.[link] } };
        const detail = await parseDocument(await context.fetchText(link), detailPlan, context);
        if (!detail.unsupported) supported = true;
        datedRecognized ||= Boolean(detail.datedRecognized);
        undated ||= Boolean(detail.undated);
        if (isRequired && (detail.unsupported || detail.partial)) partial = true;
        for (const warning of detail.warnings || []) result.warnings.push(`${label} (${link}): ${warning}`);
        if (detail.unsupported && !detail.warnings?.length) result.warnings.push(`${label} (${link}): no verified event structure or empty state was recognized`);
        mergeDetailEvents(events, detail.events);
      } catch (error) { if (isRequired) partial = true; result.warnings.push(`${label} fetch failed (${link}): ${error.message}`); }
    }
    if (requiredLinks.length > maxDetails) { partial = true; result.warnings.push(`Detail limit ${maxDetails} reached; ${requiredLinks.length - maxDetails} required child page(s) remain; configure pagination or a structured feed for complete ingestion`); }
    else if (eligibleLinks.length > maxDetails) result.warnings.push(`Optional detail enrichment limit ${maxDetails} reached; ${eligibleLinks.length - maxDetails} link(s) already grounded by the parent were not followed`);
  }
  if (supported) result.warnings = result.warnings.filter(warning => !warning.startsWith('No events'));
  return { events: [...events.values()], warnings: result.warnings, unsupported: !supported,
    paginationLinks: result.paginationLinks || [], datedRecognized,
    ...(!datedRecognized && undated ? { undated: true } : {}), ...(partial ? { partial: true } : {}) };
}

/**
 * Follow only publisher-advertised listing pages with bounded same-origin fetches.
 * A missing/changed later page stays partial; undiscovered page numbers are never
 * synthesized and monitored undated resources are not called empty calendars.
 * @param {Object} plan Source selectors and optional paginationSelector/maxPages.
 * @param {Object} context Safe public fetch callbacks and collection window.
 * @return {Promise<Object>} Combined source events and completeness diagnostics.
 */
export async function fetchHtml(plan, context) {
  const first = await fetchHtmlPage(plan, context);
  if (!plan.options?.paginationSelector) return first;
  const events = new Map(first.events.map(event => [event.uid, event]));
  const warnings = [...first.warnings];
  const origin = new URL(plan.fetchUrl || plan.url).origin;
  const visited = new Set([plan.fetchUrl || plan.url]);
  const pending = [...first.paginationLinks];
  const maximum = Math.min(plan.options.maxPages || 20, 100);
  let partial = Boolean(first.partial);
  let supported = !first.unsupported;
  let datedRecognized = first.datedRecognized;
  let undated = first.undated;
  while (pending.length && visited.size < maximum) {
    const url = pending.shift();
    if (visited.has(url)) continue;
    if (new URL(url).origin !== origin || !htmlDetailUrl(url)) {
      partial = true; warnings.push(`Rejected non-HTML or cross-origin pagination link (${url})`); continue;
    }
    visited.add(url);
    try {
      const page = await fetchHtmlPage({ ...plan, fetchUrl: url }, context);
      supported ||= !page.unsupported;
      partial ||= Boolean(page.partial || page.unsupported);
      datedRecognized ||= page.datedRecognized;
      undated ||= page.undated;
      warnings.push(...page.warnings);
      for (const event of page.events) events.set(event.uid, event);
      pending.push(...page.paginationLinks.filter(next => !visited.has(next)));
    } catch (error) { partial = true; warnings.push(`Listing page failed (${url}): ${error.message}`); }
  }
  if (pending.some(url => !visited.has(url))) { partial = true; warnings.push(`Listing pagination limit ${maximum} reached; advertised pages remain`); }
  return { events: [...events.values()], warnings: [...new Set(warnings)], unsupported: !supported,
    ...(!datedRecognized && undated ? { undated: true } : {}), ...(partial ? { partial: true } : {}) };
}
