import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { absoluteUrl, inWindow, normalizeEvent, plainText } from '../lib/normalize.mjs';
import { sourceAllowed } from '../lib/source-scope.mjs';
import { explicitTextDate, explicitTextEnd, clockTime, parseHtml } from './html.mjs';

/**
 * Canonicalize publisher source identities for exact catalog matching.
 * @param {string} value Public source URL.
 * @return {string|null} Comparable anonymous HTTP URL, or null if invalid.
 */
export function seminarSourceUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.protocol = 'https:';
    url.hostname = url.hostname.replace(/^www\./, '');
    url.hash = '';
    url.pathname = url.pathname.replace(/\/index\.(?:s?html?)$/i, '/').replace(/\/+$/, '') || '/';
    return url.href;
  } catch { return null; }
}

/**
 * Normalize an advertised label without fuzzy abbreviation or person matching.
 * @param {string} value Publisher label.
 * @return {string} Comparable Unicode word sequence.
 */
function label(value) { return plainText(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }

/**
 * Decode the current directory using its published column schema.
 * @param {Object} json Public sheet-backed directory, without occurrence dates.
 * @return {Object[]} All advertised series, including rows without a website.
 */
export function parseSeminarDirectory(json) {
  if (String(json?.success) !== 'true' || !Array.isArray(json.cols) || !Array.isArray(json.data)) throw new Error('Public seminar directory schema is unavailable');
  const columns = new Map(json.cols.map((column, index) => [column.n, index]));
  if (!columns.has('seminar-name') || !columns.has('web-url')) throw new Error('Public seminar directory requires name and website columns');
  return json.data.map(row => {
    if (!Array.isArray(row)) throw new Error('Malformed public seminar directory row');
    const name = plainText(row[columns.get('seminar-name')]);
    if (!name) throw new Error('Public seminar directory contains an unnamed series');
    const rawUrl = plainText(row[columns.get('web-url')]);
    const url = rawUrl ? absoluteUrl(rawUrl) : null;
    if (rawUrl && !seminarSourceUrl(url)) throw new Error(`Invalid anonymous advertised website for ${name}`);
    return { name, aka: plainText(row[columns.get('aka')]), url,
      publishedDay: plainText(row[columns.get('day')]), publishedClock: plainText(row[columns.get('time')]) };
  });
}

/**
 * Create coverage counters without treating an undated resource as empty.
 * @param {string} kind Source family.
 * @return {Object} Empty versioned inspection audit.
 */
function coverage(kind) {
  return { version: 1, kind, inspectionComplete: true, internalIssues: [], externalIssues: [], nonBlockingIssues: [], counters: {}, series: [] };
}

/**
 * Record an implementation gap separately from a concrete upstream failure.
 * @param {Object} audit Mutable coverage audit.
 * @param {Object} item Public URL/series and failure details.
 * @param {boolean} internal Whether this is an unhandled parser or discovery gap.
 * @return {void}
 */
function issue(audit, item, internal = false) {
  audit[internal ? 'internalIssues' : 'externalIssues'].push(item);
  if (internal) audit.inspectionComplete = false;
}

/**
 * Retain nested family audits, including string diagnostics from existing adapters.
 * @param {Object} audit Destination source audit.
 * @param {Object} nested Completed child inspection.
 * @param {Object} details Exact public source/series attribution.
 * @return {void}
 */
function appendCoverage(audit, nested, details = {}) {
  for (const field of ['internalIssues', 'externalIssues', 'nonBlockingIssues']) {
    audit[field].push(...(nested[field] || []).map(value => ({ ...details, ...(typeof value === 'string' ? { reason: value } : value) })));
  }
  audit.inspectionComplete &&= nested.inspectionComplete === true;
}

/**
 * Record a caught public transport failure or an unhandled discovery error.
 * @param {Object} audit Mutable parent inspection.
 * @param {Error} error Caught exception with optional endpoint coverage.
 * @param {Object} details Exact advertised URL/series context.
 * @return {boolean} Whether the failing resource was fully inspected externally.
 */
function recordFailure(audit, error, details) {
  if (error.coverage) { appendCoverage(audit, error.coverage, details); return error.coverage.inspectionComplete === true; }
  const budget = /\b(?:budget|scan limit|detail limit|download limit|maximumBytes|timeoutMs|unprocessed|circuit|pagination limit)\b/i.test(error.message);
  const external = !budget && /\bHTTP\s+(?:4\d\d|5\d\d)\b|\b(?:EAI_AGAIN|ENOTFOUND|ECONN\w*|ETIMEDOUT)\b|fetch failed|certificate|TLS|socket|DNS|(?:fetch|request|connection|network).*tim(?:ed?\s*out|eout)/i.test(error.message);
  issue(audit, { code: external ? 'UPSTREAM_PUBLIC_RESOURCE_UNAVAILABLE' : 'SOURCE_DISCOVERY_ERROR', ...details, error: error.message }, !external);
  return external;
}

/**
 * Propagate completed child audits; unaudited partial extraction is internal.
 * @param {Object} audit Parent coverage.
 * @param {Object} result Normalized child adapter result.
 * @param {Object} details Series and public source identity.
 * @return {boolean} Whether the child inspection is complete.
 */
function recordResult(audit, result, details) {
  if (result.coverage) { appendCoverage(audit, result.coverage, details); return result.coverage.inspectionComplete === true; }
  if (result.partial || result.unsupported) { issue(audit, { code: 'UNAUDITED_CHILD_EXTRACTION_LIMITATION', ...details, warnings: result.warnings || [] }, true); return false; }
  return true;
}

/**
 * Resolve only publisher-advertised Google calendar identities and feed links.
 * @param {string} html Public source HTML.
 * @param {string} base Publisher source URL.
 * @return {Object[]} Unique public feed descriptors without invented IDs.
 */
export function advertisedSeminarFeeds(html, base) {
  const $ = cheerio.load(html);
  const feeds = new Map();
  $('iframe[src],a[href],link[rel="alternate"][href]').each((_, node) => {
    const value = $(node).attr('src') || $(node).attr('href');
    const href = absoluteUrl(value, base);
    if (!href) return;
    const url = new URL(href);
    if (['calendar.google.com', 'www.google.com'].includes(url.hostname) && url.pathname.startsWith('/calendar/')) {
      for (let id of [...url.searchParams.getAll('src'), ...url.searchParams.getAll('cid')]) {
        if (!id.includes('@')) { try { id = Buffer.from(id, 'base64').toString('utf8'); } catch { continue; } }
        if (/^[^\s@]+@[^\s@]+$/.test(id)) {
          const feed = `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;
          feeds.set(feed, { url: feed, adapter: 'ics' });
        }
      }
    } else if (/\.ics(?:$|[?#])|[?&]ical=1|\/live\/ical\//i.test(href)) feeds.set(href, { url: href, adapter: 'ics' });
    else if (/rss|atom/i.test($(node).attr('type') || '')) feeds.set(href, { url: href, adapter: 'rss' });
  });
  return [...feeds.values()];
}

/**
 * Parse live speaker sections or scoped dated cards without whole-page hashes.
 * @param {string} html Current public HTML.
 * @param {Object} plan Structural selectors for a semantic seminar resource.
 * @param {Object} context Collection window.
 * @return {Object} Current events, undated-current state and recognition details.
 */
export function parseSemanticSeminar(html, plan, context = {}) {
  const $ = cheerio.load(html);
  $('br').replaceWith('\n');
  const options = plan.options || {};
  const series = options.seriesTitle || plainText($(options.seriesSelector || 'h1').first().text()) || plan.org;
  const events = new Map();
  const warnings = [];
  const structured = parseHtml(html, { ...plan, options: { timezone: options.timezone } }, context);
  for (const event of structured.events) events.set(event.uid, event);
  let recognized = structured.recognized || 0;
  let upcomingUndated = false;
  let internalGap = false;
  let pendingSlots = 0;
  if (options.layout === 'speaker-sections') {
    for (const element of $('section').toArray()) {
      const section = $(element);
      const headings = section.find('h1,h2,h3,h4').toArray().map(node => plainText($(node).text())).filter(Boolean);
      const dateIndex = headings.findIndex(text => explicitTextDate(text));
      if (headings.some(text => /^next upcoming seminar$/i.test(text))) {
        if (section.find('p').toArray().some(node => /^(?:TBD|TBA|To be announced)$/i.test(plainText($(node).text())))) upcomingUndated = true;
        else if (dateIndex < 0) { internalGap = true; warnings.push('Upcoming seminar content changed but no explicitly dated speaker block was recognized'); }
      }
      if (dateIndex < 0) continue;
      const start = explicitTextDate(headings[dateIndex]);
      let title = headings[dateIndex + 1];
      const speaker = headings.slice(0, dateIndex).find(text => !/^next upcoming seminar$/i.test(text));
      if (!title || /^(?:TBD|TBA)$/i.test(title)) title = speaker ? `${series} — ${speaker}` : null;
      const event = normalizeEvent({ title, start, end: explicitTextEnd(headings[dateIndex], start), url: plan.url,
        description: [speaker ? `Speaker: ${speaker}.` : '', plainText(section.html())].filter(Boolean).join('\n') }, plan);
      if (!event) { internalGap = true; warnings.push('A dated public speaker section has invalid event fields'); continue; }
      recognized++;
      if (inWindow(event, context)) events.set(event.uid, event);
    }
  } else if (options.layout === 'dated-cards') {
    for (const element of $(options.cardSelector).toArray()) {
      const card = $(element);
      const dateLine = plainText(card.html()).split('\n').map(line => line.trim()).find(Boolean) || '';
      let dateText = dateLine;
      if (!explicitTextDate(dateText)) {
        const heading = card.prevAll(options.yearHeadingSelector || 'h2').first().text();
        const years = [...new Set(heading.match(/\b20\d{2}\b/g) || [])];
        if (years.length === 1) dateText = dateText.replace(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2})(?!\d)/i, `$1, ${years[0]}`);
      }
      const start = explicitTextDate(dateText);
      if (!start) { internalGap = true; warnings.push('A public seminar card lacks an explicit or uniquely headed full date'); continue; }
      const speaker = plainText(card.find(options.speakerSelector).first().text());
      let title = plainText(card.find(options.titleSelector).last().text());
      const cancelled = /\bCancelled\b/i.test(card.text());
      if (!title || /^(?:TBD|TBA)$/i.test(title)) title = speaker ? `${series} — ${speaker}` : cancelled ? `${series} — Cancelled` : null;
      const event = normalizeEvent({ title, start, url: absoluteUrl(card.find(options.titleSelector).last().attr('href'), plan.url) || plan.url,
        description: [speaker ? `Speaker: ${speaker}.` : '', plainText(card.html())].filter(Boolean).join('\n'),
        status: cancelled ? 'cancelled' : undefined,
        location: options.locationPattern ? dateLine.match(new RegExp(options.locationPattern, 'i'))?.[1] : '' }, plan);
      if (!event) { internalGap = true; warnings.push('A public seminar card has no named speaker or usable title'); continue; }
      recognized++;
      if (inWindow(event, context)) events.set(event.uid, event);
    }
  } else if (options.layout === 'grouped-table') {
    for (const table of $(options.tableSelector || 'table').toArray()) {
      let currentDate = null;
      for (const element of $(table).find('tr').toArray()) {
        const row = $(element);
        const printedDate = plainText(row.find(options.dateSelector).text());
        if (printedDate) {
          currentDate = explicitTextDate(printedDate);
          if (!currentDate) { internalGap = true; warnings.push('A visible seminar date-group heading has no valid full date'); }
          continue;
        }
        for (const link of row.find(options.titleSelector).toArray()) {
          const title = plainText($(link).text());
          if (!title) continue;
          if (!currentDate) { internalGap = true; warnings.push('A public talk link has no preceding visible date-group heading'); continue; }
          const speaker = plainText(row.find(options.speakerSelector).text());
          const event = normalizeEvent({ title, start: currentDate, url: absoluteUrl($(link).attr('href'), plan.url),
            description: [speaker ? `Speaker: ${speaker}.` : '', plainText(row.html())].filter(Boolean).join('\n') }, plan);
          if (!event) { internalGap = true; warnings.push('A grouped dated seminar row has invalid fields'); continue; }
          recognized++;
          if (inWindow(event, context)) events.set(event.uid, event);
        }
      }
    }
  } else if (options.layout === 'dated-table') {
    const contextText = plainText($(options.contextSelector || 'main,#content').first().html());
    const clocks = options.clockPattern ? [...contextText.matchAll(new RegExp(options.clockPattern, 'gi'))] : [];
    const clock = clocks.length === 1 ? clockTime(clocks[0][1]) : null;
    const venue = options.locationPattern ? contextText.match(new RegExp(options.locationPattern, 'i'))?.[1] : '';
    for (const element of $(options.cardSelector).toArray()) {
      const card = $(element);
      const dateText = plainText(card.find(options.dateSelector).text());
      let start = explicitTextDate(dateText);
      if (!start) continue; // Header/break rows are not scheduled occurrences.
      const speaker = plainText(card.find(options.speakerSelector).first().text());
      const topic = plainText(card.find(options.titleSelector).text());
      recognized++;
      if (/^NO SEMINAR$/i.test(speaker)) continue;
      if ((!speaker || /^(?:TBD|TBA)$/i.test(speaker)) && (!topic || /^(?:TBD|TBA)$/i.test(topic))) { pendingSlots++; continue; }
      const title = topic && !/^(?:TBD|TBA)$/i.test(topic) ? topic : `${series} — ${speaker}`;
      if (start.length === 10 && clock) start += `T${clock}`;
      const event = normalizeEvent({ title, start, url: plan.url, location: venue,
        description: [speaker ? `Speaker: ${speaker}.` : '', plainText(card.html())].filter(Boolean).join('\n') }, plan);
      if (!event) { internalGap = true; warnings.push('A named, dated seminar table row has invalid fields'); continue; }
      if (inWindow(event, context)) events.set(event.uid, event);
    }
  }
  const content = plainText($(options.contentSelector || 'main,#content').first().html());
  const descriptive = options.layout === 'series-landing' && /seminar|discussion|workshop/i.test(content)
    && /example schedule|biweekly|twice a year/i.test(content);
  if (!recognized && !upcomingUndated && !descriptive) {
    internalGap = true; warnings.push('No dated talk, explicit next-talk TBD, or semantic series description was recognized');
  }
  return { events: [...events.values()], warnings, recognized, internalGap,
    undated: !events.size && !recognized && (upcomingUndated || descriptive), upcomingUndated, pendingSlots };
}

/**
 * Build a source identity that the registry policy can check before fetching.
 * @param {string} url Publisher-advertised URL.
 * @param {Object} parent Originating catalog plan.
 * @param {string} adapter Feed or HTML adapter family.
 * @param {Object} options Structural extraction options.
 * @return {Object} Synthetic current-run source plan.
 */
function discoveredPlan(url, parent, adapter = 'html', options = {}) {
  return { id: createHash('sha256').update(seminarSourceUrl(url) || url).digest('hex').slice(0, 12),
    url, fetchUrl: url, adapter, status: 'active', org: parent.org, department: parent.department,
    options: { timezone: parent.options?.timezone || 'America/New_York', ...options } };
}

/**
 * Fetch one semantic resource and its advertised feeds/linked seminar website.
 * @param {Object} plan Semantic source layout and optional linked-resource selector.
 * @param {Object} context Safe HTTP callbacks and per-run source resolver.
 * @return {Promise<Object>} Events with per-resource auditable coverage.
 */
export async function fetchSeminarResource(plan, context) {
  const audit = coverage('semantic-seminar-resource');
  const html = await context.fetchText(plan.fetchUrl || plan.url);
  const parsed = parseSemanticSeminar(html, plan, context);
  const events = new Map(parsed.events.map(event => [event.uid, event]));
  const warnings = [...parsed.warnings];
  let datedRecords = parsed.recognized;
  if (parsed.internalGap) issue(audit, { code: 'UNRECOGNIZED_SEMINAR_STRUCTURE', url: plan.url }, true);
  audit.series.push({ name: plan.org || 'Public seminar resource', url: plan.url, processed: !parsed.internalGap,
    undated: parsed.undated, upcomingUndated: parsed.upcomingUndated, pendingSlots: parsed.pendingSlots,
    datedRecords: parsed.recognized, currentEvents: parsed.events.length, method: 'semantic_public_html' });
  if (parsed.pendingSlots) audit.nonBlockingIssues.push({ code: 'UNNAMED_PENDING_SCHEDULE_SLOTS', url: plan.url, count: parsed.pendingSlots,
    reason: 'Dated rows without a named speaker or topic are pending slots, not fabricated events.' });
  const candidates = advertisedSeminarFeeds(html, plan.fetchUrl || plan.url).map(feed => ({ ...feed, options: {} }));
  if (plan.options.linkedResourcesSelector) {
    const $ = cheerio.load(html);
    for (const node of $(plan.options.linkedResourcesSelector).toArray()) {
      const url = absoluteUrl($(node).attr('href'), plan.url);
      if (url) candidates.push({ url, adapter: 'html', options: { format: 'semantic-seminar', layout: plan.options.childLayout || 'speaker-sections' } });
    }
  }
  for (const candidate of [...new Map(candidates.map(item => [item.url, item])).values()]) {
    const source = discoveredPlan(candidate.url, plan, candidate.adapter, candidate.options);
    const feedIdentity = candidate.adapter === 'ics' ? { ...source, url: plan.url } : source;
    if (!sourceAllowed(source, context.sourceScope) || !sourceAllowed(feedIdentity, context.sourceScope)) {
      audit.nonBlockingIssues.push({ code: 'SOURCE_POLICY_EXCLUSION', url: candidate.url }); continue;
    }
    try {
      if (!context.fetchSourcePlan) throw new Error('Per-run source resolver is unavailable');
      const result = await context.fetchSourcePlan(feedIdentity);
      for (const event of result.events) events.set(event.uid, event);
      warnings.push(...(result.warnings || []));
      if (result.coverage) {
        audit.series.push(...(result.coverage.series || []));
        datedRecords += result.coverage.counters?.datedRecords || 0;
        appendCoverage(audit, result.coverage);
      } else audit.series.push({ url: candidate.url, processed: true, method: 'advertised_public_feed', currentEvents: result.events.length });
      if (result.partial || result.unsupported) {
        if (!result.coverage) issue(audit, { code: 'FEED_PARSE_LIMITATION', url: candidate.url, warnings: result.warnings || [] }, true);
      }
    } catch (error) {
      recordFailure(audit, error, { url: candidate.url });
      warnings.push(`Advertised public seminar resource failed (${candidate.url}): ${error.message}`);
    }
  }
  audit.counters = { resources: audit.series.length, datedRecords, currentEvents: events.size, internalIssues: audit.internalIssues.length, externalIssues: audit.externalIssues.length };
  return { events: [...events.values()], warnings, coverage: audit,
    ...((audit.internalIssues.length || audit.externalIssues.length) ? { partial: true } : {}),
    ...(!events.size && !datedRecords && parsed.undated ? { undated: true } : {}) };
}

/**
 * Match an exact series announcement without using directory weekdays.
 * @param {Object} event Existing official calendar event.
 * @param {Object} series Published full name and explicit abbreviation.
 * @return {boolean} Whether its title names this advertised series.
 */
function seriesAnnouncement(event, series) {
  const title = label(event.title);
  return [series.name, series.aka].map(label).filter(Boolean).some(name => title === name || title.startsWith(`${name} `));
}

/**
 * Apply explicit series scope to a broader existing publisher feed.
 * @param {Object[]} events Existing normalized publisher records.
 * @param {Object} binding Exact category labels or bounded title scope.
 * @return {Object[]} Records supported by the explicit series evidence.
 */
function scopedEvents(events, binding) {
  if (binding?.matchTags) {
    const tags = new Set(binding.matchTags.map(label));
    return events.filter(event => (event.tags || []).some(tag => tags.has(label(tag))));
  }
  if (!binding?.matchPattern) return events;
  const pattern = new RegExp(binding.matchPattern, 'i');
  return events.filter(event => (binding.matchFields || ['title']).some(field => pattern.test(String(event[field] || ''))));
}

/**
 * Compare the publisher's local day without shifting late-evening occurrences.
 * @param {Object} event Normalized date-only or timed source occurrence.
 * @return {string|null} Published local calendar day, or null if invalid.
 */
function seminarDay(event) {
  try {
    return event.start.length === 10 ? event.start : new Intl.DateTimeFormat('en-CA', {
      timeZone: event.timeZone || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(event.start));
  } catch { return null; }
}

/**
 * Reconcile a live structural profile with this explicitly scoped series feed.
 * A unique fresh clock enriches one single-day unknown-time record while its
 * original public identity and published title remain stable. Ambiguous matches,
 * explicit all-day records and multi-day ranges never lose an occurrence.
 * @param {Map<string,Object>} existing Current narrow series records by UID.
 * @param {Object[]} incoming Fresh structural profile records from that series.
 * @return {void}
 */
function mergeSeminarProfileEvents(existing, incoming) {
  const previous = [...existing.values()];
  const candidates = incoming.map(event => {
    const speaker = event.description?.match(/^Speaker: (.+?)\.\n/)?.[1];
    const day = seminarDay(event);
    return previous.filter(old => day && seminarDay(old) === day
      && (label(old.title) === label(event.title) || (speaker && ` ${label(old.title)} `.includes(` ${label(speaker)} `))));
  });
  const uses = new Map();
  for (const matches of candidates) if (matches.length === 1) uses.set(matches[0].uid, (uses.get(matches[0].uid) || 0) + 1);
  for (let index = 0; index < incoming.length; index++) {
    const fresh = incoming[index];
    const matches = candidates[index];
    const old = matches.length === 1 && uses.get(matches[0].uid) === 1 ? matches[0] : null;
    if (!old) { existing.set(fresh.uid, fresh); continue; }
    if (fresh.timePrecision === 'time' && old.start.length === 10) {
      if (old.timePrecision !== 'date' || Date.parse(old.end) - Date.parse(old.start) !== 86400000) {
        existing.set(fresh.uid, fresh);
        continue;
      }
      existing.set(old.uid, { ...old, start: fresh.start, end: fresh.end, timeZone: fresh.timeZone,
        allDay: fresh.allDay, timePrecision: fresh.timePrecision, location: old.location || fresh.location });
    }
  }
}

/**
 * Discover every current directory row, reusing catalog sources and live profiles.
 * New rows use advertised structured HTML/feed discovery rather than a fixed list.
 * @param {Object} plan Directory JSON URL, structural bindings and fallback calendar.
 * @param {Object} context Current registry, policy and shared per-run resolver.
 * @return {Promise<Object>} Directory-provenance events and all-series coverage.
 */
export async function fetchSeminarDirectory(plan, context) {
  const audit = coverage('dynamic-seminar-directory');
  const json = JSON.parse(await context.fetchText(plan.options.directoryUrl));
  const series = parseSeminarDirectory(json);
  if (json.more && String(json.more) !== '0') issue(audit, { code: 'DIRECTORY_CONTINUATION_UNHANDLED', value: String(json.more) }, true);
  const events = new Map();
  const warnings = [];
  const catalog = (context.sourcePlans || []).filter(source => source.id !== plan.id && source.adapter !== 'manual');
  let fallback = { events: [] };
  if (plan.options.fallbackSourceId) {
    try {
      fallback = await context.resolveSource(plan.options.fallbackSourceId);
      recordResult(audit, fallback, { sourceId: plan.options.fallbackSourceId, purpose: 'exact public calendar announcements' });
    }
    catch (error) { recordFailure(audit, error, { sourceId: plan.options.fallbackSourceId, purpose: 'exact public calendar announcements' }); }
  }
  for (const row of series) {
    const binding = (plan.options.bindings || []).find(item => item.name && label(item.name) === label(row.name)
      && (!item.url || seminarSourceUrl(item.url) === seminarSourceUrl(row.url)))
      || (plan.options.bindings || []).find(item => item.url && seminarSourceUrl(item.url) === seminarSourceUrl(row.url));
    const exact = row.url && catalog.find(source => seminarSourceUrl(source.url) === seminarSourceUrl(row.url));
    const ids = [...new Set([...(binding?.sourceIds || []), ...(binding?.sourceId ? [binding.sourceId] : []), ...(!binding && exact ? [exact.id] : [])])];
    const item = { name: row.name, aka: row.aka, url: row.url, processed: true, undated: false,
      reusedSourceIds: [], reusedCanonicalSourceIds: [], methods: [], currentEvents: 0, ...(binding?.scopeNote ? { scopeNote: binding.scopeNote } : {}) };
    const collected = new Map();
    try {
      if (row.url && seminarSourceUrl(row.url) === seminarSourceUrl(plan.url)) throw new Error('Directory source cannot discover itself as a child');
      for (const id of ids) {
        const result = await context.resolveSource(id);
        item.reusedSourceIds.push(id);
        let canonical = catalog.find(source => source.id === id);
        const seen = new Set();
        while (canonical?.status === 'covered' && !seen.has(canonical.id)) { seen.add(canonical.id); canonical = catalog.find(source => source.id === canonical.canonicalSourceId); }
        if (canonical) item.reusedCanonicalSourceIds.push(canonical.id);
        item.methods.push('catalog_source_reuse');
        for (const event of scopedEvents(result.events, binding)) collected.set(event.uid, event);
        item.processed = recordResult(audit, result, { series: row.name, sourceId: id }) && item.processed;
        if (result.partial || result.unsupported) {
          warnings.push(`Directory series ${row.name}: reused source ${id} reports partial coverage`);
        }
      }
      if (binding?.profile) {
        const source = discoveredPlan(row.url || binding.url, { ...plan, org: row.name }, binding.adapter || 'html', binding.profile);
        const result = await context.fetchSourcePlan(source);
        item.methods.push('live_structural_profile');
        mergeSeminarProfileEvents(collected, result.events);
        item.processed = recordResult(audit, result, { series: row.name, url: source.url }) && item.processed;
      } else if (!ids.length && row.url) {
        const source = discoveredPlan(row.url, { ...plan, org: row.name }, 'html', { detailLinks: true, maxDetails: 50,
          paginationSelector: 'a[rel="next"]', maxPages: 100, embeddedGoogleCalendarSelector: 'iframe[src*="calendar"]' });
        if (!sourceAllowed(source, context.sourceScope)) {
          item.methods.push('source_registry_exclusion');
          audit.nonBlockingIssues.push({ code: 'SOURCE_POLICY_EXCLUSION', series: row.name, url: row.url });
          audit.series.push(item);
          continue;
        }
        const html = await context.fetchText(row.url);
        const feeds = advertisedSeminarFeeds(html, row.url);
        item.methods.push('generic_public_html_feed_discovery');
        if (feeds.length) {
          for (const feed of feeds) {
            const feedPlan = { ...discoveredPlan(feed.url, source, feed.adapter), url: row.url };
            const result = await context.fetchSourcePlan(feedPlan);
            for (const event of result.events) collected.set(event.uid, event);
            item.processed = recordResult(audit, result, { series: row.name, url: feed.url }) && item.processed;
          }
        } else {
          const result = await context.fetchSourcePlan(source);
          for (const event of result.events) collected.set(event.uid, event);
          item.processed = recordResult(audit, result, { series: row.name, url: row.url }) && item.processed;
        }
      }
      const fallbackEvents = fallback.events.filter(event => seriesAnnouncement(event, row));
      for (const event of fallbackEvents) {
        if (![...collected.values()].some(old => old.start === event.start && label(old.title) === label(event.title))) collected.set(event.uid, event);
      }
      if (fallbackEvents.length) item.methods.push('explicit_public_calendar_announcements');
      if (!row.url && !ids.length) {
        item.methods.push('directory_metadata_and_public_calendar');
        item.undated = !collected.size;
        if (item.undated) audit.nonBlockingIssues.push({ code: 'NO_PUBLISHED_DATED_ENDPOINT', series: row.name,
          reason: 'The publisher supplies no website; directory weekday/clock is not an occurrence. No matching dated announcement was found in the public SCS calendar window.' });
      }
      item.currentEvents = collected.size;
      item.undated ||= !collected.size && binding?.undatedWhenEmpty === true;
      for (const event of collected.values()) {
        const existing = events.get(event.uid);
        events.set(event.uid, { ...(existing || event), tags: [...new Set([...(existing?.tags || event.tags || []), row.name])] });
      }
    } catch (error) {
      const external = recordFailure(audit, error, { series: row.name, url: row.url });
      item.processed = external;
      warnings.push(`Directory series ${row.name}: ${error.message}`);
    }
    audit.series.push(item);
  }
  audit.counters = { advertised: series.length, processed: audit.series.filter(item => item.processed).length,
    catalogReused: audit.series.filter(item => item.reusedSourceIds.length).length,
    undated: audit.series.filter(item => item.undated).length, currentEvents: events.size };
  warnings.push(`Seminar directory inspected ${audit.counters.processed}/${series.length} current series; ${audit.counters.catalogReused} reused catalog sources; ${audit.counters.undated} entries publish no dated endpoint.`);
  return { events: [...events.values()], warnings, coverage: audit,
    ...((audit.internalIssues.length || audit.externalIssues.length) ? { partial: true } : {}),
    ...(!events.size && !audit.internalIssues.length && !audit.externalIssues.length ? { undated: true } : {}) };
}
