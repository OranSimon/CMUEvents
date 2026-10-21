import { XMLParser } from 'fast-xml-parser';
import { normalizeEvent, inWindow } from '../lib/normalize.mjs';
import { parseHtml, explicitTextDate } from './html.mjs';

/**
 * Read text from XML nodes that may also contain attributes.
 * @param {unknown} value XML node value.
 * @return {string} Source text.
 */
function xmlText(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? String(value['#text'] || value['#cdata'] || '') : String(value);
}

/**
 * Extract events from RSS/Atom with explicit event dates, not publication dates.
 * Supports xCal, event/ev namespaces, event HTML metadata and explicit dated prose.
 * @param {string} text RSS or Atom document.
 * @param {Object} plan Source provenance and timezone options.
 * @param {Object} context Optional ingestion window.
 * @return {{events:Object[],warnings:string[]}} Events and skipped-item diagnostics.
 */
export function parseRss(text, plan = {}, context = {}) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: false });
  const json = parser.parse(text);
  const channel = json.rss?.channel || json['rdf:RDF'] || json.feed;
  if (!channel) throw new Error('Response is neither RSS nor Atom');
  const items = [].concat(channel.item || channel.entry || json['rdf:RDF']?.item || []);
  const events = [];
  const warnings = [];
  let partial = false;
  const timezone = xmlText(channel['xCal:timezone']) || plan.options?.timezone || 'America/New_York';
  for (const item of items) {
    const links = [].concat(item.link || []);
    const link = links.find(value => typeof value === 'string')
      || links.find(value => !value['@_rel'] || value['@_rel'] === 'alternate');
    const url = typeof link === 'object' ? link['@_href'] || xmlText(link) : link;
    const description = xmlText(item['xCal:description'] || item['content:encoded'] || item.description || item.content || item.summary);
    const title = xmlText(item.title || item['xCal:summary']);
    const start = xmlText(item['xCal:dtstart'] || item['ev:startdate'] || item['event:startdate']
      || item['event:startDate'] || item['startDate'] || item['dtstart']);
    const end = xmlText(item['xCal:dtend'] || item['ev:enddate'] || item['event:enddate'] || item['endDate']);
    // Event markup is stronger evidence than prose; publication metadata is never
    // interpreted as an event start, even when this is a calendar RSS channel.
    const structured = parseHtml(description, { ...plan, url: url || plan.url }, context).events;
    if (structured.length) { events.push(...structured); continue; }
    const explicitStart = start || explicitTextDate(description);
    const event = normalizeEvent({
      uid: xmlText(item['xCal:uid'] || item.guid || item.id), title,
      description, start: explicitStart, end, url,
      timeZone: timezone,
      allDay: xmlText(item['x-microsoft:cdo-alldayevent']).toLowerCase() === 'true' || /^\d{4}-\d{2}-\d{2}$/.test(start),
      location: xmlText(item['xCal:location'] || item['ev:location'] || item['event:location']),
      status: xmlText(item['xCal:status']),
      tags: [].concat(item.category || []).map(value => typeof value === 'object' ? value['@_term'] || xmlText(value) : value),
    }, { ...plan, options: { ...plan.options, timezone } });
    if (event && inWindow(event, context)) events.push(event);
    else if (!event) {
      if (explicitStart) partial = true;
      warnings.push(`Skipped feed item "${title.slice(0, 90)}": no usable explicit event start/title/link (publication dates are ignored)`);
    }
  }
  return { events, warnings, ...(partial ? { partial: true } : {}) };
}

/**
 * Fetch an RSS or Atom feed using the shared bounded HTTP client.
 * @param {Object} plan Source endpoint configuration.
 * @param {Object} context Fetch callback and date window.
 * @return {Promise<Object>} Parsed event result.
 */
export async function fetchRss(plan, context) {
  return parseRss(await context.fetchText(plan.fetchUrl || plan.url), plan, context);
}
