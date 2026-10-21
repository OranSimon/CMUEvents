import * as cheerio from 'cheerio';
import { absoluteUrl, normalizeEvent, inWindow, plainText, addDays } from '../lib/normalize.mjs';

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
  const text = plainText(value).replace(/\s+/g, ' ').replace(/([A-Za-z])(?=\d)/g, '$1 ');
  const iso = text.match(/\b(20\d{2}[-/]\d{2}[-/]\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?)?\b/);
  if (iso) {
    const date = iso[1].replaceAll('/', '-');
    if (iso[2]) return `${date}T${iso[2].padStart(2, '0')}:${iso[3]}:${iso[4] || '00'}${iso[5] || ''}`;
    const clock = clockTime(text.slice(iso.index + iso[0].length));
    return clock ? `${date}T${clock}` : date;
  }
  const month = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2})?[,]?\s+(20\d{2})\b/i);
  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (!month && !numeric) return null;
  const year = month ? month[3] : numeric[3];
  const monthNumber = month ? MONTHS[month[1].slice(0, 3).toLowerCase()] : +numeric[1];
  const day = month ? month[2] : numeric[2];
  const date = `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const tail = text.slice((month || numeric).index + (month || numeric)[0].length);
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
  const text = plainText(value).replace(/\s+/g, ' ');
  if (start.length === 10) {
    const range = text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2}\s*[-–]\s*(\d{1,2})\s*,?\s*20\d{2}\b/i);
    if (range && +range[1] >= +start.slice(8, 10) && +range[1] <= 31) {
      const lastDay = `${start.slice(0, 8)}${range[1].padStart(2, '0')}`;
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
  return date <= start ? `${addDays(start.slice(0, 10))}T${clock}` : date;
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
 * @return {{events:Object[],warnings:string[],detailLinks:string[]}} Extracted events and candidate detail links.
 */
export function parseHtml(html, plan = {}, context = {}) {
  const $ = cheerio.load(html);
  $('br').replaceWith(' ');
  const events = new Map();
  const warnings = [];
  let recognized = 0;
  const base = plan.fetchUrl || plan.url;
  const add = (input) => {
    const event = normalizeEvent(input, plan);
    if (!event) return;
    recognized++;
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
    const dateNode = item.find(options.dateSelector || 'time[datetime],[data-start-date],[data-start],[itemprop="startDate"],.event-date,.date').first();
    if (/datePublished|dateModified/i.test(dateNode.attr('itemprop') || '')
      || (!options.dateSelector && /published|modified|updated/i.test(dateNode.attr('class') || ''))) continue;
    const titleNode = item.find(options.titleSelector || 'h1,h2,h3,h4,.event-title,.title,[itemprop="name"]').first();
    const linkNode = options.linkSelector ? item.find(options.linkSelector).first() : titleNode.is('a') ? titleNode : titleNode.find('a[href]').first().length ? titleNode.find('a[href]').first() : item.find('a[href]').first();
    const url = absoluteUrl(linkNode.attr('href') || item.attr('href') || plan.url, base);
    const title = titleNode.text().trim() || linkNode.text().trim();
    let dateText = dateNode.text() || (options.dateFromPreviousRow ? item.prev('tr').text() : item.text());
    dateText = dateText.replace(/([A-Za-z])(?=\d)/g, '$1 ');
    if (options.yearSelector && !explicitTextDate(dateText)) {
      const year = $(options.yearSelector).first().text().match(/\b20\d{2}\b/)?.[0];
      if (year) dateText = dateText.replace(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?)/i, `$1, ${year}`);
    }
    let start = dateNode.attr('datetime') || dateNode.attr('content') || dateNode.attr('data-start-date')
      || dateNode.attr('data-start') || dateNode.attr('data-date') || item.attr('data-start-date') || item.attr('data-start') || item.attr('data-date')
      || explicitTextDate(dateText);
    if (start && start.length === 10 && options.timeSelector) {
      const combined = explicitTextDate(`${start} ${item.find(options.timeSelector).text()}`);
      start = combined || start;
    }
    const endNode = item.find('[itemprop="endDate"]').first().length
      ? item.find('[itemprop="endDate"]').first() : item.find('time[datetime]').eq(1);
    if (start && title) {
      const endText = `${dateText} ${options.timeSelector ? item.find(options.timeSelector).text() : ''}`;
      add({ title, start, end: endNode.attr('datetime') || endNode.attr('content') || explicitTextEnd(endText, start), url,
        description: item.find(options.descriptionSelector || '.event-description,.description,.summary,.field--name-body').text() || item.text(),
        location: item.attr(options.locationAttribute || 'data-location') || item.find(options.locationSelector || '.location,.event-location,[itemprop="location"]').text(),
        mode: item.attr('data-online') === 'true' || item.attr('data-online') === '1' ? 'online' : undefined });
    }
    if (url && url !== base && title && htmlDetailUrl(url)) detailLinks.add(url);
  }
  if (options.detailLinks && !detailLinks.size) {
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
  const configuredEmpty = options.emptySelector && options.emptyPattern
    && $(options.emptySelector).toArray().some(element => new RegExp(options.emptyPattern, 'i').test($(element).text()));
  const unsupported = recognized === 0 && !campusGroupsEmpty && !configuredEmpty;
  if (unsupported) warnings.push('No events with explicit title, date and public URL were found; the page may require a source-specific selector or render client-side');
  return { events: [...events.values()], warnings, detailLinks: [...detailLinks], unsupported, recognized,
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
      if (inWindow(event, context)) events.set(event.uid, event);
    }
  });
  return { events: [...events.values()], warnings: recognized ? structured.warnings.filter(warning => !warning.startsWith('No events'))
    : ['Newsletter has no individually linked sections with explicit event dates; publication dates are not event dates'], unsupported: recognized === 0, recognized,
    ...(structured.partial ? { partial: true } : {}) };
}

/**
 * Fetch one listing and a bounded number of same-origin detail pages.
 * @param {Object} plan HTML source configuration.
 * @param {Object} context Fetch callback and date window.
 * @return {Promise<Object>} Normalized events with parsing/fetch diagnostics.
 */
export async function fetchHtml(plan, context) {
  const text = await context.fetchText(plan.fetchUrl || plan.url);
  const result = plan.adapter === 'newsletter' || plan.options?.headingSections
    ? parseNewsletter(text, plan, context) : parseHtml(text, plan, context);
  const events = new Map(result.events.map(event => [`${event.url}|${event.start}`, event]));
  let supported = !result.unsupported;
  let partial = Boolean(result.partial);
  if (plan.options?.detailLinks && result.detailLinks) {
    const maxDetails = Math.min(plan.options.maxDetails || 12, 50);
    const origin = new URL(plan.fetchUrl || plan.url).origin;
    for (const link of result.detailLinks.filter(url => new URL(url).origin === origin && htmlDetailUrl(url)).slice(0, maxDetails)) {
      try {
        const detail = parseHtml(await context.fetchText(link), { ...plan, url: link, fetchUrl: link, options: {} }, context);
        if (!detail.unsupported) supported = true;
        for (const event of detail.events) events.set(`${event.url}|${event.start}`, event);
      } catch (error) { partial = true; result.warnings.push(`Detail fetch failed (${link}): ${error.message}`); }
    }
    if (result.detailLinks.length > maxDetails) result.warnings.push(`Detail limit ${maxDetails} reached; configure pagination or a structured feed for complete ingestion`);
  }
  if (supported) result.warnings = result.warnings.filter(warning => !warning.startsWith('No events'));
  return { events: [...events.values()], warnings: result.warnings, unsupported: !supported, ...(partial ? { partial: true } : {}) };
}
