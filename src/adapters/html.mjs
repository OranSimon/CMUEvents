import * as cheerio from 'cheerio';
import { absoluteUrl, normalizeEvent, inWindow, plainText, addDays, parseDate } from '../lib/normalize.mjs';
import { fetchIcs } from './ics.mjs';
import { fetchPdfSchedule } from './pdfschedule.mjs';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

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
function clockTime(value) {
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
  const text = plainText(value).replace(/\s+/g, ' ').replace(/(?<!\d)([A-Za-z])(?=\d)/g, '$1 ')
    .replace(/,\s*(?=20\d{2}\b)/g, ', ');
  const iso = text.match(/\b(20\d{2}[-/]\d{2}[-/]\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?)?\b/);
  if (iso) {
    const date = iso[1].replaceAll('/', '-');
    if (iso[2]) return `${date}T${iso[2].padStart(2, '0')}:${iso[3]}:${iso[4] || '00'}${iso[5] || ''}`;
    const clock = clockTime(text.slice(iso.index + iso[0].length).replace(/^[\s.;·]+/, ''));
    return clock ? `${date}T${clock}` : date;
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
  const tail = text.slice(matched.index + matched[0].length).replace(/^[\s.;·]+/, '');
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
  const text = plainText(value).replace(/\s+/g, ' ').replace(/,\s*(?=20\d{2}\b)/g, ', ');
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
    const title = (options.titlePattern ? item.text().match(new RegExp(options.titlePattern, 'i'))?.[1] : null)
      || (options.titleAttribute ? titleNode.attr(options.titleAttribute) : '') || titleCopy.text().trim() || linkNode.text().trim() || (options.titleFromPage ? $(options.titleFromPage).first().text().trim() : '');
    let dateText = (options.dateAttribute ? dateNode.attr(options.dateAttribute) : dateNode.text())
      || (options.dateFromPreviousRow ? item.prev('tr').text() : item.text());
    dateText = contextualDate(dateText, options, $, item);
    let start = dateNode.attr('datetime') || dateNode.attr('content') || dateNode.attr('data-start-date')
      || dateNode.attr('data-start') || dateNode.attr('data-date') || item.attr('data-start-date') || item.attr('data-start') || item.attr('data-date')
      || explicitTextDate(dateText) || (options.dateFromUrl && url ? linkedDate(url) : null);
    const timeText = options.timeSelector ? within(item, options.timeSelector).text() : options.contextTimeSelector ? $(options.contextTimeSelector).first().text() : '';
    if (start && start.length === 10 && timeText) {
      const combined = explicitTextDate(`${start} ${timeText}`);
      start = combined || start;
    }
    if (options.dateOnly && start) start = start.slice(0, 10);
    const endNode = item.find('[itemprop="endDate"]').first().length
      ? item.find('[itemprop="endDate"]').first() : item.find('time[datetime]').eq(1);
    if (start && title) {
      const endText = `${dateText} ${timeText}`;
      let end = endNode.attr('datetime') || endNode.attr('content') || explicitTextEnd(endText, start);
      if (options.dateOnly && end) end = end.slice(0, 10);
      add({ title, start, end, url,
        description: item.find(options.descriptionSelector || '.event-description,.description,.summary,.field--name-body').text() || item.text(),
        location: item.attr(options.locationAttribute || 'data-location') || item.find(options.locationSelector || '.location,.event-location,[itemprop="location"]').text(),
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
  return { events: [...events.values()], warnings, detailLinks: [...detailLinks], groundedUrls: [...groundedUrls], unsupported, recognized,
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
  const result = plan.adapter === 'newsletter' || plan.options?.headingSections
    ? parseNewsletter(html, plan, context) : parseHtml(html, plan, context);
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
 * Fetch a listing and bounded same-origin details, prioritizing required discovery.
 * Independently dated parent records remain usable if optional enrichment fails;
 * explicit child selectors and ungrounded links require complete child extraction.
 * @param {Object} plan HTML source configuration.
 * @param {Object} context Fetch callback and date window.
 * @return {Promise<Object>} Normalized events with parsing/fetch diagnostics.
 */
export async function fetchHtml(plan, context) {
  const text = await context.fetchText(plan.fetchUrl || plan.url);
  if (plan.options?.pdfLinkSelector) return fetchPdfSchedule(text, plan, context);
  const result = await parseDocument(text, plan, context);
  const events = new Map(result.events.map(event => [event.uid, event]));
  let supported = !result.unsupported;
  let partial = Boolean(result.partial);
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
        const detailPlan = { ...plan, url: link, fetchUrl: link, options: { timezone: plan.options?.timezone, ...plan.options?.detailOptions } };
        const detail = await parseDocument(await context.fetchText(link), detailPlan, context);
        if (!detail.unsupported) supported = true;
        if (isRequired && (detail.unsupported || detail.partial)) partial = true;
        for (const warning of detail.warnings || []) result.warnings.push(`${label} (${link}): ${warning}`);
        if (detail.unsupported && !detail.warnings?.length) result.warnings.push(`${label} (${link}): no verified event structure or empty state was recognized`);
        for (const event of detail.events) events.set(event.uid, event);
      } catch (error) { if (isRequired) partial = true; result.warnings.push(`${label} fetch failed (${link}): ${error.message}`); }
    }
    if (requiredLinks.length > maxDetails) { partial = true; result.warnings.push(`Detail limit ${maxDetails} reached; ${requiredLinks.length - maxDetails} required child page(s) remain; configure pagination or a structured feed for complete ingestion`); }
    else if (eligibleLinks.length > maxDetails) result.warnings.push(`Optional detail enrichment limit ${maxDetails} reached; ${eligibleLinks.length - maxDetails} link(s) already grounded by the parent were not followed`);
  }
  if (supported) result.warnings = result.warnings.filter(warning => !warning.startsWith('No events'));
  return { events: [...events.values()], warnings: result.warnings, unsupported: !supported, ...(partial ? { partial: true } : {}) };
}
